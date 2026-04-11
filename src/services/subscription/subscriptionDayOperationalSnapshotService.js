"use strict";

const User = require("../../models/User");
const { buildLockedOperationalSnapshotDetails } = require("../../utils/delivery");
const { isPhase2CanonicalDayPlanningEnabled } = require("../../utils/featureFlags");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { buildScopedCanonicalPlanningSnapshot } = require("./subscriptionDayPlanningService");
const { buildScopedRecurringAddonSnapshot } = require("../recurringAddonService");
const { buildOneTimeAddonPlanningSnapshot } = require("../oneTimeAddonPlanningService");

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
  const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
    subscription,
    day,
  });
  const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
    subscription,
    day,
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  });
  const recurringAddonSnapshot = buildScopedRecurringAddonSnapshot({
    subscription,
    day,
  });
  const oneTimeAddonSnapshot = buildOneTimeAddonPlanningSnapshot({ day });
  const operationalDetails = buildLockedOperationalSnapshotDetails(subscription, day, {
    pickupLocations,
  });
  const customer = await resolveSnapshotCustomer(subscription, { session });

  const snapshot = {
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    addonsOneTime: day.addonsOneTime,
    premiumUpgradeSelections,
    addonCreditSelections,
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
      premiumPrice: subscription.premiumPrice,
      addons: subscription.addonSubscriptions,
    },
    mealsPerDay: resolveMealsPerDay(subscription),
  };

  if (planningSnapshot) {
    snapshot.planning = planningSnapshot;
  }
  if (recurringAddonSnapshot) {
    snapshot.recurringAddons = recurringAddonSnapshot;
  }
  if (oneTimeAddonSnapshot) {
    Object.assign(snapshot, oneTimeAddonSnapshot);
  }

  return snapshot;
}

module.exports = {
  buildLockedDaySnapshot,
  resolveSnapshotCustomer,
};
