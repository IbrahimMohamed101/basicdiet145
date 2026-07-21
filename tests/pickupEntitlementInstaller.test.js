"use strict";

// Verification branch executes the exact current main pickup closure gate.
process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const liveBalanceService = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const closureBalanceService = require("../src/services/subscription/subscriptionPickupRequestBalanceClosureService");
const liveClientService = require("../src/services/subscription/subscriptionPickupRequestClientService");

function run() {
  assert.strictEqual(
    liveBalanceService.reserveSubscriptionMealsForPickupRequest,
    closureBalanceService.reserveSubscriptionMealsForPickupRequest,
    "startup must install the closed pickup reservation lifecycle before routes load"
  );
  assert.strictEqual(
    liveBalanceService.releaseReservedPickupMeals,
    closureBalanceService.releaseReservedPickupMeals,
    "startup must install linked-day-safe cancellation semantics"
  );
  assert.strictEqual(
    typeof liveClientService.getPickupAvailabilityForClient,
    "function"
  );
  console.log("pickup entitlement startup installer checks passed");
}

run();
