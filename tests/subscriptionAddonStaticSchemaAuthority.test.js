"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");

const balanceSchema = Subscription.schema.path("addonBalance").schema;
const subscriptionSelectionSchema = Subscription.schema.path("addonSelections").schema;
const daySelectionSchema = SubscriptionDay.schema.path("addonSelections").schema;

const balancePaths = [
  "reservationKeys",
  "consumedAllocationKeys",
  "releasedAllocationKeys",
];
const selectionPaths = [
  "autoDailyAddon",
  "dailyEntitlement",
  "selectionOrigin",
  "dailyAllocationKey",
  "addonSettlementState",
  "reservedAt",
  "settledAt",
  "releasedAt",
  "settlementReason",
  "subscriptionAddonLabelI18n",
  "resolvedProductNameI18n",
  "requiresKitchenChoice",
];

for (const path of balancePaths) {
  assert.ok(balanceSchema.path(path), `Subscription.addonBalance.${path} must be declared statically`);
}
for (const path of selectionPaths) {
  assert.ok(subscriptionSelectionSchema.path(path), `Subscription.addonSelections.${path} must be declared statically`);
  assert.ok(daySelectionSchema.path(path), `SubscriptionDay.addonSelections.${path} must be declared statically`);
}

assert.deepStrictEqual(
  daySelectionSchema.path("addonSettlementState").enumValues,
  ["", "reserved", "consumed", "released"]
);
assert.strictEqual(daySelectionSchema.path("autoDailyAddon").defaultValue, false);
assert.strictEqual(daySelectionSchema.path("requiresKitchenChoice").defaultValue, false);
assert.strictEqual(balanceSchema.path("reservationKeys").defaultValue, undefined);

const protectedSchemas = [balanceSchema, subscriptionSelectionSchema, daySelectionSchema];
const originalAdd = protectedSchemas.map((schema) => schema.add);
let runtimeAddCalls = 0;
protectedSchemas.forEach((schema) => {
  schema.add = function forbiddenRuntimeSchemaMutation() {
    runtimeAddCalls += 1;
    throw new Error("runtime schema mutation is forbidden for subscription add-on lifecycle fields");
  };
});

try {
  delete require.cache[require.resolve("../src/services/installSubscriptionDailyAddonPolicy")];
  assert.doesNotThrow(() => require("../src/services/installSubscriptionDailyAddonPolicy"));
  assert.strictEqual(runtimeAddCalls, 0, "installer must not call schema.add when static definitions are complete");
} finally {
  protectedSchemas.forEach((schema, index) => {
    schema.add = originalAdd[index];
  });
}

console.log("subscription add-on static schema authority checks passed");
