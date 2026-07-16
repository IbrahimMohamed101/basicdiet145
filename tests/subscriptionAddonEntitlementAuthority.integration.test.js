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
const {
  buildAddonCategoryAllowances,
  buildAddonSubscriptionAllowances,
} = require("../src/services/subscription/subscriptionAddonBalanceService");

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

function assertPaidNoEntitlement(row, expectedUnitPrice, label, requireChoiceFields = true, expectNoPlan = true) {
  if (requireChoiceFields) assertCoverageFields(row, label);
  assert.strictEqual(row.isEligibleForAllowance, false, `${label}: eligible`);
  assert.strictEqual(row.coveredQty, 0, `${label}: covered`);
  assert.strictEqual(row.paidQty, 1, `${label}: paid`);
  assert.strictEqual(row.payableTotalHalala, expectedUnitPrice, `${label}: payable`);
  assert.strictEqual(row.unitPriceHalala, expectedUnitPrice, `${label}: unit price`);
  assert.strictEqual(row.pricingMode, "paid_no_entitlement", `${label}: pricing mode`);
  assert.strictEqual(row.source, "pending_payment", `${label}: source`);
  if (expectNoPlan) assert.strictEqual(row.addonPlanId, null, `${label}: addonPlanId`);
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

async function createMultiPlanAllowanceFixture({ user, plan }) {
  const definitions = [
    { allowanceCategory: "juice", displayCategory: "juice", sourceCategory: "juices", name: "Juice Subscription", nameAr: "عصائر", priceHalala: 1000 },
    { allowanceCategory: "small_salad", displayCategory: "small_salad", sourceCategory: "light_options", name: "Small Salad Subscription", nameAr: "سلطة صغيرة", priceHalala: 900 },
    { allowanceCategory: "snack", displayCategory: "snack", sourceCategory: "desserts", name: "Snack Subscription", nameAr: "سناك", priceHalala: 1500 },
    { allowanceCategory: "snack", displayCategory: "ice_cream", sourceCategory: "ice_cream", name: "Ice Cream Subscription", nameAr: "آيس كريم", priceHalala: 500 },
  ];
  const now = new Date();
  const planProducts = [];
  for (const [definitionIndex, definition] of definitions.entries()) {
    const category = await MenuCategory.findOne({ key: definition.sourceCategory })
      || await MenuCategory.create({
        key: definition.sourceCategory,
        name: { en: definition.name, ar: definition.nameAr },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
      });
    planProducts.push(await MenuProduct.create(Array.from({ length: 3 }, (_, productIndex) => ({
      categoryId: category._id,
      key: `multi_${definition.displayCategory}_${productIndex + 1}`,
      name: {
        en: `${definition.name} Choice ${productIndex + 1}`,
        ar: `${definition.nameAr} ${productIndex + 1}`,
      },
      itemType: definition.displayCategory,
      pricingModel: "fixed",
      priceHalala: definition.priceHalala,
      currency: "SAR",
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: definitionIndex * 10 + productIndex,
    }))));
  }
  const addonPlans = await Addon.create(definitions.map((definition, index) => ({
    name: { en: definition.name, ar: definition.nameAr },
    category: definition.allowanceCategory,
    kind: "plan",
    type: "subscription",
    billingMode: "per_day",
    maxPerDay: 1,
    priceHalala: definition.priceHalala,
    currency: "SAR",
    isActive: true,
    menuProductIds: planProducts[index].map((product) => product._id),
    menuCategoryKeys: [definition.displayCategory],
    sortOrder: 20 + index,
  })));
  const start = dateOffset(20);
  const entitlementRows = definitions.map((definition, index) => ({
    addonId: addonPlans[index]._id,
    addonPlanId: addonPlans[index]._id,
    addonPlanName: definition.name,
    category: definition.allowanceCategory,
    maxPerDay: 1,
    quantityPerDay: 1,
    includedTotalQty: 7,
    unitPriceHalala: definition.priceHalala,
    currency: "SAR",
    menuProductIds: planProducts[index].map((product) => product._id),
    menuCategoryKeys: [definition.displayCategory],
    menuProductsSnapshot: planProducts[index].map((product) => ({
      id: product._id,
      key: product.key,
      name: product.name,
      nameI18n: product.name,
      category: definition.displayCategory,
      categoryKey: definition.displayCategory,
      itemType: definition.displayCategory,
      priceHalala: product.priceHalala,
      currency: "SAR",
    })),
  }));
  const balanceRows = definitions.map((definition, index) => ({
    addonId: addonPlans[index]._id,
    addonPlanId: addonPlans[index]._id,
    name: definition.name,
    category: definition.allowanceCategory,
    includedTotalQty: 7,
    purchasedQty: 7,
    consumedQty: 0,
    reservedQty: 0,
    remainingQty: 7,
    overageUnitPriceHalala: definition.priceHalala,
    unitPriceHalala: definition.priceHalala,
    currency: "SAR",
  }));
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: dateStart(start),
    endDate: dateEnd(dateOffset(30)),
    validityEndDate: dateEnd(dateOffset(30)),
    totalMeals: 11,
    remainingMeals: 11,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "main",
    addonSubscriptions: entitlementRows,
    addonBalance: balanceRows,
  });
  await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: start,
    status: "open",
    addonSelections: [],
  });
  return {
    subscription,
    date: start,
    token: issueAppAccessToken(user),
    addonPlans,
    planProducts,
  };
}

