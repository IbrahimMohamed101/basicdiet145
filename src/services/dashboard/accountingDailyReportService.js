"use strict";

const { addDays } = require("date-fns");
const { fromZonedTime } = require("date-fns-tz");
const ActivityLog = require("../../models/ActivityLog");
const DashboardUser = require("../../models/DashboardUser");
const Order = require("../../models/Order");
const Payment = require("../../models/Payment");
const Setting = require("../../models/Setting");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const dateUtils = require("../../utils/date");
const { normalizeHalala, normalizeStoredVatBreakdown } = require("../../utils/pricing");
const { VAT_PERCENTAGE } = require("../../config/vat");
const { buildSectionedCsv } = require("../../utils/csvExport");

const MANUAL_DEDUCTION_ACTION = "manual_subscription_meal_deduction";
const PAID_STATUS = "paid";
const CANCELED_STATUSES = new Set(["canceled"]);
const REFUNDED_PAYMENT_STATUS = "refunded";
const FULFILLED_STATUS = "fulfilled";
const CASH_METHODS = new Set(["cash", "cod", "cash_on_delivery"]);

class AccountingReportError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function normalizeCurrency(value) {
  return String(value || "SAR").trim().toUpperCase() || "SAR";
}

function normalizeFulfillmentFilter(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (!["pickup", "delivery", "all"].includes(normalized)) {
    throw new AccountingReportError("INVALID_FULFILLMENT_METHOD", "fulfillmentMethod must be pickup, delivery, or all", 400);
  }
  return normalized;
}

function parseIncludeDetails(value) {
  if (value === undefined || value === null || value === "") return true;
  return String(value).toLowerCase() === "true";
}

function assertBusinessDate(date) {
  if (!dateUtils.isValidKSADateString(date)) {
    throw new AccountingReportError("INVALID_DATE", "date must be a valid YYYY-MM-DD business date", 400);
  }
}

function parseTime(value, fallback) {
  const normalized = String(value || "").trim();
  return dateUtils.isValidTimeString(normalized) ? normalized : fallback;
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting && setting.value !== undefined ? setting.value : fallback;
}

async function resolveBusinessPeriod(businessDate) {
  assertBusinessDate(businessDate);
  const [openValue, closeValue] = await Promise.all([
    getSettingValue("restaurant_open_time", "00:00"),
    getSettingValue("restaurant_close_time", "23:59"),
  ]);
  const openTime = parseTime(openValue, "00:00");
  const closeTime = parseTime(closeValue, "23:59");
  const timezone = dateUtils.KSA_TIMEZONE;
  const start = fromZonedTime(`${businessDate}T${openTime}:00`, timezone);
  const openMinutes = dateUtils.toMinutes(openTime);
  const closeMinutes = dateUtils.toMinutes(closeTime);
  const closeDate = closeMinutes > openMinutes
    ? businessDate
    : dateUtils.addDaysToKSADateString(businessDate, 1);
  const closeInstant = fromZonedTime(`${closeDate}T${closeTime}:00`, timezone);
  const end = new Date(closeInstant.getTime() + 59999);

  if (openMinutes === closeMinutes) {
    const fullDayEnd = addDays(start, 1);
    fullDayEnd.setMilliseconds(fullDayEnd.getMilliseconds() - 1);
    return { businessDate, timezone, start, end: fullDayEnd, openTime, closeTime };
  }

  return { businessDate, timezone, start, end, openTime, closeTime };
}

function orderDisplayId(order) {
  return `ORD-${String(order && order._id ? order._id : "").slice(-6).toUpperCase()}`;
}

