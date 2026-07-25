"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const opsReadServiceV2 = require("../src/services/dashboard/opsReadServiceV2");
const { reconcileAddonInclusions } = require("../src/services/subscription/subscriptionAddonAllocationService");
const { assertCompleteBuilderItems } = require("../src/services/orders/installOneTimeBuilderSelectionContract");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const IDS = Object.freeze({
  dashboardUser: "507f191e810c19729de89001",
  customer: "507f191e810c19729de89002",
  pickupSubscription: "507f191e810c19729de89003",
  deliverySubscription: "507f191e810c19729de89004",
  pickupDay: "507f191e810c19729de89005",
  deliveryDay: "507f191e810c19729de89006",
  protein: "6a62197c79ee075a57f7012c",
  legacyWhiteRice: "6a62198179ee075a57f7013e",
  directProduct: "6a62193a79ee075a57f7003e",
  addonProduct: "6a62196879ee075a57f700ea",
  addonPlan: "6a6219a0f4f8d0974cebc49d",
  addonBucket: "507f191e810c19729de89007",
  basicMeal: "6a62197079ee075a57f70106",
  proteinGroup: "507f191e810c19729de89008",
  carbGroup: "507f191e810c19729de89009",
  proteinOption: "507f191e810c19729de89010",
  carbOption: "507f191e810c19729de89011",
});

const protein = {
  _id: IDS.protein,
  key: "beef",
  proteinFamilyKey: "beef",
  name: { ar: "لحم بقري", en: "Beef" },
};
const whiteRice = {
  _id: "507f191e810c19729de89012",
  key: "white_rice",
  name: { ar: "رز أبيض", en: "White Rice" },
};
const directProduct = {
  _id: IDS.directProduct,
  key: "meals_chicken_white_sauce_pasta",
  name: { ar: "باستا وايت صوص بالدجاج", en: "Chicken White Sauce Pasta" },
};
const juiceProduct = {
  _id: IDS.addonProduct,
  key: "juices_berry_blast",
  name: { ar: "بيري بلاست", en: "Berry Blast" },
};

const maps = {
  proteinById: new Map([[IDS.protein, protein]]),
  proteinByKey: new Map([[protein.key, protein]]),
  carbById: new Map(),
  carbByKey: new Map([[whiteRice.key, whiteRice], ["carbs_white_rice", whiteRice]]),
  optionById: new Map([[IDS.protein, protein]]),
  optionByKey: new Map([[protein.key, protein], [whiteRice.key, whiteRice]]),
  productById: new Map([[IDS.directProduct, directProduct], [IDS.addonProduct, juiceProduct]]),
  productByKey: new Map([[directProduct.key, directProduct], [juiceProduct.key, juiceProduct]]),
  sandwichById: new Map(),
  sandwichByKey: new Map(),
  saladItemById: new Map(),
  saladItemByKey: new Map(),
  addonById: new Map(),
  addonByKey: new Map(),
  addonPlanById: new Map(),
};

function customer() {
  return { _id: IDS.customer, name: "عميل الاختبار", phone: "+966500000000" };
}

function subscription(id, mode) {
  return {
    _id: id,
    userId: IDS.customer,
    status: "active",
    deliveryMode: mode,
    selectedGrams: 100,
    selectedMealsPerDay: 2,
    pickupLocationId: mode === "pickup" ? "main" : null,
    deliveryAddress: mode === "delivery" ? { city: "Jeddah", district: "جدة" } : null,
    deliveryWindow: mode === "delivery" ? "12:00-14:00" : "",
    planId: { _id: "507f191e810c19729de89013", name: { ar: "اشتراك اختبار", en: "Test Subscription" } },
  };
}

function rawDay(id, subscriptionId, mode) {
  return {
    _id: id,
    subscriptionId,
    date: "2026-07-25",
    status: "locked",
    createdAt: new Date("2026-07-25T08:00:00.000Z"),
    updatedAt: new Date("2026-07-25T08:05:00.000Z"),
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "standard_meal",
        proteinId: IDS.protein,
        proteinKey: "beef",
        proteinNameI18n: { ar: "beef", en: "beef" },
        carbs: [{ carbId: IDS.legacyWhiteRice, name: "", grams: 150 }],
      },
      {
        slotIndex: 2,
        slotKey: "slot_2",
        status: "complete",
        selectionType: "sandwich",
        productId: IDS.directProduct,
        productKey: directProduct.key,
        productName: "باستا وايت صوص بالدجاج",
        productNameI18n: { ar: "باستا وايت صوص بالدجاج", en: "Chicken" },
      },
    ],
    addonSelections: [],
    ...(mode === "delivery" ? {
      deliveryAddressOverride: { city: "Jeddah", district: "جدة" },
      deliveryWindowOverride: "12:00-14:00",
    } : {}),
  };
}

function buildOperation(id, subscriptionId, mode, role = "kitchen", lang = "ar") {
  const day = rawDay(id, subscriptionId, mode);
  const dto = dashboardDtoService.mapSubscriptionDayToDTO(
    day,
    null,
    subscription(subscriptionId, mode),
    customer(),
    role,
    lang,
    maps
  );
  dto.ui.label = "مغلق";
  dto.statusLabel = "مغلق";
  return dto;
}

