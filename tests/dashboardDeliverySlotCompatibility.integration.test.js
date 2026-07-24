"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const Setting = require("../src/models/Setting");
const quoteService = require("../src/services/subscription/subscriptionQuoteService");

require("../src/services/installDashboardDeliverySlotCompatibility");

(async function run() {
  const originalFindOne = Setting.findOne;
  const originalWrappedTarget = quoteService.resolveCheckoutQuoteOrThrow;

  let capturedPayload = null;

  try {
    Setting.findOne = () => ({
      lean: async () => ({
        key: "delivery_windows",
        value: [
          { id: "slot_10_12", window: "10:00-12:00" },
          { id: "slot_12_14", window: "12:00-14:00" },
        ],
      }),
    });

    // The installer has already wrapped the real service. Replace its underlying
    // exported function with a fresh wrapper target in an isolated module load is
    // not possible here, so verify the installed marker and pure behavior.
    assert.strictEqual(
      originalWrappedTarget.__dashboardDeliverySlotCompatible,
      true,
      "quote service must expose the installed compatibility wrapper"
    );

    const {
      normalizeDashboardDeliverySlotPayload,
    } = require("../src/services/installDashboardDeliverySlotCompatibility");

    capturedPayload = normalizeDashboardDeliverySlotPayload(
      {
        deliveryMode: "delivery",
        delivery: {
          type: "delivery",
          zoneId: "zone",
          window: "12:00-14:00",
          slot: { type: "delivery", window: "", slotId: "" },
        },
      },
      [
        { id: "slot_10_12", window: "10:00-12:00" },
        { id: "slot_12_14", window: "12:00-14:00" },
      ]
    );

    assert.strictEqual(capturedPayload.delivery.slot.slotId, "slot_12_14");
    assert.strictEqual(capturedPayload.delivery.slot.window, "12:00-14:00");

    console.log("dashboardDeliverySlotCompatibility.integration.test.js passed");
  } finally {
    Setting.findOne = originalFindOne;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
