"use strict";

/**
 * Independent, read-only reconciliation of one subscription's meal balance.
 *
 * The subscription keeps aggregate counters (remaining / reserved / consumed /
 * forfeited). This service recomputes how many meals were consumed from the
 * underlying evidence over the whole life of the subscription and compares the
 * two, so a wrong customer balance is detected instead of silently trusted.
 *
 * Evidence for one calendar day (same precedence the dashboard audit uses):
 *   automatic = max(allocation consumed, delivery journal meals)
 *               || legacy day snapshot (creditsDeducted + fulfilledSnapshot)
 *   manual    = net committed staff deductions (after reversals)
 * Consumed evidence = sum(automatic) + sum(manual).
 *
 * No function here touches the database; callers pass the loaded documents.
 */

const dateUtils = require("../../utils/date");
const {
  collectBatchDeductionEvidence,
  manualDeductionLedger,
  mergeDayAllocations,
} = require("../dashboard/subscriptionOperationsAuditService");
const {
  DAILY_DEDUCTION_ACTION,
  MANUAL_DEDUCTION_ACTION,
  MANUAL_DEDUCTION_REVERSAL_ACTION,
} = require("../dashboard/manualDeduction/constants");

const CONSUMED_DAY_STATUSES = new Set(["fulfilled", "consumed_without_preparation"]);
const NON_CONSUMING_DAY_STATUSES = new Set(["skipped", "frozen"]);

const CHECKS = {
  INVALID_COUNTER: {
    severity: "critical",
    message: "أحد عدّادات الرصيد سالب أو غير رقمي أو المتبقي أكبر من الإجمالي.",
    action: "راجع الاشتراك يدويًا وصحّح العدّاد من سجل الحركات قبل أي تشغيل جديد.",
  },
  EQUATION_MISMATCH: {
    severity: "critical",
    message: "الإجمالي لا يساوي المتاح + المحجوز + المستهلك + المنتهي.",
    action: "حدّد العدّاد الخاطئ من سجل الحركات وصحّحه بعملية مسجلة، لا بتعديل مباشر.",
  },
  CONSUMED_EXCEEDS_EVIDENCE: {
    severity: "high",
    message: "المستهلك في الرصيد أكبر من الوجبات التي لها دليل خصم.",
    action: "ابحث عن حركة خصم ناقصة التسجيل. إن لم توجد فالعميل خُصم منه بدون سبب ويجب إرجاع الفرق.",
  },
  EVIDENCE_EXCEEDS_CONSUMED: {
    severity: "critical",
    message: "يوجد دليل خصم أكبر من المستهلك في الرصيد: العميل لم يُخصم منه كل ما استلمه.",
    action: "راجع الأيام المنفذة وأكمل الخصم الناقص بعملية مسجلة بعد التأكد من عدم تكرار الخصم.",
  },
  DAY_OVER_DEDUCTED: {
    severity: "critical",
    message: "إجمالي خصم يوم واحد أكبر من وجبات اليوم المتوقعة (اشتباه خصم مزدوج).",
    action: "قارن حركات اليوم، وأرجع الوجبات الزائدة بعملية عكس مسجلة.",
  },
  FULFILLED_DAY_WITHOUT_EVIDENCE: {
    severity: "high",
    message: "يوم منفذ بدون أي دليل خصم.",
    action: "تحقق هل الخصم موجود في العدّاد فقط (استهلاك مجمع). إن لم يكن فأكمل الخصم.",
  },
  STALE_RESERVATION: {
    severity: "high",
    message: "وجبات ما زالت محجوزة في يوم انتهى، فهي غير متاحة للعميل وغير مستهلكة.",
    action: "حوّل الحجز إلى مستهلك إن تم التنفيذ، أو حرّره إلى المتاح إن لم يتم.",
  },
  DUPLICATE_ALLOCATION_KEY: {
    severity: "critical",
    message: "مفتاح استحقاق مكرر داخل سجل واحد.",
    action: "ابحث عن الحركة المكررة قبل أي تعديل في الرصيد.",
  },
};

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function idOf(value) {
  return value === undefined || value === null ? "" : String(value._id || value);
}

function groupByDate(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const date = String(row && row.date || "").trim();
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(row);
  }
  return map;
}

function requiredMeals(subscription, day) {
  return nonNegativeInteger(
    day && day.plannerMeta && day.plannerMeta.requiredSlotCount
      || day && day.planningMeta && day.planningMeta.requiredMealCount
      || day && day.lockedSnapshot && day.lockedSnapshot.requiredMealCount
      || day && day.lockedSnapshot && day.lockedSnapshot.mealsPerDay
      || subscription.selectedMealsPerDay
  );
}

function rawCounter(value) {
  if (value === undefined || value === null) return 0;
  return Number(value);
}

