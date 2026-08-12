"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
require("../src/models/Plan");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require(
  "../src/models/SubscriptionEntitlementDayBlueprint"
);
const SubscriptionEntitlementAllocation = require(
  "../src/models/SubscriptionEntitlementAllocation"
);
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const SubscriptionExtraEntitlementAllocation = require(
  "../src/models/SubscriptionExtraEntitlementAllocation"
);
const SubscriptionExtraEntitlementBucket = require(
  "../src/models/SubscriptionExtraEntitlementBucket"
);
const {
  consumeDayExtraSelectionsTransactional,
  reconcileDayExtraSelectionsTransactional,
  releaseDayExtraSelectionsTransactional,
  reopenDayExtraSelectionsTransactional,
} = require(
  "../src/services/subscription/subscriptionStackingExtraSelectionLifecycleService"
);
const {
  runExtraEntitlementTransaction,
} = require(
  "../src/services/subscription/subscriptionExtraEntitlementAllocationService"
);
const {
  ensureExtraBucketsForBatch,
} = require("../src/services/subscription/subscriptionExtraEntitlementBucketService");
const {
  fulfillSubscriptionDay,
} = require("../src/services/fulfillmentService");
const {
  performStackingDaySelectionUpdate,
  performStackingDayPlanningConfirmation,
} = require(
  "../src/services/subscription/subscriptionStackingSelectionWriteService"
);
const {
  cancelSubscriptionDomain,
} = require("../src/services/subscription/subscriptionCancellationService");

let replSet;
let sequence = 0;

function oid() {
  return new mongoose.Types.ObjectId();
}

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: "subscription_stacking_extra_selection_p3",
    autoIndex: false,
  });
  for (const model of [
    Subscription,
    SubscriptionDay,
    SubscriptionEntitlementBatch,
    SubscriptionEntitlementDayBlueprint,
    SubscriptionEntitlementAllocation,
    SubscriptionExtraEntitlementBucket,
    SubscriptionExtraEntitlementAllocation,
    BuilderCategory,
    BuilderProtein,
    BuilderCarb,
  ]) {
    await model.createCollection().catch((err) => {
      if (err.codeName !== "NamespaceExists") throw err;
    });
    await model.syncIndexes();
  }
}

async function clearDatabase() {
  await Promise.all([
    Subscription.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    SubscriptionEntitlementBatch.deleteMany({}),
    SubscriptionEntitlementDayBlueprint.deleteMany({}),
    SubscriptionEntitlementAllocation.deleteMany({}),
    SubscriptionExtraEntitlementBucket.deleteMany({}),
    SubscriptionExtraEntitlementAllocation.deleteMany({}),
    BuilderCategory.deleteMany({}),
    BuilderProtein.deleteMany({}),
    BuilderCarb.deleteMany({}),
  ]);
}

async function fixture() {
  sequence += 1;
  const userId = oid();
  const subscription = await Subscription.create({
    userId,
    planId: oid(),
    status: "active",
    startDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-31"),
    validityEndDate: ksaDate("2026-08-31"),
    totalMeals: 26,
    remainingMeals: 26,
    selectedMealsPerDay: 1,
    selectedGrams: 150,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-08-12",
    status: "open",
    plannerState: "draft",
    planningState: "draft",
    mealSlots: [],
  });
  await SubscriptionEntitlementBatch.create({
    userId,
    containerSubscriptionId: subscription._id,
    planId: subscription.planId,
    sourceKey: `checkout:p3:${sequence}`,
    sourceType: "checkout",
    requestedStartDate: ksaDate("2026-08-01"),
    effectiveStartDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-31"),
    validityEndDate: ksaDate("2026-08-31"),
    daysCount: 26,
    mealsPerDay: 1,
    proteinGrams: 150,
    totalMeals: 26,
    remainingMeals: 26,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    status: "active",
    applicationState: "applied",
    deliverySnapshot: {
      mode: "delivery",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Test", street: "P3" },
    },
  });
  return { userId, subscription, day };
}

