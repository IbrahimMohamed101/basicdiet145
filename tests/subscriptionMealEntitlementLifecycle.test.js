"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "subscription-entitlement-test-secret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const ActivityLog = require("../src/models/ActivityLog");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const Delivery = require("../src/models/Delivery");
const Meal = require("../src/models/Meal");
const MealCategory = require("../src/models/MealCategory");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");

const { executeAction } = require("../src/services/dashboard/opsTransitionService");
const { fulfillSubscriptionDay, fulfillSubscriptionPickupRequest } = require("../src/services/fulfillmentService");
const { applyPaymentSideEffects } = require("../src/services/paymentApplicationService");
const {
  buildCurrentSubscriptionOverview,
} = require("../src/services/subscription/subscriptionClientOverviewService");
const {
  serializeSubscriptionForClient,
} = require("../src/services/subscription/subscriptionClientSerializationService");
const {
  buildMealBalance,
  shapeMealPlannerReadFields,
} = require("../src/services/subscription/subscriptionClientSupportService");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  resolveDayMealsToDeduct,
} = require("../src/services/subscription/subscriptionDayConsumptionService");
const {
  updateDaySelectionForClient,
} = require("../src/services/subscription/subscriptionPlanningClientService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  assertPremiumUpgradeLimit,
  countPersistedPremiumUpgradesForSubscription,
} = require("../src/services/subscription/premiumUpgradeLimitService");
const {
  buildSubscriptionTimeline,
} = require("../src/services/subscription/subscriptionTimelineService");
const {
  createUnifiedDayPaymentFlow,
  verifyUnifiedDayPaymentFlow,
} = require("../src/services/subscription/unifiedDayPaymentService");
const { startSafeSession } = require("../src/utils/mongoTransactionSupport");
const dateUtils = require("../src/utils/date");

const DB_PREFIX = "codex_subscription_entitlement_audit_";
const DB_NAME = `${DB_PREFIX}${Date.now()}`;
const TEST_TAG = `subscription-entitlement-${Date.now()}`;
const PLANNER_IDS = Object.freeze({
  regularProtein: "507f191e810c19729de87101",
  premiumProtein: "507f191e810c19729de87102",
  carb: "507f191e810c19729de87103",
});

const BUSINESS_DATE = dateUtils.getTodayKSADate();
const START_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -1);
const SELECTION_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 3);
const SECOND_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 4);
const END_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 30);

let mongoServer;
const matrix = [];

