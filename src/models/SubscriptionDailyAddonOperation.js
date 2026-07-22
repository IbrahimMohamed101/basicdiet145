"use strict";

const mongoose = require("mongoose");

const SubscriptionDailyAddonOperationSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    subscriptionDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      required: true,
      index: true,
    },
    date: { type: String, required: true, trim: true, index: true },
    allocationKey: { type: String, required: true, trim: true },
    entitlementKey: { type: String, required: true, trim: true },
    balanceBucketId: { type: mongoose.Schema.Types.ObjectId, required: true },
    addonPlanId: { type: mongoose.Schema.Types.ObjectId, default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: {
      type: String,
      enum: [
        "started",
        "balance_reserved",
        "day_applied",
        "completed",
        "consumed",
        "released",
        "compensated",
        "failed",
      ],
      default: "started",
      required: true,
      index: true,
    },
    selectionSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    errorCode: { type: String, default: null, trim: true },
    errorMessage: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

SubscriptionDailyAddonOperationSchema.index(
  { subscriptionDayId: 1, allocationKey: 1 },
  { unique: true }
);

SubscriptionDailyAddonOperationSchema.index({ subscriptionId: 1, date: 1, status: 1 });

module.exports = mongoose.model(
  "SubscriptionDailyAddonOperation",
  SubscriptionDailyAddonOperationSchema
);