async function bucket(source, {
  kind,
  qty,
  premiumKey = "",
  addonId = null,
  addonPlanId = null,
  entitlementKey = "",
  category = "",
  start = "2026-08-01",
  end = "2026-08-31",
  createdAt = new Date(),
} = {}) {
  const walletKey = kind === "premium"
    ? `premium:${premiumKey}:${sequence}:${oid()}`
    : `addon:${addonPlanId || addonId}:${entitlementKey}:${sequence}:${oid()}`;
  return SubscriptionExtraEntitlementBucket.create({
    bucketKey: `batch:${oid()}:${walletKey}`,
    kind,
    walletKey,
    userId: source.userId,
    containerSubscriptionId: source.subscription._id,
    entitlementBatchId: oid(),
    sourceKey: `payment:${oid()}`,
    sourceType: "checkout",
    premiumKey,
    addonId,
    addonPlanId,
    entitlementKey,
    category,
    purchasedQty: qty,
    remainingQty: qty,
    reservedQty: 0,
    consumedQty: 0,
    forfeitedQty: 0,
    effectiveStartDate: ksaDate(start),
    validityEndDate: ksaDate(end),
    applicationState: "applied",
    createdAt,
  });
}

function premium(premiumKey, quantity) {
  return { kind: "premium", premiumKey, quantity };
}

function addon(addonId, addonPlanId, entitlementKey, category, quantity) {
  return { kind: "addon", addonId, addonPlanId, entitlementKey, category, quantity };
}

async function reconcile(source, desiredSelections, options = {}) {
  return runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return reconcileDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      businessDate: source.day.date,
      day,
      desiredSelections,
      session,
      runtime: options.runtime,
    });
  }, { maxRetries: 30, baseDelayMs: 1 });
}

async function state(source) {
  return {
    day: await SubscriptionDay.findById(source.day._id).lean(),
    buckets: await SubscriptionExtraEntitlementBucket.find({
      containerSubscriptionId: source.subscription._id,
    }).sort({ kind: 1, validityEndDate: 1, effectiveStartDate: 1, _id: 1 }).lean(),
    allocations: await SubscriptionExtraEntitlementAllocation.find({
      containerSubscriptionId: source.subscription._id,
    }).sort({ reservedAt: 1, _id: 1 }).lean(),
  };
}

function assertConserved(row) {
  assert.strictEqual(
    row.remainingQty + row.reservedQty + row.consumedQty + row.forfeitedQty,
    row.purchasedQty
  );
}

async function testPremiumAddonMixedEditReleaseReplayAndConsume() {
  await clearDatabase();
  const source = await fixture();
  const addonId = oid();
  const addonPlanId = oid();
  await bucket(source, { kind: "premium", qty: 4, premiumKey: "shrimp" });
  await bucket(source, {
    kind: "addon",
    qty: 3,
    addonId,
    addonPlanId,
    entitlementKey: `salad:${addonPlanId}`,
    category: "salad",
  });

  const mixed = [
    premium("shrimp", 2),
    addon(addonId, addonPlanId, `salad:${addonPlanId}`, "salad", 2),
  ];
  await reconcile(source, mixed);
  await reconcile(source, mixed);
  let current = await state(source);
  assert.deepStrictEqual(
    current.buckets.map((row) => [row.kind, row.remainingQty, row.reservedQty]),
    [["addon", 1, 2], ["premium", 2, 2]]
  );
  assert.strictEqual(current.allocations.length, 4);
  assert.strictEqual(current.allocations.filter((row) => row.state === "reserved").length, 4);

  await reconcile(source, [premium("shrimp", 1)]);
  current = await state(source);
  assert.deepStrictEqual(
    current.buckets.map((row) => [row.kind, row.remainingQty, row.reservedQty]),
    [["addon", 3, 0], ["premium", 3, 1]]
  );
  assert.strictEqual(current.allocations.filter((row) => row.state === "released").length, 3);

  await reconcile(source, [premium("shrimp", 3)]);
  current = await state(source);
  assert.strictEqual(current.buckets.find((row) => row.kind === "premium").reservedQty, 3);
  assert.strictEqual(current.allocations.filter((row) => row.state === "reserved").length, 3);

  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return consumeDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      day,
      session,
    });
  });
  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return consumeDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      day,
      session,
    });
  });
  current = await state(source);
  const premiumBucket = current.buckets.find((row) => row.kind === "premium");
  assert.deepStrictEqual(
    [premiumBucket.remainingQty, premiumBucket.reservedQty, premiumBucket.consumedQty],
    [1, 0, 3]
  );
  assert.strictEqual(current.day.stackingExtraSelectionState.lifecycleStatus, "consumed");
  current.buckets.forEach(assertConserved);
}

