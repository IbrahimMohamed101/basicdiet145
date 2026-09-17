"use strict";

const mongoose = require("mongoose");

const ACTION_TYPES = Object.freeze(["skip", "freeze"]);
const COMPENSATION_STATES = Object.freeze(["active", "revoked"]);

const SubscriptionEntitlementCompensationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    containerSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    entitlementBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionEntitlementBatch",
      required: true,
      index: true,
    },
    sourceDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      default: null,
    },
    sourceDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    actionType: {
      type: String,
      enum: ACTION_TYPES,
      required: true,
    },
    sourceKey: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      enum: COMPENSATION_STATES,
      default: "active",
      required: true,
    },
    appliedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

SubscriptionEntitlementCompensationSchema.index(
  { sourceKey: 1 },
  {
    unique: true,
    name: "uniq_subscription_entitlement_compensation_source",
  }
);
SubscriptionEntitlementCompensationSchema.index({
  entitlementBatchId: 1,
  state: 1,
  sourceDate: 1,
});
SubscriptionEntitlementCompensationSchema.index({
  containerSubscriptionId: 1,
  sourceDate: 1,
  actionType: 1,
  state: 1,
});
SubscriptionEntitlementCompensationSchema.index({
  userId: 1,
  state: 1,
  createdAt: -1,
});

const SubscriptionEntitlementCompensation =
  mongoose.models.SubscriptionEntitlementCompensation
  || mongoose.model(
    "SubscriptionEntitlementCompensation",
    SubscriptionEntitlementCompensationSchema
  );

module.exports = SubscriptionEntitlementCompensation;
module.exports.ACTION_TYPES = ACTION_TYPES;
module.exports.COMPENSATION_STATES = COMPENSATION_STATES;
