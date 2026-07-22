const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const { canTransitionStatus } = require("./dashboard/opsTransitionPolicy");
const { resolveMealsPerDay, resolveDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const { buildScopedCanonicalPlanningSnapshot } = require("./subscription/subscriptionDayPlanningService");
const { consumeSubscriptionDayCredits, resolveDayMealsToDeduct } = require("./subscription/subscriptionDayConsumptionService");
const { consumeReservedPickupMeals } = require("./subscription/subscriptionPickupRequestBalanceService");
const { transitionDayEntitlements } = require("./subscription/subscriptionMealEntitlementService");

async function fulfillSubscriptionDay({ subscriptionId, date, dayId, session }) {
  const dayQuery = dayId ? { _id: dayId } : { subscriptionId, date };
  const day = await SubscriptionDay.findOne(dayQuery).session(session);

  if (!day) {
    return { ok: false, code: "NOT_FOUND", message: "Day not found" };
  }

  if (day.status === "skipped") {
    return { ok: false, code: "SKIPPED", message: "Cannot fulfill skipped day" };
  }

  if (day.status === "fulfilled" && day.creditsDeducted) {
    return { ok: true, alreadyFulfilled: true, day, deductedCredits: day.fulfilledSnapshot?.deductedCredits || 0 };
  }

  if (day.status !== "fulfilled" && !canTransitionStatus("subscription", day.status, "fulfilled")) {
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

  // Pickup requests reserve their base meals when the request is created. The
  // linked day therefore projects that same settlement instead of debiting the
  // subscription a second time.
  let entitlementSettlement = null;
  try {
    entitlementSettlement = await transitionDayEntitlements({
      subscriptionId: sub._id,
      day,
      toState: "consumed",
      session,
    });
  } catch (err) {
    return { ok: false, code: err.code || "CONSUMPTION_FAILED", message: err.message || "Entitlement consumption failed" };
  }
  if (entitlementSettlement.handled && !day.creditsDeducted) {
    await SubscriptionDay.updateOne(
      { _id: day._id, creditsDeducted: { $ne: true } },
      { $set: { creditsDeducted: true } },
      session ? { session } : {}
    );
    day.creditsDeducted = true;
  }

  let pickupSettlement = null;
  if (!entitlementSettlement.handled && (sub.deliveryMode === "pickup" || day.pickupRequested)) {
    const pickupRequest = await SubscriptionPickupRequest.findOne({
      subscriptionId: day.subscriptionId,
      date: day.date,
      creditsReserved: true,
      creditsReleasedAt: null,
    }).session(session);
    if (pickupRequest) {
      pickupSettlement = await consumeReservedPickupMeals({
        pickupRequestId: pickupRequest._id,
        session,
      });
      if (!day.creditsDeducted) {
        await SubscriptionDay.updateOne(
          { _id: day._id, creditsDeducted: { $ne: true } },
          { $set: { creditsDeducted: true } },
          session ? { session } : {}
        );
        day.creditsDeducted = true;
      }
    }
  }

  let consumption = entitlementSettlement.handled
    ? { deductedCredits: entitlementSettlement.changedCount, alreadyDeducted: entitlementSettlement.changedCount === 0 }
    : pickupSettlement
    ? { deductedCredits: 0, alreadyDeducted: Boolean(pickupSettlement.alreadyConsumed) }
    : null;
  if (!day.creditsDeducted) {
    try {
      consumption = await consumeSubscriptionDayCredits({
        day,
        subscription: sub,
        session,
        reason: "fulfilled",
      });
    } catch (err) {
      if (err.code === "INSUFFICIENT_CREDITS") {
        return { ok: false, code: "INSUFFICIENT_CREDITS", message: "Not enough credits" };
      }
      throw err;
    }
  }

  const updatedDay = day.status === "fulfilled"
    ? day
    : await SubscriptionDay.findOneAndUpdate(
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
    const currentDay = await SubscriptionDay.findById(day._id).session(session);
    if (currentDay && currentDay.creditsDeducted) {
      return {
        ok: true,
        alreadyFulfilled: true,
        day: currentDay,
        deductedCredits: 0,
      };
    }

    return {
      ok: true,
      alreadyFulfilled: Boolean(consumption && consumption.alreadyDeducted),
      day: currentDay || day,
      deductedCredits: consumption ? consumption.deductedCredits : 0,
    };
  }

  if (updatedDay.creditsDeducted) {
    return {
      ok: true,
      alreadyFulfilled: true,
      day: updatedDay,
      deductedCredits: 0,
    };
  }

  return {
    ok: true,
    alreadyFulfilled: Boolean(consumption && consumption.alreadyDeducted),
    day: updatedDay,
    deductedCredits: consumption ? consumption.deductedCredits : 0,
  };
}

async function fulfillSubscriptionPickupRequest({ requestId, actorId = null, session }) {
  const pickupRequest = await SubscriptionPickupRequest.findById(requestId).session(session);
  if (!pickupRequest) {
    return { ok: false, code: "NOT_FOUND", message: "Pickup request not found" };
  }

  if (pickupRequest.status === "fulfilled" && pickupRequest.creditsConsumedAt) {
    return {
      ok: true,
      alreadyFulfilled: true,
      pickupRequest,
      consumedCredits: 0,
    };
  }

  if (pickupRequest.status !== "ready_for_pickup" && pickupRequest.status !== "fulfilled") {
    return { ok: false, code: "INVALID_TRANSITION", message: "Invalid pickup request state transition" };
  }

  if (pickupRequest.creditsReleasedAt) {
    return { ok: false, code: "CREDITS_RELEASED", message: "Reserved pickup credits were already released" };
  }

  // Railway may use standalone MongoDB, where a session has no rollback boundary.
  // Consume the single-document entitlement ledger first. Every allocation
  // transition is compare-and-set/idempotent, so a retry can safely complete the
  // request projection without ever exposing a fulfilled request with unpaid debt.
  let consumption;
  try {
    consumption = await consumeReservedPickupMeals({
      pickupRequestId: pickupRequest._id,
      session,
    });
  } catch (err) {
    return {
      ok: false,
      code: err.code || "CONSUMPTION_FAILED",
      message: err.message || "Pickup request consumption failed",
    };
  }

  const now = new Date();
  const updated = await SubscriptionPickupRequest.findOneAndUpdate(
    {
      _id: pickupRequest._id,
      status: { $in: ["ready_for_pickup", "fulfilled"] },
      creditsConsumedAt: { $ne: null },
      creditsReleasedAt: null,
    },
    {
      $set: {
        status: "fulfilled",
        fulfilledAt: pickupRequest.fulfilledAt || now,
        fulfilledByDashboardUserId: actorId || pickupRequest.fulfilledByDashboardUserId || null,
        settlementReason: "fulfilled_consumed",
        settlementBy: actorId ? String(actorId) : "dashboard",
        settledAt: now,
      },
    },
    { new: true, session }
  );

  if (!updated) {
    const current = await SubscriptionPickupRequest.findById(pickupRequest._id).session(session);
    if (current && current.status === "fulfilled" && current.creditsConsumedAt) {
      return {
        ok: true,
        alreadyFulfilled: true,
        pickupRequest: current,
        consumedCredits: 0,
      };
    }
    return {
      ok: false,
      code: "DATA_INTEGRITY_ERROR",
      message: "Pickup credits were consumed but the request projection could not be finalized",
    };
  }

  return {
    ok: true,
    alreadyFulfilled: Boolean(consumption.alreadyConsumed),
    pickupRequest: updated,
    consumedCredits: consumption.consumed ? Number(consumption.mealCount || 0) : 0,
  };
}

module.exports = { fulfillSubscriptionDay, fulfillSubscriptionPickupRequest };