async function testMultiBucketPartialFinalFutureExpiredAndCrossAddon() {
  await clearDatabase();
  const source = await fixture();
  const old = await bucket(source, {
    kind: "premium",
    qty: 1,
    premiumKey: "salmon",
    end: "2026-08-15",
  });
  const newer = await bucket(source, {
    kind: "premium",
    qty: 2,
    premiumKey: "salmon",
    end: "2026-08-31",
  });
  await reconcile(source, [premium("salmon", 3)]);
  let current = await state(source);
  assert.deepStrictEqual(
    current.allocations.filter((row) => row.state === "reserved")
      .map((row) => String(row.extraEntitlementBucketId)),
    [String(old._id), String(newer._id), String(newer._id)]
  );
  await assert.rejects(
    () => reconcile(source, [premium("salmon", 4)]),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT")
  );
  current = await state(source);
  assert.strictEqual(current.allocations.filter((row) => row.state === "reserved").length, 3);

  const partial = await fixture();
  await bucket(partial, { kind: "premium", qty: 1, premiumKey: "shrimp" });
  await reconcile(partial, [premium("shrimp", 1)]);
  await assert.rejects(
    () => reconcile(partial, [premium("shrimp", 2)]),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT")
  );
  const partialState = await state(partial);
  assert.deepStrictEqual(
    [partialState.buckets[0].remainingQty, partialState.buckets[0].reservedQty],
    [0, 1]
  );

  const dates = await fixture();
  await bucket(dates, {
    kind: "premium",
    qty: 1,
    premiumKey: "future",
    start: "2026-08-13",
  });
  await bucket(dates, {
    kind: "premium",
    qty: 1,
    premiumKey: "expired",
    end: "2026-08-11",
  });
  for (const premiumKey of ["future", "expired"]) {
    await assert.rejects(
      () => reconcile(dates, [premium(premiumKey, 1)]),
      (err) => Boolean(err && err.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT")
    );
  }

  const addons = await fixture();
  const firstId = oid();
  const secondId = oid();
  await bucket(addons, {
    kind: "addon", qty: 1, addonId: firstId, addonPlanId: firstId,
    entitlementKey: `salad:${firstId}`, category: "salad",
  });
  await bucket(addons, {
    kind: "addon", qty: 4, addonId: secondId, addonPlanId: secondId,
    entitlementKey: `salad:${secondId}`, category: "salad",
  });
  await reconcile(addons, [addon(firstId, firstId, `salad:${firstId}`, "salad", 1)]);
  const addonState = await state(addons);
  assert.strictEqual(addonState.buckets.find((row) => String(row.addonId) === String(firstId)).remainingQty, 0);
  assert.strictEqual(addonState.buckets.find((row) => String(row.addonId) === String(secondId)).remainingQty, 4);
}

async function testAddonEditConsumeAndReplay() {
  await clearDatabase();
  const source = await fixture();
  const addonId = oid();
  const addonPlanId = oid();
  const entitlementKey = `salad:${addonPlanId}`;
  await bucket(source, {
    kind: "addon",
    qty: 2,
    addonId,
    addonPlanId,
    entitlementKey,
    category: "salad",
  });
  await reconcile(source, [addon(addonId, addonPlanId, entitlementKey, "salad", 2)]);
  await reconcile(source, [addon(addonId, addonPlanId, entitlementKey, "salad", 1)]);
  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return consumeDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      day,
      session,
    });
  });
  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return consumeDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      day,
      session,
    });
  });
  const current = await state(source);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty,
      current.buckets[0].consumedQty],
    [1, 0, 1]
  );
  assert.strictEqual(current.allocations.filter((row) => row.state === "released").length, 1);
  assert.strictEqual(current.allocations.filter((row) => row.state === "consumed").length, 1);
  assert.strictEqual(String(current.allocations[0].addonPlanId), String(addonPlanId));
  assert.strictEqual(current.allocations[0].entitlementKey, entitlementKey);
  current.buckets.forEach(assertConserved);
}

