"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const Setting = require("../src/models/Setting");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MealCategory = require("../src/models/MealCategory");
const Meal = require("../src/models/Meal");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const dateUtils = require("../src/utils/date");
const { performDaySelectionUpdate } = require("../src/services/subscription/subscriptionSelectionService");
const { mapSubscriptionPickupRequestToDTO } = require("../src/services/dashboard/dashboardDtoService");
const { buildKitchenDetailsPayload } = require("../src/services/dashboard/opsPayloadService");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

const TEST_TAG = `pickup-slot-append-${Date.now()}`;
const TEST_KEY_PREFIX = TEST_TAG.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
const TODAY = dateUtils.getTodayKSADate();
const START_DATE = dateUtils.addDaysToKSADateString(TODAY, -7);
const END_DATE = dateUtils.addDaysToKSADateString(TODAY, 30);
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const IDS = {
  regularProtein: "507f191e810c19729de870a1",
  premiumProtein: "507f191e810c19729de870a2",
  carbOne: "507f191e810c19729de870b1",
};
const results = { passed: 0, failed: 0 };

function token(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function auth(userToken) {
  return { Authorization: `Bearer ${userToken}` };
}

async function dashboardHeaders(role) {
  const user = await DashboardUser.create({
    email: `${TEST_TAG}-${role}-${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash: "test-only",
    role,
    isActive: true,
  });
  return {
    Authorization: `Bearer ${issueDashboardAccessToken(user)}`,
    "Accept-Language": "en",
  };
}

async function dashboardAction(api, headers, action, requestId, payload = {}) {
  return api.post(`/api/dashboard/ops/actions/${action}`).set(headers).send({
    entityType: "subscription_pickup_request",
    entityId: String(requestId),
    payload,
  });
}

async function fulfillPickupRequest(api, headers, requestId) {
  await dashboardAction(api, headers, "start_preparation", requestId);
  await dashboardAction(api, headers, "ready_for_pickup", requestId);
  return dashboardAction(api, headers, "fulfill", requestId);
}

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subs = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subIds = subs.map((sub) => sub._id);
  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    DashboardUser.deleteMany({ email: { $regex: `^${TEST_TAG}` } }),
    MenuProduct.deleteMany({ key: { $regex: `^${TEST_KEY_PREFIX}` } }),
    MenuOption.deleteMany({ key: { $regex: `^${TEST_KEY_PREFIX}` } }),
    MenuOptionGroup.deleteMany({ key: { $regex: `^${TEST_KEY_PREFIX}` } }),
    BuilderProtein.deleteMany({ key: { $regex: `^${TEST_KEY_PREFIX}` } }),
    BuilderCarb.deleteMany({ key: { $regex: `^${TEST_KEY_PREFIX}` } }),
    Setting.deleteMany({ key: { $in: ["restaurant_open_time", "restaurant_close_time", "restaurant_is_open"] } }),
  ]);
}

async function seedSettings() {
  await Setting.deleteMany({ key: { $in: ["restaurant_open_time", "restaurant_close_time", "restaurant_is_open"] } });
  await Setting.create([
    { key: "restaurant_open_time", value: "00:00" },
    { key: "restaurant_close_time", value: "00:00" },
    { key: "restaurant_is_open", value: true },
  ]);
}

async function seedUser(label) {
  return User.create({ phone: `${TEST_TAG}-${label}`, name: label, role: "client", isActive: true });
}

function mealSlot(slotIndex, overrides = {}) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    selectionType: "standard_meal",
    productId: new mongoose.Types.ObjectId(),
    productKey: `product_${slotIndex}`,
    selectedOptions: [{
      groupId: new mongoose.Types.ObjectId(),
      groupKey: "sauce",
      optionId: new mongoose.Types.ObjectId(),
      optionKey: `sauce_${slotIndex}`,
      name: { en: `Sauce ${slotIndex}`, ar: `صوص ${slotIndex}` },
      groupName: { en: "Sauce", ar: "الصوص" },
      quantity: 1,
    }],
    displaySnapshot: {
      product: {
        name: { en: `Meal ${slotIndex}`, ar: `وجبة ${slotIndex}` },
        description: { en: `Meal ${slotIndex} description`, ar: `وصف وجبة ${slotIndex}` },
        image: `https://cdn.example.test/meal-${slotIndex}.jpg`,
        calories: 420 + slotIndex,
        macros: { protein: 35, carbs: 45, fat: 12 },
      },
    },
    fulfillmentSnapshot: { operationalSku: `sku_${slotIndex}`, kitchenLabel: `Meal ${slotIndex}` },
    isPremium: false,
    premiumSource: "none",
    ...overrides,
  };
}

