"use strict";

function normalizeMovementItem(item = {}) {
  const movementType = String(item.movementType || "").trim().toLowerCase();
  let countedInTotals;

  if (typeof item.countedInTotals === "boolean") {
    countedInTotals = item.countedInTotals;
  } else if (movementType === "collection") {
    // Collection rows are produced only from paid/refunded subscription payments
    // that are already included in grossCollectionHalala for the selected period.
    countedInTotals = true;
  } else {
    // Refund inclusion is date/status-sensitive and must fail closed when the
    // refund serializer did not provide an explicit decision.
    countedInTotals = false;
  }

  return {
    ...item,
    countedInTotals,
    countedInTotalsLabelAr: countedInTotals ? "نعم" : "لا",
  };
}

function normalizeSubscriptionPaymentReportContract(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const items = Array.isArray(report.items)
    ? report.items.map(normalizeMovementItem)
    : report.items;

  return {
    ...report,
    items,
  };
}

module.exports = {
  normalizeMovementItem,
  normalizeSubscriptionPaymentReportContract,
};