async function testActivationReplayDoesNotResetSelectionAllocations() {
  await clearDatabase();
  const source = await fixture();
  const batch = await SubscriptionEntitlementBatch.findOne({
    containerSubscriptionId: source.subscription._id,
  });
  batch.premiumSnapshot = [{
    premiumKey: "shrimp",
    purchasedQty: 2,
    remainingQty: 2,
    reservedQty: 0,
    consumedQty: 0,
    forfeitedQty: 0,
    unitExtraFeeHalala: 250,
    totalHalala: 500,
    currency: "SAR",
  }];
  await batch.save();
  await ensureExtraBucketsForBatch({ batch });
  await reconcile(source, [premium("shrimp", 1)]);
  const beforeReplay = await state(source);

  await ensureExtraBucketsForBatch({
    batch: await SubscriptionEntitlementBatch.findById(batch._id),
  });
  const afterReplay = await state(source);
  assert.deepStrictEqual(
    afterReplay.buckets.map((row) => [row.remainingQty, row.reservedQty, row.consumedQty]),
    beforeReplay.buckets.map((row) => [row.remainingQty, row.reservedQty, row.consumedQty])
  );
  assert.deepStrictEqual(
    afterReplay.allocations.map((row) => [row.reservationKey, row.state]),
    beforeReplay.allocations.map((row) => [row.reservationKey, row.state])
  );
}

async function testConcurrencyAndCompetingDays() {
  await clearDatabase();
  const source = await fixture();
  await bucket(source, { kind: "premium", qty: 4, premiumKey: "shrimp" });
  const desired = [premium("shrimp", 2)];
  await Promise.all(Array.from({ length: 20 }, () => reconcile(source, desired)));
  let current = await state(source);
  assert.strictEqual(current.allocations.length, 2);
  assert.strictEqual(current.buckets[0].reservedQty, 2);

  const edits = Array.from({ length: 20 }, (_, index) => (
    reconcile(source, [premium("shrimp", index % 2 === 0 ? 1 : 3)])
  ));
  await Promise.allSettled(edits);
  current = await state(source);
  assertConserved(current.buckets[0]);
  assert.strictEqual(
    current.allocations.filter((row) => row.state === "reserved").length,
    current.day.stackingExtraSelectionState.entries[0].quantity
  );

  const competing = await fixture();
  await bucket(competing, { kind: "premium", qty: 1, premiumKey: "last" });
  const secondDay = await SubscriptionDay.create({
    subscriptionId: competing.subscription._id,
    date: "2026-08-13",
    status: "open",
    plannerState: "draft",
    mealSlots: [],
  });
  const other = { ...competing, day: secondDay };
  const outcomes = await Promise.allSettled([
    reconcile(competing, [premium("last", 1)]),
    reconcile(other, [premium("last", 1)]),
  ]);
  assert.strictEqual(outcomes.filter((row) => row.status === "fulfilled").length, 1);
  assert.strictEqual(outcomes.filter((row) => row.status === "rejected").length, 1);
  const competingState = await state(competing);
  assert.deepStrictEqual(
    [competingState.buckets[0].remainingQty, competingState.buckets[0].reservedQty],
    [0, 1]
  );
}

async function testRollbackInjection() {
  await clearDatabase();
  const source = await fixture();
  await bucket(source, { kind: "premium", qty: 3, premiumKey: "shrimp" });

  for (const runtime of [
    { afterReservation: async () => { throw new Error("after reservation"); } },
    { afterDayStateSaved: async () => { throw new Error("after day save"); } },
  ]) {
    await assert.rejects(() => reconcile(source, [premium("shrimp", 2)], { runtime }));
    const current = await state(source);
    assert.deepStrictEqual(
      [current.buckets[0].remainingQty, current.buckets[0].reservedQty, current.allocations.length],
      [3, 0, 0]
    );
    assert.strictEqual(current.day.stackingExtraSelectionState, undefined);
  }

  await reconcile(source, [premium("shrimp", 2)]);
  await assert.rejects(
    () => runExtraEntitlementTransaction(async (session) => {
      const day = await SubscriptionDay.findById(source.day._id).session(session);
      return consumeDayExtraSelectionsTransactional({
        userId: source.userId,
        containerSubscriptionId: source.subscription._id,
        day,
        session,
        runtime: {
          afterConsume: async () => { throw new Error("during consume"); },
        },
      });
    })
  );
  const current = await state(source);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty,
      current.buckets[0].consumedQty],
    [1, 2, 0]
  );
  assert.strictEqual(current.day.stackingExtraSelectionState.lifecycleStatus, "reserved");

  const multiBucket = await fixture();
  await bucket(multiBucket, { kind: "premium", qty: 1, premiumKey: "salmon" });
  await bucket(multiBucket, { kind: "premium", qty: 1, premiumKey: "salmon" });
  await assert.rejects(
    () => reconcile(multiBucket, [premium("salmon", 3)]),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT")
  );
  const multiBucketState = await state(multiBucket);
  assert.strictEqual(multiBucketState.allocations.length, 0);
  assert.strictEqual(
    multiBucketState.buckets.reduce((sum, row) => sum + row.remainingQty, 0),
    2
  );
  assert.strictEqual(
    multiBucketState.buckets.reduce((sum, row) => sum + row.reservedQty, 0),
    0
  );
}

