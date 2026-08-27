"use strict";

const mongoose = require("mongoose");
const ActivityLog = require("./ActivityLog");

const DAILY_DEDUCTION_ACTION = "subscription_daily_meal_deduction";

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
    allocationKeys: [{ type: String, trim: true }],
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

SubscriptionQuickDayDeductionSchema.post("save", async function projectToActivityLog(doc) {
  const session = typeof doc.$session === "function" ? doc.$session() : null;
  const options = session ? { session } : {};
  await ActivityLog.create([
    {
      entityType: "subscription",
      entityId: doc.subscriptionId,
      action: DAILY_DEDUCTION_ACTION,
      byUserId: doc.actorId || undefined,
      byRole: doc.actorRole,
      meta: {
        source: doc.source,
        classification: "daily_deduction",
        quickDayDeductionId: String(doc._id),
        idempotencyKey: doc.idempotencyKey,
        businessDate: doc.businessDate,
        fulfillmentMethod: "pickup",
        entitlementBatchId: String(doc.entitlementBatchId),
        days: doc.days,
        mealsPerDay: doc.mealsPerDay,
        deductedRegularMeals: doc.mealsDeducted,
        deductedPremiumMeals: 0,
        deductedTotalMeals: doc.mealsDeducted,
        allocationKeys: Array.isArray(doc.allocationKeys) ? doc.allocationKeys : [],
        before: doc.before,
        after: doc.after,
      },
    },
  ], options);
});

module.exports = mongoose.models.SubscriptionQuickDayDeduction
  || mongoose.model("SubscriptionQuickDayDeduction", SubscriptionQuickDayDeductionSchema);
