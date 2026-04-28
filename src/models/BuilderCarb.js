const mongoose = require("mongoose");

const NutritionSchema = new mongoose.Schema(
  {
    calories: { type: Number, min: 0, default: 0 },
    proteinGrams: { type: Number, min: 0, default: 0 },
    carbGrams: { type: Number, min: 0, default: 0 },
    fatGrams: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const LegacyCarbMappingsSchema = new mongoose.Schema(
  {
    mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal", default: null },
  },
  { _id: false }
);

const BuilderCarbSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true },
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    description: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    displayCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderCategory", required: true },
    displayCategoryKey: { type: String, required: true, trim: true },
    availableForSubscription: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    nutrition: { type: NutritionSchema, default: () => ({}) },
    legacyMappings: { type: LegacyCarbMappingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

BuilderCarbSchema.index(
  { key: 1 },
  {
    unique: true,
    partialFilterExpression: { key: { $type: "string" } }
  }
);
BuilderCarbSchema.index({ displayCategoryId: 1, isActive: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("BuilderCarb", BuilderCarbSchema);