function normalizeOrderPricing(order, fallbackVatPercentage = 0) {
  const pricing = order && order.pricing && typeof order.pricing === "object" ? order.pricing : {};
  const totalOnlyValue = pricing.totalPrice !== undefined ? pricing.totalPrice : pricing.total;
  const totalOnlyHalala = normalizeHalala(totalOnlyValue);
  const hasMeaningfulStoredNet = normalizeHalala(pricing.basePrice) > 0 || normalizeHalala(pricing.subtotal) > 0;
  const hasMeaningfulStoredVat = normalizeHalala(pricing.vatAmount) > 0;
  if (
    totalOnlyHalala > 0
    && !hasMeaningfulStoredNet
    && !hasMeaningfulStoredVat
  ) {
    const totalHalala = totalOnlyHalala;
    const vatPercentage = Number(pricing.vatPercentage !== undefined ? pricing.vatPercentage : fallbackVatPercentage) || 0;
    // Accounting fallback for legacy total-only records: One-Time Order totals are VAT-inclusive.
    const vatHalala = Math.round(totalHalala * (vatPercentage / 100) / (1 + (vatPercentage / 100)));
    return {
      totalHalala,
      netHalala: totalHalala - vatHalala,
      vatHalala,
      vatRate: vatPercentage / 100,
      vatPercentage,
      currency: normalizeCurrency(pricing.currency || "SAR"),
    };
  }
  const normalized = normalizeStoredVatBreakdown({
    basePriceHalala: pricing.basePrice !== undefined ? pricing.basePrice : pricing.subtotal,
    vatPercentage: pricing.vatPercentage !== undefined ? pricing.vatPercentage : fallbackVatPercentage,
    vatHalala: pricing.vatAmount,
    totalPriceHalala: pricing.totalPrice !== undefined ? pricing.totalPrice : pricing.total,
  });
  return {
    totalHalala: normalized.totalHalala,
    netHalala: normalized.subtotalHalala,
    vatHalala: normalized.vatHalala,
    vatRate: Number(normalized.vatPercentage || 0) / 100,
    vatPercentage: Number(normalized.vatPercentage || 0),
    currency: normalizeCurrency(pricing.currency || "SAR"),
  };
}

function pushBucket(map, key, amount) {
  const normalizedKey = String(key || "unknown").trim() || "unknown";
  const current = map.get(normalizedKey) || { key: normalizedKey, count: 0, totalHalala: 0 };
  current.count += 1;
  current.totalHalala += normalizeHalala(amount);
  map.set(normalizedKey, current);
}

function bucketsToArray(map, keyName) {
  return Array.from(map.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => ({ [keyName]: row.key, count: row.count, totalHalala: row.totalHalala }));
}

function resolvePaymentMethod(order, payment) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const rawMethod = metadata.paymentMethod || metadata.method || metadata.source || metadata.brand || "";
  if (rawMethod) return String(rawMethod).trim().toLowerCase();
  if (payment && payment.provider) return String(payment.provider).trim().toLowerCase();
  if (order && order.providerPaymentId) return "moyasar";
  return "unknown";
}

function serializeOrderItem(order, user, payment, fallbackVatPercentage) {
  const pricing = normalizeOrderPricing(order, fallbackVatPercentage);
  return {
    orderId: String(order._id),
    orderNumber: orderDisplayId(order),
    createdAt: order.createdAt ? order.createdAt.toISOString() : null,
    updatedAt: order.updatedAt ? order.updatedAt.toISOString() : null,
    customerName: user ? user.name || "" : "",
    customerPhone: user ? user.phone || "" : "",
    status: order.status || "",
    paymentStatus: order.paymentStatus || "",
    fulfillmentMethod: order.deliveryMode === "pickup" ? "pickup" : "delivery",
    totalHalala: pricing.totalHalala,
    netHalala: pricing.netHalala,
    vatHalala: pricing.vatHalala,
    currency: pricing.currency,
    paymentMethod: resolvePaymentMethod(order, payment),
  };
}