function reconcileSubscriptionMealLedger({
  subscription,
  days = [],
  stackedAllocations = [],
  batches = [],
  deductionLogs = [],
  now = new Date(),
}) {
  const today = dateUtils.getTodayKSADate(now);
  const entitlementVersion = nonNegativeInteger(subscription.entitlementVersion);
  const raw = {
    total: rawCounter(subscription.totalMeals),
    available: rawCounter(subscription.remainingMeals),
    reserved: rawCounter(subscription.reservedMeals),
    consumed: rawCounter(subscription.consumedMeals),
    forfeited: rawCounter(subscription.forfeitedMeals),
  };
  const counters = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, nonNegativeInteger(value)])
  );

  const findings = [];
  const add = (code, details = {}) => findings.push({ code, ...CHECKS[code], details });

  const invalid = Object.entries(raw).filter(([, value]) => !Number.isFinite(value) || value < 0);
  if (invalid.length > 0 || raw.available > raw.total) {
    add("INVALID_COUNTER", { invalid: invalid.map(([key]) => key), counters: raw });
  }

  const equationDifference = counters.total
    - (counters.available + counters.reserved + counters.consumed + counters.forfeited);
  const equationApplies = entitlementVersion >= 2;
  if (equationApplies && equationDifference !== 0) {
    add("EQUATION_MISMATCH", { equationDifference, counters });
  }

  const manualLedger = manualDeductionLedger(
    deductionLogs.filter((log) => [MANUAL_DEDUCTION_ACTION, DAILY_DEDUCTION_ACTION].includes(log.action)),
    deductionLogs.filter((log) => log.action === MANUAL_DEDUCTION_REVERSAL_ACTION)
  );
  const manualByDate = new Map();
  for (const record of manualLedger.records) {
    const net = nonNegativeInteger(record.netTotalMeals);
    if (!net) continue;
    manualByDate.set(record.date, (manualByDate.get(record.date) || 0) + net);
  }
  const manualMeals = nonNegativeInteger(manualLedger.netManualDeductions);

  const batchEvidence = collectBatchDeductionEvidence(batches, deductionLogs);
  const dayByDate = new Map(days.map((day) => [String(day.date), day]));
  const legacyByDate = groupByDate(subscription.baseMealAllocations);
  const stackedByDate = groupByDate(stackedAllocations);

  const dates = new Set([
    ...dayByDate.keys(),
    ...legacyByDate.keys(),
    ...stackedByDate.keys(),
    ...manualByDate.keys(),
  ]);

  let automaticMeals = 0;
  let duplicateKeys = 0;
  let staleReservedMeals = 0;
  const dayEvidence = [];

  for (const date of [...dates].sort()) {
    const day = dayByDate.get(date) || null;
    const { allocation, hasStaffConsumption } = mergeDayAllocations(
      legacyByDate.get(date) || [],
      stackedByDate.get(date) || [],
      batchEvidence.staffAllocationKeys
    );
    duplicateKeys += allocation.duplicateKeys;
    const journalMeals = batchEvidence.deliveryMealsByDay.get(idOf(day && day._id)) || 0;
    const dayConsumed = Boolean(day) && CONSUMED_DAY_STATUSES.has(String(day.status || ""));
    const legacyMeals = dayConsumed && day.creditsDeducted && !hasStaffConsumption
      ? nonNegativeInteger(day.fulfilledSnapshot && day.fulfilledSnapshot.deductedCredits)
      : 0;
    const automatic = Math.max(allocation.consumed, journalMeals) || legacyMeals;
    const manual = manualByDate.get(date) || 0;
    automaticMeals += automatic;

    if (date < today && allocation.reserved > 0) staleReservedMeals += allocation.reserved;

    const expected = requiredMeals(subscription, day);
    const nonConsuming = Boolean(day) && NON_CONSUMING_DAY_STATUSES.has(String(day.status || ""));
    const row = {
      date,
      dayStatus: day ? day.status || null : null,
      expectedMeals: expected,
      automaticMeals: automatic,
      manualMeals: manual,
      sources: {
        allocationConsumed: allocation.consumed,
        journalMeals,
        legacySnapshotMeals: legacyMeals,
      },
    };
    dayEvidence.push(row);

    if (!nonConsuming && expected > 0 && automatic + manual > expected && (dayConsumed || manual > 0)) {
      add("DAY_OVER_DEDUCTED", { ...row, deductedMeals: automatic + manual });
    }
    if (dayConsumed && date <= today && automatic + manual === 0) {
      add("FULFILLED_DAY_WITHOUT_EVIDENCE", row);
    }
  }

  if (duplicateKeys > 0) add("DUPLICATE_ALLOCATION_KEY", { duplicateKeys });
  if (staleReservedMeals > 0) add("STALE_RESERVATION", { meals: staleReservedMeals });

  const evidenceConsumed = automaticMeals + manualMeals;
  // Subscriptions below entitlement v2 do not maintain consumedMeals; the only
  // live counter is remainingMeals, so consumption is total - remaining.
  const counterBasis = equationApplies ? "consumedMeals" : "total-remaining";
  const counterConsumed = equationApplies
    ? counters.consumed
    : Math.max(0, counters.total - counters.available);
  const consumedGap = counterConsumed - evidenceConsumed;
  if (consumedGap > 0) add("CONSUMED_EXCEEDS_EVIDENCE", { counterConsumed, counterBasis, evidenceConsumed, meals: consumedGap });
  if (consumedGap < 0) add("EVIDENCE_EXCEEDS_CONSUMED", { counterConsumed, counterBasis, evidenceConsumed, meals: -consumedGap });

  const severities = new Set(findings.map((finding) => finding.severity));
  return {
    subscriptionId: idOf(subscription._id),
    status: subscription.status || null,
    entitlementVersion,
    counters,
    equationApplies,
    equationDifference,
    evidence: { automaticMeals, manualMeals, consumedMeals: evidenceConsumed },
    counterConsumed,
    counterBasis,
    consumedGap,
    findings,
    verdict: severities.has("critical") ? "critical" : severities.has("high") ? "review" : "ok",
    days: dayEvidence,
  };
}

module.exports = {
  CHECKS,
  reconcileSubscriptionMealLedger,
};
