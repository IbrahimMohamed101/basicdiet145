// Compatibility facade for operational scripts and external tests that import
// the previous capability-specific module path.
const {
  getProteinCatalogKey,
  isConfiguredPremiumLargeSaladProtein,
  isSubscriptionPremiumLargeSaladProtein,
} = require("./subscriptionMenuEligibilityPolicyService");

module.exports = {
  getProteinCatalogKey,
  isConfiguredPremiumLargeSaladProtein,
  isSubscriptionPremiumLargeSaladProtein,
};
