"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");

require("../src/services/dashboard/installKitchenArabicCatalogAuthority");
require("../src/services/dashboard/installKitchenPreparationContract");
require("../src/services/dashboard/installKitchenFinalNameRepair");

const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const kitchenContract = require("../src/services/dashboard/kitchenOperationsContractService");

const IDS = Object.freeze({
  user: "507f191e810c19729de87001",
  subscription: "507f191e810c19729de87002",
  day: "507f191e810c19729de87003",
  protein: "6a62197579ee075a57f70112",
  carb: "6a62197f79ee075a57f70138",
  sandwich: "507f191e810c19729de87006",
  addonProduct: "507f191e810c19729de87007",
  addonPlan: "507f191e810c19729de87008",
  addonBucket: "507f191e810c19729de87009",
});

function catalogMaps() {
  const protein = {
    _id: IDS.protein,
    key: "chicken",
    proteinFamilyKey: "chicken",
    name: { ar: "دجاج", en: "Chicken" },
  };
  const carb = {
    _id: IDS.carb,
    key: "white_rice",
    name: { ar: "أرز أبيض", en: "White Rice" },
  };
  const sandwich = {
    _id: IDS.sandwich,
    key: "sandwiches_halloumi_sandwich",
    name: { ar: "ساندويتش حلومي", en: "Halloumi Sandwich" },
    imageUrl: "https://example.test/halloumi.jpg",
  };
  const addonProduct = {
    _id: IDS.addonProduct,
    key: "orange_juice",
    name: { ar: "عصير برتقال", en: "Orange Juice" },
  };
  const addonPlan = {
    _id: IDS.addonPlan,
    displayKey: "juice",
    name: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
  };

  return {
    proteinById: new Map([[IDS.protein, protein]]),
    proteinByKey: new Map([[protein.key, protein], [protein.proteinFamilyKey, protein]]),
    carbById: new Map([[IDS.carb, carb]]),
    carbByKey: new Map([[carb.key, carb]]),
    productById: new Map([[IDS.sandwich, sandwich], [IDS.addonProduct, addonProduct]]),
    productByKey: new Map([[sandwich.key, sandwich], [addonProduct.key, addonProduct]]),
    sandwichById: new Map([[IDS.sandwich, sandwich]]),
    sandwichByKey: new Map([[sandwich.key, sandwich]]),
    optionById: new Map([[IDS.protein, protein], [IDS.carb, carb]]),
    optionByKey: new Map([[protein.key, protein], [carb.key, carb]]),
    saladItemById: new Map(),
    saladItemByKey: new Map(),
    addonById: new Map([[IDS.addonProduct, addonProduct]]),
    addonByKey: new Map([[addonProduct.key, addonProduct]]),
    addonPlanById: new Map([[IDS.addonPlan, addonPlan]]),
  };
}

function subscription(mode = "pickup") {
  return {
    _id: IDS.subscription,
    userId: IDS.user,
    status: "active",
    deliveryMode: mode,
    selectedGrams: 100,
    selectedMealsPerDay: 2,
    pickupLocationId: mode === "pickup" ? "main" : null,
    planId: {
      _id: "507f191e810c19729de87010",
      name: { ar: "اشتراك اختبار", en: "Test Subscription" },
    },
    addonSubscriptions: [{
      addonPlanId: IDS.addonPlan,
      balanceBucketId: IDS.addonBucket,
      addonPlanNameI18n: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
      menuProductsSnapshot: [{
        id: IDS.addonProduct,
        key: "orange_juice",
        nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
      }],
    }],
  };
}

function user() {
  return { _id: IDS.user, name: "عميل الاختبار", phone: "+966500000000" };
}

function serializeDay(day, lang = "ar") {
  const dto = dashboardDtoService.mapSubscriptionDayToDTO(
    day,
    null,
    subscription(day.mode || "pickup"),
    user(),
    "kitchen",
    lang,
    catalogMaps()
  );
  return kitchenContract.serializeKitchenOperation(dto);
}

function assertArabic(value, label) {
  assert(/[\u0600-\u06FF]/.test(String(value || "")), `${label} must contain Arabic: ${value}`);
  assert(!/\[object Object\]/i.test(String(value || "")), `${label} must not contain object coercion`);
}

