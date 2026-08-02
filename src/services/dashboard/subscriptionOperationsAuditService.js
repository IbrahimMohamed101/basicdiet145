"use strict";

const { fromZonedTime } = require("date-fns-tz");

const ActivityLog = require("../../models/ActivityLog");
const Delivery = require("../../models/Delivery");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const dateUtils = require("../../utils/date");
const { MANUAL_DEDUCTION_ACTION } = require("./manualDeduction/constants");

const MAX_RANGE_DAYS = 31;
const DAY_TERMINAL_CONSUMED_STATUSES = new Set([
  "fulfilled",
  "consumed_without_preparation",
]);
const NON_CONSUMING_DAY_STATUSES = new Set([
  "skipped",
  "frozen",
]);

class SubscriptionOperationsAuditError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "SubscriptionOperationsAuditError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function id(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function localName(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (value && typeof value === "object") {
    return String(value.ar || value.en || fallback || "").trim();
  }
  return fallback;
}

function rangeDayCount(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function resolveRange({ from, to, now = new Date() } = {}) {
  const today = dateUtils.getTodayKSADate(now);
  const resolvedTo = String(to || today).trim();
  const resolvedFrom = String(from || dateUtils.addDaysToKSADateString(resolvedTo, -2)).trim();

  if (!dateUtils.isValidKSADateString(resolvedFrom) || !dateUtils.isValidKSADateString(resolvedTo)) {
    throw new SubscriptionOperationsAuditError(
      "INVALID_DATE_RANGE",
      "from and to must use YYYY-MM-DD",
      400
    );
  }
  if (resolvedFrom > resolvedTo) {
    throw new SubscriptionOperationsAuditError(
      "INVALID_DATE_RANGE",
      "from must be before or equal to to",
      400
    );
  }

  const days = rangeDayCount(resolvedFrom, resolvedTo);
  if (days > MAX_RANGE_DAYS) {
    throw new SubscriptionOperationsAuditError(
      "DATE_RANGE_TOO_LARGE",
      `Audit range must not exceed ${MAX_RANGE_DAYS} days`,
      400,
      { maxDays: MAX_RANGE_DAYS }
    );
  }

  const endExclusiveDate = dateUtils.addDaysToKSADateString(resolvedTo, 1);
  return {
    from: resolvedFrom,
    to: resolvedTo,
    days,
    today,
    timezone: dateUtils.KSA_TIMEZONE,
    startAt: fromZonedTime(`${resolvedFrom}T00:00:00`, dateUtils.KSA_TIMEZONE),
    endExclusiveAt: fromZonedTime(`${endExclusiveDate}T00:00:00`, dateUtils.KSA_TIMEZONE),
  };
}

function enumerateDates(from, to) {
  const rows = [];
  let cursor = from;
  while (cursor <= to) {
    rows.push(cursor);
    cursor = dateUtils.addDaysToKSADateString(cursor, 1);
  }
  return rows;
}

function dateWindow(subscription) {
  return {
    start: subscription && subscription.startDate
      ? dateUtils.toKSADateString(subscription.startDate)
      : null,
    end: subscription && subscription.endDate
      ? dateUtils.toKSADateString(subscription.endDate)
      : null,
  };
}

function overlapsDateRange(subscription, range) {
  const window = dateWindow(subscription);
  if (!window.start || !window.end) return false;
  return window.start <= range.to && window.end >= range.from;
}

function expectedDatesForSubscription(subscription, range) {
  const window = dateWindow(subscription);
  if (!window.start || !window.end) return [];
  const from = window.start > range.from ? window.start : range.from;
  const to = window.end < range.to ? window.end : range.to;
  return from <= to ? enumerateDates(from, to) : [];
}

function issue(code, severity, message, context = {}) {
  return { code, severity, message, ...context };
}

function classifyAcquisitionSource(subscription, payments = []) {
  const contractSource = String(subscription && subscription.contractSource || "").trim();
  const activationPayment = payments.find((payment) =>
    ["subscription_activation", "subscription_renewal"].includes(String(payment.type || ""))
    && String(payment.status || "") === "paid"
  ) || payments.find((payment) =>
    ["subscription_activation", "subscription_renewal"].includes(String(payment.type || ""))
  ) || null;
  const paymentSource = String(activationPayment && activationPayment.source || "").trim().toLowerCase();
  const provider = String(activationPayment && activationPayment.provider || "").trim().toLowerCase();

  let code = "unknown";
  if (contractSource === "admin_create" || paymentSource.startsWith("dashboard_subscription_")) {
    code = "branch";
  } else if (contractSource === "customer_checkout" || provider === "moyasar") {
    code = "app";
  } else if (contractSource === "renewal") {
    code = paymentSource.startsWith("dashboard_subscription_") ? "branch" : "app";
  }

  return {
    code,
    labelAr: code === "branch" ? "من الفرع" : code === "app" ? "من التطبيق" : "غير محدد",
    contractSource: contractSource || null,
    payment: activationPayment ? {
      id: id(activationPayment._id),
      provider: activationPayment.provider || null,
      method: activationPayment.method || activationPayment.metadata?.paymentMethod || null,
      source: activationPayment.source || null,
      status: activationPayment.status || null,
      amountHalala: nonNegativeInteger(activationPayment.amount),
      paidAt: activationPayment.paidAt || null,
      createdAt: activationPayment.createdAt || null,
    } : null,
  };
}

function subscriptionCustomer(subscription) {
  const user = subscription && subscription.userId && typeof subscription.userId === "object"
    ? subscription.userId
    : {};
  return {
    id: id(user._id || subscription.userId),
    name: String(user.name || "").trim() || "غير مسجل",
    phone: String(user.phoneE164 || user.phone || "").trim(),
    email: String(user.email || "").trim() || null,
  };
}

function subscriptionPlan(subscription) {
  const plan = subscription && subscription.planId && typeof subscription.planId === "object"
    ? subscription.planId
    : {};
  return {
    id: id(plan._id || subscription.planId),
    name: localName(plan.name, "باقة غير محددة"),
    daysCount: nonNegativeInteger(plan.daysCount),
    mealsPerDay: nonNegativeInteger(subscription.selectedMealsPerDay || plan.mealsPerDay),
  };
}

function completeMealCount(day) {
  const slots = Array.isArray(day && day.mealSlots) ? day.mealSlots : [];
  const complete = slots.filter((slot) => slot && slot.status === "complete").length;
  if (complete > 0) return complete;
  const plannerCount = nonNegativeInteger(day && day.plannerMeta && day.plannerMeta.completeSlotCount);
  if (plannerCount > 0) return plannerCount;
  return slots.length;
}

function expectedMealCount(subscription, day) {
  const dayRequired = nonNegativeInteger(
    day && day.plannerMeta && day.plannerMeta.requiredSlotCount
      || day && day.planningMeta && day.planningMeta.requiredMealCount
      || day && day.lockedSnapshot && day.lockedSnapshot.mealsPerDay
  );
  return dayRequired || nonNegativeInteger(subscription.selectedMealsPerDay || subscription.planId?.mealsPerDay);
}

function allocationCounters(allocations = []) {
  const result = { reserved: 0, consumed: 0, released: 0, forfeited: 0, total: 0 };
  const keys = new Set();
  let duplicateKeys = 0;
  for (const allocation of Array.isArray(allocations) ? allocations : []) {
    const key = String(allocation && allocation.allocationKey || "").trim();
    if (key) {
      if (keys.has(key)) duplicateKeys += 1;
      keys.add(key);
    }
    const quantity = nonNegativeInteger(allocation && allocation.quantity) || 1;
    const state = String(allocation && allocation.state || "");
    if (Object.prototype.hasOwnProperty.call(result, state)) result[state] += quantity;
    result.total += quantity;
  }
  return { ...result, duplicateKeys };
}

function manualDeductionRow(log) {
  const meta = log && log.meta && typeof log.meta === "object" ? log.meta : {};
  const date = String(meta.businessDate || "").trim()
    || (log && log.createdAt ? dateUtils.toKSADateString(log.createdAt) : "");
  return {
    id: id(log && log._id),
    date,
    totalMeals: nonNegativeInteger(meta.deductedTotalMeals),
    regularMeals: nonNegativeInteger(meta.deductedRegularMeals),
    premiumMeals: nonNegativeInteger(meta.deductedPremiumMeals),
    reason: String(meta.reason || "").trim() || null,
    notes: String(meta.notes || "").trim() || null,
    actorId: id(log && log.byUserId),
    actorRole: String(log && log.byRole || "").trim() || null,
    before: meta.before || null,
    after: meta.after || null,
    createdAt: log && log.createdAt || null,
  };
}

function balanceSummary(subscription, allManualDeductions = []) {
  const totalMeals = nonNegativeInteger(subscription.totalMeals);
  const availableMeals = nonNegativeInteger(subscription.remainingMeals);
  const reservedMeals = nonNegativeInteger(subscription.reservedMeals);
  const consumedMeals = nonNegativeInteger(subscription.consumedMeals);
  const forfeitedMeals = nonNegativeInteger(subscription.forfeitedMeals);
  const entitlementVersion = nonNegativeInteger(subscription.entitlementVersion);
  const allocations = allocationCounters(subscription.baseMealAllocations || []);
  const manualConsumedMeals = allManualDeductions.reduce(
    (sum, row) => sum + nonNegativeInteger(row.totalMeals),
    0
  );
  const accountedMeals = availableMeals + reservedMeals + consumedMeals + forfeitedMeals;
  const equationDifference = totalMeals - accountedMeals;
  const aggregateOnlyConsumedMeals = Math.max(0, consumedMeals - allocations.consumed);
  const unattributedAggregateConsumption = Math.max(0, aggregateOnlyConsumedMeals - manualConsumedMeals);

  return {
    entitlementVersion,
    totalMeals,
    availableMeals,
    displayedUnconsumedMeals: availableMeals + reservedMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    accountedMeals,
    equationDifference,
    balanced: entitlementVersion < 2 || equationDifference === 0,
    allocations,
    manualConsumedMeals,
    aggregateOnlyConsumedMeals,
    unattributedAggregateConsumption,
  };
}

function buildDayAudit({
  subscription,
  date,
  day,
  delivery,
  pickupRequests,
  allocations,
  manualDeductions,
  range,
}) {
  const fulfillmentMethod = String(subscription.deliveryMode || "");
  const expectedMeals = expectedMealCount(subscription, day);
  const selectedMeals = completeMealCount(day);
  const allocation = allocationCounters(allocations);
  const manualMeals = manualDeductions.reduce((sum, row) => sum + row.totalMeals, 0);
  const manualCount = manualDeductions.length;
  const pickupFulfilled = pickupRequests.some((request) => request.status === "fulfilled");
  const deliveryDelivered = Boolean(delivery && delivery.status === "delivered");
  const dayConsumed = DAY_TERMINAL_CONSUMED_STATUSES.has(String(day && day.status || ""));
  const fulfilled = fulfillmentMethod === "delivery"
    ? deliveryDelivered || dayConsumed
    : pickupFulfilled || dayConsumed;
  const nonConsuming = NON_CONSUMING_DAY_STATUSES.has(String(day && day.status || ""));
  const isPast = date < range.today;
  const isToday = date === range.today;
  const issues = [];

  if (allocation.duplicateKeys > 0) {
    issues.push(issue(
      "DUPLICATE_ALLOCATION_KEY",
      "critical",
      "يوجد مفتاح حجز وجبة مكرر في سجل الاستحقاق.",
      { duplicateCount: allocation.duplicateKeys }
    ));
  }

  if (manualCount > 1) {
    issues.push(issue(
      "MULTIPLE_MANUAL_DEDUCTIONS_SAME_DAY",
      "critical",
      "تم تسجيل أكثر من خصم يدوي لنفس الاشتراك في نفس اليوم.",
      { manualCount, manualMeals }
    ));
  }

  if (manualMeals > 0 && (allocation.reserved + allocation.consumed + allocation.forfeited) > 0) {
    issues.push(issue(
      "MANUAL_AND_LEDGER_DEDUCTION_SAME_DAY",
      "critical",
      "يوجد خصم يدوي مع حجز أو استهلاك تلقائي لنفس اليوم؛ هذه أقوى علامة على الخصم المزدوج.",
      {
        manualMeals,
        reservedMeals: allocation.reserved,
        consumedMeals: allocation.consumed,
        forfeitedMeals: allocation.forfeited,
      }
    ));
  }

  if (fulfillmentMethod === "delivery" && manualMeals > 0) {
    issues.push(issue(
      "DELIVERY_MANUAL_DEDUCTION_REQUIRES_REVIEW",
      fulfilled ? "critical" : "high",
      fulfilled
        ? "تم خصم وجبات يدويًا في يوم توصيل تم تنفيذه أو إغلاقه كمستهلك."
        : "تم خصم وجبات يدويًا لاشتراك توصيل؛ يجب التأكد أن دورة التوصيل لن تخصمها مرة أخرى.",
      { manualMeals, fulfilled }
    ));
  }

  if (fulfilled && allocation.consumed === 0 && manualMeals === 0) {
    issues.push(issue(
      "FULFILLED_WITHOUT_RECORDED_CONSUMPTION",
      "critical",
      "اليوم منفذ لكن لا يوجد استهلاك تلقائي أو خصم يدوي مسجل.",
      { expectedMeals }
    ));
  }

  if (fulfilled && allocation.reserved > 0) {
    issues.push(issue(
      "FULFILLED_MEALS_STILL_RESERVED",
      "critical",
      "اليوم منفذ لكن بعض الوجبات ما زالت في حالة محجوز بدل مستهلك.",
      { reservedMeals: allocation.reserved }
    ));
  }

  if (!fulfilled && allocation.consumed > 0 && !nonConsuming) {
    issues.push(issue(
      "CONSUMED_WITHOUT_FULFILLMENT",
      "critical",
      "تم استهلاك وجبات بدون وجود تنفيذ توصيل أو استلام مكتمل.",
      { consumedMeals: allocation.consumed }
    ));
  }

  if (fulfilled && expectedMeals > 0 && allocation.consumed + manualMeals > expectedMeals) {
    issues.push(issue(
      "DAY_DEDUCTION_EXCEEDS_EXPECTED",
      "critical",
      "إجمالي خصم اليوم أكبر من عدد الوجبات المتوقع.",
      {
        expectedMeals,
        automaticConsumedMeals: allocation.consumed,
        manualMeals,
        deductedMeals: allocation.consumed + manualMeals,
      }
    ));
  }

  if (fulfilledMethodIsDelivery(fulfillmentMethod) && deliveryDelivered && day && day.status !== "fulfilled") {
    issues.push(issue(
      "DELIVERY_AND_DAY_STATUS_MISMATCH",
      "high",
      "سجل التوصيل Delivered لكن حالة يوم الاشتراك ليست Fulfilled.",
      { dayStatus: day.status, deliveryStatus: delivery.status }
    ));
  }

  if (isPast && !nonConsuming && fulfillmentMethod === "delivery" && !fulfilled && !manualMeals) {
    issues.push(issue(
      "PAST_DELIVERY_DAY_UNSETTLED",
      "high",
      "يوم توصيل سابق لم يصل لحالة تنفيذ أو استهلاك نهائية.",
      {
        dayStatus: day && day.status || null,
        deliveryStatus: delivery && delivery.status || null,
      }
    ));
  }

  if (isPast && !nonConsuming && selectedMeals === 0 && fulfillmentMethod === "delivery") {
    issues.push(issue(
      "PAST_DELIVERY_DAY_WITHOUT_SELECTION",
      "medium",
      "يوم توصيل سابق بدون اختيارات وجبات مكتملة.",
      { expectedMeals }
    ));
  }

  return {
    date,
    dateState: isPast ? "past" : isToday ? "today" : "future",
    fulfillmentMethod,
    expectedMeals,
    selectedMeals,
    day: day ? {
      id: id(day._id),
      status: day.status || null,
      plannerState: day.plannerState || day.planningState || null,
      createdAt: day.createdAt || null,
      updatedAt: day.updatedAt || null,
    } : null,
    delivery: delivery ? {
      id: id(delivery._id),
      status: delivery.status || null,
      deliveredAt: delivery.deliveredAt || null,
      canceledAt: delivery.canceledAt || null,
    } : null,
    pickupRequests: pickupRequests.map((request) => ({
      id: id(request._id),
      status: request.status || null,
      mealCount: nonNegativeInteger(request.mealCount),
      reservationState: request.reservationState || null,
      creditsReserved: Boolean(request.creditsReserved),
      creditsConsumedAt: request.creditsConsumedAt || null,
      fulfilledAt: request.fulfilledAt || null,
    })),
    allocation,
    manualDeduction: {
      count: manualCount,
      totalMeals: manualMeals,
      records: manualDeductions,
    },
    fulfilled,
    nonConsuming,
    deductedMealsObserved: allocation.consumed + manualMeals,
    issues,
    risk: issues.some((row) => row.severity === "critical")
      ? "critical"
      : issues.some((row) => row.severity === "high")
        ? "high"
        : issues.some((row) => row.severity === "medium")
          ? "medium"
          : "ok",
  };
}

function fulfilledMethodIsDelivery(value) {
  return String(value || "") === "delivery";
}

function riskRank(value) {
  return { critical: 4, high: 3, medium: 2, low: 1, ok: 0 }[value] || 0;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function summarizeIssues(subscriptionRows) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const byCode = {};
  for (const subscription of subscriptionRows) {
    for (const row of subscription.issues || []) {
      counts.total += 1;
      if (Object.prototype.hasOwnProperty.call(counts, row.severity)) counts[row.severity] += 1;
      byCode[row.code] = (byCode[row.code] || 0) + 1;
    }
    for (const day of subscription.days || []) {
      for (const row of day.issues || []) {
        counts.total += 1;
        if (Object.prototype.hasOwnProperty.call(counts, row.severity)) counts[row.severity] += 1;
        byCode[row.code] = (byCode[row.code] || 0) + 1;
      }
    }
  }
  return { counts, byCode };
}

async function buildSubscriptionOperationsAudit({ from, to, includeDetails = true, now = new Date() } = {}) {
  const range = resolveRange({ from, to, now });
  const createdAtFilter = { $gte: range.startAt, $lt: range.endExclusiveAt };
  const dateFilter = { $gte: range.from, $lte: range.to };
  const allocationTimeFilter = { $gte: range.startAt, $lt: range.endExclusiveAt };

  const [
    newSubscriptionIds,
    deliverySubscriptionIds,
    days,
    deliveries,
    pickupRequests,
    manualLogsInRange,
    allocationSubscriptionIds,
  ] = await Promise.all([
    Subscription.distinct("_id", { createdAt: createdAtFilter }),
    Subscription.distinct("_id", {
      deliveryMode: "delivery",
      status: "active",
      startDate: { $lt: range.endExclusiveAt },
      endDate: { $gte: range.startAt },
    }),
    SubscriptionDay.find({ date: dateFilter }).lean(),
    Delivery.find({ subscriptionId: { $type: "objectId" }, date: dateFilter }).lean(),
    SubscriptionPickupRequest.find({ date: dateFilter }).lean(),
    ActivityLog.find({
      entityType: "subscription",
      action: MANUAL_DEDUCTION_ACTION,
      $or: [
        { "meta.businessDate": dateFilter },
        { createdAt: createdAtFilter },
      ],
    }).lean(),
    Subscription.distinct("_id", {
      $or: [
        { "baseMealAllocations.date": dateFilter },
        { "baseMealAllocations.reservedAt": allocationTimeFilter },
        { "baseMealAllocations.consumedAt": allocationTimeFilter },
        { "baseMealAllocations.releasedAt": allocationTimeFilter },
        { "baseMealAllocations.forfeitedAt": allocationTimeFilter },
      ],
    }),
  ]);

  const subscriptionIds = new Set([
    ...newSubscriptionIds.map(id),
    ...deliverySubscriptionIds.map(id),
    ...allocationSubscriptionIds.map(id),
    ...days.map((row) => id(row.subscriptionId)),
    ...deliveries.map((row) => id(row.subscriptionId)),
    ...pickupRequests.map((row) => id(row.subscriptionId)),
    ...manualLogsInRange.map((row) => id(row.entityId)),
  ].filter(Boolean));

  if (subscriptionIds.size === 0) {
    return {
      reportType: "subscription_operations_audit",
      generatedAt: new Date(),
      range: { from: range.from, to: range.to, days: range.days, timezone: range.timezone },
      summary: {
        newSubscriptions: { total: 0, pickup: 0, delivery: 0, matrix: {} },
        operations: { reviewedSubscriptions: 0, reviewedDays: 0 },
        issues: { counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, byCode: {} },
      },
      newSubscriptions: [],
      subscriptionAudits: [],
    };
  }

  const objectIds = [...subscriptionIds];
  const [subscriptions, payments, allManualLogs] = await Promise.all([
    Subscription.find({ _id: { $in: objectIds } })
      .populate("userId", "name phone phoneE164 email")
      .populate("planId", "name daysCount mealsPerDay")
      .lean(),
    Payment.find({
      subscriptionId: { $in: objectIds },
      type: { $in: ["subscription_activation", "subscription_renewal"] },
    }).sort({ paidAt: 1, createdAt: 1 }).lean(),
    ActivityLog.find({
      entityType: "subscription",
      entityId: { $in: objectIds },
      action: MANUAL_DEDUCTION_ACTION,
    }).sort({ createdAt: 1 }).lean(),
  ]);

  const paymentsBySubscription = groupBy(payments, (row) => id(row.subscriptionId));
  const daysBySubscription = groupBy(days, (row) => id(row.subscriptionId));
  const deliveriesBySubscription = groupBy(deliveries, (row) => id(row.subscriptionId));
  const pickupBySubscription = groupBy(pickupRequests, (row) => id(row.subscriptionId));
  const allManualBySubscription = groupBy(
    allManualLogs.map(manualDeductionRow),
    (row) => {
      const original = allManualLogs.find((log) => id(log._id) === row.id);
      return id(original && original.entityId);
    }
  );
  const manualInRangeIds = new Set(manualLogsInRange.map((row) => id(row._id)));
  const newSubscriptionIdSet = new Set(newSubscriptionIds.map(id));

  const subscriptionAudits = [];
  const newSubscriptions = [];

  for (const subscription of subscriptions) {
    const subscriptionId = id(subscription._id);
    const source = classifyAcquisitionSource(
      subscription,
      paymentsBySubscription.get(subscriptionId) || []
    );
    const customer = subscriptionCustomer(subscription);
    const plan = subscriptionPlan(subscription);
    const fulfillmentMethod = String(subscription.deliveryMode || "unknown");
    const allManualRows = allManualBySubscription.get(subscriptionId) || [];
    const rangeManualRows = allManualRows.filter((row) =>
      manualInRangeIds.has(row.id) || (row.date >= range.from && row.date <= range.to)
    );
    const balance = balanceSummary(subscription, allManualRows);
    const subscriptionIssues = [];

    if (!balance.balanced) {
      subscriptionIssues.push(issue(
        "SUBSCRIPTION_BALANCE_EQUATION_MISMATCH",
        "critical",
        "معادلة رصيد الاشتراك غير متوازنة.",
        { equationDifference: balance.equationDifference }
      ));
    }
    if (balance.unattributedAggregateConsumption > 0) {
      subscriptionIssues.push(issue(
        "UNATTRIBUTED_AGGREGATE_CONSUMPTION",
        "high",
        "يوجد استهلاك مجمع لا يفسره سجل الاستحقاقات أو الخصومات اليدوية.",
        { meals: balance.unattributedAggregateConsumption }
      ));
    }
    if (balance.allocations.duplicateKeys > 0) {
      subscriptionIssues.push(issue(
        "DUPLICATE_ALLOCATION_KEY",
        "critical",
        "الاشتراك يحتوي على مفاتيح استحقاق وجبات مكررة.",
        { duplicateCount: balance.allocations.duplicateKeys }
      ));
    }

    const subscriptionDays = daysBySubscription.get(subscriptionId) || [];
    const subscriptionDeliveries = deliveriesBySubscription.get(subscriptionId) || [];
    const subscriptionPickups = pickupBySubscription.get(subscriptionId) || [];
    const dayByDate = new Map(subscriptionDays.map((row) => [String(row.date), row]));
    const deliveryByDate = new Map(subscriptionDeliveries.map((row) => [String(row.date), row]));
    const pickupByDate = groupBy(subscriptionPickups, (row) => String(row.date));
    const allocationsByDate = groupBy(
      (subscription.baseMealAllocations || []).filter((row) =>
        String(row && row.date || "") >= range.from && String(row && row.date || "") <= range.to
      ),
      (row) => String(row.date)
    );
    const manualByDate = groupBy(rangeManualRows, (row) => row.date);

    const activityDates = new Set([
      ...subscriptionDays.map((row) => String(row.date)),
      ...subscriptionDeliveries.map((row) => String(row.date)),
      ...subscriptionPickups.map((row) => String(row.date)),
      ...rangeManualRows.map((row) => row.date),
      ...[...allocationsByDate.keys()],
    ].filter((date) => date >= range.from && date <= range.to));

    if (fulfillmentMethod === "delivery" && overlapsDateRange(subscription, range)) {
      for (const date of expectedDatesForSubscription(subscription, range)) activityDates.add(date);
    }

    const dayAudits = [...activityDates]
      .sort()
      .map((date) => buildDayAudit({
        subscription,
        date,
        day: dayByDate.get(date) || null,
        delivery: deliveryByDate.get(date) || null,
        pickupRequests: pickupByDate.get(date) || [],
        allocations: allocationsByDate.get(date) || [],
        manualDeductions: manualByDate.get(date) || [],
        range,
      }));

    const rowRisk = [
      ...subscriptionIssues.map((row) => row.severity),
      ...dayAudits.flatMap((row) => row.issues.map((entry) => entry.severity)),
    ].reduce((current, severity) => {
      const candidate = severity === "critical" ? "critical" : severity === "high" ? "high" : severity === "medium" ? "medium" : "ok";
      return riskRank(candidate) > riskRank(current) ? candidate : current;
    }, "ok");

    const auditRow = {
      subscriptionId,
      customer,
      plan,
      source,
      fulfillmentMethod,
      fulfillmentLabelAr: fulfillmentMethod === "delivery" ? "توصيل" : fulfillmentMethod === "pickup" ? "استلام من الفرع" : "غير محدد",
      status: subscription.status || null,
      createdAt: subscription.createdAt || null,
      startDate: dateWindow(subscription).start,
      endDate: dateWindow(subscription).end,
      balance,
      manualDeductionsInRange: rangeManualRows,
      issues: subscriptionIssues,
      risk: rowRisk,
      days: includeDetails ? dayAudits : [],
      periodSummary: {
        reviewedDays: dayAudits.length,
        fulfilledDays: dayAudits.filter((row) => row.fulfilled).length,
        automaticConsumedMeals: dayAudits.reduce((sum, row) => sum + row.allocation.consumed, 0),
        reservedMeals: dayAudits.reduce((sum, row) => sum + row.allocation.reserved, 0),
        manualDeductedMeals: dayAudits.reduce((sum, row) => sum + row.manualDeduction.totalMeals, 0),
        criticalDays: dayAudits.filter((row) => row.risk === "critical").length,
        highRiskDays: dayAudits.filter((row) => row.risk === "high").length,
      },
    };
    subscriptionAudits.push(auditRow);

    if (newSubscriptionIdSet.has(subscriptionId)) {
      newSubscriptions.push({
        subscriptionId,
        customer,
        plan,
        source,
        fulfillmentMethod,
        fulfillmentLabelAr: auditRow.fulfillmentLabelAr,
        channelKey: `${source.code}_${fulfillmentMethod}`,
        status: subscription.status || null,
        createdAt: subscription.createdAt || null,
        startDate: auditRow.startDate,
        endDate: auditRow.endDate,
        totalMeals: nonNegativeInteger(subscription.totalMeals),
        totalPriceHalala: nonNegativeInteger(source.payment?.amountHalala || subscription.totalPriceHalala),
        payment: source.payment,
        auditRisk: rowRisk,
      });
    }
  }

  subscriptionAudits.sort((left, right) =>
    riskRank(right.risk) - riskRank(left.risk)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  );
  newSubscriptions.sort((left, right) =>
    String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  );

  const matrix = {
    branch_pickup: 0,
    app_pickup: 0,
    branch_delivery: 0,
    app_delivery: 0,
    unknown_pickup: 0,
    unknown_delivery: 0,
  };
  for (const row of newSubscriptions) {
    if (Object.prototype.hasOwnProperty.call(matrix, row.channelKey)) matrix[row.channelKey] += 1;
  }

  const issueSummary = summarizeIssues(subscriptionAudits);
  const reviewedDays = subscriptionAudits.reduce((sum, row) => sum + row.periodSummary.reviewedDays, 0);

  return {
    reportType: "subscription_operations_audit",
    generatedAt: new Date(),
    range: {
      from: range.from,
      to: range.to,
      days: range.days,
      timezone: range.timezone,
      today: range.today,
    },
    summary: {
      newSubscriptions: {
        total: newSubscriptions.length,
        pickup: newSubscriptions.filter((row) => row.fulfillmentMethod === "pickup").length,
        delivery: newSubscriptions.filter((row) => row.fulfillmentMethod === "delivery").length,
        fromBranch: newSubscriptions.filter((row) => row.source.code === "branch").length,
        fromApp: newSubscriptions.filter((row) => row.source.code === "app").length,
        matrix,
      },
      operations: {
        reviewedSubscriptions: subscriptionAudits.length,
        deliverySubscriptions: subscriptionAudits.filter((row) => row.fulfillmentMethod === "delivery").length,
        pickupSubscriptions: subscriptionAudits.filter((row) => row.fulfillmentMethod === "pickup").length,
        reviewedDays,
        automaticConsumedMeals: subscriptionAudits.reduce((sum, row) => sum + row.periodSummary.automaticConsumedMeals, 0),
        manuallyDeductedMeals: subscriptionAudits.reduce((sum, row) => sum + row.periodSummary.manualDeductedMeals, 0),
        reservedMeals: subscriptionAudits.reduce((sum, row) => sum + row.periodSummary.reservedMeals, 0),
      },
      issues: issueSummary,
    },
    newSubscriptions,
    subscriptionAudits,
  };
}

module.exports = {
  MAX_RANGE_DAYS,
  SubscriptionOperationsAuditError,
  allocationCounters,
  balanceSummary,
  buildDayAudit,
  buildSubscriptionOperationsAudit,
  classifyAcquisitionSource,
  resolveRange,
};
