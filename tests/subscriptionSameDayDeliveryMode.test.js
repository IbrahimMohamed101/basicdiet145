"use strict";

const assert = require("assert");
const {
  applySameDayDeliveryPickupOverride,
  resolveFirstServiceDate,
} = require("../src/services/subscription/subscriptionQuoteService");

(async function main() {
  const delivery = {
    type: "delivery",
    address: { street: "Delivery Street", city: "Riyadh" },
    zoneId: "507f1f77bcf86cd799439011",
    slot: { slotId: "delivery_slot_1", window: "16:00-18:00" },
  };

  const normalized = await applySameDayDeliveryPickupOverride({
    delivery,
    requestedStartDate: new Date("2026-07-21T00:00:00+03:00"),
    currentBusinessDate: "2026-07-21",
    lang: "ar",
  });
  assert.strictEqual(normalized.type, "delivery");
  assert.strictEqual(normalized.firstDayFulfillmentOverride, null);

  const serviceDate = resolveFirstServiceDate({
    requestedStartDate: new Date("2026-07-21T00:00:00+03:00"),
    currentBusinessDate: "2026-07-21",
    rootDeliveryType: normalized.type,
    firstDayPickupOverride: normalized.firstDayFulfillmentOverride,
  });
  assert.strictEqual(serviceDate.resolvedDate, "2026-07-22");
  assert.strictEqual(serviceDate.shifted, true);
  assert.strictEqual(serviceDate.fulfillmentOptions.deliveryStartDateIfNoPickup, "2026-07-22");

  console.log("subscription same-day delivery mode checks passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
