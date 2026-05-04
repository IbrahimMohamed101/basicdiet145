"use strict";

/**
 * DISABLED — Past Subscription Day Settlement Service
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Previous behavior (now removed):
 *   - Past open/locked/in_preparation/out_for_delivery days → consumed_without_preparation
 *   - Past ready_for_pickup (pickup mode) → no_show
 *   - remainingMeals decremented automatically when a calendar day passed
 *
 * New policy (effective 2026-05-04):
 *   A subscription is a TOTAL meal balance (remainingMeals) available during the
 *   validity period. Meals do NOT expire day-by-day. Passing a calendar day does
 *   NOT consume meals. Deduction happens ONLY on:
 *     1. Actual operational fulfillment (fulfillSubscriptionDay)
 *     2. Explicit cashier/manual consumption (consumeSubscriptionMealBalance)
 *
 * All four exported functions are now no-ops by default. Every existing caller
 * continues to import and invoke them without errors — they simply return
 * { settled: 0, scanned: 0, ... } immediately with no state mutations.
 *
 * Emergency rollback: set env var SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED=true
 * ──────────────────────────────────────────────────────────────────────────────
 */

const AUTO_SETTLEMENT_ENABLED = process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED === "true";

const EMPTY_RESULT = Object.freeze({
  dateBefore: null,
  scanned: 0,
  settled: 0,
  skipped: 0,
  failed: 0,
  failures: [],
  settledDays: [],
});

// ─── Status constants preserved for callers that import them for reference ────
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

