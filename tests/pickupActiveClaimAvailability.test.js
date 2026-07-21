"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  enforceActiveClaimAvailability,
} = require("../src/services/installPickupEntitlementClosure");

function run() {
  const item = {
    itemId: "slot_1",
    itemType: "meal",
    slotId: "slot_1",
    slotKey: "slot_1",
    selectionMode: "independent",
    availability: {
      state: "available",
      available: true,
      canSelect: true,
      reasons: [],
    },
    display: {},
  };
  const result = enforceActiveClaimAvailability({
    result: {
      slots: [{
        slotId: "slot_1",
        slotKey: "slot_1",
        slotIndex: 1,
        available: true,
        canSelect: true,
        reasons: [],
        display: {},
      }],
      pickupItems: [item],
      sections: [{ sectionKey: "meals", items: [item] }],
      availableSlotIds: ["slot_1"],
      unavailableSlotIds: [],
    },
    subscription: {
      baseMealAllocations: [{
        allocationKey: "allocation_1",
        dayId: "day_1",
        slotKey: "slot_1",
        state: "released",
        pickupRequestId: "request_active",
      }],
    },
    day: { _id: "day_1" },
    pickupRequests: [{
      _id: "request_active",
      status: "in_preparation",
      creditsReleasedAt: null,
    }],
  });

  assert.strictEqual(result.slots[0].available, false);
  assert.strictEqual(result.slots[0].unavailableReason, "SLOT_ALREADY_RESERVED");
  assert.strictEqual(result.pickupItems[0].availability.canSelect, false);
  assert.strictEqual(result.sections[0].items[0].availability.state, "reserved");
  assert.deepStrictEqual(result.availableSlotIds, []);
  assert.deepStrictEqual(result.unavailableSlotIds, ["slot_1"]);

  console.log("pickup active-claim availability checks passed");
}

run();
