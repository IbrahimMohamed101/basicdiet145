"use strict";

// Cashier-provided restaurant/aggregator sales and collections are independent
// axes. Subscription collections are read from paid Payment rows, never from
// created subscriptions. Both counts and amounts are kept in the snapshot.
const Payment = require("../../models/Payment");
const PaymentRefund = require("../../models/PaymentRefund");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const { getBusinessDayBounds } = require("../pos/businessDaySetting");
const { expectedTotals } = require("../pos/expectedTotals");
const { POS_V2, getClosingVersion, calculationMode } = require("../pos/closingVersionService");

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

function buildPaidSubscriptionSummary(payments = [], subscriptions = [], users = [], period = {}) {
  const subscriptionMap = new Map(subscriptions.map(s => [String(s._id), s]));
  const userMap = new Map(users.map(u => [String(u._id), u]));
  const activeActivationIds = new Set();
  const activationSeen = new Set();
  const distinctSubscriptions = new Set();
  const issues = [];
  const rows = payments.map(p => {
    const subscriptionId = p.subscriptionId ? String(p.subscriptionId) : null;
    const linked = subscriptionId ? subscriptionMap.get(subscriptionId) : null;
    const method = paymentMethod(p);
    const type = String(p.type || "");
    const paymentStatus = String(p.status || "paid");
    const paymentId = String(p._id);
    const reviewReasons = [];
    if (!linked) reviewReasons.push("دفعة دون سجل اشتراك مرتبط");
    if (method === "unknown") reviewReasons.push("طريقة الدفع غير مصنفة");
    if (linked?.status === "canceled") reviewReasons.push("الاشتراك ملغي؛ تحقق من وجود استرداد");
    if (linked?.status === "pending_payment") reviewReasons.push("الدفعة ناجحة والاشتراك ما زال بانتظار الدفع");
    if (!p.paidAt) reviewReasons.push("تاريخ الدفع غير محفوظ؛ استخدم تاريخ إنشاء العملية");
    if (paymentStatus === "refunded") reviewReasons.push("الدفعة تم ردها؛ راجع تاريخ الاسترداد والتسوية");
    if (subscriptionId && linked) distinctSubscriptions.add(subscriptionId);
    if (type === "subscription_activation" && linked) {
      if (activationSeen.has(subscriptionId)) reviewReasons.push("تفعيلان مدفوعان لنفس الاشتراك؛ يلزم المراجعة");
      activationSeen.add(subscriptionId);
      activeActivationIds.add(subscriptionId);
    }
    const user = linked?.userId ? userMap.get(String(linked.userId)) : p.userId ? userMap.get(String(p.userId)) : null;
    if (reviewReasons.length) issues.push({ paymentId, reasons: reviewReasons });
    return {
      paymentId, subscriptionId,
      subscriptionStatus: linked?.status || "missing",
      customerName: String(user?.name || "").trim(),
      amountHalala: safeHalala(p.amount),
      method,
      paymentStatus,
      paymentType: type,
      paymentTypeLabelAr: type === "subscription_activation" ? "تفعيل اشتراك" : "تجديد اشتراك",
      sourceChannel: String(p.source || "").startsWith("dashboard_") ? "dashboard" : p.provider === "moyasar" ? "app" : "unknown",
      reference: String(p.providerPaymentId || p.providerInvoiceId || p._id),
      paidAt: p.paidAt || p.createdAt,
      paidAtInferred: !p.paidAt,
      reviewReasons,
    };
  });
  const methods = { cashHalala: 0, cardHalala: 0, moyasarHalala: 0, unknownHalala: 0 };
  for (const row of rows) methods[`${row.method}Halala`] += row.amountHalala;
  return {
    // A successful payment is a financial movement; it is not proof of a
    // *new, distinct* subscription. Use linked activation IDs for that count.
    count: activeActivationIds.size,
    newSubscriptionsCount: activeActivationIds.size,
    paymentCount: rows.length,
    renewalPaymentsCount: rows.filter(r => r.paymentType === "subscription_renewal").length,
    distinctSubscriptionsCount: distinctSubscriptions.size,
    orphanPaymentsCount: rows.filter(r => r.subscriptionStatus === "missing").length,
    reviewPaymentsCount: issues.length,
    issues,
    amountHalala: rows.reduce((sum, row) => sum + row.amountHalala, 0),
    ...methods,
    rows,
    period,
    inferredPaymentDatesCount: rows.filter(row => row.paidAtInferred).length,
  };
}