// ─── Legacy implementation (kept for emergency rollback only) ─────────────────
// Loaded lazily so it adds zero overhead when disabled.
async function _runLegacySettlement({
  dateBefore,
  dateFrom = null,
  subscriptionId = null,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  const mongoose = require("mongoose");
  const Subscription = require("../../models/Subscription");
  const SubscriptionDay = require("../../models/SubscriptionDay");
  const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
  const ActivityLog = require("../../models/ActivityLog");
  const { logger } = require("../../utils/logger");
  const dateUtils = require("../../utils/date");
  const { getRestaurantBusinessDate } = require("../restaurantHoursService");
  const { consumeSubscriptionDayCredits } = require("./subscriptionDayConsumptionService");

  function _normalizeActor(a) {
    if (!a || typeof a !== "object") return { actorType: "system", actorId: null, settledBy: "system" };
    const actorType = String(a.actorType || a.type || a.role || "system");
    const actorId = a.actorId || a.userId || a.dashboardUserId || null;
    return { actorType, actorId: actorId && mongoose.isValidObjectId(actorId) ? actorId : null, settledBy: actorId ? String(actorId) : actorType };
  }

  function _normDate(v) {
    if (!v) return null;
    if (typeof v === "string" && dateUtils.isValidKSADateString(v)) return v;
    try { return dateUtils.toKSADateString(v); } catch (_) { return null; }
  }

  const resolvedDateBefore = _normDate(dateBefore || businessDate) || await getRestaurantBusinessDate();
  const actorInfo = _normalizeActor(actor);
  const query = { date: { $lt: resolvedDateBefore }, status: { $in: Array.from(SETTLEABLE_STATUSES) } };
  const normalizedDateFrom = _normDate(dateFrom);
  if (normalizedDateFrom) query.date.$gte = normalizedDateFrom;
  if (subscriptionId) query.subscriptionId = subscriptionId;

  const session = await mongoose.startSession();
  const result = { dateBefore: resolvedDateBefore, scanned: 0, settled: 0, skipped: 0, failed: 0, failures: [], settledDays: [] };

  try {
    session.startTransaction();
    const days = await SubscriptionDay.find(query).sort({ date: 1 }).session(session);
    result.scanned = days.length;
    const subIds = Array.from(new Set(days.map((d) => String(d.subscriptionId))));
    const subs = subIds.length ? await Subscription.find({ _id: { $in: subIds } }).session(session) : [];
    const subMap = new Map(subs.map((s) => [String(s._id), s]));

    for (const day of days) {
      const sub = subMap.get(String(day.subscriptionId));
      if (!sub) { result.skipped += 1; continue; }

      const status = String(day.status || "open");
      if (!SETTLEABLE_STATUSES.has(status) || FINAL_STATUSES.has(status) || day.autoSettled) { result.skipped += 1; continue; }

      const mode = sub.deliveryMode === "pickup" ? "pickup" : "delivery";
      const toStatus = (status === "ready_for_pickup" && mode === "pickup") ? "no_show" : "consumed_without_preparation";
      const fromStatus = status;
      const dayReason = reason || (toStatus === "no_show" ? "PICKUP_NO_SHOW_AUTO_SETTLED" : "PAST_DAY_AUTO_CONSUMED");

      try {
        await consumeSubscriptionDayCredits({ day, subscription: sub, session, reason: dayReason });
      } catch (err) {
        if (err && err.code === "INSUFFICIENT_CREDITS") { result.failed += 1; result.failures.push({ dayId: String(day._id), date: day.date, code: err.code }); continue; }
        throw err;
      }

      day.status = toStatus; day.autoSettled = true; day.settledAt = now; day.settlementReason = dayReason; day.settledBy = actorInfo.settledBy;
      if (toStatus === "no_show") { day.pickupNoShowAt = day.pickupNoShowAt || now; day.pickupRequested = false; }
      await day.save({ session });

      await SubscriptionAuditLog.create([{ entityType: "subscription_day", entityId: day._id, action: "past_day_auto_settled", fromStatus, toStatus, actorType: actorInfo.actorType, actorId: actorInfo.actorId || undefined, note: "Auto-settled past subscription day (legacy mode)", meta: { subscriptionId: String(day.subscriptionId), date: day.date, reason: dayReason, autoSettled: true } }], { session });
      await ActivityLog.create([{ entityType: "subscription_day", entityId: day._id, action: "past_day_auto_settled", byUserId: actorInfo.actorId || undefined, byRole: actorInfo.actorType, meta: { subscriptionId: String(day.subscriptionId), date: day.date, fromStatus, toStatus, reason: dayReason } }], { session });

      result.settled += 1;
      result.settledDays.push({ settled: true, dayId: String(day._id), date: day.date, fromStatus, toStatus, reason: dayReason });
    }

    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    logger.error("Legacy past subscription day settlement failed", { error: err.message, subscriptionId: subscriptionId ? String(subscriptionId) : null });
    throw err;
  } finally {
    session.endSession();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function settlePastSubscriptionDaysForRange(options = {}) {
  if (!AUTO_SETTLEMENT_ENABLED) return { ...EMPTY_RESULT };
  return _runLegacySettlement(options);
}

async function settlePastSubscriptionDaysForSubscription({
  subscriptionId,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  if (!AUTO_SETTLEMENT_ENABLED) return { ...EMPTY_RESULT };
  if (!subscriptionId) return { ...EMPTY_RESULT };
  return _runLegacySettlement({ subscriptionId, now, actor, reason, businessDate });
}

async function settlePastSubscriptionDaysForDate({
  date,
  now = new Date(),
  actor = null,
  reason = null,
  businessDate = null,
} = {}) {
  if (!AUTO_SETTLEMENT_ENABLED) return { ...EMPTY_RESULT };
  const dateUtils = require("../../utils/date");
  const { getRestaurantBusinessDate } = require("../restaurantHoursService");
  const dateStr = typeof date === "string" && dateUtils.isValidKSADateString(date)
    ? date
    : (date ? (() => { try { return dateUtils.toKSADateString(date); } catch (_) { return null; } })() : null);
  const resolvedBusinessDate = businessDate || await getRestaurantBusinessDate();
  if (!dateStr || dateStr >= resolvedBusinessDate) return { ...EMPTY_RESULT };
  return _runLegacySettlement({
    dateFrom: dateStr,
    dateBefore: dateUtils.addDaysToKSADateString(dateStr, 1),
    now,
    actor,
    reason,
    businessDate: resolvedBusinessDate,
  });
}

async function settlePastSubscriptionDaysSafely(input = {}) {
  if (!AUTO_SETTLEMENT_ENABLED) return { ...EMPTY_RESULT };
  try {
    return await _runLegacySettlement(input);
  } catch (err) {
    return { ...EMPTY_RESULT, failed: 1, failures: [{ code: err.code || "SETTLEMENT_FAILED", message: err.message }] };
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
