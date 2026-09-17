"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const {
  collectLegacyRefs,
  mergeLegacyRows,
} = require("../src/services/dashboard/installKitchenLegacyComponentCatalogResolution");
const { polishOperation } = require("../src/services/dashboard/installKitchenFinalResponsePolish");

const IDS = Object.freeze({
  protein: "6a62197579ee075a57f70112",
  carb: "6a62198179ee075a57f7013e",
  addonPlan: "6a6219a0f4f8d0974cebc49d",
});

(function verifyLegacyAliasCollection() {
  const refs = collectLegacyRefs([{
    mealSlots: [{
      protein: { id: IDS.protein, key: "chicken" },
      carbs: [{ id: IDS.carb }],
    }],
  }]);
  assert(refs.proteinIds.has(IDS.protein));
  assert(refs.proteinKeys.has("chicken"));
  assert(refs.carbIds.has(IDS.carb), "legacy carb id alias must be queried");

  const maps = mergeLegacyRows({}, [
    { _id: IDS.protein, key: "chicken", proteinFamilyKey: "chicken", name: { ar: "دجاج", en: "Chicken" } },
  ], [
    { _id: IDS.carb, key: "vermicelli_rice", name: { ar: "رز بالشعيرية", en: "Vermicelli Rice" } },
  ]);
  assert.strictEqual(maps.proteinById.get(IDS.protein).name.ar, "دجاج");
  assert.strictEqual(maps.carbById.get(IDS.carb).name.ar, "رز بالشعيرية");
})();

