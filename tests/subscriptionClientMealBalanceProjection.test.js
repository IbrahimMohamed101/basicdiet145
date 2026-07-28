"use strict";

const assert = require("assert");
const {
  CLIENT_MEAL_BALANCE_FLAG,
  CLIENT_MEAL_BALANCE_POLICY,
  CLIENT_MEAL_BALANCE_PROJECTION_VERSION,
  isClientMealBalanceProjectionEnabled,
  projectClientMealBalance,
  resolveClientMealBalanceProjection,
} = require("../src/services/subscription/subscriptionClientMealBalanceProjectionService");

let passed = 0;
const BUSINESS_DATE = "2026-07-28";

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    throw error;
  }
}

function modernSubscription(overrides = {}) {
  const subscription = {
    status: "active",
    entitlementVersion: 2,
    totalMeals: 52,
    remainingMeals: 36,
    reservedMeals: 16,
    consumedMeals: 0,
    forfeitedMeals: 0,
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T23:59:59.999Z"),
    validityEndDate: new Date("2026-08-31T23:59:59.999Z"),
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "baseMealAllocations")) {
    const reservedCount = Number.isSafeInteger(subscription.reservedMeals)
      ? subscription.reservedMeals
      : 0;
    subscription.baseMealAllocations = Array.from(
      { length: reservedCount },
      (_, index) => ({
        allocationKey: `reserved-${index + 1}`,
        quantity: 1,
        state: "reserved",
      })
    );
  }
  return subscription;
}

function baseMealBalance(overrides = {}) {
  return {
    totalMeals: 52,
    remainingMeals: 36,
    availableMeals: 36,
    reservedMeals: 16,
    consumedMeals: 0,
    canConsumeNow: true,
    maxConsumableMealsNow: 36,
    mealBalancePolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
    dailyMealLimitEnforced: false,
    dailyMealsDefault: 2,
    ...overrides,
  };
}

function enabledProjection(balance, subscription, businessDate = BUSINESS_DATE) {
  return projectClientMealBalance(balance, subscription, {
    enabled: true,
    businessDate,
  });
}

