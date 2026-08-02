"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  normalizeMovementItem,
  normalizeSubscriptionPaymentReportContract,
} = require("../src/services/dashboard/subscriptionPaymentReportContractService");

function main() {
  const collection = normalizeMovementItem({
    movementId: "collection-1",
    movementType: "collection",
    status: "paid",
    amountHalala: 135800,
  });
  assert.equal(collection.countedInTotals, true);
  assert.equal(collection.countedInTotalsLabelAr, "نعم");

  const confirmedRefund = normalizeMovementItem({
    movementId: "refund-1",
    movementType: "refund",
    countedInTotals: true,
  });
  assert.equal(confirmedRefund.countedInTotals, true);
  assert.equal(confirmedRefund.countedInTotalsLabelAr, "نعم");

  const undatedRefund = normalizeMovementItem({
    movementId: "refund-2",
    movementType: "refund",
    countedInTotals: false,
  });
  assert.equal(undatedRefund.countedInTotals, false);
  assert.equal(undatedRefund.countedInTotalsLabelAr, "لا");

  const missingRefundDecision = normalizeMovementItem({
    movementId: "refund-3",
    movementType: "refund",
  });
  assert.equal(missingRefundDecision.countedInTotals, false);

  const source = {
    reportType: "daily",
    items: [
      { movementId: "c", movementType: "collection" },
      { movementId: "r", movementType: "refund", countedInTotals: false },
    ],
  };
  const normalized = normalizeSubscriptionPaymentReportContract(source);
  assert.notEqual(normalized, source);
  assert.equal(normalized.items[0].countedInTotals, true);
  assert.equal(normalized.items[1].countedInTotals, false);
  assert.equal(source.items[0].countedInTotals, undefined);

  console.log("subscription payment counted-in-totals contract tests passed");
}

main();

// Validation-only branch marker. Runtime behavior is identical to main.
