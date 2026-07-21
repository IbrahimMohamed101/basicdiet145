"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  applyEntitlementAvailability,
} = require("../src/services/subscription/pickupEntitlementLinkService");

function baseAvailability() {
  const item = {
    itemId: "slot_1",
    itemType: "meal",
    slotId: "slot_1",
    slotKey: "slot_1",
    available: true,
    canSelect: true,
    availability: {
      state: "available",
      available: true,
      canSelect: true,
      unavailableReason: null,
      reasons: [],
    },
    display: {
      statusTextAr: "متاح للاستلام",
      statusTextEn: "Available for pickup",
      selectionTextAr: "اختر هذا العنصر للاستلام",
      selectionTextEn: "Select this item for pickup",
    },
  };
  return {
    subscriptionDayId: "day_1",
    slots: [{
      slotId: "slot_1",
      slotKey: "slot_1",
      slotIndex: 1,
      available: true,
      canSelect: true,
      unavailableReason: null,
      reasons: [],
      display: { ...item.display },
    }],
    pickupItems: [item],
    sections: [{ sectionKey: "meals", items: [item] }],
    availableSlotIds: ["slot_1"],
    unavailableSlotIds: [],
  };
}

function subscriptionWithAllocation(overrides = {}) {
  return {
    _id: "subscription_1",
    remainingMeals: 10,
    baseMealAllocations: [{
      allocationKey: "allocation_1",
      dayId: "day_1",
      slotKey: "slot_1",
      state: "reserved",
      pickupRequestId: null,
      ...overrides,
    }],
  };
}

function run() {
  const consumed = applyEntitlementAvailability({
    availability: baseAvailability(),
    subscription: subscriptionWithAllocation({ state: "consumed" }),
    day: { _id: "day_1" },
    pickupRequests: [],
  });
  assert.strictEqual(consumed.slots[0].available, false);
  assert.strictEqual(consumed.slots[0].unavailableReason, "SLOT_ALREADY_CONSUMED");
  assert.strictEqual(consumed.pickupItems[0].availability.canSelect, false);
  assert.deepStrictEqual(consumed.availableSlotIds, []);
  assert.deepStrictEqual(consumed.unavailableSlotIds, ["slot_1"]);

  const activeClaim = applyEntitlementAvailability({
    availability: baseAvailability(),
    subscription: subscriptionWithAllocation({
      state: "reserved",
      pickupRequestId: "request_active",
    }),
    day: { _id: "day_1" },
    pickupRequests: [{ _id: "request_active", status: "in_preparation" }],
  });
  assert.strictEqual(activeClaim.slots[0].unavailableReason, "SLOT_ALREADY_RESERVED");
  assert.strictEqual(activeClaim.pickupItems[0].availability.state, "reserved");

  const staleClaim = applyEntitlementAvailability({
    availability: baseAvailability(),
    subscription: subscriptionWithAllocation({
      state: "reserved",
      pickupRequestId: "request_canceled",
    }),
    day: { _id: "day_1" },
    pickupRequests: [],
  });
  assert.strictEqual(staleClaim.slots[0].available, true);
  assert.strictEqual(staleClaim.pickupItems[0].availability.canSelect, true);

  const releasedLegacy = applyEntitlementAvailability({
    availability: baseAvailability(),
    subscription: subscriptionWithAllocation({
      state: "released",
      pickupRequestId: "request_canceled",
    }),
    day: { _id: "day_1" },
    pickupRequests: [],
  });
  assert.strictEqual(releasedLegacy.slots[0].available, true);
  assert.strictEqual(releasedLegacy.slots[0].entitlementRepairRequired, true);
  assert.strictEqual(releasedLegacy.pickupItems[0].entitlementRepairRequired, true);

  const legacySlotKey = applyEntitlementAvailability({
    availability: baseAvailability(),
    subscription: subscriptionWithAllocation({ slotKey: "legacy_slot_key" }),
    day: { _id: "day_1" },
    pickupRequests: [],
  });
  assert.strictEqual(legacySlotKey.slots[0].available, true);

  console.log("pickup availability entitlement parity checks passed");
}

run();
