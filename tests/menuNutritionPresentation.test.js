process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  serializePublicOption,
  serializePublicProduct,
} = require("../src/services/orders/menuCatalogPresenter");

const catalogItem = {
  nutrition: {
    calories: 420,
    proteinGrams: 31,
    carbsGrams: 52,
    fatGrams: 9,
  },
};

const product = serializePublicProduct({
  _id: "product-1",
  categoryId: "category-1",
  key: "weighted_meal",
  name: { ar: "وجبة", en: "Meal" },
  pricingModel: "per_100g",
  priceHalala: 1900,
}, "ar", [], "category-1", { catalogItem });

assert.strictEqual(product.calories, 420);
assert.deepStrictEqual(product.nutrition, {
  calories: 420,
  proteinGrams: 31,
  carbGrams: 52,
  fatGrams: 9,
});
assert.strictEqual(product.nutritionBasis, "per_100g");

const option = serializePublicOption({}, {
  _id: "option-1",
  groupId: "group-1",
  key: "chicken",
  name: { ar: "دجاج", en: "Chicken" },
  nutrition: { calories: 999 },
}, "ar", { catalogItem });

assert.strictEqual(option.calories, 420, "linked CatalogItem nutrition must be authoritative");
assert.strictEqual(option.nutrition.carbGrams, 52, "carbsGrams must be normalized for mobile clients");
assert.strictEqual(option.nutritionBasis, "per_serving");

const legacyOption = serializePublicOption({}, {
  _id: "option-2",
  groupId: "group-1",
  key: "legacy",
  name: { ar: "قديم", en: "Legacy" },
  nutrition: { calories: 125, carbGrams: 7 },
}, "ar");

assert.strictEqual(legacyOption.calories, 125, "unlinked legacy option nutrition must remain supported");
assert.strictEqual(legacyOption.nutrition.carbGrams, 7);

console.log("menuNutritionPresentation: passed");