async function testFulfillmentConsumesExactlyOnce() {
  await clearDatabase();
  const source = await fixture();
  await bucket(source, { kind: "premium", qty: 2, premiumKey: "shrimp" });
  await reconcile(source, [premium("shrimp", 1)]);
  await SubscriptionDay.updateOne(
    { _id: source.day._id },
    {
      $set: {
        status: "out_for_delivery",
        plannerState: "confirmed",
        planningState: "confirmed",
        mealSlots: [{
          slotIndex: 1,
          slotKey: "slot_1",
          status: "complete",
          selectionType: "premium_meal",
          isPremium: true,
          premiumKey: "shrimp",
          premiumSource: "balance",
        }],
      },
    }
  );

  const first = await fulfillSubscriptionDay({ dayId: source.day._id });
  assert.strictEqual(first.ok, true, JSON.stringify(first));
  const second = await fulfillSubscriptionDay({ dayId: source.day._id });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.alreadyFulfilled, true);
  const current = await state(source);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty,
      current.buckets[0].consumedQty],
    [1, 0, 1]
  );
  assert.strictEqual(current.allocations.filter((row) => row.state === "consumed").length, 1);
}

async function testSkipReleaseAndUnskipReopenUsesFreshReservations() {
  await clearDatabase();
  const source = await fixture();
  await bucket(source, { kind: "premium", qty: 2, premiumKey: "shrimp" });
  await reconcile(source, [premium("shrimp", 1)]);
  const original = await state(source);
  const originalKey = original.allocations.find((row) => row.state === "reserved").reservationKey;

  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return releaseDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      day,
      session,
    });
  });
  let current = await state(source);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty],
    [2, 0]
  );
  assert.strictEqual(current.day.stackingExtraSelectionState.lifecycleStatus, "released");

  await runExtraEntitlementTransaction(async (session) => {
    const day = await SubscriptionDay.findById(source.day._id).session(session);
    return reopenDayExtraSelectionsTransactional({
      userId: source.userId,
      containerSubscriptionId: source.subscription._id,
      businessDate: source.day.date,
      day,
      session,
    });
  });
  current = await state(source);
  const active = current.allocations.filter((row) => row.state === "reserved");
  assert.strictEqual(active.length, 1);
  assert.notStrictEqual(active[0].reservationKey, originalKey);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty],
    [1, 1]
  );
  assert.strictEqual(current.day.stackingExtraSelectionState.lifecycleStatus, "reserved");
  current.buckets.forEach(assertConserved);
}