async function replaceEntitlementProductsWithoutSnapshots(subscriptionId, productIds, { addonPlanId = null } = {}) {
  const set = {
    "addonSubscriptions.0.menuProductIds": productIds,
  };
  if (addonPlanId) {
    set["addonSubscriptions.0.addonId"] = addonPlanId;
    set["addonSubscriptions.0.addonPlanId"] = addonPlanId;
    set["addonBalance.0.addonId"] = addonPlanId;
    set["addonBalance.0.addonPlanId"] = addonPlanId;
  }
  await Subscription.collection.updateOne(
    { _id: subscriptionId },
    {
      $set: set,
      $unset: {
        "addonSubscriptions.0.menuProductsSnapshot": "",
      },
    }
  );
}

function assertLegacyRecoveredChoice(row, {
  sourceProductId,
  total,
  remaining,
  unitPriceHalala,
  covered,
}, label) {
  assertCoverageFields(row, label);
  assert.notStrictEqual(row.name, "Unavailable add-on", `${label}: real live name`);
  assert.strictEqual(row.snapshotMissing, true, `${label}: snapshotMissing`);
  assert.strictEqual(row.liveCatalogMissing, false, `${label}: liveCatalogMissing`);
  assert.strictEqual(row.legacyRecovered, true, `${label}: legacyRecovered`);
  assert.strictEqual(String(row.legacySourceProductId), String(sourceProductId), `${label}: legacy source id`);
  assert.strictEqual(row.ownedSnapshot, false, `${label}: ownedSnapshot`);
  assert.strictEqual(row.available, true, `${label}: available`);
  assert.strictEqual(row.active, true, `${label}: active`);
  assert.strictEqual(row.availableForNewSale, false, `${label}: availableForNewSale`);
  assert.strictEqual(row.isEligibleForAllowance, true, `${label}: eligible`);
  assert.strictEqual(row.includedTotalQty, total, `${label}: included total`);
  assert.strictEqual(row.remainingQty, remaining, `${label}: remaining`);
  assert.strictEqual(row.coveredQty, covered ? 1 : 0, `${label}: covered`);
  assert.strictEqual(row.paidQty, covered ? 0 : 1, `${label}: paid`);
  assert.strictEqual(row.unitPriceHalala, unitPriceHalala, `${label}: unit price`);
  assert.strictEqual(row.payableTotalHalala, covered ? 0 : unitPriceHalala, `${label}: payable`);
  assert.strictEqual(row.pricingMode, covered ? "allowance_covered" : "paid_overage", `${label}: pricing mode`);
  assert.notStrictEqual(row.pricingMode, "paid_no_entitlement", `${label}: never a non-entitled extra`);
}

