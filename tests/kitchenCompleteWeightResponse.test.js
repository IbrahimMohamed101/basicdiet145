"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");

require("../src/services/dashboard/installKitchenArabicCatalogAuthority");
require("../src/services/dashboard/installKitchenAddonProductIdentityGuard");
require("../src/services/dashboard/installKitchenPreparationContract");
require("../src/services/dashboard/installKitchenFinalNameRepair");

const Order = require("../src/models/Order");
const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const kitchenContract = require("../src/services/dashboard/kitchenOperationsContractService");
const {
  enrichPricedItem,
} = require("../src/services/orders/installOrderPreparationWeightLifecycle");
const {
  resolvePreparationWeight,
} = require("../src/services/orders/preparationWeightService");

const IDS = Object.freeze({
  order: "507f191e810c19729de89001",
  user: "507f191e810c19729de89002",
  shrimp: "507f191e810c19729de89003",
  yogurt: "507f191e810c19729de89004",
  creamy: "507f191e810c19729de89005",
  carb: "507f191e810c19729de89006",
  salad: "507f191e810c19729de89007",
  sandwich: "507f191e810c19729de89008",
  protein: "507f191e810c19729de89009",
  dessert: "507f191e810c19729de89010",
  proteinGroup: "507f191e810c19729de89011",
});

function product(id, key, ar, en, pricingModel = "fixed", defaultWeightGrams = 0, itemType = "product") {
  return {
    _id: id,
    key,
    name: { ar, en },
    pricingModel,
    defaultWeightGrams,
    itemType,
  };
}

const products = [
  product(IDS.shrimp, "meals_100g_shrimp_meal", "وجبة جمبري 100 جرام", "100g Shrimp Meal"),
  product(IDS.yogurt, "greek_yogurt_greek_yogurt_200g", "زبادي يوناني - 200 جرام", "Greek Yogurt – 200g"),
  product(IDS.creamy, "meals_100g_creamy_chicken_meal", "وجبة دجاج كريمة 100 جرام", "100g Creamy Chicken Meal", "per_100g", 100),
  product(IDS.carb, "carbs_white_rice_150g", "رز أبيض من 150 جرام", "White Rice – 150g", "fixed", 0, "carb"),
  product(IDS.salad, "basic_salad", "سلطة على مزاجك – 100جرام بروتين", "Build Your Own Salad – 100g Protein", "fixed", 0, "basic_salad"),
  product(IDS.sandwich, "sandwiches_halloumi_sandwich", "ساندويش حلومي", "Halloumi Sandwich", "fixed", 0, "sandwich"),
  product(IDS.dessert, "desserts_orange_cake", "كيكة البرتقال", "Orange Cake", "fixed", 0, "dessert"),
];
const spicyChicken = {
  _id: IDS.protein,
  key: "spicy_chicken",
  name: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
};

function maps() {
  return {
    productById: new Map(products.map((entry) => [String(entry._id), entry])),
    productByKey: new Map(products.map((entry) => [entry.key, entry])),
    sandwichById: new Map([[IDS.sandwich, products.find((entry) => entry._id === IDS.sandwich)]]),
    sandwichByKey: new Map([["sandwiches_halloumi_sandwich", products.find((entry) => entry._id === IDS.sandwich)]]),
    optionById: new Map([[IDS.protein, spicyChicken]]),
    optionByKey: new Map([[spicyChicken.key, spicyChicken]]),
    proteinById: new Map([[IDS.protein, spicyChicken]]),
    proteinByKey: new Map([[spicyChicken.key, spicyChicken]]),
    carbById: new Map(),
    carbByKey: new Map(),
    saladItemById: new Map([[IDS.protein, spicyChicken]]),
    saladItemByKey: new Map([[spicyChicken.key, spicyChicken]]),
    addonById: new Map([[IDS.dessert, products.find((entry) => entry._id === IDS.dessert)]]),
    addonByKey: new Map([["desserts_orange_cake", products.find((entry) => entry._id === IDS.dessert)]]),
    addonPlanById: new Map(),
  };
}

function item(productDoc, itemType = productDoc.itemType, overrides = {}) {
  return {
    itemType,
    productId: productDoc._id,
    name: productDoc.name,
    qty: 1,
    productSnapshot: {
      productId: productDoc._id,
      key: productDoc.key,
      name: productDoc.name,
      itemType,
      pricingModel: productDoc.pricingModel,
      defaultWeightGrams: productDoc.defaultWeightGrams,
      ...(overrides.productSnapshot || {}),
    },
    ...overrides,
  };
}

function findCard(operation, key) {
  return operation.kitchen.cards.find((card) => card.components.product && card.components.product.key === key);
}

