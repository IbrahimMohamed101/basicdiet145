"use strict";

/**
 * Operational, read-only retention preview. Separate from the audited October cohort:
 * current entitlement/balance documents cannot reproduce a historical as-of snapshot.
 * No schema writes, index creation, messaging, or customer contact changes here.
 */
const Subscription = require("../../models/Subscription");
const Batch = require("../../models/SubscriptionEntitlementBatch");
const User = require("../../models/User");
const CustomerAccountMerge = require("../../models/CustomerAccountMerge");

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

function nonnegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
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
  return (id) => {
    let key = String(id);
    const seen = new Set();
    while (map.has(key) && !seen.has(key)) {
      seen.add(key);
      key = map.get(key);
    }
    return key;
  };
}

function effectiveBatch(batch) {
  if (batch.status === "canceled") return null;
  if (batch.sourceType === "migration") return null;
  if (batch.sourceType !== "legacy_seed" && batch.applicationState !== "applied") return null;
  return {
    validity: dateKey(batch.validityEndDate || batch.endDate),
    start: dateKey(batch.effectiveStartDate),
    remaining: nonnegative(batch.remainingMeals),
    reserved: nonnegative(batch.reservedMeals),
    exhausted: batch.sourceType === "legacy_seed" ? null : dateKey(batch.exhaustedAt),
    isLegacy: batch.sourceType === "legacy_seed",
  };
}

/**
 * Conservative current eligibility; a missing reliable early exhaustion date
 * is Review rather than inventing the day credits ran out.
 */
