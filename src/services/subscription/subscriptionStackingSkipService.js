"use strict";

const {
  releaseDayExtraSelectionsTransactional,
  reopenDayExtraSelectionsTransactional,
} = require("./subscriptionStackingExtraSelectionLifecycleService");

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const {
  getRestaurantBusinessDate,
  getRestaurantBusinessTomorrow,
} = require("../restaurantHoursService");
const {
  resolveSubscriptionSkipPolicy,
} = require("./subscriptionContractReadService");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("./subscriptionCutoffPolicyService");
const {
  applyStackingCompensationTransactional,
  revokeStackingCompensationTransactional,
} = require("./subscriptionStackingCompensationService");
const {
  reopenStackingDayEntitlementsTransactional,
  transitionStackingDayEntitlementsTransactional,
} = require("./subscriptionStackingFulfillmentLedgerService");

function skipError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeDate(value) {
  const date = String(value || "").trim();
  if (!dateUtils.isValidKSADateString(date)) {
    throw skipError("INVALID_DATE", "date must use YYYY-MM-DD", 400, { date: value });
  }
  return date;
}

function plainValue(value) {
  if (!value) return null;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
}

function mergeLifecycleSubscription(lifecycle, subscription) {
  const lifecycleContainer = lifecycle && lifecycle.container
    ? plainValue(lifecycle.container)
    : null;
  const currentSubscription = plainValue(subscription) || {};
  if (!lifecycleContainer) return subscription;
  return {
    ...lifecycleContainer,
    skipDaysUsed: Number(currentSubscription.skipDaysUsed || 0),
  };
}

function assertOwnedActiveSubscription(subscription, userId, date) {
  if (!subscription) throw skipError("NOT_FOUND", "Subscription not found", 404);
  if (String(subscription.userId || "") !== String(userId || "")) {
    throw skipError("FORBIDDEN", "Forbidden", 403);
  }
  if (String(subscription.status || "") !== "active") {
    throw skipError("SUB_INACTIVE", "Subscription not active", 422);
  }
  const startDate = subscription.startDate
    ? dateUtils.toKSADateString(subscription.startDate)
    : "";
  const end = subscription.validityEndDate || subscription.endDate;
  const endDate = end ? dateUtils.toKSADateString(end) : "";
  if (startDate && date < startDate) {
    throw skipError("SUB_NOT_STARTED", "Date is before subscription start", 422);
  }
  if (endDate && date > endDate) {
    throw skipError("SUB_EXPIRED", "Subscription expired for this date", 422);
  }
}

function assertSkipPolicyAvailable(policy, subscription) {
  if (!policy || policy.enabled !== true) {
    throw skipError("SKIP_DISABLED", "Skip is disabled for this plan", 422);
  }
  const maxDays = Math.max(0, Number(policy.maxDays || 0));
  const usedDays = Math.max(0, Number(subscription && subscription.skipDaysUsed || 0));
  if (maxDays < 1 || usedDays >= maxDays) {
    throw skipError(
      "PLAN_LIMIT_REACHED",
      "Skip day limit reached",
      422,
      { maxDays, usedDays, remainingDays: Math.max(0, maxDays - usedDays) }
    );
  }
  return { maxDays, usedDays };
}

function assertDateCanChange({ date, tomorrow }) {
  const targetDate = normalizeDate(date);
  const tomorrowDate = normalizeDate(tomorrow);
  if (targetDate < tomorrowDate) {
    throw skipError(
      "INVALID_DATE",
      "date must be from tomorrow onward",
      400,
      { date: targetDate, tomorrow: tomorrowDate }
    );
  }
}

function assertDayCanBeSkipped(day) {
  if (!day) return;
  if (day.status === "skipped") return;
  if (day.status === "frozen") {
    throw skipError("DAY_FROZEN", "Frozen day cannot be skipped", 409);
  }
  if (day.status === "fulfilled") {
    throw skipError("DAY_FULFILLED", "Fulfilled day cannot be skipped", 409);
  }
  if (day.status !== "open") {
    throw skipError("LOCKED", "Day is locked", 409, { status: day.status });
  }
  if (
    day.lockedSnapshot
    || day.fulfilledSnapshot
    || day.fulfilledAt
    || day.assignedByKitchen
    || day.pickupRequested
  ) {
    throw skipError("LOCKED", "Processed day cannot be skipped", 409);
  }
}

function assertDayCanBeUnskipped(day) {
  if (!day) throw skipError("NOT_FOUND", "Day not found", 404);
  if (day.status !== "skipped") {
    throw skipError(
      "INVALID_TRANSITION",
      "Invalid state transition: Day is not skipped",
      409
    );
  }
  if (!day.skipCompensated) {
    throw skipError(
      "STACKING_SKIP_COMPENSATION_MISSING",
      "Stacked skipped day is missing compensation metadata",
      409
    );
  }
  if (
    day.lockedSnapshot
    || day.fulfilledSnapshot
    || day.fulfilledAt
    || day.assignedByKitchen
    || day.pickupRequested
  ) {
    throw skipError(
      "INVALID_TRANSITION",
      "Invalid state transition: Cannot unskip a processed day",
      409
    );
  }
}

