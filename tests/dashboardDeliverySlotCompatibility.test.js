"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  normalizeDashboardDeliverySlotPayload,
} = require("../src/services/installDashboardDeliverySlotCompatibility");

const windows = [
  { id: "slot_10_12", window: "10:00-12:00" },
  { id: "slot_12_14", window: "12:00-14:00" },
  { id: "slot_14_16", window: "14:00-16:00" },
];

function deliveryPayload(overrides = {}) {
  return {
    userId: "user_1",
    planId: "plan_1",
    delivery: {
      type: "delivery",
      zoneId: "zone_1",
      address: { city: "Riyadh" },
      ...overrides,
    },
  };
}

(function run() {
  const legacyWindowOnly = normalizeDashboardDeliverySlotPayload(
    deliveryPayload({ window: "12:00-14:00" }),
    windows
  );
  assert.strictEqual(
    legacyWindowOnly.delivery.slot.slotId,
    "slot_12_14",
    "an exact legacy delivery.window must resolve its canonical slotId"
  );
  assert.strictEqual(
    legacyWindowOnly.delivery.slot.window,
    "12:00-14:00"
  );

  const blankNestedSlotWithSiblingId = normalizeDashboardDeliverySlotPayload(
    deliveryPayload({
      slotId: "slot_14_16",
      slot: { type: "delivery", window: "", slotId: "" },
    }),
    windows
  );
  assert.strictEqual(
    blankNestedSlotWithSiblingId.delivery.slot.slotId,
    "slot_14_16",
    "a sibling delivery.slotId must not be hidden by an empty nested slot"
  );
  assert.strictEqual(
    blankNestedSlotWithSiblingId.delivery.slot.window,
    "14:00-16:00"
  );

  const topLevelLegacyWindow = normalizeDashboardDeliverySlotPayload(
    {
      deliveryMode: "delivery",
      deliveryWindow: "10:00-12:00",
      delivery: { type: "delivery", slot: { slotId: "", window: "" } },
    },
    windows
  );
  assert.strictEqual(
    topLevelLegacyWindow.delivery.slot.slotId,
    "slot_10_12"
  );

  const onlyConfiguredWindow = normalizeDashboardDeliverySlotPayload(
    deliveryPayload({ slot: { type: "delivery", window: "", slotId: "" } }),
    [{ id: "only_slot", window: "10:00-12:00" }]
  );
  assert.strictEqual(onlyConfiguredWindow.delivery.slot.slotId, "only_slot");
  assert.strictEqual(
    onlyConfiguredWindow.delivery.slot.window,
    "10:00-12:00"
  );

  const multipleBlankWindows = normalizeDashboardDeliverySlotPayload(
    deliveryPayload({ slot: { type: "delivery", window: "", slotId: "" } }),
    windows
  );
  assert.strictEqual(
    multipleBlankWindows.delivery.slot.slotId,
    "",
    "multiple configured periods must never result in a random default"
  );

  const explicitId = normalizeDashboardDeliverySlotPayload(
    deliveryPayload({
      slot: { type: "delivery", slotId: "slot_12_14", window: "" },
    }),
    windows
  );
  assert.strictEqual(explicitId.delivery.slot.slotId, "slot_12_14");
  assert.strictEqual(explicitId.delivery.slot.window, "12:00-14:00");

  const pickupPayload = {
    delivery: {
      type: "pickup",
      pickupLocationId: "main",
      slot: { type: "pickup", slotId: "", window: "" },
    },
  };
  assert.strictEqual(
    normalizeDashboardDeliverySlotPayload(pickupPayload, windows),
    pickupPayload,
    "pickup payloads must be left untouched"
  );

  assert.throws(
    () =>
      normalizeDashboardDeliverySlotPayload(
        deliveryPayload({ window: "18:00-20:00" }),
        windows
      ),
    (error) => error && error.code === "INVALID_DELIVERY_SLOT"
  );

  assert.throws(
    () =>
      normalizeDashboardDeliverySlotPayload(
        deliveryPayload({ window: "10:00-12:00" }),
        [
          { id: "duplicate_1", window: "10:00-12:00" },
          { id: "duplicate_2", window: "10:00-12:00" },
        ]
      ),
    (error) => error && error.code === "INVALID_DELIVERY_SLOT"
  );

  console.log("dashboardDeliverySlotCompatibility.test.js passed");
})();