function serializeDeduction(log, user, actor) {
  const meta = log.meta && typeof log.meta === "object" ? log.meta : {};
  const regularMeals = Number(meta.deductedRegularMeals || 0);
  const premiumMeals = Number(meta.deductedPremiumMeals || 0);
  return {
    activityLogId: String(log._id),
    subscriptionId: String(meta.subscriptionId || log.entityId || ""),
    customerId: String(meta.customerId || ""),
    customerName: user ? user.name || "" : "",
    customerPhone: user ? user.phone || "" : "",
    fulfillmentMethod: meta.fulfillmentMethod === "pickup" ? "pickup" : "delivery",
    businessDate: String(meta.businessDate || ""),
    regularMeals,
    premiumMeals,
    totalMeals: Number(meta.deductedTotalMeals || regularMeals + premiumMeals),
    before: {
      remainingRegularMeals: Number(meta.before && meta.before.remainingRegularMeals || 0),
      remainingPremiumMeals: Number(meta.before && meta.before.remainingPremiumMeals || 0),
      remainingMeals: Number(meta.before && meta.before.remainingMeals || 0),
    },
    after: {
      remainingRegularMeals: Number(meta.after && meta.after.remainingRegularMeals || 0),
      remainingPremiumMeals: Number(meta.after && meta.after.remainingPremiumMeals || 0),
      remainingMeals: Number(meta.after && meta.after.remainingMeals || 0),
    },
    actor: {
      id: actor ? String(actor._id) : String(log.byUserId || meta.actorId || ""),
      name: actor ? actor.email || "" : "",
      role: String(log.byRole || meta.actorRole || ""),
    },
    reason: String(meta.reason || ""),
    notes: String(meta.notes || ""),
    createdAt: log.createdAt ? log.createdAt.toISOString() : null,
  };
}

async function loadPaymentsByOrderId(orders) {
  const orderIds = orders.map((order) => order._id).filter(Boolean);
  const paymentIds = orders.map((order) => order.paymentId).filter(Boolean);
  const query = [];
  if (orderIds.length) query.push({ orderId: { $in: orderIds } });
  if (paymentIds.length) query.push({ _id: { $in: paymentIds } });
  if (!query.length) return new Map();

  const payments = await Payment.find({ $or: query })
    .select("_id orderId provider status amount currency metadata")
    .sort({ createdAt: -1 })
    .lean();
  const map = new Map();
  for (const payment of payments) {
    if (payment.orderId) map.set(String(payment.orderId), payment);
    map.set(String(payment._id), payment);
  }
  return map;
}

