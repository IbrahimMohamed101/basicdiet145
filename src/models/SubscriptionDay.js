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
    recurringAddons: {
      type: [
        {
          addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
          name: { type: String, default: "" },
          category: { type: String, default: "" },
          entitlementMode: { type: String, default: "" },
          maxPerDay: { type: Number, min: 0 },
        },
      ],
      default: undefined,
    },
    oneTimeAddonSelections: {
      type: [
        {
          addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
          name: { type: String, default: "" },
          category: { type: String, default: "" },
        },
      ],
      default: undefined,
    },
    oneTimeAddonPendingCount: { type: Number, min: 0 },
    oneTimeAddonPaymentStatus: {
      type: String,
      enum: ["pending", "paid"],
    },
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
    canonicalDayActionType: {
      type: String,
      enum: ["freeze", "skip"],
      // P2-S7-S1: Written only by canonical freeze/skip write paths going forward.
      // Legacy days will have this absent — that is valid and expected.
      // Read paths must treat absence as valid; no default, no required.
    },
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
    customMeals: [
      {
        items: [
          {
            ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "MealIngredient" },
            name_en: { type: String },
            name_ar: { type: String },
            category: { type: String, default: "" },
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
    planningVersion: { type: String, trim: true },
    planningState: {
      type: String,
      enum: ["draft", "confirmed"],
    },
    baseMealSlots: [
      {
        slotKey: { type: String, required: true },
        mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal", required: true },
        assignmentSource: { type: String, default: "client" },
        assignedAt: { type: Date, default: Date.now },
      },
    ],
    planningMeta: {
      requiredMealCount: { type: Number, min: 0 },
      selectedBaseMealCount: { type: Number, min: 0 },
      selectedPremiumMealCount: { type: Number, min: 0 },
      selectedTotalMealCount: { type: Number, min: 0 },
      isExactCountSatisfied: { type: Boolean },
      lastEditedAt: { type: Date },
      confirmedAt: { type: Date },
      confirmedByRole: { type: String },
    },
    premiumOverageCount: { type: Number, min: 0 },
    premiumOverageStatus: {
      type: String,
      enum: ["pending", "paid"],
    },
    lockedSnapshot: { type: mongoose.Schema.Types.Mixed },
    fulfilledSnapshot: { type: mongoose.Schema.Types.Mixed },
    lockedAt: { type: Date },
    fulfilledAt: { type: Date },
    mealReminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Performance: Frequent queries filter by subscriptionId, status (e.g. counting frozen days)
// and/or date. A compound index supports these access patterns without requiring full collection scans.
SubscriptionDaySchema.index({ subscriptionId: 1, status: 1, date: 1 });

// Unique index to quickly lookup or upsert per-subscription per-day rows.
SubscriptionDaySchema.index({ subscriptionId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("SubscriptionDay", SubscriptionDaySchema);
