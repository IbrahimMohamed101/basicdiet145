const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    status: { type: String, enum: ["pending_payment", "active", "expired"], default: "pending_payment" },
    startDate: { type: Date },
    endDate: { type: Date },
    validityEndDate: { type: Date },
    totalMeals: { type: Number, required: true },
    remainingMeals: { type: Number, required: true },
    premiumRemaining: { type: Number, default: 0 },
    premiumPrice: { type: Number, default: 0 },
    addonSubscriptions: [
      {
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
        name: { type: String },
        price: { type: Number },
        type: { type: String },
      },
    ],
    deliveryMode: { type: String, enum: ["delivery", "pickup"], required: true },
    deliveryAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    deliveryWindow: { type: String },
    skippedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ userId: 1 });

module.exports = mongoose.model("Subscription", SubscriptionSchema);
