const {
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../../config/mealPlannerContract");

const ALLOWED_PROTEIN_KEY_SET = new Set(
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.map((key) => String(key).trim().toLowerCase())
);

function getProteinCatalogKey(option = {}) {
  return String(option.key || option.premiumKey || "").trim().toLowerCase();
}

function isSubscriptionPremiumLargeSaladProtein(option = {}) {
  return option.isPremium !== true && ALLOWED_PROTEIN_KEY_SET.has(getProteinCatalogKey(option));
}

function isConfiguredPremiumLargeSaladProtein(option = {}, allowedOptionKeys = []) {
  if (!isSubscriptionPremiumLargeSaladProtein(option)) return false;
  if (!Array.isArray(allowedOptionKeys) || allowedOptionKeys.length === 0) return true;

  const configuredKeySet = new Set(
    allowedOptionKeys.map((key) => String(key || "").trim().toLowerCase()).filter(Boolean)
  );
  return configuredKeySet.has(getProteinCatalogKey(option));
}

module.exports = {
  getProteinCatalogKey,
  isConfiguredPremiumLargeSaladProtein,
  isSubscriptionPremiumLargeSaladProtein,
};