async function buildDailyReport({
  date,
  fulfillmentMethod = "all",
  includeDetails = true,
  actorId = null,
  actorRole = null,
} = {}) {
  const selectedFulfillment = normalizeFulfillmentFilter(fulfillmentMethod);
  const details = parseIncludeDetails(includeDetails);
  const period = await resolveBusinessPeriod(date);
  const fallbackVatPercentage = VAT_PERCENTAGE;

  const orderMatch = {
    createdAt: { $gte: period.start, $lte: period.end },
  };
  if (selectedFulfillment !== "all") {
    orderMatch.deliveryMode = selectedFulfillment;
  }

  const deductionMatch = {
    entityType: "subscription",
    action: MANUAL_DEDUCTION_ACTION,
    "meta.businessDate": period.businessDate,
  };
  if (selectedFulfillment !== "all") {
    deductionMatch["meta.fulfillmentMethod"] = selectedFulfillment;
  }

  const activeSubscriptionMatch = {
    status: "active",
    createdAt: { $lte: period.end },
    $or: [
      { validityEndDate: { $gte: period.start } },
      { endDate: { $gte: period.start } },
      { validityEndDate: null, endDate: null },
    ],
  };
  if (selectedFulfillment !== "all") {
    activeSubscriptionMatch.deliveryMode = selectedFulfillment;
  }

  const [orders, deductions, activeSubscriptionsToday] = await Promise.all([
    Order.find(orderMatch).sort({ createdAt: 1, _id: 1 }).lean(),
    ActivityLog.find(deductionMatch).sort({ createdAt: 1, _id: 1 }).lean(),
    Subscription.countDocuments(activeSubscriptionMatch),
  ]);

  const userIds = Array.from(new Set([
    ...orders.map((order) => String(order.userId || "")).filter(Boolean),
    ...deductions.map((log) => String(log.meta && log.meta.customerId || "")).filter(Boolean),
  ]));
  const actorIds = Array.from(new Set(deductions.map((log) => String(log.byUserId || "")).filter(Boolean)));
  const [users, actors, paymentMap] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select("_id name phone").lean() : [],
    actorIds.length ? DashboardUser.find({ _id: { $in: actorIds } }).select("_id email role").lean() : [],
    loadPaymentsByOrderId(orders),
  ]);
  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const actorMap = new Map(actors.map((actor) => [String(actor._id), actor]));

  const byStatus = new Map();
  const byFulfillment = new Map();
  const byPaymentStatus = new Map();
  const byPaymentMethod = new Map();
  let paidCount = 0;
  let fulfilledCount = 0;
  let cancelledCount = 0;
  let expiredCount = 0;
  let refundedCount = 0;
  let grossSalesHalala = 0;
  let netSalesHalala = 0;
  let vatHalala = 0;
  let cancelledOrdersTotalHalala = 0;
  let refundedTotalHalala = 0;
  let pickupCount = 0;
  let deliveryCount = 0;
  let ordersReadyForPickupCount = 0;
  let ordersPreparingCount = 0;
  let cashExpectedHalala = 0;
  let onlineExpectedHalala = 0;
  let unknownExpectedHalala = 0;
  let unknownPaymentMethodCount = 0;
  const warnings = [];

  const orderItems = orders.map((order) => {
    const payment = paymentMap.get(String(order._id)) || paymentMap.get(String(order.paymentId || ""));
    const item = serializeOrderItem(order, userMap.get(String(order.userId)), payment, fallbackVatPercentage);
    pushBucket(byStatus, item.status, item.totalHalala);
    pushBucket(byFulfillment, item.fulfillmentMethod, item.totalHalala);
    pushBucket(byPaymentStatus, item.paymentStatus, item.totalHalala);
    if (item.fulfillmentMethod === "pickup") pickupCount += 1;
    if (item.fulfillmentMethod === "delivery") deliveryCount += 1;
    if (item.status === FULFILLED_STATUS) fulfilledCount += 1;
    if (item.status === "ready_for_pickup") ordersReadyForPickupCount += 1;
    if (item.status === "preparing") ordersPreparingCount += 1;
    if (CANCELED_STATUSES.has(item.status)) {
      cancelledCount += 1;
      cancelledOrdersTotalHalala += item.totalHalala;
    }
    if (item.paymentStatus === "expired") expiredCount += 1;
    if (item.paymentStatus === REFUNDED_PAYMENT_STATUS) {
      refundedCount += 1;
      refundedTotalHalala += item.totalHalala;
    }
    if (item.paymentStatus === PAID_STATUS) {
      paidCount += 1;
      grossSalesHalala += item.totalHalala;
      netSalesHalala += item.netHalala;
      vatHalala += item.vatHalala;
      pushBucket(byPaymentMethod, item.paymentMethod, item.totalHalala);
      if (CASH_METHODS.has(item.paymentMethod)) cashExpectedHalala += item.totalHalala;
      else if (item.paymentMethod === "unknown") {
        unknownPaymentMethodCount += 1;
        unknownExpectedHalala += item.totalHalala;
      }
      else onlineExpectedHalala += item.totalHalala;
    }
    return item;
  });

  const manualDeductions = deductions.map((log) => serializeDeduction(
    log,
    userMap.get(String(log.meta && log.meta.customerId || "")),
    actorMap.get(String(log.byUserId || ""))
  ));
  const subscriptionSummary = manualDeductions.reduce((acc, row) => {
    acc.manualDeductionsCount += 1;
    acc.regularMealsDeducted += row.regularMeals;
    acc.premiumMealsDeducted += row.premiumMeals;
    acc.totalMealsDeducted += row.totalMeals;
    if (row.fulfillmentMethod === "pickup") acc.pickupDeductionsCount += 1;
    if (row.fulfillmentMethod === "delivery") acc.deliveryDeductionsCount += 1;
    return acc;
  }, {
    activeSubscriptionsToday,
    manualDeductionsCount: 0,
    regularMealsDeducted: 0,
    premiumMealsDeducted: 0,
    totalMealsDeducted: 0,
    pickupDeductionsCount: 0,
    deliveryDeductionsCount: 0,
  });

  const paidNotFulfilled = orderItems.filter((order) => order.paymentStatus === PAID_STATUS && order.status !== FULFILLED_STATUS);
  if (paidNotFulfilled.length) {
    warnings.push({
      code: "PAID_ORDER_NOT_FULFILLED",
      message: `${paidNotFulfilled.length} paid orders were not fulfilled by end of day`,
      count: paidNotFulfilled.length,
    });
  }
  const fulfilledMissingPayment = orderItems.filter((order) => order.status === FULFILLED_STATUS && order.paymentStatus !== PAID_STATUS);
  if (fulfilledMissingPayment.length) {
    warnings.push({
      code: "FULFILLED_ORDER_MISSING_PAYMENT",
      message: `${fulfilledMissingPayment.length} fulfilled orders are missing paid payment status`,
      count: fulfilledMissingPayment.length,
    });
  }
  const cancelledPaidNoRefund = orderItems.filter((order) => order.status === "canceled" && order.paymentStatus === PAID_STATUS);
  if (cancelledPaidNoRefund.length) {
    warnings.push({
      code: "CANCELLED_PAID_ORDER_NO_REFUND",
      message: `${cancelledPaidNoRefund.length} cancelled paid orders have no refund status`,
      count: cancelledPaidNoRefund.length,
    });
  }
  const noActor = manualDeductions.filter((row) => !row.actor.id);
  if (noActor.length) {
    warnings.push({
      code: "MANUAL_DEDUCTION_MISSING_ACTOR",
      message: `${noActor.length} manual deductions are missing actor metadata`,
      count: noActor.length,
    });
  }
  if (unknownPaymentMethodCount) {
    warnings.push({
      code: "UNKNOWN_PAYMENT_METHOD",
      message: `${unknownPaymentMethodCount} paid orders have an unknown payment method`,
      count: unknownPaymentMethodCount,
    });
  }

  const vatRate = fallbackVatPercentage / 100;
  const resolvedNetSalesHalala = Math.max(0, grossSalesHalala - vatHalala);
  return {
    businessDate: period.businessDate,
    timezone: period.timezone,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    summary: {
      grossSalesHalala,
      netSalesHalala: resolvedNetSalesHalala,
      vatHalala,
      currency: "SAR",
      paidOneTimeOrdersCount: paidCount,
      paidOneTimeOrdersTotalHalala: grossSalesHalala,
      cancelledOrdersCount: cancelledCount,
      cancelledOrdersTotalHalala,
      refundedOrdersCount: refundedCount,
      refundedTotalHalala,
      subscriptionDeductionsCount: subscriptionSummary.manualDeductionsCount,
      subscriptionMealsDeductedTotal: subscriptionSummary.totalMealsDeducted,
      subscriptionRegularMealsDeducted: subscriptionSummary.regularMealsDeducted,
      subscriptionPremiumMealsDeducted: subscriptionSummary.premiumMealsDeducted,
      pickupCount,
      deliveryCount,
      ordersFulfilledCount: fulfilledCount,
      ordersReadyForPickupCount,
      ordersPreparingCount,
    },
    money: {
      currency: "SAR",
      vatIncluded: true,
      vatRate,
      grossSalesHalala,
      netSalesHalala: resolvedNetSalesHalala,
      vatHalala,
      byPaymentStatus: bucketsToArray(byPaymentStatus, "paymentStatus"),
      byPaymentMethod: bucketsToArray(byPaymentMethod, "method"),
    },
    oneTimeOrders: {
      summary: {
        createdCount: orders.length,
        paidCount,
        fulfilledCount,
        cancelledCount,
        expiredCount,
        totalPaidHalala: grossSalesHalala,
        vatHalala,
        netHalala: resolvedNetSalesHalala,
      },
      byStatus: bucketsToArray(byStatus, "status"),
      byFulfillmentMethod: bucketsToArray(byFulfillment, "fulfillmentMethod"),
      items: details ? orderItems : [],
    },
    subscriptions: {
      summary: subscriptionSummary,
      manualDeductions: details ? manualDeductions : [],
    },
    operations: {
      kitchen: {
        preparedCount: ordersPreparingCount,
        readyForPickupCount: ordersReadyForPickupCount,
        fulfilledCount,
        cancelledCount,
      },
      pickup: {
        oneTimeOrdersFulfilled: orderItems.filter((order) => order.status === FULFILLED_STATUS && order.fulfillmentMethod === "pickup").length,
        subscriptionPickupDeductions: subscriptionSummary.pickupDeductionsCount,
      },
      delivery: {
        oneTimeOrdersFulfilled: orderItems.filter((order) => order.status === FULFILLED_STATUS && order.fulfillmentMethod === "delivery").length,
        subscriptionDeliveryDeductions: subscriptionSummary.deliveryDeductionsCount,
      },
    },
    reconciliation: {
      cashExpectedHalala,
      onlineExpectedHalala,
      unknownExpectedHalala,
      totalExpectedHalala: cashExpectedHalala + onlineExpectedHalala + unknownExpectedHalala,
      notes: [
        "Manual subscription deductions are meal-balance consumption events and not new payment collection unless linked to a payment.",
      ],
    },
    warnings,
    generatedAt: new Date().toISOString(),
    generatedBy: {
      id: actorId ? String(actorId) : "",
      role: actorRole ? String(actorRole) : "",
    },
  };
}

