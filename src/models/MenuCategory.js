const mongoose = require("mongoose");

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const CategoryUiSchema = new mongoose.Schema(
  {
    cardVariant: {
      type: String,
      enum: [
        "meal_builder",
        "light_collection",
        "hero_builder_collection",
        "compact_builder_collection",
        "meal_collection",
        "compact_product_collection",
        "sandwich_collection",
        "addon_collection",
      ],
      default: "addon_collection",
    },
    layout: { type: String, default: undefined },
    behaviorHint: { type: String, enum: ["open_builder", "direct_add", "customize_optional_addons"], default: undefined },
    priceLabelMode: { type: String, enum: ["fixed", "per_unit", "per_unit_or_from", "final_depends_on_options", "from_price"], default: undefined },
  },
  { _id: false }
);

const MenuCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    description: { type: LocalizedStringSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    isVisible: { type: Boolean, default: true, index: true },
    isAvailable: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    ui: { type: CategoryUiSchema, default: () => ({}) },
    availability: {
      branchIds: { type: [String], default: [] },
    },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

MenuCategorySchema.index({ key: 1 }, { unique: true });
MenuCategorySchema.index({ isActive: 1, isVisible: 1, isAvailable: 1, publishedAt: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("MenuCategory", MenuCategorySchema);
