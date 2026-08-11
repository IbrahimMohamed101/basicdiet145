"use strict";

const mongoose = require("mongoose");

const EXTRA_ALLOCATION_STATES = Object.freeze([
  "reserved",
  "consumed",
  "released",
]);

const SubscriptionExtraEntitlementAllocationSchema = new mongoose.Schema(
  {
    allocationKey: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    reservationKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      immutable: true,
    },
    requestHash: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    sourceKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
      immutable: true,
    },
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
    extraEntitlementBucketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionExtraEntitlementBucket",
      required: true,
      immutable: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["premium", "addon"],
      required: true,
      immutable: true,
    },
    walletKey: { type: String, required: true, trim: true, immutable: true },
    entitlementKey: { type: String, required: true, trim: true, immutable: true },

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
    category: { type: String, default: "", trim: true, immutable: true },
    sourceBalanceBucketId: {
      type: String,
      default: "",
      trim: true,
      immutable: true,
    },

    businessDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      immutable: true,
    },
    quantity: { type: Number, required: true, min: 1, immutable: true },
    requestedQuantity: { type: Number, required: true, min: 1, immutable: true },
    fundingSequence: { type: Number, required: true, min: 1, immutable: true },
    fundingAllocationCount: { type: Number, required: true, min: 1, immutable: true },
    state: {
      type: String,
      enum: EXTRA_ALLOCATION_STATES,
      required: true,
      default: "reserved",
    },
    reservedAt: { type: Date, required: true, immutable: true },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    optimisticConcurrency: true,
  }
);

SubscriptionExtraEntitlementAllocationSchema.pre("validate", function validateAllocation(next) {
  if (this.fundingSequence > this.fundingAllocationCount) {
    this.invalidate(
      "fundingSequence",
      "fundingSequence cannot exceed fundingAllocationCount"
    );
  }
  if (this.quantity > this.requestedQuantity) {
    this.invalidate("quantity", "allocation quantity cannot exceed requestedQuantity");
  }
  if (this.kind === "premium" && !String(this.premiumKey || "").trim()) {
    this.invalidate("premiumKey", "premium allocation requires premiumKey");
  }
  if (
    this.kind === "addon"
    && (!String(this.entitlementKey || "").trim() || (!this.addonId && !this.addonPlanId))
  ) {
    this.invalidate(
      "entitlementKey",
      "add-on allocation requires entitlementKey and addonId or addonPlanId"
    );
  }
  if (this.state === "reserved" && (this.consumedAt || this.releasedAt)) {
    this.invalidate("state", "reserved allocation cannot contain terminal timestamps");
  }
  if (this.state === "consumed" && (!this.consumedAt || this.releasedAt)) {
    this.invalidate("state", "consumed allocation requires only consumedAt");
  }
  if (this.state === "released" && (!this.releasedAt || this.consumedAt)) {
    this.invalidate("state", "released allocation requires only releasedAt");
  }
  next();
});

SubscriptionExtraEntitlementAllocationSchema.index(
  { allocationKey: 1 },
  { unique: true, name: "uniq_extra_entitlement_allocation_key" }
);
SubscriptionExtraEntitlementAllocationSchema.index(
  {
    userId: 1,
    containerSubscriptionId: 1,
    reservationKey: 1,
    fundingSequence: 1,
  },
  { unique: true, name: "uniq_extra_allocation_reservation_sequence" }
);
SubscriptionExtraEntitlementAllocationSchema.index(
  {
    userId: 1,
    containerSubscriptionId: 1,
    reservationKey: 1,
    extraEntitlementBucketId: 1,
  },
  { unique: true, name: "uniq_extra_allocation_reservation_bucket" }
);
SubscriptionExtraEntitlementAllocationSchema.index({
  userId: 1,
  containerSubscriptionId: 1,
  reservationKey: 1,
  state: 1,
});
SubscriptionExtraEntitlementAllocationSchema.index({
  extraEntitlementBucketId: 1,
  state: 1,
  businessDate: 1,
});

const SubscriptionExtraEntitlementAllocation =
  mongoose.models.SubscriptionExtraEntitlementAllocation
  || mongoose.model(
    "SubscriptionExtraEntitlementAllocation",
    SubscriptionExtraEntitlementAllocationSchema
  );

module.exports = SubscriptionExtraEntitlementAllocation;
module.exports.EXTRA_ALLOCATION_STATES = EXTRA_ALLOCATION_STATES;
