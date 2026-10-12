"use strict";

// Cashier-provided restaurant/aggregator sales and collections are independent
// axes. Subscription collections are read from paid Payment rows, never from
// created subscriptions. Both counts and amounts are kept in the snapshot.
const Payment = require("../../models/Payment");
const accounting = require("./accountingDailyReportService");

function safeHalala(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function paymentMethod(payment) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const raw = String(payment.method || metadata.paymentMethod || "").trim().toLowerCase();
  const source = String(payment.source || "").toLowerCase();
  if (payment.provider === "moyasar" || metadata.recordingMode === "moyasar_gateway") return "moyasar";
  if (["cash", "cod", "cash_on_delivery"].includes(raw) || payment.provider === "cash" || source === "dashboard_subscription_cash") return "cash";
  if (["visa", "card", "mada", "credit_card"].includes(raw) || source === "dashboard_subscription_visa") return "card";
  return "unknown";
}

async function subscriptionPaymentsForDate(date) {
  // Reuse the accounting business-day boundary (Asia/Riyadh + restaurant hours).
  const period = await accounting.resolveBusinessPeriod(date);
  const payments = await Payment.find({
    type: { $in: ["subscription_activation", "subscription_renewal"] },
    status: "paid",
    $or: [
      { paidAt: { $gte: period.start, $lte: period.end } },
      { paidAt: null, createdAt: { $gte: period.start, $lte: period.end } },
    ],
  }).select("_id subscriptionId amount provider method source metadata paidAt createdAt").lean();
  const rows = payments.map(p => ({
    paymentId: String(p._id),
    subscriptionId: p.subscriptionId ? String(p.subscriptionId) : null,
    reference: String(p.providerPaymentId || p.providerInvoiceId || p._id),
    amountHalala: safeHalala(p.amount),
    method: paymentMethod(p),
    paidAt: p.paidAt || p.createdAt,
    paidAtInferred: !p.paidAt,
  }));
  const methods = { cashHalala: 0, cardHalala: 0, moyasarHalala: 0, unknownHalala: 0 };
  for (const row of rows) methods[`${row.method === "unknown" ? "unknown" : row.method}Halala`] += row.amountHalala;
  return {
    count: rows.length,
    amountHalala: rows.reduce((sum, row) => sum + row.amountHalala, 0),
    ...methods,
    rows,
    period: { start: period.start, end: period.end, timezone: period.timezone },
    inferredPaymentDatesCount: rows.filter(row => row.paidAtInferred).length,
  };
}

function calculateClosing(channels, collections, automatic, confirmedCount) {
  const restaurantHalala = safeHalala(channels.restaurantHalala);
  const hungerstationHalala = safeHalala(channels.hungerstationHalala);
  const keetaHalala = safeHalala(channels.keetaHalala);
  const otherHalala = (channels.other || []).reduce((sum, item) => sum + safeHalala(item.amountHalala), 0);
  const appReceivablesHalala = hungerstationHalala + keetaHalala + otherHalala;
  const subscriptionHalala = safeHalala(automatic.amountHalala);
  const cashHalala = safeHalala(collections.cashHalala);
  const cardHalala = safeHalala(collections.cardHalala);
  const moyasarHalala = safeHalala(automatic.moyasarHalala);
  const totalSalesHalala = restaurantHalala + appReceivablesHalala + subscriptionHalala;
  const localExpectedHalala = restaurantHalala + safeHalala(automatic.cashHalala) + safeHalala(automatic.cardHalala);
  const localRecordedHalala = cashHalala + cardHalala;
  const recordedPlusReceivablesHalala = localRecordedHalala + moyasarHalala + appReceivablesHalala;
  return {
    restaurantHalala, appReceivablesHalala, subscriptionHalala,
    totalSalesHalala, localExpectedHalala, localRecordedHalala,
    cashHalala, cardHalala, moyasarHalala,
    unknownSubscriptionHalala: safeHalala(automatic.unknownHalala),
    localDifferenceHalala: localRecordedHalala - localExpectedHalala,
    recordedPlusReceivablesHalala,
    overallDifferenceHalala: recordedPlusReceivablesHalala - totalSalesHalala,
    subscriptionCountDifference: confirmedCount === null || confirmedCount === undefined
      ? 0 : confirmedCount - automatic.count,
  };
}

function inputSnapshot(closing) {
  return {
    channels: closing.channels,
    collections: closing.collections,
    confirmedSubscriptionCount: closing.confirmedSubscriptionCount ?? null,
    discrepancyReason: closing.discrepancyReason || "",
    notes: closing.notes || "",
  };
}

async function buildClosingView(closing, date) {
  // After submission, financial evidence must remain fixed for approval/audit.
  const automatic = closing && closing.status !== "draft" && closing.snapshot
    ? closing.snapshot.automatic
    : await subscriptionPaymentsForDate(date);
  const values = closing ? inputSnapshot(closing) : {
    channels: { restaurantHalala: 0, hungerstationHalala: 0, keetaHalala: 0, other: [] },
    collections: { cashHalala: 0, cardHalala: 0 },
    confirmedSubscriptionCount: null, discrepancyReason: "", notes: "",
  };
  const summary = closing && closing.status !== "draft" && closing.snapshot
    ? closing.snapshot.summary
    : calculateClosing(values.channels, values.collections, automatic, values.confirmedSubscriptionCount);
  return {
    businessDate: date,
    currency: "SAR",
    moneyUnit: "halala",
    status: closing ? closing.status : "new",
    ...values,
    automatic,
    summary,
    submittedAt: closing?.submittedAt || null,
    approvedAt: closing?.approvedAt || null,
    history: closing?.history || [],
  };
}

module.exports = {
  safeHalala,
  paymentMethod,
  subscriptionPaymentsForDate,
  calculateClosing,
  inputSnapshot,
  buildClosingView,
};
