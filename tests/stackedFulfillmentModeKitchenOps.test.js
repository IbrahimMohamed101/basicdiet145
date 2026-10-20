"use strict";

// Pure read/projection regression for a pickup parent renewed with a home-delivery
// stacked entitlement batch. No MongoDB connection or customer writes required.
process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const {
  assertFulfillmentMethodAllowed,
  buildFulfillmentPolicy,
  hasFirstDayPickupOverride,
  resolveEffectiveFulfillmentMode,
} = require("../src/services/subscription/subscriptionFulfillmentPolicyService");
const {
  buildKitchenDetailsPayload,
} = require("../src/services/dashboard/opsPayloadService");
const {
  validateSubscriptionDayOperationalGate,
} = require("../src/services/dashboard/subscriptionDayOperationalGateService");
const {
  mapSubscriptionDayToDTO,
} = require("../src/services/dashboard/dashboardDtoService");
const {
  serializeKitchenOperation,
} = require("../src/services/dashboard/kitchenOperationsContractService");
const {
  buildEligibleBaseMealBatchQuery,
} = require("../src/services/dashboard/manualDeduction/stackedManualDeductionService");

const customer = { _id: "customer-1", name: "Sample Customer", phone: "+966500000001" };
const subscription = {
  _id: "subscription-1",
  userId: customer._id,
  status: "active",
  startDate: "2026-09-01",
  endDate: "2026-11-12",
  deliveryMode: "pickup",
  selectedMealsPerDay: 2,
  selectedGrams: 200,
  // Legacy parent counters are stale and must NOT be used to decide day meals.
  totalMeals: 0,
  remainingMeals: 0,
};
const day = {
  _id: "subscription-day-1",
  subscriptionId: subscription._id,
  date: "2026-10-20",
  status: "open",
  fulfillmentModeOverride: "delivery",
  deliveryWindowOverride: "10:00-12:00",
  deliveryAddressOverride: { street: "Sample Street", city: "Jeddah" },
  baseMealSlots: [],
  selections: [],
};
const before = JSON.stringify({ subscription, day });

assert.equal(resolveEffectiveFulfillmentMode({ subscription, day }), "delivery");
assert.deepEqual(buildFulfillmentPolicy({ subscription, day }).allowedMethods, ["delivery"]);
assert.doesNotThrow(() => assertFulfillmentMethodAllowed({
  subscription, day, date: day.date, requestedMethod: "delivery",
}));
assert.throws(() => assertFulfillmentMethodAllowed({
  subscription, day, date: day.date, requestedMethod: "pickup",
}), (error) => error.code === "FULFILLMENT_METHOD_NOT_ALLOWED");

const kitchen = buildKitchenDetailsPayload(day, subscription, "ar");
assert.equal(kitchen.selectionMode, "chef_choice");
assert.equal(kitchen.mealSlots.length, 2);
assert.deepEqual(kitchen.mealSlots.map((slot) => slot.selectionType), ["chef_choice", "chef_choice"]);
assert.equal(validateSubscriptionDayOperationalGate(day, "prepare", { subscription }).allowed, true);
const dto = mapSubscriptionDayToDTO(day, null, subscription, customer, "restaurant", "ar");
assert.equal(dto.mode, "delivery");
assert.equal(dto.kitchenCards.length, 2);
assert(dto.allowedActions.some((action) => action.id === "prepare"));
const queueItem = serializeKitchenOperation(dto);
assert.equal(queueItem.kitchen.mealCount, 2);
assert.equal(queueItem.kitchen.cards.length, 2);
assert.deepEqual(queueItem.kitchen.cards.map((card) => card.type), ["chef_choice", "chef_choice"]);

// Explicit customer meals take priority; only the unchosen slot is Chef Choice.
const partiallySelected = {
  ...day,
  mealSlots: [{
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "standard_meal",
    productKey: "basic_meal",
  }],
};
const mixed = buildKitchenDetailsPayload(partiallySelected, subscription, "ar");
assert.equal(mixed.selectionMode, "mixed_customer_and_chef_choice");
assert.equal(mixed.mealSlots.length, 2);
assert.equal(mixed.mealSlots[0].slotKey, "slot_1");
assert.equal(mixed.mealSlots[1].selectionType, "chef_choice");

// Pickup-only days cannot become deliveries without an explicit persisted day override.
const pickupOnlyDay = { ...day, fulfillmentModeOverride: null };
assert.equal(resolveEffectiveFulfillmentMode({ subscription, day: pickupOnlyDay }), "pickup");
assert.equal(buildKitchenDetailsPayload(pickupOnlyDay, subscription, "ar").mealSlots.length, 0);
assert.equal(validateSubscriptionDayOperationalGate(pickupOnlyDay, "prepare", { subscription }).code, "EMPTY_KITCHEN_MEALS");

// Neither missing address nor pending payment may display an executable Prepare button.
const missingAddress = { ...day, deliveryAddressOverride: null };
assert.equal(buildKitchenDetailsPayload(missingAddress, subscription, "ar").mealSlots.length, 0);
const addressGate = validateSubscriptionDayOperationalGate(missingAddress, "prepare", { subscription });
assert.equal(addressGate.allowed, false);
assert(!mapSubscriptionDayToDTO(missingAddress, null, subscription, customer, "restaurant", "ar")
  .allowedActions.some((action) => action.id === "prepare"));
const unpaidDay = { ...day, addonSelections: [{ source: "pending_payment" }] };
assert.equal(validateSubscriptionDayOperationalGate(unpaidDay, "prepare", { subscription }).allowed, false);
assert(!mapSubscriptionDayToDTO(unpaidDay, null, subscription, customer, "restaurant", "ar")
  .allowedActions.some((action) => action.id === "prepare"));

// Reverse renewal (delivery parent -> pickup stacked day) also respects the daily method.
const deliveryParent = { ...subscription, deliveryMode: "delivery" };
const stackedPickupDay = { ...day, fulfillmentModeOverride: "pickup", pickupLocationIdOverride: "main" };
assert.equal(resolveEffectiveFulfillmentMode({ subscription: deliveryParent, day: stackedPickupDay }), "pickup");
assert.deepEqual(buildFulfillmentPolicy({ subscription: deliveryParent, day: stackedPickupDay }).allowedMethods, ["pickup"]);
assert.equal(hasFirstDayPickupOverride({ subscription: deliveryParent, day: stackedPickupDay }), false);

// A true first-day delivery -> pickup override still remains valid.
const firstDay = { ...stackedPickupDay, date: "2026-09-01" };
assert.equal(hasFirstDayPickupOverride({ subscription: deliveryParent, day: firstDay }), true);

// Existing stacked manual deduction must be based on active entitlement batches,
// not on the parent container's stale remainingMeals=0. No debit is performed.
const batchQuery = buildEligibleBaseMealBatchQuery(subscription._id, "2026-10-20");
assert(batchQuery.status.$in.includes("paid_scheduled"));
assert.equal(batchQuery.containerSubscriptionId, subscription._id);
assert.deepEqual(batchQuery.$or, [
  { remainingMeals: { $gt: 0 } }, { reservedMeals: { $gt: 0 } },
]);

assert.equal(JSON.stringify({ subscription, day }), before, "GET projections must not mutate source data");
console.log("stackedFulfillmentModeKitchenOps.test.js: OK");