(function verifyProductionResponsePolish() {
  const operation = polishOperation({
    entityType: "order",
    orderNumber: "ORD-3821681B",
    reference: "ORD-WRONG",
    kitchen: {
      cards: [
        {
          type: "product",
          title: "زبادي يوناني - 200 جرام",
          titleI18n: { ar: "زبادي يوناني - 200 جرام", en: "Greek Yogurt – 200g" },
          quantity: 1,
          lines: ["الصنف المطلوب: زبادي يوناني - 200 جرام - 100 جم"],
          components: {
            product: {
              key: "greek_yogurt_greek_yogurt_200g",
              name: "زبادي يوناني - 200 جرام",
              nameI18n: { ar: "زبادي يوناني - 200 جرام", en: "Greek Yogurt – 200g" },
              grams: 100,
              quantity: 1,
            },
            protein: null,
            carbs: [],
          },
        },
        {
          type: "product",
          title: "وجبة دجاج كريمة 100 جرام",
          titleI18n: { ar: "وجبة دجاج كريمة 100 جرام", en: "100g Creamy Chicken Meal" },
          quantity: 1,
          lines: ["الصنف المطلوب: وجبة دجاج كريمة 100 جرام - 300 جم"],
          components: {
            product: {
              key: "meals_100g_creamy_chicken_meal",
              name: "وجبة دجاج كريمة 100 جرام",
              nameI18n: { ar: "وجبة دجاج كريمة 100 جرام", en: "100g Creamy Chicken Meal" },
              grams: 300,
              quantity: 1,
            },
            protein: null,
            carbs: [],
          },
        },
        {
          type: "standard_meal",
          title: "chicken",
          titleI18n: { ar: "chicken", en: "chicken" },
          quantity: 1,
          lines: ["البروتين المطلوب: chicken - 100 جم", "الكارب: - 150 جم"],
          components: {
            product: { id: null, key: null, name: "chicken", nameI18n: { ar: "chicken", en: "chicken" }, quantity: 1 },
            protein: { id: IDS.protein, key: "chicken", name: "chicken", nameI18n: { ar: "chicken", en: "chicken" }, grams: 100, quantity: 1 },
            carbs: [{ id: IDS.carb, key: "vermicelli_rice", name: "", nameI18n: { ar: "", en: "" }, grams: 150, quantity: 1 }],
          },
        },
        {
          type: "basic_salad",
          title: "سلطة على مزاجك – 100جرام بروتين",
          titleI18n: { ar: "سلطة على مزاجك – 100جرام بروتين", en: "Build Your Own Salad – 100g Protein" },
          quantity: 1,
          lines: ["البروتين المطلوب: دجاج سبايسي - 100 جم"],
          sections: [{
            key: "بروتينات",
            items: [{ id: "protein-1", key: "spicy_chicken", name: "دجاج سبايسي", nameI18n: { ar: "دجاج سبايسي", en: "Spicy Chicken" }, grams: 100 }],
          }],
          components: {
            product: { key: "basic_salad", name: "سلطة على مزاجك – 100جرام بروتين", nameI18n: { ar: "سلطة على مزاجك – 100جرام بروتين", en: "Build Your Own Salad – 100g Protein" } },
            protein: { id: "protein-1", key: "spicy_chicken", name: "دجاج سبايسي", nameI18n: { ar: "دجاج سبايسي", en: "دجاج سبايسي" }, grams: 100, quantity: 1 },
            carbs: [],
          },
        },
        {
          type: "sandwich",
          title: "ساندوتش ساندويش حلومي",
          titleI18n: { ar: "ساندوتش ساندويش حلومي", en: "Halloumi Sandwich" },
          quantity: 1,
          lines: ["الصنف المطلوب: ساندوتش ساندويش حلومي"],
          components: {
            product: { key: "sandwiches_halloumi_sandwich", name: "ساندوتش ساندويش حلومي", nameI18n: { ar: "ساندوتش ساندويش حلومي", en: "Halloumi Sandwich" }, quantity: 1 },
            protein: null,
            carbs: [],
          },
        },
      ],
      addonGroups: [{
        addonPlanId: IDS.addonPlan,
        label: "اشتراك العصير والمشروبات",
        labelI18n: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
        items: [{
          productId: IDS.addonPlan,
          key: null,
          name: "اشتراك العصير والمشروبات",
          nameI18n: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
          quantity: 1,
        }],
      }],
    },
  });

  assert.strictEqual(operation.reference, "ORD-3821681B");
  assert.strictEqual(operation.kitchen.cards[0].components.product.grams, 200, "declared fixed 200g must beat stale 100g");
  assert(operation.kitchen.cards[0].lines[0].endsWith("- 200 جم"));
  assert.strictEqual(operation.kitchen.cards[1].components.product.grams, 300, "larger selected per-100g weight must be preserved");

  const meal = operation.kitchen.cards[2];
  assert.strictEqual(meal.title, "دجاج + رز بالشعيرية");
  assert.strictEqual(meal.titleI18n.en, "Chicken + Vermicelli Rice");
  assert.strictEqual(meal.components.protein.nameI18n.ar, "دجاج");
  assert.strictEqual(meal.components.protein.nameI18n.en, "Chicken");
  assert.strictEqual(meal.components.carbs[0].name, "رز بالشعيرية");
  assert.strictEqual(meal.components.carbs[0].grams, 150);

  const salad = operation.kitchen.cards[3];
  assert.strictEqual(salad.components.protein.nameI18n.en, "Spicy Chicken");
  assert.strictEqual(salad.badge, "سلطة");

  const sandwich = operation.kitchen.cards[4];
  assert.strictEqual(sandwich.title, "ساندويش حلومي");
  assert.strictEqual(sandwich.components.product.name, "ساندويش حلومي");
  assert.strictEqual(sandwich.lines[0], "الصنف المطلوب: ساندويش حلومي");

  const addon = operation.kitchen.addonGroups[0].items[0];
  assert.strictEqual(addon.productId, null);
  assert.strictEqual(addon.key, null);
  assert.strictEqual(addon.name, "لم يتم تحديد منتج الإضافة");
  assert.strictEqual(addon.nameI18n.en, "Addon product not selected");

  console.log("Production kitchen response regression checks passed");
})();
