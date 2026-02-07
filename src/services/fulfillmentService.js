const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { canTransition } = require("../utils/state");

async function fulfillSubscriptionDay({ subscriptionId, date, dayId, session }) {
  const dayQuery = dayId ? { _id: dayId } : { subscriptionId, date };
  const day = await SubscriptionDay.findOne(dayQuery).session(session);

  if (!day) {
    return { ok: false, code: "NOT_FOUND", message: "Day not found" };
  }

  if (day.status === "skipped") {
    return { ok: false, code: "SKIPPED", message: "Cannot fulfill skipped day" };
  }

  // CR-02 FIX: Check already fulfilled with snapshot BEFORE any state transition
  if (day.status === "fulfilled" && day.fulfilledSnapshot && day.fulfilledSnapshot.deductedCredits !== undefined) {
    return { ok: true, alreadyFulfilled: true, day, deductedCredits: day.fulfilledSnapshot.deductedCredits };
  }

  if (!canTransition(day.status, "fulfilled")) {
    return { ok: false, code: "INVALID_TRANSITION", message: "Invalid state transition" };
  }

  const sub = await Subscription.findById(day.subscriptionId).populate("planId").session(session);
  if (!sub) {
    return { ok: false, code: "NOT_FOUND", message: "Subscription not found" };
  }

  const mealsToDeduct = sub.planId.mealsPerDay;

  // CR-02 FIX: First update day to fulfilled with snapshot (idempotent)
  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { _id: day._id, status: { $ne: "fulfilled" } },
    {
      $set: {
        status: "fulfilled",
        fulfilledAt: new Date(),
        creditsDeducted: true,
        fulfilledSnapshot: {
          selections: day.selections,
          premiumSelections: day.premiumSelections,
          addonsOneTime: day.addonsOneTime,
          deductedCredits: mealsToDeduct,
        },
      },
    },
    { new: true, session }
  );

  if (!updatedDay) {
    // Already fulfilled - return existing state
    return { 
      ok: true, 
      alreadyFulfilled: true, 
      day, 
      deductedCredits: day.fulfilledSnapshot?.deductedCredits || 0 
    };
  }

  // CR-02 FIX: Only deduct credits if not already deducted
  if (day.creditsDeducted) {
    return { ok: true, day: updatedDay, deductedCredits: 0 };
  }

  // CR-02 FIX: Atomic credit deduction with conditional update
  const subUpdate = await Subscription.updateOne(
    { _id: sub._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct } },
    { session }
  );

  if (!subUpdate.modifiedCount) {
    // Should not happen if creditsDeducted check passed, but fail safely
    return { ok: false, code: "INSUFFICIENT_CREDITS", message: "Not enough credits" };
  }

  return { ok: true, day: updatedDay, deductedCredits: mealsToDeduct };
}

module.exports = { fulfillSubscriptionDay };
