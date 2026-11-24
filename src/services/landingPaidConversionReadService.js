"use strict";

// Server-authoritative, read-only conversion projection. Never ingest purchases
// through the public website analytics endpoint and never mutate payment state.
const Payment = require("../models/Payment");
const CheckoutDraft = require("../models/CheckoutDraft");
const LandingLead = require("../models/LandingLead");
const User = require("../models/User");
const { normalizePhone, getPhoneVariants } = require("./landingLeadConversionReadService");
const { classifySource } = require("./landingAttribution");
const { resolveRange } = require("./dashboard/marketingAnalyticsService");

const TYPES = ["subscription_activation", "subscription_renewal"];
const WINDOW = 30 * 86400000;

function completedPipeline(period, draftCollection) {
  return [
    { $match: { status: "paid", applied: true, currency: "SAR", type: { $in: TYPES },
      amount: { $gt: 0 }, paidAt: { $type: "date", $lte: period.end },
      checkoutDraftId: { $type: "objectId" }, userId: { $type: "objectId" },
      subscriptionId: { $type: "objectId" } } },
    { $lookup: { from: draftCollection, localField: "checkoutDraftId", foreignField: "_id", as: "draft" } },
    { $unwind: "$draft" },
    { $match: { "draft.status": "completed", "draft.completedAt": { $type: "date", $gte: period.start, $lte: period.end },
      $expr: { $and: [
        { $eq: ["$draft.paymentId", "$_id"] }, { $eq: ["$draft.userId", "$userId"] },
        { $eq: ["$draft.subscriptionId", "$subscriptionId"] },
        { $gte: ["$draft.completedAt", "$paidAt"] }
      ] } } },
    { $project: { _id: 1, userId: 1, type: 1, amount: 1, paidAt: 1, completedAt: "$draft.completedAt" } },
    { $sort: { completedAt: 1, _id: 1 } }
  ];
}

function summarizeCompleted(rows, leads, users, prior) {
  const idsByPhone = new Map();
  const phoneById = new Map();
  for (const user of users) {
    const phone = normalizePhone(user.phoneE164) || normalizePhone(user.phone);
    if (!phone) continue;
    const id = String(user._id);
    phoneById.set(id, phone);
    if (!idsByPhone.has(phone)) idsByPhone.set(phone, new Set());
    idsByPhone.get(phone).add(id);
  }
  const leadsByPhone = new Map();
  for (const lead of leads) {
    const phone = normalizePhone(lead.phone);
    if (!phone || lead.contactConsent !== true || !Number.isFinite(new Date(lead.createdAt).getTime())) continue;
    if (!leadsByPhone.has(phone)) leadsByPhone.set(phone, []);
    leadsByPhone.get(phone).push(lead);
  }
  const totals = { completed: 0, activationPayments: 0, renewalPayments: 0, firstRecordedPaidPurchases: 0,
    repeatOrRenewalPurchases: 0, unknownPurchaseHistory: 0, amountHalala: 0, leadMatched: 0, leadMatchedAmountHalala: 0,
    unmatched: 0 };
  const sources = new Map();
  const seen = new Set();
  const firstByUser = new Map(prior.map(p => [String(p._id), p.firstPaymentId == null ? null : String(p.firstPaymentId)]));
  for (const row of rows) {
    const id = String(row._id);
    if (seen.has(id)) continue;
    seen.add(id);
    const uid = String(row.userId);
    totals.completed++;
    totals.amountHalala += row.amount;
    if (row.type === TYPES[0]) totals.activationPayments++;
    else totals.renewalPayments++;
    if (row.type === TYPES[1]) totals.repeatOrRenewalPurchases++;
    else if (!firstByUser.get(uid)) totals.unknownPurchaseHistory++;
    else if (firstByUser.get(uid) === id) totals.firstRecordedPaidPurchases++;
    else totals.repeatOrRenewalPurchases++;
    const phone = phoneById.get(uid);
    // Only use an unambiguous account and a lead prior to actual payment.
    // Latest eligible lead is a heuristic, not proof of install attribution.
    const at = new Date(row.paidAt).getTime();
    const lead = phone && idsByPhone.get(phone)?.size === 1
      ? (leadsByPhone.get(phone) || []).filter(l => {
          const t = new Date(l.createdAt).getTime();
          return t <= at && at - t <= WINDOW;
        }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id)))[0]
      : null;
    if (!lead) { totals.unmatched++; continue; }
    totals.leadMatched++;
    totals.leadMatchedAmountHalala += row.amount;
    const source = classifySource(lead.source, lead.referrerHost).key;
    const current = sources.get(source) || { source, completed: 0, amountHalala: 0 };
    current.completed++;
    current.amountHalala += row.amount;
    sources.set(source, current);
  }
  return { ...totals, sources: [...sources.values()].sort((a,b) => b.completed - a.completed || a.source.localeCompare(b.source)),
    attributionMethod: "latest_consented_same_phone_lead_within_30_days_before_payment",
    historyBasis: "earliest_recorded_paid_or_refunded_subscription_payment_across_channels_with_paidAt",
    event: "subscription_paid_completed", currency: "SAR" };
}

async function buildLandingPaidConversionReport({ from, to }) {
  const period = resolveRange(from, to);
  const rows = await Payment.aggregate(completedPipeline(period, CheckoutDraft.collection.name));
  const leadStart = new Date(period.start.getTime() - WINDOW);
  // A payment could precede application by more than the attribution window.
  const earliestPaid = rows.reduce((min, row) => Math.min(min, new Date(row.paidAt).getTime() - WINDOW), leadStart.getTime());
  const leads = rows.length ? await LandingLead.find({ contactConsent: true,
    createdAt: { $gte: new Date(earliestPaid), $lte: period.end } })
    .select("_id phone contactConsent createdAt source referrerHost").lean() : [];
  const variants = [...new Set(leads.flatMap(l => {
    const phone = normalizePhone(l.phone); return phone ? getPhoneVariants(phone) : [];
  }))];
  const userIds = [...new Set(rows.map(r => String(r.userId)))].map(id => new Payment.base.Types.ObjectId(id));
  const [users, prior] = rows.length ? await Promise.all([
    User.find({ $or: [{ _id: { $in: userIds } }, { phone: { $in: variants } }, { phoneE164: { $in: variants } }] })
      .select("_id phone phoneE164").lean(),
    Payment.aggregate([
      { $match: { userId: { $in: userIds }, status: { $in: ["paid", "refunded"] }, type: { $in: TYPES }, amount: { $gt: 0 } } },
      // Do not claim first purchase when earlier payment history lacks a date.
      { $addFields: { historyDate: { $ifNull: ["$paidAt", "$createdAt"] } } },
      { $sort: { historyDate: 1, _id: 1 } },
      { $group: { _id: "$userId", firstPaymentId: { $first: "$_id" },
        undated: { $sum: { $cond: [{ $eq: [{ $type: "$paidAt" }, "date"] }, 0, 1] } } } },
      { $project: { firstPaymentId: { $cond: [{ $gt: ["$undated", 0] }, null, "$firstPaymentId"] } } }
    ])
  ]) : [[], []];
  return { range: { from: period.from, to: period.to, timezone: "Asia/Riyadh" },
    ...summarizeCompleted(rows, leads, users, prior),
    note: "Counts unique currently paid, applied app payments with a consistent completed checkout. Refunded or incomplete purchases excluded. Lead matching is inferred, not causal; store-only purchases are unmatched. First recorded paid purchase is not a guarantee of complete historical customer identity." };
}
module.exports = { completedPipeline, summarizeCompleted, buildLandingPaidConversionReport };
