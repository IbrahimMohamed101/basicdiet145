const mongoose = require("mongoose");

const PromoUsageSchema = new mongoose.Schema(
  {
    promoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCode",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    checkoutDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckoutDraft",
      default: null,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    code: { type: String, required: true, trim: true, uppercase: true },
    discountAmountHalala: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["reserved", "consumed", "cancelled"],
      default: "reserved",
      required: true,
    },
    reservedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    orderType: {
      type: String,
      enum: ["subscription_checkout"],
      default: "subscription_checkout",
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

PromoUsageSchema.index({ promoCodeId: 1, status: 1, createdAt: -1 });
PromoUsageSchema.index({ userId: 1, promoCodeId: 1, status: 1, createdAt: -1 });
PromoUsageSchema.index(
  { checkoutDraftId: 1, promoCodeId: 1 },
  {
    unique: true,
    partialFilterExpression: { checkoutDraftId: { $type: "objectId" } },
  }
);

module.exports = mongoose.model("PromoUsage", PromoUsageSchema);