async function testInternalStackingSelectionServiceBoundary() {
  await clearDatabase();
  const source = await fixture();
  const category = await BuilderCategory.create({
    key: `protein-${sequence}`,
    dimension: "protein",
    isActive: true,
  });
  const carbCategory = await BuilderCategory.create({
    key: `carb-${sequence}`,
    dimension: "carb",
    isActive: true,
  });
  const premiumProtein = await BuilderProtein.create({
    key: `shrimp-${sequence}`,
    name: { en: "Shrimp" },
    displayCategoryId: category._id,
    displayCategoryKey: "premium",
    proteinFamilyKey: "seafood",
    selectionType: "premium_meal",
    isPremium: true,
    premiumKey: "shrimp",
    premiumCreditCost: 1,
    extraFeeHalala: 250,
    availableForSubscription: true,
    isActive: true,
  });
  const carb = await BuilderCarb.create({
    key: `rice-${sequence}`,
    name: { en: "Rice" },
    displayCategoryId: carbCategory._id,
    displayCategoryKey: "standard_carbs",
    availableForSubscription: true,
    isActive: true,
  });
  await bucket(source, { kind: "premium", qty: 2, premiumKey: "shrimp" });

  const result = await performStackingDaySelectionUpdate({
    userId: source.userId,
    subscriptionId: source.subscription._id,
    date: source.day.date,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "premium_meal",
      proteinId: premiumProtein._id,
      carbs: [{ carbId: carb._id, grams: 150 }],
    }],
    extraSelectionEnabled: true,
    getBusinessDate: async () => source.day.date,
  });
  assert.strictEqual(result.day.premiumUpgradeSelections.length, 1);
  assert.strictEqual(result.day.premiumUpgradeSelections[0].premiumKey, "shrimp");
  assert.strictEqual(result.day.premiumUpgradeSelections[0].premiumSource, "balance");
  const current = await state(source);
  assert.deepStrictEqual(
    [current.buckets[0].remainingQty, current.buckets[0].reservedQty],
    [1, 1]
  );
  assert.strictEqual(current.allocations.length, 1);

  const replay = await performStackingDaySelectionUpdate({
    userId: source.userId,
    subscriptionId: source.subscription._id,
    date: source.day.date,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "premium_meal",
      proteinId: premiumProtein._id,
      carbs: [{ carbId: carb._id, grams: 150 }],
    }],
    extraSelectionEnabled: true,
    getBusinessDate: async () => source.day.date,
  });
  assert(replay.day);
  assert.strictEqual(await SubscriptionExtraEntitlementAllocation.countDocuments({
    containerSubscriptionId: source.subscription._id,
  }), 1);

  const confirmations = await Promise.all([
    performStackingDayPlanningConfirmation({
      userId: source.userId,
      subscriptionId: source.subscription._id,
      date: source.day.date,
      extraSelectionEnabled: true,
      getBusinessDate: async () => source.day.date,
    }),
    performStackingDayPlanningConfirmation({
      userId: source.userId,
      subscriptionId: source.subscription._id,
      date: source.day.date,
      extraSelectionEnabled: true,
      getBusinessDate: async () => source.day.date,
    }),
  ]);
  assert.strictEqual(confirmations.filter((row) => row.idempotent).length, 1);
  assert.strictEqual(await SubscriptionEntitlementAllocation.countDocuments({
    containerSubscriptionId: source.subscription._id,
  }), 1);
  const confirmedState = await state(source);
  assert.deepStrictEqual(
    [confirmedState.buckets[0].remainingQty, confirmedState.buckets[0].reservedQty,
      confirmedState.buckets[0].consumedQty],
    [1, 1, 0]
  );

  const raceSource = await fixture();
  await bucket(raceSource, { kind: "premium", qty: 1, premiumKey: "shrimp" });
  await performStackingDaySelectionUpdate({
    userId: raceSource.userId,
    subscriptionId: raceSource.subscription._id,
    date: raceSource.day.date,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "premium_meal",
      proteinId: premiumProtein._id,
      carbs: [{ carbId: carb._id, grams: 150 }],
    }],
    extraSelectionEnabled: true,
    getBusinessDate: async () => raceSource.day.date,
  });
  const race = await Promise.allSettled([
    performStackingDayPlanningConfirmation({
      userId: raceSource.userId,
      subscriptionId: raceSource.subscription._id,
      date: raceSource.day.date,
      extraSelectionEnabled: true,
      getBusinessDate: async () => raceSource.day.date,
    }),
    performStackingDaySelectionUpdate({
      userId: raceSource.userId,
      subscriptionId: raceSource.subscription._id,
      date: raceSource.day.date,
      mealSlots: [],
      extraSelectionEnabled: true,
      getBusinessDate: async () => raceSource.day.date,
    }),
  ]);
  assert.strictEqual(race.filter((row) => row.status === "fulfilled").length, 1);
  assert.strictEqual(race.filter((row) => row.status === "rejected").length, 1);
  const raceState = await state(raceSource);
  const activeExtraCount = raceState.allocations.filter((row) => row.state === "reserved").length;
  if (raceState.day.plannerState === "confirmed") {
    assert.strictEqual(activeExtraCount, 1);
    assert.strictEqual(raceState.day.premiumUpgradeSelections.length, 1);
  } else {
    assert.strictEqual(activeExtraCount, 0);
    assert.strictEqual(raceState.day.premiumUpgradeSelections.length, 0);
  }
}

