"use strict";

const assert = require("node:assert/strict");

const {
  buildContext,
} = require("../src/services/dashboard/subscriptionDashboardStackingReadService");
const {
  buildManualDeductionBalanceReadModel,
} = require("../src/services/dashboard/manualDeduction/manualDeductionBalanceReadModel");
const {
  buildEligibleBaseMealBatchQuery,
} = require("../src/services/dashboard/manualDeduction/stackedManualDeductionService");

const subscription = {
  _id: "sub-1",
  totalMeals: 120,
  remainingMeals: 73,
  reservedMeals: 0,
  consumedMeals: 47,
  forfeitedMeals: 0,
};

const expiredBatch = {
  _id: "batch-old",
  sourceType: "legacy_seed",
  status: "expired",
  applicationState: "applied",
  effectiveStartDate: new Date("2026-07-28T21:00:00.000Z"),
  endDate: new Date("2026-08-26T21:00:00.000Z"),
  validityEndDate: new Date("2026-08-26T21:00:00.000Z"),
  totalMeals: 60,
  remainingMeals: 17,
  reservedMeals: 0,
  consumedMeals: 43,
  forfeitedMeals: 0,
};

const currentBatch = {
  _id: "batch-current",
  sourceType: "dashboard",
  status: "paid_scheduled",
  applicationState: "applied",
  effectiveStartDate: new Date("2026-09-15T00:00:00.000Z"),
  endDate: new Date("2026-10-14T00:00:00.000Z"),
  validityEndDate: new Date("2026-10-19T00:00:00.000Z"),
  totalMeals: 60,
  remainingMeals: 56,
  reservedMeals: 0,
  consumedMeals: 4,
  forfeitedMeals: 0,
};

function run() {
  const context = buildContext({
    subscription,
    batches: [expiredBatch, currentBatch],
    planNames: new Map(),
    payments: new Map(),
    businessDate: "2026-09-18",
  });

  assert.deepEqual(context.aggregateBalance, {
    totalMeals: 60,
    remainingMeals: 56,
    reservedMeals: 0,
    consumedMeals: 4,
    forfeitedMeals: 0,
  });

  assert.equal(context.packages.length, 2, "historical package must remain visible");
  assert.equal(context.packages[0].remainingMeals, 17, "historical package keeps its audit balance");

  const balance = buildManualDeductionBalanceReadModel(
    {
      stacking: {
        hasEntitlementBatches: true,
      },
    },
    context.aggregateBalance
  );
  assert.equal(balance.availableMeals, 56);
  assert.equal(balance.displayRemainingMeals, 56);
  assert.equal(balance.manualDeductionMaxMeals, 56);

  const query = buildEligibleBaseMealBatchQuery("sub-1", "2026-09-18");
  assert.equal(query.status.$in.includes("active"), true);
  assert.equal(query.status.$in.includes("paid_scheduled"), true);
  assert.deepEqual(query.effectiveStartDate, {
    $lte: new Date("2026-09-18T23:59:59.999+03:00"),
  });
  assert.deepEqual(query.validityEndDate, {
    $gte: new Date("2026-09-18T00:00:00.000+03:00"),
  });

  console.log("dashboardStackingCurrentBalanceAndManualDeductionValidity.test.js: OK");
}

run();
