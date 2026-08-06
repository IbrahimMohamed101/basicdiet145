"use strict";

const mongoose = require("mongoose");

const ALLOCATION_STATES = Object.freeze([
  "reserved",
  "consumed",
  "released",
  "forfeited",
]);

const SubscriptionEntitlementAllocationSchema = new mongoose.Schema(
  {
    allocationKey: { type: String, required: true, trim: true },
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
    subscriptionDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      default: null,
    },
    pickupRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPickupRequest",
      default: null,
    },
    date: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    slotKey: { type: String, required: true, trim: true },
    plannerRevisionHash: { type: String, default: "", trim: true },
    quantity: { type: Number, min: 1, max: 1, default: 1 },
    proteinGrams: { type: Number, required: true, min: 1 },
    state: {
      type: String,
      enum: ALLOCATION_STATES,
      required: true,
      default: "reserved",
    },
    parentAllocationKey: { type: String, default: "", trim: true },
    operationIdempotencyKey: { type: String, default: "", trim: true },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    reservedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    forfeitedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

SubscriptionEntitlementAllocationSchema.pre("validate", function validateAllocation(next) {
  const transitionTimestampField = `${this.state}At`;
  if (!this[transitionTimestampField]) {
    this[transitionTimestampField] = new Date();
  }

  const terminalTimestamps = [
    ["consumed", this.consumedAt],
    ["released", this.releasedAt],
    ["forfeited", this.forfeitedAt],
  ].filter(([, value]) => Boolean(value));

  if (terminalTimestamps.length > 1) {
    this.invalidate(
      "state",
      "an allocation cannot have more than one terminal transition timestamp"
    );
  }

  if (this.state === "reserved" && (this.consumedAt || this.releasedAt || this.forfeitedAt)) {
    this.invalidate("state", "reserved allocation cannot contain terminal timestamps");
  }

  next();
});

SubscriptionEntitlementAllocationSchema.index(
  { allocationKey: 1 },
  { unique: true, name: "uniq_subscription_entitlement_allocation_key" }
);
SubscriptionEntitlementAllocationSchema.index(
  {
    containerSubscriptionId: 1,
    date: 1,
    slotKey: 1,
    plannerRevisionHash: 1,
  },
  {
    unique: true,
    name: "uniq_subscription_entitlement_allocation_slot_revision",
  }
);
SubscriptionEntitlementAllocationSchema.index({
  entitlementBatchId: 1,
  state: 1,
  date: 1,
});
SubscriptionEntitlementAllocationSchema.index({
  containerSubscriptionId: 1,
  state: 1,
  date: 1,
});
SubscriptionEntitlementAllocationSchema.index(
  { operationIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      operationIdempotencyKey: { $type: "string", $gt: "" },
    },
    name: "uniq_subscription_entitlement_allocation_operation",
  }
);

const SubscriptionEntitlementAllocation =
  mongoose.models.SubscriptionEntitlementAllocation
  || mongoose.model(
    "SubscriptionEntitlementAllocation",
    SubscriptionEntitlementAllocationSchema
  );

module.exports = SubscriptionEntitlementAllocation;
module.exports.ALLOCATION_STATES = ALLOCATION_STATES;
