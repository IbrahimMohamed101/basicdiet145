"use strict";

const Subscription = require("../../models/Subscription");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");

function resolveDayMealsToDeduct({ subscription, day }) {
  const fromSnapshot = Number(day?.lockedSnapshot?.mealsPerDay || day?.fulfilledSnapshot?.deductedCredits || 0);
  if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) {
    return Math.floor(fromSnapshot);
  }
  return Math.max(0, Math.floor(Number(resolveMealsPerDay(subscription)) || 0));
}

async function consumeSubscriptionDayCredits({
  day,
  subscription,
  session,
  reason = "consumed",
} = {}) {
  if (!day || !subscription) {
    const err = new Error("Day and subscription are required");
    err.code = "INVALID_ARGUMENTS";
    throw err;
  }

  if (day.creditsDeducted) {
    return {
      deductedCredits: 0,
      alreadyDeducted: true,
      reason,
    };
  }

  const mealsToDeduct = resolveDayMealsToDeduct({ subscription, day });
  if (mealsToDeduct <= 0) {
    day.creditsDeducted = true;
    return {
      deductedCredits: 0,
      alreadyDeducted: false,
      reason,
    };
  }

  const updateResult = await Subscription.updateOne(
    { _id: subscription._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct } },
    { session }
  );

  if (!updateResult.modifiedCount) {
    const err = new Error("Not enough credits");
    err.code = "INSUFFICIENT_CREDITS";
    throw err;
  }

  day.creditsDeducted = true;

  return {
    deductedCredits: mealsToDeduct,
    alreadyDeducted: false,
    reason,
  };
}

/**
 * consumeSubscriptionMealBalance — Count-based meal deduction for cashier/manual consumption.
 *
 * Unlike consumeSubscriptionDayCredits (which is day-based and tied to mealsPerDay),
 * this function:
 *   - Takes only a raw mealCount
 *   - Does NOT cap by mealsPerDay
 *   - Does NOT require a SubscriptionDay document
 *   - Writes SubscriptionAuditLog and ActivityLog
 *   - Returns { remainingMealsBefore, remainingMealsAfter, mealCount, deducted: true }
 *
 * All deductions for cashier/restaurant/manual consumption MUST go through this function.
 */
async function consumeSubscriptionMealBalance({
  subscriptionId,
  subscription: passedSubscription = null,
  mealCount,
  source = "cashier_dashboard",
  actor = null,
  reason = "cashier_manual_consumption",
  note = null,
  session = null,
} = {}) {
  if (!Number.isInteger(mealCount) || mealCount <= 0) {
    const err = new Error("mealCount must be a positive integer");
    err.code = "INVALID_MEAL_COUNT";
    throw err;
  }

  const resolvedId = subscriptionId || (passedSubscription && passedSubscription._id);
  if (!resolvedId) {
    const err = new Error("subscriptionId is required");
    err.code = "INVALID_ARGUMENTS";
    throw err;
  }

  // Fetch the current remainingMeals before deduction for audit purposes.
  // We need the live value, not a stale snapshot.
  const SubscriptionModel = require("../../models/Subscription");
  const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
  const ActivityLog = require("../../models/ActivityLog");

  const subForAudit = passedSubscription
    || await (session
      ? SubscriptionModel.findById(resolvedId).session(session).lean()
      : SubscriptionModel.findById(resolvedId).lean());

  if (!subForAudit) {
    const err = new Error("Subscription not found");
    err.code = "SUBSCRIPTION_NOT_FOUND";
    throw err;
  }

  const remainingMealsBefore = Number(subForAudit.remainingMeals || 0);

  const updateResult = await SubscriptionModel.updateOne(
    { _id: resolvedId, remainingMeals: { $gte: mealCount } },
    { $inc: { remainingMeals: -mealCount } },
    session ? { session } : {}
  );

  if (!updateResult.modifiedCount) {
    const err = new Error("Insufficient meal balance for this subscription");
    err.code = "INSUFFICIENT_CREDITS";
    throw err;
  }

  const remainingMealsAfter = remainingMealsBefore - mealCount;
  const actorType = (actor && actor.actorType) || "dashboard";
  const actorId = (actor && actor.actorId) || undefined;

  const auditMeta = {
    mealCount,
    source,
    reason,
    remainingMealsBefore,
    remainingMealsAfter,
    note: note || undefined,
  };

  const auditCreateOpts = session ? { session } : {};

  await SubscriptionAuditLog.create([{
    entityType: "subscription",
    entityId: resolvedId,
    action: "cashier_manual_consumption",
    actorType,
    actorId,
    note: note || "Cashier manual meal consumption",
    meta: auditMeta,
  }], auditCreateOpts);

  await ActivityLog.create([{
    entityType: "subscription",
    entityId: resolvedId,
    action: "cashier_manual_consumption",
    byUserId: actorId,
    byRole: actorType,
    meta: auditMeta,
  }], auditCreateOpts);

  return {
    remainingMealsBefore,
    remainingMealsAfter,
    mealCount,
    source,
    deducted: true,
  };
}

module.exports = {
  consumeSubscriptionDayCredits,
  consumeSubscriptionMealBalance,
  resolveDayMealsToDeduct,
};