async function subscriptionPaymentsForDate(date) {
  const period = await getBusinessDayBounds(date);
  const payments = await Payment.find({
    type: { $in: ["subscription_activation", "subscription_renewal"] },
    status: { $in: ["paid", "refunded"] },
    $or: [
      { paidAt: { $gte: period.start, $lt: period.end } },
      { paidAt: null, createdAt: { $gte: period.start, $lt: period.end } },
    ],
  }).sort({ paidAt: 1, createdAt: 1, _id: 1 })
    .select("_id userId subscriptionId type status amount provider method source metadata providerPaymentId providerInvoiceId paidAt createdAt").lean();

  const ids = [...new Set(payments.map(p => p.subscriptionId && String(p.subscriptionId)).filter(Boolean))];
  const subscriptions = ids.length
    ? await Subscription.find({ _id: { $in: ids } }).select("_id status userId").lean()
    : [];
  const userIds = [...new Set([
    ...subscriptions.map(s => s.userId && String(s.userId)),
    ...payments.map(p => p.userId && String(p.userId)),
  ].filter(Boolean))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("_id name").lean()
    : [];
  const refunds = await PaymentRefund.find({
    status: "confirmed",
    refundedAt: { $gte: period.start, $lt: period.end },
  }).select("_id paymentId amountHalala refundedAt executionMode settlement.status settlement.settledAmountHalala").lean();
  const knownPayments = new Map(payments.map(p => [String(p._id), p]));
  const otherPaymentIds = [...new Set(refunds.map(r => String(r.paymentId)).filter(id => !knownPayments.has(id)))];
  const otherPayments = otherPaymentIds.length
    ? await Payment.find({ _id: { $in: otherPaymentIds } }).select("_id type").lean()
    : [];
  const refundPaymentTypes = new Map([
    ...payments.map(p => [String(p._id), String(p.type)]),
    ...otherPayments.map(p => [String(p._id), String(p.type)]),
  ]);
  const subscriptionRefunds = refunds.filter(r =>
    ["subscription_activation", "subscription_renewal"].includes(refundPaymentTypes.get(String(r.paymentId)))
  );
  const refundAmountHalala = subscriptionRefunds.reduce((sum, r) => sum + safeHalala(r.amountHalala), 0);
  const summary = buildPaidSubscriptionSummary(payments, subscriptions, users, {
    start: period.start, end: period.end, timezone: period.timezone,
  });
  return {
    ...summary,
    grossCollectionsHalala: summary.amountHalala,
    refundCount: subscriptionRefunds.length,
    refundsHalala: refundAmountHalala,
    accountingNetHalala: summary.amountHalala - refundAmountHalala,
    refunds: subscriptionRefunds.map(r => ({
      refundId: String(r._id),
      paymentId: String(r.paymentId),
      amountHalala: safeHalala(r.amountHalala),
      executionMode: r.executionMode || "unknown",
      settlementStatus: r.settlement?.status || "unknown",
    })),
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
    accountingRefundsHalala: safeHalala(automatic.refundsHalala),
    accountingNetSalesHalala: totalSalesHalala - safeHalala(automatic.refundsHalala),
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

function reconcileCountedWithServer(collections, serverExpected) {
  const cashHalala = safeHalala(collections.cashHalala);
  const cardHalala = safeHalala(collections.cardHalala);
  const cashDifferenceHalala = cashHalala - serverExpected.expected.cashHalalas;
  const networkDifferenceHalala = cardHalala - serverExpected.expected.networkHalalas;
  return {
    countedCashHalala: cashHalala,
    countedNetworkHalala: cardHalala,
    expectedCashHalala: serverExpected.expected.cashHalalas,
    expectedNetworkHalala: serverExpected.expected.networkHalalas,
    expectedAppReceivableHalala: serverExpected.expected.appReceivableHalalas,
    cashDifferenceHalala, networkDifferenceHalala,
    localDifferenceHalala: cashDifferenceHalala + networkDifferenceHalala,
  };
}


function posClosingError(message) {
  const error = new Error(message);
  error.status = 400; error.code = "MANUAL_CHANNEL_RECORDED_IN_POS";
  return error;
}
// Only external, non-POS channels may be entered manually. Each reference is unique.
function applyPosOtherReceivables(serverExpected, channels = {}) {
  const other = channels.other || [];
  const existing = new Set(["restaurant", "hungerstation", "keeta",
    ...Object.keys(serverExpected.pos?.appReceivableByChannelHalalas || {})].map(s => String(s).trim().toLowerCase()));
  const references = new Set();
  let manualHalalas = 0;
  for (const item of other) {
    const name = String(item.name || "").trim(), reference = String(item.reference || "").trim();
    if (!name || !reference || existing.has(name.toLowerCase()) ||
        references.has(reference.toLowerCase()) ||
        !Number.isSafeInteger(item.amountHalala) || item.amountHalala < 0) {
      throw posClosingError("القناة اليدوية يجب أن تكون خارج POS وبمرجع فريد");
    }
    references.add(reference.toLowerCase());
    manualHalalas += item.amountHalala;
    if (!Number.isSafeInteger(manualHalalas)) throw posClosingError("Invalid other channel total");
  }
  const app = serverExpected.expected.appReceivableHalalas + manualHalalas;
  const total = serverExpected.expected.totalHalalas + manualHalalas;
  if (![app, total].every(Number.isSafeInteger)) throw posClosingError("Invalid POS closing total");
  return {
    ...serverExpected,
    manualOther: other.map(item => ({ name: item.name, reference: item.reference, amountHalala: item.amountHalala })),
    expected: { ...serverExpected.expected, appReceivableHalalas: app, totalHalalas: total },
  };
}
function posClosingSummary(inputs, automatic, totals, reconciliation) {
  const { channels, collections, confirmedSubscriptionCount } = inputs;
  const difference = reconciliation.localDifferenceHalala;
  return {
    restaurantHalala: totals.pos.restaurantCashHalalas + totals.pos.restaurantNetworkHalalas,
    appReceivablesHalala: totals.expected.appReceivableHalalas,
    subscriptionHalala: automatic.amountHalala,
    accountingRefundsHalala: safeHalala(automatic.refundsHalala),
    accountingNetSalesHalala: totals.expected.totalHalalas - safeHalala(automatic.refundsHalala),
    totalSalesHalala: totals.expected.totalHalalas,
    localExpectedHalala: totals.expected.cashHalalas + totals.expected.networkHalalas,
    localRecordedHalala: collections.cashHalala + collections.cardHalala,
    cashHalala: collections.cashHalala, cardHalala: collections.cardHalala,
    moyasarHalala: safeHalala(automatic.moyasarHalala),
    unknownSubscriptionHalala: safeHalala(automatic.unknownHalala),
    localDifferenceHalala: difference, overallDifferenceHalala: difference,
    recordedPlusReceivablesHalala: totals.expected.totalHalalas + difference,
    subscriptionCountDifference: confirmedSubscriptionCount == null ? 0 : confirmedSubscriptionCount - automatic.count,
  };
}
const REASON_CODES = Object.freeze({
  CASH_DIFFERENCE: "CASH_DIFFERENCE",
  NETWORK_DIFFERENCE: "NETWORK_DIFFERENCE",
  SUBSCRIPTION_COUNT_DIFFERENCE: "SUBSCRIPTION_COUNT_DIFFERENCE",
  UNKNOWN_SUBSCRIPTION_HALALA: "UNKNOWN_SUBSCRIPTION_HALALA",
  SUBSCRIPTION_PAYMENTS_REVIEW: "SUBSCRIPTION_PAYMENTS_REVIEW",
  SUBSCRIPTION_REFUNDS: "SUBSCRIPTION_REFUNDS",
});
function reasonCodesFor(version, summary, automatic, reconciliation) {
  const codes = [];
  if (version === POS_V2) {
    if (reconciliation.cashDifferenceHalala !== 0) codes.push(REASON_CODES.CASH_DIFFERENCE);
    if (reconciliation.networkDifferenceHalala !== 0) codes.push(REASON_CODES.NETWORK_DIFFERENCE);
  } else if (summary.localDifferenceHalala !== 0 || summary.overallDifferenceHalala !== 0 ||
      reconciliation.localDifferenceHalala !== 0) codes.push("LEGACY_AMOUNT_DIFFERENCE");
  if (summary.subscriptionCountDifference !== 0) codes.push(REASON_CODES.SUBSCRIPTION_COUNT_DIFFERENCE);
  if (safeHalala(summary.unknownSubscriptionHalala) !== 0) codes.push(REASON_CODES.UNKNOWN_SUBSCRIPTION_HALALA);
  if ((automatic.reviewPaymentsCount || 0) > 0) codes.push(REASON_CODES.SUBSCRIPTION_PAYMENTS_REVIEW);
  if ((automatic.refundCount || 0) > 0 || (automatic.refundsHalala || 0) > 0) codes.push(REASON_CODES.SUBSCRIPTION_REFUNDS);
  return codes;
}
async function calculateForVersion(date, version, values, provided = {}) {
  const automatic = provided.automatic || await subscriptionPaymentsForDate(date);
  // Preserve previous LEGACY_V1 read representation and calculations.
  const raw = provided.expectedTotals || await expectedTotals(date);
  const totals = version === POS_V2 ? applyPosOtherReceivables(raw, values.channels) : raw;
  const reconciliation = reconcileCountedWithServer(values.collections, totals);
  const summary = version === POS_V2
    ? posClosingSummary(values, automatic, totals, reconciliation)
    : calculateClosing(values.channels, values.collections, automatic, values.confirmedSubscriptionCount);
  const reasonCodes = reasonCodesFor(version, summary, automatic, reconciliation);
  return { automatic, summary, expectedTotals: totals, reconciliation,
    requiresReason: reasonCodes.length > 0, reasonCodes };
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

async function buildClosingView(closing, date, viewerRole = null) {
  const version = await getClosingVersion(date, closing);
  const values = closing ? inputSnapshot(closing) : {
    channels: { restaurantHalala: 0, hungerstationHalala: 0, keetaHalala: 0, other: [] },
    collections: { cashHalala: 0, cardHalala: 0 },
    confirmedSubscriptionCount: null, discrepancyReason: "", notes: "",
  };
  const frozen = closing && closing.status !== "draft" && closing.snapshot ? closing.snapshot : null;
  const calculated = frozen ? {
    automatic: frozen.automatic, summary: frozen.summary,
    expectedTotals: frozen.expectedTotals, reconciliation: frozen.reconciliation,
    reasonCodes: frozen.reasonCodes || reasonCodesFor(version, frozen.summary, frozen.automatic, frozen.reconciliation),
    requiresReason: frozen.requiresReason ??
      (frozen.reasonCodes || reasonCodesFor(version, frozen.summary, frozen.automatic, frozen.reconciliation)).length > 0,
  } : await calculateForVersion(date, version, values);
  return {
    businessDate: date, currency: "SAR", moneyUnit: "halala",
    status: closing ? closing.status : "new",
    closingVersion: version, calculationMode: closing?.calculationMode || calculationMode(version),
    ...values, ...calculated,
    submittedAt: closing?.submittedAt || null,
    approvedAt: closing?.approvedAt || null,
    history: closing?.history || [],
    ...(["admin", "superadmin"].includes(viewerRole) ? { returnedSnapshots: closing?.returnedSnapshots || [] } : {}),
  };
}

module.exports = {
  safeHalala,
  paymentMethod,
  buildPaidSubscriptionSummary,
  subscriptionPaymentsForDate,
  calculateClosing,
  inputSnapshot,
  buildClosingView,
  expectedTotals,
  reconcileCountedWithServer,
  calculateForVersion, applyPosOtherReceivables, posClosingSummary, reasonCodesFor, REASON_CODES, POS_V2,
};
