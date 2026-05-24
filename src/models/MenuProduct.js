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

const MenuProductSchema = new mongoose.Schema(
  {
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuCategory", required: true, index: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    description: { type: LocalizedStringSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    itemType: {
      type: String,
      enum: [
        "basic_salad",
        "basic_meal",
        "fruit_salad",
        "greek_yogurt",
        "green_salad",
        "cold_sandwich",
        "sourdough",
        "dessert",
        "juice",
        "drink",
        "ice_cream",
        "product",
      ],
      default: "product",
      index: true,
    },
    pricingModel: { type: String, enum: ["fixed", "per_100g"], required: true, default: "fixed" },
    priceHalala: { type: Number, required: true, min: 0, validate: integerMinZero },
    baseUnitGrams: { type: Number, min: 1, default: 100, validate: integerMinZero },
    defaultWeightGrams: { type: Number, min: 0, default: 0, validate: integerMinZero },
    minWeightGrams: { type: Number, min: 0, default: 0, validate: integerMinZero },
    maxWeightGrams: { type: Number, min: 0, default: 0, validate: integerMinZero },
    weightStepGrams: { type: Number, min: 1, default: 50, validate: integerMinZero },
    currency: { type: String, default: SYSTEM_CURRENCY },
    availableFor: {
      type: [String],
      enum: ["one_time", "subscription"],
      default: ["one_time", "subscription"],
    },
    isActive: { type: Boolean, default: true, index: true },
    isVisible: { type: Boolean, default: true, index: true },
    isAvailable: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    branchAvailability: { type: [String], default: [] },
    versionId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuVersion", default: null },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

MenuProductSchema.index({ key: 1 }, { unique: true });
MenuProductSchema.index({ categoryId: 1, isActive: 1, isVisible: 1, isAvailable: 1, publishedAt: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("MenuProduct", MenuProductSchema);