(function run() {
  const itemSchema = Order.schema.path("items").schema;
  assert(itemSchema.path("weightGrams"), "Order item weightGrams must persist");
  assert(itemSchema.path("servingWeightGrams"), "Order item servingWeightGrams must persist");
  assert(itemSchema.path("weightSource"), "Order item weightSource must persist");

  assert.deepStrictEqual(
    resolvePreparationWeight({ product: products[0], item: {} }),
    { grams: 100, source: "legacy_declared_weight", pricingModel: "fixed" }
  );
  assert.deepStrictEqual(
    resolvePreparationWeight({
      product: products[1],
      item: { weightGrams: 100, productSnapshot: { pricingModel: "fixed", weightGrams: 100 } },
    }),
    { grams: 200, source: "legacy_declared_weight", pricingModel: "fixed" },
    "fixed 200g serving must beat a stale stored 100g value"
  );
  assert.deepStrictEqual(
    resolvePreparationWeight({
      product: products[2],
      item: { weightGrams: 300, productSnapshot: { pricingModel: "per_100g", weightGrams: 300 } },
    }),
    { grams: 300, source: "selected_weight", pricingModel: "per_100g" },
    "per-100g products must preserve the selected preparation weight"
  );

  const persistedShrimp = enrichPricedItem(item(products[0]), products[0]);
  assert.strictEqual(persistedShrimp.weightGrams, 100);
  assert.strictEqual(persistedShrimp.servingWeightGrams, 100);
  assert.strictEqual(persistedShrimp.productSnapshot.weightGrams, 100);

  const saladOptions = [{
    groupId: IDS.proteinGroup,
    groupKey: "protein",
    canonicalGroupKey: "protein",
    groupName: { ar: "بروتينات", en: "Proteins" },
    optionId: IDS.protein,
    optionKey: "spicy_chicken",
    name: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
    qty: 1,
    extraWeightGrams: 0,
  }];

  const order = {
    _id: IDS.order,
    orderNumber: "ORD-3821681B",
    userId: IDS.user,
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-07-25",
    pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
    items: [
      item(products[0]),
      item(products[1], "product", {
        weightGrams: 100,
        productSnapshot: { pricingModel: "fixed", weightGrams: 100 },
      }),
      item(products[2], "product", {
        weightGrams: 300,
        productSnapshot: { pricingModel: "per_100g", weightGrams: 300 },
      }),
      item(products[3], "carb"),
      item(products[4], "basic_salad", {
        selectedOptions: saladOptions,
        selections: { selectedOptions: saladOptions },
      }),
      item(products[5], "sandwich"),
      item(products[6], "dessert"),
    ],
    createdAt: new Date("2026-07-25T10:00:00.000Z"),
    updatedAt: new Date("2026-07-25T10:01:00.000Z"),
  };

  const dto = dashboardDtoService.mapOrderToDTO(
    order,
    null,
    { _id: IDS.user, name: "ابراهيم", phone: "+966500000000" },
    "kitchen",
    "ar",
    maps()
  );
  const operation = kitchenContract.serializeKitchenOperation(dto);

  assert.strictEqual(operation.reference, "ORD-3821681B");
  assert.deepStrictEqual(operation.fulfillment.pickup.branchName, { ar: "الفرع الرئيسي", en: "Main Branch" });

  const shrimp = findCard(operation, "meals_100g_shrimp_meal");
  assert.strictEqual(shrimp.components.product.grams, 100);
  assert(shrimp.lines.includes("الصنف المطلوب: وجبة جمبري 100 جرام - 100 جم"));

  const yogurt = findCard(operation, "greek_yogurt_greek_yogurt_200g");
  assert.strictEqual(yogurt.components.product.grams, 200);
  assert(yogurt.lines.includes("الصنف المطلوب: زبادي يوناني - 200 جرام - 200 جم"));

  const creamy = findCard(operation, "meals_100g_creamy_chicken_meal");
  assert.strictEqual(creamy.components.product.grams, 300);

  const carb = findCard(operation, "carbs_white_rice_150g");
  assert.strictEqual(carb.components.product.grams, 150);
  assert.strictEqual(carb.badge, "كارب");

  const salad = findCard(operation, "basic_salad");
  assert.strictEqual(salad.badge, "سلطة");
  assert.strictEqual(salad.components.protein.name, "دجاج سبايسي");
  assert.strictEqual(salad.components.protein.grams, 100);
  const proteinSection = salad.sections.find((section) => section.key === "protein");
  assert(proteinSection);
  assert.strictEqual(proteinSection.items[0].grams, 100);
  assert(salad.lines.includes("البروتين المطلوب: دجاج سبايسي - 100 جم"));

  const sandwich = findCard(operation, "sandwiches_halloumi_sandwich");
  assert.strictEqual(sandwich.components.product.grams, undefined, "products without a declared serving weight must not receive fake grams");
  assert.strictEqual(sandwich.badge, "ساندويتش");

  assert.strictEqual(operation.kitchen.addonGroups.length, 1);
  assert.strictEqual(operation.kitchen.addonGroups[0].label, "حلويات");
  assert.strictEqual(operation.kitchen.addonGroups[0].labelI18n.en, "Desserts");
  assert.strictEqual(operation.kitchen.addonGroups[0].items[0].name, "كيكة البرتقال");

  assert.strictEqual(operation.kitchen.mealCount, 6, "dessert add-on must not be counted as a meal card");
  console.log("Complete kitchen weight response checks passed");
})();
