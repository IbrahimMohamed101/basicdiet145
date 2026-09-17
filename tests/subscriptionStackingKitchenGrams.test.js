"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  applyBlueprintProteinGramsToMealSlots,
  createKitchenDetailsGramsWrapper,
  decorateKitchenDetailsWithStoredGrams,
  resolveStoredProteinGrams,
} = require("../src/services/subscription/subscriptionStackingKitchenGramsService");

function blueprint() {
  return {
    _id: new mongoose.Types.ObjectId(),
    sourceHash: "blueprint-hash",
    requiredSlotCount: 5,
    slots: [
      ...[1, 2, 3].map((slotIndex) => ({
        slotIndex,
        slotKey: `slot_${slotIndex}`,
        entitlementBatchId: new mongoose.Types.ObjectId(),
        proteinGrams: 200,
      })),
      ...[4, 5].map((slotIndex) => ({
        slotIndex,
        slotKey: `slot_${slotIndex}`,
        entitlementBatchId: new mongoose.Types.ObjectId(),
        proteinGrams: 150,
      })),
    ],
  };
}

function mealSlots(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    slotKey: `slot_${index + 1}`,
    status: "complete",
    proteinId: new mongoose.Types.ObjectId(),
  }));
}

function testBlueprintStampsExactPerSlotGrams() {
  const bp = blueprint();
  const stamped = applyBlueprintProteinGramsToMealSlots({
    mealSlots: mealSlots(),
    blueprint: bp,
    fallbackGrams: 200,
  });

  assert.deepStrictEqual(
    stamped.map((slot) => slot.fulfillmentSnapshot.proteinGrams),
    [200, 200, 200, 150, 150]
  );
  assert.strictEqual(stamped[3].entitlementSnapshot.proteinGrams, 150);
  assert.strictEqual(stamped[3].entitlementSnapshot.slotKey, "slot_4");
  assert.strictEqual(stamped[3].entitlementSnapshot.blueprintId, String(bp._id));
  assert.strictEqual(stamped[3].entitlementSnapshot.blueprintSourceHash, "blueprint-hash");
}

function testStoredSnapshotOverridesLegacySubscriptionGrams() {
  const sourceSlots = mealSlots();
  sourceSlots[3].fulfillmentSnapshot = { proteinGrams: 150 };
  sourceSlots[4].entitlementSnapshot = { proteinGrams: 150 };
  const kitchenDetails = {
    mealSlots: mealSlots().map((slot) => ({
      ...slot,
      proteinGrams: 200,
    })),
  };

  const result = decorateKitchenDetailsWithStoredGrams({
    kitchenDetails,
    day: { mealSlots: sourceSlots },
    subscription: { selectedGrams: 200 },
  });

  assert.notStrictEqual(result, kitchenDetails);
  assert.deepStrictEqual(
    result.mealSlots.map((slot) => slot.proteinGrams),
    [200, 200, 200, 150, 150]
  );
  assert.strictEqual(kitchenDetails.mealSlots[3].proteinGrams, 200);
}

function testLegacyPayloadRemainsSameWithoutSlotSnapshot() {
  const sourceSlots = mealSlots(2);
  const kitchenDetails = {
    mealSlots: sourceSlots.map((slot) => ({ ...slot, proteinGrams: 200 })),
  };
  const result = decorateKitchenDetailsWithStoredGrams({
    kitchenDetails,
    day: { mealSlots: sourceSlots },
    subscription: { selectedGrams: 200 },
  });

  assert.strictEqual(result, kitchenDetails);
}

function testWrapperPreservesOriginalContractAndArguments() {
  const calls = [];
  const originalResult = {
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", proteinGrams: 200 },
      { slotIndex: 2, slotKey: "slot_2", proteinGrams: 200 },
    ],
    addons: [],
    customCompatibilityField: "keep-me",
  };
  const wrapped = createKitchenDetailsGramsWrapper((...args) => {
    calls.push(args);
    return originalResult;
  });
  const day = {
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", fulfillmentSnapshot: { proteinGrams: 200 } },
      { slotIndex: 2, slotKey: "slot_2", fulfillmentSnapshot: { proteinGrams: 150 } },
    ],
  };
  const subscription = { selectedGrams: 200 };
  const result = wrapped(day, subscription, "ar", { proteinById: new Map() });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], day);
  assert.strictEqual(calls[0][1], subscription);
  assert.strictEqual(result.customCompatibilityField, "keep-me");
  assert.deepStrictEqual(
    result.mealSlots.map((slot) => slot.proteinGrams),
    [200, 150]
  );
}

function testSnapshotPrecedence() {
  const grams = resolveStoredProteinGrams({
    entitlementSnapshot: { proteinGrams: 150 },
    fulfillmentSnapshot: { proteinGrams: 180 },
    confirmationSnapshot: { proteinGrams: 190 },
    proteinGrams: 200,
  }, 250);
  assert.strictEqual(grams, 150);
}

function run() {
  testBlueprintStampsExactPerSlotGrams();
  testStoredSnapshotOverridesLegacySubscriptionGrams();
  testLegacyPayloadRemainsSameWithoutSlotSnapshot();
  testWrapperPreservesOriginalContractAndArguments();
  testSnapshotPrecedence();

  console.log("subscription stacking kitchen grams tests passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
