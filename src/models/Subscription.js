const mongoose = require("mongoose");
const {
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../constants/phase1Contract");
const PremiumBalanceSchema = new mongoose.Schema(
  {
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", required: true },
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
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", required: true },
    unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    premiumWalletRowId: { type: mongoose.Schema.Types.ObjectId, default: null },
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

const AddonSubscriptionEntitlementSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" }, // The Category Plan ID
    name: { type: String, default: "" },
    category: { type: String, required: true },
    maxPerDay: { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

const AppliedPromoSchema = new mongoose.Schema(
  {
    promoCodeId: { type: mongoose.Schema.Types.ObjectId, ref: "PromoCode", default: null },
    usageId: { type: mongoose.Schema.Types.ObjectId, ref: "PromoUsage", default: null },
    code: { type: String, default: "" },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    discountType: { type: String, enum: ["percentage", "fixed"], default: null },
    discountValue: { type: Number, min: 0, default: 0 },
    discountAmountHalala: { type: Number, min: 0, default: 0 },
    message: { type: String, default: "" },
  },
  { _id: false }
);

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    status: { type: String, enum: ["pending_payment", "active", "expired", "canceled"], default: "pending_payment" },
    startDate: { type: Date },
    endDate: { type: Date },
    validityEndDate: { type: Date },
    canceledAt: { type: Date, default: null },
    totalMeals: { type: Number, required: true },
    remainingMeals: { type: Number, required: true },
    addonSubscriptions: { type: [AddonSubscriptionEntitlementSchema], default: [] },

    selectedGrams: { type: Number },
    selectedMealsPerDay: { type: Number },
    basePlanPriceHalala: { type: Number, min: 0, default: 0 },
    discountHalala: { type: Number, min: 0, default: 0 },
    subtotalHalala: { type: Number, min: 0, default: 0 },
    vatPercentage: { type: Number, min: 0, default: 0 },
    vatHalala: { type: Number, min: 0, default: 0 },
    totalPriceHalala: { type: Number, min: 0, default: 0 },
    checkoutCurrency: { type: String, default: "SAR" },
    appliedPromo: { type: AppliedPromoSchema, default: null },

    premiumBalance: { type: [PremiumBalanceSchema], default: [] },
    premiumSelections: { type: [PremiumSelectionSchema], default: [] },

    contractVersion: { type: String, trim: true },
    contractMode: { type: String, enum: CONTRACT_MODES },
    contractCompleteness: { type: String, enum: CONTRACT_COMPLETENESS_VALUES },
    contractSource: { type: String, enum: CONTRACT_SOURCES },
    contractHash: { type: String, trim: true },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed },
    renewedFromSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },

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
    deliveryZoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
    deliveryZoneName: { type: String, default: "" },
    deliveryFeeHalala: { type: Number, default: 0 },
    pickupLocationId: { type: String, default: "" },
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
    skipDaysUsed: { type: Number, default: 0 },
    expiryReminder3dSentAt: { type: Date, default: null },
    expiryReminder24hSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Performance: Common queries filter by userId (client subscriptions list) and status (admin dashboards).
SubscriptionSchema.index({ userId: 1 });
SubscriptionSchema.index({ status: 1, createdAt: -1 });
// Support efficient lookups for per-user subscription lists that may be filtered by status.
SubscriptionSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Subscription", SubscriptionSchema);
