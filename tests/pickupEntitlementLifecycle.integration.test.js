"use strict";

process.env.NODE_ENV = "test";

require("../src/services/installPickupEntitlementClosure");

const {
  runPickupEntitlementLifecycleIntegration,
} = require("./cases/pickupEntitlementLifecycle.case");

runPickupEntitlementLifecycleIntegration().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
