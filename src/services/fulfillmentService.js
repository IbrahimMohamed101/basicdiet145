const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { canTransition } = require("../utils/state");
const { resolveMealsPerDay, resolveDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const { buildScopedCanonicalPlanningSnapshot } = require("./subscription/subscriptionDayPlanningService");
const { consumeSubscriptionDayCredits, resolveDayMealsToDeduct } = require("./subscription/subscriptionDayConsumptionService");

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

  const mealsToDeduct = resolveDayMealsToDeduct({ subscription: sub, day });
  const { premiumUpgradeSelections } = resolveDayWalletSelections({
    subscription: sub,
    day,
  });
  const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
    subscription: sub,
    day,
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  });
  const fulfilledSnapshot = {
    selections: day.selections,
    addonSelections: day.addonSelections || [],
    premiumUpgradeSelections,
    deductedCredits: mealsToDeduct,
    pickupCode: day.pickupCode || null,
    pickupVerifiedAt: day.pickupVerifiedAt || null,
    pickupVerifiedByDashboardUserId: day.pickupVerifiedByDashboardUserId || null,
    pickupNoShowAt: day.pickupNoShowAt || null,
    pickupRequestedAt: day.pickupRequestedAt || null,
    pickupPreparationStartedAt: day.pickupPreparationStartedAt || null,
    pickupPreparedAt: day.pickupPreparedAt || null,
    dayEndConsumptionReason: day.dayEndConsumptionReason || null,
  };
  if (planningSnapshot) {
    fulfilledSnapshot.planning = planningSnapshot;
  }

  // CR-02 FIX: First update day to fulfilled with snapshot (idempotent)
  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { _id: day._id, status: { $ne: "fulfilled" } },
    {
      $set: {
        status: "fulfilled",
        fulfilledAt: new Date(),
        pickupRequested: false,
        pickupPreparedAt: day.pickupPreparedAt || new Date(),
        premiumUpgradeSelections,
        fulfilledSnapshot,
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

  if (day.creditsDeducted) {
    return { ok: true, day: updatedDay, deductedCredits: 0 };
  }

  try {
    const consumption = await consumeSubscriptionDayCredits({
      day: updatedDay,
      subscription: sub,
      session,
      reason: "fulfilled",
    });
    await updatedDay.save({ session });
    return { ok: true, day: updatedDay, deductedCredits: consumption.deductedCredits };
  } catch (err) {
    if (err.code === "INSUFFICIENT_CREDITS") {
      return { ok: false, code: "INSUFFICIENT_CREDITS", message: "Not enough credits" };
    }
    throw err;
  }
}

module.exports = { fulfillSubscriptionDay };
