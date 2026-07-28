"use strict";

const assert = require("assert");
const {
  DASHBOARD_MEAL_BALANCE_FLAG,
} = require("../src/services/subscription/subscriptionDashboardMealBalanceProjectionService");
const {
  dashboardSubscriptionMealBalanceProjection,
} = require("../src/middleware/dashboardSubscriptionMealBalanceProjection");

function subscription(overrides = {}) {
  return {
    _id: "507f191e810c19729de86001",
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

function withFlag(value, fn) {
  const existed = Object.prototype.hasOwnProperty.call(
    process.env,
    DASHBOARD_MEAL_BALANCE_FLAG
  );
  const previous = process.env[DASHBOARD_MEAL_BALANCE_FLAG];

  if (value === undefined) {
    delete process.env[DASHBOARD_MEAL_BALANCE_FLAG];
  } else {
    process.env[DASHBOARD_MEAL_BALANCE_FLAG] = value;
  }

  try {
    return fn();
  } finally {
    if (existed) {
      process.env[DASHBOARD_MEAL_BALANCE_FLAG] = previous;
    } else {
      delete process.env[DASHBOARD_MEAL_BALANCE_FLAG];
    }
  }
}

function invokeMiddleware({ flag, method, originalUrl, payload }) {
  return withFlag(flag, () => {
    let nextCalls = 0;
    let capturedPayload = null;
    const res = {
      json(value) {
        capturedPayload = value;
        return value;
      },
    };
    const originalJson = res.json;

    dashboardSubscriptionMealBalanceProjection(
      { method, originalUrl },
      res,
      () => {
        nextCalls += 1;
      }
    );

    const wrapped = res.json !== originalJson;
    const returned = res.json(payload);
    return {
      capturedPayload,
      nextCalls,
      returned,
      wrapped,
    };
  });
}

(function run() {
  const sourcePayload = { status: true, data: subscription() };

  const disabled = invokeMiddleware({
    flag: undefined,
    method: "GET",
    originalUrl: "/api/dashboard/subscriptions/507f191e810c19729de86001",
    payload: sourcePayload,
  });
  assert.strictEqual(disabled.nextCalls, 1);
  assert.strictEqual(disabled.wrapped, false);
  assert.strictEqual(disabled.capturedPayload, sourcePayload);
  assert.strictEqual(disabled.returned, sourcePayload);

  const enabled = invokeMiddleware({
    flag: "true",
    method: "GET",
    originalUrl: "/api/dashboard/subscriptions/507f191e810c19729de86001",
    payload: sourcePayload,
  });
  assert.strictEqual(enabled.nextCalls, 1);
  assert.strictEqual(enabled.wrapped, true);
  assert.strictEqual(enabled.capturedPayload.data.remainingMeals, 52);
  assert.strictEqual(enabled.capturedPayload.data.displayRemainingMeals, 52);
  assert.strictEqual(enabled.capturedPayload.data.availableMeals, 36);
  assert.strictEqual(enabled.capturedPayload.data.reservedMeals, 16);
  assert.strictEqual(enabled.capturedPayload.data.consumedMeals, 0);
  assert.strictEqual(sourcePayload.data.remainingMeals, 36, "source payload stays unchanged");

  for (const request of [
    { method: "POST", originalUrl: "/api/dashboard/subscriptions" },
    { method: "POST", originalUrl: "/api/dashboard/subscriptions/quote" },
    {
      method: "POST",
      originalUrl:
        "/api/dashboard/subscriptions/507f191e810c19729de86001/manual-deduction",
    },
    { method: "GET", originalUrl: "/api/dashboard/subscriptions/search" },
    { method: "GET", originalUrl: "/api/subscriptions/current/overview" },
  ]) {
    const untouched = invokeMiddleware({
      flag: "true",
      ...request,
      payload: sourcePayload,
    });
    assert.strictEqual(untouched.nextCalls, 1);
    assert.strictEqual(untouched.wrapped, false, `${request.method} ${request.originalUrl}`);
    assert.strictEqual(untouched.capturedPayload, sourcePayload);
  }

  const inconsistentPayload = {
    status: true,
    data: subscription({ reservedMeals: 17 }),
  };
  const inconsistent = invokeMiddleware({
    flag: "true",
    method: "GET",
    originalUrl: "/api/dashboard/subscriptions/507f191e810c19729de86001",
    payload: inconsistentPayload,
  });
  assert.strictEqual(inconsistent.wrapped, true);
  assert.strictEqual(inconsistent.capturedPayload.data.remainingMeals, 36);
  assert.strictEqual(inconsistent.capturedPayload.data.balanceProjection, undefined);

  console.log("dashboardSubscriptionMealBalanceMiddleware.test.js passed");
})();
