const assert = require("assert");
const {
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../src/config/mealPlannerContract");
const {
  getProteinCatalogKey,
  isConfiguredPremiumLargeSaladProtein,
  isSubscriptionPremiumLargeSaladProtein,
} = require("../src/services/subscription/premiumLargeSaladEligibilityService");

for (const key of SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS) {
  assert.strictEqual(
    isSubscriptionPremiumLargeSaladProtein({ key }),
    true,
    `${key} is accepted by the canonical subscription salad policy`
  );
}

assert.strictEqual(getProteinCatalogKey({ key: "  GRILLED_CHICKEN  " }), "grilled_chicken");
assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "GRILLED_CHICKEN" }), true);
assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "grilled_chicken", isPremium: true }), false);
assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "beef" }), false);
assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "beef_steak" }), false);
assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "" }), false);

assert.strictEqual(
  isConfiguredPremiumLargeSaladProtein({ key: "grilled_chicken" }, []),
  true,
  "an empty dashboard restriction preserves the canonical allowlist"
);
assert.strictEqual(
  isConfiguredPremiumLargeSaladProtein({ key: "grilled_chicken" }, ["tuna"]),
  false,
  "dashboard configuration can narrow the canonical allowlist"
);
assert.strictEqual(
  isConfiguredPremiumLargeSaladProtein({ key: "tuna" }, ["TUNA"]),
  true,
  "dashboard restrictions use normalized catalog keys"
);
assert.strictEqual(
  isConfiguredPremiumLargeSaladProtein({ key: "beef" }, ["beef"]),
  false,
  "dashboard configuration cannot widen the canonical allowlist"
);

console.log("premium large salad eligibility policy checks passed");
