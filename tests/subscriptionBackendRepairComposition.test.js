"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  STATE_KEY,
  installSubscriptionBackendRepairComposition,
  verifyComposition,
} = require("../src/services/installSubscriptionBackendRepairComposition");

const state = installSubscriptionBackendRepairComposition();
assert.strictEqual(state.status, "installed");
assert.ok(state.installedAt instanceof Date);
assert.deepStrictEqual(verifyComposition(), {
  objectIdGuard: true,
  carryoverPricingCore: true,
  addonReservationLifecycle: true,
  addonOperationBoundary: true,
  readOnlyQueries: true,
  deliveryAppendSaga: true,
  pickupRequestRecovery: true,
  stableOpsAddonIdentity: true,
});
assert.strictEqual(globalThis[STATE_KEY], state);
assert.strictEqual(installSubscriptionBackendRepairComposition(), state, "composition re-entry after success must be idempotent");

console.log("subscription backend repair composition checks passed");
