const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { createLocalizedError } = require("../../utils/errorLocalization");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { resolveSubscriptionSkipPolicy } = require("./subscriptionContractReadService");
const { syncSubscriptionValidity, rollbackDaySkipMutation } = require("./subscriptionCompensationService");
const {
  CUTOFF_ACTIONS,
  evaluateTomorrowCutoffImpact,
} = require("./subscriptionCutoffPolicyService");
const { getRestaurantBusinessTomorrow } = require("../restaurantHoursService");

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    err.status = 422;
    throw err;
  }
  if (dateStr) {
    const endDate = subscription.validityEndDate || subscription.endDate;
    const endDateStr = endDate instanceof Date || typeof endDate === "number"
      ? dateUtils.toKSADateString(endDate)
      : endDate;
    if (endDateStr && dateUtils.isAfterKSADate(dateStr, endDateStr)) {
      const err = new Error("Subscription expired for this date");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

function resolveSkipRemainingDays(skipPolicy, subscription) {
  return Math.max(
    Number(skipPolicy && skipPolicy.maxDays ? skipPolicy.maxDays : 0) - Number(subscription && subscription.skipDaysUsed ? subscription.skipDaysUsed : 0),
    0
  );
}

function buildSkipRangeMessage(summary) {
  const requestedDays = Number(summary && summary.requestedDays ? summary.requestedDays : 0);
  const appliedDays = Number(summary && summary.appliedDays ? summary.appliedDays : 0);
  const alreadySkippedCount = Array.isArray(summary && summary.alreadySkipped) ? summary.alreadySkipped.length : 0;
  const rejected = Array.isArray(summary && summary.rejected) ? summary.rejected : [];
  const hasPlanLimitRejection = rejected.some((entry) => entry && entry.reason === "PLAN_LIMIT_REACHED");

  if (hasPlanLimitRejection) {
    return appliedDays > 0
      ? `Only ${appliedDays} day${appliedDays === 1 ? "" : "s"} applied due to plan limit`
      : "No days applied due to plan limit";
  }
  if (appliedDays === requestedDays && rejected.length === 0 && alreadySkippedCount === 0) {
    return `${appliedDays} day${appliedDays === 1 ? "" : "s"} applied`;
  }
  if (appliedDays === 0 && alreadySkippedCount > 0 && rejected.length === 0) {
    return "All requested days were already skipped";
  }
  return `Applied ${appliedDays} of ${requestedDays} requested day${requestedDays === 1 ? "" : "s"}`;
}

async function performSkipRange({
  userId,
  subscriptionId,
  rangeRequest,
  lang,
}) {
  const tomorrow = await getRestaurantBusinessTomorrow();
  const { startDate } = rangeRequest;

  if (!dateUtils.isOnOrAfterKSADate(startDate, tomorrow)) {
    throw { status: 400, code: "INVALID_DATE", message: "startDate must be from tomorrow onward" };
  }

  const summary = {
    requestedRange: {
      startDate: rangeRequest.startDate,
      endDate: rangeRequest.endDate,
      days: rangeRequest.days,
    },
    requestedDays: rangeRequest.days,
    appliedDays: 0,
    remainingSkipDays: 0,
    compensatedDaysAdded: 0,
    appliedDates: [],
    alreadySkipped: [],
    rejected: [],
    message: "",
  };
  const skippedForLog = [];

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(subscriptionId).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }

    if (String(subInSession.userId) !== String(userId)) {
      await session.abortTransaction();
      session.endSession();
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }

    try {
      ensureActive(subInSession, startDate);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

    const skipPolicy = resolveSubscriptionSkipPolicy(subInSession, subInSession.planId, {
      context: "skip_range",
    });
    if (!skipPolicy.enabled) {
      await session.abortTransaction();
      session.endSession();
      throw { status: 422, code: "SKIP_DISABLED", message: "Skip is disabled for this plan" };
    }

    const baseEndDate = subInSession.validityEndDate || subInSession.endDate;
    let appliedAny = false;

    for (const dateStr of rangeRequest.targetDates) {
      if (!dateUtils.isOnOrAfterKSADate(dateStr, tomorrow)) {
        summary.rejected.push({ date: dateStr, reason: "BEFORE_TOMORROW" });
        continue;
      }
      if (!dateUtils.isInSubscriptionRange(dateStr, baseEndDate)) {
        summary.rejected.push({ date: dateStr, reason: "OUTSIDE_VALIDITY" });
        continue;
      }
      const cutoffImpact = await evaluateTomorrowCutoffImpact({
        action: CUTOFF_ACTIONS.SKIP_RANGE_CHANGE,
        date: dateStr,
      });
      if (!cutoffImpact.allowed) {
        summary.rejected.push({ date: dateStr, reason: "CUTOFF_PASSED" });
        continue;
      }

      const result = await applyCompensatedSkipForDate({
        sub: subInSession,
        date: dateStr,
        session,
        syncValidityAfterApply: false,
      });
      if (result.status === "already_skipped") {
        summary.alreadySkipped.push(dateStr);
        continue;
      }
      if (result.status === "frozen") {
        summary.rejected.push({ date: dateStr, reason: "FROZEN" });
        continue;
      }
      if (result.status === "locked") {
        summary.rejected.push({ date: dateStr, reason: "LOCKED" });
        continue;
      }
      if (result.status === "limit_reached") {
        summary.rejected.push({ date: dateStr, reason: "PLAN_LIMIT_REACHED" });
        continue;
      }
      if (result.status !== "skipped") {
        summary.rejected.push({ date: dateStr, reason: "UNKNOWN" });
        continue;
      }

      appliedAny = true;
      summary.appliedDays += 1;
      summary.compensatedDaysAdded += Number(result.compensatedDaysAdded || 0);
      summary.appliedDates.push(dateStr);
      skippedForLog.push({ dayId: result.day._id, date: result.day.date });
    }

    if (appliedAny) {
      await syncSubscriptionValidity(subInSession, session);
    }

    summary.remainingSkipDays = resolveSkipRemainingDays(skipPolicy, subInSession);
    summary.message = buildSkipRangeMessage(summary);

    await session.commitTransaction();
    session.endSession();

    return {
      summary,
      skippedForLog,
    };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function applyCompensatedSkipForDate({
  sub,
  date,
  session,
  syncValidityAfterApply = true,
}) {
  const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

  const policy = resolveSubscriptionSkipPolicy(sub, sub.planId, {
    context: "apply_skip_for_date",
  });

  if (existingDay && existingDay.status === "skipped") {
    return { status: "already_skipped", day: existingDay, policy };
  }

  if (existingDay && existingDay.status === "frozen") {
    return { status: "frozen", day: existingDay, policy };
  }

  if (existingDay && existingDay.status === "fulfilled") {
    return { status: "fulfilled", day: existingDay, policy };
  }

  if (existingDay && existingDay.status !== "open") {
    return { status: "locked", day: existingDay, policy };
  }

  if (!policy.enabled) {
    return { status: "skip_disabled", policy };
  }

  if (!policy.maxDays) {
    return { status: "limit_reached", day: existingDay, policy };
  }

  let dayUpdateResult;
  if (!existingDay) {
    const created = await SubscriptionDay.create(
      [{
        subscriptionId: sub._id,
        date,
        status: "skipped",
        skippedByUser: true,
        skipCompensated: true,
        creditsDeducted: false,
        canonicalDayActionType: "skip",
      }],
      { session }
    );
    dayUpdateResult = created[0];
  } else {
    dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
      { _id: existingDay._id, status: "open" },
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
    if (!dayUpdateResult) {
      return { status: "locked", day: existingDay, policy };
    }
  }

  const updatedSubscription = await Subscription.findOneAndUpdate(
    {
      _id: sub._id,
      $or: [
        { skipDaysUsed: { $lt: policy.maxDays } },
        { skipDaysUsed: { $exists: false } },
      ],
    },
    { $inc: { skipDaysUsed: 1 } },
    { new: true, session }
  );

  if (!updatedSubscription) {
    await rollbackDaySkipMutation({
      dayId: dayUpdateResult._id,
      existingDay,
      session,
    });
    return { status: "limit_reached", day: existingDay, policy };
  }

  sub.skipDaysUsed = Number(updatedSubscription.skipDaysUsed || 0);

  let validitySync = null;
  if (syncValidityAfterApply) {
    validitySync = await syncSubscriptionValidity(sub, session);
  }

  return {
    status: "skipped",
    day: dayUpdateResult,
    policy,
    compensatedDaysAdded: 1,
    validitySync,
  };
}

async function applyOperationalSkipForDate({ sub, date, session }) {
  const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

  if (existingDay && existingDay.status === "skipped") {
    return { status: "already_skipped", day: existingDay };
  }

  if (existingDay && existingDay.status === "frozen") {
    return { status: "frozen", day: existingDay };
  }

  if (existingDay && existingDay.status === "fulfilled") {
    return { status: "fulfilled", day: existingDay };
  }

  const mealsToDeduct = resolveMealsPerDay(sub);

  let dayUpdateResult;
  if (!existingDay) {
    const created = await SubscriptionDay.create(
      [{
        subscriptionId: sub._id,
        date,
        status: "skipped",
        skippedByUser: false,
        skipCompensated: false,
        creditsDeducted: true,
        canonicalDayActionType: "skip",
      }],
      { session }
    );
    dayUpdateResult = created[0];
  } else {
    dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
      { _id: existingDay._id, status: { $ne: "fulfilled" } },
      {
        $set: {
          status: "skipped",
          skippedByUser: false,
          skipCompensated: false,
          creditsDeducted: true,
          canonicalDayActionType: "skip",
        },
      },
      { new: true, session }
    );
    if (!dayUpdateResult) {
      return { status: "fulfilled", day: existingDay };
    }
  }

  const updatedSubscription = await Subscription.findOneAndUpdate(
    { _id: sub._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct, skippedCount: 1 } },
    { new: true, session }
  );

  if (!updatedSubscription) {
    await rollbackDaySkipMutation({
      dayId: dayUpdateResult._id,
      existingDay,
      session,
    });
    return { status: "insufficient_credits" };
  }

  sub.remainingMeals = Number(updatedSubscription.remainingMeals || 0);
  sub.skippedCount = Number(updatedSubscription.skippedCount || 0);

  return { status: "skipped", day: dayUpdateResult };
}

  async function performSkipDay({ userId, subscriptionId, date }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const subInSession = await Subscription.findById(subscriptionId).populate("planId").session(session);
      if (!subInSession) {
        throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
      }

      if (String(subInSession.userId) !== String(userId)) {
        throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
      }

      if (subInSession.status !== "active") {
        throw { status: 422, code: "SUB_INACTIVE", message: "Subscription not active" };
      }

      ensureActive(subInSession, date);

      const result = await applyCompensatedSkipForDate({
        sub: subInSession,
        date,
        session,
        syncValidityAfterApply: true,
      });

      await session.commitTransaction();
      session.endSession();

      return {
        status: result.status,
        day: result.day,
        policy: result.policy,
        compensatedDaysAdded: result.compensatedDaysAdded,
        subscription: subInSession,
      };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw err;
    }
  }

  async function performUnskipDay({ userId, subscriptionId, date }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const subInSession = await Subscription.findById(subscriptionId).populate("planId").session(session);
      if (!subInSession) {
        throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
      }

      if (String(subInSession.userId) !== String(userId)) {
        throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
      }

      ensureActive(subInSession, date);

      const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
      if (!day) {
        throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
      }

      if (day.status !== "skipped") {
        throw { status: 409, code: "INVALID_TRANSITION", message: "Invalid state transition: Day is not skipped" };
      }

      if (day.lockedSnapshot || day.fulfilledSnapshot || day.fulfilledAt || day.assignedByKitchen || day.pickupRequested) {
        throw { status: 409, code: "INVALID_TRANSITION", message: "Invalid state transition: Cannot unskip a processed day" };
      }

      const isCompensatedSkip = Boolean(day.skipCompensated);

      if (isCompensatedSkip) {
        const updatedSubscription = await Subscription.findOneAndUpdate(
          { _id: subInSession._id, skipDaysUsed: { $gte: 1 } },
          { $inc: { skipDaysUsed: -1 } },
          { new: true, session }
        );
        if (!updatedSubscription) {
          throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot restore credits for this skipped day" };
        }
        subInSession.skipDaysUsed = Number(updatedSubscription.skipDaysUsed || 0);

        await SubscriptionDay.updateOne(
          { _id: day._id },
          {
            $set: { status: "open", skippedByUser: false, skipCompensated: false, creditsDeducted: false },
            $unset: { canonicalDayActionType: 1 },
          },
          { session }
        );

        await syncSubscriptionValidity(subInSession, session);
        day.status = "open";
        day.skippedByUser = false;
        day.skipCompensated = false;
        day.creditsDeducted = false;
      } else {
        if (!day.creditsDeducted) {
          throw { status: 409, code: "INVALID_TRANSITION", message: "Invalid state transition: Skipped day has no deducted credits to restore" };
        }

        const mealsToRestore = resolveMealsPerDay(subInSession);
        const restoredSub = await Subscription.findOneAndUpdate(
          {
            _id: subInSession._id,
            skippedCount: { $gte: 1 },
            remainingMeals: { $lte: Number(subInSession.totalMeals || 0) - mealsToRestore },
          },
          { $inc: { remainingMeals: mealsToRestore, skippedCount: -1 } },
          { new: true, session }
        );
        if (!restoredSub) {
          throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot restore credits for this skipped day" };
        }

        day.status = "open";
        day.skippedByUser = false;
        day.creditsDeducted = false;

        await SubscriptionDay.updateOne(
          { _id: day._id },
          {
            $set: { status: "open", skippedByUser: false, skipCompensated: false, creditsDeducted: false },
            $unset: { canonicalDayActionType: 1 },
          },
          { session }
        );
      }

      await session.commitTransaction();
      session.endSession();

      return { day };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw err;
    }
  }

module.exports = {
  applyOperationalSkipForDate,
  applySkipForDate: applyCompensatedSkipForDate,
  performSkipRange,
  performSkipDay,
  performUnskipDay,
  resolveSkipRemainingDays,
};
