"use strict";

const assert = require("assert");

require("../src/services/installUpcomingSubscriptionPlanningBalance");

const {
  buildMealBalance,
} = require("../src/services/subscription/subscriptionClientSupportService");
const {
  applyUpcomingPlanningCompatibility,
  isActiveUpcomingSubscription,
  resolvePlannerBalanceDate,
} = require("../src/services/installUpcomingSubscriptionPlanningBalance");

function buildSubscription(overrides = {}) {
  return {
    status: "active",
    startDate: new Date("2026-08-03T00:00:00+03:00"),
    endDate: new Date("2026-09-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-02T00:00:00+03:00"),
    totalMeals: 60,
    remainingMeals: 60,
    reservedMeals: 0,
    consumedMeals: 0,
    entitlementVersion: 1,
    selectedMealsPerDay: 2,
    ...overrides,
  };
}

function run() {
  const upcoming = buildSubscription();

  assert.strictEqual(
    isActiveUpcomingSubscription(upcoming, "2026-08-02"),
    true,
    "active subscription should be recognized as upcoming before its start date"
  );

  const balanceBeforeStart = buildMealBalance(upcoming, "2026-08-02");
  assert.strictEqual(
    balanceBeforeStart.canConsumeNow,
    true,
    "Flutter compatibility guard must allow planning before the subscription start date"
  );
  assert.strictEqual(balanceBeforeStart.canPlanNow, true);
  assert.strictEqual(balanceBeforeStart.maxConsumableMealsNow, 60);
  assert.strictEqual(balanceBeforeStart.availableMeals, 60);
  assert.strictEqual(
    balanceBeforeStart.planningCompatibility.reason,
    "ACTIVE_SUBSCRIPTION_NOT_STARTED"
  );

  const balanceOnStart = buildMealBalance(upcoming, "2026-08-03");
  assert.strictEqual(balanceOnStart.canConsumeNow, true);
  assert.strictEqual(balanceOnStart.canPlanNow, true);
  assert.strictEqual(balanceOnStart.maxConsumableMealsNow, 60);

  const expired = buildMealBalance(upcoming, "2026-09-03");
  assert.strictEqual(expired.canConsumeNow, false);
  assert.strictEqual(expired.canPlanNow, false);
  assert.strictEqual(expired.maxConsumableMealsNow, 0);

  const inactive = buildMealBalance(
    buildSubscription({ status: "canceled" }),
    "2026-08-02"
  );
  assert.strictEqual(inactive.canConsumeNow, false);
  assert.strictEqual(inactive.canPlanNow, false);

  const noBalance = applyUpcomingPlanningCompatibility({
    balance: {
      remainingMeals: 0,
      availableMeals: 0,
      canConsumeNow: false,
      maxConsumableMealsNow: 0,
    },
    subscription: buildSubscription({ remainingMeals: 0, totalMeals: 0 }),
    evaluationDate: "2026-08-02",
  });
  assert.strictEqual(noBalance.canConsumeNow, false);
  assert.strictEqual(noBalance.canPlanNow, false);
  assert.strictEqual(noBalance.maxConsumableMealsNow, 0);

  assert.strictEqual(
    resolvePlannerBalanceDate(
      {
        businessDate: "2026-08-02",
        day: { date: "2026-08-03" },
      },
      { date: "2026-08-03" }
    ),
    "2026-08-03",
    "planner day date must take priority over the current business date"
  );

  console.log("Upcoming subscription planning balance tests passed");
}

run();
