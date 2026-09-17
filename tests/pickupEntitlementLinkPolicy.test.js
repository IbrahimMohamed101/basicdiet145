"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  collectPickupMealSlotKeys,
  isMealPickupItem,
  selectLinkedAllocationCandidates,
  slotAliases,
} = require("../src/services/subscription/pickupEntitlementLinkService");

function allocation(slotKey, overrides = {}) {
  return {
    allocationKey: `allocation_${slotKey}`,
    slotKey,
    state: "reserved",
    pickupRequestId: null,
    ...overrides,
  };
}

function pickupRequest(overrides = {}) {
  return {
    _id: "request_new",
    selectedMealSlotIds: ["slot_1"],
    selectedPickupItemIds: ["slot_1"],
    selectedPickupItems: [{
      itemId: "slot_1",
      slotId: "slot_1",
      slotKey: "slot_1",
      slotIndex: 1,
      itemType: "meal",
      selectionType: "full_meal_product",
      source: "mealSlot",
      sourceId: "slot_1",
    }],
    ...overrides,
  };
}

function run() {
  assert.deepStrictEqual(new Set(slotAliases("1")), new Set(["1", "slot_1"]));
  assert.deepStrictEqual(new Set(slotAliases("slot-2")), new Set(["slot-2", "2", "slot_2"]));

  assert.strictEqual(isMealPickupItem({ selectionType: "full_meal_product", slotId: "slot_1" }), true);
  assert.strictEqual(isMealPickupItem({ itemType: "sandwich", slotId: "slot_1" }), true);
  assert.strictEqual(isMealPickupItem({ itemType: "addon", selectionType: "addon" }), false);

  const keys = collectPickupMealSlotKeys(pickupRequest());
  assert(keys.includes("slot_1"));
  assert(keys.includes("1"));

  const exact = selectLinkedAllocationCandidates({
    dayAllocations: [allocation("slot_1"), allocation("slot_2")],
    pickupRequest: pickupRequest(),
    mealCount: 1,
  });
  assert.strictEqual(exact.reason, null);
  assert.strictEqual(exact.usedLegacyFallback, false);
  assert.strictEqual(exact.eligible.length, 1);
  assert.strictEqual(exact.eligible[0].slotKey, "slot_1");

  const legacyFallback = selectLinkedAllocationCandidates({
    dayAllocations: [allocation("legacy_a"), allocation("legacy_b")],
    pickupRequest: pickupRequest(),
    mealCount: 1,
  });
  assert.strictEqual(legacyFallback.reason, null);
  assert.strictEqual(legacyFallback.usedLegacyFallback, true);
  assert.strictEqual(legacyFallback.eligible[0].slotKey, "legacy_a");

  const partialExact = selectLinkedAllocationCandidates({
    dayAllocations: [allocation("slot_1"), allocation("legacy_b")],
    pickupRequest: pickupRequest({
      selectedMealSlotIds: ["slot_1", "slot_2"],
      selectedPickupItemIds: ["slot_1", "slot_2"],
      selectedPickupItems: [
        { itemType: "meal", slotId: "slot_1", slotKey: "slot_1" },
        { itemType: "meal", slotId: "slot_2", slotKey: "slot_2" },
      ],
    }),
    mealCount: 2,
  });
  assert.strictEqual(partialExact.reason, "partial_exact_match");
  assert.strictEqual(partialExact.eligible.length, 0);

  const activeClaim = selectLinkedAllocationCandidates({
    dayAllocations: [allocation("slot_1", { pickupRequestId: "request_active" })],
    pickupRequest: pickupRequest(),
    mealCount: 1,
    claimRequests: new Map([["request_active", { _id: "request_active", status: "in_preparation" }]]),
  });
  assert.strictEqual(activeClaim.eligible.length, 0);

  const staleClaim = selectLinkedAllocationCandidates({
    dayAllocations: [allocation("slot_1", { pickupRequestId: "request_canceled" })],
    pickupRequest: pickupRequest(),
    mealCount: 1,
    claimRequests: new Map([["request_canceled", {
      _id: "request_canceled",
      status: "canceled",
      creditsReleasedAt: new Date(),
    }]]),
  });
  assert.strictEqual(staleClaim.eligible.length, 1);

  console.log("pickup entitlement link policy checks passed");
}

run();