(function run() {
  const poisonedSnapshotDay = {
    _id: IDS.day,
    subscriptionId: IDS.subscription,
    date: "2026-07-25",
    status: "locked",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "standard_meal",
      productName: "chicken",
      productNameI18n: { ar: "chicken", en: "chicken" },
      proteinId: IDS.protein,
      proteinKey: "chicken",
      proteinFamilyKey: "chicken",
      proteinName: "chicken",
      proteinNameI18n: { ar: "chicken", en: "chicken" },
      confirmationSnapshot: {
        protein: { name: "chicken" },
      },
      carbs: [{
        carbId: IDS.carb,
        name: "",
        grams: 150,
      }],
    }],
    addonSelections: [],
  };

  const arabicOperation = serializeDay(poisonedSnapshotDay, "ar");
  const arabicCard = arabicOperation.kitchen.cards[0];

  assert.strictEqual(arabicCard.title, "دجاج + أرز أبيض");
  assert.deepStrictEqual(arabicCard.titleI18n, { ar: "دجاج + أرز أبيض", en: "Chicken + White Rice" });
  assert.strictEqual(arabicCard.components.protein.name, "دجاج");
  assert.strictEqual(arabicCard.components.protein.nameI18n.en, "Chicken");
  assert.strictEqual(arabicCard.components.protein.grams, 100);
  assert.strictEqual(arabicCard.components.carbs[0].name, "أرز أبيض");
  assert.strictEqual(arabicCard.components.carbs[0].nameI18n.en, "White Rice");
  assert.strictEqual(arabicCard.components.carbs[0].grams, 150);
  assert(arabicCard.lines.some((line) => line === "البروتين المطلوب: دجاج - 100 جم"));
  assert(arabicCard.lines.some((line) => line === "الكارب: أرز أبيض - 150 جم"));
  assertArabic(arabicCard.title, "meal title");
  assertArabic(arabicCard.components.protein.name, "protein name");
  assertArabic(arabicCard.components.carbs[0].name, "carb name");
  assert(!JSON.stringify(arabicOperation.kitchen).includes('"ar":"chicken"'));

  const englishOperation = serializeDay(poisonedSnapshotDay, "en");
  const englishCard = englishOperation.kitchen.cards[0];
  assert.strictEqual(englishCard.titleI18n.ar, "دجاج + أرز أبيض");
  assert.strictEqual(englishCard.titleI18n.en, "Chicken + White Rice");
  assert.strictEqual(englishCard.components.carbs[0].grams, 150);

  const directProductDay = {
    _id: "507f191e810c19729de87011",
    subscriptionId: IDS.subscription,
    date: "2026-07-25",
    status: "open",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "sandwich",
      productId: IDS.sandwich,
      productKey: "sandwiches_halloumi_sandwich",
      productName: "ساندوتش ساندويش حلومي",
      productNameI18n: {
        ar: "ساندوتش ساندويش حلومي",
        en: "Halloumi Sandwich",
      },
      sandwichId: IDS.sandwich,
      sandwichKey: "sandwiches_halloumi_sandwich",
    }],
  };
  const directOperation = serializeDay(directProductDay, "ar");
  assert.strictEqual(directOperation.kitchen.cards[0].title, "ساندويتش حلومي");
  assert.strictEqual(directOperation.kitchen.cards[0].components.product.name, "ساندويتش حلومي");

  const addonDay = {
    _id: "507f191e810c19729de87012",
    subscriptionId: IDS.subscription,
    date: "2026-07-25",
    status: "open",
    mealSlots: [],
    addonSelections: [{
      addonPlanId: IDS.addonPlan,
      balanceBucketId: IDS.addonBucket,
      productId: IDS.addonProduct,
      key: "orange_juice",
      name: "orange_juice",
      quantity: 1,
    }],
  };
  const addonOperation = serializeDay(addonDay, "ar");
  assert.strictEqual(addonOperation.kitchen.addonGroups[0].label, "اشتراك العصير والمشروبات");
  assert.strictEqual(addonOperation.kitchen.addonGroups[0].items[0].name, "عصير برتقال");

  const planOnlyAddonDay = {
    ...addonDay,
    _id: "507f191e810c19729de87013",
    addonSelections: [{
      addonPlanId: IDS.addonPlan,
      addonId: IDS.addonPlan,
      balanceBucketId: IDS.addonBucket,
      name: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
      quantity: 1,
    }],
  };
  const planOnlyOperation = serializeDay(planOnlyAddonDay, "ar");
  assert.strictEqual(planOnlyOperation.kitchen.addonGroups[0].items[0].name, "لم يتم تحديد منتج الإضافة");
  assert.strictEqual(planOnlyOperation.kitchen.addonGroups[0].items[0].productId, null);

  console.log("Kitchen Arabic catalog authority checks passed");
})();
