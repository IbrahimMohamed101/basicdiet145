"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const pricingService = require("../src/services/subscription/subscriptionAddonPricingService");
const opsPayloadService = require("../src/services/dashboard/opsPayloadService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function juiceEntitlement({ planId, productIds, snapshots, quantityPerDay = 1, includedTotalQty = 4 }) {
  return {
    addonId: planId,
    addonPlanId: planId,
    name: "عصير",
    addonPlanName: "عصير",
    addonPlanNameI18n: { ar: "عصير", en: "Juice" },
    category: "juice",
    allowanceCategory: "juice",
    displayKey: "juice",
    displayCategory: "juice",
    entitlementKey: `juice:${String(planId)}`,
    maxPerDay: 1,
    quantityPerDay,
    purchasedDailyQty: quantityPerDay,
    includedTotalQty,
    unitPriceHalala: 500,
    currency: "SAR",
    menuProductIds: productIds,
    menuProductsSnapshot: snapshots,
  };
}

function juiceBalance({ bucketId, planId, remainingQty = 4, consumedQty = 0, reservedQty = 0 }) {
  return {
    _id: bucketId,
    addonPlanId: planId,
    addonId: planId,
    entitlementKey: `juice:${String(planId)}`,
    category: "juice",
    allowanceCategory: "juice",
    displayKey: "juice",
    displayCategory: "juice",
    purchasedDailyQty: 1,
    includedTotalQty: remainingQty + consumedQty + reservedQty,
    purchasedQty: remainingQty + consumedQty + reservedQty,
    remainingQty,
    consumedQty,
    reservedQty,
    unitPriceHalala: 500,
    currency: "SAR",
  };
}

async function createSubscription({
  userId = oid(),
  multiProduct = false,
  remainingQty = 4,
  quantityPerDay = 1,
} = {}) {
  const planId = oid();
  const addonPlanId = oid();
  const bucketId = oid();
  const firstProductId = oid();
  const secondProductId = oid();
  const productIds = multiProduct ? [firstProductId, secondProductId] : [firstProductId];
  const snapshots = multiProduct
    ? [
      { id: firstProductId, key: "orange_juice", nameI18n: { ar: "عصير برتقال", en: "Orange Juice" }, priceHalala: 500, currency: "SAR" },
      { id: secondProductId, key: "apple_juice", nameI18n: { ar: "عصير تفاح", en: "Apple Juice" }, priceHalala: 500, currency: "SAR" },
    ]
    : [
      { id: firstProductId, key: "orange_juice", nameI18n: { ar: "عصير برتقال", en: "Orange Juice" }, priceHalala: 500, currency: "SAR" },
    ];

  const subscription = await Subscription.create({
    userId,
    planId,
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
    totalMeals: 30,
    remainingMeals: 30,
    deliveryMode: "delivery",
    deliveryWindow: "18:00-20:00",
    addonSubscriptions: [juiceEntitlement({
      planId: addonPlanId,
      productIds,
      snapshots,
      quantityPerDay,
      includedTotalQty: remainingQty,
    })],
    addonBalance: [juiceBalance({ bucketId, planId: addonPlanId, remainingQty })],
  });

  return { subscription, addonPlanId, bucketId, firstProductId, secondProductId };
}

async function createConfirmedDay(subscriptionId, date) {
  return SubscriptionDay.create({
    subscriptionId,
    date,
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    plannerRevisionHash: `revision-${date}`,
    mealSlots: [],
    addonSelections: [],
  });
}

function bucketOf(subscription, bucketId) {
  return (subscription.addonBalance || []).find((row) => String(row._id) === String(bucketId));
}

