const mongoose = require("mongoose");
const {
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../constants/phase1Contract");
const {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
} = require("../utils/premiumWallet");

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
    premiumWalletMode: {
      type: String,
      enum: [LEGACY_PREMIUM_WALLET_MODE, GENERIC_PREMIUM_WALLET_MODE],
    },
    premiumWalletRowId: { type: mongoose.Schema.Types.ObjectId, default: null },
    consumedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const GenericPremiumBalanceSchema = new mongoose.Schema(
  {
    purchasedQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    unitCreditPriceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    source: { type: String, default: "purchase" },
    purchasedAt: { type: Date, default: Date.now },
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

const RecurringAddonEntitlementSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    type: { type: String, default: "subscription" },
    category: { type: String, default: "" },
    entitlementMode: { type: String, default: "" },
    maxPerDay: { type: Number, min: 0 },
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
    premiumRemaining: { type: Number, default: 0 },
    premiumPrice: { type: Number, default: 0 },
    addonSubscriptions: { type: [RecurringAddonEntitlementSchema], default: [] },

    selectedGrams: { type: Number },
    selectedMealsPerDay: { type: Number },
    basePlanPriceHalala: { type: Number, min: 0, default: 0 },
    checkoutCurrency: { type: String, default: "SAR" },

    premiumBalance: { type: [PremiumBalanceSchema], default: [] },
    premiumWalletMode: {
      type: String,
      enum: [LEGACY_PREMIUM_WALLET_MODE, GENERIC_PREMIUM_WALLET_MODE],
    },
    genericPremiumBalance: { type: [GenericPremiumBalanceSchema], default: [] },
    addonBalance: { type: [AddonBalanceSchema], default: [] },
    premiumSelections: { type: [PremiumSelectionSchema], default: [] },
    addonSelections: { type: [AddonSelectionSchema], default: [] },

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
