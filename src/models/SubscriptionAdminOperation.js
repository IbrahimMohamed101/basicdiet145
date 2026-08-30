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
      enum: ["processing", "provider_succeeded", "completed", "needs_review", "failed"],
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
    refundMode: {
      type: String,
      enum: ["none", "full", "partial"],
      default: "none",
    },
    requestedAmountHalala: { type: Number, min: 0, default: 0 },
    refundedAmountHalala: { type: Number, min: 0, default: 0 },
    provider: { type: String },
    providerPaymentId: { type: String },
    providerRefundId: { type: String },
    providerRefundedBeforeHalala: { type: Number, min: 0 },
    providerRefundedAfterHalala: { type: Number, min: 0 },
    cancellationApplied: { type: Boolean, default: false },
    refundRecorded: { type: Boolean, default: false },
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
    providerSnapshot: { type: mongoose.Schema.Types.Mixed },
    error: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, minimize: false }
);

SubscriptionAdminOperationSchema.index({ subscriptionId: 1, createdAt: -1 });
SubscriptionAdminOperationSchema.index({ paymentId: 1, createdAt: -1 });

module.exports = mongoose.model("SubscriptionAdminOperation", SubscriptionAdminOperationSchema);