function assertMissingOwnedPlaceholder(row, { total, remaining, unitPriceHalala, covered }, label) {
  assertCoverageFields(row, label);
  assert.strictEqual(row.name, "Unavailable add-on", `${label}: name`);
  assert.strictEqual(row.nameAr, "إضافة غير متاحة", `${label}: Arabic name`);
  assert.strictEqual(row.snapshotMissing, true, `${label}: snapshotMissing`);
  assert.strictEqual(row.liveCatalogMissing, true, `${label}: liveCatalogMissing`);
  assert.strictEqual(row.ownedSnapshot, false, `${label}: ownedSnapshot`);
  assert.strictEqual(row.available, false, `${label}: available`);
  assert.strictEqual(row.active, false, `${label}: active`);
  assert.strictEqual(row.availableForNewSale, false, `${label}: availableForNewSale`);
  assert.strictEqual(row.isEligibleForAllowance, true, `${label}: eligible`);
  assert.strictEqual(row.includedTotalQty, total, `${label}: included total`);
  assert.strictEqual(row.remainingQty, remaining, `${label}: remaining`);
  assert.strictEqual(row.coveredQty, covered ? 1 : 0, `${label}: covered`);
  assert.strictEqual(row.paidQty, covered ? 0 : 1, `${label}: paid`);
  assert.strictEqual(row.unitPriceHalala, unitPriceHalala, `${label}: unit price`);
  assert.strictEqual(row.payableTotalHalala, covered ? 0 : unitPriceHalala, `${label}: payable`);
  assert.strictEqual(row.pricingMode, covered ? "allowance_covered" : "paid_overage", `${label}: pricing mode`);
  assert.notStrictEqual(row.pricingMode, "paid_no_entitlement", `${label}: never a non-entitled extra`);
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
    assert.strictEqual(choices.length, 4, `group choices come only from the dashboard add-on plan: ${JSON.stringify(choices)}`);
    choices.forEach((choice, index) => assertCoverageFields(choice, `choice ${index + 1}`));
    const includedChoice = choices.find((choice) => String(choice.id) === String(products[0]._id));
    assertIncluded(includedChoice, 7, 7, "GET addon-choices included");
    assert(!choices.some((choice) => String(choice.id) === String(products[4]._id)), "unconfigured same-category product is not injected into the plan group");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en").set(primaryAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCatalog.entitlementResolved, true);
    assert.strictEqual(res.body.data.addonCatalog.items.length, 4);
    const plannerIncluded = res.body.data.addonCatalog.items.find((choice) => String(choice.id) === String(products[0]._id));
    assertIncluded(plannerIncluded, 7, 7, "meal-planner-menu included");
    assert(!res.body.data.addonCatalog.items.some((choice) => String(choice.id) === String(products[4]._id)));

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
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 1);

    const multiPlanUser = await createUser("Four plan allowance user");
    const multiPlan = await createMultiPlanAllowanceFixture({ user: multiPlanUser, plan });
    const multiPlanAuth = { Authorization: `Bearer ${multiPlan.token}`, "Accept-Language": "en" };
    const multiPlanSubscription = await Subscription.findById(multiPlan.subscription._id).lean();
    const categoryAllowances = buildAddonCategoryAllowances(multiPlanSubscription);
    const subscriptionAllowances = buildAddonSubscriptionAllowances(multiPlanSubscription);
    assert.strictEqual(categoryAllowances.length, 3, JSON.stringify(categoryAllowances));
    assert.strictEqual(categoryAllowances.find((row) => row.category === "snack").includedTotalQty, 14);
    assert.strictEqual(subscriptionAllowances.length, 4, JSON.stringify(subscriptionAllowances));
    assert.strictEqual(new Set(subscriptionAllowances.map((row) => row.addonPlanId)).size, 4);
    assert.strictEqual(new Set(subscriptionAllowances.map((row) => row.entitlementKey)).size, 4);
    assert(subscriptionAllowances.every((row) => row.includedTotalQty === 7));
    assert(subscriptionAllowances.every((row) => row.remainingIncludedQty === 7));
    assert(subscriptionAllowances.every((row) => row.choicesCount === 3));
    assert(subscriptionAllowances.every((row) => row.source === "subscription"));
    const snackPlanAllowance = subscriptionAllowances.find((row) => row.displayCategory === "snack");
    const iceCreamPlanAllowance = subscriptionAllowances.find((row) => row.displayCategory === "ice_cream");
    assert(snackPlanAllowance, JSON.stringify(subscriptionAllowances));
    assert(iceCreamPlanAllowance, JSON.stringify(subscriptionAllowances));
    assert.strictEqual(snackPlanAllowance.entitlementCategory, "snack");
    assert.strictEqual(iceCreamPlanAllowance.entitlementCategory, "snack");
    assert.notStrictEqual(snackPlanAllowance.addonPlanId, iceCreamPlanAllowance.addonPlanId);
    assert(subscriptionAllowances.every((row) => row.balanceBucketId));

    const reservedByPlan = buildAddonSubscriptionAllowances(multiPlanSubscription, {
      addonSelections: [{
        source: "subscription",
        category: "snack",
        addonPlanId: multiPlan.addonPlans[3]._id,
        qty: 1,
      }],
    });
    assert.strictEqual(reservedByPlan.find((row) => row.displayCategory === "snack").remainingIncludedQty, 7);
    assert.strictEqual(reservedByPlan.find((row) => row.displayCategory === "ice_cream").remainingIncludedQty, 6);
    const reservedCategoryAggregate = buildAddonCategoryAllowances(multiPlanSubscription, {
      addonSelections: [{
        source: "subscription",
        category: "snack",
        addonPlanId: multiPlan.addonPlans[3]._id,
        qty: 1,
      }],
    });
    assert.strictEqual(reservedCategoryAggregate.find((row) => row.category === "snack").remainingIncludedQty, 13);

    const threePlanRegression = buildAddonSubscriptionAllowances({
      addonSubscriptions: multiPlanSubscription.addonSubscriptions.slice(0, 3),
      addonBalance: multiPlanSubscription.addonBalance.slice(0, 3),
    });
    assert.strictEqual(threePlanRegression.length, 3, JSON.stringify(threePlanRegression));

    res = await api.get("/api/subscriptions/current/overview").set(multiPlanAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 4);

    await Addon.updateOne({ _id: addonPlan._id }, { $set: { isActive: false } });
    res = await api.get("/api/subscriptions/addon-choices").set({
      ...multiPlanAuth,
      "Accept-Language": "ar",
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert(Array.isArray(res.body.addonChoiceGroups), JSON.stringify(res.body));
    assert.strictEqual(res.body.addonChoiceGroups.length, 4, JSON.stringify(res.body.addonChoiceGroups));
    assert.deepStrictEqual(
      res.body.addonChoiceGroups.map((group) => group.displayKey),
      ["juice", "small_salad", "snack", "ice_cream"]
    );
    assert.deepStrictEqual(
      res.body.addonChoiceGroups.map((group) => group.label),
      ["عصائر", "سلطة صغيرة", "سناك", "آيس كريم"]
    );
    assert(res.body.addonChoiceGroups.every((group) => group.label === group.labelText));
    assert(res.body.addonChoiceGroups.every((group) => group.label === group.labelAr));
    assert.strictEqual(new Set(res.body.addonChoiceGroups.map((group) => group.addonPlanId)).size, 4);
    const snackChoiceGroup = res.body.addonChoiceGroups.find((group) => group.displayKey === "snack");
    const iceCreamChoiceGroup = res.body.addonChoiceGroups.find((group) => group.displayKey === "ice_cream");
    assert.strictEqual(snackChoiceGroup.allowanceCategory, "snack");
    assert.strictEqual(iceCreamChoiceGroup.allowanceCategory, "snack");
    assert.deepStrictEqual(
      snackChoiceGroup.choices.map((choice) => choice.productId).sort(),
      multiPlan.planProducts[2].map((product) => String(product._id)).sort()
    );
    assert.deepStrictEqual(
      iceCreamChoiceGroup.choices.map((choice) => choice.productId).sort(),
      multiPlan.planProducts[3].map((product) => String(product._id)).sort()
    );
    assert.strictEqual(
      snackChoiceGroup.choices.some((choice) => iceCreamChoiceGroup.choices.some((iceChoice) => iceChoice.productId === choice.productId)),
      false,
      "Snack and Ice Cream do not share products unless the dashboard plans explicitly configure them"
    );
    const compatibilityKeys = Object.keys(res.body.data).sort();
    assert.deepStrictEqual(compatibilityKeys, ["ice_cream", "juice", "small_salad", "snack"]);
    assert.strictEqual(res.body.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.addonSubscriptionAllowances.length, 4);
    const exposedEntitlements = Object.values(res.body.data)
      .flatMap((group) => Array.isArray(group && group.entitlements) ? group.entitlements : []);
    assert.strictEqual(new Set(exposedEntitlements.map((row) => String(row.addonPlanId))).size, 4, JSON.stringify(exposedEntitlements));
    const badIncludedAsPaid = Object.values(res.body.data)
      .flatMap((group) => Array.isArray(group && group.choices) ? group.choices : [])
      .filter((choice) => choice.source === "subscription" && choice.pricingMode === "paid_no_entitlement");
    assert.strictEqual(badIncludedAsPaid.length, 0, JSON.stringify(badIncludedAsPaid));

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=ar").set(multiPlanAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonChoiceGroups.length, 4);
    assert.deepStrictEqual(
      res.body.data.addonChoiceGroups.map((group) => group.label),
      ["عصائر", "سلطة صغيرة", "سناك", "آيس كريم"]
    );
    assert.strictEqual(res.body.data.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 4);

    res = await api
      .get(`/api/subscriptions/${multiPlan.subscription._id}/days/${multiPlan.date}`)
      .set(multiPlanAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 4);

    const multiPlanPayload = selectionBody({
      protein,
      carb,
      addonIds: [multiPlan.planProducts[3][0]._id],
    });
    res = await api
      .post(`/api/subscriptions/${multiPlan.subscription._id}/days/${multiPlan.date}/selection/validate`)
      .set(multiPlanAuth)
      .send(multiPlanPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 4);
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.addonSelections[0].pricingMode, "allowance_covered");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    assert.strictEqual(
      res.body.data.addonSubscriptionAllowances.find((row) => row.displayCategory === "ice_cream").remainingIncludedQty,
      6
    );

    res = await api
      .put(`/api/subscriptions/${multiPlan.subscription._id}/days/${multiPlan.date}/selection`)
      .set(multiPlanAuth)
      .send(multiPlanPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonCategoryAllowances.length, 3);
    assert.strictEqual(res.body.data.addonSubscriptionAllowances.length, 4);
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);

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
    assertIncluded(brokenIncluded, 7, 7, "recovered zero balance included");
    assert(!res.body.data.juice.choices.some((row) => String(row.id) === String(products[4]._id)));
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

    const historicalMissingProductIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];
    const historicalUser = await createUser("Historical plan recovery user");
    const historical = await createSubscriptionFixture({
      user: historicalUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      startOffset: 12,
    });
    await replaceEntitlementProductsWithoutSnapshots(
      historical.subscription._id,
      historicalMissingProductIds
    );
    const historicalAuth = { Authorization: `Bearer ${historical.token}`, "Accept-Language": "en" };

    res = await api.get("/api/subscriptions/addon-choices").set(historicalAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const historicalChoices = res.body.data.juice.choices;
    const recoveredChoices = products.slice(0, 3).map((product) => (
      historicalChoices.find((row) => String(row.id) === String(product._id))
    ));
    const historicalUnrelatedChoice = historicalChoices.find((row) => String(row.id) === String(products[4]._id));
    recoveredChoices.forEach((choice, index) => assertLegacyRecoveredChoice(
      choice,
      {
        sourceProductId: historicalMissingProductIds[index],
        total: 7,
        remaining: 7,
        unitPriceHalala: products[index].priceHalala,
        covered: true,
      },
      `GET recovered live product ${index + 1}`
    ));
    assert.strictEqual(
      historicalChoices.filter((row) => row.legacyRecovered === true).length,
      3,
      "recovery is capped to the historical entitlement product count"
    );
    const currentPlanPaidChoice = historicalChoices.find((row) => String(row.id) === String(products[3]._id));
    assert(currentPlanPaidChoice, JSON.stringify(historicalChoices));
    assertPaidNoEntitlement(
      currentPlanPaidChoice,
      products[3].priceHalala,
      "current plan product beyond historical count",
      true,
      false
    );
    assert.strictEqual(historicalUnrelatedChoice, undefined, "products outside the dashboard plan are not injected by category");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en").set(historicalAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const plannerRecovered = res.body.data.addonCatalog.items
      .find((row) => String(row.id) === String(products[0]._id));
    assertLegacyRecoveredChoice(
      plannerRecovered,
      {
        sourceProductId: historicalMissingProductIds[0],
        total: 7,
        remaining: 7,
        unitPriceHalala: products[0].priceHalala,
        covered: true,
      },
      "meal planner recovered live product"
    );

    const historicalRecoveredPayload = selectionBody({
      protein,
      carb,
      addonIds: [products[0]._id],
    });
    res = await api
      .post(`/api/subscriptions/${historical.subscription._id}/days/${historical.dates[0]}/selection/validate`)
      .set(historicalAuth)
      .send(historicalRecoveredPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.addonSelections[0].snapshotMissing, true);
    assert.strictEqual(res.body.data.addonSelections[0].legacyRecovered, true);
    assert.strictEqual(String(res.body.data.addonSelections[0].legacySourceProductId), String(historicalMissingProductIds[0]));
    assert.strictEqual(res.body.data.addonSelections[0].coveredQty, 1);
    assert.strictEqual(res.body.data.addonSelections[0].paidQty, 0);
    assert.strictEqual(res.body.data.addonSelections[0].pricingMode, "allowance_covered");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);

    res = await api
      .put(`/api/subscriptions/${historical.subscription._id}/days/${historical.dates[0]}/selection`)
      .set(historicalAuth)
      .send(historicalRecoveredPayload);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.addonSelections[0].snapshotMissing, true);
    assert.strictEqual(res.body.data.addonSelections[0].legacyRecovered, true);
    assert.strictEqual(res.body.data.addonSelections[0].coveredQty, 1);
    assert.strictEqual(res.body.data.addonSelections[0].paidQty, 0);
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);

    res = await api
      .post(`/api/subscriptions/${historical.subscription._id}/days/${historical.dates[1]}/selection/validate`)
      .set(historicalAuth)
      .send(selectionBody({ protein, carb, addonIds: [historicalMissingProductIds[1]] }));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(String(res.body.data.addonSelections[0].productId), String(products[1]._id));
    assert.strictEqual(res.body.data.addonSelections[0].legacyRecovered, true);
    assert.strictEqual(String(res.body.data.addonSelections[0].legacySourceProductId), String(historicalMissingProductIds[1]));
    assert.strictEqual(res.body.data.addonSelections[0].pricingMode, "allowance_covered");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);

    const exhaustedMissingProductIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];
    const exhaustedMissingUser = await createUser("Exhausted legacy recovery user");
    const exhaustedMissing = await createSubscriptionFixture({
      user: exhaustedMissingUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      purchasedQty: 7,
      remainingQty: 0,
      consumedQty: 7,
      startOffset: 14,
    });
    await replaceEntitlementProductsWithoutSnapshots(
      exhaustedMissing.subscription._id,
      exhaustedMissingProductIds
    );
    const exhaustedMissingAuth = { Authorization: `Bearer ${exhaustedMissing.token}`, "Accept-Language": "en" };
    res = await api.get("/api/subscriptions/addon-choices").set(exhaustedMissingAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const recoveredOverageChoice = res.body.data.juice.choices
      .find((row) => String(row.id) === String(products[0]._id));
    assertLegacyRecoveredChoice(
      recoveredOverageChoice,
      {
        sourceProductId: exhaustedMissingProductIds[0],
        total: 7,
        remaining: 0,
        unitPriceHalala: products[0].priceHalala,
        covered: false,
      },
      "exhausted recovered live product"
    );
    res = await api
      .post(`/api/subscriptions/${exhaustedMissing.subscription._id}/days/${exhaustedMissing.dates[0]}/selection/validate`)
      .set(exhaustedMissingAuth)
      .send(selectionBody({ protein, carb, addonIds: [products[0]._id] }));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].isEligibleForAllowance, true);
    assert.strictEqual(res.body.data.addonSelections[0].pricingMode, "paid_overage");
    assert.notStrictEqual(res.body.data.addonSelections[0].pricingMode, "paid_no_entitlement");

    const zeroCounterMissingProductIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];
    const recoveredMissingUser = await createUser("Recovered legacy plan and balance user");
    const recoveredMissing = await createSubscriptionFixture({
      user: recoveredMissingUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      balanceIncludedTotalQty: 0,
      purchasedQty: 0,
      remainingQty: 0,
      consumedQty: 0,
      startOffset: 16,
    });
    await replaceEntitlementProductsWithoutSnapshots(
      recoveredMissing.subscription._id,
      zeroCounterMissingProductIds
    );
    const recoveredMissingAuth = { Authorization: `Bearer ${recoveredMissing.token}`, "Accept-Language": "en" };
    res = await api.get("/api/subscriptions/addon-choices").set(recoveredMissingAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const recoveredMissingChoice = res.body.data.juice.choices
      .find((row) => String(row.id) === String(products[0]._id));
    assertLegacyRecoveredChoice(
      recoveredMissingChoice,
      {
        sourceProductId: zeroCounterMissingProductIds[0],
        total: 7,
        remaining: 7,
        unitPriceHalala: products[0].priceHalala,
        covered: true,
      },
      "recovered plan mapping and balance"
    );
    res = await api
      .put(`/api/subscriptions/${recoveredMissing.subscription._id}/days/${recoveredMissing.dates[0]}/selection`)
      .set(recoveredMissingAuth)
      .send(selectionBody({ protein, carb, addonIds: [products[0]._id] }));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.addonSelections[0].source, "subscription");
    assert.strictEqual(res.body.data.addonSelections[0].pricingMode, "allowance_covered");
    assert.strictEqual(res.body.data.paymentRequirement.requiresPayment, false);
    const repairedRecoveredMissing = await Subscription.findById(recoveredMissing.subscription._id).lean();
    assert.strictEqual(repairedRecoveredMissing.addonBalance[0].remainingQty, 6);
    assert.strictEqual(repairedRecoveredMissing.addonBalance[0].consumedQty, 1);

    const unmappedMissingProductId = new mongoose.Types.ObjectId();
    const missingPlanId = new mongoose.Types.ObjectId();
    const unmappedUser = await createUser("Unmapped historical placeholder user");
    const unmapped = await createSubscriptionFixture({
      user: unmappedUser,
      plan,
      addonPlan,
      products,
      includedTotalQty: 7,
      startOffset: 18,
    });
    await replaceEntitlementProductsWithoutSnapshots(
      unmapped.subscription._id,
      [unmappedMissingProductId],
      { addonPlanId: missingPlanId }
    );
    const unmappedAuth = { Authorization: `Bearer ${unmapped.token}`, "Accept-Language": "en" };
    res = await api.get("/api/subscriptions/addon-choices").set(unmappedAuth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const unmappedGroup = res.body.addonChoiceGroups.find((group) => String(group.addonPlanId) === String(missingPlanId));
    assert(unmappedGroup, JSON.stringify(res.body.addonChoiceGroups));
    const unmappedPlaceholder = unmappedGroup.choices
      .find((row) => String(row.id) === String(unmappedMissingProductId));
    assertMissingOwnedPlaceholder(
      unmappedPlaceholder,
      { total: 7, remaining: 7, unitPriceHalala: 1000, covered: true },
      "no safe plan mapping placeholder fallback"
    );
    assert.strictEqual(unmappedPlaceholder.legacyRecovered, false);

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
