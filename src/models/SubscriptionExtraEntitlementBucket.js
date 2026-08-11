"use strict";

const mongoose = require("mongoose");

const SubscriptionExtraEntitlementBucketSchema = new mongoose.Schema(
  {
    bucketKey: { type: String, required: true, trim: true, immutable: true },
    kind: {
      type: String,
      enum: ["premium", "addon"],
      required: true,
      immutable: true,
    },
    walletKey: { type: String, required: true, trim: true, immutable: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
    containerSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      immutable: true,
      index: true,
    },
    entitlementBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionEntitlementBatch",
      required: true,
      immutable: true,
      index: true,
    },
    sourceKey: { type: String, required: true, trim: true, immutable: true },
    sourceType: { type: String, default: "", trim: true, immutable: true },

    premiumKey: { type: String, default: "", trim: true, immutable: true },
    configId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PremiumUpgradeConfig",
      default: null,
      immutable: true,
    },
    revision: { type: Number, min: 0, default: 0, immutable: true },
    proteinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuilderProtein",
      default: null,
      immutable: true,
    },

    addonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Addon",
      default: null,
      immutable: true,
    },
    addonPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Addon",
      default: null,
      immutable: true,
    },
    entitlementKey: { type: String, default: "", trim: true, immutable: true },
    category: { type: String, default: "", trim: true, immutable: true },
    allowanceCategory: { type: String, default: "", trim: true, immutable: true },
    frequency: { type: String, default: "", trim: true, immutable: true },
    purchasedDailyQty: { type: Number, min: 0, default: 0, immutable: true },
    includedTotalQty: { type: Number, min: 0, default: 0, immutable: true },

    purchasedQty: { type: Number, min: 0, required: true, immutable: true },
    remainingQty: { type: Number, min: 0, required: true },
    reservedQty: { type: Number, min: 0, default: 0 },
    consumedQty: { type: Number, min: 0, default: 0 },
    forfeitedQty: { type: Number, min: 0, default: 0 },

    unitPriceHalala: { type: Number, min: 0, default: 0, immutable: true },
    overageUnitPriceHalala: { type: Number, min: 0, default: 0, immutable: true },
    totalHalala: { type: Number, min: 0, default: 0, immutable: true },
    currency: { type: String, default: "SAR", trim: true, immutable: true },

    effectiveStartDate: { type: Date, required: true, immutable: true, index: true },
    validityEndDate: { type: Date, required: true, immutable: true, index: true },
    applicationState: {
      type: String,
      enum: ["pending", "applied", "failed"],
      default: "applied",
      immutable: true,
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

SubscriptionExtraEntitlementBucketSchema.index(
  { entitlementBatchId: 1, kind: 1, walletKey: 1 },
  { unique: true, name: "uniq_batch_extra_wallet" }
);
SubscriptionExtraEntitlementBucketSchema.index(
  {
    containerSubscriptionId: 1,
    userId: 1,
    kind: 1,
    applicationState: 1,
    effectiveStartDate: 1,
    validityEndDate: 1,
  },
  { name: "extra_wallet_projection" }
);

module.exports = mongoose.models.SubscriptionExtraEntitlementBucket
  || mongoose.model(
    "SubscriptionExtraEntitlementBucket",
    SubscriptionExtraEntitlementBucketSchema
  );