function reportToCsv(report) {
  const summaryRows = Object.entries(report.summary || {}).map(([key, value]) => [key, value]);
  const moneyRows = [
    ["currency", report.money.currency],
    ["vatIncluded", report.money.vatIncluded],
    ["vatRate", report.money.vatRate],
    ["grossSalesHalala", report.money.grossSalesHalala],
    ["netSalesHalala", report.money.netSalesHalala],
    ["vatHalala", report.money.vatHalala],
  ];
  const orderRows = (report.oneTimeOrders.items || []).map((order) => [
    order.orderId,
    order.orderNumber,
    order.createdAt,
    order.customerName,
    order.customerPhone,
    order.status,
    order.paymentStatus,
    order.fulfillmentMethod,
    order.totalHalala,
    order.netHalala,
    order.vatHalala,
    order.currency,
    order.paymentMethod,
  ]);
  const deductionRows = (report.subscriptions.manualDeductions || []).map((row) => [
    row.activityLogId,
    row.subscriptionId,
    row.customerId,
    row.customerName,
    row.customerPhone,
    row.fulfillmentMethod,
    row.businessDate,
    row.regularMeals,
    row.premiumMeals,
    row.totalMeals,
    row.actor.id,
    row.actor.name,
    row.actor.role,
    row.reason,
    row.notes,
    row.createdAt,
  ]);
  const warningRows = (report.warnings || []).map((row) => [row.code, row.message, row.count]);

  return buildSectionedCsv([
    {
      title: "Report",
      headers: ["field", "value"],
      rows: [
        ["businessDate", report.businessDate],
        ["timezone", report.timezone],
        ["periodStart", report.period.start],
        ["periodEnd", report.period.end],
        ["generatedAt", report.generatedAt],
      ],
    },
    { title: "Summary", headers: ["metric", "value"], rows: summaryRows },
    { title: "Money", headers: ["metric", "value"], rows: moneyRows },
    {
      title: "One-Time Orders",
      headers: ["orderId", "orderNumber", "createdAt", "customerName", "customerPhone", "status", "paymentStatus", "fulfillmentMethod", "totalHalala", "netHalala", "vatHalala", "currency", "paymentMethod"],
      rows: orderRows,
    },
    {
      title: "Manual Subscription Deductions",
      headers: ["activityLogId", "subscriptionId", "customerId", "customerName", "customerPhone", "fulfillmentMethod", "businessDate", "regularMeals", "premiumMeals", "totalMeals", "actorId", "actorName", "actorRole", "reason", "notes", "createdAt"],
      rows: deductionRows,
    },
    { title: "Warnings", headers: ["code", "message", "count"], rows: warningRows },
  ]);
}

module.exports = {
  AccountingReportError,
  buildDailyReport,
  reportToCsv,
  resolveBusinessPeriod,
};
