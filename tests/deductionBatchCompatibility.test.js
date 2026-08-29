"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  batchIsEligible,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");

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

(function testManualStackedPathRepairsLegacyBatchesBeforeExecution() {
  const source = read("src/services/dashboard/manualDeduction/manualDeductionCommandService.js");
  const repairIndex = source.indexOf("await repairLegacyBatchValidityEndDates(subscriptionId)");
  const executeIndex = source.indexOf("return executeStackedManualDeduction({");
  assert.ok(repairIndex >= 0, "stacked manual deduction must repair legacy batch dates");
  assert.ok(executeIndex > repairIndex, "legacy batch repair must happen before stacked execution");
})();

(function testStackedCommandDoesNotGateOnParentAggregateBalance() {
  const source = read("src/services/dashboard/manualDeduction/manualDeductionCommandService.js");
  const stackedStart = source.indexOf("if (await hasEntitlementBatches(subscriptionId))");
  const legacyStart = source.indexOf("try {", stackedStart);
  const stackedBlock = source.slice(stackedStart, legacyStart);
  assert.doesNotMatch(
    stackedBlock,
    /validateBalances\s*\(/,
    "stacked manual deduction must use entitlement batches instead of the parent balance mirror"
  );
})();

console.log("deduction batch compatibility tests passed");