function run() {
  test("client projection flag is disabled by default", () => {
    assert.strictEqual(isClientMealBalanceProjectionEnabled({}), false);
    for (const value of ["1", "true", "yes", "on", "TRUE"]) {
      assert.strictEqual(
        isClientMealBalanceProjectionEnabled({
          [CLIENT_MEAL_BALANCE_FLAG]: value,
        }),
        true,
        value
      );
    }
    for (const value of ["", "0", "false", "off", "no"]) {
      assert.strictEqual(
        isClientMealBalanceProjectionEnabled({
          [CLIENT_MEAL_BALANCE_FLAG]: value,
        }),
        false,
        value
      );
    }
  });

  test("disabled projection preserves exact object identity", () => {
    const balance = baseMealBalance();
    const unchanged = projectClientMealBalance(
      balance,
      modernSubscription(),
      { enabled: false, businessDate: BUSINESS_DATE }
    );
    assert.strictEqual(unchanged, balance);
    assert.strictEqual(unchanged.balanceProjection, undefined);
    assert.strictEqual(unchanged.displayRemainingMeals, undefined);
    assert.strictEqual(unchanged.maxConsumableMealsNow, 36);
  });

  test("reserved meals remain visible as unconsumed while available capacity stays exact", () => {
    const projected = enabledProjection(
      baseMealBalance(),
      modernSubscription()
    );

    assert.deepStrictEqual(
      {
        totalMeals: projected.totalMeals,
        remainingMeals: projected.remainingMeals,
        displayRemainingMeals: projected.displayRemainingMeals,
        availableMeals: projected.availableMeals,
        reservedMeals: projected.reservedMeals,
        consumedMeals: projected.consumedMeals,
        forfeitedMeals: projected.forfeitedMeals,
        canConsumeNow: projected.canConsumeNow,
        maxConsumableMealsNow: projected.maxConsumableMealsNow,
      },
      {
        totalMeals: 52,
        remainingMeals: 52,
        displayRemainingMeals: 52,
        availableMeals: 36,
        reservedMeals: 16,
        consumedMeals: 0,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 36,
      }
    );
    assert.strictEqual(projected.mealBalancePolicy, CLIENT_MEAL_BALANCE_POLICY);
    assert.strictEqual(
      projected.balanceProjection.version,
      CLIENT_MEAL_BALANCE_PROJECTION_VERSION
    );
    assert.strictEqual(projected.balanceProjection.applied, true);
  });

  test("zero available with reserved meals displays unconsumed credit but blocks new planning", () => {
    const subscription = modernSubscription({
      totalMeals: 10,
      remainingMeals: 0,
      reservedMeals: 2,
      consumedMeals: 8,
    });
    const balance = baseMealBalance({
      totalMeals: 10,
      remainingMeals: 0,
      availableMeals: 0,
      reservedMeals: 2,
      consumedMeals: 8,
      canConsumeNow: false,
      maxConsumableMealsNow: 0,
    });
    const projected = enabledProjection(balance, subscription);

    assert.strictEqual(projected.remainingMeals, 2);
    assert.strictEqual(projected.displayRemainingMeals, 2);
    assert.strictEqual(projected.availableMeals, 0);
    assert.strictEqual(projected.maxConsumableMealsNow, 0);
    assert.strictEqual(projected.canConsumeNow, false);
  });

  test("fulfillment moves one reserved meal to consumed and lowers display by one", () => {
    const before = enabledProjection(
      baseMealBalance({
        totalMeals: 10,
        remainingMeals: 7,
        availableMeals: 7,
        reservedMeals: 3,
        consumedMeals: 0,
        maxConsumableMealsNow: 7,
      }),
      modernSubscription({
        totalMeals: 10,
        remainingMeals: 7,
        reservedMeals: 3,
        consumedMeals: 0,
      })
    );
    const after = enabledProjection(
      baseMealBalance({
        totalMeals: 10,
        remainingMeals: 7,
        availableMeals: 7,
        reservedMeals: 2,
        consumedMeals: 1,
        maxConsumableMealsNow: 7,
      }),
      modernSubscription({
        totalMeals: 10,
        remainingMeals: 7,
        reservedMeals: 2,
        consumedMeals: 1,
      })
    );

    assert.strictEqual(before.remainingMeals, 10);
    assert.strictEqual(after.remainingMeals, 9);
    assert.strictEqual(before.availableMeals, 7);
    assert.strictEqual(after.availableMeals, 7);
    assert.strictEqual(after.consumedMeals, 1);
  });

  test("projection never increases max consumable capacity above the existing read policy", () => {
    const projected = enabledProjection(
      baseMealBalance({ maxConsumableMealsNow: 4 }),
      modernSubscription()
    );
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 36);
    assert.strictEqual(projected.maxConsumableMealsNow, 4);
  });

  test("inactive subscriptions fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      enabledProjection(
        balance,
        modernSubscription({ status: "expired" })
      ),
      balance
    );
  });

  test("legacy entitlement records fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      enabledProjection(
        balance,
        modernSubscription({ entitlementVersion: 1 })
      ),
      balance
    );
  });

  test("missing lifecycle counters fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      enabledProjection(
        balance,
        modernSubscription({ reservedMeals: undefined })
      ),
      balance
    );
  });

  test("non-reconciling lifecycle counters fail closed", () => {
    const balance = baseMealBalance();
    const subscription = modernSubscription({ reservedMeals: 15 });
    assert.strictEqual(
      resolveClientMealBalanceProjection(subscription, {
        businessDate: BUSINESS_DATE,
      }),
      null
    );
    assert.strictEqual(
      enabledProjection(balance, subscription),
      balance
    );
  });

  test("negative or fractional counters fail closed", () => {
    assert.strictEqual(
      resolveClientMealBalanceProjection(
        modernSubscription({ remainingMeals: -1 }),
        { businessDate: BUSINESS_DATE }
      ),
      null
    );
    assert.strictEqual(
      resolveClientMealBalanceProjection(
        modernSubscription({ reservedMeals: 1.5 }),
        { businessDate: BUSINESS_DATE }
      ),
      null
    );
  });

  test("persisted lifecycle counters reject coercible and non-finite values", () => {
    for (const invalidValue of [
      "36",
      true,
      false,
      null,
      undefined,
      "",
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      assert.strictEqual(
        resolveClientMealBalanceProjection(
          modernSubscription({ remainingMeals: invalidValue }),
          { businessDate: BUSINESS_DATE }
        ),
        null,
        String(invalidValue)
      );
    }
  });

  test("released allocations do not enter the displayed balance", () => {
    const subscription = modernSubscription({
      remainingMeals: 38,
      reservedMeals: 14,
      baseMealAllocations: [
        ...Array.from({ length: 14 }, (_, index) => ({
          allocationKey: `reserved-${index + 1}`,
          quantity: 1,
          state: "reserved",
        })),
        {
          allocationKey: "released-1",
          quantity: 1,
          state: "released",
        },
        {
          allocationKey: "released-2",
          quantity: 1,
          state: "released",
        },
      ],
    });
    const projected = enabledProjection(baseMealBalance(), subscription);
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 38);
    assert.strictEqual(projected.reservedMeals, 14);
  });

  test("forfeited meals are excluded from the displayed balance", () => {
    const subscription = modernSubscription({
      remainingMeals: 36,
      reservedMeals: 10,
      consumedMeals: 0,
      forfeitedMeals: 6,
    });
    const projected = enabledProjection(baseMealBalance(), subscription);
    assert.strictEqual(projected.remainingMeals, 46);
    assert.strictEqual(projected.forfeitedMeals, 6);
  });

  test("allocation ledger contradictions fail closed", () => {
    const invalidLedgers = [
      modernSubscription({ baseMealAllocations: [] }),
      modernSubscription({
        baseMealAllocations: [
          { allocationKey: "duplicate", quantity: 1, state: "reserved" },
          { allocationKey: "duplicate", quantity: 1, state: "reserved" },
          ...Array.from({ length: 14 }, (_, index) => ({
            allocationKey: `reserved-${index + 1}`,
            quantity: 1,
            state: "reserved",
          })),
        ],
      }),
      modernSubscription({
        baseMealAllocations: [
          ...Array.from({ length: 15 }, (_, index) => ({
            allocationKey: `reserved-${index + 1}`,
            quantity: 1,
            state: "reserved",
          })),
          { allocationKey: "invalid-state", quantity: 1, state: "unknown" },
        ],
      }),
      modernSubscription({
        baseMealAllocations: [
          ...Array.from({ length: 15 }, (_, index) => ({
            allocationKey: `reserved-${index + 1}`,
            quantity: 1,
            state: "reserved",
          })),
          { allocationKey: "invalid-quantity", quantity: 2, state: "reserved" },
        ],
      }),
      modernSubscription({
        reservedMeals: 0,
        remainingMeals: 52,
        baseMealAllocations: [{
          allocationKey: "consumed-without-aggregate",
          quantity: 1,
          state: "consumed",
        }],
      }),
    ];
    for (const subscription of invalidLedgers) {
      assert.strictEqual(
        resolveClientMealBalanceProjection(subscription, {
          businessDate: BUSINESS_DATE,
        }),
        null
      );
    }
  });

  test("manual and legacy aggregate consumption may exceed allocation history", () => {
    const subscription = modernSubscription({
      remainingMeals: 36,
      reservedMeals: 10,
      consumedMeals: 6,
      baseMealAllocations: Array.from({ length: 10 }, (_, index) => ({
        allocationKey: `reserved-${index + 1}`,
        quantity: 1,
        state: "reserved",
      })),
    });
    assert.notStrictEqual(
      resolveClientMealBalanceProjection(subscription, {
        businessDate: BUSINESS_DATE,
      }),
      null
    );
  });

  test("effective read eligibility is identical across inactive and out-of-window states", () => {
    const balance = baseMealBalance();
    const inactiveStatuses = [
      "canceled",
      "completed",
      "expired",
      "pending_payment",
    ];
    for (const status of inactiveStatuses) {
      assert.strictEqual(
        enabledProjection(balance, modernSubscription({ status })),
        balance,
        status
      );
    }
    assert.strictEqual(
      enabledProjection(
        balance,
        modernSubscription({
          startDate: new Date("2026-08-01T00:00:00.000Z"),
        })
      ),
      balance
    );
    assert.strictEqual(
      enabledProjection(
        balance,
        modernSubscription({
          validityEndDate: new Date("2026-07-27T20:59:59.999Z"),
        })
      ),
      balance
    );
  });

  test("missing validity-window boundaries fail closed", () => {
    const balance = baseMealBalance();
    for (const missingWindow of [
      { startDate: null },
      { endDate: null, validityEndDate: null },
    ]) {
      assert.strictEqual(
        enabledProjection(
          balance,
          modernSubscription(missingWindow)
        ),
        balance
      );
    }
  });

  console.log(
    `subscriptionClientMealBalanceProjection.test.js: ${passed}/${passed} checks passed`
  );
}

run();
