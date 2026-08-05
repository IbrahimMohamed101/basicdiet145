"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  applyResolvedScheduleToBatchPayload,
  resolveStackingPurchaseSchedule,
} = require("../src/services/subscription/subscriptionStackingSchedulePolicyService");

function deliverySnapshot({
  mode = "delivery",
  window = "13:00-15:00",
  pickupLocationId = "",
  street = "A",
} = {}) {
  return {
    mode,
    pickupLocationId,
    zoneId: mode === "delivery" ? "zone-a" : "",
    slot: { window: mode === "delivery" ? window : "" },
    address: mode === "delivery"
      ? { city: "Riyadh", district: "Olaya", street }
      : null,
  };
}

function batch({
  id = new mongoose.Types.ObjectId(),
  start = "2026-08-01",
  end = "2026-08-26",
  validityEnd = end,
  mealsPerDay = 3,
  grams = 200,
  delivery = deliverySnapshot(),
  status = "active",
} = {}) {
  return {
    _id: id,
    status,
    effectiveStartDate: start,
    endDate: end,
    validityEndDate: validityEnd,
    daysCount: 26,
    mealsPerDay,
    proteinGrams: grams,
    deliverySnapshot: delivery,
  };
}

function purchase({
  start = "2026-08-06",
  end = "2026-08-31",
  validityEnd = end,
  mealsPerDay = 2,
  grams = 150,
  delivery = deliverySnapshot(),
} = {}) {
  return {
    requestedStartDate: start,
    effectiveStartDate: start,
    endDate: end,
    validityEndDate: validityEnd,
    daysCount: 26,
    mealsPerDay,
    proteinGrams: grams,
    deliverySnapshot: delivery,
    status: "paid_scheduled",
    metadata: {},
  };
}

function testDifferentGramsOverlapWithoutScheduleShift() {
  const oldBatch = batch({ grams: 200, mealsPerDay: 3 });
  const newPurchase = purchase({ grams: 150, mealsPerDay: 2 });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: newPurchase,
    existingBatches: [oldBatch],
    businessDate: "2026-08-06",
    requestedStartDay: { status: "open", plannerState: "draft" },
  });

  assert.strictEqual(resolution.adjusted, false);
  assert.strictEqual(resolution.effectiveStartDate, "2026-08-06");
  assert.strictEqual(resolution.endDate, "2026-08-31");
  assert.strictEqual(resolution.overlapsExistingBatches, true);
  assert.strictEqual(resolution.mixedProteinGrams, true);
  assert.strictEqual(resolution.shouldExposeBalanceNow, true);
}

function testFuturePurchaseRemainsHiddenUntilStart() {
  const oldBatch = batch({ end: "2026-08-09", validityEnd: "2026-08-09" });
  const newPurchase = purchase({
    start: "2026-08-10",
    end: "2026-09-04",
    validityEnd: "2026-09-04",
  });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: newPurchase,
    existingBatches: [oldBatch],
    businessDate: "2026-08-06",
  });

  assert.strictEqual(resolution.adjusted, false);
  assert.strictEqual(resolution.effectiveStartDate, "2026-08-10");
  assert.strictEqual(resolution.overlapsExistingBatches, false);
  assert.strictEqual(resolution.shouldExposeBalanceNow, false);

  const payload = applyResolvedScheduleToBatchPayload(newPurchase, resolution);
  assert.strictEqual(payload.status, "paid_scheduled");
}

function testCommittedTodayMovesStartToTomorrowAndPreservesDuration() {
  const newPurchase = purchase({
    start: "2026-08-06",
    end: "2026-08-31",
    validityEnd: "2026-09-04",
  });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: newPurchase,
    existingBatches: [],
    businessDate: "2026-08-06",
    requestedStartDay: { status: "in_preparation" },
  });

  assert.strictEqual(resolution.adjusted, true);
  assert.strictEqual(resolution.effectiveStartDate, "2026-08-07");
  assert.strictEqual(resolution.endDate, "2026-09-01");
  assert.strictEqual(resolution.validityEndDate, "2026-09-05");
  assert.strictEqual(resolution.adjustments[0].reason, "REQUESTED_START_DAY_COMMITTED");
  assert.strictEqual(resolution.shouldExposeBalanceNow, false);
}

function testFulfillmentConflictMovesPurchaseAfterConflict() {
  const deliveryBatch = batch({
    start: "2026-08-01",
    end: "2026-08-09",
    validityEnd: "2026-08-09",
    delivery: deliverySnapshot({ mode: "delivery" }),
  });
  const pickupPurchase = purchase({
    start: "2026-08-06",
    end: "2026-08-31",
    validityEnd: "2026-08-31",
    delivery: deliverySnapshot({ mode: "pickup", pickupLocationId: "main" }),
  });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: pickupPurchase,
    existingBatches: [deliveryBatch],
    businessDate: "2026-08-06",
  });

  assert.strictEqual(resolution.adjusted, true);
  assert.strictEqual(resolution.effectiveStartDate, "2026-08-10");
  assert.strictEqual(resolution.endDate, "2026-09-04");
  assert.strictEqual(resolution.overlapsExistingBatches, false);
  assert.strictEqual(resolution.adjustments[0].reason, "FULFILLMENT_PROFILE_CONFLICT");
}

function testChainedFulfillmentConflictsResolveMonotonically() {
  const firstConflict = batch({
    start: "2026-08-01",
    end: "2026-08-09",
    validityEnd: "2026-08-09",
    delivery: deliverySnapshot({ mode: "delivery", window: "13:00-15:00" }),
  });
  const secondConflict = batch({
    start: "2026-08-20",
    end: "2026-08-25",
    validityEnd: "2026-08-25",
    delivery: deliverySnapshot({ mode: "delivery", window: "18:00-20:00" }),
  });
  const pickupPurchase = purchase({
    start: "2026-08-06",
    end: "2026-08-31",
    validityEnd: "2026-08-31",
    delivery: deliverySnapshot({ mode: "pickup", pickupLocationId: "main" }),
  });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: pickupPurchase,
    existingBatches: [firstConflict, secondConflict],
    businessDate: "2026-08-06",
  });

  assert.strictEqual(resolution.effectiveStartDate, "2026-08-26");
  assert.strictEqual(resolution.endDate, "2026-09-20");
  assert.strictEqual(resolution.adjustments.length, 1);
  assert.strictEqual(
    resolution.adjustments[0].conflictingBatchIds.length,
    2,
    "the initial 26-day window intersects both incompatible profiles"
  );
}

function testSameFulfillmentDifferentAddressIsTreatedAsConflict() {
  const first = batch({
    end: "2026-08-09",
    validityEnd: "2026-08-09",
    delivery: deliverySnapshot({ street: "A" }),
  });
  const second = purchase({
    delivery: deliverySnapshot({ street: "B" }),
  });
  const resolution = resolveStackingPurchaseSchedule({
    purchase: second,
    existingBatches: [first],
    businessDate: "2026-08-06",
  });

  assert.strictEqual(resolution.effectiveStartDate, "2026-08-10");
  assert.strictEqual(resolution.adjusted, true);
}

function run() {
  testDifferentGramsOverlapWithoutScheduleShift();
  testFuturePurchaseRemainsHiddenUntilStart();
  testCommittedTodayMovesStartToTomorrowAndPreservesDuration();
  testFulfillmentConflictMovesPurchaseAfterConflict();
  testChainedFulfillmentConflictsResolveMonotonically();
  testSameFulfillmentDifferentAddressIsTreatedAsConflict();

  console.log("subscription stacking schedule policy tests passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
