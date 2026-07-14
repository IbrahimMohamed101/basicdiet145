process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "addon-credit-lifecycle-secret";

const assert = require("assert");
const { addDays } = require("date-fns");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const {
  createDashboardAddonPlan,
} = require("../src/controllers/addonController");
const {
  activateSubscriptionFromCanonicalContract,
} = require("../src/services/subscription/subscriptionActivationService");
const {
  PHASE1_CONTRACT_VERSION,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../src/constants/phase1Contract");
const { toKSADateString } = require("../src/utils/date");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(handler, { body = {}, params = {}, query = {} } = {}) {
  const res = response();
  await handler({ body, params, query }, res);
  return res;
}

function issueToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function sumRemaining(subscription) {
  return (subscription.addonBalance || []).reduce(
    (sum, row) => sum + Number(row.remainingQty || 0),
    0
  );
}

async function seedCanonicalMealFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Custom Order" },
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { ar: "بروتين", en: "Protein" },
    publishedAt: now,
    ui: { displayStyle: "radio_cards" },
  });
  const carbsGroup = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "كارب", en: "Carbs" },
    publishedAt: now,
    ui: { displayStyle: "checkbox_grid" },
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "addon_lifecycle_basic_meal",
    itemType: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const chicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "addon_lifecycle_grilled_chicken",
    name: { ar: "دجاج مشوي", en: "Grilled Chicken" },
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const rice = await MenuOption.create({
    groupId: carbsGroup._id,
    key: "addon_lifecycle_white_rice",
    name: { ar: "رز أبيض", en: "White Rice" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  await ProductOptionGroup.create([
    {
      productId: product._id,
      groupId: proteinsGroup._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 10,
    },
    {
      productId: product._id,
      groupId: carbsGroup._id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      sortOrder: 20,
    },
  ]);
  await ProductGroupOption.create([
    {
      productId: product._id,
      groupId: proteinsGroup._id,
      optionId: chicken._id,
      extraPriceHalala: 0,
      sortOrder: 10,
    },
    {
      productId: product._id,
      groupId: carbsGroup._id,
      optionId: rice._id,
      extraPriceHalala: 0,
      sortOrder: 10,
    },
  ]);

  return {
    product,
    proteinsGroup,
    carbsGroup,
    chicken,
    rice,
  };
}

function canonicalSlot(fixture) {
  return {
    slotIndex: 1,
    selectionType: "standard_meal",
    productId: String(fixture.product._id),
    selectedOptions: [
      {
        groupId: String(fixture.proteinsGroup._id),
        groupKey: "proteins",
        optionId: String(fixture.chicken._id),
        optionKey: fixture.chicken.key,
        quantity: 1,
      },
      {
        groupId: String(fixture.carbsGroup._id),
        groupKey: "carbs",
        optionId: String(fixture.rice._id),
        optionKey: fixture.rice.key,
        quantity: 1,
        grams: 150,
      },
    ],
  };
}

async function main() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{
      args: ["--setParameter", "maxTransactionLockRequestTimeoutMillis=20000"],
    }],
  });
  const uri = mongo.getUri(`addon_credit_lifecycle_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const user = await User.create({
      phone: "+966500000099",
      password: "Password123",
    });
    const basePlan = await Plan.create({
      name: { ar: "سبعة أيام", en: "Seven Days" },
      daysCount: 7,
      durationDays: 7,
      active: true,
      available: true,
      isAvailable: true,
      isActive: true,
      currency: "SAR",
    });
    const juiceCategory = await MenuCategory.create({
      key: "juices",
      name: { ar: "العصائر", en: "Juices" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    const juiceProducts = await MenuProduct.create(
      Array.from({ length: 8 }, (_, index) => ({
        categoryId: juiceCategory._id,
        key: `addon_credit_juice_${index + 1}`,
        name: { ar: `عصير ${index + 1}`, en: `Juice ${index + 1}` },
        priceHalala: 1000 + (index * 100),
        currency: "SAR",
        itemType: "juice",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: index + 1,
      }))
    );
    const allJuiceIds = juiceProducts.map((product) => String(product._id));

    const dashboardPlan = await invoke(createDashboardAddonPlan, {
      body: {
        name: { ar: "رصيد عشرين عصير", en: "Twenty Juice Credits" },
        category: "juice",
        maxPerDay: 20,
        isActive: true,
        menuProductIds: allJuiceIds,
        planPrices: [{
          basePlanId: String(basePlan._id),
          priceHalala: 20000,
          isActive: true,
        }],
      },
    });
    assert.strictEqual(dashboardPlan.statusCode, 201, JSON.stringify(dashboardPlan.body));
    assert.strictEqual(dashboardPlan.body.data.resolvedMenuProductsCount, 8);
    const addonPlanId = dashboardPlan.body.data.id;

    const startDate = addDays(new Date(), 3);
    const date = toKSADateString(startDate);
    const contractSnapshot = {
      plan: {
        planId: String(basePlan._id),
        daysCount: 7,
        mealsPerDay: 1,
        selectedGrams: 300,
      },
      start: { resolvedStartDate: startDate.toISOString() },
      delivery: {
        mode: "delivery",
        address: { street: "Test Street", city: "Riyadh" },
        slot: { type: "delivery", window: "", slotId: "" },
      },
      pricing: {
        basePlanPriceHalala: 0,
        subtotalHalala: 0,
        totalPriceHalala: 0,
        currency: "SAR",
      },
      entitlementContract: {
        addonSubscriptions: [{
          addonId: addonPlanId,
          addonPlanId,
          addonPlanName: "Twenty Juice Credits",
          category: "juice",
          quantityPerDay: 1,
          includedTotalQty: 20,
          unitPlanPriceHalala: 1000,
          currency: "SAR",
          // Modern entitlements use exact immutable product membership.
          menuProductIds: allJuiceIds,
        }],
      },
    };
    const subscription = await activateSubscriptionFromCanonicalContract({
      userId: user._id,
      planId: basePlan._id,
      contract: {
        contractVersion: PHASE1_CONTRACT_VERSION,
        contractMode: CONTRACT_MODES[0],
        contractCompleteness: CONTRACT_COMPLETENESS_VALUES[0],
        contractSource: CONTRACT_SOURCES[0],
        contractHash: `addon-credit-lifecycle-${Date.now()}`,
        contractSnapshot,
      },
    });

    assert.strictEqual(subscription.status, "active");
    assert.strictEqual(subscription.addonBalance.length, 1);
    assert.strictEqual(subscription.addonBalance[0].includedTotalQty, 20);
    assert.strictEqual(subscription.addonBalance[0].remainingQty, 20);
    assert.strictEqual(subscription.addonBalance[0].consumedQty, 0);
    assert.deepStrictEqual(
      subscription.addonSubscriptions[0].menuProductIds.map(String),
      allJuiceIds
    );

    const mealFixture = await seedCanonicalMealFixture();
    const app = createApp();
    const api = request(app);
    const auth = { Authorization: `Bearer ${issueToken(user._id)}` };
    const selectionBody = {
      contractVersion: "meal_planner_menu.v3",
      mealSlots: [canonicalSlot(mealFixture)],
      addonsOneTime: allJuiceIds,
    };

    let res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/selection/validate`)
      .set(auth)
      .send(selectionBody);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSummary.selectedCount, 8);
    assert.strictEqual(res.body.data.addonSummary.inclusiveCount, 8);
    assert.strictEqual(res.body.data.addonSummary.pendingPaymentCount, 0);
    assert.strictEqual(res.body.data.addonSummary.totalExtraHalala, 0);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    assert.strictEqual(res.body.data.paymentRequirement.amountHalala, 0);
    assert(res.body.data.addonSelections.every((item) => item.source === "subscription"));

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/selection/validate`)
      .set(auth)
      .send(selectionBody);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    let storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 20, "validation must not consume balance");
    assert.strictEqual(await SubscriptionDay.countDocuments({ subscriptionId: subscription._id }), 7);

    res = await api
      .put(`/api/subscriptions/${subscription._id}/days/${date}/selection`)
      .set(auth)
      .send(selectionBody);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSummary.inclusiveCount, 8);
    assert.strictEqual(res.body.data.addonSummary.pendingPaymentCount, 0);
    assert.strictEqual(res.body.data.paymentRequirement.amountHalala, 0);
    storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 12, "first save consumes exactly eight credits");

    res = await api
      .put(`/api/subscriptions/${subscription._id}/days/${date}/selection`)
      .set(auth)
      .send(selectionBody);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.idempotent, true, "repeating the same save must short-circuit");
    storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 12, "repeated save must not consume twice");

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/confirm`)
      .set(auth)
      .send({});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.plannerState, "confirmed");
    storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 12, "confirmation must not consume again");

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/confirm`)
      .set(auth)
      .send({});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.idempotent, true, "repeated confirmation must be idempotent");
    storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 12);

    const nextDate = toKSADateString(addDays(startDate, 1));
    const overageIds = [...allJuiceIds, ...allJuiceIds.slice(0, 5)];
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${nextDate}/selection/validate`)
      .set(auth)
      .send({
        ...selectionBody,
        addonsOneTime: overageIds,
      });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSummary.inclusiveCount, 12);
    assert.strictEqual(res.body.data.addonSummary.pendingPaymentCount, 1);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(res.body.data.paymentRequirement.blockingReason, "ADDON_PAYMENT_REQUIRED");
    assert(res.body.data.paymentRequirement.amountHalala > 0);
    storedSubscription = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sumRemaining(storedSubscription), 12, "overage validation must remain read-only");

    console.log("Add-on credit lifecycle E2E test passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