async function assertBalance(subscriptionId, bucketId, expected, label) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  const bucket = bucketOf(subscription, bucketId);
  assert(bucket, `${label}: balance bucket missing`);
  assert.strictEqual(Number(bucket.remainingQty || 0), expected.remainingQty, `${label}: remainingQty`);
  assert.strictEqual(Number(bucket.reservedQty || 0), expected.reservedQty, `${label}: reservedQty`);
  assert.strictEqual(Number(bucket.consumedQty || 0), expected.consumedQty, `${label}: consumedQty`);
  assert.strictEqual(
    Number(bucket.remainingQty || 0) + Number(bucket.reservedQty || 0) + Number(bucket.consumedQty || 0),
    Number(bucket.purchasedQty || bucket.includedTotalQty || 0),
    `${label}: invariant`
  );
  return { subscription, bucket };
}

async function testAutomaticDailyDefaultAndFulfillment() {
  const { subscription, bucketId } = await createSubscription({ remainingQty: 4 });
  const day = await createConfirmedDay(subscription._id, "2026-07-22");

  const first = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
  assert.strictEqual(first.appliedCount, 1);

  let currentDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(currentDay.addonSelections.length, 1);
  const selection = currentDay.addonSelections[0];
  assert.strictEqual(selection.autoDailyAddon, true);
  assert.strictEqual(selection.dailyEntitlement, true);
  assert.strictEqual(selection.source, "wallet");
  assert.strictEqual(selection.addonSettlementState, "reserved");
  assert.match(selection.name, /اشتراك/);
  assert.match(selection.name, /عصير/);
  assert.strictEqual(selection.requiresKitchenChoice, false);
  assert(selection.dailyAllocationKey);
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 1, consumedQty: 0 }, "daily default reserve");

  const second = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
  assert.strictEqual(second.appliedCount, 0, "reconciliation must be idempotent");
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 1, consumedQty: 0 }, "idempotent reserve");

  const kitchen = opsPayloadService.buildKitchenDetailsPayload(
    currentDay,
    await Subscription.findById(subscription._id).lean(),
    "ar",
    {}
  );
  assert.strictEqual(kitchen.addons.length, 1);
  assert.strictEqual(kitchen.addons[0].autoDailyAddon, true);
  assert.match(kitchen.addons[0].name, /اشتراك/);
  assert.strictEqual(kitchen.dailyAddonSummary.total, 1);

  const consumed = await dailyAddonService.consumeDailyAddonReservationsForDay({
    dayId: day._id,
    reason: "fulfilled",
  });
  assert.strictEqual(consumed.consumedCount, 1);
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 0, consumedQty: 1 }, "fulfillment consume");
  currentDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(currentDay.addonSelections[0].addonSettlementState, "consumed");

  const replay = await dailyAddonService.consumeDailyAddonReservationsForDay({ dayId: day._id, reason: "fulfilled" });
  assert.strictEqual(replay.consumedCount, 0);
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 0, consumedQty: 1 }, "idempotent fulfill");
}