async function testConcurrentConfirmCancelLeavesOneConsistentOutcome() {
  await clearDatabase();
  const source = await fixture();
  const category = await BuilderCategory.create({
    key: `race-protein-${sequence}`,
    dimension: "protein",
    isActive: true,
  });
  const carbCategory = await BuilderCategory.create({
    key: `race-carb-${sequence}`,
    dimension: "carb",
    isActive: true,
  });
  const premiumProtein = await BuilderProtein.create({
    key: `race-shrimp-${sequence}`,
    name: { en: "Shrimp" },
    displayCategoryId: category._id,
    displayCategoryKey: "premium",
    proteinFamilyKey: "seafood",
    selectionType: "premium_meal",
    isPremium: true,
    premiumKey: "shrimp",
    premiumCreditCost: 1,
    extraFeeHalala: 250,
    availableForSubscription: true,
    isActive: true,
  });
  const carb = await BuilderCarb.create({
    key: `race-rice-${sequence}`,
    name: { en: "Rice" },
    displayCategoryId: carbCategory._id,
    displayCategoryKey: "standard_carbs",
    availableForSubscription: true,
    isActive: true,
  });
  await bucket(source, { kind: "premium", qty: 1, premiumKey: "shrimp" });
  await performStackingDaySelectionUpdate({
    userId: source.userId,
    subscriptionId: source.subscription._id,
    date: source.day.date,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "premium_meal",
      proteinId: premiumProtein._id,
      carbs: [{ carbId: carb._id, grams: 150 }],
    }],
    extraSelectionEnabled: true,
    getBusinessDate: async () => source.day.date,
  });

  const outcomes = await Promise.allSettled([
    performStackingDayPlanningConfirmation({
      userId: source.userId,
      subscriptionId: source.subscription._id,
      date: source.day.date,
      extraSelectionEnabled: true,
      getBusinessDate: async () => source.day.date,
    }),
    cancelSubscriptionDomain({
      subscriptionId: source.subscription._id,
      actor: { kind: "admin" },
      runtime: { getTodayKSADate: async () => source.day.date },
    }),
  ]);
  assert.strictEqual(outcomes.filter((row) => row.status === "fulfilled").length, 1);

  const current = await state(source);
  const subscription = await Subscription.findById(source.subscription._id).lean();
  if (subscription.status === "canceled") {
    assert.strictEqual(current.day, null);
    assert.deepStrictEqual(
      [current.buckets[0].remainingQty, current.buckets[0].reservedQty],
      [1, 0]
    );
    assert.strictEqual(current.allocations.filter((row) => row.state === "released").length, 1);
  } else {
    assert.strictEqual(subscription.status, "active");
    assert.strictEqual(current.day.plannerState, "confirmed");
    assert.deepStrictEqual(
      [current.buckets[0].remainingQty, current.buckets[0].reservedQty],
      [0, 1]
    );
    assert.strictEqual(current.allocations.filter((row) => row.state === "reserved").length, 1);
  }
  current.buckets.forEach(assertConserved);
}

async function run() {
  await connect();
  try {
    await testPremiumAddonMixedEditReleaseReplayAndConsume();
    await testMultiBucketPartialFinalFutureExpiredAndCrossAddon();
    await testAddonEditConsumeAndReplay();
    await testActivationReplayDoesNotResetSelectionAllocations();
    await testConcurrencyAndCompetingDays();
    await testRollbackInjection();
    await testSkipReleaseAndUnskipReopenUsesFreshReservations();
    await testFulfillmentConsumesExactlyOnce();
    await testInternalStackingSelectionServiceBoundary();
    await testConcurrentConfirmCancelLeavesOneConsistentOutcome();
    console.log("subscription stacking extra selection P3 integration tests passed");
  } finally {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
