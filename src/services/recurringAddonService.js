const { pickLang } = require("../utils/i18n");
const { createLocalizedError } = require("../utils/errorLocalization");

const DAILY_RECURRING_ADDON_MODE = "daily_recurring";

function hasCanonicalContract(subscription) {
  return Boolean(
    subscription
      && subscription.contractVersion === "subscription_contract.v1"
      && subscription.contractMode === "canonical"
      && subscription.contractSnapshot
  );
}

function isCanonicalRecurringAddonEligible(subscription) {
  return hasCanonicalContract(subscription);
}

function normalizeAddonCategory(value, addonId) {
  const raw = String(value || "").trim();
  return raw || String(addonId || "").trim();
}

function normalizeAddonName(value) {
  if (value && typeof value === "object") {
    return pickLang(value, "ar") || pickLang(value, "en") || "";
  }
  return String(value || "");
}

function normalizeRecurringAddonEntitlements(addonSubscriptions = []) {
  if (!Array.isArray(addonSubscriptions)) return [];

  const normalized = addonSubscriptions
    .filter((row) => row && row.addonId && String(row.type || "subscription") !== "one_time")
    .map((row) => ({
      addonId: row.addonId,
      name: normalizeAddonName(row.name),
      price: Number(row.price || 0),
      type: "subscription",
      category: normalizeAddonCategory(row.category, row.addonId),
      entitlementMode: DAILY_RECURRING_ADDON_MODE,
      maxPerDay: Number.isInteger(Number(row.maxPerDay)) && Number(row.maxPerDay) > 0
        ? Number(row.maxPerDay)
        : 1,
    }));

  const seenCategories = new Set();
  for (const row of normalized) {
    if (seenCategories.has(row.category)) {
      throw createLocalizedError({
        code: "RECURRING_ADDON_CATEGORY_CONFLICT",
        key: "errors.addon.recurringCategoryConflict",
        fallbackMessage: "Recurring add-ons may include at most one item per category",
      });
    }
    seenCategories.add(row.category);
  }

  return normalized;
}

function buildRecurringAddonEntitlementsFromQuote({ addonItems = [], lang = "ar" } = {}) {
  if (!Array.isArray(addonItems)) return [];

  return normalizeRecurringAddonEntitlements(
    addonItems
      .filter((item) => item && item.addon && String(item.addon.type || "subscription") !== "one_time")
      .map((item) => ({
        addonId: item.addon._id,
        name: pickLang(item.addon.name, lang) || "",
        price: Number(item.unitPriceHalala || 0) / 100,
        type: "subscription",
        category: normalizeAddonCategory(item.addon.category, item.addon._id),
        // Purchase-flow recurring add-ons are selection-based only, so maxPerDay is implicit.
        maxPerDay: 1,
      }))
  );
}

function buildRecurringAddonProjectionFromEntitlements(addonSubscriptions = []) {
  return normalizeRecurringAddonEntitlements(addonSubscriptions).map((row) => ({
    addonId: row.addonId,
    name: row.name,
    category: row.category,
    entitlementMode: row.entitlementMode,
    maxPerDay: row.maxPerDay,
  }));
}

function resolveProjectedRecurringAddons({ subscription, day } = {}) {
  if (
    day
    && day.fulfilledSnapshot
    && Array.isArray(day.fulfilledSnapshot.recurringAddons)
  ) {
    return day.fulfilledSnapshot.recurringAddons;
  }
  if (
    day
    && day.lockedSnapshot
    && Array.isArray(day.lockedSnapshot.recurringAddons)
  ) {
    return day.lockedSnapshot.recurringAddons;
  }
  if (!isCanonicalRecurringAddonEligible(subscription)) {
    return [];
  }
  return buildRecurringAddonProjectionFromEntitlements(subscription.addonSubscriptions || []);
}

function applyRecurringAddonProjectionToDay({ subscription, day } = {}) {
  if (!day) return day;

  if (!isCanonicalRecurringAddonEligible(subscription)) {
    day.recurringAddons = undefined;
    return day;
  }

  const projected = resolveProjectedRecurringAddons({ subscription });
  day.recurringAddons = projected.length > 0 ? projected : [];
  return day;
}

function buildScopedRecurringAddonSnapshot({ subscription } = {}) {
  if (!isCanonicalRecurringAddonEligible(subscription)) {
    return null;
  }
  const projected = resolveProjectedRecurringAddons({ subscription });
  return projected.length > 0 ? projected : [];
}

function buildProjectedDayEntry({ subscription, date, status = "open" } = {}) {
  const entry = { subscriptionId: subscription._id, date, status };
  if (isCanonicalRecurringAddonEligible(subscription)) {
    entry.recurringAddons = resolveProjectedRecurringAddons({ subscription });
  }
  return entry;
}

module.exports = {
  DAILY_RECURRING_ADDON_MODE,
  isCanonicalRecurringAddonEligible,
  normalizeRecurringAddonEntitlements,
  buildRecurringAddonEntitlementsFromQuote,
  buildRecurringAddonProjectionFromEntitlements,
  resolveProjectedRecurringAddons,
  applyRecurringAddonProjectionToDay,
  buildScopedRecurringAddonSnapshot,
  buildProjectedDayEntry,
};
