"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DASHBOARD_MEAL_BALANCE_FLAG,
  isProjectionEnabled,
  projectDashboardSubscriptionBalance,
  projectDashboardSubscriptionResponse,
  resolveDashboardMealBalanceProjection,
} = require("../src/services/subscription/subscriptionDashboardMealBalanceProjectionService");

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

function activeSubscription(overrides = {}) {
  return {
    _id: "507f191e810c19729de86001",
    status: "active",
    entitlementVersion: 2,
    totalMeals: 52,
    remainingMeals: 36,
    reservedMeals: 16,
    consumedMeals: 0,
    forfeitedMeals: 0,
    mealBalance: {
      totalMeals: 52,
      remainingMeals: 36,
      consumedMeals: 0,
      canConsumeNow: false,
      maxConsumableMealsNow: 0,
    },
    ...overrides,
  };
}

function run() {
  test("feature flag is disabled by default", () => {
    assert.strictEqual(isProjectionEnabled({}), false);
    assert.strictEqual(
      isProjectionEnabled({ [DASHBOARD_MEAL_BALANCE_FLAG]: "true" }),
      true
    );
  });

  test("52 total / 36 available / 16 reserved / 0 consumed displays 52", () => {
    const source = activeSubscription();
    const sourceSnapshot = JSON.stringify(source);
    const projection = resolveDashboardMealBalanceProjection(source);
    assert.deepStrictEqual(projection, {
      totalMeals: 52,
      availableMeals: 36,
      reservedMeals: 16,
      consumedMeals: 0,
      forfeitedMeals: 0,
      displayRemainingMeals: 52,
    });

    const projected = projectDashboardSubscriptionBalance(source);
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 36);
    assert.strictEqual(projected.reservedMeals, 16);
    assert.strictEqual(projected.consumedMeals, 0);
    assert.strictEqual(projected.mealBalance.remainingMeals, 52);
    assert.strictEqual(projected.mealBalance.availableMeals, 36);
    assert.strictEqual(projected.mealBalance.maxConsumableMealsNow, 0);
    assert.strictEqual(JSON.stringify(source), sourceSnapshot, "source is not mutated");
  });

  test("fulfillment decreases display balance without changing available credit", () => {
    const projected = projectDashboardSubscriptionBalance(activeSubscription({
      reservedMeals: 14,
      consumedMeals: 2,
    }));
    assert.strictEqual(projected.remainingMeals, 50);
    assert.strictEqual(projected.availableMeals, 36);
    assert.strictEqual(projected.reservedMeals, 14);
    assert.strictEqual(projected.consumedMeals, 2);
  });

  test("releasing a reservation restores planning availability but not extra credit", () => {
    const projected = projectDashboardSubscriptionBalance(activeSubscription({
      remainingMeals: 38,
      reservedMeals: 14,
    }));
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 38);
    assert.strictEqual(projected.reservedMeals, 14);
  });

  test("modern allocations can supply missing lifecycle counters", () => {
    const projected = projectDashboardSubscriptionBalance(activeSubscription({
      reservedMeals: undefined,
      consumedMeals: undefined,
      forfeitedMeals: undefined,
      baseMealAllocations: Array.from({ length: 16 }, (_, index) => ({
        allocationKey: `reserved-${index}`,
        quantity: 1,
        state: "reserved",
      })),
    }));
    assert.strictEqual(projected.remainingMeals, 52);
    assert.strictEqual(projected.availableMeals, 36);
    assert.strictEqual(projected.reservedMeals, 16);
    assert.strictEqual(projected.consumedMeals, 0);
  });

  test("inconsistent lifecycle counters fail closed", () => {
    const source = activeSubscription({ reservedMeals: 17 });
    const projected = projectDashboardSubscriptionBalance(source);
    assert.strictEqual(projected, source);
    assert.strictEqual(projected.remainingMeals, 36);
    assert.strictEqual(projected.balanceProjection, undefined);
  });

  test("null, empty, or missing counters never become manufactured zeroes", () => {
    for (const reservedMeals of [null, "", undefined]) {
      const source = activeSubscription({
        reservedMeals,
        baseMealAllocations: undefined,
      });
      const projected = projectDashboardSubscriptionBalance(source);
      assert.strictEqual(projected, source);
      assert.strictEqual(projected.remainingMeals, 36);
    }
  });

  test("legacy subscriptions without explicit lifecycle counters stay unchanged", () => {
    const source = {
      _id: "507f191e810c19729de86002",
      status: "active",
      totalMeals: 7,
      remainingMeals: 6,
    };
    assert.strictEqual(projectDashboardSubscriptionBalance(source), source);
  });

  test("non-active subscriptions stay unchanged", () => {
    const source = activeSubscription({ status: "canceled" });
    assert.strictEqual(projectDashboardSubscriptionBalance(source), source);
  });

  test("disabled response projection preserves exact object identity", () => {
    const payload = { status: true, data: [activeSubscription()] };
    assert.strictEqual(
      projectDashboardSubscriptionResponse(payload, { enabled: false }),
      payload
    );
  });

  test("list and detail response shapes are projected only when enabled", () => {
    const list = projectDashboardSubscriptionResponse(
      { status: true, data: [activeSubscription()] },
      { enabled: true }
    );
    assert.strictEqual(list.data[0].remainingMeals, 52);
    assert.strictEqual(list.data[0].availableMeals, 36);

    const detail = projectDashboardSubscriptionResponse(
      { status: true, data: activeSubscription() },
      { enabled: true }
    );
    assert.strictEqual(detail.data.remainingMeals, 52);
    assert.strictEqual(detail.data.availableMeals, 36);
  });

  test("export items are projected without touching export metadata", () => {
    const payload = {
      status: true,
      data: {
        exportedAt: "2026-07-28T00:00:00.000Z",
        count: 1,
        items: [activeSubscription()],
      },
    };
    const projected = projectDashboardSubscriptionResponse(payload, {
      enabled: true,
    });
    assert.strictEqual(projected.data.exportedAt, payload.data.exportedAt);
    assert.strictEqual(projected.data.count, 1);
    assert.strictEqual(projected.data.items[0].remainingMeals, 52);
  });

  test("installer is limited to dashboard read controllers", () => {
    const installerPath = path.join(
      __dirname,
      "../src/services/installDashboardSubscriptionMealBalanceProjection.js"
    );
    const source = fs.readFileSync(installerPath, "utf8");
    for (const method of [
      "listSubscriptionsAdmin",
      "getSubscriptionAdmin",
      "listAppUserSubscriptions",
      "exportSubscriptionsAdmin",
    ]) {
      assert(source.includes(`\"${method}\"`), `${method} must be wrapped`);
    }
    for (const forbidden of [
      "manualDeduction",
      "searchByPhone",
      "createSubscriptionAdmin",
      "confirm",
      "fulfill",
    ]) {
      assert(
        !source.includes(`\"${forbidden}\"`),
        `${forbidden} must not be wrapped`
      );
    }
  });

  test("route composition installs projection after service composition", () => {
    const routesPath = path.join(__dirname, "../src/routes/index.js");
    const source = fs.readFileSync(routesPath, "utf8");
    const installer = source.indexOf(
      'require("../services/installDashboardSubscriptionMealBalanceProjection")'
    );
    const paymentComposition = source.indexOf(
      'require("../services/dashboard/installPaymentChannelContract")'
    );
    const routeImports = source.indexOf('const authRoutes = require("./auth")');
    assert(installer > paymentComposition);
    assert(installer < routeImports);
  });

  console.log(
    `subscriptionDashboardMealBalanceProjection.test.js: ${passed}/${passed} checks passed`
  );
}

run();
