"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "addon-entitlement-authority-secret";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const { issueAppAccessToken } = require("../src/services/appTokenService");
const Addon = require("../src/models/Addon");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");

const REQUIRED_COVERAGE_FIELDS = [
  "id",
  "productId",
  "menuProductId",
  "key",
  "category",
  "entitlementCategory",
  "addonId",
  "addonPlanId",
  "entitlementKey",
  "balanceBucketId",
  "source",
  "ownedSnapshot",
  "isEligibleForAllowance",
  "includedTotalQty",
  "remainingQty",
  "freeQtyAvailable",
  "requestedQty",
  "coveredQty",
  "paidQty",
  "remainingBefore",
  "remainingAfter",
  "payableTotalHalala",
  "unitPriceHalala",
  "pricingMode",
  "maxPerDay",
];

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function dateStart(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateEnd(date) {
  return new Date(`${date}T23:59:59.999Z`);
}

function assertCoverageFields(row, label) {
  for (const field of REQUIRED_COVERAGE_FIELDS) {
    assert(Object.prototype.hasOwnProperty.call(row, field), `${label}: missing ${field}`);
  }
}

function assertIncluded(row, total, remaining, label, requireChoiceFields = true) {
  if (requireChoiceFields) assertCoverageFields(row, label);
  assert.strictEqual(row.isEligibleForAllowance, true, `${label}: eligible`);
  assert.strictEqual(row.includedTotalQty, total, `${label}: included total`);
  assert.strictEqual(row.remainingQty, remaining, `${label}: remaining`);
  assert.strictEqual(row.freeQtyAvailable, remaining, `${label}: free available`);
  assert.strictEqual(row.requestedQty, 1, `${label}: requested`);
  assert.strictEqual(row.coveredQty, 1, `${label}: covered`);
  assert.strictEqual(row.paidQty, 0, `${label}: paid`);
  assert.strictEqual(row.payableTotalHalala, 0, `${label}: payable`);
  assert.strictEqual(row.pricingMode, "allowance_covered", `${label}: pricing mode`);
  assert.strictEqual(row.source, "subscription", `${label}: source`);
  assert(row.addonPlanId, `${label}: addonPlanId`);
  assert(row.balanceBucketId, `${label}: balanceBucketId`);
  assert(row.entitlementKey, `${label}: entitlementKey`);
}

function assertPaidNoEntitlement(row, expectedUnitPrice, label, requireChoiceFields = true) {
  if (requireChoiceFields) assertCoverageFields(row, label);
  assert.strictEqual(row.isEligibleForAllowance, false, `${label}: eligible`);
  assert.strictEqual(row.coveredQty, 0, `${label}: covered`);
  assert.strictEqual(row.paidQty, 1, `${label}: paid`);
  assert.strictEqual(row.payableTotalHalala, expectedUnitPrice, `${label}: payable`);
  assert.strictEqual(row.unitPriceHalala, expectedUnitPrice, `${label}: unit price`);
  assert.strictEqual(row.pricingMode, "paid_no_entitlement", `${label}: pricing mode`);
  assert.strictEqual(row.source, "pending_payment", `${label}: source`);
  assert.strictEqual(row.addonPlanId, null, `${label}: addonPlanId`);
  assert.strictEqual(row.balanceBucketId, null, `${label}: balanceBucketId`);
}

function selectionBody({ protein, carb, addonIds }) {
  return {
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "standard_meal",
      proteinId: String(protein._id),
      carbs: [{ carbId: String(carb._id), grams: 150 }],
    }],
    addonsOneTime: addonIds.map(String),
  };
}

async function createUser(label) {
  return User.create({
    phone: `+9665${String(Date.now() + Math.floor(Math.random() * 9999)).slice(-8)}`,
    name: label,
    role: "client",
    isActive: true,
  });
}