function classifyEntitlements({ subscriptions, batches, nowKey }) {
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
  const activeSub = keptSubscriptions.filter((s) => s.status !== "canceled");
  for (const s of activeSub) {
    const existingBatches = byContainer.get(String(s._id)) || [];
    if (existingBatches.length) {
      // Never sum the parent mirror and entitlement batches.
      entitlements.push(...existingBatches.map(effectiveBatch).filter(Boolean));
    } else {
      entitlements.push({
        validity: dateKey(s.validityEndDate || s.endDate),
        start: dateKey(s.startDate),
        remaining: nonnegative(s.remainingMeals),
        reserved: nonnegative(s.reservedMeals),
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
  if (entitlements.some((e) => !e.validity || !e.start)) {
    return { status: "review", dueDate: null, balance: null, reason: "missing_entitlement_dates" };
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

  // All valid balances are zero. Do not date depletion using a migration timestamp.
  if (valid.length) {
    const provenDates = valid.map((e) => e.exhausted).filter(Boolean);
    if (provenDates.length !== valid.length) {
      return { status: "review", dueDate: null, balance: 0, reason: "unproven_early_exhaustion" };
    }
    const lastExhaustion = provenDates.sort().at(-1);
    if (lastExhaustion > nowKey) {
      return { status: "review", dueDate: null, balance: 0, reason: "future_exhaustion_timestamp" };
    }
    const days = afterToday(nowKey, lastExhaustion);
    return { status: days <= 14 ? "grace_14" : "overdue_14", dueDate: lastExhaustion, balance: 0, reason: "proven_entitlement_exhaustion" };
  }

  const lastExpiry = entitlements.map((e) => e.validity).sort().at(-1);
  const dueDate = addDays(lastExpiry, 1);
  const days = afterToday(nowKey, dueDate);
  return {
    status: days >= 0 && days <= 14 ? "grace_14" : days > 14 ? "overdue_14" : "review",
    dueDate, balance: 0, reason: "validity_ended",
  };
}

function purchasesForCustomer(subscriptions, batches) {
  const items = [];
  for (const s of subscriptions) {
    if (!["active", "frozen", "expired", "completed", "canceled"].includes(s.status)) continue;
    if (s.cancellationReason === "activation_failed") continue;
    if (s.createdAt) items.push(s.createdAt);
  }
  for (const b of batches) {
    if (b.sourceType === "legacy_seed" || b.sourceType === "migration") continue;
    if (b.applicationState === "applied" && b.createdAt) items.push(b.createdAt);
  }
  return items.sort((a, b) => new Date(a) - new Date(b));
}

function buildLiveRows({ subscriptions, batches, users, merges, now = new Date() }) {
  const canonical = buildCanonical(merges);
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
    const purchases = purchasesForCustomer(group.subscriptions, group.batches);
    if (!purchases.length) return [];
    const customer = userMap.get(group.userId) || {};
    const classification = classifyEntitlements({ subscriptions: group.subscriptions, batches: group.batches, nowKey: today });
    return [{
      userId: group.userId,
      name: typeof customer.name === "string" ? customer.name : "",
      phone: String(customer.phoneE164 || customer.phone || ""),
      firstPurchaseAt: new Date(purchases[0]).toISOString(),
      lastPurchaseAt: new Date(purchases.at(-1)).toISOString(),
      purchaseEvents: purchases.length,
      status: classification.status,
      reason: classification.reason,
      dueDate: classification.dueDate,
      dueDateIsLatestValidityBound: Boolean(classification.dueDateIsLatestValidityBound),
      remainingAndReserved: classification.balance,
    }];
  }).sort((a, b) => {
    const order = { overdue_14: 0, grace_14: 1, due_soon: 2, review: 3, active: 4, scheduled: 5, canceled: 6 };
    return order[a.status] - order[b.status] || a.lastPurchaseAt.localeCompare(b.lastPurchaseAt);
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

async function getLiveRetentionReport({ page, pageSize, status, search, now = new Date() } = {}) {
  const pageNumber = parsePage(page, 1, 100000);
  const size = parsePage(pageSize, 20, PAGE_MAX);
  const category = status ? String(status) : "all";
  if (category !== "all" && !CATEGORIES.includes(category)) {
    const err = new Error("Invalid retention status");
    err.status = 400; err.code = "INVALID_RETENTION_FILTER"; throw err;
  }
  const query = String(search || "").trim().slice(0, 80).toLowerCase();
  const projectionSub = "userId status cancellationReason createdAt startDate endDate validityEndDate remainingMeals reservedMeals contractSource";
  const projectionBatch = "userId containerSubscriptionId status sourceType applicationState createdAt effectiveStartDate endDate validityEndDate remainingMeals reservedMeals exhaustedAt";
  const [subscriptions, batches, merges] = await Promise.all([
    Subscription.find({ status: { $in: ["active", "frozen", "expired", "completed", "canceled"] } })
      .select(projectionSub).limit(MAX_ROWS + 1).lean(),
    Batch.find({ sourceType: { $ne: "migration" } })
      .select(projectionBatch).limit(MAX_ROWS + 1).lean(),
    CustomerAccountMerge.find({ state: "completed" })
      .select("sourceUserId targetUserId state").limit(MAX_ROWS + 1).lean(),
  ]);
  if ([subscriptions, batches, merges].some((rows) => rows.length > MAX_ROWS)) {
    const err = new Error("Retention dataset exceeds read-only preview limit");
    err.status = 503; err.code = "RETENTION_DATASET_LIMIT"; throw err;
  }
  const userIds = [...new Set([...subscriptions.map((s) => String(s.userId)), ...batches.map((b) => String(b.userId)), ...merges.map((m) => String(m.targetUserId))])];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("_id name phone phoneE164").lean()
    : [];
  const all = buildLiveRows({ subscriptions, batches, merges, users, now });
  const totals = Object.fromEntries(CATEGORIES.map((key) => [key, 0]));
  for (const row of all) totals[row.status] += 1;
  const filtered = all.filter((row) =>
    (category === "all" || row.status === category)
    && (!query || [row.name, row.phone, row.userId].some((v) => String(v).toLowerCase().includes(query)))
  );
  return {
    asOf: now.toISOString(),
    timezone: "Asia/Riyadh",
    mode: "live_operational_preview",
    definition: "Current stored entitlement balance and validity, not historical cohort renewal rate",
    warnings: [
      "تاريخ الاستحقاق المتوقع حد للصلاحية وقد ينتهي الرصيد قبله؛ راجع الرصيد قبل التواصل.",
      "الأرصدة المنتهية مبكرًا دون تاريخ استنفاد موثق ضمن الحالات التي تحتاج مراجعة.",
      "القراءة من مستندات متعددة وليست لقطة معاملات متزامنة.",
      "لا توجد هنا موافقة محفوظة على التواصل التسويقي أو إجراء إرسال.",
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
