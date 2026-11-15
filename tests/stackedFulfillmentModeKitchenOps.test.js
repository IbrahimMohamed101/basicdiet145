"use strict";

// Pure read/projection regression for a pickup parent renewed with a home-delivery
// stacked entitlement batch. No MongoDB connection or customer writes required.
process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const { test } = require("node:test");
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
  consumeStackedChefChoiceDelivery,
} = require("../src/services/dashboard/manualDeduction/stackedManualDeductionService");
const Subscription = require("../src/models/Subscription");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const Allocation = require("../src/models/SubscriptionEntitlementAllocation");
const { getTodayKSADate, addDaysToKSADateString } = require("../src/utils/date");

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
const todayDay = { ...day, date: getTodayKSADate() };
const dto = mapSubscriptionDayToDTO(todayDay, null, subscription, customer, "restaurant", "ar");
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
const missingAddress = { ...todayDay, deliveryAddressOverride: null };
assert.equal(buildKitchenDetailsPayload(missingAddress, subscription, "ar").mealSlots.length, 0);
const addressGate = validateSubscriptionDayOperationalGate(missingAddress, "prepare", { subscription });
assert.equal(addressGate.allowed, false);
assert(!mapSubscriptionDayToDTO(missingAddress, null, subscription, customer, "restaurant", "ar")
  .allowedActions.some((action) => action.id === "prepare"));
const unpaidDay = { ...todayDay, addonSelections: [{ source: "pending_payment" }] };
assert.equal(validateSubscriptionDayOperationalGate(unpaidDay, "prepare", { subscription }).allowed, false);
assert(!mapSubscriptionDayToDTO(unpaidDay, null, subscription, customer, "restaurant", "ar")
  .allowedActions.some((action) => action.id === "prepare"));

test("only eligible historical delivery settlements appear for each staff role", () => {
  const yesterday = addDaysToKSADateString(todayDay.date, -1);
  const older = addDaysToKSADateString(todayDay.date, -2);
  const ready = { ...day, date: yesterday, status: "ready_for_delivery" };
  const actions = (candidate, role) => mapSubscriptionDayToDTO(
    candidate, null, subscription, customer, role, "ar"
  ).allowedActions.map((action) => action.id);

  assert.deepEqual(actions(ready, "restaurant"), ["fulfill"]);
  assert.deepEqual(actions(ready, "cashier"), ["fulfill"]);
  assert.deepEqual(actions(ready, "kitchen"), []);
  assert.deepEqual(actions({ ...ready, date: older }, "restaurant"), []);
  assert.deepEqual(actions({ ...ready, date: older }, "courier"), ["fulfill"]);
  assert.deepEqual(actions({ ...ready, status: "open" }, "restaurant"), []);
  assert.deepEqual(actions({ ...ready, fulfillmentModeOverride: "pickup" }, "restaurant"), []);
  assert.deepEqual(actions({ ...ready, addonSelections: [{ source: "pending_payment" }] }, "restaurant"), []);
});

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

test("Chef Choice settlement debits eligible delivery credits exactly once, including on retry", async (t) => {
  const batch = (id, remainingMeals, validityEndDate, mode) => ({
    _id: id, userId: subscription.userId, status: "active", applicationState: "applied",
    totalMeals: remainingMeals, remainingMeals, consumedMeals: 0, reservedMeals: 0,
    effectiveStartDate: "2026-10-01", endDate: validityEndDate, validityEndDate,
    mealsPerDay: 2, proteinGrams: 200, deliverySnapshot: { mode },
  });
  const first = batch("first", 1, "2026-10-25", "delivery");
  const second = batch("second", 51, "2026-10-29", "delivery");
  const pickup = batch("pickup", 10, "2026-10-22", "pickup");
  const expired = batch("expired", 12, "2026-10-19", "delivery");
  const all = [second, pickup, first, expired];
  let reservedDay = false;
  let failSecond = true;
  let mirror;
  let debitCount = 0;
  t.mock.method(Allocation, "exists", async () => reservedDay);
  t.mock.method(Batch, "find", () => ({ lean: async () => all }));
  t.mock.method(Subscription, "findOneAndUpdate", async () => ({ _id: subscription._id }));
  t.mock.method(Subscription, "updateOne", async (_filter, update) => {
    if ("entitlementVersion" in update.$set) mirror = update.$set;
    return { matchedCount: 1 };
  });
  t.mock.method(Batch, "findOneAndUpdate", (filter, update) => ({
    async lean() {
      const selected = all.find((entry) => entry._id === filter._id);
      if (selected === second && failSecond) throw new Error("interrupted write");
      const journalPath = "metadata.chefChoiceDeliveryDeductions";
      assert.equal(filter[journalPath + ".idempotencyKey"].$ne, day._id);
      const journal = update[1].$set[journalPath].$concatArrays[1][0];
      assert.equal(selected.deliverySnapshot.mode, "delivery");
      assert.equal(journal.idempotencyKey, day._id);
      assert.equal(journal.consumedReservedMeals, 0);
      selected.metadata ??= { chefChoiceDeliveryDeductions: [] };
      selected.metadata.chefChoiceDeliveryDeductions.push(journal);
      selected.remainingMeals -= journal.quantity;
      selected.consumedMeals += journal.quantity;
      if (!selected.remainingMeals) selected.status = "exhausted";
      debitCount += 1;
      return selected;
    },
  }));

  const args = { day, subscription, quantity: 2, mirrorDate: day.date };
  reservedDay = true;
  assert.equal(await consumeStackedChefChoiceDelivery(args), null);
  reservedDay = false;
  await assert.rejects(consumeStackedChefChoiceDelivery({ ...args, quantity: 4 }), { code: "INSUFFICIENT_CREDITS" });
  assert.equal(debitCount, 0);
  await assert.rejects(consumeStackedChefChoiceDelivery(args), /interrupted write/);
  assert.equal(first.remainingMeals, 0);
  failSecond = false;
  assert.equal((await consumeStackedChefChoiceDelivery(args)).changedCount, 2);
  assert.equal(second.remainingMeals, 50);
  assert.equal(first.consumedMeals + second.consumedMeals, 2);
  assert.equal(mirror.remainingMeals, 60);
  assert.equal((await consumeStackedChefChoiceDelivery({
    ...args, quantity: 1, day: { ...day, creditsDeducted: true },
  })).changedCount, 2);
  assert.equal(debitCount, 2);
  assert.equal(pickup.remainingMeals, 10);
  assert.equal(expired.remainingMeals, 12);
});