async function testSkipAndNoShowReturnCredits() {
  const { subscription, bucketId, addonPlanId, firstProductId } = await createSubscription({ remainingQty: 4 });
  const skippedDay = await createConfirmedDay(subscription._id, "2026-07-23");
  await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: skippedDay._id });
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 1, consumedQty: 0 }, "before skip");

  await SubscriptionDay.updateOne({ _id: skippedDay._id }, { $set: { status: "skipped" } });
  const released = await dailyAddonService.reconcileDayDailyAddonState({ dayId: skippedDay._id });
  assert.strictEqual(released.releasedCount, 1);
  await assertBalance(subscription._id, bucketId, { remainingQty: 4, reservedQty: 0, consumedQty: 0 }, "skip release");
  const skippedAfter = await SubscriptionDay.findById(skippedDay._id).lean();
  assert.strictEqual(skippedAfter.addonSelections[0].addonSettlementState, "released");

  const noShowDay = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-24",
    status: "no_show",
    plannerState: "confirmed",
    addonSelections: [{
      addonId: firstProductId,
      productId: firstProductId,
      menuProductId: firstProductId,
      addonPlanId,
      name: "عصير برتقال",
      nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
      category: "juice",
      entitlementCategory: "juice",
      entitlementKey: `juice:${String(addonPlanId)}`,
      balanceBucketId: bucketId,
      source: "subscription",
      qty: 1,
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      pricingMode: "allowance_covered",
      maxPerDay: 4,
      currency: "SAR",
    }],
  });
  await Subscription.updateOne(
    { _id: subscription._id, "addonBalance._id": bucketId },
    { $inc: { "addonBalance.$.remainingQty": -1, "addonBalance.$.consumedQty": 1 } }
  );
  await assertBalance(subscription._id, bucketId, { remainingQty: 3, reservedQty: 0, consumedQty: 1 }, "before no-show release");

  const noShowRelease = await dailyAddonService.reconcileDayDailyAddonState({ dayId: noShowDay._id });
  assert.strictEqual(noShowRelease.releasedCount, 1);
  await assertBalance(subscription._id, bucketId, { remainingQty: 4, reservedQty: 0, consumedQty: 0 }, "no-show release");
  const noShowAfter = await SubscriptionDay.findById(noShowDay._id).lean();
  assert.strictEqual(noShowAfter.addonSelections[0].addonSettlementState, "released");
  assert.strictEqual(noShowAfter.addonSelections[0].source, "pending_payment");

  const replay = await dailyAddonService.reconcileDayDailyAddonState({ dayId: noShowDay._id });
  assert.strictEqual(replay.releasedCount, 0);
  await assertBalance(subscription._id, bucketId, { remainingQty: 4, reservedQty: 0, consumedQty: 0 }, "idempotent no-show release");
}

async function testPlanPlaceholderAndPooledCarryover() {
  const { subscription, bucketId } = await createSubscription({
    userId: oid(),
    multiProduct: true,
    remainingQty: 3,
  });
  const day = await createConfirmedDay(subscription._id, "2026-07-25");
  await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
  const currentDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(currentDay.addonSelections[0].requiresKitchenChoice, true);
  assert.match(currentDay.addonSelections[0].name, /اشتراك عصير/);
  await assertBalance(subscription._id, bucketId, { remainingQty: 2, reservedQty: 1, consumedQty: 0 }, "placeholder reserve");

  const sub = await Subscription.findById(subscription._id);
  const entitlement = sub.addonSubscriptions[0];
  const preview = pricingService.buildAddonChoicePricingPreview({
    subscription: sub,
    entitlement,
    product: {
      _id: entitlement.menuProductIds[0],
      priceHalala: 500,
      currency: "SAR",
    },
    category: "juice",
    addonPlanId: entitlement.addonPlanId,
    entitlementKey: entitlement.entitlementKey,
    quantity: 2,
  });
  assert.strictEqual(preview.coveredQty, 2, "carried credits may be used together on a later day");
  assert(preview.maxPerDay >= 2);
  assert.strictEqual(preview.pooledCarryoverEnabled, true);

  const wallet = dailyAddonService.buildDailyAddonWallet(await Subscription.findById(subscription._id).lean());
  assert.strictEqual(wallet.sourceOfTruth, "subscription.addonBalance");
  assert.strictEqual(wallet.pooledCarryoverEnabled, true);
  assert.strictEqual(wallet.invariantValid, true);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `daily-addon-policy-${Date.now()}` });
    await Subscription.createCollection();
    await SubscriptionDay.createCollection();
    await SubscriptionDailyAddonOperation.createCollection();
    await Subscription.init();
    await SubscriptionDay.init();
    await SubscriptionDailyAddonOperation.init();

    await testAutomaticDailyDefaultAndFulfillment();
    await mongoose.connection.dropDatabase();
    await testSkipAndNoShowReturnCredits();
    await mongoose.connection.dropDatabase();
    await testPlanPlaceholderAndPooledCarryover();

    console.log("subscription daily add-on policy integration checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
