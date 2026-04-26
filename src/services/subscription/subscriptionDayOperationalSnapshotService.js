"use strict";

const Setting = require("../../models/Setting");
const User = require("../../models/User");
const { buildLockedOperationalSnapshotDetails } = require("../../utils/delivery");
const { isPhase2CanonicalDayPlanningEnabled } = require("../../utils/featureFlags");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { buildScopedCanonicalPlanningSnapshot } = require("./subscriptionDayPlanningService");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");

function normalizeSnapshotCustomer(userLike) {
  if (!userLike) {
    return {
      customerId: null,
      customerName: "",
      customerPhone: "",
    };
  }

  if (typeof userLike === "object" && !Array.isArray(userLike)) {
    const customerId = userLike._id ? String(userLike._id) : null;
    const customerPhone = userLike.phone ? String(userLike.phone) : "";
    return {
      customerId,
      customerName: String(userLike.name || customerPhone || ""),
      customerPhone,
    };
  }

  return {
    customerId: String(userLike),
    customerName: "",
    customerPhone: "",
  };
}

async function resolveSnapshotCustomer(subscription, { session } = {}) {
  const normalized = normalizeSnapshotCustomer(subscription && subscription.userId);
  if (!normalized.customerId || normalized.customerName || normalized.customerPhone) {
    return normalized;
  }

  let query = User.findById(normalized.customerId).select("name phone");
  if (session) {
    query = query.session(session);
  }
  const user = await query.lean();
  return normalizeSnapshotCustomer(user || normalized.customerId);
}

async function buildLockedDaySnapshot({
  subscription,
  day,
  pickupLocations = [],
  session,
} = {}) {
  const { premiumUpgradeSelections } = applyDayWalletSelections({
    subscription,
    day,
  });
  const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
    subscription,
    day,
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  });
  const operationalDetails = buildLockedOperationalSnapshotDetails(subscription, day, {
    pickupLocations,
  });
  const customer = await resolveSnapshotCustomer(subscription, { session });
  const fulfillmentState = buildSubscriptionDayFulfillmentState({
    subscription,
    day,
  });

  const snapshot = {
    materializedMeals: day.materializedMeals || [],
    selections: day.selections,
    addonSelections: day.addonSelections || [],
    premiumUpgradeSelections,
    customSalads: day.customSalads || [],
    customMeals: day.customMeals || [],
    subscriptionAddons: subscription.addonSubscriptions || [],
    address: operationalDetails.address,
    deliveryWindow: operationalDetails.deliveryWindow,
    deliveryMode: subscription.deliveryMode || null,
    pickupLocationId: operationalDetails.pickupLocationId,
    pickupLocationName: operationalDetails.pickupLocationName,
    pickupAddress: operationalDetails.pickupAddress,
    customerId: customer.customerId,
    customerName: customer.customerName,
    customerPhone: customer.customerPhone,
    pricing: {
      planId: subscription.planId,
      addons: subscription.addonSubscriptions,
    },
    mealsPerDay: resolveMealsPerDay(subscription),
    requiredMealCount: fulfillmentState.requiredMealCount,
    specifiedMealCount: fulfillmentState.specifiedMealCount,
    unspecifiedMealCount: fulfillmentState.unspecifiedMealCount,
    fulfillmentMode: fulfillmentState.fulfillmentMode,
    mealTypesSpecified: fulfillmentState.mealTypesSpecified,
  };


  if (planningSnapshot) {
    snapshot.planning = planningSnapshot;
  }

  return snapshot;
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function lockDaySnapshot(subscription, day, session) {
  if (day.lockedSnapshot) return day.lockedSnapshot;
  const pickupLocations = await getSettingValue("pickup_locations", []);
  const snapshot = await buildLockedDaySnapshot({
    subscription,
    day,
    pickupLocations,
    session,
  });
  day.lockedSnapshot = snapshot;
  day.lockedAt = new Date();
  await day.save({ session });
  return snapshot;
}

module.exports = {
  buildLockedDaySnapshot,
  lockDaySnapshot,
  resolveSnapshotCustomer,
};
