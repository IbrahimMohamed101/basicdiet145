"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const installation = require("../src/services/dashboard/installKitchenPreparationContract");
const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const kitchenContract = require("../src/services/dashboard/kitchenOperationsContractService");

const IDS = Object.freeze({
  user: "507f191e810c19729de86001",
  subscription: "507f191e810c19729de86002",
  day: "507f191e810c19729de86003",
  order: "507f191e810c19729de86004",
  pickupRequest: "507f191e810c19729de86005",
  chicken65: "507f191e810c19729de86101",
  protein: "507f191e810c19729de86102",
  carb1: "507f191e810c19729de86103",
  carb2: "507f191e810c19729de86104",
  addon: "507f191e810c19729de86105",
});

function maps() {
  const protein = { _id: IDS.protein, key: "chicken", name: { ar: "فاهيتا", en: "Chicken Fajita" } };
  const carb1 = { _id: IDS.carb1, key: "red_sauce_pasta", name: { ar: "باستا صوص أحمر", en: "Red Sauce Pasta" } };
  const carb2 = { _id: IDS.carb2, key: "roasted_potato", name: { ar: "بطاطا مشوية", en: "Roasted Potato" } };
  const product = { _id: IDS.chicken65, key: "chicken_65_meal", name: { ar: "دجاج 65", en: "Chicken 65" } };
  const addon = { _id: IDS.addon, key: "orange_juice", name: { ar: "عصير برتقال", en: "Orange Juice" } };
  return {
    proteinById: new Map([[IDS.protein, protein]]),
    proteinByKey: new Map([[protein.key, protein]]),
    carbById: new Map([[IDS.carb1, carb1], [IDS.carb2, carb2]]),
    carbByKey: new Map([[carb1.key, carb1], [carb2.key, carb2]]),
    productById: new Map([[IDS.chicken65, product]]),
    productByKey: new Map([[product.key, product]]),
    sandwichById: new Map(),
    sandwichByKey: new Map(),
    optionById: new Map(),
    optionByKey: new Map(),
    saladItemById: new Map(),
    saladItemByKey: new Map(),
    addonById: new Map([[IDS.addon, addon]]),
    addonByKey: new Map([[addon.key, addon]]),
    addonPlanById: new Map(),
  };
}

function assertNoFinancialFields(value, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoFinancialFields(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    assert(!/(price|pricing|halala|currency|vat|tax|discount|payment|payable)/.test(lower), `financial field leaked at ${trail}.${key}`);
    assertNoFinancialFields(entry, `${trail}.${key}`);
  }
}

function serialize(dto) {
  return kitchenContract.serializeKitchenOperation(dto);
}

function baseUser() {
  return { _id: IDS.user, name: "عميل الاختبار", phone: "+966500000000" };
}

function baseSubscription(mode, selectedGrams) {
  return {
    _id: IDS.subscription,
    userId: IDS.user,
    status: "active",
    deliveryMode: mode,
    selectedGrams,
    selectedMealsPerDay: 2,
    pickupLocationId: mode === "pickup" ? "branch_1" : "",
    deliveryWindow: mode === "delivery" ? "08:00-11:00" : "",
    deliveryAddress: mode === "delivery" ? { line1: "العنوان 1" } : undefined,
    planId: { name: { ar: "اشتراك اختبار", en: "Test Subscription" } },
  };
}

function selectedMealSlot(slotIndex = 1) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    selectionType: "standard_meal",
    proteinId: IDS.protein,
    proteinFamilyKey: "chicken",
    carbs: [
      { carbId: IDS.carb1, grams: 200 },
      { carbId: IDS.carb2, grams: 100 },
    ],
  };
}