async function seedSubscriptionWithDay({ label, remainingMeals = 5, totalMeals = 10, slots = [mealSlot(1), mealSlot(2)] } = {}) {
  const user = await seedUser(label);
  const subscription = await Subscription.create({
    userId: user._id,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date(`${START_DATE}T00:00:00Z`),
    endDate: new Date(`${END_DATE}T00:00:00Z`),
    validityEndDate: new Date(`${END_DATE}T00:00:00Z`),
    totalMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "main",
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: TODAY,
    status: "open",
    plannerState: "confirmed",
    planningState: "confirmed",
    mealSlots: slots,
    plannerMeta: {
      requiredSlotCount: slots.length,
      completeSlotCount: slots.length,
      partialSlotCount: 0,
      isDraftValid: true,
      isConfirmable: true,
      confirmedAt: new Date(),
    },
  });
  return { user, subscription, day };
}

function mockQuery(result) {
  return {
    session() { return this; },
    lean() { return Promise.resolve(result); },
  };
}

async function withMockedPlannerCatalog(fn) {
  const originals = {
    proteinFind: BuilderProtein.find,
    carbFind: BuilderCarb.find,
    categoryFindOne: MealCategory.findOne,
    mealFind: Meal.find,
    saladFind: SaladIngredient.find,
    sandwichFind: Sandwich.find,
  };
  BuilderProtein.find = () => mockQuery([
    { _id: IDS.regularProtein, isPremium: false, premiumKey: null, displayCategoryKey: "chicken", proteinFamilyKey: "chicken", ruleTags: [], extraFeeHalala: 0 },
    { _id: IDS.premiumProtein, isPremium: true, premiumKey: "shrimp", displayCategoryKey: "premium", proteinFamilyKey: "fish", ruleTags: ["premium"], extraFeeHalala: 1500 },
  ]);
  BuilderCarb.find = () => mockQuery([{ _id: IDS.carbOne, isActive: true, availableForSubscription: true, displayCategoryKey: "standard_carbs" }]);
  MealCategory.findOne = () => mockQuery(null);
  Meal.find = () => mockQuery([]);
  SaladIngredient.find = () => mockQuery([]);
  Sandwich.find = () => mockQuery([]);
  try {
    await fn();
  } finally {
    BuilderProtein.find = originals.proteinFind;
    BuilderCarb.find = originals.carbFind;
    MealCategory.findOne = originals.categoryFindOne;
    Meal.find = originals.mealFind;
    SaladIngredient.find = originals.saladFind;
    Sandwich.find = originals.sandwichFind;
  }
}

function legacySlot({ premium = false } = {}) {
  return {
    slotIndex: 1,
    selectionType: premium ? "premium_meal" : "standard_meal",
    proteinId: premium ? IDS.premiumProtein : IDS.regularProtein,
    carbs: [{ carbId: IDS.carbOne, grams: 150 }],
  };
}

async function seedCanonicalMenuFixture(label) {
  const suffix = `${TEST_KEY_PREFIX}_${label}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const group = await MenuOptionGroup.create({
    key: `${suffix}_protein_group`,
    name: { ar: "البروتين", en: "Protein" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const product = await MenuProduct.create({
    categoryId: new mongoose.Types.ObjectId(),
    key: `${suffix}_meal`,
    name: { ar: label.includes("premium") ? "وجبة سلمون مميزة" : "وجبة دجاج عادية", en: label.includes("premium") ? "Premium Salmon Meal" : "Standard Chicken Meal" },
    description: { ar: "وصف الوجبة المختارة", en: "Selected meal description" },
    imageUrl: `https://cdn.example.test/${suffix}.jpg`,
    pricingModel: "fixed",
    priceHalala: 2500,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const option = await MenuOption.create({
    groupId: group._id,
    key: `${suffix}_option`,
    name: { ar: label.includes("premium") ? "سلمون" : "دجاج مشوي", en: label.includes("premium") ? "Salmon" : "Grilled chicken" },
    extraPriceHalala: 0,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  return { product, group, option };
}

function catalogOnlySlot(slotIndex, fixture, overrides = {}) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    selectionType: "standard_meal",
    productId: fixture.product._id,
    productKey: fixture.product.key,
    selectedOptions: [{
      groupId: fixture.group._id,
      groupKey: fixture.group.key,
      optionId: fixture.option._id,
      optionKey: fixture.option.key,
      quantity: 1,
    }],
    fulfillmentSnapshot: { operationalSku: `${fixture.product.key}:${fixture.option.key}` },
    isPremium: false,
    premiumSource: "none",
    ...overrides,
  };
}

