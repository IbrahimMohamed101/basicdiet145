"use strict";

const DashboardUser = require("../../models/DashboardUser");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const SubscriptionDay = require("../../models/SubscriptionDay");
const {
  buildSubscriptionOperationsAudit,
} = require("./subscriptionOperationsAuditService");
const {
  resolveEffectiveFulfillmentMode,
} = require("../subscription/subscriptionFulfillmentPolicyService");

const DELIVERY_STATUSES = [
  "missing",
  "scheduled",
  "ready_for_delivery",
  "out_for_delivery",
  "delivered",
  "canceled",
];

const DELIVERY_ACTIONS = new Set([
  "dashboard_ready_for_delivery",
  "dashboard_dispatch",
  "dashboard_fulfill",
  "dashboard_cancel",
]);

const RISK_RANK = {
  ok: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function id(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function maxRisk(...values) {
  return values.reduce((current, value) => (
    (RISK_RANK[value] || 0) > (RISK_RANK[current] || 0) ? value : current
  ), "ok");
}

function deliveryStatusOf(day) {
  const value = String(day && day.delivery && day.delivery.status || "").trim();
  return DELIVERY_STATUSES.includes(value) ? value : "missing";
}

function buildActor(log, usersById) {
  if (!log) return null;
  const actorId = id(log.actorId);
  const user = usersById.get(actorId) || null;
  return {
    role: String(log.actorType || user && user.role || "").trim() || null,
    id: actorId || null,
    email: user && user.email || null,
    action: log.action || null,
    at: log.createdAt || null,
    fromStatus: log.fromStatus || null,
    toStatus: log.toStatus || null,
    note: log.note || null,
  };
}

function result(code, labelAr, severity, messageAr) {
  return { code, labelAr, severity, messageAr };
}

function classifyDailyDeliveryRow(row) {
  if (!row.deliveryExpected) {
    return result(
      row.firstDayPickupOverride ? "FIRST_DAY_PICKUP_EXCLUDED" : "NOT_A_DELIVERY_DAY",
      row.firstDayPickupOverride ? "أول يوم استلام من الفرع" : "ليس يوم توصيل",
      "ok",
      row.firstDayPickupOverride
        ? "اليوم مستبعد من عدد التوصيل لأن طريقة التنفيذ الفعلية هي الاستلام من الفرع."
        : "اليوم لا يدخل ضمن عملاء التوصيل المستحقين."
    );
  }

  if (row.automaticConsumedMeals > 0 && row.manualDeductedMeals > 0) {
    return result(
      "DOUBLE_DEDUCTION_SUSPECTED",
      "اشتباه خصم مزدوج",
      "critical",
      "يوجد استهلاك تلقائي وخصم يدوي لنفس الاشتراك في نفس اليوم."
    );
  }

  if (row.dashboardDelivered) {
    if (row.reservedMeals > 0) {
      return result(
        "DELIVERED_STILL_RESERVED",
        "وصل وما زال محجوزًا",
        "critical",
        "تم تسجيل التوصيل لكن بعض الوجبات ما زالت محجوزة بدل مستهلكة."
      );
    }
    if (row.observedConsumedMeals === 0) {
      return result(
        "DELIVERED_WITHOUT_DEDUCTION",
        "وصل ولم يُخصم",
        "critical",
        "تم تسجيل وصول الوجبات في الداشبورد ولا يوجد استهلاك تلقائي أو خصم يدوي."
      );
    }
    if (row.consumptionDifference > 0) {
      return result(
        "DELIVERED_OVER_DEDUCTED",
        "خصم زائد بعد الوصول",
        "critical",
        "إجمالي الوجبات المستهلكة أو المخصومة أكبر من وجبات اليوم المستحقة."
      );
    }
    if (row.consumptionDifference < 0) {
      return result(
        "DELIVERED_UNDER_DEDUCTED",
        "خصم ناقص بعد الوصول",
        "critical",
        "تم تسجيل الوصول لكن الخصم أقل من عدد وجبات اليوم المستحقة."
      );
    }
    if (row.manualDeductedMeals > 0) {
      return result(
        "DELIVERED_WITH_MANUAL_DEDUCTION",
        "وصل مع خصم يدوي",
        "high",
        "إجمالي الخصم يساوي المتوقع، لكن وجود خصم يدوي في يوم توصيل يحتاج مراجعة السجل."
      );
    }
    return result(
      "DELIVERED_BALANCED",
      "سليم",
      "ok",
      "تم تسجيل الوصول والاستهلاك التلقائي يساوي عدد وجبات اليوم بدون خصم يدوي."
    );
  }

  if (row.observedConsumedMeals > 0) {
    return result(
      "DEDUCTED_WITHOUT_DASHBOARD_DELIVERY",
      "خُصم بدون تسجيل الوصول",
      "critical",
      "يوجد استهلاك أو خصم يدوي رغم أن سجل التوصيل في الداشبورد ليس Delivered."
    );
  }

  if (row.forfeitedMeals > 0) {
    return result(
      "FORFEITED_WITHOUT_DELIVERY",
      "لم يصل وتمت مصادرة رصيد",
      "high",
      "العميل غير مسجل كمستلم لكن توجد وجبات في حالة Forfeited وتحتاج مراجعة سبب الإغلاق."
    );
  }

  if (row.deliveryStatus === "canceled") {
    return result(
      "DELIVERY_CANCELED",
      "توصيل ملغي",
      "medium",
      "التوصيل ملغي ولم يتم تسجيل استهلاك للوجبات."
    );
  }

  return result(
    "DELIVERY_NOT_COMPLETED",
    "لم يتم التوصيل",
    "ok",
    "العميل مستحق للتوصيل لكن الحالة لم تصل إلى Delivered ولم يحدث استهلاك."
  );
}

function buildDailyDeliveryRow({ subscription, day, dayEvidence, logs, usersById }) {
  const evidence = dayEvidence || {};
  const rootFulfillmentMethod = String(subscription.fulfillmentMethod || "").trim();
  const effectiveFulfillmentMethod = resolveEffectiveFulfillmentMode({
    subscription: {
      deliveryMode: rootFulfillmentMethod,
      startDate: subscription.startDate,
    },
    day: evidence,
    date: day.date,
  });
  const firstDayPickupOverride = rootFulfillmentMethod === "delivery"
    && effectiveFulfillmentMethod === "pickup";
  const deliveryExpected = effectiveFulfillmentMethod === "delivery" && !Boolean(day.nonConsuming);
  const deliveryStatus = deliveryStatusOf(day);
  const dashboardDelivered = deliveryStatus === "delivered";
  const expectedMeals = nonNegativeInteger(day.expectedMeals);
  const automaticConsumedMeals = nonNegativeInteger(day.allocation && day.allocation.consumed);
  const reservedMeals = nonNegativeInteger(day.allocation && day.allocation.reserved);
  const forfeitedMeals = nonNegativeInteger(day.allocation && day.allocation.forfeited);
  const releasedMeals = nonNegativeInteger(day.allocation && day.allocation.released);
  const manualDeductedMeals = nonNegativeInteger(day.manualDeduction && day.manualDeduction.totalMeals);
  const observedConsumedMeals = automaticConsumedMeals + manualDeductedMeals;
  const expectedConsumedMeals = dashboardDelivered ? expectedMeals : 0;
  const consumptionDifference = observedConsumedMeals - expectedConsumedMeals;
  const entitlementImpactObserved = reservedMeals
    + automaticConsumedMeals
    + forfeitedMeals
    + manualDeductedMeals;
  const relevantLogs = (logs || []).filter((log) => DELIVERY_ACTIONS.has(String(log.action || "")));
  const fulfillLog = [...relevantLogs].reverse().find((log) => log.action === "dashboard_fulfill") || null;
  const lastOperationLog = relevantLogs.length ? relevantLogs[relevantLogs.length - 1] : null;

  const row = {
    date: day.date,
    subscriptionId: subscription.subscriptionId,
    customer: subscription.customer,
    plan: subscription.plan,
    source: subscription.source,
    subscriptionStatus: subscription.status || null,
    subscriptionStartDate: subscription.startDate || null,
    subscriptionEndDate: subscription.endDate || null,
    rootFulfillmentMethod,
    effectiveFulfillmentMethod,
    fulfillmentModeOverride: String(evidence.fulfillmentModeOverride || "").trim() || null,
    firstDayPickupOverride,
    deliveryExpected,
    dayId: day.day && day.day.id || null,
    dayStatus: day.day && day.day.status || null,
    selectedMeals: nonNegativeInteger(day.selectedMeals),
    expectedMeals,
    deliveryStatus,
    dashboardDelivered,
    deliveredAt: day.delivery && day.delivery.deliveredAt || null,
    canceledAt: day.delivery && day.delivery.canceledAt || null,
    reservedMeals,
    automaticConsumedMeals,
    releasedMeals,
    forfeitedMeals,
    manualDeductedMeals,
    observedConsumedMeals,
    expectedConsumedMeals,
    consumptionDifference,
    entitlementImpactObserved,
    manualDeductionRecords: day.manualDeduction && day.manualDeduction.records || [],
    dashboardFulfillActor: buildActor(fulfillLog, usersById),
    lastDashboardOperation: buildActor(lastOperationLog, usersById),
    sourceIssues: Array.isArray(day.issues) ? day.issues : [],
    sourceRisk: day.risk || "ok",
  };
  const auditResult = classifyDailyDeliveryRow(row);
  return {
    ...row,
    result: auditResult,
    risk: maxRisk(auditResult.severity, row.sourceRisk),
  };
}

function emptyStatusCounts() {
  return Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0]));
}