(function run() {
  const verification = installation.installKitchenPreparationContract();
  assert.strictEqual(verification.installed, true);
  assert.strictEqual(verification.flutterTouched, false);

  // One-time product: exact selected product weight is promoted into the
  // canonical kitchen card, while all price/payment fields are removed.
  const order = {
    _id: IDS.order,
    orderNumber: "ORD-KITCHEN-1",
    userId: IDS.user,
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-07-23",
    pickup: { branchId: "branch_1", branchName: { ar: "فرع جدة", en: "Jeddah Branch" } },
    items: [
      {
        itemType: "product",
        productId: IDS.chicken65,
        name: { ar: "دجاج 65", en: "Chicken 65" },
        qty: 1,
        unitPriceHalala: 2400,
        lineTotalHalala: 2400,
        productSnapshot: {
          key: "chicken_65_meal",
          name: { ar: "دجاج 65", en: "Chicken 65" },
          itemType: "product",
          pricingModel: "per_100g",
          weightGrams: 150,
        },
        pricingSnapshot: {
          basePriceHalala: 2400,
          lineTotalHalala: 2400,
          currency: "SAR",
          vatIncluded: true,
        },
      },
      {
        itemType: "addon_item",
        productId: IDS.addon,
        name: { ar: "عصير برتقال", en: "Orange Juice" },
        qty: 2,
        unitPriceHalala: 500,
        lineTotalHalala: 1000,
      },
    ],
    pricing: {
      subtotalHalala: 3400,
      discountHalala: 100,
      vatPercentage: 15,
      vatHalala: 430,
      totalHalala: 3300,
      currency: "SAR",
    },
  };
  const orderDto = dashboardDtoService.mapOrderToDTO(order, null, baseUser(), "kitchen", "ar", maps());
  const orderOperation = serialize(orderDto);
  assert.strictEqual(orderOperation.kitchen.version, "v2");
  assert.strictEqual(orderOperation.kitchen.purpose, "meal_preparation");
  assert.strictEqual(orderOperation.kitchen.financialDataIncluded, false);
  assert.strictEqual(orderOperation.kitchen.cards[0].title, "دجاج 65");
  assert.strictEqual(orderOperation.kitchen.cards[0].titleI18n.en, "Chicken 65");
  assert.strictEqual(orderOperation.kitchen.cards[0].components.product.grams, 150);
  assert(orderOperation.kitchen.cards[0].lines.some((line) => line.includes("150 جم")));
  assert.strictEqual(orderOperation.kitchen.addonGroups[0].items[0].name, "عصير برتقال");
  assert.strictEqual(orderOperation.kitchen.addonGroups[0].items[0].quantity, 2);
  for (const forbidden of ["items", "pricing", "payment", "paymentStatus", "paymentValidity", "orderSummary"]) {
    assert(!Object.prototype.hasOwnProperty.call(orderOperation, forbidden), `${forbidden} must not exist on one-time operations`);
  }
  assertNoFinancialFields(orderOperation.kitchen);

  // Subscription pickup: protein portion and every carb split are explicit.
  const pickupSubscription = baseSubscription("pickup", 165);
  const pickupDay = {
    _id: IDS.day,
    subscriptionId: IDS.subscription,
    date: "2026-07-23",
    status: "open",
    mealSlots: [selectedMealSlot(1)],
    addonSelections: [],
  };
  const pickupDto = dashboardDtoService.mapSubscriptionDayToDTO(
    pickupDay,
    null,
    pickupSubscription,
    baseUser(),
    "kitchen",
    "ar",
    maps()
  );
  const pickupOperation = serialize(pickupDto);
  const pickupCard = pickupOperation.kitchen.cards[0];
  assert.strictEqual(pickupCard.components.protein.grams, 165);
  assert.strictEqual(pickupCard.components.protein.nameI18n.en, "Chicken Fajita");
  assert.deepStrictEqual(pickupCard.components.carbs.map((carb) => carb.grams), [200, 100]);
  assert.deepStrictEqual(pickupCard.components.carbs.map((carb) => carb.quantity), [1, 1]);
  assert(pickupCard.lines.some((line) => line.includes("الكارب 1 من 2") && line.includes("200 جم")));
  assert(pickupCard.lines.some((line) => line.includes("الكارب 2 من 2") && line.includes("100 جم")));

  // Subscription delivery uses the same DTO and gram rules as pickup.
  const deliverySubscription = baseSubscription("delivery", 180);
  const deliveryDay = {
    ...pickupDay,
    _id: "507f191e810c19729de86006",
    status: "ready_for_delivery",
  };
  const deliveryDto = dashboardDtoService.mapSubscriptionDayToDTO(
    deliveryDay,
    null,
    deliverySubscription,
    baseUser(),
    "kitchen",
    "ar",
    maps()
  );
  const deliveryOperation = serialize(deliveryDto);
  assert.strictEqual(deliveryOperation.mode, "delivery");
  assert.strictEqual(deliveryOperation.kitchen.cards[0].components.protein.grams, 180);
  assert.deepStrictEqual(deliveryOperation.kitchen.cards[0].components.carbs.map((carb) => carb.grams), [200, 100]);

  // The startup composition must install the contract before dashboard routes.
  const routesSource = fs.readFileSync(path.join(__dirname, "../src/routes/index.js"), "utf8");
  assert(routesSource.includes('require("../services/dashboard/installKitchenPreparationContract")'));
  assert(routesSource.indexOf("installKitchenPreparationContract") < routesSource.indexOf('require("./dashboardOps")'));

  console.log("Dashboard kitchen preparation contract checks passed.");
})();
