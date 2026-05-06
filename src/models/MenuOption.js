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

const MenuOptionSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuOptionGroup", required: true, index: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    description: { type: LocalizedStringSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    extraPriceHalala: { type: Number, min: 0, default: 0, validate: integerMinZero },
    extraWeightUnitGrams: { type: Number, min: 0, default: 0, validate: integerMinZero },
    extraWeightPriceHalala: { type: Number, min: 0, default: 0, validate: integerMinZero },
    currency: { type: String, default: SYSTEM_CURRENCY },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

MenuOptionSchema.index({ groupId: 1, key: 1 }, { unique: true });
MenuOptionSchema.index({ groupId: 1, isActive: 1, publishedAt: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("MenuOption", MenuOptionSchema);
