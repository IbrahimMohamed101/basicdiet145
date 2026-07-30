"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  MAX_RANGE_DAYS,
  buildRangeSubscriptionPaymentReport,
  rangeDaysInclusive,
  resolvePreviousRange,
} = require("../src/services/dashboard/subscriptionPaymentRangeReportService");

const ZERO = "‏0.00 ر.س.‏";

function money(value) {
  return {
    amountHalala: value,
    amountSar: value / 100,
    amountFormattedAr: value ? `${(value / 100).toFixed(2)} ر.س.` : ZERO,
  };
}

function collection({
  id,
  date,
  amount,
  customerId,
  method = "cash",
  provider = "none",
  fulfillment = "pickup",
}) {
  return {
    movementId: id,
    movementType: "collection",
    paymentId: id,
    customerId,
    customerName: customerId,
    paymentMethod: method,
    paymentMethodLabelAr: method === "cash" ? "نقدي" : "بطاقة",
    paymentProvider: provider,
    paymentProviderLabelAr: provider === "none" ? "بدون مزود" : "ميسر",
    sourceChannel: method === "cash" ? "dashboard" : "app",
    sourceChannelLabelAr: method === "cash" ? "لوحة التحكم" : "التطبيق",
    fulfillmentMethod: fulfillment,
    fulfillmentMethodLabelAr: fulfillment === "pickup" ? "استلام من الفرع" : "توصيل",
    subscriptionStatus: "active",
    subscriptionStatusLabelAr: "نشط",
    paymentType: "subscription_activation",
    paymentTypeLabelAr: "تفعيل اشتراك",
    amountHalala: amount,
    vatHalala: Math.round(amount * 15 / 115),
    netBeforeVatHalala: amount - Math.round(amount * 15 / 115),
    businessDate: date,
    paidAt: `${date}T10:00:00.000Z`,
    needsReview: false,
  };
}

function refund({ id, paymentId, date, amount, customerId }) {
  const vat = Math.round(amount * 15 / 115);
  return {
    movementId: id,
    movementType: "refund",
    refundId: id,
    paymentId,
    customerId,
    customerName: customerId,
    paymentMethod: "card",
    paymentMethodLabelAr: "بطاقة",
    paymentProvider: "moyasar",
    paymentProviderLabelAr: "ميسر",
    sourceChannel: "app",
    sourceChannelLabelAr: "التطبيق",
    fulfillmentMethod: "pickup",
    fulfillmentMethodLabelAr: "استلام من الفرع",
    subscriptionStatus: "active",
    subscriptionStatusLabelAr: "نشط",
    paymentType: "subscription_activation",
    paymentTypeLabelAr: "تفعيل اشتراك",
    amountHalala: amount,
    vatHalala: vat,
    netBeforeVatHalala: -(amount - vat),
    businessDate: date,
    refundedAt: `${date}T12:00:00.000Z`,
    countedInTotals: true,
    needsReview: false,
  };
}

function daily(date, gross = 0, refunds = 0) {
  return {
    businessDate: date,
    businessDateLabelAr: date,
    totalPaymentsCount: gross ? 1 : 0,
    ...money(gross),
    totalHalala: gross,
    totalFormattedAr: money(gross).amountFormattedAr,
    grossCollectionHalala: gross,
    grossCollectionFormattedAr: money(gross).amountFormattedAr,
    refundsHalala: refunds,
    refundsFormattedAr: money(refunds).amountFormattedAr,
    netCollectionHalala: gross - refunds,
    netCollectionFormattedAr: money(gross - refunds).amountFormattedAr,
  };
}

const julyItems = [
  collection({ id: "old-outside", date: "2026-07-10", amount: 9000, customerId: "old" }),
  collection({ id: "previous", date: "2026-07-24", amount: 3000, customerId: "previous" }),
  collection({ id: "c1", date: "2026-07-29", amount: 10000, customerId: "u1" }),
  refund({ id: "r1", paymentId: "c1", date: "2026-07-30", amount: 2000, customerId: "u1" }),
];
const augustItems = [
  collection({
    id: "c2",
    date: "2026-08-01",
    amount: 5000,
    customerId: "u2",
    method: "card",
    provider: "moyasar",
    fulfillment: "delivery",
  }),
];

