"use strict";

const mongoose = require("mongoose");

const BATCH_STATUSES = Object.freeze([
  "paid_scheduled",
  "active",
  "exhausted",
  "expired",
  "canceled",
]);

const APPLICATION_STATES = Object.freeze([
  "pending",
  "applying",
  "applied",
  "failed",
]);

const SOURCE_TYPES = Object.freeze([
  "checkout",
  "renewal",
  "dashboard",
  "legacy_seed",
  "migration",
]);

const SubscriptionEntitlementBatchSchema = new mongoose.Schema(
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
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    checkoutDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckoutDraft",
      default: null,
    },

    // Stable idempotency identity. Examples:
    // payment:<paymentId>, checkout:<checkoutDraftId>, legacy:<subscriptionId>.
    sourceKey: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: SOURCE_TYPES,
      default: "checkout",
      required: true,
    },

    requestedStartDate: { type: Date, required: true },
    effectiveStartDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    validityEndDate: { type: Date, required: true },

    daysCount: { type: Number, required: true, min: 1 },
    mealsPerDay: { type: Number, required: true, min: 1 },
    proteinGrams: { type: Number, required: true, min: 1 },

    totalMeals: { type: Number, required: true, min: 0 },
    remainingMeals: { type: Number, required: true, min: 0 },
    reservedMeals: { type: Number, default: 0, min: 0 },
    consumedMeals: { type: Number, default: 0, min: 0 },
    forfeitedMeals: { type: Number, default: 0, min: 0 },

    // Phase 1 stores immutable purchase snapshots only. Wallet allocation and
    // consumption logic will be introduced behind the write/read flags later.
    premiumSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    addonSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    deliverySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: BATCH_STATUSES,
      required: true,
      default: "paid_scheduled",
    },
    applicationState: {
      type: String,
      enum: APPLICATION_STATES,
      required: true,
      default: "pending",
    },
    applicationError: { type: String, default: "", trim: true },
    appliedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    exhaustedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },

    stackVersion: { type: Number, min: 1, default: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

SubscriptionEntitlementBatchSchema.pre("validate", function validateBatch(next) {
  const effectiveStartMs = this.effectiveStartDate
    ? new Date(this.effectiveStartDate).getTime()
    : Number.NaN;
  const endMs = this.endDate ? new Date(this.endDate).getTime() : Number.NaN;
  const validityEndMs = this.validityEndDate
    ? new Date(this.validityEndDate).getTime()
    : Number.NaN;

  if (
    Number.isFinite(effectiveStartMs)
    && Number.isFinite(endMs)
    && endMs < effectiveStartMs
  ) {
    this.invalidate("endDate", "endDate must be on or after effectiveStartDate");
  }

  if (
    Number.isFinite(endMs)
    && Number.isFinite(validityEndMs)
    && validityEndMs < endMs
  ) {
    this.invalidate("validityEndDate", "validityEndDate must be on or after endDate");
  }

  const accountedMeals = [
    this.remainingMeals,
    this.reservedMeals,
    this.consumedMeals,
    this.forfeitedMeals,
  ].reduce((sum, value) => sum + Number(value || 0), 0);

  if (Number.isFinite(accountedMeals) && accountedMeals > Number(this.totalMeals || 0)) {
    this.invalidate(
      "totalMeals",
      "remaining, reserved, consumed, and forfeited meals cannot exceed totalMeals"
    );
  }

  next();
});

SubscriptionEntitlementBatchSchema.index(
  { sourceKey: 1 },
  { unique: true, name: "uniq_subscription_entitlement_batch_source" }
);
SubscriptionEntitlementBatchSchema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { paymentId: { $type: "objectId" } },
    name: "uniq_subscription_entitlement_batch_payment",
  }
);
SubscriptionEntitlementBatchSchema.index(
  { checkoutDraftId: 1 },
  {
    unique: true,
    partialFilterExpression: { checkoutDraftId: { $type: "objectId" } },
    name: "uniq_subscription_entitlement_batch_checkout_draft",
  }
);
SubscriptionEntitlementBatchSchema.index({
  userId: 1,
  status: 1,
  effectiveStartDate: 1,
  validityEndDate: 1,
});
SubscriptionEntitlementBatchSchema.index({
  containerSubscriptionId: 1,
  effectiveStartDate: 1,
  endDate: 1,
});
SubscriptionEntitlementBatchSchema.index({
  applicationState: 1,
  effectiveStartDate: 1,
  updatedAt: 1,
});

const SubscriptionEntitlementBatch =
  mongoose.models.SubscriptionEntitlementBatch
  || mongoose.model("SubscriptionEntitlementBatch", SubscriptionEntitlementBatchSchema);

module.exports = SubscriptionEntitlementBatch;
module.exports.BATCH_STATUSES = BATCH_STATUSES;
module.exports.APPLICATION_STATES = APPLICATION_STATES;
module.exports.SOURCE_TYPES = SOURCE_TYPES;
