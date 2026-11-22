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
 * Stacked subscriptions keep their lifetime ledger in entitlement batches, so
 * evidence is compared with the sum of batch.consumedMeals; subscription
 * counters are only checked against the ACTIVE batches they project.
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

// Written by an out-of-repo correction when staff typed a deduction larger than
// intended (e.g. 35 instead of 3): the restored meals leave the evidence.
const EXCESS_CORRECTION_ACTION = "subscription_manual_deduction_excess_correction";

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
    severity: "high",
    message: "يوم فيه خصم تلقائي وخصم يدوي معًا ومجموعهما أكبر من وجبات اليوم (اشتباه خصم مزدوج).",
    action: "راجع الموظف والعميل: هل الخصم اليدوي كان ليوم آخر؟ إن لم يكن فأرجع الوجبات الزائدة بعملية عكس مسجلة.",
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
  COUNTERS_DIFFER_FROM_ACTIVE_BATCHES: {
    severity: "high",
    message: "رصيد الاشتراك المجمّع (stacking.aggregateBalance) لا يساوي مجموع الباتشات النشطة.",
    action: "قارن العدّاد بكل باتش نشط، وصحّح العدّاد من الباتشات بعملية مسجلة لا بتعديل مباشر.",
  },
  BATCH_UNACCOUNTED_MEALS: {
    severity: "high",
    message: "باتش فيه وجبات غير مسجلة كمتبقية أو محجوزة أو مستهلكة أو منتهية.",
    action: "حدّد مصير الوجبات الناقصة في الباتش (مستهلكة أم منتهية) وسجّلها بعملية واضحة.",
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

const ACTIVE_BATCH_STATUSES = new Set(["paid_scheduled", "active"]);

function zeroCounters() {
  return { total: 0, remaining: 0, reserved: 0, consumed: 0, forfeited: 0 };
}

/**
 * Entitlement batches are the source of truth for stacked subscriptions: each
 * batch keeps its own counters for its whole life. Subscription counters are a
 * projection of the ACTIVE batches only (exhausted/expired batches drop out), so
 * lifetime consumption must be read from all batches, not from the subscription.
 */
function summarizeBatches(batches) {
  const ledgerBatches = (batches || []).filter((batch) => batch
    && batch.totalMeals !== undefined
    && batch.status !== "canceled"
    && (batch.applicationState === undefined || batch.applicationState === "applied"));
  const lifetime = zeroCounters();
  const active = zeroCounters();
  const unaccounted = [];
  for (const batch of ledgerBatches) {
    const row = {
      total: nonNegativeInteger(batch.totalMeals),
      remaining: nonNegativeInteger(batch.remainingMeals),
      reserved: nonNegativeInteger(batch.reservedMeals),
      consumed: nonNegativeInteger(batch.consumedMeals),
      forfeited: nonNegativeInteger(batch.forfeitedMeals),
    };
    for (const key of Object.keys(lifetime)) lifetime[key] += row[key];
    const isActive = ACTIVE_BATCH_STATUSES.has(String(batch.status || ""));
    if (isActive) for (const key of Object.keys(active)) active[key] += row[key];
    const accounted = row.remaining + row.reserved + row.consumed + row.forfeited;
    if (accounted !== row.total) {
      unaccounted.push({ status: batch.status || null, ...row, unaccountedMeals: row.total - accounted });
    }
  }
  return { count: ledgerBatches.length, lifetime, active, unaccounted };
}

function reconcileSubscriptionMealLedger({
  subscription,
  days = [],
  stackedAllocations = [],
  batches = [],
  deductionLogs = [],
  releasedMeals = 0,
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
  // A legacy-path staff deduction first consumes the customer's RESERVED meals
  // (reserved -> consumed on the allocation, remainingMeals untouched) and only
  // debits remainingMeals for the residual. The reserved part is already in the
  // allocation evidence, so counting the whole log again would double count it.
  // For those logs the balance really moved by before.remaining - after.remaining.
  const logsById = new Map(deductionLogs.map((log) => [idOf(log), log]));
  const manualByDate = new Map();
  let manualMeals = 0;
  let manualViaReservations = 0;
  for (const record of manualLedger.records) {
    const net = nonNegativeInteger(record.netTotalMeals);
    if (!net) continue;
    const log = logsById.get(String(record.id)) || {};
    const beforeRemaining = Number(record.before && record.before.remainingMeals);
    const afterRemaining = Number(record.after && record.after.remainingMeals);
    const legacyPath = log.action === MANUAL_DEDUCTION_ACTION && !(log.meta && log.meta.status);
    let effective = net;
    if (legacyPath && !record.reversed && Number.isFinite(beforeRemaining) && Number.isFinite(afterRemaining)) {
      effective = Math.max(0, Math.min(net, beforeRemaining - afterRemaining));
      manualViaReservations += net - effective;
    }
    manualMeals += effective;
    manualByDate.set(record.date, (manualByDate.get(record.date) || 0) + effective);
  }

  const correctedMeals = deductionLogs
    .filter((log) => log.action === EXCESS_CORRECTION_ACTION && log.meta && log.meta.status === "applied")
    .reduce((sum, log) => sum + nonNegativeInteger(log.meta.restoredRegularMeals)
      + nonNegativeInteger(log.meta.restoredPremiumMeals), 0);

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
  const staleReservations = [];
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

    if (date < today && allocation.reserved > 0) {
      staleReservedMeals += allocation.reserved;
      staleReservations.push({ date, dayStatus: day ? day.status || null : null, meals: allocation.reserved });
    }

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

    // Staff bulk deductions (pickup quick deduction = days x meals on one date)
    // legitimately exceed one day's meals, so only a day that also has
    // automatic consumption can be a double deduction.
    // A staff deduction larger than one day's meals is a bulk/backfill deduction
    // (it cannot duplicate a single delivery), so only <= expected is suspicious.
    if (!nonConsuming && expected > 0 && automatic > 0 && manual > 0
      && manual <= expected && automatic + manual > expected) {
      add("DAY_OVER_DEDUCTED", { ...row, deductedMeals: automatic + manual });
    }
    if (dayConsumed && date <= today && automatic + manual === 0) {
      add("FULFILLED_DAY_WITHOUT_EVIDENCE", row);
    }
  }

  if (duplicateKeys > 0) add("DUPLICATE_ALLOCATION_KEY", { duplicateKeys });
  if (staleReservedMeals > 0) add("STALE_RESERVATION", { meals: staleReservedMeals, days: staleReservations });

  const released = nonNegativeInteger(releasedMeals);
  const evidenceConsumed = Math.max(0, automaticMeals + manualMeals - released - correctedMeals);
  const batchLedger = summarizeBatches(batches);
  const hasBatchLedger = batchLedger.count > 0;

  let counterBasis;
  let counterConsumed;
  if (hasBatchLedger) {
    // Stacked subscription: lifetime consumption lives in the batches.
    counterBasis = "batches";
    counterConsumed = batchLedger.lifetime.consumed;
    // The authoritative balance of a stacked subscription is
    // stacking.aggregateBalance (the top-level counters are a legacy mirror).
    const stacking = subscription.stacking && typeof subscription.stacking === "object" ? subscription.stacking : null;
    const aggregate = stacking && stacking.hasEntitlementBatches === true
      && stacking.aggregateBalance && typeof stacking.aggregateBalance === "object"
      ? stacking.aggregateBalance : null;
    if (aggregate) {
      const active = batchLedger.active;
      const differences = {};
      const pairs = [
        ["total", nonNegativeInteger(aggregate.totalMeals), active.total],
        ["available", nonNegativeInteger(aggregate.remainingMeals), active.remaining],
        ["reserved", nonNegativeInteger(aggregate.reservedMeals), active.reserved],
        ["consumed", nonNegativeInteger(aggregate.consumedMeals), active.consumed],
        ["forfeited", nonNegativeInteger(aggregate.forfeitedMeals), active.forfeited],
      ];
      for (const [name, aggregateValue, batchValue] of pairs) {
        if (aggregateValue !== batchValue) differences[name] = { aggregate: aggregateValue, activeBatches: batchValue };
      }
      if (Object.keys(differences).length > 0) add("COUNTERS_DIFFER_FROM_ACTIVE_BATCHES", { differences });
    }
    if (batchLedger.unaccounted.length > 0) add("BATCH_UNACCOUNTED_MEALS", { batches: batchLedger.unaccounted });
  } else {
    // Subscriptions below entitlement v2 do not maintain consumedMeals; the only
    // live counter is remainingMeals, so consumption is total - remaining.
    counterBasis = equationApplies ? "consumedMeals" : "total-remaining";
    counterConsumed = equationApplies
      ? counters.consumed
      : Math.max(0, counters.total - counters.available);
  }
  const consumedGap = counterConsumed - evidenceConsumed;
  if (consumedGap > 0) add("CONSUMED_EXCEEDS_EVIDENCE", { counterConsumed, counterBasis, evidenceConsumed, meals: consumedGap });
  if (consumedGap < 0) add("EVIDENCE_EXCEEDS_CONSUMED", { counterConsumed, counterBasis, evidenceConsumed, meals: -consumedGap });

  const severities = new Set(findings.map((finding) => finding.severity));
  return {
    subscriptionId: idOf(subscription._id),
    status: subscription.status || null,
    deliveryMode: subscription.deliveryMode || null,
    entitlementVersion,
    counters,
    equationApplies,
    equationDifference,
    evidence: {
      automaticMeals,
      manualMeals,
      manualViaReservations,
      releasedMeals: released,
      correctedMeals,
      consumedMeals: evidenceConsumed,
    },
    counterConsumed,
    counterBasis,
    consumedGap,
    batchLedger: hasBatchLedger ? batchLedger : null,
    findings,
    verdict: severities.has("critical") ? "critical" : severities.has("high") ? "review" : "ok",
    days: dayEvidence,
  };
}

module.exports = {
  CHECKS,
  EXCESS_CORRECTION_ACTION,
  reconcileSubscriptionMealLedger,
};