const reports = {
  "2026-07": {
    reportType: "monthly",
    businessMonth: "2026-07",
    items: julyItems,
    dailyBreakdown: [
      daily("2026-07-24", 3000, 0),
      daily("2026-07-29", 10000, 0),
      daily("2026-07-30", 0, 2000),
    ],
  },
  "2026-08": {
    reportType: "monthly",
    businessMonth: "2026-08",
    items: augustItems,
    dailyBreakdown: [daily("2026-08-01", 5000, 0)],
  },
};

async function monthlyBuilder({ month }) {
  return reports[month] || { reportType: "monthly", businessMonth: month, items: [], dailyBreakdown: [] };
}

async function main() {
  assert.equal(MAX_RANGE_DAYS, 366);
  assert.equal(rangeDaysInclusive("2026-07-28", "2026-08-03"), 7);
  assert.deepEqual(resolvePreviousRange("2026-07-28", "2026-08-03"), {
    from: "2026-07-21",
    to: "2026-07-27",
    days: 7,
  });

  const report = await buildRangeSubscriptionPaymentReport({
    from: "2026-07-28",
    to: "2026-08-03",
    fulfillmentMethod: "all",
    includeDetails: true,
    comparePrevious: true,
  }, {
    buildMonthlySubscriptionPaymentReport: monthlyBuilder,
  });

  assert.equal(report.reportType, "range");
  assert.equal(report.range.days, 7);
  assert.equal(report.period.timezone, "Asia/Riyadh");
  assert.equal(report.period.openTime, "00:00");
  assert.equal(report.period.closeTime, "23:59");
  assert.equal(report.dailyBreakdown.length, 7);
  assert.equal(report.items.length, 3);
  assert.equal(report.summary.grossCollectionHalala, 15000);
  assert.equal(report.summary.refundsHalala, 2000);
  assert.equal(report.summary.netCollectionHalala, 13000);
  assert.equal(report.summary.totalPaymentsCount, 2);
  assert.equal(report.summary.uniqueCustomersCount, 2);
  assert.equal(report.reconciliation.isBalanced, true);
  assert.equal(report.reconciliation.differenceHalala, 0);
  assert.equal(report.reconciliation.movementDifferenceHalala, 0);
  assert.equal(report.reconciliation.vatDifferenceHalala, 0);
  assert.equal(report.comparison.previousPeriod.from, "2026-07-21");
  assert.equal(report.comparison.previousPeriod.to, "2026-07-27");
  assert.equal(report.comparison.netCollection.currentHalala, 13000);
  assert.equal(report.comparison.netCollection.previousHalala, 3000);
  assert.equal(report.comparison.netCollection.deltaHalala, 10000);
  assert(report.bySourceChannel.some((row) => row.key === "dashboard"));
  assert(report.byPaymentProvider.some((row) => row.key === "moyasar"));

  const compact = await buildRangeSubscriptionPaymentReport({
    from: "2026-07-29",
    to: "2026-07-30",
    includeDetails: false,
    comparePrevious: false,
  }, {
    buildMonthlySubscriptionPaymentReport: monthlyBuilder,
  });
  assert.deepEqual(compact.items, []);
  assert.equal(compact.summary.netCollectionHalala, 8000);
  assert.equal(compact.comparison.enabled, false);

  assert.throws(
    () => rangeDaysInclusive("2026-08-01", "2026-07-01"),
    /تاريخ البداية/
  );
  assert.throws(
    () => rangeDaysInclusive("2025-01-01", "2026-02-01"),
    /الحد الأقصى/
  );

  console.log("accounting range report tests passed");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
