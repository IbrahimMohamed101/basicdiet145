"use strict";

// Read-only online one-time-order accounting. These are NOT POS invoices and
// must never be folded into POS's tender or subscription payment totals.
const Order = require("../../models/Order");
const { parsePosReportQuery } = require("./posAccountingRangeReportService");
const {
  loadBusinessDayPolicy, businessDayBoundsWithPolicy,
} = require("../pos/businessDaySetting");

const DAY_MS = 86400000;
const paidStatuses = ["paid", "refunded"];
function resolveOrderGrossHalalas(pricing) {
  if (!pricing || typeof pricing !== "object") return 0;
  // Legacy POS accounting uses canonical >0 before legacy total/totalPrice.
  const canonical = Number(pricing.totalHalala);
  const fallback = Number(pricing.totalPrice) || Number(pricing.total);
  const chosen = Number.isFinite(canonical) && canonical > 0 ? canonical : fallback;
  return Number.isSafeInteger(chosen) && chosen >= 0 ? chosen : 0;
}
function makeBoundaries(from, days, policy) {
  const start = Date.parse(from + "T00:00:00Z");
  const buckets = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    buckets.push(businessDayBoundsWithPolicy(date, policy));
  }
  return buckets;
}
function summarizeOneTimeGroups(rows, bounds) {
  const byStart = new Map(bounds.map((b) => [b.start.getTime(), b.businessDate]));
  const daily = [];
  const summary = { paidCount: 0, paidGrossHalalas: 0,
    refundedStatusCount: 0, refundedStatusGrossHalalas: 0,
    unpricedPaidCount: 0 };
  for (const row of rows) {
    const date = byStart.get(new Date(row._id).getTime());
    if (!date) continue;
    const item = { businessDate: date,
      paidCount: Number(row.paidCount) || 0,
      paidGrossHalalas: Number(row.paidGrossHalalas) || 0,
      refundedStatusCount: Number(row.refundedStatusCount) || 0,
      refundedStatusGrossHalalas: Number(row.refundedStatusGrossHalalas) || 0,
      unpricedPaidCount: Number(row.unpricedPaidCount) || 0 };
    daily.push(item);
    for (const k of Object.keys(summary)) summary[k] += item[k];
  }
  return { summary, daily: daily.sort((a, b) => a.businessDate.localeCompare(b.businessDate)) };
}
async function buildOneTimeAccountingRange(query = {}) {
  const { from, to, days, offset, limit } = parsePosReportQuery(query);
  const policy = await loadBusinessDayPolicy();
  const bounds = makeBoundaries(from, days, policy);
  const start = bounds[0].start;
  const end = bounds[bounds.length - 1].end;
  const match = { createdAt: { $gte: start, $lt: end },
    paymentStatus: { $in: paidStatuses } };
  const grossExpr = { $cond: [
    { $gt: ["$pricing.totalHalala", 0] }, "$pricing.totalHalala",
    { $ifNull: ["$pricing.totalPrice", { $ifNull: ["$pricing.total", 0] }] },
  ] };
  // $bucket uses the exact versioned POS business-day boundaries, including
  // any historical cutoff changes; never approximate days using midnight UTC.
  const dateEdges = [start, ...bounds.map((b) => b.end)];
  const [buckets, items] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $project: { createdAt: 1, paymentStatus: 1, amount: grossExpr } },
      { $bucket: {
        groupBy: "$createdAt",
        boundaries: dateEdges,
        output: {
          paidCount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
          paidGrossHalalas: { $sum: {
            $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$amount", 0],
          } },
          refundedStatusCount: { $sum: {
            $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0],
          } },
          refundedStatusGrossHalalas: { $sum: {
            $cond: [{ $eq: ["$paymentStatus", "refunded"] }, "$amount", 0],
          } },
          unpricedPaidCount: { $sum: { $cond: [
            { $and: [{ $eq: ["$paymentStatus", "paid"] }, { $lte: ["$amount", 0] }] }, 1, 0,
          ] } },
        },
      } },
    ]),
    Order.find(match).select("orderNumber createdAt paymentStatus status fulfillmentMethod pricing")
      .sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
  ]);
  const { summary, daily } = summarizeOneTimeGroups(buckets, bounds);
  const dateFor = (instant) => {
    const value = new Date(instant).getTime();
    // Binary search over ordered bounds (max 366) prevents day cutoff drift.
    let low = 0, high = bounds.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const b = bounds[mid];
      if (value < b.start.getTime()) high = mid - 1;
      else if (value >= b.end.getTime()) low = mid + 1;
      else return b.businessDate;
    }
    return null;
  };
  return {
    reportType: "one-time-range",
    range: { from, to, days, timezone: "Asia/Riyadh",
      basis: "historical versioned POS business-day bounds on order.createdAt" },
    summary,
    daily,
    items: items.map((doc) => ({
      number: doc.orderNumber || String(doc._id),
      businessDate: dateFor(doc.createdAt),
      createdAt: doc.createdAt,
      paymentStatus: doc.paymentStatus,
      status: doc.status,
      fulfillmentMethod: doc.fulfillmentMethod,
      grossHalalas: resolveOrderGrossHalalas(doc.pricing),
    })),
    pagination: { offset, limit,
      total: summary.paidCount + summary.refundedStatusCount,
      hasMore: offset + items.length < summary.paidCount + summary.refundedStatusCount },
    notes: [
      "One-time online orders are separate from POS invoices and subscription collections.",
      "Only currently paid orders contribute to paidGrossHalalas.",
      "Refunded-status orders are tracked separately, not subtracted twice.",
      "A refunded status is not independent proof of money transfer.",
      "Business date follows the existing order.createdAt reporting convention.",
    ],
    generatedAt: new Date().toISOString(),
  };
}
module.exports = {
  resolveOrderGrossHalalas, makeBoundaries,
  summarizeOneTimeGroups, buildOneTimeAccountingRange,
};
