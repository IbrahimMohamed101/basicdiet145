"use strict";

const mongoose = require("mongoose");

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const ActivityLog = require("../../models/ActivityLog");
const { logger } = require("../../utils/logger");
const dateUtils = require("../../utils/date");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { consumeSubscriptionDayCredits } = require("./subscriptionDayConsumptionService");

const NON_CONSUMING_EXCEPTION_STATUSES = new Set(["skipped", "frozen"]);
const FINAL_STATUSES = new Set([
  "fulfilled",
  "consumed_without_preparation",
  "no_show",
  "delivery_canceled",
  "canceled_at_branch",
]);
const SETTLEABLE_STATUSES = new Set([
  "open",
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "out_for_delivery",
]);

const DEFAULT_NOTE = "Auto-settled past subscription day according to calendar-based subscription policy";

function normalizeActor(actor = null) {
  if (!actor || typeof actor !== "object") {
    return { actorType: "system", actorId: null, settledBy: "system" };
  }

  const actorType = String(actor.actorType || actor.type || actor.role || "system");
  const actorId = actor.actorId || actor.userId || actor.dashboardUserId || null;
  return {
    actorType,
    actorId: actorId && mongoose.isValidObjectId(actorId) ? actorId : null,
    settledBy: actorId ? String(actorId) : actorType,
  };
}

function normalizeDateString(value) {
  if (!value) return null;
  if (typeof value === "string" && dateUtils.isValidKSADateString(value)) return value;
  try {
    return dateUtils.toKSADateString(value);
  } catch (_) {
    return null;
  }
}

async function resolveDateBefore(options = {}) {
  const explicit = normalizeDateString(options.dateBefore || options.businessDate);
  if (explicit) return explicit;
  return getRestaurantBusinessDate();
}

function shouldSkipDay(day) {
  const status = String(day && day.status ? day.status : "open");
  return NON_CONSUMING_EXCEPTION_STATUSES.has(status)
    || FINAL_STATUSES.has(status)
    || Boolean(day && day.autoSettled)
    || !SETTLEABLE_STATUSES.has(status);
}

function hasSelectedMeals(day = {}) {
  if (Array.isArray(day.materializedMeals) && day.materializedMeals.filter(Boolean).length > 0) return true;
  if (Array.isArray(day.mealSlots) && day.mealSlots.some((slot) => slot && slot.status === "complete")) return true;
  if (Array.isArray(day.selections) && day.selections.filter(Boolean).length > 0) return true;
  return false;
}

function resolveSettlementPatch(day, subscription) {
  const status = String(day && day.status ? day.status : "open");
  const mode = subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";

  if (status === "ready_for_pickup" && mode === "pickup") {
    return {
      toStatus: "no_show",
      reason: "PICKUP_NO_SHOW_AUTO_SETTLED",
      dayEndConsumptionReason: "pickup_no_show_auto_settled",
      extra: {
        pickupRequested: false,
        pickupNoShowAt: day.pickupNoShowAt || new Date(),
      },
    };
  }

  if (status === "out_for_delivery") {
    return {
      toStatus: "consumed_without_preparation",
      reason: "DELIVERY_PAST_DAY_AUTO_CONSUMED",
      dayEndConsumptionReason: "delivery_past_day_auto_consumed",
      extra: {},
    };
  }

  if (status === "locked") {
    return {
      toStatus: "consumed_without_preparation",
      reason: "LOCKED_PAST_DAY_AUTO_CONSUMED",
      dayEndConsumptionReason: "locked_past_day_auto_consumed",
      extra: { pickupRequested: false },
    };
  }

  if (status === "open" && !hasSelectedMeals(day)) {
    return {
      toStatus: "consumed_without_preparation",
      reason: "UNPLANNED_PAST_DAY_AUTO_CONSUMED",
      dayEndConsumptionReason: "unplanned_past_day_auto_consumed",
      extra: {},
    };
  }

  return {
    toStatus: "consumed_without_preparation",
    reason: "PAST_DAY_AUTO_CONSUMED",
    dayEndConsumptionReason: "past_day_auto_consumed",
    extra: status === "ready_for_pickup" ? { pickupRequested: false } : {},
  };
}

async function writeSettlementLogs({ day, fromStatus, toStatus, actor, reason, now, session }) {
  await SubscriptionAuditLog.create([{
    entityType: "subscription_day",
    entityId: day._id,
    action: "past_day_auto_settled",
    fromStatus,
    toStatus,
    actorType: actor.actorType,
    actorId: actor.actorId || undefined,
    note: DEFAULT_NOTE,
    meta: {
      subscriptionId: day.subscriptionId ? String(day.subscriptionId) : null,
      date: day.date,
      reason,
      autoSettled: true,
    },
    createdAt: now,
    updatedAt: now,
  }], { session });

  await ActivityLog.create([{
    entityType: "subscription_day",
    entityId: day._id,
    action: "past_day_auto_settled",
    byUserId: actor.actorId || undefined,
    byRole: actor.actorType,
    meta: {
      subscriptionId: day.subscriptionId ? String(day.subscriptionId) : null,
      date: day.date,
      fromStatus,
      toStatus,
      reason,
    },
    createdAt: now,
    updatedAt: now,
  }], { session });
}