function summarizeDailyDeliveryRows(rows, date) {
  const deliveryRows = rows.filter((row) => row.deliveryExpected);
  const deliveredRows = deliveryRows.filter((row) => row.dashboardDelivered);
  const resultCounts = {};
  const riskCounts = { critical: 0, high: 0, medium: 0, low: 0, ok: 0 };
  const deliveryStatusCounts = emptyStatusCounts();

  for (const row of deliveryRows) {
    deliveryStatusCounts[row.deliveryStatus] = (deliveryStatusCounts[row.deliveryStatus] || 0) + 1;
    resultCounts[row.result.code] = (resultCounts[row.result.code] || 0) + 1;
    riskCounts[row.risk] = (riskCounts[row.risk] || 0) + 1;
  }

  const expectedCustomers = deliveryRows.length;
  const deliveredCustomers = deliveredRows.length;
  return {
    date,
    expectedCustomers,
    deliveredCustomers,
    notDeliveredCustomers: expectedCustomers - deliveredCustomers,
    deliveryRate: expectedCustomers > 0 ? deliveredCustomers / expectedCustomers : 0,
    excludedFirstDayPickupCustomers: rows.filter((row) => row.firstDayPickupOverride).length,
    deliveryStatusCounts,
    resultCounts,
    riskCounts,
    meals: {
      plannedForExpectedCustomers: deliveryRows.reduce((sum, row) => sum + row.expectedMeals, 0),
      expectedConsumedAfterDelivered: deliveryRows.reduce((sum, row) => sum + row.expectedConsumedMeals, 0),
      reserved: deliveryRows.reduce((sum, row) => sum + row.reservedMeals, 0),
      automaticConsumed: deliveryRows.reduce((sum, row) => sum + row.automaticConsumedMeals, 0),
      manuallyDeducted: deliveryRows.reduce((sum, row) => sum + row.manualDeductedMeals, 0),
      forfeited: deliveryRows.reduce((sum, row) => sum + row.forfeitedMeals, 0),
      observedConsumed: deliveryRows.reduce((sum, row) => sum + row.observedConsumedMeals, 0),
      consumptionDifference: deliveryRows.reduce((sum, row) => sum + row.consumptionDifference, 0),
      entitlementImpactObserved: deliveryRows.reduce((sum, row) => sum + row.entitlementImpactObserved, 0),
    },
    customers: rows.sort((left, right) => (
      (RISK_RANK[right.risk] || 0) - (RISK_RANK[left.risk] || 0)
      || Number(right.dashboardDelivered) - Number(left.dashboardDelivered)
      || String(left.customer && left.customer.name || "").localeCompare(String(right.customer && right.customer.name || ""), "ar")
    )),
  };
}

