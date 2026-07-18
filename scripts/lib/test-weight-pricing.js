const TEST_WEIGHT_PRICING_DEFAULTS = Object.freeze({
  pricingModel: "per_100g",
  priceHalala: 1900,
  baseUnitGrams: 100,
  defaultWeightGrams: 100,
  minWeightGrams: 100,
  weightStepGrams: 100,
  weightStepPriceHalala: 500,
});

const MEAL_ITEM_TYPES = new Set([
  "basic_meal",
  "full_meal_product",
  "meal",
  "standalone_meal",
  "standard_meal",
]);
const SANDWICH_ITEM_TYPES = new Set(["cold_sandwich", "sandwich"]);
const TEST_WEIGHT_PRICING_FIELDS = Object.keys(TEST_WEIGHT_PRICING_DEFAULTS).concat("maxWeightGrams");

function testWeightPricingEligibility(product, categoryKey = "") {
  if (product.isActive === false) return { eligible: false, reason: "product is inactive" };

  const itemType = String(product.itemType || "");
  if (MEAL_ITEM_TYPES.has(itemType)) return { eligible: true };
  if (itemType === "product" && categoryKey === "meals") return { eligible: true };
  if (SANDWICH_ITEM_TYPES.has(itemType) && product.pricingModel === "per_100g") {
    return { eligible: true };
  }

  return {
    eligible: false,
    reason: `itemType=${itemType || "missing"} does not support meal weight selection`,
  };
}

function compatibleMaximum(maxWeightGrams) {
  return Number.isInteger(maxWeightGrams)
    && maxWeightGrams >= TEST_WEIGHT_PRICING_DEFAULTS.minWeightGrams
    && (maxWeightGrams - TEST_WEIGHT_PRICING_DEFAULTS.minWeightGrams)
      % TEST_WEIGHT_PRICING_DEFAULTS.weightStepGrams === 0;
}

function testWeightPricingUpdate(product = {}) {
  const currentMaximum = Number(product.maxWeightGrams);
  return {
    ...TEST_WEIGHT_PRICING_DEFAULTS,
    maxWeightGrams: compatibleMaximum(currentMaximum) ? currentMaximum : 500,
  };
}

function hasTestWeightPricing(product, expectedFields = testWeightPricingUpdate(product)) {
  return TEST_WEIGHT_PRICING_FIELDS.every((field) => product[field] === expectedFields[field]);
}

module.exports = {
  TEST_WEIGHT_PRICING_DEFAULTS,
  hasTestWeightPricing,
  testWeightPricingEligibility,
  testWeightPricingUpdate,
};
