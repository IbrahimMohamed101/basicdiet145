"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { QuickDayDeductionError } = require("./subscriptionQuickDayDeductionService");

function assertObjectId(value, code, message) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new QuickDayDeductionError(code, message, 400);
  }
}

function pickupSnapshotFilter(containerDeliveryMode) {
  if (String(containerDeliveryMode || "") !== "pickup") {
    return { "deliverySnapshot.mode": "pickup" };
  }
  return {
    $or: [
      { "deliverySnapshot.mode": "pickup" },
      { "deliverySnapshot.mode": { $exists: false } },
      { deliverySnapshot: null },
    ],
  };
}

async function assertPickupSubscription(subscriptionId) {
  assertObjectId(subscriptionId, "INVALID_SUBSCRIPTION_ID", "Invalid subscription id");
  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    status: "active",
  }).select("_id deliveryMode").lean();
  if (!subscription) {
    throw new QuickDayDeductionError(
      "PICKUP_SUBSCRIPTION_REQUIRED",
      "Quick day deduction is only available for active subscriptions with a pickup package",
      409
    );
  }
  return subscription;
}

async function assertPickupTarget({ subscriptionId, batchId }) {
  const subscription = await assertPickupSubscription(subscriptionId);
  assertObjectId(batchId, "INVALID_ENTITLEMENT_BATCH_ID", "Invalid entitlement batch id");
  const batch = await SubscriptionEntitlementBatch.findOne({
    _id: batchId,
    containerSubscriptionId: subscriptionId,
    ...pickupSnapshotFilter(subscription.deliveryMode),
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
  const subscription = await assertPickupSubscription(subscriptionId);
  const ids = batches.map((batch) => batch && batch.id).filter(Boolean);
  if (!ids.length) return [];
  const allowed = await SubscriptionEntitlementBatch.find({
    _id: { $in: ids },
    containerSubscriptionId: subscriptionId,
    ...pickupSnapshotFilter(subscription.deliveryMode),
  }).select("_id").lean();
  const allowedIds = new Set(allowed.map((row) => String(row._id)));
  return batches.filter((batch) => allowedIds.has(String(batch.id)));
}

module.exports = {
  assertPickupSubscription,
  assertPickupTarget,
  filterPickupOptions,
  pickupSnapshotFilter,
};
