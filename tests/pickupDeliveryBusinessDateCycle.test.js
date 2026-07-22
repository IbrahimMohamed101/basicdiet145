"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertSubscriptionDayModifiable,
  DELIVERY_SELECTION_CUTOFF_PASSED_CODE,
  resolveScheduledDeliveryDateTime,
} = require("../src/services/subscription/subscriptionDayModificationPolicyService");

const businessDate = "2026-07-22";

async function testPickupUsesBusinessDateWithoutUtcDrift() {
  let restaurantCalls = 0;
  const result = await assertSubscriptionDayModifiable({
    subscription: {
      deliveryMode: "pickup",
      pickupLocationId: "branch_1",
    },
    day: {
      date: businessDate,
      status: "open",
    },
    date: businessDate,
    now: new Date("2026-07-21T23:30:00.000Z"),
    getBusinessDateFn: async () => businessDate,
    assertRestaurantOpenForOrderingFn: async ({ pickupLocationId, deliveryMode }) => {
      restaurantCalls += 1;
      assert.strictEqual(pickupLocationId, "branch_1");
      assert.strictEqual(deliveryMode, "pickup");
      return { isOpenNow: true };
    },
  });

  assert.strictEqual(restaurantCalls, 1);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.date, businessDate);
  assert.strictEqual(result.businessDate, businessDate);
  assert.strictEqual(result.fulfillmentMethod, "pickup");
  assert.strictEqual(result.sameDay, true);
}

async function testDeliveryUsesSameBusinessDateAndKsaCutoff() {
  const subscription = {
    deliveryMode: "delivery",
    deliverySlot: {
      type: "delivery",
      window: "18:00 - 20:00",
    },
  };
  const day = { date: businessDate, status: "open" };
  const schedule = resolveScheduledDeliveryDateTime({ subscription, day, date: businessDate });

  assert.strictEqual(schedule.fulfillmentMethod, "delivery");
  assert.strictEqual(schedule.deliveryTime, "18:00");
  assert.strictEqual(schedule.deliveryDateTime.toISOString(), "2026-07-22T15:00:00.000Z");
  assert.strictEqual(schedule.lockDateTime.toISOString(), "2026-07-22T13:00:00.000Z");

  const beforeCutoff = await assertSubscriptionDayModifiable({
    subscription,
    day,
    date: businessDate,
    now: new Date("2026-07-22T12:59:59.000Z"),
    getBusinessDateFn: async () => businessDate,
  });
  assert.strictEqual(beforeCutoff.allowed, true);
  assert.strictEqual(beforeCutoff.date, businessDate);
  assert.strictEqual(beforeCutoff.businessDate, businessDate);
  assert.strictEqual(beforeCutoff.fulfillmentMethod, "delivery");
  assert.strictEqual(beforeCutoff.sameDay, true);

  await assert.rejects(
    () => assertSubscriptionDayModifiable({
      subscription,
      day,
      date: businessDate,
      now: new Date("2026-07-22T13:00:00.000Z"),
      getBusinessDateFn: async () => businessDate,
    }),
    (error) => error
      && error.code === DELIVERY_SELECTION_CUTOFF_PASSED_CODE
      && error.details
      && error.details.date === businessDate
      && error.details.businessDate === businessDate
      && error.details.deliveryDateTime === "2026-07-22T18:00:00+03:00"
      && error.details.lockDateTime === "2026-07-22T16:00:00+03:00"
  );
}

async function testFutureAndPastDatesAreConsistentAcrossModes() {
  let pickupOpenChecks = 0;
  const futureDate = "2026-07-23";
  const futurePickup = await assertSubscriptionDayModifiable({
    subscription: { deliveryMode: "pickup", pickupLocationId: "branch_1" },
    day: { date: futureDate },
    date: futureDate,
    getBusinessDateFn: async () => businessDate,
    assertRestaurantOpenForOrderingFn: async () => {
      pickupOpenChecks += 1;
      return { isOpenNow: true };
    },
  });
  assert.strictEqual(futurePickup.allowed, true);
  assert.strictEqual(futurePickup.businessDate, businessDate);
  assert.strictEqual(futurePickup.sameDay, false);
  assert.strictEqual(pickupOpenChecks, 0, "future-day pickup must not use today's open-state decision");

  const futureDelivery = await assertSubscriptionDayModifiable({
    subscription: {
      deliveryMode: "delivery",
      deliverySlot: { type: "delivery", window: "18:00 - 20:00" },
    },
    day: { date: futureDate },
    date: futureDate,
    getBusinessDateFn: async () => businessDate,
  });
  assert.strictEqual(futureDelivery.allowed, true);
  assert.strictEqual(futureDelivery.businessDate, businessDate);
  assert.strictEqual(futureDelivery.sameDay, false);

  for (const deliveryMode of ["pickup", "delivery"]) {
    await assert.rejects(
      () => assertSubscriptionDayModifiable({
        subscription: {
          deliveryMode,
          pickupLocationId: "branch_1",
          deliverySlot: { type: deliveryMode, window: "18:00 - 20:00" },
        },
        day: { date: "2026-07-21" },
        date: "2026-07-21",
        getBusinessDateFn: async () => businessDate,
        assertRestaurantOpenForOrderingFn: async () => ({ isOpenNow: true }),
      }),
      (error) => error && error.code === "INVALID_DATE"
    );
  }
}

async function run() {
  await testPickupUsesBusinessDateWithoutUtcDrift();
  await testDeliveryUsesSameBusinessDateAndKsaCutoff();
  await testFutureAndPastDatesAreConsistentAcrossModes();
  console.log("pickup and delivery business-date cycle checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
