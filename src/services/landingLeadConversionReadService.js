"use strict";

const User = require("../models/User");
const Subscription = require("../models/Subscription");
const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");
const { acquisitionChannel, batchChannel, contractChannel } = require("./subscriptionAcquisitionReadService");

const ACTIVATED_STATUSES = ["active", "frozen", "expired", "completed", "canceled"];
const PURCHASE_SOURCES = ["checkout", "renewal", "dashboard"];

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[\s()+-]/g, "");
  let local = digits;
  if (local.startsWith("966")) local = local.slice(3);
  else if (local.startsWith("0")) local = local.slice(1);
  return /^5\d{8}$/.test(local) ? "+966" + local : null;
}

function getPhoneVariants(e164) {
  const local = e164.slice(4);
  return [e164, "966" + local, "0" + local, local];
}

function validTime(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function selectVerifiedSubscription({ lead, subscriptions, batchesByContainer }) {
  const leadTime = validTime(lead.createdAt);
  if (!leadTime) return null;
  let latest = null;
  for (const subscription of subscriptions) {
    if (!ACTIVATED_STATUSES.includes(subscription.status)) continue;
    if (subscription.cancellationReason === "activation_failed") continue;
    const subscriptionId = String(subscription._id);
    const candidates = [];
    if (validTime(subscription.createdAt) >= leadTime) {
      candidates.push({
        when: validTime(subscription.createdAt),
        source: contractChannel(subscription) || "unknown",
      });
    }
    for (const batch of batchesByContainer.get(subscriptionId) || []) {
      const time = validTime(batch.createdAt);
      if (time >= leadTime && batch.applicationState === "applied" && batchChannel(batch)) {
        candidates.push({ when: time, source: batchChannel(batch) });
      }
    }
    for (const candidate of candidates) {
      if (!latest || candidate.when > latest.when) {
        latest = {
          when: candidate.when,
          subscriptionId,
          displayId: "SUB-" + subscriptionId.slice(-6).toUpperCase(),
          status: subscription.status,
          source: candidate.source,
          subscriptionOrigin: acquisitionChannel(subscription, batchesByContainer.get(subscriptionId) || []),
        };
      }
    }
  }
  return latest ? {
    subscriptionId: latest.subscriptionId,
    displayId: latest.displayId,
    status: latest.status,
    source: latest.source,
    subscriptionOrigin: latest.subscriptionOrigin,
    activatedAt: new Date(latest.when).toISOString(),
    matchBasis: "same_phone_after_lead",
  } : null;
}

async function attachVerifiedSubscriptionsToLeads(leads) {
  if (!Array.isArray(leads) || !leads.length) return [];
  const phones = Array.from(new Set(leads.map((lead) => normalizePhone(lead.phone)).filter(Boolean)));
  if (!phones.length) return leads.map((lead) => ({ ...lead, verifiedSubscription: null }));
  const variations = Array.from(new Set(phones.flatMap(getPhoneVariants)));
  const users = await User.find({
    $or: [{ phoneE164: { $in: variations } }, { phone: { $in: variations } }],
  }).select("_id phone phoneE164").lean();
  const idsByPhone = new Map();
  for (const user of users) {
    const normalized = normalizePhone(user.phoneE164) || normalizePhone(user.phone);
    if (!normalized || !phones.includes(normalized)) continue;
    if (!idsByPhone.has(normalized)) idsByPhone.set(normalized, []);
    idsByPhone.get(normalized).push(String(user._id));
  }
  const userIds = users.map((user) => user._id);
  if (!userIds.length) return leads.map((lead) => ({ ...lead, verifiedSubscription: null }));
  // The inbox returns 25 leads per page. Limit the lookback to the request age;
  // additionally load older active containers because a new purchase can be stacked onto them.
  const oldestLeadAt = new Date(Math.min(...leads.map((lead) => validTime(lead.createdAt)).filter(Boolean)));
  const subscriptions = await Subscription.find({
    userId: { $in: userIds },
    status: { $in: ACTIVATED_STATUSES },
    $or: [{ createdAt: { $gte: oldestLeadAt } }, { status: { $in: ["active", "frozen"] } }],
  }).select("_id userId status createdAt cancellationReason contractSource contractSnapshot.meta.source").sort({ createdAt: -1 }).limit(1000).lean();
  const ids = subscriptions.map((subscription) => subscription._id);
  const batches = ids.length ? await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: { $in: ids },
    sourceType: { $in: PURCHASE_SOURCES },
    applicationState: "applied",
    createdAt: { $gte: oldestLeadAt },
  }).select("containerSubscriptionId sourceType applicationState createdAt").lean() : [];
  const batchesByContainer = new Map();
  for (const batch of batches) {
    const id = String(batch.containerSubscriptionId);
    if (!batchesByContainer.has(id)) batchesByContainer.set(id, []);
    batchesByContainer.get(id).push(batch);
  }
  const subscriptionsByUser = new Map();
  for (const subscription of subscriptions) {
    const id = String(subscription.userId);
    if (!subscriptionsByUser.has(id)) subscriptionsByUser.set(id, []);
    subscriptionsByUser.get(id).push(subscription);
  }
  return leads.map((lead) => {
    const idsForPhone = idsByPhone.get(normalizePhone(lead.phone)) || [];
    const candidates = idsForPhone.flatMap((id) => subscriptionsByUser.get(id) || []);
    return {
      ...lead,
      verifiedSubscription: selectVerifiedSubscription({ lead, subscriptions: candidates, batchesByContainer }),
    };
  });
}

module.exports = {
  normalizePhone,
  getPhoneVariants,
  selectVerifiedSubscription,
  attachVerifiedSubscriptionsToLeads,
};
