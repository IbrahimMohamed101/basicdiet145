"use strict";

const Subscription = require("../../models/Subscription");
const { logger } = require("../../utils/logger");
const { localizeWriteDayPayload, localizeSkipRangeSummary } = require("../../utils/subscription/subscriptionWriteLocalization");
const {
  buildProjectedOpenDayForClient,
  buildSingleSkipMessage,
} = require("./subscriptionClientSupportService");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("./subscriptionCutoffPolicyService");
const {
  performSkipRange,
  performSkipDay,
  performUnskipDay,
  resolveSkipRemainingDays,
} = require("./subscriptionSkipService");
const { resolveSubscriptionSkipPolicy } = require("./subscriptionContractReadService");

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

async function skipDayForClient({
  subscriptionId,
  date,
  userId,
  lang,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  writeLogSafelyFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActiveFn(sub, date);
    await validateFutureDateOrThrowFn(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
  }

  try {
    await assertTomorrowCutoffAllowed({
      action: CUTOFF_ACTIONS.SKIP_DAY_CHANGE,
      date,
    });
  } catch (err) {
    return buildErrorResult(400, err.code || "CUTOFF_PASSED_FOR_TOMORROW", err.message);
  }

  try {
    const result = await performSkipDay({
      userId,
      subscriptionId,
      date,
    });

    const policy = result.policy || resolveSubscriptionSkipPolicy(result.subscription, result.subscription.planId, {
      context: "skip_day",
    });
    const remainingSkipDays = resolveSkipRemainingDays(policy, result.subscription);

    if (result.status === "already_skipped") {
      return buildSuccessResult(200, {
        day: localizeWriteDayPayload(result.day, { lang }),
        requestedDays: 1,
        appliedDays: 0,
        remainingSkipDays,
        compensatedDaysAdded: 0,
        message: buildSingleSkipMessage({ appliedDays: 0, alreadySkipped: true }),
      });
    }

    if (result.status === "limit_reached") {
      const projectedDay = result.day
        ? buildProjectedOpenDayForClient(result.subscription, date, result.day)
        : buildProjectedOpenDayForClient(result.subscription, date);
      return buildSuccessResult(200, {
        day: localizeWriteDayPayload(projectedDay, { lang }),
        requestedDays: 1,
        appliedDays: 0,
        remainingSkipDays,
        compensatedDaysAdded: 0,
        message: buildSingleSkipMessage({ appliedDays: 0, dueToLimit: true }),
      });
    }

    if (result.status !== "skipped") {
      return buildErrorResult(400, "INVALID", "Skip failed");
    }

    await writeLogSafelyFn({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "skip",
      byUserId: userId,
      byRole: "client",
      meta: {
        date: result.day.date,
        compensated: true,
        compensatedDaysAdded: Number(result.compensatedDaysAdded || 0),
      },
    }, { subscriptionId, date: result.day.date });

    return buildSuccessResult(200, {
      day: localizeWriteDayPayload(result.day, { lang }),
      requestedDays: 1,
      appliedDays: 1,
      remainingSkipDays,
      compensatedDaysAdded: Number(result.compensatedDaysAdded || 0),
      message: buildSingleSkipMessage({ appliedDays: 1 }),
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Skip failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Skip failed");
  }
}

async function unskipDayForClient({
  subscriptionId,
  date,
  userId,
  lang,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  writeLogSafelyFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActiveFn(sub, date);
    await validateFutureDateOrThrowFn(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
  }

  try {
    await assertTomorrowCutoffAllowed({
      action: CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE,
      date,
    });
  } catch (err) {
    return buildErrorResult(400, err.code || "CUTOFF_PASSED_FOR_TOMORROW", err.message);
  }

  try {
    const result = await performUnskipDay({
      userId,
      subscriptionId,
      date,
    });

    const responseDay = result.day.toObject ? result.day.toObject() : { ...result.day };
    delete responseDay.canonicalDayActionType;

    await writeLogSafelyFn({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "unskip",
      byUserId: userId,
      byRole: "client",
      meta: { date },
    }, { subscriptionId, date });

    return buildSuccessResult(200, localizeWriteDayPayload(responseDay, { lang }));
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Unskip failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Unskip failed");
  }
}

async function skipRangeForClient({
  subscriptionId,
  rangeRequest,
  userId,
  lang,
  writeLogSafelyFn,
}) {
  try {
    const result = await performSkipRange({
      userId,
      subscriptionId,
      rangeRequest,
      lang,
    });

    for (const item of result.skippedForLog) {
      await writeLogSafelyFn({
        entityType: "subscription_day",
        entityId: item.dayId,
        action: "skip",
        byUserId: userId,
        byRole: "client",
        meta: { date: item.date },
      }, { subscriptionId, date: item.date });
    }

    return buildSuccessResult(200, localizeSkipRangeSummary(result.summary, { lang }));
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Skip range failed", { subscriptionId, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Skip range failed");
  }
}

module.exports = {
  skipDayForClient,
  skipRangeForClient,
  unskipDayForClient,
};
