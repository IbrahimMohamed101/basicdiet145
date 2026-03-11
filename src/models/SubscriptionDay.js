const mongoose = require("mongoose");

const SubscriptionDaySchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (KSA)
    status: {
      type: String,
      enum: [
        "open",
        "frozen",
        "locked",
        "in_preparation",
        "out_for_delivery",
        "ready_for_pickup",
        "fulfilled",
        "skipped",
      ],
      default: "open",
    },
    selections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Meal" }],
    premiumSelections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Meal" }],
    addonsOneTime: [{ type: mongoose.Schema.Types.ObjectId, ref: "Addon" }],
    premiumUpgradeSelections: [
      {
        baseSlotKey: { type: String, required: true },
        premiumMealId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMeal", required: true },
        unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "SAR" },
        consumedAt: { type: Date, default: Date.now },
      },
    ],
    addonCreditSelections: [
      {
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
        qty: { type: Number, min: 1, default: 1 },
        unitPriceHalala: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "SAR" },
        consumedAt: { type: Date, default: Date.now },
      },
    ],
    skippedByUser: { type: Boolean, default: false },
    assignedByKitchen: { type: Boolean, default: false },
    pickupRequested: { type: Boolean, default: false },
    creditsDeducted: { type: Boolean, default: false },
    deliveryAddressOverride: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    deliveryWindowOverride: { type: String },
    customSalads: [
      {
        items: [
          {
            ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "SaladIngredient" },
            name_en: { type: String },
            name_ar: { type: String },
            unitPriceSar: { type: Number },
            unitPrice: { type: Number }, // halalas
            quantity: { type: Number },
            calories: { type: Number },
          },
        ],
        basePriceSar: { type: Number, default: 0 },
        basePrice: { type: Number, default: 0 }, // halalas
        totalPriceSar: { type: Number },
        totalPrice: { type: Number }, // halalas
        currency: { type: String, default: "SAR" },
      },
    ],
    lockedSnapshot: { type: mongoose.Schema.Types.Mixed },
    fulfilledSnapshot: { type: mongoose.Schema.Types.Mixed },
    lockedAt: { type: Date },
    fulfilledAt: { type: Date },
    mealReminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SubscriptionDaySchema.index({ subscriptionId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("SubscriptionDay", SubscriptionDaySchema);
