"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  classifyAppendOperation,
  classifyDailyAddonOperation,
} = require("../src/services/subscription/subscriptionOperationRecoveryService");

const now = new Date("2026-07-22T12:00:00.000Z");
const staleAt = new Date("2026-07-22T11:00:00.000Z");
const recentAt = new Date("2026-07-22T11:59:00.000Z");
const subscriptionId = "64d000000000000000000001";
const dayId = "64d000000000000000000002";

const dayBeforeAppend = {
  _id: dayId,
  plannerRevisionHash: "rev-before",
  mealSlots: [{ slotIndex: 1, slotKey: "slot_1" }],
  addonSelections: [],
};

const staleStarted = {
  _id: "64d000000000000000000003",
  subscriptionId,
  subscriptionDayId: dayId,
  status: "started",
  active: true,
  previousPlannerRevisionHash: "rev-before",
  expectedSlotKeys: ["slot_2"],
  updatedAt: staleAt,
};

const staleStartedAnalysis = classifyAppendOperation({
  operation: staleStarted,
  day: dayBeforeAppend,
  subscription: { baseMealAllocations: [] },
  now,
});
assert.strictEqual(staleStartedAnalysis.classification, "stale_before_day_save");
assert.strictEqual(staleStartedAnalysis.safeAction, "fail_stale_started");

const recentStartedAnalysis = classifyAppendOperation({
  operation: { ...staleStarted, updatedAt: recentAt },
  day: dayBeforeAppend,
  subscription: { baseMealAllocations: [] },
  now,
});
assert.strictEqual(recentStartedAnalysis.safeAction, null, "fresh operations must never be closed by recovery");

const dayAfterAppend = {
  ...dayBeforeAppend,
  plannerRevisionHash: "rev-applied",
  mealSlots: [
    { slotIndex: 1, slotKey: "slot_1" },
    { slotIndex: 2, slotKey: "slot_2" },
  ],
};
const settledAppend = {
  ...staleStarted,
  status: "addons_reserved",
  previousDaySnapshot: { plannerState: "confirmed" },
  appliedPlannerRevisionHash: "rev-applied",
  allocationKeys: ["allocation-slot-2"],
  updatedAt: staleAt,
};
const settledAnalysis = classifyAppendOperation({
  operation: settledAppend,
  day: dayAfterAppend,
  subscription: {
    baseMealAllocations: [{ allocationKey: "allocation-slot-2", state: "reserved" }],
  },
  addonOperations: [{ status: "completed" }],
  now,
});
assert.strictEqual(settledAnalysis.classification, "durably_settled_not_finalized");
assert.strictEqual(settledAnalysis.safeAction, "finalize_completed");

const missingAllocationAnalysis = classifyAppendOperation({
  operation: settledAppend,
  day: dayAfterAppend,
  subscription: { baseMealAllocations: [] },
  addonOperations: [{ status: "completed" }],
  now,
});
assert.strictEqual(missingAllocationAnalysis.safeAction, null);
assert.strictEqual(missingAllocationAnalysis.requiresManualReview, true);

const addonIntermediateAnalysis = classifyAppendOperation({
  operation: settledAppend,
  day: dayAfterAppend,
  subscription: {
    baseMealAllocations: [{ allocationKey: "allocation-slot-2", state: "reserved" }],
  },
  addonOperations: [{ status: "balance_reserved" }],
  now,
});
assert.strictEqual(addonIntermediateAnalysis.safeAction, null, "append must not complete while an add-on operation is intermediate");

const revisionConflictAnalysis = classifyAppendOperation({
  operation: { ...settledAppend, status: "recovery_required" },
  day: { ...dayAfterAppend, plannerRevisionHash: "rev-concurrent" },
  subscription: { baseMealAllocations: [] },
  now,
});
assert.strictEqual(revisionConflictAnalysis.classification, "recovery_required");
assert.strictEqual(revisionConflictAnalysis.safeAction, null);
assert.strictEqual(revisionConflictAnalysis.requiresManualReview, true);

const allocationKey = "daily-addon:sub:date:juice:0";
const dailyOperation = {
  _id: "64d000000000000000000004",
  subscriptionId,
  subscriptionDayId: dayId,
  balanceBucketId: "64d000000000000000000005",
  allocationKey,
  status: "balance_reserved",
  updatedAt: staleAt,
};
const dailyDay = {
  _id: dayId,
  addonSelections: [{ dailyAllocationKey: allocationKey, addonSettlementState: "reserved" }],
};
const dailySubscription = {
  addonBalance: [{
    _id: dailyOperation.balanceBucketId,
    reservationKeys: [allocationKey],
    consumedAllocationKeys: [],
    releasedAllocationKeys: [],
  }],
};
const dailyCompleteAnalysis = classifyDailyAddonOperation({
  operation: dailyOperation,
  day: dailyDay,
  subscription: dailySubscription,
  now,
});
assert.strictEqual(dailyCompleteAnalysis.classification, "projection_and_ledger_agree");
assert.strictEqual(dailyCompleteAnalysis.safeAction, "finalize_completed");

const dailyConsumedAnalysis = classifyDailyAddonOperation({
  operation: { ...dailyOperation, status: "day_applied" },
  day: { _id: dayId, addonSelections: [{ dailyAllocationKey: allocationKey, addonSettlementState: "consumed" }] },
  subscription: {
    addonBalance: [{
      _id: dailyOperation.balanceBucketId,
      reservationKeys: [],
      consumedAllocationKeys: [allocationKey],
      releasedAllocationKeys: [],
    }],
  },
  now,
});
assert.strictEqual(dailyConsumedAnalysis.safeAction, "finalize_consumed");

const dailyStaleBeforeReserve = classifyDailyAddonOperation({
  operation: { ...dailyOperation, status: "started" },
  day: { _id: dayId, addonSelections: [] },
  subscription: {
    addonBalance: [{
      _id: dailyOperation.balanceBucketId,
      reservationKeys: [],
      consumedAllocationKeys: [],
      releasedAllocationKeys: [],
    }],
  },
  now,
});
assert.strictEqual(dailyStaleBeforeReserve.classification, "stale_before_balance_reserve");
assert.strictEqual(dailyStaleBeforeReserve.safeAction, "fail_stale_started");

const mismatchAnalysis = classifyDailyAddonOperation({
  operation: dailyOperation,
  day: dailyDay,
  subscription: {
    addonBalance: [{
      _id: dailyOperation.balanceBucketId,
      reservationKeys: [],
      consumedAllocationKeys: [],
      releasedAllocationKeys: [],
    }],
  },
  now,
});
assert.strictEqual(mismatchAnalysis.classification, "ledger_projection_mismatch");
assert.strictEqual(mismatchAnalysis.safeAction, null);
assert.strictEqual(mismatchAnalysis.requiresManualReview, true);

console.log("subscription operation recovery service checks passed");
