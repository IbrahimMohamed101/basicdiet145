const mongoose = require("mongoose");

const DraftPremiumItemSchema = new mongoose.Schema(
  {
    premiumMealId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumMeal", required: true },
    qty: { type: Number, min: 1, required: true },
    unitExtraFeeHalala: { type: Number, min: 0, required: true },
    currency: { type: String, default: "SAR" },
  },
  { _id: false }
);

const DraftAddonItemSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    qty: { type: Number, min: 1, required: true },
    unitPriceHalala: { type: Number, min: 0, required: true },
    currency: { type: String, default: "SAR" },
  },
  { _id: false }
);

const DraftAddonSubscriptionSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    type: { type: String, default: "subscription" },
  },
  { _id: false }
);

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
    addonItems: { type: [DraftAddonItemSchema], default: [] },
    addonSubscriptions: { type: [DraftAddonSubscriptionSchema], default: [] },

    breakdown: {
      basePlanPriceHalala: { type: Number, min: 0, required: true },
      premiumTotalHalala: { type: Number, min: 0, required: true },
      addonsTotalHalala: { type: Number, min: 0, required: true },
      deliveryFeeHalala: { type: Number, min: 0, required: true },
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
