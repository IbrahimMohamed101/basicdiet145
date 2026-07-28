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
  return {
    status: "active",
    entitlementVersion: 2,
    totalMeals: 52,
    remainingMeals: 36,
    reservedMeals: 16,
    consumedMeals: 0,
    forfeitedMeals: 0,
    ...overrides,
  };
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
    assert.strictEqual(
      projectClientMealBalance(balance, modernSubscription(), {
        enabled: false,
      }),
      balance
    );
  });

  test("reserved meals remain visible as unconsumed while available capacity stays exact", () => {
    const projected = projectClientMealBalance(
      baseMealBalance(),
      modernSubscription(),
      { enabled: true }
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
    const projected = projectClientMealBalance(balance, subscription, {
      enabled: true,
    });

    assert.strictEqual(projected.remainingMeals, 2);
    assert.strictEqual(projected.displayRemainingMeals, 2);
    assert.strictEqual(projected.availableMeals, 0);
    assert.strictEqual(projected.maxConsumableMealsNow, 0);
    assert.strictEqual(projected.canConsumeNow, false);
  });

  test("fulfillment moves one reserved meal to consumed and lowers display by one", () => {
    const before = projectClientMealBalance(
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
      }),
      { enabled: true }
    );
    const after = projectClientMealBalance(
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
      }),
      { enabled: true }
    );

    assert.strictEqual(before.remainingMeals, 10);
    assert.strictEqual(after.remainingMeals, 9);
    assert.strictEqual(before.availableMeals, 7);
    assert.strictEqual(after.availableMeals, 7);
    assert.strictEqual(after.consumedMeals, 1);
  });

  test("projection never increases max consumable capacity above the existing read policy", () => {
    const projected = projectClientMealBalance(
      baseMealBalance({ maxConsumableMealsNow: 4 }),
      modernSubscription(),
      { enabled: true }
    );
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 36);
    assert.strictEqual(projected.maxConsumableMealsNow, 4);
  });

  test("inactive subscriptions fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      projectClientMealBalance(
        balance,
        modernSubscription({ status: "expired" }),
        { enabled: true }
      ),
      balance
    );
  });

  test("legacy entitlement records fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      projectClientMealBalance(
        balance,
        modernSubscription({ entitlementVersion: 1 }),
        { enabled: true }
      ),
      balance
    );
  });

  test("missing lifecycle counters fail closed", () => {
    const balance = baseMealBalance();
    assert.strictEqual(
      projectClientMealBalance(
        balance,
        modernSubscription({ reservedMeals: undefined }),
        { enabled: true }
      ),
      balance
    );
  });

  test("non-reconciling lifecycle counters fail closed", () => {
    const balance = baseMealBalance();
    const subscription = modernSubscription({ reservedMeals: 15 });
    assert.strictEqual(
      resolveClientMealBalanceProjection(subscription),
      null
    );
    assert.strictEqual(
      projectClientMealBalance(balance, subscription, { enabled: true }),
      balance
    );
  });

  test("negative or fractional counters fail closed", () => {
    assert.strictEqual(
      resolveClientMealBalanceProjection(
        modernSubscription({ remainingMeals: -1 })
      ),
      null
    );
    assert.strictEqual(
      resolveClientMealBalanceProjection(
        modernSubscription({ reservedMeals: 1.5 })
      ),
      null
    );
  });

  console.log(
    `subscriptionClientMealBalanceProjection.test.js: ${passed}/${passed} checks passed`
  );
}

run();