function asDate(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

function mockQuery(result) {
  return {
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

async function withMockedLegacyPlannerCatalog(work) {
  const originals = {
    proteinFind: BuilderProtein.find,
    proteinFindOne: BuilderProtein.findOne,
    carbFind: BuilderCarb.find,
    categoryFindOne: MealCategory.findOne,
    mealFind: Meal.find,
    saladFind: SaladIngredient.find,
    sandwichFind: Sandwich.find,
  };

  BuilderProtein.find = () => mockQuery([
    {
      _id: PLANNER_IDS.regularProtein,
      isPremium: false,
      premiumKey: null,
      displayCategoryKey: "chicken",
      proteinFamilyKey: "chicken",
      ruleTags: [],
      extraFeeHalala: 0,
    },
    {
      _id: PLANNER_IDS.premiumProtein,
      isPremium: true,
      premiumKey: "salmon",
      displayCategoryKey: "premium",
      proteinFamilyKey: "fish",
      ruleTags: ["premium"],
      extraFeeHalala: 1800,
    },
  ]);
  BuilderProtein.findOne = () => mockQuery({
    _id: PLANNER_IDS.premiumProtein,
    isPremium: true,
    premiumKey: "salmon",
    displayCategoryKey: "premium",
    proteinFamilyKey: "fish",
    ruleTags: ["premium"],
    extraFeeHalala: 1800,
    isActive: true,
    availableForSubscription: true,
  });
  BuilderCarb.find = () => mockQuery([
    {
      _id: PLANNER_IDS.carb,
      isActive: true,
      availableForSubscription: true,
      displayCategoryKey: "standard_carbs",
    },
  ]);
  MealCategory.findOne = () => mockQuery(null);
  Meal.find = () => mockQuery([]);
  SaladIngredient.find = () => mockQuery([]);
  Sandwich.find = () => mockQuery([]);

  try {
    return await work();
  } finally {
    BuilderProtein.find = originals.proteinFind;
    BuilderProtein.findOne = originals.proteinFindOne;
    BuilderCarb.find = originals.carbFind;
    MealCategory.findOne = originals.categoryFindOne;
    Meal.find = originals.mealFind;
    SaladIngredient.find = originals.saladFind;
    Sandwich.find = originals.sandwichFind;
  }
}

function standardSelectionPayload() {
  return {
    mealSlots: [{
      slotIndex: 1,
      selectionType: "standard_meal",
      proteinId: PLANNER_IDS.regularProtein,
      carbs: [{ carbId: PLANNER_IDS.carb, grams: 150 }],
    }],
  };
}

function premiumSelectionPayload() {
  return {
    mealSlots: [{
      slotIndex: 1,
      selectionType: "premium_meal",
      proteinId: PLANNER_IDS.premiumProtein,
      carbs: [{ carbId: PLANNER_IDS.carb, grams: 150 }],
    }],
  };
}

function canonicalFlutterPayloadFixture(fixture) {
  return {
    contractVersion: "meal_planner_menu.v3",
    mealSlots: [{
      slotIndex: 1,
      selectionType: "premium_large_salad",
      productId: String(fixture.premiumLargeSalad._id),
      selectedOptions: [{
        groupId: String(fixture.proteinsGroup._id),
        groupKey: "proteins",
        optionId: String(fixture.chicken._id),
        optionKey: "grilled_chicken",
        quantity: 1,
      }, {
        groupId: String(fixture.sauceGroup._id),
        groupKey: "sauces",
        optionId: String(fixture.sauce._id),
        optionKey: "lemon_sauce",
        quantity: 1,
      }],
    }],
  };
}

async function seedCanonicalPremiumSaladCatalog() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { en: "Custom Order", ar: "Custom Order" },
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { en: "Protein", ar: "Protein" },
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  const sauceGroup = await MenuOptionGroup.create({
    key: "sauces",
    name: { en: "Sauce", ar: "Sauce" },
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  const premiumLargeSalad = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_large_salad",
    itemType: "premium_large_salad",
    name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
    pricingModel: "fixed",
    priceHalala: 3000,
    currency: "SAR",
    availableFor: ["subscription"],
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  const chicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  const sauce = await MenuOption.create({
    groupId: sauceGroup._id,
    key: "lemon_sauce",
    name: { en: "Lemon Sauce", ar: "Lemon Sauce" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isAvailable: true,
    publishedAt: now,
  });
  await PremiumUpgradeConfig.create({
    sourceType: "menu_product",
    sourceId: premiumLargeSalad._id,
    sourceProductId: premiumLargeSalad._id,
    sourceGroupId: null,
    selectionType: "premium_large_salad",
    premiumKey: "premium_large_salad",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 3000,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sourceSnapshot: {
      key: premiumLargeSalad.key,
      name: premiumLargeSalad.name,
      context: { productKey: premiumLargeSalad.key },
    },
  });

  await ProductOptionGroup.create({
    productId: premiumLargeSalad._id,
    groupId: proteinsGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  await ProductOptionGroup.create({
    productId: premiumLargeSalad._id,
    groupId: sauceGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  await ProductGroupOption.create({
    productId: premiumLargeSalad._id,
    groupId: proteinsGroup._id,
    optionId: chicken._id,
  });
  await ProductGroupOption.create({
    productId: premiumLargeSalad._id,
    groupId: sauceGroup._id,
    optionId: sauce._id,
  });

  return { premiumLargeSalad, proteinsGroup, sauceGroup, chicken, sauce };
}

function completeSlot({ premium = false, premiumSource = "pending_payment" } = {}) {
  return {
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: premium ? "premium_meal" : "standard_meal",
    proteinId: new mongoose.Types.ObjectId(),
    carbs: [{ carbId: new mongoose.Types.ObjectId(), grams: 150 }],
    isPremium: premium,
    premiumKey: premium ? "salmon" : null,
    premiumSource: premium ? premiumSource : "none",
    premiumExtraFeeHalala: premium && premiumSource === "pending_payment" ? 1800 : 0,
  };
}

function premiumCommercialDay() {
  const raw = {
    status: "open",
    plannerState: "draft",
    mealSlots: [completeSlot({ premium: true })],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: 1,
      premiumPendingPaymentCount: 1,
      premiumCoveredByBalanceCount: 0,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: 1800,
      isDraftValid: true,
    },
    addonSelections: [],
    premiumExtraPayment: { status: "none" },
  };
  return {
    ...raw,
    ...buildDayCommercialState(raw),
  };
}

async function connect() {
  assert(DB_NAME.startsWith(DB_PREFIX), "isolated database name must have the audit prefix");
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
  const uri = mongoServer.getUri(DB_NAME);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.strictEqual(Boolean(hello.setName || hello.msg === "isdbgrid"), false, "Phase 1 must run without transaction support");
}

async function resetDatabase() {
  assert.strictEqual(mongoose.connection.name.startsWith(DB_PREFIX), true, "refusing to reset a non-audit database");
  await mongoose.connection.db.dropDatabase();
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function seedPlan() {
  return Plan.create({
    key: `${TEST_TAG}-${new mongoose.Types.ObjectId()}`,
    name: { ar: TEST_TAG, en: TEST_TAG },
    daysCount: 30,
    durationDays: 30,
    gramsOptions: [{
      grams: 200,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 10000, compareAtHalala: 10000 }],
    }],
  });
}

async function seedSubscription({ remainingMeals = 7, totalMeals = 7, deliveryMode = "delivery", premiumBalance = [] } = {}) {
  const plan = await seedPlan();
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: plan._id,
    status: "active",
    startDate: asDate(START_DATE),
    endDate: asDate(END_DATE),
    validityEndDate: asDate(END_DATE),
    totalMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    mealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode,
    deliveryAddress: deliveryMode === "delivery" ? { line1: TEST_TAG } : undefined,
    deliveryWindow: deliveryMode === "delivery" ? "13:00-16:00" : undefined,
    pickupLocationId: deliveryMode === "pickup" ? TEST_TAG : undefined,
    premiumBalance,
  });
}

async function record(name, work) {
  try {
    await resetDatabase();
    await work();
    matrix.push({ scenario: name, result: "PASS", evidence: "expected invariant holds" });
    console.log(`PASS ${name}`);
  } catch (err) {
    matrix.push({
      scenario: name,
      result: "FAIL",
      evidence: `${err.code ? `${err.code}: ` : ""}${String(err.message || err).split("\n")[0]}`,
    });
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function seedHistoricalPremiumDays(subscriptionId) {
  const states = [
    { status: "canceled_at_branch" },
    { status: "delivery_canceled" },
    { status: "skipped" },
    { status: "frozen" },
    { status: "fulfilled" },
    { status: "no_show" },
    { status: "open", premiumExtraPayment: { status: "failed" } },
  ];
  await SubscriptionDay.insertMany(states.map((state, index) => ({
    subscriptionId,
    date: dateUtils.addDaysToKSADateString(SELECTION_DATE, index + 7),
    status: state.status,
    premiumExtraPayment: state.premiumExtraPayment,
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_1",
      selectionType: "premium_meal",
      isPremium: true,
      premiumKey: "salmon",
      premiumSource: "pending_payment",
      quantity: 1,
    }],
    mealSlots: [],
  })));
}

function paymentRuntime(providerCounter) {
  return {
    createInvoice: async ({ amount, currency, metadata }) => {
      providerCounter.calls += 1;
      return {
        id: `inv_${new mongoose.Types.ObjectId()}`,
        status: "initiated",
        amount,
        currency: currency || "SAR",
        url: "https://payment.invalid/test",
        metadata,
      };
    },
    parseOperationIdempotencyKey: () => "",
    buildOperationRequestHash: () => "",
    compareIdempotentRequest: () => "reuse",
    findPaymentByOperationKey: async () => null,
    findReusableInitiatedPaymentByHash: async () => null,
    createPayment: async (payload) => Payment.create(payload),
  };
}

async function seedPayableDay(subscription, date = SELECTION_DATE) {
  const commercial = premiumCommercialDay();
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "open",
    plannerState: "draft",
    mealSlots: commercial.mealSlots,
    plannerMeta: commercial.plannerMeta,
    plannerRevisionHash: commercial.plannerRevisionHash,
    premiumExtraPayment: commercial.premiumExtraPayment,
    addonSelections: [],
  });
}

async function createPaymentForDay(subscription, day, providerCounter) {
  return createUnifiedDayPaymentFlow({
    subscriptionId: subscription._id,
    date: day.date,
    userId: subscription.userId,
    lang: "en",
    headers: {},
    body: { plannerRevisionHash: day.plannerRevisionHash },
    runtime: paymentRuntime(providerCounter),
    ensureActiveFn: () => {},
  });
}

async function run() {
  await connect();

  await record("valid Premium selection ignores inactive historical Premium records", async () => {
    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 6 });
    await seedHistoricalPremiumDays(subscription._id);

    const persisted = await countPersistedPremiumUpgradesForSubscription({ subscriptionId: subscription._id });
    assert.strictEqual(persisted, 0, "inactive and failed historical Premium records must not count as active allocations");
    assert.doesNotThrow(() => assertPremiumUpgradeLimit({
      premiumUpgradeCount: persisted + 1,
      totalSubscriptionMeals: subscription.totalMeals,
    }));

    await withMockedLegacyPlannerCatalog(async () => {
      const result = await updateDaySelectionForClient({
        subscriptionId: subscription._id,
        date: SELECTION_DATE,
        body: premiumSelectionPayload(),
        userId: subscription.userId,
        lang: "en",
        runtime: undefined,
        writeLogSafelyFn: async () => {},
        loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map(), premiumNames: new Map() }),
        logWalletIntegrityErrorFn: () => {},
      });
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.notStrictEqual(result.code, "PREMIUM_UPGRADE_LIMIT_EXCEEDED");
      assert.strictEqual(result.data.paymentRequirement.requiresPayment, true);
    });
  });

  await record("normal and Premium slots each represent exactly one base meal", async () => {
    assert.strictEqual(resolveDayMealsToDeduct({ mealSlots: [completeSlot()] }, {}), 1);
    assert.strictEqual(resolveDayMealsToDeduct({ mealSlots: [completeSlot({ premium: true })] }, {}), 1);
  });

  await record("normal meal selection retains the current backend contract", async () => {
    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 6 });
    await withMockedLegacyPlannerCatalog(async () => {
      const result = await updateDaySelectionForClient({
        subscriptionId: subscription._id,
        date: SELECTION_DATE,
        body: standardSelectionPayload(),
        userId: subscription.userId,
        lang: "en",
        runtime: undefined,
        writeLogSafelyFn: async () => {},
        loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map(), premiumNames: new Map() }),
        logWalletIntegrityErrorFn: () => {},
      });
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(result.status, 200);
      assert.strictEqual(typeof result.data.plannerRevisionHash, "string");
      assert.strictEqual(typeof result.data.paymentRequirement.requiresPayment, "boolean");
      assert.strictEqual(typeof result.data.mealBalance.remainingMeals, "number");
      assert.strictEqual(result.data.mealSlots[0].selectionType, "standard_meal");
    });
  });

  await record("zero base rejects before provider call and wallet mutation", async () => {
    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 0 });
    const day = await seedPayableDay(subscription);
    const providerCounter = { calls: 0 };
    const before = await Subscription.findById(subscription._id).lean();

    const result = await createPaymentForDay(subscription, day, providerCounter);
    const after = await Subscription.findById(subscription._id).lean();

    assert.strictEqual(providerCounter.calls, 0, "payment provider must not be called without a base meal");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "INSUFFICIENT_CREDITS");
    assert.strictEqual(result.status, 422);
    assert.deepStrictEqual(after.premiumBalance, before.premiumBalance);
    assert.strictEqual(await Payment.countDocuments({ subscriptionId: subscription._id }), 0);
  });

  await record("paid Premium contract is idempotent and creates no base entitlement", async () => {
    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 1 });
    const day = await seedPayableDay(subscription);
    const providerCounter = { calls: 0 };
    const createResult = await createPaymentForDay(subscription, day, providerCounter);

    assert.strictEqual(createResult.ok, true, JSON.stringify(createResult));
    assert.strictEqual(createResult.status, 201);
    assert.strictEqual(typeof createResult.data.paymentId, "string");
    assert.strictEqual(createResult.data.payment_id, createResult.data.paymentId);
    assert.strictEqual(typeof createResult.data.paymentUrl, "string");
    assert.strictEqual(createResult.data.payment_url, createResult.data.paymentUrl);

    const invoice = {
      id: createResult.data.providerInvoiceId,
      status: "paid",
      amount: createResult.data.totalHalala,
      currency: "SAR",
      payments: [{
        id: `pay_${createResult.data.providerInvoiceId}`,
        status: "paid",
        amount: createResult.data.totalHalala,
        currency: "SAR",
      }],
    };
    const verify = () => verifyUnifiedDayPaymentFlow({
      subscriptionId: subscription._id,
      date: day.date,
      paymentId: createResult.data.paymentId,
      userId: subscription.userId,
      getInvoiceFn: async () => invoice,
      startSessionFn: startSafeSession,
      applyPaymentSideEffectsFn: applyPaymentSideEffects,
    });

    const firstVerify = await verify();
    const secondVerify = await verify();
    assert.strictEqual(firstVerify.ok, true, JSON.stringify(firstVerify));
    assert.strictEqual(secondVerify.ok, true, JSON.stringify(secondVerify));
    assert.strictEqual(firstVerify.data.paymentStatus, "paid");
    assert.strictEqual(typeof firstVerify.data.requiresPayment, "boolean");
    assert.strictEqual(await Payment.countDocuments({ subscriptionId: subscription._id }), 1);

    await SubscriptionDay.updateOne(
      { _id: day._id },
      { $set: { status: "out_for_delivery" } }
    );
    const firstFulfill = await fulfillSubscriptionDay({ subscriptionId: subscription._id, date: day.date });
    const secondFulfill = await fulfillSubscriptionDay({ subscriptionId: subscription._id, date: day.date });
    const finalSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(firstFulfill.ok, true);
    assert.strictEqual(secondFulfill.ok, true);
    assert.strictEqual(finalSubscription.totalMeals, 7, "Premium difference must not create base entitlement");
    assert.strictEqual(finalSubscription.remainingMeals, 0, "Premium fulfillment consumes one base meal exactly once");
  });

  await record("standalone insufficient fulfillment leaves no fulfilled partial state", async () => {
    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 0 });
    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: SELECTION_DATE,
      status: "out_for_delivery",
      mealSlots: [completeSlot({ premium: true, premiumSource: "paid_extra" })],
      plannerMeta: { requiredSlotCount: 1, completeSlotCount: 1, premiumSlotCount: 1, isDraftValid: true },
    });
    const session = await startSafeSession();
    try {
      const result = await fulfillSubscriptionDay({ subscriptionId: subscription._id, date: day.date, session });
      assert.strictEqual(result.ok, false);
    } finally {
      session.endSession();
    }
    const persisted = await SubscriptionDay.findById(day._id).lean();
    assert.notStrictEqual(persisted.status, "fulfilled", "failed debit must not persist fulfilled status");
    assert.notStrictEqual(persisted.creditsDeducted, true, "failed debit must not retain the deduction guard");
  });

  await record("pickup request and linked day cannot double deduct", async () => {
    const subscription = await seedSubscription({ totalMeals: 2, remainingMeals: 2, deliveryMode: "pickup" });
    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: subscription._id,
      userId: subscription.userId,
      date: SELECTION_DATE,
      mealCount: 1,
      status: "ready_for_pickup",
    });
    await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: SELECTION_DATE,
      status: "ready_for_pickup",
      pickupRequested: true,
      mealSlots: [completeSlot({ premium: true, premiumSource: "paid_extra" })],
      plannerMeta: { requiredSlotCount: 1, completeSlotCount: 1, premiumSlotCount: 1, isDraftValid: true },
    });

    const requestResult = await fulfillSubscriptionPickupRequest({ requestId: pickupRequest._id });
    const dayResult = await fulfillSubscriptionDay({ subscriptionId: subscription._id, date: SELECTION_DATE });
    const finalSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(requestResult.ok, true);
    assert.strictEqual(dayResult.ok, true);
    assert.strictEqual(finalSubscription.remainingMeals, 1, "pickup and day fulfillment must share one base debit");
  });

  await record("cancellation releases the exact Premium bucket once", async () => {
    const sharedConfigId = new mongoose.Types.ObjectId();
    const subscription = await seedSubscription({
      totalMeals: 2,
      remainingMeals: 2,
      premiumBalance: [{
        configId: sharedConfigId,
        revision: 1,
        premiumKey: "salmon",
        purchasedQty: 1,
        remainingQty: 0,
        reservedQty: 0,
        consumedQty: 1,
      }, {
        configId: new mongoose.Types.ObjectId(),
        revision: 2,
        premiumKey: "salmon",
        purchasedQty: 1,
        remainingQty: 0,
        reservedQty: 0,
        consumedQty: 1,
      }],
    });
    const persistedSubscription = await Subscription.findById(subscription._id);
    const targetBucket = persistedSubscription.premiumBalance[0];
    const otherBucket = persistedSubscription.premiumBalance[1];
    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: SELECTION_DATE,
      status: "out_for_delivery",
      premiumUpgradeSelections: [{
        baseSlotKey: "slot_1",
        selectionType: "premium_meal",
        isPremium: true,
        premiumKey: "salmon",
        premiumSource: "balance",
        balanceBucketId: targetBucket._id,
        premiumWalletRowId: targetBucket._id,
        configId: targetBucket.configId,
        revision: targetBucket.revision,
        quantity: 1,
      }],
      mealSlots: [completeSlot({ premium: true, premiumSource: "balance" })],
    });

    await executeAction("cancel", {
      entityId: day._id,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "phase_1_exact_bucket_test" },
    });
    const afterFirst = await Subscription.findById(subscription._id).lean();
    const firstTarget = afterFirst.premiumBalance.find((row) => String(row._id) === String(targetBucket._id));
    const firstOther = afterFirst.premiumBalance.find((row) => String(row._id) === String(otherBucket._id));
    assert.strictEqual(firstTarget.remainingQty, 1);
    assert.strictEqual(firstTarget.consumedQty, 0);
    assert.strictEqual(firstOther.remainingQty, 0);
    assert.strictEqual(firstOther.consumedQty, 1);

    await executeAction("cancel", {
      entityId: day._id,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "phase_1_exact_bucket_replay" },
    });
    const afterReplay = await Subscription.findById(subscription._id).lean();
    assert.deepStrictEqual(
      afterReplay.premiumBalance.map((row) => ({ remainingQty: row.remainingQty, consumedQty: row.consumedQty })),
      afterFirst.premiumBalance.map((row) => ({ remainingQty: row.remainingQty, consumedQty: row.consumedQty }))
    );
  });

  await record("payment initiation reserves base capacity against a deferred race", async () => {
    const subscription = await seedSubscription({ totalMeals: 1, remainingMeals: 1 });
    const day = await seedPayableDay(subscription);
    const providerCounter = { calls: 0 };
    const result = await createPaymentForDay(subscription, day, providerCounter);
    assert.strictEqual(result.ok, true, JSON.stringify(result));

    const afterInitiation = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(afterInitiation.remainingMeals, 0, "payment initiation must reserve the only usable base meal");
    assert.strictEqual(afterInitiation.reservedMeals, 1, "the held meal must be represented as reserved");

    const competingDebit = await Subscription.updateOne(
      { _id: subscription._id, remainingMeals: { $gte: 1 } },
      { $inc: { remainingMeals: -1 } }
    );
    assert.strictEqual(competingDebit.modifiedCount, 0, "manual/competing consumption cannot take a paid slot's reservation");
  });

  await record("mobile-facing request and read contracts remain additive-only", async () => {
    const catalog = await seedCanonicalPremiumSaladCatalog();
    const flutterPayload = canonicalFlutterPayloadFixture(catalog);
    assert.deepStrictEqual(Object.keys(flutterPayload).sort(), ["contractVersion", "mealSlots"]);
    assert.deepStrictEqual(Object.keys(flutterPayload.mealSlots[0]).sort(), [
      "productId",
      "selectedOptions",
      "selectionType",
      "slotIndex",
    ]);
    assert.strictEqual(flutterPayload.allocationId, undefined);
    assert.strictEqual(flutterPayload.reservationId, undefined);
    assert.strictEqual(flutterPayload.idempotencyKey, undefined);

    const subscription = await seedSubscription({ totalMeals: 7, remainingMeals: 6 });
    const selectionResult = await updateDaySelectionForClient({
      subscriptionId: subscription._id,
      date: SELECTION_DATE,
      body: flutterPayload,
      userId: subscription.userId,
      lang: "en",
      runtime: undefined,
      writeLogSafelyFn: async () => {},
      loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map(), premiumNames: new Map() }),
      logWalletIntegrityErrorFn: () => {},
    });
    assert.strictEqual(selectionResult.ok, true, JSON.stringify(selectionResult));
    assert.strictEqual(selectionResult.status, 402, "current payment-required selection status is part of the mobile contract");
    assert.strictEqual(selectionResult.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(selectionResult.data.paymentRequirement.blockingReason, "PREMIUM_PAYMENT_REQUIRED");
    assert.strictEqual(typeof selectionResult.data.plannerRevisionHash, "string");

    const serialized = await serializeSubscriptionForClient(subscription.toObject(), "en");
    assert.strictEqual(typeof serialized.totalMeals, "number");
    assert.strictEqual(typeof serialized.remainingMeals, "number");
    assert.strictEqual(typeof serialized.mealBalance.totalMeals, "number");
    assert.strictEqual(typeof serialized.mealBalance.remainingMeals, "number");
    assert.strictEqual(typeof serialized.mealBalance.consumedMeals, "number");

    const shapedDay = shapeMealPlannerReadFields({
      subscription: subscription.toObject(),
      day: {
        _id: new mongoose.Types.ObjectId(),
        subscriptionId: subscription._id,
        date: SELECTION_DATE,
        status: "open",
        plannerState: "draft",
        ...premiumCommercialDay(),
      },
      lang: "en",
      businessDate: BUSINESS_DATE,
    });
    assert.strictEqual(typeof shapedDay.plannerRevisionHash, "string");
    assert.strictEqual(typeof shapedDay.paymentRequirement.requiresPayment, "boolean");
    assert.strictEqual(typeof shapedDay.paymentRequirement.blockingReason, "string");
    assert.strictEqual(typeof shapedDay.mealBalance.remainingMeals, "number");

    const overview = await buildCurrentSubscriptionOverview({ userId: subscription.userId, lang: "en" });
    assert.strictEqual(overview.status, true);
    assert.strictEqual(typeof overview.data.remainingMeals, "number");
    assert(Array.isArray(overview.data.premiumBalance));

    const timeline = await buildSubscriptionTimeline(subscription._id, { lang: "en" });
    assert.strictEqual(typeof timeline.subscriptionId, "string");
    assert.strictEqual(typeof timeline.mealBalance.totalMeals, "number");
    assert.strictEqual(typeof timeline.mealBalance.remainingMeals, "number");
    assert(Array.isArray(timeline.premiumBalanceBreakdown));

    const directBalance = buildMealBalance(subscription.toObject(), BUSINESS_DATE);
    assert.deepStrictEqual(Object.keys(directBalance).sort(), [
      "canConsumeNow",
      "consumedMeals",
      "dailyMealLimitEnforced",
      "dailyMealsDefault",
      "maxConsumableMealsNow",
      "mealBalancePolicy",
      "remainingMeals",
      "totalMeals",
    ]);
  });

  console.table(matrix);
  const failures = matrix.filter((entry) => entry.result === "FAIL");
  console.log(`Phase 1 result: ${matrix.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await resetDatabase().catch(() => {});
    await disconnect();
  });
