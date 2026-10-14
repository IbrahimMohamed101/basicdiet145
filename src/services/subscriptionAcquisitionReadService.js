"use strict";

const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");
const Payment = require("../models/Payment");

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

function paymentChannel(payment) {
  if (!payment || !["paid", "refunded"].includes(payment.status)) return null;
  const source = String(payment.source || "").trim().toLowerCase();
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  if (source.startsWith("dashboard_subscription_") || payment.collectedBy || metadata.recordingMode === "dashboard_manual") return "cashier";
  if (payment.provider === "cash") return "cashier";
  if (payment.provider === "moyasar") return "app";
  return null;
}

function acquisitionChannel(subscription, batches = [], payments = []) {
  const sources = new Set();
  const originalChannel = contractChannel(subscription);
  if (originalChannel) sources.add(originalChannel);
  for (const batch of batches) {
    // Never treat a failed/in-progress entitlement application as a purchase.
    if (batch.applicationState && batch.applicationState !== "applied") continue;
    const channel = batchChannel(batch);
    if (channel) sources.add(channel);
  }
  for (const payment of payments) {
    const channel = paymentChannel(payment);
    if (channel) sources.add(channel);
  }
  if (sources.size > 1) return "mixed";
  return sources.values().next().value || "unknown";
}

async function withSubscriptionOrigins(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return [];
  const ids = subscriptions.map((row) => row && (row._id || row.id)).filter(Boolean);
  const [batches, payments] = await Promise.all([
    SubscriptionEntitlementBatch.find({ containerSubscriptionId: { $in: ids } })
      .select("containerSubscriptionId sourceType applicationState").lean(),
    Payment.find({ subscriptionId: { $in: ids }, type: { $in: ["subscription_activation", "subscription_renewal"] }, status: { $in: ["paid", "refunded"] } })
      .select("subscriptionId type source status provider collectedBy metadata.recordingMode").lean(),
  ]);
  const byContainer = new Map();
  for (const batch of batches) {
    const id = String(batch.containerSubscriptionId);
    if (!byContainer.has(id)) byContainer.set(id, []);
    byContainer.get(id).push(batch);
  }
  const paymentsBySubscription = new Map();
  for (const payment of payments) {
    const id = String(payment.subscriptionId);
    if (!paymentsBySubscription.has(id)) paymentsBySubscription.set(id, []);
    paymentsBySubscription.get(id).push(payment);
  }
  return subscriptions.map((row) => ({
    ...row,
    subscriptionOrigin: acquisitionChannel(
      row,
      byContainer.get(String(row._id || row.id)) || [],
      paymentsBySubscription.get(String(row._id || row.id)) || []
    ),
  }));
}

module.exports = { acquisitionChannel, batchChannel, contractChannel, paymentChannel, withSubscriptionOrigins };
