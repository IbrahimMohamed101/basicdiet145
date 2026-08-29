"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const {
  batchIsEligible,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");
const {
  createManualDeductionCommandService,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

(function testLegacyEndDateRemainsEligibleForQuickDeduction() {
  const batch = {
    applicationState: "applied",
    status: "active",
    remainingMeals: 6,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-09-01T23:59:59+03:00"),
  };

  assert.equal(batchIsEligible(batch, "2026-08-29"), true);
})();

(function testQuickOptionMongoQueryUsesLegacyEndDateFallback() {
  const source = read("src/services/dashboard/subscriptionQuickDayDeductionService.js");
  assert.match(
    source,
    /\$ifNull:\s*\["\$validityEndDate",\s*"\$endDate"\]/,
    "quick-deduction option query must not exclude legacy endDate-only batches"
  );
})();

async function testStackedManualDeductionUsesBatchAuthority() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  let repaired = 0;
  let executed = 0;

  // Deliberately stale aggregate mirror: the stacked command must not reject
  // this before the batch-level executor validates the real package credits.
  const subscription = {
    _id: subscriptionId,
    userId: customerId,
    status: "active",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-01-31T00:00:00.000Z"),
    remainingMeals: 0,
    totalMeals: 0,
    consumedMeals: 0,
    reservedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
  };

  const repository = {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => subscription,
    customerExists: async () => true,
  };

  const { manualDeduction } = createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-29",
    runTransactionWithRetry: async () => {
      throw new Error("legacy transaction path must not run for a stacked subscription");
    },
    entitlementBatchDetector: async () => true,
    legacyBatchValidityRepair: async () => {
      repaired += 1;
    },
    stackedManualDeductionExecutor: async ({ counts, businessDate }) => {
      executed += 1;
      assert.equal(counts.regularMeals, 2);
      assert.equal(businessDate, "2026-08-29");
      return { ok: true, deducted: { total: 2 } };
    },
  });

  const result = await manualDeduction({
    subscriptionId: String(subscriptionId),
    body: { regularMeals: 2, premiumMeals: 0, reason: "cashier_walk_in" },
    actorId: new mongoose.Types.ObjectId(),
    actorRole: "admin",
    idempotencyKey: "manual-stacked-compatibility-0001",
  });

  assert.equal(repaired, 1, "legacy validity repair must run before stacked allocation");
  assert.equal(executed, 1, "stacked executor must receive the request despite a stale parent mirror");
  assert.equal(result.deducted.total, 2);
}

async function run() {
  await testStackedManualDeductionUsesBatchAuthority();
  console.log("deduction batch compatibility tests passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
