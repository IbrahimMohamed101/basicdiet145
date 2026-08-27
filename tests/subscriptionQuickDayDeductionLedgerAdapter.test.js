process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildQuickDeductionBlueprint,
  buildRevisionHash,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionLedgerAdapter");

const batchId = new mongoose.Types.ObjectId();
const batch = {
  _id: batchId,
  proteinGrams: 150,
};

const firstHash = buildRevisionHash("pickup-quick-test-key");
const secondHash = buildRevisionHash("pickup-quick-test-key");
const otherHash = buildRevisionHash("pickup-quick-other-key");
assert.strictEqual(firstHash, secondHash, "same idempotency key must produce stable revision hash");
assert.notStrictEqual(firstHash, otherHash, "different idempotency keys must isolate allocation revisions");
assert.match(firstHash, /^[a-f0-9]{64}$/);

const blueprint = buildQuickDeductionBlueprint({
  batch,
  businessDate: "2026-08-27",
  mealsToDeduct: 6,
});

assert.strictEqual(blueprint.date, "2026-08-27");
assert.strictEqual(blueprint.slots.length, 6);
assert.strictEqual(new Set(blueprint.slots.map((slot) => slot.slotKey)).size, 6);
assert.ok(blueprint.slots.every((slot) => String(slot.entitlementBatchId) === String(batchId)));
assert.ok(blueprint.slots.every((slot) => slot.proteinGrams === 150));
assert.deepStrictEqual(
  blueprint.slots.map((slot) => slot.slotKey),
  [
    "pickup_quick_1",
    "pickup_quick_2",
    "pickup_quick_3",
    "pickup_quick_4",
    "pickup_quick_5",
    "pickup_quick_6",
  ]
);

console.log("subscriptionQuickDayDeductionLedgerAdapter.test.js: OK");
