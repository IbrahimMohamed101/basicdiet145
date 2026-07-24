"use strict";

const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const accountingDailyReportService = require("./accountingDailyReportService");

function normalizeFulfillmentMethod(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (!["all", "pickup", "delivery"].includes(normalized)) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_FULFILLMENT_METHOD",
      "fulfillmentMethod must be pickup, delivery, or all",
      400
    );
  }
  return normalized;
}

function parseIncludeDetails(value) {
  if (value === undefined || value === null || value === "") return true;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new accountingDailyReportService.AccountingReportError(
    "INVALID_INCLUDE_DETAILS",
    "includeDetails must be true or false",
    400
  );
}

function normalizeRecordedPaymentMethod(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const raw = String(
    payment.method
      || metadata.paymentMethod
      || metadata.method
      || payment.provider
      || "unknown"
  ).trim().toLowerCase();
  if (raw === "cash" || raw === "cod" || raw === "cash_on_delivery") return "cash";
  if (["visa", "card", "credit_card", "credit-card", "mada", "manual"].includes(raw)) return "visa";
  return "unknown";
}

function buildPaymentMethodSummary(items = []) {
  const buckets = new Map();
  const allCustomers = new Set();
  let totalHalala = 0;

  for (const item of items) {
    const method = item.paymentMethod || "unknown";
    const customerId = String(item.customerId || "");
    const amountHalala = Number(item.amountHalala || 0);
    const bucket = buckets.get(method) || {
      method,
      count: 0,
      uniqueCustomersCount: 0,
      totalHalala: 0,
      customerIds: new Set(),
    };
    bucket.count += 1;
    bucket.totalHalala += amountHalala;
    if (customerId) {
      bucket.customerIds.add(customerId);
      allCustomers.add(customerId);
    }
    buckets.set(method, bucket);
    totalHalala += amountHalala;
  }

  const byPaymentMethod = Array.from(buckets.values())
    .map((bucket) => ({
      method: bucket.method,
      count: bucket.count,
      uniqueCustomersCount: bucket.customerIds.size,
      totalHalala: bucket.totalHalala,
    }))
    .sort((left, right) => left.method.localeCompare(right.method));
  const byMethod = new Map(byPaymentMethod.map((row) => [row.method, row]));
  const cash = byMethod.get("cash") || { count: 0, uniqueCustomersCount: 0, totalHalala: 0 };
  const visa = byMethod.get("visa") || { count: 0, uniqueCustomersCount: 0, totalHalala: 0 };
  const unknown = byMethod.get("unknown") || { count: 0, uniqueCustomersCount: 0, totalHalala: 0 };

  return {
    totalPaymentsCount: items.length,
    uniqueCustomersCount: allCustomers.size,
    totalHalala,
    cashCount: cash.count,
    cashCustomersCount: cash.uniqueCustomersCount,
    cashTotalHalala: cash.totalHalala,
    visaCount: visa.count,
    visaCustomersCount: visa.uniqueCustomersCount,
    visaTotalHalala: visa.totalHalala,
    unknownCount: unknown.count,
    unknownCustomersCount: unknown.uniqueCustomersCount,
    unknownTotalHalala: unknown.totalHalala,
    byPaymentMethod,
  };
}

async function buildDailySubscriptionPaymentReport({
  date,
  fulfillmentMethod = "all",
  includeDetails = true,
} = {}) {
  const selectedFulfillment = normalizeFulfillmentMethod(fulfillmentMethod);
  const details = parseIncludeDetails(includeDetails);
  const period = await accountingDailyReportService.resolveBusinessPeriod(date);

  const payments = await Payment.find({
    type: "subscription_activation",
    status: "paid",
    $or: [
      { paidAt: { $gte: period.start, $lte: period.end } },
      { paidAt: null, createdAt: { $gte: period.start, $lte: period.end } },
    ],
  }).sort({ paidAt: 1, createdAt: 1, _id: 1 }).lean();

  const subscriptionIds = Array.from(new Set(payments.map((row) => String(row.subscriptionId || "")).filter(Boolean)));
  const subscriptions = subscriptionIds.length
    ? await Subscription.find({ _id: { $in: subscriptionIds } })
      .select("_id userId planId deliveryMode status totalPriceHalala checkoutCurrency")
      .lean()
    : [];
  const subscriptionMap = new Map(subscriptions.map((row) => [String(row._id), row]));

  const filteredPayments = payments.filter((payment) => {
    const subscription = subscriptionMap.get(String(payment.subscriptionId || ""));
    if (!subscription) return false;
    if (selectedFulfillment === "all") return true;
    return String(subscription.deliveryMode || "") === selectedFulfillment;
  });

  const userIds = Array.from(new Set(filteredPayments.map((payment) => {
    const subscription = subscriptionMap.get(String(payment.subscriptionId || ""));
    return String(payment.userId || subscription && subscription.userId || "");
  }).filter(Boolean)));
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("_id name phone").lean()
    : [];
  const userMap = new Map(users.map((row) => [String(row._id), row]));

  const items = filteredPayments.map((payment) => {
    const subscription = subscriptionMap.get(String(payment.subscriptionId || ""));
    const customerId = String(payment.userId || subscription && subscription.userId || "");
    const user = userMap.get(customerId);
    return {
      paymentId: String(payment._id),
      subscriptionId: String(payment.subscriptionId || ""),
      customerId,
      customerName: user ? String(user.name || "") : "",
      customerPhone: user ? String(user.phone || "") : "",
      paymentMethod: normalizeRecordedPaymentMethod(payment),
      provider: String(payment.provider || ""),
      status: String(payment.status || ""),
      amountHalala: Number(payment.amount || 0),
      currency: String(payment.currency || "SAR").toUpperCase(),
      fulfillmentMethod: String(subscription && subscription.deliveryMode || ""),
      subscriptionStatus: String(subscription && subscription.status || ""),
      gatewayUsed: Boolean(payment.metadata && payment.metadata.gatewayUsed),
      recordingMode: String(payment.metadata && payment.metadata.recordingMode || ""),
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
      createdAt: payment.createdAt ? new Date(payment.createdAt).toISOString() : null,
    };
  });
  const summary = buildPaymentMethodSummary(items);

  return {
    businessDate: period.businessDate,
    timezone: period.timezone,
    currency: "SAR",
    moneyUnit: "halala",
    filters: {
      date: period.businessDate,
      fulfillmentMethod: selectedFulfillment,
      includeDetails: details,
    },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    summary,
    byPaymentMethod: summary.byPaymentMethod,
    items: details ? items : [],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildDailySubscriptionPaymentReport,
  buildPaymentMethodSummary,
  normalizeRecordedPaymentMethod,
};
