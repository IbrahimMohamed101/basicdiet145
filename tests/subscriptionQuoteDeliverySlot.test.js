"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  resolveDeliverySlotOrThrow,
} = require("../src/services/subscription/subscriptionQuoteService");

const windows = ["10:00-12:00", "12:00-14:00"];

const legacyDashboardSlot = resolveDeliverySlotOrThrow({
  type: "delivery",
  slotId: "delivery-12:00-14:00",
  window: "12:00-14:00",
}, windows, "en");

assert.strictEqual(legacyDashboardSlot.type, "delivery");
assert.strictEqual(legacyDashboardSlot.slotId, "delivery_slot_2");
assert.strictEqual(legacyDashboardSlot.window, "12:00-14:00");

assert.throws(
  () => resolveDeliverySlotOrThrow({
    type: "delivery",
    slotId: "delivery-unknown",
    window: "18:00-20:00",
  }, windows, "en"),
  (error) => error && error.code === "INVALID_DELIVERY_SLOT"
);

console.log("subscriptionQuoteDeliverySlot.test.js passed");
