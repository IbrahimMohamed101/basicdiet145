const mongoose = require("mongoose");
const {
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../constants/phase1Contract");
const DraftPremiumItemSchema = new mongoose.Schema(
  {
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", required: true },
    qty: { type: Number, min: 1, required: true },
    unitExtraFeeHalala: { type: Number, min: 0, required: true },
    currency: { type: String, default: "SAR" },
  },
  { _id: false }
);


const DraftAddonSubscriptionSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" }, // The Category Plan ID
    name: { type: String, default: "" },
    category: { type: String, required: true },
    maxPerDay: { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

const DraftPromoSchema = new mongoose.Schema(
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
    isApplied: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Item 9: Pre-Activation Model
 * CheckoutDraft explicitly models the pre-activation state along with its paired Payment.
 * It is intentionally designed NOT as an actual Subscription row to avoid 'ghost' reservations.
 * If draft is completed successfully, it converts into a row in the Subscription collection.
 */
const CheckoutDraftSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    idempotencyKey: { type: String, trim: true, default: "" },
    requestHash: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending_payment", "completed", "failed", "canceled", "expired"],
      default: "pending_payment",
    },

    daysCount: { type: Number, required: true, min: 1 },
    grams: { type: Number, required: true, min: 1 },
    mealsPerDay: { type: Number, required: true, min: 1 },
    startDate: { type: Date },

    delivery: {
      type: {
        type: String,
        enum: ["delivery", "pickup"],
        required: true,
      },
      address: { type: mongoose.Schema.Types.Mixed },
      zoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
      zoneName: { type: String, default: "" },
      slot: {
        type: {
          type: String,
          enum: ["delivery", "pickup"],
          default: "delivery",
        },
        window: { type: String, default: "" },
        slotId: { type: String, default: "" },
      },
    },

    premiumItems: { type: [DraftPremiumItemSchema], default: [] },
    addonSubscriptions: { type: [DraftAddonSubscriptionSchema], default: [] },
    promo: { type: DraftPromoSchema, default: null },

    contractVersion: { type: String, trim: true },
    contractMode: { type: String, enum: CONTRACT_MODES },
    contractCompleteness: { type: String, enum: CONTRACT_COMPLETENESS_VALUES },
    contractSource: { type: String, enum: CONTRACT_SOURCES },
    contractHash: { type: String, trim: true },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed },
    renewedFromSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },

    breakdown: {
      basePlanPriceHalala: { type: Number, min: 0, required: true },
      premiumTotalHalala: { type: Number, min: 0, required: true },
      addonsTotalHalala: { type: Number, min: 0, required: true },
      deliveryFeeHalala: { type: Number, min: 0, required: true },
      discountHalala: { type: Number, min: 0, default: 0 },
      subtotalHalala: { type: Number, min: 0, default: 0 },
      vatPercentage: { type: Number, min: 0, default: 0 },
      vatHalala: { type: Number, min: 0, required: true },
      totalHalala: { type: Number, min: 0, required: true },
      currency: { type: String, default: "SAR" },
    },

    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    providerInvoiceId: { type: String },
    paymentUrl: { type: String, default: "" },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    completedAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, default: "" },
  },
  { timestamps: true }
);

CheckoutDraftSchema.index({ userId: 1, createdAt: -1 });
CheckoutDraftSchema.index({ status: 1, createdAt: -1 });
CheckoutDraftSchema.index({ userId: 1, requestHash: 1, status: 1, createdAt: -1 });
CheckoutDraftSchema.index(
  { userId: 1, requestHash: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending_payment", requestHash: { $type: "string", $ne: "" } } }
);
CheckoutDraftSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, partialFilterExpression: { idempotencyKey: { $type: "string", $ne: "" } } }
);
CheckoutDraftSchema.index({ paymentId: 1 }, { sparse: true });
CheckoutDraftSchema.index({ providerInvoiceId: 1 }, { sparse: true });

module.exports = mongoose.model("CheckoutDraft", CheckoutDraftSchema);
