"use strict";

const mongoose = require("mongoose");

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

const PaymentRefundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      immutable: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      immutable: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      immutable: true,
    },
    provider: {
      type: String,
      enum: ["moyasar", "manual_gateway", "none", "unknown"],
      required: true,
      immutable: true,
    },
    providerRefundId: {
      type: String,
      set: normalizeOptionalString,
      immutable: true,
    },
    providerPaymentId: {
      type: String,
      set: normalizeOptionalString,
      immutable: true,
    },
    amountHalala: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    vatHalala: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
      immutable: true,
    },
    refundedAt: {
      type: Date,
      immutable: true,
    },
    status: {
      type: String,
      enum: ["confirmed", "needs_review"],
      required: true,
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      set: normalizeOptionalString,
      immutable: true,
    },
    rawReference: {
      type: mongoose.Schema.Types.Mixed,
      immutable: true,
    },
  },
  { timestamps: true }
);

PaymentRefundSchema.index(
  { provider: 1, idempotencyKey: 1 },
  { name: "provider_1_refundIdempotencyKey_1", unique: true }
);
PaymentRefundSchema.index(
  { provider: 1, providerRefundId: 1 },
  {
    name: "provider_1_providerRefundId_1",
    unique: true,
    partialFilterExpression: { providerRefundId: { $type: "string" } },
  }
);
PaymentRefundSchema.index({ refundedAt: 1, subscriptionId: 1 });
PaymentRefundSchema.index({ paymentId: 1, createdAt: 1 });

module.exports = mongoose.model("PaymentRefund", PaymentRefundSchema);
