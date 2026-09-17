"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");

const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  normalizeTimelineMealSlots,
} = require("../src/services/subscription/subscriptionTimelineService");
const {
  serializeMealSlotsForClient,
} = require(
  "../src/services/subscription/subscriptionStackingClientContractService"
);

function testEntitlementSnapshotIsPersistable() {
  const mealSlotsPath = SubscriptionDay.schema.path("mealSlots");
  assert(mealSlotsPath && mealSlotsPath.schema);
  assert(mealSlotsPath.schema.path("entitlementSnapshot"));
}

function testPublicSlotUsesExactStoredGramsAndHidesSnapshots() {
  const slots = serializeMealSlotsForClient([{
    slotIndex: 1,
    slotKey: "slot_1",
    entitlementSnapshot: {
      proteinGrams: 150,
      blueprintId: "internal-blueprint",
    },
    fulfillmentSnapshot: { proteinGrams: 200 },
    confirmationSnapshot: { proteinGrams: 250 },
  }], 300);

  assert.strictEqual(slots[0].proteinGrams, 150);
  assert.strictEqual(slots[0].entitlementSnapshot, undefined);
  assert.strictEqual(slots[0].fulfillmentSnapshot, undefined);
  assert.strictEqual(slots[0].confirmationSnapshot, undefined);
  assert.strictEqual(JSON.stringify(slots).includes("internal-blueprint"), false);
}

function testTimelineUsesExactGramsPerSlot() {
  const slots = normalizeTimelineMealSlots({
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      fulfillmentSnapshot: { proteinGrams: 150 },
    }, {
      slotIndex: 2,
      slotKey: "slot_2",
      status: "complete",
      fulfillmentSnapshot: { proteinGrams: 200 },
    }],
  }, { selectedGrams: 300 });

  assert.deepStrictEqual(slots.map((slot) => slot.proteinGrams), [150, 200]);
  assert.strictEqual(JSON.stringify(slots).includes("fulfillmentSnapshot"), false);
}

function run() {
  testEntitlementSnapshotIsPersistable();
  testPublicSlotUsesExactStoredGramsAndHidesSnapshots();
  testTimelineUsesExactGramsPerSlot();
  console.log("subscription stacking Flutter contract tests passed");
}

run();