async function createSubscriptionFixture({
  user,
  plan,
  addonPlan,
  products,
  includedTotalQty,
  balanceIncludedTotalQty = includedTotalQty,
  purchasedQty = includedTotalQty,
  remainingQty = includedTotalQty,
  consumedQty = 0,
  omitRemainingQty = false,
  startOffset = 2,
}) {
  const start = dateOffset(startOffset);
  const dates = [start, dateOffset(startOffset + 1), dateOffset(startOffset + 2)];
  const entitlementProducts = products.slice(0, 4);
  const balance = {
    addonId: addonPlan._id,
    addonPlanId: addonPlan._id,
    category: "juice",
    includedTotalQty: balanceIncludedTotalQty,
    purchasedQty,
    consumedQty,
    reservedQty: 0,
    overageConsumedQty: 0,
    unitPriceHalala: 1000,
    currency: "SAR",
  };
  if (!omitRemainingQty) balance.remainingQty = remainingQty;

  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: dateStart(start),
    endDate: dateEnd(dateOffset(startOffset + 10)),
    validityEndDate: dateEnd(dateOffset(startOffset + 10)),
    totalMeals: 11,
    remainingMeals: 11,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "main",
    addonSubscriptions: [{
      addonId: addonPlan._id,
      addonPlanId: addonPlan._id,
      addonPlanName: "Four Product Juice Allowance",
      category: "juice",
      maxPerDay: 5,
      quantityPerDay: 1,
      includedTotalQty,
      unitPriceHalala: 1000,
      currency: "SAR",
      menuProductIds: entitlementProducts.map((product) => product._id),
      menuProductsSnapshot: entitlementProducts.map((product) => ({
        id: product._id,
        key: product.key,
        name: product.name,
        nameI18n: product.name,
        category: "juice",
        categoryKey: "juices",
        itemType: "juice",
        priceHalala: product.priceHalala,
        currency: "SAR",
      })),
    }],
    addonBalance: [balance],
  });
  await SubscriptionDay.create(dates.map((date) => ({
    subscriptionId: subscription._id,
    date,
    status: "open",
    addonSelections: [],
  })));
  return { subscription, dates, token: issueAppAccessToken(user) };
}

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(`addon_entitlement_authority_${Date.now()}`));
  await Promise.all([Subscription.init(), SubscriptionDay.init()]);

  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "juices",
      name: { en: "Juices", ar: "Juices" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    const products = await MenuProduct.create(Array.from({ length: 5 }, (_, index) => ({
      categoryId: category._id,
      key: `authority_juice_${index + 1}`,
      name: { en: `Authority Juice ${index + 1}`, ar: `Authority Juice ${index + 1}` },
      itemType: "juice",
      pricingModel: "fixed",
      priceHalala: 1000 + index * 100,
      currency: "SAR",
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: index + 1,
    })));
    const plan = await Plan.create({
      name: { en: "Authority Plan", ar: "Authority Plan" },
      daysCount: 11,
      durationDays: 11,
      currency: "SAR",
      isActive: true,
      isAvailable: true,
      gramsOptions: [{
        grams: 200,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 1, priceHalala: 10000, compareAtHalala: 10000, isActive: true }],
      }],
    });
    const addonPlan = await Addon.create({
      name: { en: "Four Product Juice Allowance", ar: "Four Product Juice Allowance" },
      category: "juice",
      kind: "plan",
      type: "subscription",
      billingMode: "per_day",
      maxPerDay: 5,
      priceHalala: 1000,
      currency: "SAR",
      isActive: true,
      menuProductIds: products.slice(0, 4).map((product) => product._id),
    });
    const protein = await BuilderProtein.create({
      key: "authority_chicken",
      name: { en: "Authority Chicken", ar: "Authority Chicken" },
      displayCategoryId: new mongoose.Types.ObjectId(),
      displayCategoryKey: "chicken",
      proteinFamilyKey: "chicken",
      isPremium: false,
      premiumKey: "authority_chicken",
      extraFeeHalala: 0,
      currency: "SAR",
      availableForSubscription: true,
      isActive: true,
    });
    const carb = await BuilderCarb.create({
      key: "authority_rice",
      name: { en: "Authority Rice", ar: "Authority Rice" },
      displayCategoryId: new mongoose.Types.ObjectId(),
      displayCategoryKey: "standard_carbs",
      availableForSubscription: true,
      isActive: true,
    });

    const api = request(createApp());
    const primaryUser = await createUser("Primary authority user");
    const primary = await createSubscriptionFixture({
      user: primaryUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
    });
    const primaryAuth = { Authorization: `Bearer ${primary.token}`, "Accept-Language": "en" };

    let res = await api.get("/api/subscriptions/addon-choices").set(primaryAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const choices = res.body.data.juice.choices;
    assert.strictEqual(choices.length, 5, `four owned products plus one visible paid product: ${JSON.stringify(choices)}`);
    choices.forEach((choice, index) => assertCoverageFields(choice, `choice ${index + 1}`));
    const includedChoice = choices.find((choice) => String(choice.id) === String(products[0]._id));
    const extraChoice = choices.find((choice) => String(choice.id) === String(products[4]._id));
    assertIncluded(includedChoice, 7, 7, "GET addon-choices included");
    assertPaidNoEntitlement(extraChoice, products[4].priceHalala, "GET addon-choices extra");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en").set(primaryAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCatalog.entitlementResolved, true);
    assert.strictEqual(res.body.data.addonCatalog.items.length, 5);
    const plannerIncluded = res.body.data.addonCatalog.items.find((choice) => String(choice.id) === String(products[0]._id));
    const plannerExtra = res.body.data.addonCatalog.items.find((choice) => String(choice.id) === String(products[4]._id));
    assertIncluded(plannerIncluded, 7, 7, "meal-planner-menu included");
    assertPaidNoEntitlement(plannerExtra, products[4].priceHalala, "meal-planner-menu extra");

    const includedPayload = selectionBody({ protein, carb, addonIds: [products[0]._id] });
    res = await api
      .post(`/api/subscriptions/${primary.subscription._id}/days/${primary.dates[0]}/selection/validate`)
      .set(primaryAuth)
      .send(includedPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assertIncluded(res.body.data.addonSelections[0], 7, 7, "validate included", false);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 0);
    assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, 0);

    res = await api
      .put(`/api/subscriptions/${primary.subscription._id}/days/${primary.dates[0]}/selection`)
      .set(primaryAuth)
      .send(includedPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 0);
    assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, 0);
    const savedIncluded = res.body.data.addonSelections[0];
    assert.strictEqual(savedIncluded.source, "subscription");
    assert.strictEqual(savedIncluded.coveredQty, 1);
    assert.strictEqual(savedIncluded.paidQty, 0);
    assert.strictEqual(savedIncluded.payableTotalHalala, 0);
    assert(savedIncluded.addonPlanId);
    assert(savedIncluded.balanceBucketId);
    assert(savedIncluded.entitlementKey);

    res = await api
      .get(`/api/subscriptions/${primary.subscription._id}/days/${primary.dates[0]}`)
      .set(primaryAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.addonSelections[0].coveredQty, 1);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);

    const extraPayload = selectionBody({ protein, carb, addonIds: [products[4]._id] });
    res = await api
      .post(`/api/subscriptions/${primary.subscription._id}/days/${primary.dates[1]}/selection/validate`)
      .set(primaryAuth)
      .send(extraPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assertPaidNoEntitlement(res.body.data.addonSelections[0], products[4].priceHalala, "validate extra", false);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(res.body.data.paymentRequirement.blockingReason, "ADDON_PAYMENT_REQUIRED");
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 1);
    assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, products[4].priceHalala);

    res = await api
      .put(`/api/subscriptions/${primary.subscription._id}/days/${primary.dates[1]}/selection`)
      .set(primaryAuth)
      .send(extraPayload);
    assert.strictEqual(res.status, 402, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "pending_payment");
    assert.strictEqual(res.body.data.addonSelections[0].coveredQty, 0);
    assert.strictEqual(res.body.data.addonSelections[0].paidQty, 1);
    assert.strictEqual(res.body.data.addonSelections[0].payableTotalHalala, products[4].priceHalala);
    assert.strictEqual(res.body.data.paymentRequirement.blockingReason, "ADDON_PAYMENT_REQUIRED");

    res = await api.get("/api/subscriptions/current/overview").set(primaryAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert(Array.isArray(res.body.data.addonCoverage));
    const overviewIncluded = res.body.data.addonCoverage.find((row) => String(row.productId) === String(products[0]._id));
    assert(overviewIncluded, "overview contains exact included product coverage");
    assert.strictEqual(overviewIncluded.isEligibleForAllowance, true);
    assert.strictEqual(overviewIncluded.remainingQty, 6);
    assert.strictEqual(res.body.data.addonBalanceSummary.juice.remainingUnits, 6);

    const partialUser = await createUser("Partial allowance user");
    const partial = await createSubscriptionFixture({
      user: partialUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 4,
      startOffset: 4,
    });
    const partialAuth = { Authorization: `Bearer ${partial.token}` };
    const partialPayload = selectionBody({
      protein,
      carb,
      addonIds: [products[0]._id, products[1]._id, products[2]._id, products[3]._id, products[0]._id],
    });
    res = await api
      .post(`/api/subscriptions/${partial.subscription._id}/days/${partial.dates[0]}/selection/validate`)
      .set(partialAuth)
      .send(partialPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections.filter((row) => row.coveredQty === 1).length, 4);
    assert.strictEqual(res.body.data.addonSelections.filter((row) => row.paidQty === 1).length, 1);
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 1);
    assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, products[0].priceHalala);

    res = await api
      .put(`/api/subscriptions/${partial.subscription._id}/days/${partial.dates[0]}/selection`)
      .set(partialAuth)
      .send(partialPayload);
    assert.strictEqual(res.status, 402, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections.filter((row) => row.coveredQty === 1).length, 4);
    assert.strictEqual(res.body.data.addonSelections.filter((row) => row.paidQty === 1).length, 1);
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 1);
    assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, products[0].priceHalala);

    const brokenUser = await createUser("Broken production balance user");
    const broken = await createSubscriptionFixture({
      user: brokenUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      balanceIncludedTotalQty: 0,
      purchasedQty: 0,
      remainingQty: 0,
      consumedQty: 0,
      startOffset: 6,
    });
    const brokenAuth = { Authorization: `Bearer ${broken.token}` };
    res = await api.get("/api/subscriptions/addon-choices").set(brokenAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const brokenIncluded = res.body.data.juice.choices.find((row) => String(row.id) === String(products[0]._id));
    const brokenExtra = res.body.data.juice.choices.find((row) => String(row.id) === String(products[4]._id));
    assertIncluded(brokenIncluded, 7, 7, "recovered zero balance included");
    assertPaidNoEntitlement(brokenExtra, products[4].priceHalala, "recovered zero balance unrelated");
    res = await api
      .put(`/api/subscriptions/${broken.subscription._id}/days/${broken.dates[0]}/selection`)
      .set(brokenAuth)
      .send(includedPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    const repaired = await Subscription.findById(broken.subscription._id).lean();
    assert.strictEqual(repaired.addonBalance[0].purchasedQty, 7);
    assert.strictEqual(repaired.addonBalance[0].remainingQty, 6);
    assert.strictEqual(repaired.addonBalance[0].consumedQty, 1);

    const missingUser = await createUser("Missing remaining balance user");
    const missing = await createSubscriptionFixture({
      user: missingUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      balanceIncludedTotalQty: 0,
      purchasedQty: 0,
      consumedQty: 0,
      omitRemainingQty: true,
      startOffset: 8,
    });
    // Mongoose applies the schema default on create; remove the persisted field
    // to reproduce a genuinely missing production counter.
    await Subscription.collection.updateOne(
      { _id: missing.subscription._id },
      { $unset: { "addonBalance.0.remainingQty": "" } }
    );
    const missingAuth = { Authorization: `Bearer ${missing.token}` };
    res = await api
      .put(`/api/subscriptions/${missing.subscription._id}/days/${missing.dates[0]}/selection`)
      .set(missingAuth)
      .send(includedPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    const repairedMissing = await Subscription.findById(missing.subscription._id).lean();
    assert.strictEqual(repairedMissing.addonBalance[0].remainingQty, 6);

    const exhaustedUser = await createUser("Exhausted allowance user");
    const exhausted = await createSubscriptionFixture({
      user: exhaustedUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      purchasedQty: 7,
      remainingQty: 0,
      consumedQty: 7,
      startOffset: 10,
    });
    const exhaustedAuth = { Authorization: `Bearer ${exhausted.token}` };
    res = await api.get("/api/subscriptions/addon-choices").set(exhaustedAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const exhaustedChoice = res.body.data.juice.choices.find((row) => String(row.id) === String(products[0]._id));
    assertCoverageFields(exhaustedChoice, "exhausted choice");
    assert.strictEqual(exhaustedChoice.isEligibleForAllowance, true);
    assert.strictEqual(exhaustedChoice.remainingQty, 0);
    assert.strictEqual(exhaustedChoice.coveredQty, 0);
    assert.strictEqual(exhaustedChoice.paidQty, 1);
    assert.strictEqual(exhaustedChoice.payableTotalHalala, products[0].priceHalala);
    assert.strictEqual(exhaustedChoice.pricingMode, "paid_overage");
    res = await api
      .post(`/api/subscriptions/${exhausted.subscription._id}/days/${exhausted.dates[0]}/selection/validate`)
      .set(exhaustedAuth)
      .send(includedPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 1);

    console.log("subscription add-on entitlement authority integration test passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
