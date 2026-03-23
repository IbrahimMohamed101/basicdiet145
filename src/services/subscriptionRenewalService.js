const { createLocalizedError } = require("../utils/errorLocalization");

function cloneValue(value) {
  if (!value || typeof value !== "object") return value || null;
  return JSON.parse(JSON.stringify(value));
}

function createRenewalError(key, code = "RENEWAL_UNAVAILABLE", fallbackMessage = key) {
  return createLocalizedError({
    code,
    key,
    fallbackMessage,
  });
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function extractSnapshotRenewalSeed(previousSubscription) {
  const snapshot = previousSubscription
    && previousSubscription.contractSnapshot
    && typeof previousSubscription.contractSnapshot === "object"
    ? previousSubscription.contractSnapshot
    : null;
  const plan = snapshot && snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : null;
  const delivery = snapshot && snapshot.delivery && typeof snapshot.delivery === "object" ? snapshot.delivery : null;

  if (!plan) return null;

  const planId = plan.planId ? String(plan.planId) : "";
  const grams = Number(plan.selectedGrams || 0);
  const mealsPerDay = Number(plan.mealsPerDay || 0);
  const daysCount = Number(plan.daysCount || 0);

  if (!planId || !isPositiveInteger(grams) || !isPositiveInteger(mealsPerDay) || !isPositiveInteger(daysCount)) {
    return null;
  }

  return {
    seedSource: "snapshot",
    planId,
    grams,
    mealsPerDay,
    daysCount,
    deliveryPreference: {
      mode: delivery && delivery.mode ? String(delivery.mode) : null,
      address: cloneValue(delivery && delivery.address),
      slot: cloneValue(delivery && delivery.slot),
      pickupLocationId: delivery && delivery.pickupLocationId ? String(delivery.pickupLocationId) : null,
      zoneId: delivery && delivery.zoneId ? String(delivery.zoneId) : null,
      zoneName: delivery && delivery.zoneName ? String(delivery.zoneName) : "",
      seedOnly: true,
    },
  };
}

function extractLegacyRenewalSeed(previousSubscription) {
  if (!previousSubscription || typeof previousSubscription !== "object") {
    return null;
  }

  const planId = previousSubscription.planId ? String(previousSubscription.planId) : "";
  const grams = Number(previousSubscription.selectedGrams || 0);
  const mealsPerDay = Number(previousSubscription.selectedMealsPerDay || 0);
  const daysCount = Number(previousSubscription.totalMeals || 0) && mealsPerDay > 0
    ? Math.round(Number(previousSubscription.totalMeals || 0) / mealsPerDay)
    : 0;

  if (!planId || !isPositiveInteger(grams) || !isPositiveInteger(mealsPerDay) || !isPositiveInteger(daysCount)) {
    return null;
  }

  return {
    seedSource: "legacy",
    planId,
    grams,
    mealsPerDay,
    daysCount,
    deliveryPreference: {
      mode: previousSubscription.deliveryMode ? String(previousSubscription.deliveryMode) : null,
      address: cloneValue(previousSubscription.deliveryAddress),
      slot: cloneValue(previousSubscription.deliverySlot)
        || (previousSubscription.deliveryWindow
          ? {
            type: previousSubscription.deliveryMode || "delivery",
            window: String(previousSubscription.deliveryWindow || ""),
            slotId: "",
          }
          : null),
      pickupLocationId: null,
      zoneId: previousSubscription.deliveryZoneId ? String(previousSubscription.deliveryZoneId) : null,
      zoneName: previousSubscription.deliveryZoneName ? String(previousSubscription.deliveryZoneName) : "",
      seedOnly: true,
    },
  };
}

function resolveRenewalSeedSource(previousSubscription) {
  return extractSnapshotRenewalSeed(previousSubscription) || extractLegacyRenewalSeed(previousSubscription) || null;
}

function validateRenewablePlanOption({ plan, grams, mealsPerDay }) {
  if (!plan) {
    throw createRenewalError("errors.renewal.planUnavailable", "RENEWAL_UNAVAILABLE", "Plan is no longer available");
  }
  if (plan.isActive === false) {
    throw createRenewalError("errors.renewal.planUnavailable", "RENEWAL_UNAVAILABLE", "Plan is no longer available");
  }

  const gramsOptions = Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [];
  const gramsOption = gramsOptions.find((item) => item && Number(item.grams) === Number(grams) && item.isActive !== false);
  if (!gramsOption) {
    throw createRenewalError(
      "errors.renewal.gramsOptionUnavailable",
      "RENEWAL_UNAVAILABLE",
      "Selected grams option is no longer available"
    );
  }

  const mealsOptions = Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
  const mealsOption = mealsOptions.find(
    (item) => item && Number(item.mealsPerDay) === Number(mealsPerDay) && item.isActive !== false
  );
  if (!mealsOption) {
    throw createRenewalError(
      "errors.renewal.mealsOptionUnavailable",
      "RENEWAL_UNAVAILABLE",
      "Selected mealsPerDay option is no longer available"
    );
  }

  return {
    planId: String(plan._id),
    grams: Number(grams),
    mealsPerDay: Number(mealsPerDay),
    daysCount: Number(plan.daysCount || 0),
  };
}

function buildSubscriptionRenewalSeed({ previousSubscription, livePlan }) {
  const baseSeed = resolveRenewalSeedSource(previousSubscription);
  if (!baseSeed) {
    throw createRenewalError(
      "errors.renewal.baseConfigurationInsufficient",
      "RENEWAL_UNAVAILABLE",
      "Subscription does not have enough base configuration to renew"
    );
  }

  const validatedPlan = validateRenewablePlanOption({
    plan: livePlan,
    grams: baseSeed.grams,
    mealsPerDay: baseSeed.mealsPerDay,
  });

  return {
    subscriptionId: previousSubscription && previousSubscription._id ? String(previousSubscription._id) : null,
    seedSource: baseSeed.seedSource,
    renewable: true,
    seed: {
      planId: validatedPlan.planId,
      grams: validatedPlan.grams,
      mealsPerDay: validatedPlan.mealsPerDay,
      daysCount: validatedPlan.daysCount,
      deliveryPreference: baseSeed.deliveryPreference,
    },
  };
}

module.exports = {
  buildSubscriptionRenewalSeed,
  resolveRenewalSeedSource,
  validateRenewablePlanOption,
};
