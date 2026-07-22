"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonCarryoverAuthority");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionDailyAddonOperationBoundary");
require("../src/services/installSubscriptionAddonOpsIdentityClosure");

const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const pricingService = require("../src/services/subscription/subscriptionAddonPricingService");
const opsPayloadService = require("../src/services/dashboard/opsPayloadService");

assert.strictEqual(
  dailyAddonService.ensureDailyAddonDefaultsForDay.__operationBoundaryAware,
  true,
  "startup composition must make the operations boundary the final ensure authority"
);
assert.strictEqual(
  dailyAddonService.ensureDailyAddonDefaultsForDay.__original.__reservationReconciliation,
  true,
  "the operations boundary must wrap the reservation reconciliation authority"
);
assert.strictEqual(
  dailyAddonService.__reservationClosurePatched,
  true,
  "startup composition must expose the reservation lifecycle closure"
);
assert.strictEqual(
  pricingService.buildAddonChoicePricingPreview,
  pricingService.buildAddonChoicePricingPreviewCore,
  "startup composition must expose the non-mutating carryover pricing core"
);
assert.strictEqual(
  opsPayloadService.buildKitchenDetailsPayload.__stableAddonIdentity,
  true,
  "startup composition must map daily add-on metadata by stable identity"
);

console.log("subscription daily add-on runtime composition checks passed");
