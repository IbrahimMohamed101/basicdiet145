process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "new-meal-subscription-checkout-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const {
  issueAppAccessToken,
} = require("../src/services/appTokenService");
const {
  resolveCheckoutQuoteOrThrow,
} = require("../src/services/subscription/subscriptionQuoteService");
const {
  performSubscriptionCheckout,
} = require("../src/services/subscription/subscriptionCheckoutService");
const {
  activateSubscriptionFromCanonicalDraft,
} = require("../src/services/subscription/subscriptionActivationService");
const {
  buildAddonChoicesCatalog,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  consumeAddonBalanceAtomically,
} = require("../src/services/subscription/subscriptionSelectionService");

let mongo;
let stepCount = 0;

async function step(name, fn) {
  stepCount += 1;
  await fn();
  console.log(`ok ${stepCount} - ${name}`);
}

function oid() {
  return new mongoose.Types.ObjectId();
}

function fakeInvoice() {
  return {
    id: `inv_${new mongoose.Types.ObjectId()}`,
    url: "https://payments.example.test/invoice",
    currency: "SAR",
  };
}

function checkoutRuntime() {
  return {
    createInvoice: async () => fakeInvoice(),
  };
}

async function seedFixture() {
  const now = new Date();
  const user = await User.create({ phone: "+966511111111", name: "Meal Checkout" });
  const basePlan = await Plan.create({
    key: "meal-checkout-base",
    name: { en: "Meal Checkout Base", ar: "Meal Checkout Base" },
    daysCount: 3,
    durationDays: 3,
    isActive: true,
    isAvailable: true,
    active: true,
    available: true,
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 30000, compareAtHalala: 30000, isActive: true }],
    }],
  });
  const mealCategory = await MenuCategory.create({
    key: "meals",
    name: { en: "Meals", ar: "Meals" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const snackCategory = await MenuCategory.create({
    key: "snacks",
    name: { en: "Snacks", ar: "Snacks" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const mealProduct = await MenuProduct.create({
    categoryId: mealCategory._id,
    key: "checkout_meal_product",
    name: { en: "Checkout Meal", ar: "Checkout Meal" },
    description: { en: "Meal description", ar: "Meal description" },
    imageUrl: "https://cdn.example.test/meal.jpg",
    itemType: "meal",
    pricingModel: "fixed",
    priceHalala: 2200,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const secondMealProduct = await MenuProduct.create({
    categoryId: mealCategory._id,
    key: "checkout_second_meal_product",
    name: { en: "Second Meal", ar: "Second Meal" },
    description: { en: "Second meal description", ar: "Second meal description" },
    itemType: "meal",
    pricingModel: "fixed",
    priceHalala: 2300,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const otherMealProduct = await MenuProduct.create({
    categoryId: mealCategory._id,
    key: "checkout_other_meal_product",
    name: { en: "Other Meal", ar: "Other Meal" },
    itemType: "meal",
    pricingModel: "fixed",
    priceHalala: 2500,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const snackProduct = await MenuProduct.create({
    categoryId: snackCategory._id,
    key: "checkout_snack_product",
    name: { en: "Snack", ar: "Snack" },
    itemType: "snack",
    pricingModel: "fixed",
    priceHalala: 900,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const mealPlan = await Addon.create({
    name: { en: "Meal Add-on Plan", ar: "Meal Add-on Plan" },
    priceHalala: 0,
    category: "meal",
    kind: "plan",
    billingMode: "per_day",
    isActive: true,
    isArchived: false,
    menuProductIds: [mealProduct._id, secondMealProduct._id],
    maxPerDay: 1,
  });
  const otherMealPlan = await Addon.create({
    name: { en: "Other Meal Add-on Plan", ar: "Other Meal Add-on Plan" },
    priceHalala: 0,
    category: "meal",
    kind: "plan",
    billingMode: "per_day",
    isActive: true,
    isArchived: false,
    menuProductIds: [otherMealProduct._id],
    maxPerDay: 1,
  });
  const snackPlan = await Addon.create({
    name: { en: "Snack Add-on Plan", ar: "Snack Add-on Plan" },
    priceHalala: 0,
    category: "snack",
    kind: "plan",
    billingMode: "per_day",
    isActive: true,
    isArchived: false,
    menuProductIds: [snackProduct._id],
    maxPerDay: 1,
  });
  await AddonPlanPrice.create([
    { addonPlanId: mealPlan._id, basePlanId: basePlan._id, priceHalala: 6000, currency: "SAR", isActive: true },
    { addonPlanId: otherMealPlan._id, basePlanId: basePlan._id, priceHalala: 7000, currency: "SAR", isActive: true },
    { addonPlanId: snackPlan._id, basePlanId: basePlan._id, priceHalala: 1200, currency: "SAR", isActive: true },
  ]);
  await Setting.create({
    key: "pickup_locations",
    value: [{
      id: "main",
      name: { en: "Main", ar: "Main" },
      isActive: true,
      address: { line1: "Main branch" },
    }],
  });
  await Setting.create({ key: "delivery_windows", value: [] });

  return {
    user,
    basePlan,
    mealCategory,
    mealProduct,
    secondMealProduct,
    otherMealProduct,
    snackProduct,
    mealPlan,
    otherMealPlan,
    snackPlan,
  };
}

function baseCheckoutPayload(fixture, addons) {
  return {
    planId: String(fixture.basePlan._id),
    grams: 150,
    mealsPerDay: 1,
    delivery: { type: "pickup", pickupLocationId: "main" },
    addons,
    successUrl: "https://app.example.test/success",
    backUrl: "https://app.example.test/back",
  };
}

async function quote(fixture, addons) {
  return resolveCheckoutQuoteOrThrow(baseCheckoutPayload(fixture, addons), {
    lang: "en",
    userId: fixture.user._id,
  });
}

async function expectCode(promiseFactory, code) {
  await assert.rejects(
    promiseFactory,
    (err) => err && err.code === code
  );
}

async function checkoutAndActivate(fixture, checkoutPayload) {
  const checkout = await performSubscriptionCheckout(
    fixture.user._id,
    `meal-checkout-${new mongoose.Types.ObjectId()}`,
    checkoutPayload,
    "en",
    checkoutRuntime()
  );
  assert.strictEqual(checkout.ok, true);
  const draft = await CheckoutDraft.findById(checkout.data.draftId);
  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    amount: draft.breakdown.totalHalala,
    currency: "SAR",
    userId: fixture.user._id,
    draftId: draft._id,
    providerInvoiceId: draft.providerInvoiceId || `inv_paid_${draft._id}`,
    metadata: { draftId: String(draft._id), paymentType: "subscription_activation" },
  });
  const activation = await activateSubscriptionFromCanonicalDraft({ draft, payment });
  assert.strictEqual(activation.applied, true);
  return {
    checkout,
    draft: await CheckoutDraft.findById(checkout.data.draftId).lean(),
    subscription: await Subscription.findById(activation.subscriptionId).lean(),
  };
}

async function run() {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: "new_meal_subscription_checkout" });
  await AddonPlanPrice.init();
  const fixture = await seedFixture();
  const app = createApp();
  const authHeaders = { Authorization: `Bearer ${issueAppAccessToken(fixture.user)}` };
  let observedChoice;
  let observedPayload;
  let activated;

  await step("choices endpoint returns meal choice with separate plan and product identity", async () => {
    const res = await request(app).get("/api/subscriptions/addon-choices?category=meal");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    observedChoice = res.body.data.meal.choices.find((choice) => String(choice.id) === String(fixture.mealProduct._id));
    assert.ok(observedChoice, "meal product choice returned");
    assert.strictEqual(observedChoice.id, String(fixture.mealProduct._id));
    assert.strictEqual(observedChoice.productId, String(fixture.mealProduct._id));
    assert.strictEqual(observedChoice.menuProductId, String(fixture.mealProduct._id));
    assert.strictEqual(observedChoice.addonPlanId, String(fixture.mealPlan._id));
    assert.strictEqual(observedChoice.category, "meal");
  });

  await step("checkout payload can be built directly from returned choice fields", async () => {
    observedPayload = baseCheckoutPayload(fixture, [{
      addonPlanId: observedChoice.addonPlanId,
      productId: observedChoice.productId,
      category: observedChoice.category,
      quantityPerDay: 1,
    }]);
    const quoteResult = await resolveCheckoutQuoteOrThrow(observedPayload, { lang: "en", userId: fixture.user._id });
    assert.strictEqual(String(quoteResult.addonSubscriptions[0].addonPlanId), String(fixture.mealPlan._id));
    assert.deepStrictEqual(quoteResult.addonSubscriptions[0].menuProductIds.map(String), [String(fixture.mealProduct._id)]);
  });

  await step("checkout service succeeds with the direct choices payload", async () => {
    const checkout = await performSubscriptionCheckout(
      fixture.user._id,
      `direct-choice-${new mongoose.Types.ObjectId()}`,
      observedPayload,
      "en",
      checkoutRuntime()
    );
    assert.strictEqual(checkout.ok, true);
    assert.strictEqual(checkout.data.addonSubscriptions[0].addonPlanId, String(fixture.mealPlan._id));
    assert.strictEqual(checkout.data.addonSubscriptions[0].productId, String(fixture.mealProduct._id));
  });

  await step("addonPlanId resolves through Addon plan identity", async () => {
    const result = await quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.mealProduct._id, category: "meal" }]);
    assert.strictEqual(String(result.addonItems[0].addonPlanId), String(fixture.mealPlan._id));
  });

  await step("productId resolves through MenuProduct identity", async () => {
    const result = await quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.mealProduct._id, category: "meal" }]);
    assert.strictEqual(result.addonItems[0].productId, String(fixture.mealProduct._id));
  });

  await step("MenuProduct id is not treated as the Addon plan id", async () => {
    const result = await quote(fixture, [{ id: fixture.mealProduct._id, category: "meal" }]);
    assert.strictEqual(String(result.addonItems[0].addonPlanId), String(fixture.mealPlan._id));
    assert.notStrictEqual(String(result.addonItems[0].addonPlanId), String(fixture.mealProduct._id));
  });

  await step("Addon plan id is not treated as a MenuProduct id", async () => {
    await expectCode(
      () => quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.mealPlan._id, category: "meal" }]),
      "ADDON_PRODUCT_NOT_FOUND"
    );
  });

  await step("valid plan id with invalid product id returns ADDON_PRODUCT_NOT_FOUND", async () => {
    await expectCode(
      () => quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: oid(), category: "meal" }]),
      "ADDON_PRODUCT_NOT_FOUND"
    );
  });

  await step("invalid plan id with valid product id returns ADDON_PLAN_NOT_FOUND", async () => {
    await expectCode(
      () => quote(fixture, [{ addonPlanId: oid(), productId: fixture.mealProduct._id, category: "meal" }]),
      "ADDON_PLAN_NOT_FOUND"
    );
  });

  await step("product outside plan returns ADDON_PRODUCT_NOT_IN_PLAN", async () => {
    await expectCode(
      () => quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.otherMealProduct._id, category: "meal" }]),
      "ADDON_PRODUCT_NOT_IN_PLAN"
    );
  });

  await step("meal product sent with snack plan returns ADDON_CATEGORY_MISMATCH", async () => {
    const mismatchedSnackPlan = await Addon.create({
      name: { en: "Mismatched Snack Plan", ar: "Mismatched Snack Plan" },
      priceHalala: 0,
      category: "snack",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [fixture.mealProduct._id],
    });
    await AddonPlanPrice.create({ addonPlanId: mismatchedSnackPlan._id, basePlanId: fixture.basePlan._id, priceHalala: 1000, currency: "SAR", isActive: true });
    await expectCode(
      () => quote(fixture, [{ addonPlanId: mismatchedSnackPlan._id, productId: fixture.mealProduct._id, category: "snack" }]),
      "ADDON_CATEGORY_MISMATCH"
    );
    await Addon.updateOne({ _id: mismatchedSnackPlan._id }, { $set: { isActive: false } });
  });

  await step("ambiguous legacy id fails closed", async () => {
    const sharedId = oid();
    await MenuProduct.create({
      _id: sharedId,
      categoryId: fixture.mealCategory._id,
      key: "ambiguous_checkout_meal",
      name: { en: "Ambiguous", ar: "Ambiguous" },
      itemType: "meal",
      pricingModel: "fixed",
      priceHalala: 2000,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await Addon.create({
      _id: sharedId,
      name: { en: "Ambiguous Plan", ar: "Ambiguous Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [fixture.mealProduct._id],
    });
    await expectCode(
      () => quote(fixture, [{ id: sharedId }]),
      "AMBIGUOUS_ADDON_SELECTION_ID"
    );
    await Addon.updateOne({ _id: sharedId }, { $set: { isActive: false } });
  });

  await step("inactive plan cannot be purchased", async () => {
    const inactivePlan = await Addon.create({
      name: { en: "Inactive Meal Plan", ar: "Inactive Meal Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: false,
      menuProductIds: [fixture.mealProduct._id],
    });
    await expectCode(
      () => quote(fixture, [{ addonPlanId: inactivePlan._id, productId: fixture.mealProduct._id, category: "meal" }]),
      "ADDON_PLAN_INACTIVE"
    );
  });

  await step("archived product cannot be selected for new subscription", async () => {
    const product = await MenuProduct.create({
      categoryId: fixture.mealCategory._id,
      key: "archived_checkout_meal",
      name: { en: "Archived Meal", ar: "Archived Meal" },
      itemType: "meal",
      pricingModel: "fixed",
      priceHalala: 2100,
      availableFor: ["one_time", "subscription"],
      isActive: false,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    const plan = await Addon.create({
      name: { en: "Archived Product Plan", ar: "Archived Product Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [product._id],
    });
    await AddonPlanPrice.create({ addonPlanId: plan._id, basePlanId: fixture.basePlan._id, priceHalala: 1000, currency: "SAR", isActive: true });
    await expectCode(
      () => quote(fixture, [{ addonPlanId: plan._id, productId: product._id, category: "meal" }]),
      "ADDON_PRODUCT_UNAVAILABLE_FOR_NEW_PURCHASE"
    );
  });

  await step("unpublished product cannot be selected for new subscription", async () => {
    const product = await MenuProduct.create({
      categoryId: fixture.mealCategory._id,
      key: "unpublished_checkout_meal",
      name: { en: "Unpublished Meal", ar: "Unpublished Meal" },
      itemType: "meal",
      pricingModel: "fixed",
      priceHalala: 2100,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: null,
    });
    const plan = await Addon.create({
      name: { en: "Unpublished Product Plan", ar: "Unpublished Product Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [product._id],
    });
    await AddonPlanPrice.create({ addonPlanId: plan._id, basePlanId: fixture.basePlan._id, priceHalala: 1000, currency: "SAR", isActive: true });
    await expectCode(
      () => quote(fixture, [{ addonPlanId: plan._id, productId: product._id, category: "meal" }]),
      "ADDON_PRODUCT_UNAVAILABLE_FOR_NEW_PURCHASE"
    );
  });

  await step("product unavailable for new sale is rejected", async () => {
    const product = await MenuProduct.create({
      categoryId: fixture.mealCategory._id,
      key: "unavailable_checkout_meal",
      name: { en: "Unavailable Meal", ar: "Unavailable Meal" },
      itemType: "meal",
      pricingModel: "fixed",
      priceHalala: 2100,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: false,
      publishedAt: new Date(),
    });
    const plan = await Addon.create({
      name: { en: "Unavailable Product Plan", ar: "Unavailable Product Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [product._id],
    });
    await AddonPlanPrice.create({ addonPlanId: plan._id, basePlanId: fixture.basePlan._id, priceHalala: 1000, currency: "SAR", isActive: true });
    await expectCode(
      () => quote(fixture, [{ addonPlanId: plan._id, productId: product._id, category: "meal" }]),
      "ADDON_PRODUCT_UNAVAILABLE_FOR_NEW_PURCHASE"
    );
  });

  await step("active meal plan and active meal product succeed", async () => {
    const result = await quote(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.mealProduct._id, category: "meal" }]);
    assert.strictEqual(result.addonSubscriptions.length, 1);
  });

  await step("activated subscription stores correct addonPlanId", async () => {
    activated = await checkoutAndActivate(fixture, observedPayload);
    assert.strictEqual(String(activated.subscription.addonSubscriptions[0].addonPlanId), String(fixture.mealPlan._id));
  });

  await step("activated subscription stores selected product id", async () => {
    assert.deepStrictEqual(activated.subscription.addonSubscriptions[0].menuProductIds.map(String), [String(fixture.mealProduct._id)]);
  });

  await step("menuProductsSnapshot stores full product metadata", async () => {
    const snapshot = activated.subscription.addonSubscriptions[0].menuProductsSnapshot[0];
    assert.strictEqual(String(snapshot.id), String(fixture.mealProduct._id));
    assert.strictEqual(snapshot.key, "checkout_meal_product");
    assert.strictEqual(snapshot.name.en, "Checkout Meal");
    assert.strictEqual(snapshot.description.en, "Meal description");
    assert.strictEqual(snapshot.categoryKey, "meals");
    assert.strictEqual(snapshot.itemType, "meal");
    assert.strictEqual(snapshot.priceHalala, 2200);
    assert.strictEqual(snapshot.currency, "SAR");
  });

  await step("addonBalance points to correct plan and meal category", async () => {
    assert.strictEqual(String(activated.subscription.addonBalance[0].addonPlanId), String(fixture.mealPlan._id));
    assert.strictEqual(activated.subscription.addonBalance[0].category, "meal");
  });

  await step("meal balance is not created as snack", async () => {
    assert.strictEqual(activated.subscription.addonBalance.some((row) => row.category === "snack"), false);
  });

  await step("checkout response returns both plan and product identity", async () => {
    assert.strictEqual(activated.checkout.data.addonSubscriptions[0].addonPlanId, String(fixture.mealPlan._id));
    assert.strictEqual(activated.checkout.data.addonSubscriptions[0].productId, String(fixture.mealProduct._id));
  });

  await step("legacy payload with addonId and menuProductIds succeeds when unambiguous", async () => {
    const result = await quote(fixture, [{ addonId: fixture.mealPlan._id, menuProductIds: [fixture.mealProduct._id], category: "meal" }]);
    assert.strictEqual(String(result.addonSubscriptions[0].addonPlanId), String(fixture.mealPlan._id));
    assert.deepStrictEqual(result.addonSubscriptions[0].menuProductIds.map(String), [String(fixture.mealProduct._id)]);
  });

  await step("legacy product id in id resolves only after proving containing plan", async () => {
    const result = await quote(fixture, [{ id: fixture.mealProduct._id, category: "meal" }]);
    assert.strictEqual(String(result.addonSubscriptions[0].addonPlanId), String(fixture.mealPlan._id));
    assert.deepStrictEqual(result.addonSubscriptions[0].menuProductIds.map(String), [String(fixture.mealProduct._id)]);
  });

  await step("legacy plan id in id resolves as plan id", async () => {
    const result = await quote(fixture, [{ id: fixture.mealPlan._id }]);
    assert.strictEqual(String(result.addonSubscriptions[0].addonPlanId), String(fixture.mealPlan._id));
    assert.deepStrictEqual(
      result.addonSubscriptions[0].menuProductIds.map(String).sort(),
      [String(fixture.mealProduct._id), String(fixture.secondMealProduct._id)].sort()
    );
  });

  await step("ambiguous or conflicting explicit fields return validation error", async () => {
    await expectCode(
      () => quote(fixture, [{ addonPlanId: fixture.mealPlan._id, id: fixture.otherMealPlan._id, productId: fixture.mealProduct._id }]),
      "INVALID_ADDON_SELECTION"
    );
  });

  await step("owned meal choices can be loaded after successful checkout", async () => {
    const catalog = await buildAddonChoicesCatalog({ subscriptionId: activated.subscription._id, category: "meal" });
    assert.strictEqual(catalog.meal.choices.length, 1);
    assert.strictEqual(catalog.meal.choices[0].source, "subscription");
    assert.strictEqual(catalog.meal.choices[0].ownedSnapshot, true);
  });

  await step("save-time consume targets the created meal bucket", async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await Subscription.findById(activated.subscription._id).session(session);
      const bucket = doc.addonBalance[0];
      const result = await consumeAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.mealProduct._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(result.consumed, true);
      await doc.save({ session });
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
    const fresh = await Subscription.findById(activated.subscription._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 2);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 1);
  });

  await step("no snack bucket is consumed", async () => {
    const fresh = await Subscription.findById(activated.subscription._id).lean();
    assert.strictEqual(fresh.addonBalance.some((row) => row.category === "snack" && Number(row.consumedQty || 0) > 0), false);
  });

  await step("actual authenticated quote endpoint accepts explicit meal identities", async () => {
    const endpointUser = await User.create({ phone: "+966522222222", name: "Endpoint Meal Checkout" });
    const payload = {
      ...baseCheckoutPayload(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: fixture.mealProduct._id, category: "meal" }]),
    };
    const res = await request(app)
      .post("/api/subscriptions/quote")
      .set({ Authorization: `Bearer ${issueAppAccessToken(endpointUser)}` })
      .send(payload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.breakdown.addonsTotalHalala, 6000);
  });

  await step("quote endpoint returns precise ADDON_PRODUCT_NOT_FOUND metadata", async () => {
    const res = await request(app)
      .post("/api/subscriptions/quote")
      .set(authHeaders)
      .send(baseCheckoutPayload(fixture, [{ addonPlanId: fixture.mealPlan._id, productId: oid(), category: "meal" }]));
    assert.strictEqual(res.status, 404, JSON.stringify(res.body));
    assert.strictEqual(res.body.error.code, "ADDON_PRODUCT_NOT_FOUND");
    assert.strictEqual(res.body.error.details.field, "productId");
  });

  await step("quote endpoint returns precise ADDON_PLAN_NOT_FOUND metadata", async () => {
    const res = await request(app)
      .post("/api/subscriptions/quote")
      .set(authHeaders)
      .send(baseCheckoutPayload(fixture, [{ addonPlanId: oid(), productId: fixture.mealProduct._id, category: "meal" }]));
    assert.strictEqual(res.status, 404, JSON.stringify(res.body));
    assert.strictEqual(res.body.error.code, "ADDON_PLAN_NOT_FOUND");
    assert.strictEqual(res.body.error.details.field, "addonPlanId");
  });

  await step("legacy product-only id with multiple containing plans fails as ambiguous", async () => {
    const duplicatePlan = await Addon.create({
      name: { en: "Duplicate Product Meal Plan", ar: "Duplicate Product Meal Plan" },
      priceHalala: 0,
      category: "meal",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      menuProductIds: [fixture.secondMealProduct._id],
    });
    await AddonPlanPrice.create({ addonPlanId: duplicatePlan._id, basePlanId: fixture.basePlan._id, priceHalala: 1000, currency: "SAR", isActive: true });
    await expectCode(
      () => quote(fixture, [{ id: fixture.secondMealProduct._id, category: "meal" }]),
      "AMBIGUOUS_ADDON_SELECTION_ID"
    );
  });

  assert.strictEqual(stepCount, 34);
  console.log("new meal subscription checkout tests passed");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongo) await mongo.stop().catch(() => {});
  });
