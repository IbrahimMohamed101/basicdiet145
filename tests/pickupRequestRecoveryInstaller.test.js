"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDayFullMealCompatibility");
require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installPickupRequestRecovery");

const pickupService = require("../src/services/subscription/subscriptionPickupRequestClientService");

assert.strictEqual(
  pickupService.createSubscriptionPickupRequestForClient.__pickupReservationRecovery,
  true,
  "startup must recover incomplete idempotent pickup reservations before route binding"
);

console.log("pickup request recovery installer checks passed");