function defaultRuntime() {
  return {
    startSession: () => startSafeSession(),
    getBusinessDate: () => getRestaurantBusinessDate(),
    getTomorrow: () => getRestaurantBusinessTomorrow(),
    assertCutoff: (options) => assertTomorrowCutoffAllowed(options),
    findSubscription({ subscriptionId, session }) {
      return Subscription.findById(subscriptionId).populate("planId").session(session);
    },
    findDay({ subscriptionId, date, session }) {
      return SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    },
    resolveSkipPolicy(subscription) {
      return resolveSubscriptionSkipPolicy(subscription, subscription.planId, {
        context: "stacking_skip_day",
      });
    },
    releaseDay: (args) => transitionStackingDayEntitlementsTransactional(args),
    reopenDay: (args) => reopenStackingDayEntitlementsTransactional(args),
    releaseExtras: (args) => releaseDayExtraSelectionsTransactional(args),
    reopenExtras: (args) => reopenDayExtraSelectionsTransactional(args),
    applyCompensation: (args) => applyStackingCompensationTransactional(args),
    revokeCompensation: (args) => revokeStackingCompensationTransactional(args),
    incrementSkipUsage({ subscription, maxDays, session }) {
      return Subscription.findOneAndUpdate(
        {
          _id: subscription._id,
          status: "active",
          $or: [
            { skipDaysUsed: { $lt: maxDays } },
            { skipDaysUsed: { $exists: false } },
          ],
        },
        { $inc: { skipDaysUsed: 1 } },
        { new: true, session }
      );
    },
    decrementSkipUsage({ subscription, session }) {
      return Subscription.findOneAndUpdate(
        { _id: subscription._id, status: "active", skipDaysUsed: { $gte: 1 } },
        { $inc: { skipDaysUsed: -1 } },
        { new: true, session }
      );
    },
    createSkippedDay({ subscriptionId, date, session }) {
      return SubscriptionDay.create([
        {
          subscriptionId,
          date,
          status: "skipped",
          skippedByUser: true,
          skipCompensated: true,
          creditsDeducted: false,
          canonicalDayActionType: "skip",
        },
      ], { session }).then((rows) => rows[0]);
    },
    markDaySkipped({ day, session }) {
      return SubscriptionDay.findOneAndUpdate(
        { _id: day._id, status: "open" },
        {
          $set: {
            status: "skipped",
            skippedByUser: true,
            skipCompensated: true,
            creditsDeducted: false,
            canonicalDayActionType: "skip",
          },
        },
        { new: true, session }
      );
    },
    markDayOpen({ day, session }) {
      return SubscriptionDay.findOneAndUpdate(
        { _id: day._id, status: "skipped", skipCompensated: true },
        {
          $set: {
            status: "open",
            skippedByUser: false,
            skipCompensated: false,
            creditsDeducted: false,
          },
          $unset: { canonicalDayActionType: 1 },
        },
        { new: true, session }
      );
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function performStackingSkipDay({
  userId,
  subscriptionId,
  date,
  runtime: runtimeOverrides = null,
} = {}) {
  const targetDate = normalizeDate(date);
  const runtime = resolveRuntime(runtimeOverrides);
  const tomorrow = await runtime.getTomorrow();
  assertDateCanChange({ date: targetDate, tomorrow });
  await runtime.assertCutoff({ action: CUTOFF_ACTIONS.SKIP_DAY_CHANGE, date: targetDate });

  const session = await runtime.startSession();
  session.startTransaction();
  try {
    let subscription = await runtime.findSubscription({ subscriptionId, session });
    assertOwnedActiveSubscription(subscription, userId, targetDate);
    const day = await runtime.findDay({ subscriptionId, date: targetDate, session });
    assertDayCanBeSkipped(day);
    const policy = runtime.resolveSkipPolicy(subscription);

    if (day && day.status === "skipped") {
      const businessDate = await runtime.getBusinessDate();
      const released = await runtime.releaseDay({
        containerSubscriptionId: subscriptionId,
        day,
        toState: "released",
        businessDate,
        session,
      });
      const extrasReleased = day.stackingExtraSelectionState
        ? await runtime.releaseExtras({
          userId,
          containerSubscriptionId: subscriptionId,
          day,
          session,
        })
        : null;
      const compensation = await runtime.applyCompensation({
        containerSubscriptionId: subscriptionId,
        userId,
        sourceDate: targetDate,
        sourceDayId: day._id,
        actionType: "skip",
        businessDate,
        session,
      });
      await session.commitTransaction();
      await session.endSession();
      return {
        status: "already_skipped",
        day,
        policy,
        subscription: mergeLifecycleSubscription(compensation.lifecycle, subscription),
        compensatedDaysAdded: 0,
        idempotent: true,
        stacking: { released, extrasReleased, compensation },
      };
    }

    const { maxDays } = assertSkipPolicyAvailable(policy, subscription);
    const businessDate = await runtime.getBusinessDate();
    const released = await runtime.releaseDay({
      containerSubscriptionId: subscriptionId,
      day: day || { date: targetDate },
      toState: "released",
      businessDate,
      session,
    });
    const extrasReleased = day && day.stackingExtraSelectionState
      ? await runtime.releaseExtras({
        userId,
        containerSubscriptionId: subscriptionId,
        day,
        session,
      })
      : null;
    const compensation = await runtime.applyCompensation({
      containerSubscriptionId: subscriptionId,
      userId,
      sourceDate: targetDate,
      sourceDayId: day && day._id || null,
      actionType: "skip",
      businessDate,
      session,
    });
    subscription = await runtime.incrementSkipUsage({
      subscription,
      maxDays,
      session,
    });
    if (!subscription) {
      throw skipError("PLAN_LIMIT_REACHED", "Skip day limit reached", 422);
    }

    const updatedDay = day
      ? await runtime.markDaySkipped({ day, session })
      : await runtime.createSkippedDay({
        subscriptionId,
        date: targetDate,
        session,
      });
    if (!updatedDay) {
      throw skipError(
        "STACKING_SKIP_DAY_CONFLICT",
        "Day changed while skip was being applied",
        409
      );
    }

    await session.commitTransaction();
    await session.endSession();
    return {
      status: "skipped",
      day: updatedDay,
      policy,
      subscription: mergeLifecycleSubscription(compensation.lifecycle, subscription),
      compensatedDaysAdded: 1,
      idempotent: false,
      stacking: { released, extrasReleased, compensation },
    };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
    throw err;
  }
}

async function performStackingUnskipDay({
  userId,
  subscriptionId,
  date,
  runtime: runtimeOverrides = null,
} = {}) {
  const targetDate = normalizeDate(date);
  const runtime = resolveRuntime(runtimeOverrides);
  const tomorrow = await runtime.getTomorrow();
  assertDateCanChange({ date: targetDate, tomorrow });
  await runtime.assertCutoff({ action: CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE, date: targetDate });

  const session = await runtime.startSession();
  session.startTransaction();
  try {
    let subscription = await runtime.findSubscription({ subscriptionId, session });
    assertOwnedActiveSubscription(subscription, userId, targetDate);
    const day = await runtime.findDay({ subscriptionId, date: targetDate, session });
    assertDayCanBeUnskipped(day);
    const businessDate = await runtime.getBusinessDate();

    const reopened = await runtime.reopenDay({
      containerSubscriptionId: subscriptionId,
      day,
      businessDate,
      session,
    });
    const extrasReopened = day.stackingExtraSelectionState
      ? await runtime.reopenExtras({
        userId,
        containerSubscriptionId: subscriptionId,
        day,
        businessDate: targetDate,
        session,
      })
      : null;
    const compensation = await runtime.revokeCompensation({
      containerSubscriptionId: subscriptionId,
      userId,
      sourceDate: targetDate,
      actionType: "skip",
      businessDate,
      session,
    });
    if (
      compensation.idempotent
      || !Array.isArray(compensation.tokenResults)
      || compensation.tokenResults.length === 0
    ) {
      throw skipError(
        "STACKING_SKIP_COMPENSATION_MISSING",
        "Skipped day has no active batch compensation to revoke",
        409,
        { date: targetDate }
      );
    }

    subscription = await runtime.decrementSkipUsage({ subscription, session });
    if (!subscription) {
      throw skipError(
        "DATA_INTEGRITY_ERROR",
        "Cannot restore this skipped day because skip usage is inconsistent",
        409
      );
    }
    const updatedDay = await runtime.markDayOpen({ day, session });
    if (!updatedDay) {
      throw skipError(
        "STACKING_UNSKIP_DAY_CONFLICT",
        "Day changed while unskip was being applied",
        409
      );
    }

    await session.commitTransaction();
    await session.endSession();
    return {
      day: updatedDay,
      subscription: mergeLifecycleSubscription(compensation.lifecycle, subscription),
      idempotent: false,
      stacking: { reopened, extrasReopened, compensation },
    };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
    throw err;
  }
}

module.exports = {
  assertDateCanChange,
  assertDayCanBeSkipped,
  assertDayCanBeUnskipped,
  assertOwnedActiveSubscription,
  assertSkipPolicyAvailable,
  mergeLifecycleSubscription,
  performStackingSkipDay,
  performStackingUnskipDay,
};
