"use strict";

const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");

// These are acquisition channels, not payment methods. "cashier" includes
// subscriptions manually created by authorized restaurant/dashboard staff.
function contractChannel(subscription) {
  const raw = String(
    (subscription && subscription.contractSource)
    || (subscription && subscription.contractSnapshot && subscription.contractSnapshot.meta
      && subscription.contractSnapshot.meta.source)
    || ""
  ).trim().toLowerCase();
  if (raw === "admin_create") return "cashier";
  if (raw === "customer_checkout" || raw === "renewal") return "app";
  return null;
}

function batchChannel(batch) {
  const raw = String(batch && batch.sourceType || "").trim().toLowerCase();
  if (raw === "dashboard") return "cashier";
  if (raw === "checkout" || raw === "renewal") return "app";
  return null; // legacy_seed and migration do not independently prove a channel
}

function acquisitionChannel(subscription, batches = []) {
  const sources = new Set();
  const originalChannel = contractChannel(subscription);
  if (originalChannel) sources.add(originalChannel);
  for (const batch of batches) {
    // Never treat a failed/in-progress entitlement application as a purchase.
    if (batch.applicationState && batch.applicationState !== "applied") continue;
    const channel = batchChannel(batch);
    if (channel) sources.add(channel);
  }
  if (sources.size > 1) return "mixed";
  return sources.values().next().value || "unknown";
}

async function withSubscriptionOrigins(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return [];
  const ids = subscriptions.map((row) => row && (row._id || row.id)).filter(Boolean);
  const batches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: { $in: ids },
  }).select("containerSubscriptionId sourceType applicationState").lean();
  const byContainer = new Map();
  for (const batch of batches) {
    const id = String(batch.containerSubscriptionId);
    if (!byContainer.has(id)) byContainer.set(id, []);
    byContainer.get(id).push(batch);
  }
  return subscriptions.map((row) => ({
    ...row,
    subscriptionOrigin: acquisitionChannel(row, byContainer.get(String(row._id || row.id)) || []),
  }));
}

module.exports = { acquisitionChannel, batchChannel, contractChannel, withSubscriptionOrigins };
