"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { addDaysToKSADateString } = dateUtils;
const { logger } = require("../../utils/logger");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("./subscriptionCutoffPolicyService");
const { syncSubscriptionValidity } = require("./subscriptionCompensationService");
const { resolveSubscriptionFreezePolicy } = require("./subscriptionContractReadService");

function buildErrorResult(status, code, message, details) {
  return {
    ok: false,
    status,
    code,
    message,
    details,
  };
}

function buildSuccessResult(status, data) {
  return {
    ok: true,
    status,
    data,
  };
}

function parsePositiveInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function buildDateRangeOrThrow(startDate, days, fieldName = "days") {
  if (!startDate || !dateUtils.isValidKSADateString(startDate)) {
    const err = new Error("Invalid startDate");
    err.code = "INVALID_DATE";
    throw err;
  }

  const parsedDays = parsePositiveInteger(days);
  if (!parsedDays) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.code = "INVALID";
    throw err;
  }

  return Array.from({ length: parsedDays }, (_, index) => addDaysToKSADateString(startDate, index));
}

async function validateFreezeRangeOrThrow(subscription, startDate, days, validateFutureDateOrThrowFn) {
  const targetDates = buildDateRangeOrThrow(startDate, days);
  const baseEndDate = subscription.endDate || subscription.validityEndDate;

  for (const date of targetDates) {
    await validateFutureDateOrThrowFn(date, subscription, baseEndDate);
  }

  return { targetDates };
}

async function ensureDateRangeDoesNotIncludeLockedTomorrow(dateStrings) {
  await assertTomorrowCutoffAllowed({
    action: CUTOFF_ACTIONS.FREEZE_RANGE_CHANGE,
    dates: dateStrings,
  });
}

async function getFrozenDateStrings(subscriptionId, session) {
  const query = SubscriptionDay.find({
    subscriptionId,
    status: "frozen",
  }).select("date");
  if (session) {
    query.session(session);
  }
  const frozenDays = await query.lean();
  return frozenDays
    .map((day) => day.date)
    .filter((date) => typeof date === "string")
    .sort();
}

function countFrozenBlocks(dateStrings) {
  const uniqueSorted = Array.from(new Set(dateStrings)).sort();
  let blocks = 0;
  let previousDate = null;

  for (const date of uniqueSorted) {
    if (!previousDate || addDaysToKSADateString(previousDate, 1) !== date) {
      blocks += 1;
    }
    previousDate = date;
  }

  return blocks;
}

