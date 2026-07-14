const {
  PREMIUM_MEAL_PROTEIN_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../../config/mealPlannerContract");

function normalizeCatalogKey(value) {
  return String(value || "").trim().toLowerCase();
}

const PREMIUM_MEAL_PROTEIN_KEY_SET = new Set(
  PREMIUM_MEAL_PROTEIN_KEYS.map(normalizeCatalogKey)
);
const PREMIUM_LARGE_SALAD_PROTEIN_KEY_SET = new Set(
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.map(normalizeCatalogKey)
);

function availableForChannelQuery(channel) {
  return {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: channel },
    ],
  };
}

function isMenuItemEnabledForSubscription(doc) {
  if (!doc) return false;
  if (doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function getProteinCatalogKey(option = {}) {
  return normalizeCatalogKey(option.key || option.premiumKey);
}

function isSubscriptionPremiumMealProteinKey(value) {
  return PREMIUM_MEAL_PROTEIN_KEY_SET.has(normalizeCatalogKey(value));
}

function isSubscriptionPremiumMealProtein(option = {}) {
  return isSubscriptionPremiumMealProteinKey(option.premiumKey)
    || isSubscriptionPremiumMealProteinKey(option.key);
}

function isSubscriptionPremiumLargeSaladProtein(option = {}) {
  if (option.isPremium === true) return false;
  return PREMIUM_LARGE_SALAD_PROTEIN_KEY_SET.has(normalizeCatalogKey(option.key))
    || PREMIUM_LARGE_SALAD_PROTEIN_KEY_SET.has(normalizeCatalogKey(option.premiumKey));
}

function isConfiguredPremiumLargeSaladProtein(option = {}, allowedOptionKeys = []) {
  if (!isSubscriptionPremiumLargeSaladProtein(option)) return false;
  if (!Array.isArray(allowedOptionKeys) || allowedOptionKeys.length === 0) return true;

  const configuredKeySet = new Set(
    allowedOptionKeys.map(normalizeCatalogKey).filter(Boolean)
  );
  return configuredKeySet.has(getProteinCatalogKey(option));
}

module.exports = {
  availableForChannelQuery,
  getProteinCatalogKey,
  isConfiguredPremiumLargeSaladProtein,
  isMenuItemEnabledForSubscription,
  isSubscriptionPremiumLargeSaladProtein,
  isSubscriptionPremiumMealProtein,
  isSubscriptionPremiumMealProteinKey,
};
