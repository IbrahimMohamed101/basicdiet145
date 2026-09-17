"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");
require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionAddonOpsIdentityClosure");
require("../src/services/installPickupRequestRecovery");
require("../src/services/installSubscriptionDeliveryAppendSaga");
require("../src/services/installReadOnlySubscriptionQueries");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const opsReadService = require("../src/services/dashboard/opsReadServiceV2");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildFulfilledReservedDay() {
  const userId = oid();
  const addonPlanId = oid();
  const productId = oid();
  const bucketId = oid();
  const entitlementKey = `juice:${String(addonPlanId)}`;
  const subscription = await Subscription.create({
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2099-12-31T00:00:00.000Z"),
    validityEndDate: new Date("2099-12-31T00:00:00.000Z"),
    totalMeals: 20,
    remainingMeals: 20,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    deliveryMode: "delivery",
    deliveryWindow: "18:00-20:00",
    addonSubscriptions: [{
      addonId: addonPlanId,
      addonPlanId,
      name: "عصير",
      addonPlanName: "عصير",
      category: "juice",
      allowanceCategory: "juice",
      entitlementKey,
      quantityPerDay: 1,
      includedTotalQty: 1,
      menuProductIds: [productId],
    }],
    addonBalance: [{
      _id: bucketId,
      addonPlanId,
      addonId: addonPlanId,
      entitlementKey,
      category: "juice",
      allowanceCategory: "juice",
      includedTotalQty: 1,
      purchasedQty: 1,
      remainingQty: 0,
      reservedQty: 1,
      consumedQty: 0,
      reservationKeys: ["daily-read-only-allocation"],
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2099-01-03",
    status: "fulfilled",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "read-only-fulfilled-day",
    mealSlots: [],
    addonSelections: [{
      addonId: productId,
      productId,
      menuProductId: productId,
      addonPlanId,
      name: "عصير برتقال — اشتراك عصير",
      nameI18n: {
        ar: "عصير برتقال — اشتراك عصير",
        en: "Orange Juice — Juice Subscription",
      },
      category: "juice",
      entitlementCategory: "juice",
      entitlementKey,
      balanceBucketId: bucketId,
      source: "wallet",
      qty: 1,
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      autoDailyAddon: true,
      dailyEntitlement: true,
      selectionOrigin: "subscription_daily_default",
      dailyAllocationKey: "daily-read-only-allocation",
      addonSettlementState: "reserved",
      reservedAt: new Date(),
      consumedAt: null,
    }],
  });

  await SubscriptionDailyAddonOperation.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    date: day.date,
    allocationKey: "daily-read-only-allocation",
    entitlementKey,
    balanceBucketId: bucketId,
    addonPlanId,
    productId,
    status: "completed",
  });

  return { subscription, day, bucketId };
}

async function snapshot(subscriptionId, dayId) {
  const [subscription, day, operation] = await Promise.all([
    Subscription.findById(subscriptionId).lean(),
    SubscriptionDay.findById(dayId).lean(),
    SubscriptionDailyAddonOperation.findOne({ subscriptionDayId: dayId }).lean(),
  ]);
  const bucket = subscription.addonBalance[0];
  const selection = day.addonSelections[0];
  return {
    balance: {
      remainingQty: Number(bucket.remainingQty || 0),
      reservedQty: Number(bucket.reservedQty || 0),
      consumedQty: Number(bucket.consumedQty || 0),
      reservationKeys: (bucket.reservationKeys || []).map(String),
      consumedAllocationKeys: (bucket.consumedAllocationKeys || []).map(String),
    },
    selection: {
      state: selection.addonSettlementState,
      consumedAt: selection.consumedAt || null,
      releasedAt: selection.releasedAt || null,
      allocationKey: selection.dailyAllocationKey,
    },
    operation: {
      status: operation.status,
      consumedAt: operation.consumedAt || null,
      releasedAt: operation.releasedAt || null,
      updatedAt: operation.updatedAt.toISOString(),
    },
    subscriptionUpdatedAt: subscription.updatedAt.toISOString(),
    dayUpdatedAt: day.updatedAt.toISOString(),
  };
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `read-only-queries-${Date.now()}` });
    const fixture = await buildFulfilledReservedDay();
    const before = await snapshot(fixture.subscription._id, fixture.day._id);

    const list = await opsReadService.listOperations({
      date: fixture.day.date,
      role: "admin",
      lang: "ar",
    });
    assert.strictEqual(Array.isArray(list), true);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].readConsistency.readOnly, true);
    assert.strictEqual(list[0].readConsistency.reconciliationApplied, false);
    assert.strictEqual(list[0].reconciliationDiagnostic.state, "inspect_entity_for_details");

    const afterList = await snapshot(fixture.subscription._id, fixture.day._id);
    assert.deepStrictEqual(afterList, before, "Ops list must not consume or release add-on balance");

    const entity = await opsReadService.getEnrichedDTO({
      entityId: fixture.day._id,
      entityType: "subscription",
      role: "admin",
      lang: "ar",
    });
    assert.strictEqual(entity.readConsistency.readOnly, true);
    assert.strictEqual(entity.reconciliationDiagnostic.state, "action_required");
    assert.strictEqual(
      entity.reconciliationDiagnostic.actionsRequired.some((row) => row.action === "consume_reserved_addons"),
      true
    );

    const afterEntity = await snapshot(fixture.subscription._id, fixture.day._id);
    assert.deepStrictEqual(afterEntity, before, "Ops entity read must only diagnose pending consumption");

    const directDiagnostic = await dailyAddonService.reconcileDayDailyAddonState({
      dayId: fixture.day._id,
    });
    assert.strictEqual(directDiagnostic.readOnly, true);
    assert.strictEqual(directDiagnostic.reconciliationApplied, false);
    assert.strictEqual(directDiagnostic.state, "action_required");

    const afterDirectDiagnostic = await snapshot(fixture.subscription._id, fixture.day._id);
    assert.deepStrictEqual(afterDirectDiagnostic, before, "read reconciliation API must not mutate Mongo state");

    assert.strictEqual(typeof dailyAddonService.applyDayDailyAddonReconciliation, "function");
    assert.strictEqual(typeof dailyAddonService.applyDailyAddonReconciliationForDate, "function");
    assert.strictEqual(typeof dailyAddonService.applyDailyAddonReconciliationForUser, "function");

    console.log("subscription read-only query policy checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
