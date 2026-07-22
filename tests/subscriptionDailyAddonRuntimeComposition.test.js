"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionAddonOpsIdentityClosure");

const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const opsPayloadService = require("../src/services/dashboard/opsPayloadService");

assert.strictEqual(
  dailyAddonService.ensureDailyAddonDefaultsForDay.__reservationReconciliation,
  true,
  "startup composition must expose the reservation reconciliation wrapper"
);
assert.strictEqual(
  dailyAddonService.__reservationClosurePatched,
  true,
  "startup composition must expose the reservation lifecycle closure"
);
assert.strictEqual(
  opsPayloadService.buildKitchenDetailsPayload.__stableAddonIdentity,
  true,
  "startup composition must map daily add-on metadata by stable identity"
);

console.log("subscription daily add-on runtime composition checks passed");
