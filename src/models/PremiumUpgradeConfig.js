const mongoose = require("mongoose");

const SYSTEM_CURRENCY = "SAR";
const integerMinZero = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer",
};

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const PremiumUpgradeConfigSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: ["menu_option", "menu_product"],
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    sourceProductId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    sourceGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    selectionType: {
      type: String,
      enum: ["premium_meal", "premium_large_salad"],
      required: true,
    },
    premiumKey: {
      type: String,
      required: true,
      unique: true,
    },
    displayGroupKey: {
      type: String,
      default: "premium",
    },
    upgradeDeltaHalala: {
      type: Number,
      required: true,
      min: 0,
      validate: integerMinZero,
    },
    currency: {
      type: String,
      default: SYSTEM_CURRENCY,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sourceSnapshot: {
      key: { type: String, default: "" },
      name: { type: LocalizedStringSchema, default: () => ({}) },
      context: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    revision: {
      type: Number,
      default: 1,
    },
    archiveReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

PremiumUpgradeConfigSchema.index(
  { sourceType: 1, sourceId: 1, sourceProductId: 1 },
  { unique: true }
);

PremiumUpgradeConfigSchema.index({ status: 1, isEnabled: 1, isVisible: 1, sortOrder: 1 });

module.exports = mongoose.model("PremiumUpgradeConfig", PremiumUpgradeConfigSchema);
