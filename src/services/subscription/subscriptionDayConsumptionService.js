"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");

function resolveDayMealsToDeduct({ subscription, day }) {
  // 1. fulfilledSnapshot.deductedCredits if present > 0
  const explicitDeductedCredits = Number(day?.fulfilledSnapshot?.deductedCredits || 0);
  if (Number.isFinite(explicitDeductedCredits) && explicitDeductedCredits > 0) {
    return Math.floor(explicitDeductedCredits);
  }

  // 2. materializedMeals count if present > 0
  const materializedCount = Array.isArray(day?.materializedMeals) ? day.materializedMeals.filter(Boolean).length : 0;
  if (materializedCount > 0) return materializedCount;

  // 3. complete mealSlots count if present > 0
  const completeSlotCount = Array.isArray(day?.mealSlots)
    ? day.mealSlots.filter((slot) => slot && slot.status === "complete").length
    : 0;
  if (completeSlotCount > 0) return completeSlotCount;

  // 4. planningMeta.selectedTotalMealCount or plannerMeta.completeSlotCount if present > 0
  const selectedTotalMealCount = Number(day?.planningMeta?.selectedTotalMealCount || day?.plannerMeta?.completeSlotCount || 0);
  if (Number.isFinite(selectedTotalMealCount) && selectedTotalMealCount > 0) {
    return Math.floor(selectedTotalMealCount);
  }

  // 5. lockedSnapshot.requiredMealCount if present > 0
  const requiredMealCount = Number(day?.lockedSnapshot?.requiredMealCount || 0);
  if (Number.isFinite(requiredMealCount) && requiredMealCount > 0) {
    return Math.floor(requiredMealCount);
  }

  // 6. lockedSnapshot.mealsPerDay only as fallback
  const snapshotMealsPerDay = Number(day?.lockedSnapshot?.mealsPerDay || 0);
  if (Number.isFinite(snapshotMealsPerDay) && snapshotMealsPerDay > 0) {
    return Math.floor(snapshotMealsPerDay);
  }

  // 7. resolveMealsPerDay(subscription) only as final fallback
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
    const guardedDay = await SubscriptionDay.findOneAndUpdate(
      { _id: day._id, creditsDeducted: { $ne: true } },
      { $set: { creditsDeducted: true } },
      { new: true, session }
    );
    if (!guardedDay) {
      day.creditsDeducted = true;
      return {
        deductedCredits: 0,
        alreadyDeducted: true,
        reason,
      };
    }
    day.creditsDeducted = true;
    return {
      deductedCredits: 0,
      alreadyDeducted: false,
      reason,
    };
  }

  const guardedDay = await SubscriptionDay.findOneAndUpdate(
    { _id: day._id, creditsDeducted: { $ne: true } },
    { $set: { creditsDeducted: true } },
    { new: true, session }
  );

  if (!guardedDay) {
    day.creditsDeducted = true;
    return {
      deductedCredits: 0,
      alreadyDeducted: true,
      reason,
    };
  }

  const updateResult = await Subscription.updateOne(
    { _id: subscription._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct } },
    { session }
  );

  if (!updateResult.modifiedCount) {
    // A safe-session on standalone MongoDB does not provide rollback. Always
    // compensate the guard so a failed debit cannot masquerade as consumption.
    await SubscriptionDay.updateOne(
      { _id: day._id },
      { $set: { creditsDeducted: false } },
      session ? { session } : {}
    );
    day.creditsDeducted = false;
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

  // Re-read subscription to get actual remainingMeals after atomic update
  const updatedSubscription = await SubscriptionModel.findById(resolvedId)
    .select("remainingMeals")
    .session(session || null)
    .lean();

  if (!updatedSubscription) {
    const err = new Error("Subscription not found after successful update - data consistency issue");
    err.code = "SUBSCRIPTION_NOT_FOUND_AFTER_UPDATE";
    throw err;
  }

  const remainingMealsAfter = Number(updatedSubscription.remainingMeals || 0);
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
