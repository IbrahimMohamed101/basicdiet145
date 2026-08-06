"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  buildLegacyEntitlementBatchPayload,
  buildPurchaseEntitlementBatchPayload,
} = require("../src/services/subscription/subscriptionEntitlementBatchFactory");
const {
  buildEntitlementSlotBlueprint,
  preserveExistingSelectionsForBlueprint,
  resolveProteinGramsForSlot,
} = require("../src/services/subscription/subscriptionEntitlementSlotBlueprintService");

function buildLegacySubscription(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliveryZoneId: new mongoose.Types.ObjectId(),
    deliveryAddress: {
      city: "Riyadh",
      district: "Olaya",
      street: "A",
    },
    premiumBalance: [],
    addonSubscriptions: [],
    addonBalance: [],
    ...overrides,
  };
}

function buildDraftAndActivation({ startDate = "2026-08-01" } = {}) {
  const userId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const draftId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const start = new Date(`${startDate}T00:00:00+03:00`);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 25);

  return {
    draft: {
      _id: draftId,
      userId,
      planId,
      daysCount: 26,
      mealsPerDay: 2,
      startDate: start,
      contractSnapshot: { contract: { contractVersion: "subscription_contract.v1" } },
    },
    payment: {
      _id: paymentId,
      status: "paid",
    },
    subscriptionPayload: {
      userId,
      planId,
      startDate: start,
      endDate: end,
      validityEndDate: end,
      totalMeals: 52,
      remainingMeals: 52,
      selectedMealsPerDay: 2,
      selectedGrams: 150,
      premiumBalance: [],
      addonSubscriptions: [],
      addonBalance: [],
      deliveryMode: "delivery",
      deliveryZoneId: new mongoose.Types.ObjectId(),
      deliveryWindow: "13:00-15:00",
      deliverySlot: { type: "delivery", window: "13:00-15:00" },
      deliveryAddress: {
        city: "Riyadh",
        district: "Olaya",
        street: "A",
      },
      contractSnapshot: { contract: { contractVersion: "subscription_contract.v1" } },
      checkoutCurrency: "SAR",
    },
  };
}

function testLegacyFactoryPreservesRealRemainingBalance() {
  const subscription = buildLegacySubscription();
  const payload = buildLegacyEntitlementBatchPayload({
    subscription,
    businessDate: "2026-08-06",
    now: new Date("2026-08-06T01:00:00Z"),
  });

  assert.strictEqual(payload.sourceKey, `legacy:${subscription._id}`);
  assert.strictEqual(payload.containerSubscriptionId, subscription._id);
  assert.strictEqual(payload.totalMeals, 78);
  assert.strictEqual(payload.remainingMeals, 20);
  assert.strictEqual(payload.consumedMeals, 58);
  assert.strictEqual(payload.mealsPerDay, 3);
  assert.strictEqual(payload.proteinGrams, 200);
  assert.strictEqual(payload.status, "active");
  assert.strictEqual(payload.applicationState, "applied");
}

function testPurchaseFactoryKeepsFutureBalanceScheduled() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const { draft, payment, subscriptionPayload } = buildDraftAndActivation({
    startDate: "2026-08-10",
  });
  const payload = buildPurchaseEntitlementBatchPayload({
    draft,
    payment,
    subscriptionPayload,
    containerSubscriptionId,
    businessDate: "2026-08-06",
  });

  assert.strictEqual(payload.sourceKey, `payment:${payment._id}`);
  assert.strictEqual(payload.containerSubscriptionId, containerSubscriptionId);
  assert.strictEqual(payload.totalMeals, 52);
  assert.strictEqual(payload.remainingMeals, 52);
  assert.strictEqual(payload.mealsPerDay, 2);
  assert.strictEqual(payload.proteinGrams, 150);
  assert.strictEqual(payload.status, "paid_scheduled");
  assert.strictEqual(payload.applicationState, "pending");
}

function testMixedGramBlueprintIsDeterministic() {
  const oldId = new mongoose.Types.ObjectId();
  const newId = new mongoose.Types.ObjectId();
  const blueprint = buildEntitlementSlotBlueprint({
    businessDate: "2026-08-06",
    batches: [
      {
        _id: newId,
        status: "active",
        effectiveStartDate: "2026-08-01",
        endDate: "2026-08-26",
        validityEndDate: "2026-08-26",
        mealsPerDay: 2,
        proteinGrams: 150,
        remainingMeals: 52,
      },
      {
        _id: oldId,
        status: "active",
        effectiveStartDate: "2026-07-01",
        endDate: "2026-08-09",
        validityEndDate: "2026-08-09",
        mealsPerDay: 3,
        proteinGrams: 200,
        remainingMeals: 20,
      },
    ],
  });

  assert.strictEqual(blueprint.requiredSlotCount, 5);
  assert.deepStrictEqual(
    blueprint.slots.map((slot) => ({
      slotKey: slot.slotKey,
      batchId: slot.entitlementBatchId,
      grams: slot.proteinGrams,
    })),
    [
      { slotKey: "slot_1", batchId: String(oldId), grams: 200 },
      { slotKey: "slot_2", batchId: String(oldId), grams: 200 },
      { slotKey: "slot_3", batchId: String(oldId), grams: 200 },
      { slotKey: "slot_4", batchId: String(newId), grams: 150 },
      { slotKey: "slot_5", batchId: String(newId), grams: 150 },
    ]
  );
  assert.strictEqual(
    resolveProteinGramsForSlot({ blueprint, slot: { slotIndex: 4 }, fallbackGrams: 200 }),
    150
  );
}

function testExistingSelectionsArePreservedWhenSlotsGrow() {
  const blueprint = buildEntitlementSlotBlueprint({
    businessDate: "2026-08-06",
    batches: [
      {
        _id: new mongoose.Types.ObjectId(),
        status: "active",
        effectiveStartDate: "2026-08-01",
        validityEndDate: "2026-08-26",
        mealsPerDay: 5,
        proteinGrams: 200,
        remainingMeals: 20,
      },
    ],
  });
  const existingMealSlots = [1, 2, 3].map((slotIndex) => ({
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    proteinId: new mongoose.Types.ObjectId(),
  }));

  const merged = preserveExistingSelectionsForBlueprint({
    blueprint,
    existingMealSlots,
  });

  assert.strictEqual(merged.length, 5);
  assert.strictEqual(merged[0].status, "complete");
  assert.strictEqual(merged[2].status, "complete");
  assert.strictEqual(merged[3].status, "empty");
  assert.strictEqual(merged[4].status, "empty");
}

function run() {
  testLegacyFactoryPreservesRealRemainingBalance();
  testPurchaseFactoryKeepsFutureBalanceScheduled();
  testMixedGramBlueprintIsDeterministic();
  testExistingSelectionsArePreservedWhenSlotsGrow();

  console.log("subscription entitlement batch factory and blueprint tests passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
