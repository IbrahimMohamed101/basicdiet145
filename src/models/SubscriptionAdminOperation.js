"use strict";

const mongoose = require("mongoose");

const SubscriptionAdminOperationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    type: {
      type: String,
      enum: ["cancel", "refund", "cancel_and_refund"],
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "completed", "needs_review", "failed"],
      default: "processing",
      required: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
    refundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentRefund",
    },
    refundMode: {
      type: String,
      enum: ["none", "full", "partial"],
      default: "none",
    },
    refundChannel: {
      type: String,
      enum: ["none", "moyasar", "payment_gateway", "cash", "bank_transfer"],
      default: "none",
    },
    requestedAmountHalala: { type: Number, min: 0, default: 0 },
    refundedAmountHalala: { type: Number, min: 0, default: 0 },
    recordedRefundedBeforeHalala: { type: Number, min: 0 },
    cancellationApplied: { type: Boolean, default: false },
    refundRecorded: { type: Boolean, default: false },
    // True means this operation can change accounting recognition only; it has
    // no authority to execute a provider/cash money movement.
    accountingOnly: { type: Boolean, default: true },
    reason: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    lastStep: { type: String },
    actor: {
      dashboardUserId: { type: String },
      email: { type: String },
      role: { type: String },
    },
    requestMeta: {
      ip: { type: String },
      userAgent: { type: String },
    },
    error: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, minimize: false }
);

SubscriptionAdminOperationSchema.index({ subscriptionId: 1, createdAt: -1 });
SubscriptionAdminOperationSchema.index({ paymentId: 1, createdAt: -1 });
SubscriptionAdminOperationSchema.index({ refundId: 1 });

module.exports = mongoose.model("SubscriptionAdminOperation", SubscriptionAdminOperationSchema);
