const mongoose = require("mongoose");

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    codeNormalized: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    appliesTo: {
      type: String,
      enum: ["subscription"],
      default: "subscription",
      required: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscountAmountHalala: { type: Number, min: 0, default: null },
    minimumSubscriptionAmountHalala: { type: Number, min: 0, default: null },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usageLimitTotal: { type: Number, min: 0, default: null },
    usageLimitPerUser: { type: Number, min: 0, default: null },
    currentUsageCount: { type: Number, min: 0, default: 0 },
    eligiblePlanIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Plan" }],
      default: [],
    },
    eligiblePlanDaysCounts: {
      type: [{ type: Number, min: 1 }],
      default: [],
    },
    firstPurchaseOnly: { type: Boolean, default: false },
    allowedUserIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    currency: { type: String, default: "SAR" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PromoCodeSchema.pre("validate", function normalizePromoCodeBeforeValidate(next) {
  const normalizedCode = String(this.code || "").trim().toUpperCase();
  this.code = normalizedCode;
  this.codeNormalized = normalizedCode;
  next();
});

PromoCodeSchema.index(
  { codeNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);
PromoCodeSchema.index({ appliesTo: 1, isActive: 1, expiresAt: 1 });

module.exports = mongoose.model("PromoCode", PromoCodeSchema);
