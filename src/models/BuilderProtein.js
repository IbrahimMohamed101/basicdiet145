const mongoose = require("mongoose");
const {
  LEGACY_PROTEIN_FAMILY_ALIASES,
  MEAL_SELECTION_TYPES,
  PROTEIN_FAMILY_KEYS,
} = require("../config/mealPlannerContract");

const NutritionSchema = new mongoose.Schema(
  {
    calories: { type: Number, min: 0, default: 0 },
    proteinGrams: { type: Number, min: 0, default: 0 },
    carbGrams: { type: Number, min: 0, default: 0 },
    fatGrams: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const BuilderProteinSchema = new mongoose.Schema(
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
    imageUrl: { type: String, default: "" },
    displayCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderCategory", required: true },
    displayCategoryKey: { type: String, required: true, trim: true },
    proteinFamilyKey: {
      type: String,
      enum: [...PROTEIN_FAMILY_KEYS, ...Object.keys(LEGACY_PROTEIN_FAMILY_ALIASES)],
      required: true,
    },
    ruleTags: { type: [String], default: [] },
    selectionType: {
      type: String,
      enum: [
        MEAL_SELECTION_TYPES.STANDARD_MEAL,
        MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      ],
      default: MEAL_SELECTION_TYPES.STANDARD_MEAL,
    },
    isPremium: { type: Boolean, default: false },
    premiumKey: { type: String, trim: true },
    premiumCreditCost: { type: Number, min: 0, default: 0 },
    extraFeeHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    availableForSubscription: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    nutrition: { type: NutritionSchema, default: () => ({}) },
  },
  { timestamps: true }
);

BuilderProteinSchema.index(
  { key: 1 },
  {
    unique: true,
    partialFilterExpression: { key: { $type: "string" } }
  }
);

BuilderProteinSchema.index(
  { premiumKey: 1 },
  {
    unique: true,
    partialFilterExpression: { premiumKey: { $type: "string" } }
  }
);

BuilderProteinSchema.index({ displayCategoryId: 1, isActive: 1, sortOrder: 1, createdAt: -1 });
BuilderProteinSchema.index({ proteinFamilyKey: 1, isActive: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("BuilderProtein", BuilderProteinSchema);
