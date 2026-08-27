"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { QuickDayDeductionError } = require("./subscriptionQuickDayDeductionService");

function pickupSnapshotFilter() {
  return {
    $or: [
      { "deliverySnapshot.mode": "pickup" },
      { "deliverySnapshot.mode": { $exists: false } },
      { deliverySnapshot: null },
    ],
  };
}

async function assertPickupSubscription(subscriptionId) {
  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    status: "active",
    deliveryMode: "pickup",
  }).select("_id").lean();
  if (!subscription) {
    throw new QuickDayDeductionError(
      "PICKUP_SUBSCRIPTION_REQUIRED",
      "Quick day deduction is only available for active pickup subscriptions",
      409
    );
  }
  return subscription;
}

async function assertPickupTarget({ subscriptionId, batchId }) {
  await assertPickupSubscription(subscriptionId);
  const batch = await SubscriptionEntitlementBatch.findOne({
    _id: batchId,
    containerSubscriptionId: subscriptionId,
    ...pickupSnapshotFilter(),
  }).select("_id").lean();
  if (!batch) {
    throw new QuickDayDeductionError(
      "PICKUP_ENTITLEMENT_BATCH_REQUIRED",
      "Selected package is not a pickup entitlement batch",
      409
    );
  }
}

async function filterPickupOptions(subscriptionId, batches = []) {
  await assertPickupSubscription(subscriptionId);
  const ids = batches.map((batch) => batch && batch.id).filter(Boolean);
  if (!ids.length) return [];
  const allowed = await SubscriptionEntitlementBatch.find({
    _id: { $in: ids },
    containerSubscriptionId: subscriptionId,
    ...pickupSnapshotFilter(),
  }).select("_id").lean();
  const allowedIds = new Set(allowed.map((row) => String(row._id)));
  return batches.filter((batch) => allowedIds.has(String(batch.id)));
}

module.exports = {
  assertPickupSubscription,
  assertPickupTarget,
  filterPickupOptions,
};
