"use strict";

const mongoose = require("mongoose");

const SubscriptionDayMutationLockSchema = new mongoose.Schema(
  {
    subscriptionDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      required: true,
      unique: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    date: { type: String, required: true, trim: true, index: true },
    ownerOperationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDayAppendOperation",
      required: true,
      index: true,
    },
    token: { type: String, required: true, trim: true },
    purpose: { type: String, default: "delivery_append", trim: true },
    basePlannerRevisionHash: { type: String, default: "", trim: true },
    leaseExpiresAt: { type: Date, required: true, index: true },
    acquiredAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SubscriptionDayMutationLockSchema.index({ leaseExpiresAt: 1, releasedAt: 1 });

module.exports = mongoose.model(
  "SubscriptionDayMutationLock",
  SubscriptionDayMutationLockSchema
);
