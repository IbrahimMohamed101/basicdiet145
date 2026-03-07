const mongoose = require("mongoose");

const PremiumBalanceSchema = new mongoose.Schema(
  {
    premiumMealId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMeal", required: true },
    purchasedQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    purchasedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const AddonBalanceSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    purchasedQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    purchasedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const PremiumSelectionSchema = new mongoose.Schema(
  {
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay" },
    date: { type: String },
    baseSlotKey: { type: String, required: true },
    premiumMealId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMeal", required: true },
    unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    consumedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const AddonSelectionSchema = new mongoose.Schema(
  {
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay" },
    date: { type: String },
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    qty: { type: Number, min: 1, default: 1 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    consumedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

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

    selectedGrams: { type: Number },
    selectedMealsPerDay: { type: Number },
    basePlanPriceHalala: { type: Number, min: 0, default: 0 },
    checkoutCurrency: { type: String, default: "SAR" },

    premiumBalance: { type: [PremiumBalanceSchema], default: [] },
    addonBalance: { type: [AddonBalanceSchema], default: [] },
    premiumSelections: { type: [PremiumSelectionSchema], default: [] },
    addonSelections: { type: [AddonSelectionSchema], default: [] },

    deliveryMode: { type: String, enum: ["delivery", "pickup"], required: true },
    deliveryAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      district: { type: String },
      street: { type: String },
      building: { type: String },
      apartment: { type: String },
      lat: { type: Number },
      lng: { type: Number },
      notes: { type: String },
    },
    deliveryWindow: { type: String },
    deliverySlot: {
      type: {
        type: String,
        enum: ["delivery", "pickup"],
        default: "delivery",
      },
      window: { type: String, default: "" },
      slotId: { type: String, default: "" },
    },

    skippedCount: { type: Number, default: 0 },
    expiryReminder3dSentAt: { type: Date, default: null },
    expiryReminder24hSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ userId: 1 });

module.exports = mongoose.model("Subscription", SubscriptionSchema);
