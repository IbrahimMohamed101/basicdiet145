"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const canonical = require("../src/services/subscription/pickupCanonicalPresentationService");
const {
  canonicalKitchenDetailsForRequest,
  sourceSlotToKitchenSlot,
} = require("../src/services/installPickupCanonicalContract");

function mapBy(rows, field = "_id") {
  return new Map(rows.map((row) => [String(row[field]), row]));
}

function buildCatalogMaps() {
  const products = [
    {
      _id: "507f1f77bcf86cd799439011",
      key: "fajita_sourdough",
      itemType: "sourdough",
      name: { ar: "فاهيتا", en: "Fajita" },
    },
  ];
  const proteins = [
    {
      _id: "507f1f77bcf86cd799439012",
      key: "eggs",
      name: { ar: "بيض", en: "Eggs" },
    },
  ];
  const carbs = [
    {
      _id: "507f1f77bcf86cd799439013",
      key: "rice",
      name: { ar: "أرز", en: "Rice" },
    },
  ];
  return {
    productById: mapBy(products),
    productByKey: mapBy(products, "key"),
    sandwichById: mapBy(products),
    sandwichByKey: mapBy(products, "key"),
    proteinById: mapBy(proteins),
    proteinByKey: mapBy(proteins, "key"),
    carbById: mapBy(carbs),
    carbByKey: mapBy(carbs, "key"),
    optionById: new Map([
      [proteins[0]._id, proteins[0]],
      [carbs[0]._id, carbs[0]],
    ]),
    optionByKey: new Map([
      [proteins[0].key, proteins[0]],
      [carbs[0].key, carbs[0]],
    ]),
    saladItemById: new Map(),
    saladItemByKey: new Map(),
    addonById: new Map(),
    addonByKey: new Map(),
    addonPlanById: new Map(),
  };
}

function run() {
  const catalogMaps = buildCatalogMaps();
  const sandwichSlot = sourceSlotToKitchenSlot({
    slotIndex: 1,
    slotKey: "slot_1",
    selectionType: "full_meal_product",
    sandwichId: "507f1f77bcf86cd799439011",
  }, 0, catalogMaps);
  assert.strictEqual(sandwichSlot.selectionType, "sandwich");
  assert.strictEqual(sandwichSlot.productId, "507f1f77bcf86cd799439011");
  assert.deepStrictEqual(sandwichSlot.canonicalTitleI18n, {
    ar: "ساندوتش فاهيتا",
    en: "Fajita Sandwich",
  });

  const mealSlot = sourceSlotToKitchenSlot({
    slotIndex: 2,
    slotKey: "slot_2",
    selectionType: "standard_meal",
    selectedOptions: [
      {
        optionId: "507f1f77bcf86cd799439012",
        optionKey: "eggs",
        canonicalGroupKey: "protein",
        groupKey: "protein",
      },
      {
        optionId: "507f1f77bcf86cd799439013",
        optionKey: "rice",
        canonicalGroupKey: "carbs",
        groupKey: "carbs",
      },
    ],
  }, 1, catalogMaps);
  assert.strictEqual(mealSlot.selectionType, "standard_meal");
  assert.strictEqual(mealSlot.proteinKey, "eggs");
  assert.strictEqual(mealSlot.carbSelections[0].key, "rice");
  assert.deepStrictEqual(mealSlot.canonicalTitleI18n, {
    ar: "بيض + أرز",
    en: "Eggs + Rice",
  });

  const sourceDay = {
    _id: "507f1f77bcf86cd799439020",
    subscriptionId: "507f1f77bcf86cd799439021",
    date: "2026-07-21",
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        selectionType: "full_meal_product",
        sandwichId: "507f1f77bcf86cd799439011",
      },
      {
        slotIndex: 2,
        slotKey: "slot_2",
        selectionType: "standard_meal",
        selectedOptions: [
          {
            optionId: "507f1f77bcf86cd799439012",
            optionKey: "eggs",
            canonicalGroupKey: "protein",
            groupKey: "protein",
          },
          {
            optionId: "507f1f77bcf86cd799439013",
            optionKey: "rice",
            canonicalGroupKey: "carbs",
            groupKey: "carbs",
          },
        ],
      },
    ],
    addonSelections: [],
  };
  const request = {
    mealCount: 2,
    selectedMealSlotIds: ["slot_1", "slot_2"],
    selectedPickupItemIds: ["slot_1", "slot_2"],
    selectedPickupItems: [],
    snapshot: { mealSlots: [], selectedPickupItems: [], addons: [] },
  };
  const details = canonicalKitchenDetailsForRequest(request, sourceDay, catalogMaps);
  assert.strictEqual(details.mealSlots.length, 2);
  assert.strictEqual(details.mealSlots[0].selectionType, "sandwich");
  assert.deepStrictEqual(details.mealSlots[1].canonicalTitleI18n, {
    ar: "بيض + أرز",
    en: "Eggs + Rice",
  });

  const salad = canonical.normalizePickupItem({
    itemId: "slot_3",
    itemType: "large_salad",
    selectionType: "premium_large_salad",
    product: { name: { ar: "بيض", en: "Eggs" } },
    components: [
      {
        id: "507f1f77bcf86cd799439012",
        type: "protein",
        groupKey: "protein",
        name: { ar: "بيض", en: "Eggs" },
      },
    ],
  });
  assert.deepStrictEqual(salad.title, {
    ar: "سلطة كبيرة + بيض",
    en: "Large Salad + Eggs",
  });

  const addon = canonical.normalizePickupItem({
    itemId: "addon_1",
    itemType: "addon",
    selectionType: "addon",
    product: {
      id: "507f1f77bcf86cd799439014",
      name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" },
    },
  });
  assert.deepStrictEqual(addon.title, {
    ar: "آيس كريم شوكولاتة",
    en: "Chocolate Ice Cream",
  });

  console.log("pickup canonical Flutter/Ops contract checks passed");
}

run();
