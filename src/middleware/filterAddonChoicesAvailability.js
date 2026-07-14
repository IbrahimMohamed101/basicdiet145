const Addon = require("../models/Addon");

const LEGACY_GENERIC_CATEGORIES = new Set(["juice", "snack", "small_salad"]);

function planIdOf(value) {
  return String(value && (value.addonPlanId || value.addonId) || "").trim();
}

function filterAddonChoicesPayload(payload, activePlanIds) {
  if (!payload || payload.status !== true || !payload.data || typeof payload.data !== "object") {
    return payload;
  }

  const filteredData = {};

  for (const [category, rawGroup] of Object.entries(payload.data)) {
    if (!rawGroup || typeof rawGroup !== "object") continue;

    const originalEntitlements = Array.isArray(rawGroup.entitlements) ? rawGroup.entitlements : [];
    const originalChoices = Array.isArray(rawGroup.choices) ? rawGroup.choices : [];
    const referencedPlanIds = new Set([
      ...originalEntitlements.map(planIdOf),
      ...originalChoices.map(planIdOf),
    ].filter(Boolean));

    const entitlements = originalEntitlements.filter((row) => {
      const planId = planIdOf(row);
      return !planId || activePlanIds.has(planId);
    });

    const choices = originalChoices.filter((row) => {
      const planId = planIdOf(row);
      return !planId || activePlanIds.has(planId);
    });

    const hasActiveReferencedPlan = [...referencedPlanIds].some((planId) => activePlanIds.has(planId));
    const isLegacyGenericCategory = LEGACY_GENERIC_CATEGORIES.has(String(category));

    // Dynamic categories are introduced by purchased add-on plans. Once every
    // referenced plan is inactive, archived, or removed, the category must not
    // survive only because its underlying menu products are still public.
    if (!isLegacyGenericCategory && referencedPlanIds.size > 0 && !hasActiveReferencedPlan) {
      continue;
    }

    // For explicit entitlement-only responses, remove empty groups after their
    // inactive plan rows have been filtered. Legacy generic groups may remain.
    if (!isLegacyGenericCategory && choices.length === 0 && entitlements.length === 0) {
      continue;
    }

    filteredData[category] = {
      ...rawGroup,
      choices,
      ...(Array.isArray(rawGroup.entitlements) ? { entitlements } : {}),
    };
  }

  return { ...payload, data: filteredData };
}

async function filterAddonChoicesAvailability(req, res, next) {
  try {
    const activePlans = await Addon.find({
      kind: "plan",
      isActive: true,
      isArchived: { $ne: true },
    }).select({ _id: 1 }).lean();

    const activePlanIds = new Set(activePlans.map((row) => String(row._id)));
    const originalJson = res.json.bind(res);

    res.json = function filteredJson(payload) {
      return originalJson(filterAddonChoicesPayload(payload, activePlanIds));
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  filterAddonChoicesAvailability,
  filterAddonChoicesPayload,
};