async function freezeSubscriptionForClient({
  subscriptionId,
  startDate,
  days,
  userId,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  writeLogSafelyFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  const freezePolicy = resolveSubscriptionFreezePolicy(sub, sub.planId, {
    context: "freeze_subscription",
  });
  if (!freezePolicy.enabled) {
    return buildErrorResult(422, "FREEZE_DISABLED", "Freeze is disabled for this plan");
  }

  let targetDates;
  try {
    ensureActiveFn(sub, startDate);
    ({ targetDates } = await validateFreezeRangeOrThrow(sub, startDate, days, validateFutureDateOrThrowFn));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);
  } catch (err) {
    if (err.code === "FREEZE_DISABLED") {
      return buildErrorResult(422, err.code, err.message);
    }
    const status =
      err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 :
        err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED" ? 400 :
          400;
    return buildErrorResult(status, err.code || "INVALID", err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(subscriptionId).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }

    ensureActiveFn(subInSession, startDate);
    const policyInSession = resolveSubscriptionFreezePolicy(subInSession, subInSession.planId, {
      context: "freeze_subscription",
    });
    if (!policyInSession.enabled) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(422, "FREEZE_DISABLED", "Freeze is disabled for this plan");
    }

    ({ targetDates } = await validateFreezeRangeOrThrow(
      subInSession,
      startDate,
      days,
      validateFutureDateOrThrowFn
    ));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);

    const targetDays = await SubscriptionDay.find({
      subscriptionId: subInSession._id,
      date: { $in: targetDates },
    }).session(session);
    const targetDaysByDate = new Map(targetDays.map((day) => [day.date, day]));

    const blockedDay = targetDates.find((date) => {
      const day = targetDaysByDate.get(date);
      return day && !["open", "frozen"].includes(day.status);
    });
    if (blockedDay) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "LOCKED", `Day ${blockedDay} is not open for freeze`);
    }

    const currentFrozenDates = await getFrozenDateStrings(subInSession._id, session);
    const prospectiveFrozenSet = new Set(currentFrozenDates);
    const newlyFrozenDates = [];
    const alreadyFrozen = [];

    for (const date of targetDates) {
      if (prospectiveFrozenSet.has(date)) {
        alreadyFrozen.push(date);
      } else {
        prospectiveFrozenSet.add(date);
        newlyFrozenDates.push(date);
      }
    }

    if (prospectiveFrozenSet.size > policyInSession.maxDays) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(
        403,
        "FREEZE_LIMIT_REACHED",
        `Freeze days exceed plan limit of ${policyInSession.maxDays}`
      );
    }
    if (countFrozenBlocks(Array.from(prospectiveFrozenSet)) > policyInSession.maxTimes) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(
        403,
        "FREEZE_LIMIT_REACHED",
        `Freeze periods exceed plan limit of ${policyInSession.maxTimes}`
      );
    }

    for (const date of targetDates) {
      const existingDay = targetDaysByDate.get(date);
      if (existingDay) {
        if (existingDay.status !== "frozen") {
          existingDay.status = "frozen";
          existingDay.canonicalDayActionType = "freeze";
          await existingDay.save({ session });
        }
      } else {
        await SubscriptionDay.create([{
          subscriptionId: subInSession._id,
          date,
          status: "frozen",
          canonicalDayActionType: "freeze",
        }], { session });
      }
    }

    const syncResult = await syncSubscriptionValidity(subInSession, session);

    await session.commitTransaction();
    session.endSession();

    await writeLogSafelyFn({
      entityType: "subscription",
      entityId: subInSession._id,
      action: "freeze",
      byUserId: userId,
      byRole: "client",
      meta: { startDate, days: targetDates.length, frozenDates: targetDates },
    }, { subscriptionId, startDate });

    return buildSuccessResult(200, {
      subscriptionId: subInSession.id,
      frozenDates: targetDates,
      newlyFrozenDates,
      alreadyFrozen,
      frozenDaysTotal: syncResult.frozenCount,
      validityEndDate: dateUtils.toKSADateString(syncResult.validityEndDate),
      freezePolicy: policyInSession,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return buildErrorResult(422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED") {
      return buildErrorResult(400, err.code, err.message);
    }
    if (err.code === "FREEZE_CONFLICT") {
      return buildErrorResult(409, err.code, err.message);
    }
    logger.error("Freeze subscription failed", { subscriptionId, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Freeze failed");
  }
}

async function unfreezeSubscriptionForClient({
  subscriptionId,
  startDate,
  days,
  userId,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  writeLogSafelyFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  let targetDates;
  try {
    ensureActiveFn(sub, startDate);
    ({ targetDates } = await validateFreezeRangeOrThrow(sub, startDate, days, validateFutureDateOrThrowFn));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);
  } catch (err) {
    const status =
      err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 :
        err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED" ? 400 :
          400;
    return buildErrorResult(status, err.code || "INVALID", err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(subscriptionId).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }

    ensureActiveFn(subInSession, startDate);
    ({ targetDates } = await validateFreezeRangeOrThrow(
      subInSession,
      startDate,
      days,
      validateFutureDateOrThrowFn
    ));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);

    const targetDays = await SubscriptionDay.find({
      subscriptionId: subInSession._id,
      date: { $in: targetDates },
    }).session(session);
    const targetDaysByDate = new Map(targetDays.map((day) => [day.date, day]));

    const unfrozenDates = [];
    const notFrozen = [];
    for (const date of targetDates) {
      const day = targetDaysByDate.get(date);
      if (!day || day.status !== "frozen") {
        notFrozen.push(date);
        continue;
      }
      await SubscriptionDay.updateOne(
        { _id: day._id },
        { $set: { status: "open" }, $unset: { canonicalDayActionType: 1 } },
        { session }
      );
      unfrozenDates.push(date);
    }

    const syncResult = await syncSubscriptionValidity(subInSession, session);

    await session.commitTransaction();
    session.endSession();

    if (unfrozenDates.length > 0) {
      await writeLogSafelyFn({
        entityType: "subscription_day",
        entityId: subInSession._id,
        action: "unfreeze",
        byUserId: userId,
        byRole: "client",
        meta: { startDate, days: targetDates.length, unfrozenDates },
      }, { subscriptionId, startDate });
    }

    return buildSuccessResult(200, {
      subscriptionId: subInSession.id,
      unfrozenDates,
      notFrozen,
      frozenDaysTotal: syncResult.frozenCount,
      validityEndDate: dateUtils.toKSADateString(syncResult.validityEndDate),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return buildErrorResult(422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED") {
      return buildErrorResult(400, err.code, err.message);
    }
    if (err.code === "FREEZE_CONFLICT") {
      return buildErrorResult(409, err.code, err.message);
    }
    logger.error("Unfreeze subscription failed", { subscriptionId, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Unfreeze failed");
  }
}

module.exports = {
  freezeSubscriptionForClient,
  unfreezeSubscriptionForClient,
};