async function seedLegacyBuilderFixture(label, { premium = false } = {}) {
  const suffix = `${TEST_KEY_PREFIX}_${label}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const protein = await BuilderProtein.create({
    key: `${suffix}_protein`,
    name: { ar: premium ? "سالمون" : "كرات لحم", en: premium ? "Salmon" : "Meatballs" },
    description: { ar: premium ? "بروتين مميز" : "بروتين عادي", en: premium ? "Premium protein" : "Standard protein" },
    imageUrl: `https://cdn.example.test/${suffix}-protein.jpg`,
    displayCategoryId: new mongoose.Types.ObjectId(),
    displayCategoryKey: premium ? "premium" : "beef",
    proteinFamilyKey: premium ? "fish" : "beef",
    selectionType: premium ? "premium_meal" : "standard_meal",
    isPremium: premium,
    premiumKey: premium ? `${suffix}_premium` : undefined,
    extraFeeHalala: premium ? 2000 : 0,
    nutrition: { calories: premium ? 210 : 280, proteinGrams: 30, carbGrams: 0, fatGrams: 8 },
    availableForSubscription: true,
    isActive: true,
  });
  const carb = await BuilderCarb.create({
    key: `${suffix}_carb`,
    name: { ar: "رز بالكركم", en: "Turmeric Rice" },
    description: { ar: "كارب الوجبة", en: "Meal carb" },
    displayCategoryId: new mongoose.Types.ObjectId(),
    displayCategoryKey: "standard_carbs",
    nutrition: { calories: 200, proteinGrams: 4, carbGrams: 44, fatGrams: 1 },
    availableForSubscription: true,
    isActive: true,
  });
  return { protein, carb };
}

function legacyBuilderSlot(slotIndex, fixture, { premium = false } = {}) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    proteinId: fixture.protein._id,
    proteinDisplayCategoryKey: premium ? "premium" : "beef",
    proteinFamilyKey: premium ? "fish" : "beef",
    proteinRuleTags: [],
    selectionType: premium ? "premium_meal" : "standard_meal",
    productId: null,
    productKey: null,
    carbs: [{ carbId: fixture.carb._id, grams: 150 }],
    isPremium: premium,
    premiumKey: premium ? fixture.protein.premiumKey : fixture.protein.key,
    premiumSource: premium ? "balance" : "none",
    premiumExtraFeeHalala: 0,
  };
}

