"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  auditSubscriptionEntitlements,
} = require("../src/services/subscription/subscriptionEntitlementAuditService");

const now = new Date("2026-07-22T12:00:00.000Z");
const staleAt = new Date("2026-07-22T11:00:00.000Z");
const subscriptionId = "650000000000000000000001";
const bucketId = "650000000000000000000002";
const dayId = "650000000000000000000003";
const allocationKey = "daily-addon:subscription:2026-07-22:juice:0";

const healthySubscription = {
  _id: subscriptionId,
  status: "active",
  totalMeals: 10,
  remainingMeals: 6,
  reservedMeals: 2,
  consumedMeals: 2,
  forfeitedMeals: 0,
  baseMealAllocations: [
    { allocationKey: "meal-1", dayId, slotKey: "slot_1", state: "reserved" },
    { allocationKey: "meal-2", dayId, slotKey: "slot_2", state: "consumed" },
  ],
  addonBalance: [{
    _id: bucketId,
    addonPlanId: "650000000000000000000004",
    entitlementKey: "juice:650000000000000000000004",
    purchasedQty: 5,
    remainingQty: 3,
    reservedQty: 1,
    consumedQty: 1,
    reservationKeys: [allocationKey],
    consumedAllocationKeys: ["consumed-key"],
    releasedAllocationKeys: [],
  }],
};
const healthyDays = [{
  _id: dayId,
  date: "2026-07-22",
  status: "locked",
  addonSelections: [{
    _id: "650000000000000000000005",
    source: "subscription",
    balanceBucketId: bucketId,
    entitlementKey: "juice:650000000000000000000004",
    dailyAllocationKey: allocationKey,
    addonSettlementState: "reserved",
  }],
}];

const healthy = auditSubscriptionEntitlements({
  subscription: healthySubscription,
  days: healthyDays,
  pickupRequests: [{ _id: "650000000000000000000006", status: "locked", creditsReserved: true }],
  appendOperations: [{ _id: "650000000000000000000007", status: "completed", updatedAt: staleAt }],
  addonOperations: [{ _id: "650000000000000000000008", status: "completed", updatedAt: staleAt }],
  now,
});
assert.strictEqual(healthy.ok, true);
assert.strictEqual(healthy.issueCount, 0);

const drifted = auditSubscriptionEntitlements({
  subscription: {
    ...healthySubscription,
    totalMeals: 11,
    baseMealAllocations: [
      ...healthySubscription.baseMealAllocations,
      { allocationKey: "meal-1", dayId, slotKey: "slot_1", state: "reserved" },
    ],
    addonBalance: [{
      ...healthySubscription.addonBalance[0],
      purchasedQty: 7,
      reservationKeys: [allocationKey, allocationKey, "shared-key"],
      consumedAllocationKeys: ["consumed-key", "shared-key"],
    }],
  },
  days: [{
    ...healthyDays[0],
    status: "fulfilled",
  }],
  pickupRequests: [{
    _id: "650000000000000000000009",
    status: "in_preparation",
    creditsReserved: false,
    reservationState: "pending",
  }],
  appendOperations: [{
    _id: "650000000000000000000010",
    status: "day_saved",
    updatedAt: staleAt,
  }],
  addonOperations: [{
    _id: "650000000000000000000011",
    status: "balance_reserved",
    allocationKey,
    updatedAt: staleAt,
  }],
  now,
  staleMs: 5 * 60 * 1000,
});

const codes = new Set(drifted.issues.map((row) => row.code));
for (const expected of [
  "MEAL_BALANCE_DRIFT",
  "DUPLICATE_BASE_ALLOCATION_KEY",
  "DUPLICATE_ACTIVE_DAY_SLOT_ALLOCATION",
  "ADDON_BALANCE_DRIFT",
  "DUPLICATE_ADDON_LEDGER_KEY",
  "ADDON_LEDGER_STATE_OVERLAP",
  "FULFILLED_DAY_HAS_RESERVED_ADDON",
  "PICKUP_REQUEST_RESERVATION_INCOMPLETE",
  "STALE_DELIVERY_APPEND_OPERATION",
  "STALE_DAILY_ADDON_OPERATION",
]) {
  assert.ok(codes.has(expected), `expected audit issue ${expected}`);
}
assert.strictEqual(drifted.ok, false);
assert.ok(drifted.errorCount > 0);
assert.strictEqual(drifted.warningCount, 2);

const earlyConsumption = auditSubscriptionEntitlements({
  subscription: {
    ...healthySubscription,
    addonBalance: [{
      ...healthySubscription.addonBalance[0],
      reservationKeys: [],
      consumedAllocationKeys: [allocationKey, "consumed-key"],
      releasedAllocationKeys: [],
      remainingQty: 3,
      reservedQty: 0,
      consumedQty: 2,
    }],
  },
  days: [{
    ...healthyDays[0],
    status: "open",
    addonSelections: [{
      ...healthyDays[0].addonSelections[0],
      addonSettlementState: "consumed",
    }],
  }],
  now,
});
assert.ok(earlyConsumption.issues.some((row) => row.code === "ADDON_CONSUMED_BEFORE_FULFILLMENT"));

const projectionMismatch = auditSubscriptionEntitlements({
  subscription: healthySubscription,
  days: [{
    ...healthyDays[0],
    addonSelections: [{
      ...healthyDays[0].addonSelections[0],
      dailyAllocationKey: "missing-from-ledger",
    }],
  }],
  now,
});
assert.ok(projectionMismatch.issues.some((row) => row.code === "ADDON_PROJECTION_LEDGER_MISMATCH"));

const duplicateDayKey = auditSubscriptionEntitlements({
  subscription: healthySubscription,
  days: [
    healthyDays[0],
    {
      ...healthyDays[0],
      _id: "650000000000000000000012",
      date: "2026-07-23",
    },
  ],
  now,
});
assert.ok(duplicateDayKey.issues.some((row) => row.code === "DUPLICATE_DAILY_ADDON_ALLOCATION_KEY"));

console.log("subscription entitlement read-only audit checks passed");
