require("dotenv").config();

const {
  assertSubscriptionDayModifiable,
  DAY_LOCKED_BEFORE_DELIVERY_CODE,
  DELIVERY_TIME_UNAVAILABLE_CODE,
} = require("../src/services/subscription/subscriptionDayModificationPolicyService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

async function expectAllowed(name, payload) {
  const result = await assertSubscriptionDayModifiable(payload);
  assert(result && result.allowed === true, `${name}: expected allowed result`);
  return result;
}

async function expectRejected(name, payload, expectedCode) {
  try {
    await assertSubscriptionDayModifiable(payload);
  } catch (err) {
    assert(err && err.code === expectedCode, `${name}: expected code ${expectedCode}, got ${err && err.code}`);
    return err;
  }
  throw new Error(`${name}: expected rejection`);
}

function buildPickupSubscription() {
  return {
    deliveryMode: "pickup",
    deliverySlot: {
      type: "pickup",
      window: "",
      slotId: "",
    },
  };
}

function buildDeliverySubscription(window = "13:00-16:00") {
  return {
    deliveryMode: "delivery",
    deliveryWindow: window,
    deliverySlot: {
      type: "delivery",
      window,
      slotId: "slot_1",
    },
  };
}

async function run() {
  const businessDate = "2026-04-29";
  const getBusinessDateFn = async () => businessDate;
  const beforeLockNow = new Date("2026-04-29T11:30:00+03:00");
  const insideLockNow = new Date("2026-04-29T12:15:00+03:00");

  await expectAllowed("1. pickup same-day selection is allowed", {
    subscription: buildPickupSubscription(),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("2. pickup same-day add-on payment is allowed", {
    subscription: buildPickupSubscription(),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("3. pickup same-day premium payment is allowed", {
    subscription: buildPickupSubscription(),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("4. delivery same-day selection is allowed more than 1 hour before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("5. delivery same-day add-on payment is allowed more than 1 hour before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("6. delivery same-day premium payment is allowed more than 1 hour before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  const selectionLockError = await expectRejected(
    "7. delivery same-day selection is rejected within 1 hour before delivery time",
    {
      subscription: buildDeliverySubscription("13:00-16:00"),
      date: businessDate,
      now: insideLockNow,
      getBusinessDateFn,
    },
    DAY_LOCKED_BEFORE_DELIVERY_CODE
  );
  assert(selectionLockError.messageAr, "7. expected Arabic lock message");

  await expectRejected("8. delivery same-day add-on payment is rejected within 1 hour before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  }, DAY_LOCKED_BEFORE_DELIVERY_CODE);

  await expectRejected("9. delivery same-day premium payment is rejected within 1 hour before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  }, DAY_LOCKED_BEFORE_DELIVERY_CODE);

  await expectAllowed("10. future dates are allowed", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: "2026-04-30",
    now: insideLockNow,
    getBusinessDateFn,
  });

  await expectRejected("11. past dates are rejected", {
    subscription: buildPickupSubscription(),
    date: "2026-04-28",
    now: insideLockNow,
    getBusinessDateFn,
  }, "INVALID_DATE");

  const missingWindowError = await expectRejected("12. missing delivery time for same-day delivery is handled safely", {
    subscription: buildDeliverySubscription(""),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  }, DELIVERY_TIME_UNAVAILABLE_CODE);
  assert(missingWindowError.details && missingWindowError.details.fulfillmentMethod === "delivery", "12. expected delivery details");

  console.log("subscriptionDayModificationPolicy.test.js: 12/12 checks passed");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
