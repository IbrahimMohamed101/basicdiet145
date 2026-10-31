"use strict";

/**
 * Operational, read-only retention preview. Separate from the audited October cohort:
 * current entitlement/balance documents cannot reproduce a historical as-of snapshot.
 * No schema writes, index creation, messaging, or customer contact changes here.
 */
const Subscription = require("../../models/Subscription");
const Batch = require("../../models/SubscriptionEntitlementBatch");
const User = require("../../models/User");
const Payment = require("../../models/Payment");
const CustomerAccountMerge = require("../../models/CustomerAccountMerge");
const RetentionFollowupEvent = require("../../models/RetentionFollowupEvent");

const MAX_ROWS = 5000;
const PAGE_MAX = 50;
const CATEGORIES = Object.freeze([
  "active", "due_soon", "grace_14", "overdue_14", "scheduled", "review", "canceled",
]);

function dateKey(date) {
  if (!date) return null;
  const d = new Date(date);
  if (!Number.isFinite(d.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return [pick("year"), pick("month"), pick("day")].join("-");
}

function dayNumber(key) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return Math.floor(new Date(key + "T00:00:00Z").valueOf() / 86400000);
}

function addDays(key, days) {
  const index = dayNumber(key);
  return index === null ? null : new Date((index + days) * 86400000).toISOString().slice(0, 10);
}

// Missing/invalid counters are *unknown*, not zero. Never classify a customer
// as expired or exhausted solely because an old record omitted a balance.
function countOrUnknown(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function afterToday(nowKey, dueDate) {
  const a = dayNumber(nowKey);
  const b = dayNumber(dueDate);
  return a === null || b === null ? null : a - b;
}

function buildCanonical(merges) {
  const map = new Map();
  for (const row of merges) {
    if (row.state === "completed" && row.sourceUserId && row.targetUserId) {
      map.set(String(row.sourceUserId), String(row.targetUserId));
    }
  }
  const resolve = (id) => {
    let key = String(id);
    const path = [];
    while (map.has(key) && !path.includes(key)) {
      path.push(key);
      key = map.get(key);
    }
    // Corrupt cyclic merge records still produce one deterministic customer.
    return path.includes(key) ? path.slice(path.indexOf(key)).sort()[0] : key;
  };
  resolve.isAmbiguous = (id) => {
    let key = String(id);
    const seen = new Set();
    while (map.has(key)) {
      if (seen.has(key)) return true;
      seen.add(key); key = map.get(key);
    }
    return false;
  };
  return resolve;
}

function effectiveBatch(batch) {
  if (batch.status === "canceled") return null;
  if (batch.sourceType === "migration") return null;
  if (batch.sourceType !== "legacy_seed" && batch.applicationState !== "applied") return null;
  return {
    validity: dateKey(batch.validityEndDate || batch.endDate),
    start: dateKey(batch.effectiveStartDate),
    remaining: countOrUnknown(batch.remainingMeals),
    reserved: countOrUnknown(batch.reservedMeals),
    exhausted: batch.sourceType === "legacy_seed" ? null : dateKey(batch.exhaustedAt),
    isLegacy: batch.sourceType === "legacy_seed",
  };
}

/**
 * Conservative current eligibility; a missing reliable early exhaustion date
 * is Review rather than inventing the day credits ran out.
 */
function classifyEntitlements({ subscriptions, batches, payments = [], nowKey }) {
  const review = (reason) => ({ status: "review", dueDate: null, balance: null, reason });
  const paid = (payment) => payment.status === "paid" && payment.amount > 0
    && ["subscription_activation", "subscription_renewal"].includes(payment.type);
  const paidIds = new Set(payments.filter(paid).map((payment) => String(payment._id)));
  const commercialParent = (s) => {
    const linked = payments.filter((payment) => String(payment.subscriptionId) === String(s._id));
    return linked.length ? linked.some(paid) : Number(s.totalPriceHalala) > 0;
  };
  const keptSubscriptions = subscriptions.filter((s) =>
    ["active", "frozen", "expired", "completed", "canceled"].includes(s.status)
  );
  if (keptSubscriptions.length === 0) {
    return { status: "review", dueDate: null, balance: null, reason: "no_verified_subscription" };
  }

  const byContainer = new Map();
  for (const batch of batches) {
    const id = String(batch.containerSubscriptionId || "");
    if (!byContainer.has(id)) byContainer.set(id, []);
    byContainer.get(id).push(batch);
  }

  const entitlements = [];
  if (batches.some((b) => !subscriptions.some((s) => String(s._id) === String(b.containerSubscriptionId)))) {
    return review("orphan_entitlement_batch");
  }
  const activeSub = keptSubscriptions.filter((s) => s.status !== "canceled");
  for (const s of activeSub) {
    const existingBatches = byContainer.get(String(s._id)) || [];
    if (existingBatches.length) {
      if (existingBatches.some((b) => b.status !== "canceled" && b.sourceType !== "legacy_seed"
        && b.applicationState !== "applied")) return review("unsettled_entitlement_application");
      if (existingBatches.some((b) => b.status !== "canceled" && (b.sourceType === "legacy_seed"
        ? !commercialParent(s) : !paidIds.has(String(b.paymentId))
          || payments.some((p) => String(p._id) === String(b.paymentId) && p.subscriptionId
            && String(p.subscriptionId) !== String(s._id))))) return review("unverified_commercial_entitlement");
      // Never sum the parent mirror and entitlement batches.
      entitlements.push(...existingBatches.map(effectiveBatch).filter(Boolean));
    } else {
      if (!commercialParent(s)) return review("unverified_commercial_entitlement");
      entitlements.push({
        validity: dateKey(s.validityEndDate || s.endDate),
        start: dateKey(s.startDate),
        remaining: countOrUnknown(s.remainingMeals),
        reserved: countOrUnknown(s.reservedMeals),
        exhausted: null, // no safe historical parent exhaustion timestamp
        isLegacy: true,
      });
    }
  }

  if (!entitlements.length) {
    const allCanceled = keptSubscriptions.every((s) => s.status === "canceled");
    return {
      status: allCanceled ? "canceled" : "review", dueDate: null,
      balance: null, reason: allCanceled ? "all_contracts_canceled" : "no_eligible_entitlement",
    };
  }
  if (entitlements.some((e) => !e.validity || !e.start || e.start > e.validity)) {
    return { status: "review", dueDate: null, balance: null, reason: "missing_entitlement_dates" };
  }
  if (entitlements.some((e) => e.remaining === null || e.reserved === null)) {
    return { status: "review", dueDate: null, balance: null, reason: "missing_entitlement_balance" };
  }

  const valid = entitlements.filter((e) => e.validity >= nowKey);
  const outstanding = valid.filter((e) => e.remaining + e.reserved > 0);
  const remaining = outstanding.reduce((total, e) => total + e.remaining + e.reserved, 0);
  if (outstanding.length) {
    const futureOnly = outstanding.every((e) => e.start > nowKey);
    const lastExpiry = outstanding.map((e) => e.validity).sort().at(-1);
    const dueDate = addDays(lastExpiry, 1);
    const daysUntil = dayNumber(dueDate) - dayNumber(nowKey);
    return {
      status: futureOnly ? "scheduled" : daysUntil <= 5 ? "due_soon" : "active",
      dueDate,
      balance: remaining,
      reason: futureOnly ? "paid_future_entitlement" : "usable_entitlement",
      dueDateIsLatestValidityBound: true,
    };
  }

  // A zero balance can have run out before its validity deadline, including
  // already expired documents. Missing depletion evidence must remain Review.
  // Consider *all* batches: a later expired purchase can outlast a depleted one.
  const boundaries = [];
  for (const e of entitlements) {
    const expiry = addDays(e.validity, 1);
    if (e.remaining + e.reserved === 0) {
      if (!e.exhausted) return review("unproven_early_exhaustion");
      if (e.exhausted < e.start || e.exhausted > nowKey) return review("invalid_exhaustion_timestamp");
      boundaries.push(e.exhausted < expiry ? e.exhausted : expiry);
    } else {
      boundaries.push(expiry);
    }
  }
  const dueDate = boundaries.sort().at(-1);
  const days = afterToday(nowKey, dueDate);
  return {
    status: days >= 0 && days <= 14 ? "grace_14" : days > 14 ? "overdue_14" : "review",
    dueDate, balance: 0, reason: "verified_entitlement_boundary",
  };
}

// This describes recorded subscription/entitlement documents, NOT proof of
// payment: an initial checkout can create both a parent and an applied batch.
function recordedEntitlementEvents(subscriptions, batches) {
  const items = [];
  for (const s of subscriptions) {
    if (!["active", "frozen", "expired", "completed", "canceled"].includes(s.status)) continue;
    if (["activation_failed", "replaced_by_new_subscription"].includes(s.cancellationReason)) continue;
    // Initial activation stores a parent and a purchase batch for one event.
    if (batches.some((b) => b.sourceType === "checkout" && b.applicationState === "applied"
      && String(b.containerSubscriptionId) === String(s._id))) continue;
    if (s.createdAt) items.push(s.createdAt);
  }
  for (const b of batches) {
    if (b.sourceType === "legacy_seed" || b.sourceType === "migration") continue;
    if (b.applicationState === "applied" && b.createdAt) items.push(b.createdAt);
  }
  return items.sort((a, b) => new Date(a) - new Date(b));
}

function buildLiveRows({ subscriptions, batches, users, merges, payments = [], optedOutIds = [], now = new Date() }) {
  const canonical = buildCanonical(merges);
  const suppressed = new Set(optedOutIds.map((id) => canonical(id)));
  const perCustomer = new Map();
  const ensure = (id) => {
    const key = canonical(id);
    if (!perCustomer.has(key)) perCustomer.set(key, { userId: key, subscriptions: [], batches: [] });
    return perCustomer.get(key);
  };
  for (const s of subscriptions) if (s.userId) ensure(s.userId).subscriptions.push(s);
  for (const b of batches) if (b.userId) ensure(b.userId).batches.push(b);
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const today = dateKey(now);
  return [...perCustomer.values()].flatMap((group) => {
    const records = recordedEntitlementEvents(group.subscriptions, group.batches);
    if (!records.length) return [];
    const customer = userMap.get(group.userId) || {};
    const classification = [...group.subscriptions, ...group.batches].some((row) => canonical.isAmbiguous(row.userId))
      ? { status: "review", dueDate: null, balance: null, reason: "ambiguous_account_merge" }
      : classifyEntitlements({ subscriptions: group.subscriptions, batches: group.batches,
        payments: payments.filter((p) => canonical(p.userId) === group.userId), nowKey: today });
    return [{
      userId: group.userId,
      doNotContact: suppressed.has(group.userId),
      name: typeof customer.name === "string" ? customer.name : "",
      phone: String(customer.phoneE164 || customer.phone || ""),
      firstRecordedAt: new Date(records[0]).toISOString(),
      lastRecordedAt: new Date(records.at(-1)).toISOString(),
      subscriptionRecordCount: records.length,
      status: classification.status,
      reason: classification.reason,
      dueDate: classification.dueDate,
      dueDateIsLatestValidityBound: Boolean(classification.dueDateIsLatestValidityBound),
      remainingAndReserved: classification.balance,
    }];
  }).sort((a, b) => {
    const order = { overdue_14: 0, grace_14: 1, due_soon: 2, review: 3, active: 4, scheduled: 5, canceled: 6 };
    return order[a.status] - order[b.status] || a.lastRecordedAt.localeCompare(b.lastRecordedAt);
  });
}

function parsePage(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    const err = new Error("Invalid pagination");
    err.status = 400; err.code = "INVALID_RETENTION_PAGINATION";
    throw err;
  }
  return n;
}

async function getLiveRetentionReport({ page, pageSize, status, search, contactableOnly, now = new Date() } = {}) {
  const pageNumber = parsePage(page, 1, 100000);
  const size = parsePage(pageSize, 20, PAGE_MAX);
  if (contactableOnly !== undefined && !["true", "false"].includes(String(contactableOnly))) {
    const err = new Error("Invalid contactability filter");
    err.status = 400; err.code = "INVALID_RETENTION_FILTER"; throw err;
  }
  const category = status ? String(status) : "all";
  if (category !== "all" && !CATEGORIES.includes(category)) {
    const err = new Error("Invalid retention status");
    err.status = 400; err.code = "INVALID_RETENTION_FILTER"; throw err;
  }
  const query = String(search || "").trim().slice(0, 80).toLowerCase();
  const projectionSub = "userId status cancellationReason createdAt startDate endDate validityEndDate remainingMeals reservedMeals contractSource totalPriceHalala";
  const projectionBatch = "userId containerSubscriptionId status sourceType applicationState createdAt effectiveStartDate endDate validityEndDate remainingMeals reservedMeals exhaustedAt paymentId";
  const [subscriptions, batches, merges, optedOutIds] = await Promise.all([
    Subscription.find({ status: { $in: ["active", "frozen", "expired", "completed", "canceled"] } })
      .select(projectionSub).limit(MAX_ROWS + 1).lean(),
    Batch.find({ sourceType: { $ne: "migration" } })
      .select(projectionBatch).limit(MAX_ROWS + 1).lean(),
    CustomerAccountMerge.find({ state: "completed" })
      .select("sourceUserId targetUserId state").limit(MAX_ROWS + 1).lean(),
    RetentionFollowupEvent.distinct("userId", { outcome: "do_not_contact" }),
  ]);
  if ([subscriptions, batches, merges].some((rows) => rows.length > MAX_ROWS)) {
    const err = new Error("Retention dataset exceeds read-only preview limit");
    err.status = 503; err.code = "RETENTION_DATASET_LIMIT"; throw err;
  }
  const userIds = [...new Set([...subscriptions.map((s) => String(s.userId)), ...batches.map((b) => String(b.userId)), ...merges.map((m) => String(m.targetUserId))])];
  const [users, payments] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds }, role: "client" }).select("_id name phone phoneE164").lean() : [],
    Payment.find({ $or: [
      { subscriptionId: { $in: subscriptions.map((s) => s._id) } },
      { _id: { $in: batches.map((b) => b.paymentId).filter(Boolean) } },
    ], type: { $in: ["subscription_activation", "subscription_renewal"] } })
      .select("_id userId subscriptionId status type amount").limit(MAX_ROWS + 1).lean(),
  ]);
  if (payments.length > MAX_ROWS) {
    const err = new Error("Retention payment evidence exceeds preview limit");
    err.status = 503; err.code = "RETENTION_DATASET_LIMIT"; throw err;
  }
  const all = buildLiveRows({ subscriptions, batches, merges, users, payments, optedOutIds, now });
  const totals = Object.fromEntries(CATEGORIES.map((key) => [key, 0]));
  for (const row of all) totals[row.status] += 1;
  const filtered = all.filter((row) =>
    (String(contactableOnly) !== "true" || !row.doNotContact)
    && (category === "all" || row.status === category)
    && (!query || [row.name, row.phone, row.userId].some((v) => String(v).toLowerCase().includes(query)))
  );
  return {
    asOf: now.toISOString(),
    timezone: "Asia/Riyadh",
    mode: "live_operational_preview",
    definition: "Current stored entitlement balance and validity; recorded subscription documents are not proof of paid purchases",
    warnings: [
      "تاريخ الاستحقاق المتوقع حد للصلاحية وقد ينتهي الرصيد قبله؛ راجع الرصيد قبل التواصل.",
      "الأرصدة المنتهية مبكرًا دون تاريخ استنفاد موثق أو رصيد ناقص ضمن الحالات التي تحتاج مراجعة.",
      "تاريخ آخر سجل اشتراك ليس إثباتًا لعملية شراء مدفوعة، ولا يمثل معدل تجديد.",
      "القراءة من مستندات متعددة وليست لقطة معاملات متزامنة.",
      "لا توجد هنا موافقة محفوظة على التواصل التسويقي أو إجراء إرسال.",
      "عميل طلب عدم التواصل يجب استبعاده من أي اتصالات تسويقية؛ هذا السجل يعكس الطلبات التي وثقها الموظفون فقط.",
    ],
    totals: { ...totals, all: all.length },
    pagination: { page: pageNumber, pageSize: size, total: filtered.length },
    rows: filtered.slice((pageNumber - 1) * size, pageNumber * size),
  };
}

module.exports = {
  CATEGORIES, dateKey, addDays, buildCanonical, classifyEntitlements,
  buildLiveRows, getLiveRetentionReport,
};
