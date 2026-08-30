"use strict";

const mongoose = require("mongoose");

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

const REFUND_CHANNELS = ["moyasar", "payment_gateway", "cash", "bank_transfer"];

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
    // provider_confirmed = money movement was confirmed by a provider event.
    // recorded_only = superadmin recognized the refund for accounting only;
    // this record MUST NOT trigger any external money transfer.
    executionMode: {
      type: String,
      enum: ["provider_confirmed", "recorded_only"],
      immutable: true,
    },
    // Planned channel selected by the superadmin when the accounting refund is recorded.
    refundChannel: {
      type: String,
      enum: REFUND_CHANNELS,
      immutable: true,
    },
    settlement: {
      status: {
        type: String,
        enum: ["pending", "partially_settled", "settled"],
      },
      method: {
        type: String,
        enum: REFUND_CHANNELS,
      },
      settledAmountHalala: {
        type: Number,
        min: 0,
        default: 0,
        validate: Number.isInteger,
      },
      settledAt: { type: Date },
      reference: { type: String, set: normalizeOptionalString },
      note: { type: String, set: normalizeOptionalString },
      byDashboardUserId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
      source: { type: String, set: normalizeOptionalString },
      // Used only to reconcile a later Moyasar webhook to an already-recognized
      // accounting refund without creating a second financial amount row.
      providerConfirmedHalala: {
        type: Number,
        min: 0,
        default: 0,
        validate: Number.isInteger,
      },
      providerRefundId: { type: String, set: normalizeOptionalString },
      providerPaymentId: { type: String, set: normalizeOptionalString },
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
PaymentRefundSchema.index({ subscriptionId: 1, "settlement.status": 1, createdAt: -1 });

PaymentRefundSchema.statics.REFUND_CHANNELS = Object.freeze([...REFUND_CHANNELS]);

module.exports = mongoose.model("PaymentRefund", PaymentRefundSchema);
