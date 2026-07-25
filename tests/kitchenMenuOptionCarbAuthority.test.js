"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOption = require("../src/models/MenuOption");
const SaladIngredient = require("../src/models/SaladIngredient");
const Addon = require("../src/models/Addon");
const Meal = require("../src/models/Meal");
const Sandwich = require("../src/models/Sandwich");
const kitchenCatalogService = require("../src/services/dashboard/kitchenCatalogService");
const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const { completeOperation } = require("../src/services/dashboard/installKitchenOperationalCompletenessGuard");

const IDS = Object.freeze({
  protein: "6a62197479ee075a57f7010e",
  vegetableRice: "6a62198079ee075a57f7013c",
  subscription: "507f191e810c19729de89101",
  day: "507f191e810c19729de89102",
  customer: "507f191e810c19729de89103",
});

const chickenOption = {
  _id: IDS.protein,
  key: "chicken",
  proteinFamilyKey: "chicken",
  displayCategoryKey: "chicken",
  selectionType: "standard_meal",
  name: { ar: "دجاج", en: "Chicken" },
};

const vegetableRiceOption = {
  _id: IDS.vegetableRice,
  catalogItemId: "6a62198079ee075a57f7013b",
  key: "vegetable_rice",
  displayCategoryKey: "standard_carbs",
  selectionType: "standard_meal",
  name: { ar: "رز بالخضار", en: "Vegetable Rice" },
};

function queryResult(rows) {
  return {
    select() { return this; },
    async lean() { return rows; },
  };
}

function buildDay(mode) {
  return {
    _id: IDS.day,
    subscriptionId: IDS.subscription,
    date: "2026-07-25",
    status: "open",
    createdAt: new Date("2026-07-25T14:58:58.682Z"),
    updatedAt: new Date("2026-07-25T14:59:46.921Z"),
    mealSlots: [
      {
        slotIndex: 3,
        slotKey: "slot_3",
        status: "complete",
        selectionType: "standard_meal",
        proteinId: IDS.protein,
        proteinKey: "chicken",
        proteinNameI18n: { ar: "chicken", en: "chicken" },
        carbs: [
          {
            carbId: IDS.vegetableRice,
            key: null,
            name: "",
            grams: 150,
          },
        ],
      },
    ],
    addonSelections: [],
    ...(mode === "delivery"
      ? {
        deliveryAddressOverride: { city: "Jeddah", district: "زهراء" },
        deliveryWindowOverride: "10:00-12:00",
      }
      : {}),
  };
}

function buildSubscription(mode) {
  return {
    _id: IDS.subscription,
    userId: IDS.customer,
    status: "active",
    deliveryMode: mode,
    selectedGrams: 100,
    selectedMealsPerDay: 1,
    pickupLocationId: mode === "pickup" ? "main" : null,
    deliveryAddress: mode === "delivery" ? { city: "Jeddah", district: "زهراء" } : null,
    deliveryWindow: mode === "delivery" ? "10:00-12:00" : "",
    planId: {
      _id: "507f191e810c19729de89104",
      name: { ar: "اشتراك اختبار", en: "Test Subscription" },
    },
  };
}

function assertResolvedOperation(operation, mode) {
  assert.strictEqual(operation.mode, mode);
  assert.strictEqual(operation.kitchen.cards.length, 1);
  const card = operation.kitchen.cards[0];
  assert.strictEqual(card.title, "دجاج + رز بالخضار");
  assert.deepStrictEqual(card.titleI18n, {
    ar: "دجاج + رز بالخضار",
    en: "Chicken + Vegetable Rice",
  });
  assert.strictEqual(card.components.protein.id, IDS.protein);
  assert.strictEqual(card.components.protein.key, "chicken");
  assert.strictEqual(card.components.protein.name, "دجاج");
  assert.strictEqual(card.components.protein.nameI18n.en, "Chicken");
  assert.strictEqual(card.components.protein.grams, 100);
  assert.strictEqual(card.components.carbs[0].id, IDS.vegetableRice);
  assert.strictEqual(card.components.carbs[0].key, "vegetable_rice");
  assert.strictEqual(card.components.carbs[0].name, "رز بالخضار");
  assert.strictEqual(card.components.carbs[0].nameI18n.en, "Vegetable Rice");
  assert.strictEqual(card.components.carbs[0].grams, 150);
  assert(card.lines.includes("الكارب: رز بالخضار - 150 جم"));
  assert(!card.warnings.includes("KITCHEN_CARB_INCOMPLETE"));
  assert(!card.warnings.includes("KITCHEN_COMPONENTS_INCOMPLETE"));
  assert(!JSON.stringify(card).includes('"name":""'));
}

(async function run() {
  const models = [
    BuilderProtein,
    BuilderCarb,
    MenuProduct,
    MenuOption,
    SaladIngredient,
    Addon,
    Meal,
    Sandwich,
  ];
  const originals = new Map(models.map((model) => [model, model.find]));

  try {
    for (const model of models) model.find = () => queryResult([]);
    // The production ids in this regression are MenuOption ids. Deliberately keep
    // BuilderProtein/BuilderCarb empty to prove the canonical option authority.
    MenuOption.find = (query) => {
      const serializedQuery = JSON.stringify(query);
      assert(serializedQuery.includes(IDS.protein));
      assert(serializedQuery.includes(IDS.vegetableRice));
      return queryResult([chickenOption, vegetableRiceOption]);
    };

    const pickupDay = buildDay("pickup");
    const deliveryDay = buildDay("delivery");
    const refs = kitchenCatalogService.collectCatalogRefsFromDays([pickupDay, deliveryDay]);
    assert(refs.carbIds.has(IDS.vegetableRice));
    assert(refs.optionIds.has(IDS.vegetableRice));
    assert(refs.proteinIds.has(IDS.protein));
    assert(refs.optionIds.has(IDS.protein));

    const maps = await kitchenCatalogService.buildKitchenCatalogMaps([pickupDay, deliveryDay]);
    assert.strictEqual(maps.carbById.get(IDS.vegetableRice).key, "vegetable_rice");
    assert.deepStrictEqual(maps.carbById.get(IDS.vegetableRice).name, {
      ar: "رز بالخضار",
      en: "Vegetable Rice",
    });
    assert.strictEqual(maps.proteinById.get(IDS.protein).key, "chicken");

    for (const mode of ["pickup", "delivery"]) {
      const day = buildDay(mode);
      const dto = dashboardDtoService.mapSubscriptionDayToDTO(
        day,
        null,
        buildSubscription(mode),
        { _id: IDS.customer, name: "ابراهيم", phone: "+966533333333" },
        "superadmin",
        "ar",
        maps
      );
      assertResolvedOperation(completeOperation(dto), mode);
    }

    console.log("MenuOption carb authority resolves pickup and delivery names");
  } finally {
    for (const [model, originalFind] of originals.entries()) model.find = originalFind;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