(async function run() {
  try {
    await connect();
    await cleanup();
    await seedSettings();
    const api = request(createApp());
    const kitchenHeaders = await dashboardHeaders("kitchen");
    const adminHeaders = await dashboardHeaders("admin");

    await test("slot-based pickup request reserves selected slot only", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "slot-create" });
      const res = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token(user._id)))
        .send({ date: TODAY, selectedMealSlotIds: ["slot_1"], idempotencyKey: `${TEST_TAG}-slot-create` });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body.data.selectedMealSlotIds, ["slot_1"]);
      const stored = await SubscriptionPickupRequest.findById(res.body.data.requestId).lean();
      assert.strictEqual(stored.mealCount, 1);
      assert.strictEqual(stored.selectionMode, "slot_ids");
      assert.strictEqual(stored.snapshot.mealSlots.length, 1);
      const sub = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(sub.remainingMeals, 4);
    });

    await test("same slot reuse is blocked while another request reserves it", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "reuse-block" });
      const headers = auth(token(user._id));
      const first = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      const second = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(second.status, 422, JSON.stringify(second.body));
      assert.strictEqual(second.body.error.code, "MEAL_SLOT_UNAVAILABLE");
    });

    await test("multiple same-date requests can select different slots", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "multi-slot" });
      const headers = auth(token(user._id));
      const first = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      const second = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_2"] });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));
      const sub = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(sub.remainingMeals, 3);
    });

    await test("pickup availability hides reserved and unpaid slots", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability",
        slots: [mealSlot(1), mealSlot(2, { isPremium: true, premiumSource: "pending_payment", premiumExtraFeeHalala: 1500 })],
      });
      const headers = auth(token(user._id));
      await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body.data.availableSlotIds, []);
      const reasons = new Map(res.body.data.slots.map((slot) => [slot.slotId, slot.unavailableReason]));
      assert.strictEqual(reasons.get("slot_1"), "SLOT_ALREADY_RESERVED");
      assert.strictEqual(reasons.get("slot_2"), "PREMIUM_PAYMENT_REQUIRED");
    });

    await test("pickup availability slots include UI-ready meal, payment, and display fields", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability-ui",
        slots: [mealSlot(1, { isPremium: true, premiumSource: "paid_extra", premiumExtraFeeHalala: 0 })],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.slotId, "slot_1");
      assert.strictEqual(slot.available, true);
      assert.strictEqual(slot.canSelect, true);
      assert.strictEqual(slot.product.name.ar, "وجبة 1");
      assert.strictEqual(slot.product.name.en, "Meal 1");
      assert.strictEqual(slot.product.image, "https://cdn.example.test/meal-1.jpg");
      assert.strictEqual(slot.product.calories, 421);
      assert.strictEqual(slot.product.macros.protein, 35);
      assert.strictEqual(slot.meal.title.ar, "وجبة 1");
      assert.strictEqual(slot.meal.mealType, "standard_meal");
      assert.strictEqual(slot.options[0].key, "sauce_1");
      assert.strictEqual(slot.payment.required, false);
      assert.strictEqual(slot.payment.status, "paid");
      assert(slot.display.badgesAr.includes("وجبة مميزة"));
      assert(slot.display.badgesAr.includes("مدفوعة"));
      assert.strictEqual(slot.display.statusTextAr, "متاحة للاستلام");
      assert.strictEqual(slot.display.selectionTextAr, "اختر هذه الوجبة للاستلام");
      assert.strictEqual(res.body.data.wallet.remainingMeals, 5);
      assert.strictEqual(res.body.data.wallet.totalEntitlement, 10);
      assert.strictEqual(res.body.data.summary.availableCount, 1);
      assert.strictEqual(res.body.data.summary.canCreatePickupRequest, true);
      assert.strictEqual(res.body.data.summary.titleAr, "وجبات متاحة للاستلام");
    });

    await test("pickup availability hydrates standard slot names and options from planner catalog ids", async () => {
      const fixture = await seedCanonicalMenuFixture("standard");
      const { user, subscription, day } = await seedSubscriptionWithDay({
        label: "availability-standard-catalog",
        slots: [catalogOnlySlot(1, fixture)],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.product.id, String(fixture.product._id));
      assert.strictEqual(slot.product.key, fixture.product.key);
      assert.strictEqual(slot.product.name.ar, "وجبة دجاج عادية");
      assert.strictEqual(slot.product.name.en, "Standard Chicken Meal");
      assert.strictEqual(slot.product.description.ar, "وصف الوجبة المختارة");
      assert.strictEqual(slot.product.image, fixture.product.imageUrl);
      assert.strictEqual(slot.meal.title.ar, "وجبة دجاج عادية");
      assert.strictEqual(slot.meal.title.en, "Standard Chicken Meal");
      assert.strictEqual(slot.display.titleAr, "وجبة دجاج عادية");
      assert.strictEqual(slot.display.titleEn, "Standard Chicken Meal");
      assert.notStrictEqual(slot.display.titleAr, "slot_1");
      assert.strictEqual(slot.options[0].id, String(fixture.option._id));
      assert.strictEqual(slot.options[0].name.ar, "دجاج مشوي");
      assert.strictEqual(slot.options[0].name.en, "Grilled chicken");
      assert.strictEqual(slot.options[0].groupName.ar, "البروتين");

      const storedDay = await SubscriptionDay.findById(day._id).lean();
      const kitchenAr = buildKitchenDetailsPayload(storedDay, subscription, "ar", {
        productById: new Map([[String(fixture.product._id), fixture.product.toObject()]]),
        productByKey: new Map([[fixture.product.key, fixture.product.toObject()]]),
        optionById: new Map([[String(fixture.option._id), fixture.option.toObject()]]),
        optionByKey: new Map([[fixture.option.key, fixture.option.toObject()]]),
        groupById: new Map([[String(fixture.group._id), fixture.group.toObject()]]),
        groupByKey: new Map([[fixture.group.key, fixture.group.toObject()]]),
      });
      assert.strictEqual(slot.display.titleAr, kitchenAr.mealSlots[0].productName);
    });

    await test("pickup availability hydrates premium slot names from selected premium product", async () => {
      const fixture = await seedCanonicalMenuFixture("premium");
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability-premium-catalog",
        slots: [catalogOnlySlot(1, fixture, {
          selectionType: "premium_meal",
          isPremium: true,
          premiumSource: "balance",
          premiumKey: "salmon",
        })],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.product.name.ar, "وجبة سلمون مميزة");
      assert.strictEqual(slot.product.name.en, "Premium Salmon Meal");
      assert.strictEqual(slot.meal.title.ar, "وجبة سلمون مميزة");
      assert.strictEqual(slot.display.titleAr, "وجبة سلمون مميزة");
      assert.notStrictEqual(slot.display.titleAr, "slot_1");
      assert(slot.display.badgesAr.includes("وجبة مميزة"));
      assert.strictEqual(slot.canSelect, true);
    });

    await test("pickup availability hydrates live-shaped legacy builder slots", async () => {
      const standard = await seedLegacyBuilderFixture("legacy_standard", { premium: false });
      const premium = await seedLegacyBuilderFixture("legacy_premium", { premium: true });
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability-legacy-builder",
        slots: [
          legacyBuilderSlot(1, standard, { premium: false }),
          legacyBuilderSlot(2, premium, { premium: true }),
        ],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const standardSlot = res.body.data.slots.find((slot) => slot.slotId === "slot_1");
      const premiumSlot = res.body.data.slots.find((slot) => slot.slotId === "slot_2");
      assert.strictEqual(standardSlot.product.id, String(standard.protein._id));
      assert.strictEqual(standardSlot.product.key, standard.protein.key);
      assert.strictEqual(standardSlot.product.name.ar, "كرات لحم / رز بالكركم");
      assert.strictEqual(standardSlot.meal.title.en, "Meatballs / Turmeric Rice");
      assert.strictEqual(standardSlot.display.titleAr, "كرات لحم / رز بالكركم");
      assert.notStrictEqual(standardSlot.display.titleAr, "slot_1");
      assert.strictEqual(standardSlot.options.length, 2);
      assert.strictEqual(standardSlot.options[0].name.ar, "كرات لحم");
      assert.strictEqual(standardSlot.options[0].groupName.ar, "البروتين");
      assert.strictEqual(standardSlot.options[1].name.en, "Turmeric Rice");
      assert.strictEqual(standardSlot.product.calories, 480);

      assert.strictEqual(premiumSlot.product.id, String(premium.protein._id));
      assert.strictEqual(premiumSlot.product.name.ar, "سالمون / رز بالكركم");
      assert.strictEqual(premiumSlot.display.titleAr, "سالمون / رز بالكركم");
      assert.notStrictEqual(premiumSlot.display.titleAr, "slot_2");
      assert(premiumSlot.display.badgesAr.includes("وجبة مميزة"));
    });

    await test("pickup request selected snapshot and dashboard queue keep resolved legacy meal names", async () => {
      const fixture = await seedLegacyBuilderFixture("legacy_snapshot", { premium: true });
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "snapshot-legacy-builder",
        slots: [legacyBuilderSlot(1, fixture, { premium: true })],
      });
      const headers = auth(token(user._id));
      const availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
      const availabilityTitle = availability.body.data.slots[0].display.titleAr;
      assert.strictEqual(availabilityTitle, "سالمون / رز بالكركم");

      const created = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(headers)
        .send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(created.status, 200, JSON.stringify(created.body));
      const stored = await SubscriptionPickupRequest.findById(created.body.data.requestId).lean();
      assert.strictEqual(stored.snapshot.mealSlots[0].displaySnapshot.product.name.ar, availabilityTitle);
      assert.strictEqual(stored.snapshot.mealSlots[0].confirmationSnapshot.selectedOptions[0].optionName.ar, "سالمون");

      const queue = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);
      assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
      const row = queue.body.data.items.find((item) => item.ids.pickupRequestId === created.body.data.requestId);
      assert(row, JSON.stringify(queue.body.data.items));
      assert.strictEqual(row.kitchen.meals[0].product.displayName, availabilityTitle);
      assert.strictEqual(row.kitchen.meals[0].display.titleAr.includes("سالمون"), true);
    });

    await test("pickup availability uses human Arabic label when slot has no source name", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability-no-name-fallback",
        slots: [{
          slotIndex: 1,
          slotKey: "slot_1",
          status: "complete",
          selectionType: "standard_meal",
          selectedOptions: [],
          isPremium: false,
          premiumSource: "none",
        }],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.display.titleAr, "وجبة عادية");
      assert.strictEqual(slot.meal.title.ar, "وجبة عادية");
      assert.notStrictEqual(slot.display.titleAr, "slot_1");
    });

    await test("pickup availability unpaid premium slot includes blocking payment UI", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({
        label: "availability-premium-unpaid",
        slots: [mealSlot(1, { isPremium: true, premiumSource: "pending_payment", premiumExtraFeeHalala: 1500 })],
      });
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.available, false);
      assert.strictEqual(slot.canSelect, false);
      assert.strictEqual(slot.unavailableReason, "PREMIUM_PAYMENT_REQUIRED");
      assert.strictEqual(slot.payment.required, true);
      assert.strictEqual(slot.payment.status, "pending");
      assert.strictEqual(slot.payment.premiumRequired, true);
      assert.strictEqual(slot.payment.amountDue, 15);
      assert.strictEqual(slot.display.unavailableTextAr, "يجب إتمام دفع ترقية الوجبة أولا");
    });

    await test("pickup availability unpaid addon slot includes blocking payment UI", async () => {
      const { user, subscription, day } = await seedSubscriptionWithDay({ label: "availability-addon-ui", slots: [mealSlot(1)] });
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $set: {
            addonSelections: [{
              addonId: new mongoose.Types.ObjectId(),
              key: "protein_bar",
              name: "Protein Bar",
              category: "extra",
              source: "pending_payment",
              priceHalala: 500,
              currency: "SAR",
            }],
          },
        }
      );
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.available, false);
      assert.strictEqual(slot.canSelect, false);
      assert.strictEqual(slot.unavailableReason, "ADDON_PAYMENT_REQUIRED");
      assert.strictEqual(slot.payment.required, true);
      assert.strictEqual(slot.payment.addonRequired, true);
      assert.strictEqual(slot.payment.amountDue, 5);
      assert.strictEqual(slot.addons[0].name.en, "Protein Bar");
      assert.strictEqual(slot.addons[0].paymentStatus, "pending");
      assert.strictEqual(slot.display.unavailableTextAr, "يجب إتمام دفع الإضافات أولا");
    });

    await test("pickup availability reserved slot includes reservation id and Arabic display text", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "availability-reserved-ui", slots: [mealSlot(1)] });
      const headers = auth(token(user._id));
      const created = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(created.status, 200, JSON.stringify(created.body));
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.canSelect, false);
      assert.strictEqual(slot.unavailableReason, "SLOT_ALREADY_RESERVED");
      assert.strictEqual(slot.reservedByPickupRequestId, created.body.data.requestId);
      assert.strictEqual(slot.display.unavailableTextAr, "تم طلب استلام هذه الوجبة بالفعل");
    });

    await test("pickup availability fulfilled slot includes fulfilled Arabic display text", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "availability-fulfilled-ui", remainingMeals: 2, slots: [mealSlot(1)] });
      const headers = auth(token(user._id));
      const created = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(created.status, 200, JSON.stringify(created.body));
      const fulfill = await fulfillPickupRequest(api, kitchenHeaders, created.body.data.requestId);
      assert.strictEqual(fulfill.status, 200, JSON.stringify(fulfill.body));
      const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const slot = res.body.data.slots[0];
      assert.strictEqual(slot.available, false);
      assert.strictEqual(slot.canSelect, false);
      assert.strictEqual(slot.unavailableReason, "SLOT_ALREADY_FULFILLED");
      assert.strictEqual(slot.display.unavailableTextAr, "تم استلام هذه الوجبة");
    });

    await test("idempotency returns same request for same payload and conflicts on changed payload", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "idempotency" });
      const headers = auth(token(user._id));
      const body = { date: TODAY, selectedMealSlotIds: ["slot_1"], idempotencyKey: `${TEST_TAG}-idem` };
      const first = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send(body);
      const retry = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send(body);
      const conflict = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ ...body, selectedMealSlotIds: ["slot_2"] });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(retry.status, 200, JSON.stringify(retry.body));
      assert.strictEqual(retry.body.data.requestId, first.body.data.requestId);
      assert.strictEqual(conflict.status, 409, JSON.stringify(conflict.body));
      assert.strictEqual(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
    });

    await test("legacy mealCount cannot bypass reserved slot availability", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "legacy-safe" });
      const headers = auth(token(user._id));
      await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      const res = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, mealCount: 2 });
      assert.strictEqual(res.status, 422, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "MEAL_SLOT_UNAVAILABLE");
    });

    await test("dashboard pickup snapshot includes exact selected slot only", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "dashboard-snapshot" });
      const headers = auth(token(user._id));
      const res = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_2"] });
      const pickup = await SubscriptionPickupRequest.findById(res.body.data.requestId).lean();
      const dto = mapSubscriptionPickupRequestToDTO(pickup, subscription, user, "kitchen", "en");
      assert.strictEqual(dto.entityType, "subscription_pickup_request");
      assert.strictEqual(dto.kitchenDetails.mealSlots.length, 1);
      assert.strictEqual(dto.kitchenDetails.mealSlots[0].slotKey, "slot_2");
      assert.strictEqual(dto.paymentValidity.canPrepare, true);
    });

    await test("dashboard pickup queue returns separate request rows with selected-only meals", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "dashboard-queue" });
      const headers = auth(token(user._id));
      const first = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      const second = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_2"] });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));

      const queue = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);
      assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
      const rows = queue.body.data.items.filter((item) => [
        first.body.data.requestId,
        second.body.data.requestId,
      ].includes(item.ids.pickupRequestId));
      assert.strictEqual(rows.length, 2, JSON.stringify(queue.body.data.items));
      const byId = new Map(rows.map((row) => [row.ids.pickupRequestId, row]));
      assert.strictEqual(byId.get(first.body.data.requestId).ids.entityType, "subscription_pickup_request");
      assert.deepStrictEqual(byId.get(first.body.data.requestId).kitchen.meals.map((meal) => meal.slotKey), ["slot_1"]);
      assert.deepStrictEqual(byId.get(second.body.data.requestId).kitchen.meals.map((meal) => meal.slotKey), ["slot_2"]);
    });

    await test("append basic slots is wallet-neutral and adds after max slotIndex", async () => {
      await withMockedPlannerCatalog(async () => {
        const existingSlot = { ...legacySlot(), slotIndex: 1, slotKey: "slot_1", status: "complete" };
        const { user, subscription, day } = await seedSubscriptionWithDay({ label: "append-basic", slots: [existingSlot], totalMeals: 3, remainingMeals: 3 });
        await performDaySelectionUpdate({
          userId: user._id,
          subscriptionId: subscription._id,
          date: TODAY,
          mealSlots: [legacySlot()],
          appendOnly: true,
        });
        const updated = await SubscriptionDay.findById(day._id).lean();
        assert.deepStrictEqual(updated.mealSlots.map((slot) => slot.slotIndex), [1, 2]);
        assert.strictEqual(updated.mealSlots[0].slotKey, "slot_1", "old slot is preserved");
        assert.strictEqual(updated.mealSlots[1].slotKey, "slot_2", "new slot is appended after max slotIndex");
        const sub = await Subscription.findById(subscription._id).lean();
        assert.strictEqual(sub.remainingMeals, 3);
        const availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
        assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
        assert(availability.body.data.availableSlotIds.includes("slot_2"), "appended basic slot should be available");
      });
    });

    await test("append premium unpaid slot blocks pickup until simulated settlement", async () => {
      await withMockedPlannerCatalog(async () => {
        const existingSlot = { ...legacySlot(), slotIndex: 1, slotKey: "slot_1", status: "complete" };
        const { user, subscription, day } = await seedSubscriptionWithDay({ label: "append-premium", slots: [existingSlot], totalMeals: 2, remainingMeals: 5 });
        const result = await performDaySelectionUpdate({
          userId: user._id,
          subscriptionId: subscription._id,
          date: TODAY,
          mealSlots: [legacySlot({ premium: true })],
          appendOnly: true,
        });
        assert.strictEqual(result.paymentRequirement.requiresPayment, true);
        assert.strictEqual(result.paymentRequirement.blockingReason, "PREMIUM_PAYMENT_REQUIRED");

        let availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
        assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
        const appendedPremium = availability.body.data.slots.find((slot) => slot.slotId === "slot_2");
        assert(appendedPremium, "appended premium slot should be listed");
        assert.strictEqual(appendedPremium.available, false);
        assert.strictEqual(appendedPremium.unavailableReason, "PREMIUM_PAYMENT_REQUIRED");
        const blocked = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`)
          .set(auth(token(user._id)))
          .send({ date: TODAY, selectedMealSlotIds: ["slot_2"] });
        assert.strictEqual(blocked.status, 422, JSON.stringify(blocked.body));
        assert.strictEqual(blocked.body.error.code, "PREMIUM_PAYMENT_REQUIRED");

        await SubscriptionDay.updateOne(
          { _id: day._id, "mealSlots.slotKey": "slot_2" },
          { $set: { "mealSlots.$.premiumSource": "paid_extra", "mealSlots.$.premiumExtraFeeHalala": 0 } }
        );
        availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
        assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
        assert(availability.body.data.availableSlotIds.includes("slot_2"), "paid appended premium slot should be available");
        const created = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`)
          .set(auth(token(user._id)))
          .send({ date: TODAY, selectedMealSlotIds: ["slot_2"] });
        assert.strictEqual(created.status, 200, JSON.stringify(created.body));

        await assert.rejects(
          () => performDaySelectionUpdate({
            userId: user._id,
            subscriptionId: subscription._id,
            date: TODAY,
            mealSlots: [legacySlot()],
            appendOnly: true,
          }),
          (err) => err && err.code === "MEAL_PLANNING_LIMIT_EXCEEDED"
        );
      });
    });

    await test("unpaid addon blocks pickup creation until simulated settlement", async () => {
      const { user, subscription, day } = await seedSubscriptionWithDay({ label: "addon-unpaid", slots: [mealSlot(1)] });
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $set: {
            addonSelections: [{
              addonId: new mongoose.Types.ObjectId(),
              name: "Addon",
              category: "extra",
              source: "pending_payment",
              priceHalala: 500,
              currency: "SAR",
            }],
          },
        }
      );
      const headers = auth(token(user._id));
      let availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
      assert.strictEqual(availability.body.data.slots[0].available, false);
      assert.strictEqual(availability.body.data.slots[0].unavailableReason, "ADDON_PAYMENT_REQUIRED");
      let create = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(create.status, 422, JSON.stringify(create.body));
      assert(["ADDON_PAYMENT_REQUIRED", "PENDING_ADDON_PAYMENT"].includes(create.body.error.code), create.body.error.code);

      await SubscriptionDay.updateOne({ _id: day._id, "addonSelections.source": "pending_payment" }, { $set: { "addonSelections.$.source": "paid" } });
      availability = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(headers);
      assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
      assert.deepStrictEqual(availability.body.data.availableSlotIds, ["slot_1"]);
      create = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(create.status, 200, JSON.stringify(create.body));
    });

    await test("cancel releases credits and makes selected slot reusable", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "cancel-reuse", remainingMeals: 2, slots: [mealSlot(1)] });
      const headers = auth(token(user._id));
      const first = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      let sub = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(sub.remainingMeals, 1);
      const cancel = await dashboardAction(api, adminHeaders, "cancel", first.body.data.requestId, { reason: "customer_cancelled" });
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.body));
      sub = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(sub.remainingMeals, 2);
      const second = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));
      assert.notStrictEqual(second.body.data.requestId, first.body.data.requestId);
    });

    await test("no-show consumes credits and leaves selected slot unavailable", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "no-show-lock", remainingMeals: 2, slots: [mealSlot(1)] });
      const headers = auth(token(user._id));
      const requestRes = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(requestRes.status, 200, JSON.stringify(requestRes.body));
      await dashboardAction(api, kitchenHeaders, "start_preparation", requestRes.body.data.requestId);
      await dashboardAction(api, kitchenHeaders, "ready_for_pickup", requestRes.body.data.requestId);
      const noShow = await dashboardAction(api, adminHeaders, "no_show", requestRes.body.data.requestId, { reason: "customer_no_show" });
      assert.strictEqual(noShow.status, 200, JSON.stringify(noShow.body));
      const sub = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(sub.remainingMeals, 1);
      const retry = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(retry.status, 422, JSON.stringify(retry.body));
      assert.strictEqual(retry.body.error.code, "MEAL_SLOT_UNAVAILABLE");
    });

    await test("fulfill consumes once and duplicate fulfill does not double decrement or release slot", async () => {
      const { user, subscription } = await seedSubscriptionWithDay({ label: "fulfill-once", remainingMeals: 2, slots: [mealSlot(1)] });
      const headers = auth(token(user._id));
      const requestRes = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(requestRes.status, 200, JSON.stringify(requestRes.body));
      assert.strictEqual((await Subscription.findById(subscription._id).lean()).remainingMeals, 1);
      const fulfill = await fulfillPickupRequest(api, kitchenHeaders, requestRes.body.data.requestId);
      assert.strictEqual(fulfill.status, 200, JSON.stringify(fulfill.body));
      assert.strictEqual((await Subscription.findById(subscription._id).lean()).remainingMeals, 1);
      const duplicate = await dashboardAction(api, kitchenHeaders, "fulfill", requestRes.body.data.requestId);
      assert.strictEqual(duplicate.status, 409, JSON.stringify(duplicate.body));
      assert.strictEqual((await Subscription.findById(subscription._id).lean()).remainingMeals, 1);
      const retry = await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(headers).send({ date: TODAY, selectedMealSlotIds: ["slot_1"] });
      assert.strictEqual(retry.status, 422, JSON.stringify(retry.body));
    });
  } finally {
    await cleanup();
    await mongoose.disconnect();
    console.log(`\nBranch pickup slot append tests: ${results.passed} passed, ${results.failed} failed`);
    if (results.failed > 0) process.exit(1);
  }
})();
