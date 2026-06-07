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

const LocaleStringMapSchema = new mongoose.Schema(
  {
    ar: { type: String, default: undefined },
    en: { type: String, default: undefined },
  },
  { _id: false }
);

const ProductUiSchema = new mongoose.Schema(
  {
    cardVariant: {
      type: String,
      enum: [
        "standard",
        "premium",
        "large_salad",
        "addon",
        "hero_builder",
        "compact_builder",
        "ready_meal",
        "ready_meal_customizable",
        "compact_product",
        "sandwich_card",
        "addon_card",
      ],
      default: "standard",
    },
    cardSize: { type: String, enum: ["large", "medium", "small"], default: "medium" },
    badge: { type: String, default: "" },
    ctaLabel: { type: String, default: "" },
    imageRatio: { type: String, default: "square" },
    layout: { type: String, default: undefined },
    ctaLabelI18n: { type: LocaleStringMapSchema, default: undefined },
    mediaPositionByLocale: { type: LocaleStringMapSchema, default: undefined },
    showDescription: { type: Boolean, default: undefined },
    showPrice: { type: Boolean, default: undefined },
    priceLabelMode: { type: String, enum: ["fixed", "per_unit", "per_unit_or_from", "final_depends_on_options", "from_price"], default: undefined },
    behaviorHint: { type: String, enum: ["open_builder", "direct_add", "customize_optional_addons"], default: undefined },
  },
  { _id: false }
);

const MenuProductSchema = new mongoose.Schema(
  {
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuCategory", required: true, index: true },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogItem", required: false, default: null, index: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    description: { type: LocalizedStringSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    itemType: {
      type: String,
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
    isCustomizable: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isVisible: { type: Boolean, default: true, index: true },
    isAvailable: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    ui: { type: ProductUiSchema, default: () => ({}) },
    branchAvailability: { type: [String], default: [] },
    versionId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuVersion", default: null },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

MenuProductSchema.index({ key: 1 }, { unique: true });
MenuProductSchema.index({ categoryId: 1, isActive: 1, isVisible: 1, isAvailable: 1, publishedAt: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("MenuProduct", MenuProductSchema);
