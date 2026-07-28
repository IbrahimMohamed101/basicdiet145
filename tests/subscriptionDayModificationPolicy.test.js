require("dotenv").config();

const {
  assertSubscriptionDayModifiable,
  DAY_LOCKED_BEFORE_DELIVERY_CODE,
  DELIVERY_TIME_UNAVAILABLE_CODE,
} = require("../src/services/subscription/subscriptionDayModificationPolicyService");
const {
  PLANNING_WINDOW_REASONS,
} = require("../src/services/subscription/subscriptionPlanningWindowService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

async function openRestaurantStub({ pickupLocationId, deliveryMode } = {}) {
  return {
    open: true,
    pickupLocationId: pickupLocationId ? String(pickupLocationId) : null,
    deliveryMode: deliveryMode || null,
  };
}

function withPolicyTestDependencies(payload) {
  return {
    ...payload,
    assertRestaurantOpenForOrderingFn: payload && payload.assertRestaurantOpenForOrderingFn
      ? payload.assertRestaurantOpenForOrderingFn
      : openRestaurantStub,
  };
}

async function expectAllowed(name, payload) {
  const result = await assertSubscriptionDayModifiable(withPolicyTestDependencies(payload));
  assert(result && result.allowed === true, `${name}: expected allowed result`);
  return result;
}

async function expectRejected(name, payload, expectedCode) {
  try {
    await assertSubscriptionDayModifiable(withPolicyTestDependencies(payload));
  } catch (err) {
    assert(err && err.code === expectedCode, `${name}: expected code ${expectedCode}, got ${err && err.code}`);
    return err;
  }
  throw new Error(`${name}: expected rejection`);
}

function buildPickupSubscription(overrides = {}) {
  return {
    deliveryMode: "pickup",
    deliverySlot: {
      type: "pickup",
      window: "",
      slotId: "",
    },
    ...overrides,
  };
}

function buildDeliverySubscription(window = "13:00-16:00", overrides = {}) {
  return {
    deliveryMode: "delivery",
    deliveryWindow: window,
    deliverySlot: {
      type: "delivery",
      window,
      slotId: "slot_1",
    },
    ...overrides,
  };
}

async function run() {
  const businessDate = "2026-04-29";
  const getBusinessDateFn = async () => businessDate;
  const beforeLockNow = new Date("2026-04-29T07:30:00+03:00");  // 10:30 KSA — before 11:00 cutoff for 13:00 window
  const insideLockNow = new Date("2026-04-29T12:15:00+03:00");  // 12:15 KSA — after 11:00 cutoff for 13:00 window

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

  await expectAllowed("4. delivery same-day selection is allowed more than 2 hours before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("5. delivery same-day add-on payment is allowed more than 2 hours before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  await expectAllowed("6. delivery same-day premium payment is allowed more than 2 hours before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: beforeLockNow,
    getBusinessDateFn,
  });

  const selectionLockError = await expectRejected(
    "7. delivery same-day selection is rejected within 2 hours before delivery time",
    {
      subscription: buildDeliverySubscription("13:00-16:00"),
      date: businessDate,
      now: insideLockNow,
      getBusinessDateFn,
    },
    DAY_LOCKED_BEFORE_DELIVERY_CODE
  );
  assert(selectionLockError.messageAr, "7. expected Arabic lock message");

  await expectRejected("8. delivery same-day add-on payment is rejected within 2 hours before delivery time", {
    subscription: buildDeliverySubscription("13:00-16:00"),
    date: businessDate,
    now: insideLockNow,
    getBusinessDateFn,
  }, DAY_LOCKED_BEFORE_DELIVERY_CODE);

  await expectRejected("9. delivery same-day premium payment is rejected within 2 hours before delivery time", {
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

  await expectAllowed("13. default-off weekly policy preserves next-week compatibility", {
    subscription: buildDeliverySubscription("13:00-16:00", {
      startDate: "2026-04-20",
      validityEndDate: "2026-05-31",
    }),
    date: "2026-05-02",
    now: insideLockNow,
    getBusinessDateFn,
    weeklyPlanningWindowEnabled: false,
  });

  const currentWeekResult = await expectAllowed("14. enabled weekly policy allows the current Friday", {
    subscription: buildDeliverySubscription("13:00-16:00", {
      startDate: "2026-04-20",
      validityEndDate: "2026-05-31",
    }),
    date: "2026-05-01",
    now: insideLockNow,
    getBusinessDateFn,
    weeklyPlanningWindowEnabled: true,
  });
  assert(currentWeekResult.planningWindow, "14. expected planning window metadata");
  assert(currentWeekResult.planningWindow.planningWindowEnd === "2026-05-01", "14. expected Friday window end");

  const nextWeekError = await expectRejected("15. enabled weekly policy rejects the next Saturday", {
    subscription: buildDeliverySubscription("13:00-16:00", {
      startDate: "2026-04-20",
      validityEndDate: "2026-05-31",
    }),
    date: "2026-05-02",
    now: insideLockNow,
    getBusinessDateFn,
    weeklyPlanningWindowEnabled: true,
  }, PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK);
  assert(nextWeekError.messageAr, "15. expected Arabic weekly-window message");
  assert(nextWeekError.details.menuWeekStart === "2026-04-25", "15. expected Saturday week start");
  assert(nextWeekError.details.menuWeekEnd === "2026-05-01", "15. expected Friday week end");
  assert(nextWeekError.details.requestedDate === "2026-05-02", "15. expected requested date details");

  await expectRejected("16. enabled weekly policy respects subscription start date", {
    subscription: buildDeliverySubscription("13:00-16:00", {
      startDate: "2026-05-01",
      validityEndDate: "2026-05-31",
    }),
    date: "2026-04-30",
    now: insideLockNow,
    getBusinessDateFn,
    weeklyPlanningWindowEnabled: true,
  }, PLANNING_WINDOW_REASONS.BEFORE_SUBSCRIPTION_START);

  await expectRejected("17. enabled weekly policy respects subscription validity end", {
    subscription: buildDeliverySubscription("13:00-16:00", {
      startDate: "2026-04-20",
      validityEndDate: "2026-04-30",
    }),
    date: "2026-05-01",
    now: insideLockNow,
    getBusinessDateFn,
    weeklyPlanningWindowEnabled: true,
  }, PLANNING_WINDOW_REASONS.AFTER_SUBSCRIPTION_VALIDITY);

  console.log("subscriptionDayModificationPolicy.test.js: 17/17 checks passed");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