async function settleDayDocument({ day, subscription, now, actor, reasonOverride = null, session }) {
  if (!day || shouldSkipDay(day)) {
    return { settled: false, skipped: true, reason: "not_eligible" };
  }

  const fromStatus = String(day.status || "open");
  const settlement = resolveSettlementPatch(day, subscription);
  const reason = reasonOverride || settlement.reason;

  try {
    await consumeSubscriptionDayCredits({
      day,
      subscription,
      session,
      reason,
    });
  } catch (err) {
    if (err && err.code === "INSUFFICIENT_CREDITS") {
      logger.warn("Past subscription day auto-settlement skipped due to insufficient credits", {
        subscriptionId: String(day.subscriptionId),
        dayId: String(day._id),
        date: day.date,
        status: fromStatus,
      });
      return { settled: false, skipped: false, failed: true, code: err.code };
    }
    throw err;
  }

  day.status = settlement.toStatus;
  day.dayEndConsumptionReason = settlement.dayEndConsumptionReason;
  day.autoSettled = true;
  day.settledAt = now;
  day.settlementReason = reason;
  day.settledBy = actor.settledBy;
  Object.assign(day, settlement.extra || {});
  await day.save({ session });

  await writeSettlementLogs({
    day,
    fromStatus,
    toStatus: settlement.toStatus,
    actor,
    reason,
    now,
    session,
  });

  return {
    settled: true,
    dayId: String(day._id),
    date: day.date,
    fromStatus,
    toStatus: settlement.toStatus,
    reason,
  };
}

async function settlePastSubscriptionDaysForRange({
  dateBefore,
  dateFrom = null,
  subscriptionId = null,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  const resolvedDateBefore = await resolveDateBefore({ dateBefore, businessDate });
  const actorInfo = normalizeActor(actor);
  const query = {
    date: { $lt: resolvedDateBefore },
    status: { $in: Array.from(SETTLEABLE_STATUSES) },
  };

  const normalizedDateFrom = normalizeDateString(dateFrom);
  if (normalizedDateFrom) {
    query.date.$gte = normalizedDateFrom;
  }
  if (subscriptionId) {
    query.subscriptionId = subscriptionId;
  }

  const session = await mongoose.startSession();
  const result = {
    dateBefore: resolvedDateBefore,
    scanned: 0,
    settled: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    settledDays: [],
  };

  try {
    session.startTransaction();
    const days = await SubscriptionDay.find(query).sort({ date: 1 }).session(session);
    result.scanned = days.length;
    const subscriptionIds = Array.from(new Set(days.map((day) => String(day.subscriptionId))));
    const subscriptions = subscriptionIds.length
      ? await Subscription.find({ _id: { $in: subscriptionIds } }).session(session)
      : [];
    const subscriptionMap = new Map(subscriptions.map((sub) => [String(sub._id), sub]));

    for (const day of days) {
      const subscription = subscriptionMap.get(String(day.subscriptionId));
      if (!subscription) {
        result.skipped += 1;
        continue;
      }

      const dayResult = await settleDayDocument({
        day,
        subscription,
        now,
        actor: actorInfo,
        reasonOverride: reason,
        session,
      });

      if (dayResult.settled) {
        result.settled += 1;
        result.settledDays.push(dayResult);
      } else if (dayResult.failed) {
        result.failed += 1;
        result.failures.push({
          dayId: String(day._id),
          date: day.date,
          code: dayResult.code,
        });
      } else {
        result.skipped += 1;
      }
    }

    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    logger.error("Past subscription day settlement failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: subscriptionId ? String(subscriptionId) : null,
      dateBefore: resolvedDateBefore,
      dateFrom: normalizedDateFrom,
    });
    throw err;
  } finally {
    session.endSession();
  }
}

async function settlePastSubscriptionDaysForSubscription({
  subscriptionId,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  if (!subscriptionId) {
    return {
      dateBefore: await resolveDateBefore({ businessDate }),
      scanned: 0,
      settled: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      settledDays: [],
    };
  }

  return settlePastSubscriptionDaysForRange({
    subscriptionId,
    now,
    actor,
    reason,
    businessDate,
  });
}

async function settlePastSubscriptionDaysForDate({
  date,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  const dateStr = normalizeDateString(date);
  const resolvedBusinessDate = await resolveDateBefore({ businessDate });
  if (!dateStr || dateStr >= resolvedBusinessDate) {
    return {
      dateBefore: resolvedBusinessDate,
      scanned: 0,
      settled: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      settledDays: [],
    };
  }

  return settlePastSubscriptionDaysForRange({
    dateFrom: dateStr,
    dateBefore: dateUtils.addDaysToKSADateString(dateStr, 1),
    now,
    actor,
    reason,
    businessDate: resolvedBusinessDate,
  });
}

async function settlePastSubscriptionDaysSafely(input = {}) {
  try {
    return await settlePastSubscriptionDaysForRange(input);
  } catch (err) {
    return {
      dateBefore: input.dateBefore || input.businessDate || null,
      scanned: 0,
      settled: 0,
      skipped: 0,
      failed: 1,
      failures: [{ code: err.code || "SETTLEMENT_FAILED", message: err.message }],
      settledDays: [],
    };
  }
}

module.exports = {
  FINAL_STATUSES,
  NON_CONSUMING_EXCEPTION_STATUSES,
  SETTLEABLE_STATUSES,
  settlePastSubscriptionDaysForDate,
  settlePastSubscriptionDaysForRange,
  settlePastSubscriptionDaysForSubscription,
  settlePastSubscriptionDaysSafely,
};