function assertCompleteOperation(operation, expectedMode) {
  assert.strictEqual(operation.mode, expectedMode);
  const meal = operation.kitchen.cards[0];
  assert.strictEqual(meal.title, "لحم بقري + رز أبيض");
  assert.strictEqual(meal.titleI18n.en, "Beef + White Rice");
  assert.strictEqual(meal.components.protein.name, "لحم بقري");
  assert.strictEqual(meal.components.protein.grams, 100);
  assert.strictEqual(meal.components.carbs[0].key, "white_rice");
  assert.strictEqual(meal.components.carbs[0].name, "رز أبيض");
  assert.strictEqual(meal.components.carbs[0].nameI18n.en, "White Rice");
  assert.strictEqual(meal.components.carbs[0].grams, 150);
  assert(meal.lines.includes("الكارب: رز أبيض - 150 جم"));
  assert(!meal.warnings.includes("KITCHEN_COMPONENTS_INCOMPLETE"));

  const direct = operation.kitchen.cards[1];
  assert.strictEqual(direct.title, "باستا وايت صوص بالدجاج");
  assert.strictEqual(direct.titleI18n.en, "Chicken White Sauce Pasta");
  assert.strictEqual(direct.components.product.nameI18n.en, "Chicken White Sauce Pasta");
  assert(direct.lines.includes("الصنف المطلوب: باستا وايت صوص بالدجاج"));
}

async function assertAddonProductIdentityPersists() {
  const subscriptionDoc = { addonSubscriptions: [], addonBalance: [] };
  const day = { addonSelections: [] };
  await reconcileAddonInclusions(subscriptionDoc, day, [IDS.addonProduct], {
    resolveChoiceProductById: async (productId) => ({
      product: {
        _id: productId,
        key: "drinks_protein_drink",
        name: { ar: "مشروب بروتين", en: "Protein Drink" },
        imageUrl: "",
        priceHalala: 900,
        currency: "SAR",
        isActive: true,
        isAvailable: true,
        availableForNewSale: true,
      },
      category: { key: "drinks" },
      addonCategory: "drinks",
    }),
  });
  assert.strictEqual(day.addonSelections.length, 1);
  const saved = day.addonSelections[0];
  assert.strictEqual(String(saved.productId), IDS.addonProduct);
  assert.strictEqual(String(saved.menuProductId), IDS.addonProduct);
  assert.strictEqual(String(saved.addonId), IDS.addonProduct);
  assert.strictEqual(saved.productKey, "drinks_protein_drink");
  assert.deepStrictEqual(saved.nameI18n, { ar: "مشروب بروتين", en: "Protein Drink" });
}

function queryModel(rows) {
  return {
    find() {
      return {
        select() { return this; },
        async lean() { return rows; },
      };
    },
  };
}

async function assertOneTimeBuilderValidation() {
  const products = [{ _id: IDS.basicMeal, key: "basic_meal", itemType: "standard_meal", isCustomizable: true }];
  const groups = [
    { _id: IDS.proteinGroup, key: "proteins" },
    { _id: IDS.carbGroup, key: "carbs" },
  ];
  const models = {
    MenuProductModel: queryModel(products),
    MenuOptionGroupModel: queryModel(groups),
  };

  await assert.rejects(
    () => assertCompleteBuilderItems([{ productId: IDS.basicMeal, selectedOptions: [] }], models),
    (error) => error && error.code === "BUILDER_SELECTION_INCOMPLETE"
      && error.details.missingGroups.includes("protein")
      && error.details.missingGroups.includes("carb")
  );

  await assertCompleteBuilderItems([{
    productId: IDS.basicMeal,
    selectedOptions: [
      { groupId: IDS.proteinGroup, optionId: IDS.proteinOption, qty: 1 },
      { groupId: IDS.carbGroup, optionId: IDS.carbOption, qty: 1 },
    ],
  }], models);
}

(async function run() {
  await assertAddonProductIdentityPersists();
  await assertOneTimeBuilderValidation();

  const originalFindById = DashboardUser.findById;
  const originalListOperations = opsReadServiceV2.listOperations;
  DashboardUser.findById = () => ({
    select() { return this; },
    async lean() {
      return { _id: IDS.dashboardUser, role: "superadmin", isActive: true, passwordChangedAt: null };
    },
  });
  opsReadServiceV2.listOperations = async () => [
    buildOperation(IDS.pickupDay, IDS.pickupSubscription, "pickup", "superadmin"),
    buildOperation(IDS.deliveryDay, IDS.deliverySubscription, "delivery", "superadmin"),
  ];

  const token = jwt.sign({
    userId: IDS.dashboardUser,
    role: "superadmin",
    tokenType: "dashboard_access",
  }, DASHBOARD_JWT_SECRET, { expiresIn: "1h" });
  const app = createApp();

  try {
    const response = await request(app)
      .get("/api/dashboard/ops/list?date=2026-07-25")
      .set({ Authorization: `Bearer ${token}`, "Accept-Language": "ar" });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.status, true);
    assert.strictEqual(response.body.data.length, 2);
    const pickup = response.body.data.find((operation) => operation.mode === "pickup");
    const delivery = response.body.data.find((operation) => operation.mode === "delivery");
    assertCompleteOperation(pickup, "pickup");
    assertCompleteOperation(delivery, "delivery");

    const serialized = JSON.stringify(response.body.data);
    assert(!serialized.includes("[object Object]"));
    assert(!serialized.includes('"en":"Chicken"'));
    assert(!serialized.includes('"name":""'));
    console.log("Pickup, delivery, add-on identity, and one-time Builder contracts passed");
  } finally {
    DashboardUser.findById = originalFindById;
    opsReadServiceV2.listOperations = originalListOperations;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
