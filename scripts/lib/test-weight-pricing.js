const TEST_WEIGHT_PRICING_DEFAULTS = Object.freeze({
  pricingModel: "per_100g",
  priceHalala: 1900,
  baseUnitGrams: 100,
  defaultWeightGrams: 100,
  minWeightGrams: 100,
  maxWeightGrams: 250,
  weightStepGrams: 50,
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
const TEST_WEIGHT_PRICING_FIELDS = Object.keys(TEST_WEIGHT_PRICING_DEFAULTS);

function testWeightPricingEligibility(product, categoryKey = "", optionGroupKeys = []) {
  if (product.isActive === false) return { eligible: false, reason: "product is inactive" };

  const itemType = String(product.itemType || "");
  if (MEAL_ITEM_TYPES.has(itemType)) return { eligible: true };
  if (itemType === "product" && categoryKey === "meals") return { eligible: true };
  if (itemType === "product" && categoryKey === "custom_order" && optionGroupKeys.includes("carbs")) {
    return { eligible: true };
  }
  if (SANDWICH_ITEM_TYPES.has(itemType) && product.pricingModel === "per_100g") {
    return { eligible: true };
  }

  return {
    eligible: false,
    reason: `itemType=${itemType || "missing"} does not support meal weight selection`,
  };
}

function testWeightPricingUpdate() {
  return { ...TEST_WEIGHT_PRICING_DEFAULTS };
}

function hasTestWeightPricing(product, expectedFields = testWeightPricingUpdate()) {
  return TEST_WEIGHT_PRICING_FIELDS.every((field) => product[field] === expectedFields[field]);
}

module.exports = {
  TEST_WEIGHT_PRICING_DEFAULTS,
  hasTestWeightPricing,
  testWeightPricingEligibility,
  testWeightPricingUpdate,
};
