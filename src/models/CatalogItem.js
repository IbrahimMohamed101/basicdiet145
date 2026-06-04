const mongoose = require("mongoose");
const { generateUniqueKey } = require("../services/catalog/catalogKeyUiHelpers");

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const NutritionSchema = new mongoose.Schema(
  {
    calories: { type: Number, min: 0, default: 0 },
    proteinGrams: { type: Number, min: 0, default: 0 },
    carbsGrams: { type: Number, min: 0, default: 0 },
    fatGrams: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const CatalogItemSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      immutable: true,
    },
    nameI18n: { type: LocalizedStringSchema, default: () => ({}) },
    descriptionI18n: { type: LocalizedStringSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    itemKind: {
      type: String,
      enum: [
        "product",
        "protein",
        "carb",
        "salad_ingredient",
        "sandwich",
        "addon",
        "drink",
        "dessert",
        "other",
      ],
      default: "product",
      index: true,
    },
    nutrition: { type: NutritionSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true, index: true },
    isAvailable: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

CatalogItemSchema.index({ itemKind: 1, isActive: 1, isAvailable: 1 });

CatalogItemSchema.pre("validate", async function catalogItemValidate(next) {
  try {
    if (this.isNew && !this.key) {
      this.key = await generateUniqueKey({
        name: this.nameI18n,
        fallbackPrefix: this.itemKind || "catalog_item",
        exists: (candidate) => this.constructor.exists({ key: candidate }),
      });
    }
  } catch (err) {
    return next(err);
  }
  if (!this.nameI18n || (!this.nameI18n.ar && !this.nameI18n.en)) {
    this.invalidate("nameI18n", "At least one localized name is required");
  }
  return next();
});

CatalogItemSchema.pre("save", function catalogItemSave(next) {
  if (!this.isNew && this.isModified("key")) {
    const err = new Error("key is immutable");
    err.code = "IMMUTABLE_KEY";
    return next(err);
  }
  return next();
});

module.exports = mongoose.model("CatalogItem", CatalogItemSchema);