async function loadEvidence(report) {
  const dayIds = Array.from(new Set(
    (report.subscriptionAudits || [])
      .flatMap((subscription) => subscription.days || [])
      .map((day) => id(day.day && day.day.id))
      .filter(Boolean)
  ));

  if (dayIds.length === 0) {
    return { dayEvidenceById: new Map(), logsByDayId: new Map(), usersById: new Map() };
  }

  const [dayDocs, logs] = await Promise.all([
    SubscriptionDay.find({ _id: { $in: dayIds } })
      .select("_id fulfillmentModeOverride operationAuditLog")
      .lean(),
    SubscriptionAuditLog.find({
      entityType: "subscription_day",
      entityId: { $in: dayIds },
      action: { $in: Array.from(DELIVERY_ACTIONS) },
    }).sort({ createdAt: 1 }).lean(),
  ]);

  const actorIds = Array.from(new Set(logs.map((log) => id(log.actorId)).filter(Boolean)));
  const users = actorIds.length
    ? await DashboardUser.find({ _id: { $in: actorIds } }).select("_id email role").lean()
    : [];

  const dayEvidenceById = new Map(dayDocs.map((day) => [id(day._id), day]));
  const logsByDayId = new Map();
  for (const log of logs) {
    const key = id(log.entityId);
    if (!logsByDayId.has(key)) logsByDayId.set(key, []);
    logsByDayId.get(key).push(log);
  }
  const usersById = new Map(users.map((user) => [id(user._id), user]));
  return { dayEvidenceById, logsByDayId, usersById };
}

