"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");

const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");

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

console.log("subscription daily add-on runtime composition checks passed");
