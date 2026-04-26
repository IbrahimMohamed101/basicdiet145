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

module.exports = {
  consumeSubscriptionDayCredits,
  resolveDayMealsToDeduct,
};