async function buildSubscriptionOperationsAuditWithDailyDelivery(options = {}) {
  const report = await buildSubscriptionOperationsAudit(options);
  const { dayEvidenceById, logsByDayId, usersById } = await loadEvidence(report);
  const rowsByDate = new Map();

  for (const subscription of report.subscriptionAudits || []) {
    if (subscription.fulfillmentMethod !== "delivery") continue;
    for (const day of subscription.days || []) {
      const dayId = id(day.day && day.day.id);
      const row = buildDailyDeliveryRow({
        subscription,
        day,
        dayEvidence: dayEvidenceById.get(dayId) || null,
        logs: logsByDayId.get(dayId) || [],
        usersById,
      });
      if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
      rowsByDate.get(row.date).push(row);
    }
  }

  const dates = [];
  let cursor = report.range.from;
  while (cursor <= report.range.to) {
    dates.push(cursor);
    const current = new Date(`${cursor}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + 1);
    cursor = current.toISOString().slice(0, 10);
  }

  const dailyDeliveryOperations = dates.map((date) =>
    summarizeDailyDeliveryRows(rowsByDate.get(date) || [], date)
  );
  const allExpectedRows = dailyDeliveryOperations.flatMap((day) =>
    day.customers.filter((row) => row.deliveryExpected)
  );
  const allDeliveredRows = allExpectedRows.filter((row) => row.dashboardDelivered);

  report.dailyDeliveryOperations = dailyDeliveryOperations;
  report.summary.deliveryOperations = {
    expectedCustomerDays: allExpectedRows.length,
    deliveredCustomerDays: allDeliveredRows.length,
    notDeliveredCustomerDays: allExpectedRows.length - allDeliveredRows.length,
    deliveryRate: allExpectedRows.length > 0 ? allDeliveredRows.length / allExpectedRows.length : 0,
    excludedFirstDayPickupCustomerDays: dailyDeliveryOperations.reduce(
      (sum, day) => sum + day.excludedFirstDayPickupCustomers,
      0
    ),
    plannedMeals: allExpectedRows.reduce((sum, row) => sum + row.expectedMeals, 0),
    expectedConsumedAfterDelivered: allExpectedRows.reduce((sum, row) => sum + row.expectedConsumedMeals, 0),
    automaticConsumedMeals: allExpectedRows.reduce((sum, row) => sum + row.automaticConsumedMeals, 0),
    manuallyDeductedMeals: allExpectedRows.reduce((sum, row) => sum + row.manualDeductedMeals, 0),
    consumptionDifference: allExpectedRows.reduce((sum, row) => sum + row.consumptionDifference, 0),
    doubleDeductionSuspicions: allExpectedRows.filter(
      (row) => row.result.code === "DOUBLE_DEDUCTION_SUSPECTED"
    ).length,
    deliveredWithoutDeduction: allExpectedRows.filter(
      (row) => row.result.code === "DELIVERED_WITHOUT_DEDUCTION"
    ).length,
    deductedWithoutDelivery: allExpectedRows.filter(
      (row) => row.result.code === "DEDUCTED_WITHOUT_DASHBOARD_DELIVERY"
    ).length,
  };

  return report;
}

module.exports = {
  DELIVERY_STATUSES,
  buildDailyDeliveryRow,
  buildSubscriptionOperationsAuditWithDailyDelivery,
  classifyDailyDeliveryRow,
  summarizeDailyDeliveryRows,
};
