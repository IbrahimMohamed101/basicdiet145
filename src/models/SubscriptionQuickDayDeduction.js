"use strict";

const mongoose = require("mongoose");

const SubscriptionQuickDayDeductionSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true, trim: true },
    subscriptionId: {
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    actorRole: { type: String, required: true, trim: true },
    source: {
      type: String,
      enum: ["pickup_quick_deduction"],
      default: "pickup_quick_deduction",
      required: true,
    },
    businessDate: { type: String, required: true, trim: true },
    days: { type: Number, required: true, min: 1 },
    mealsPerDay: { type: Number, required: true, min: 1 },
    mealsDeducted: { type: Number, required: true, min: 1 },
    before: { type: mongoose.Schema.Types.Mixed, required: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

SubscriptionQuickDayDeductionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_subscription_quick_day_deduction_idempotency" }
);
SubscriptionQuickDayDeductionSchema.index({ subscriptionId: 1, createdAt: -1 });
SubscriptionQuickDayDeductionSchema.index({ entitlementBatchId: 1, createdAt: -1 });

module.exports = mongoose.models.SubscriptionQuickDayDeduction
  || mongoose.model("SubscriptionQuickDayDeduction", SubscriptionQuickDayDeductionSchema);
