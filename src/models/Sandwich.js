const mongoose = require("mongoose");
const {
  MEAL_SELECTION_TYPES,
  PROTEIN_FAMILY_KEYS,
} = require("../config/mealPlannerContract");

const SandwichSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    description: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    imageUrl: { type: String, default: "" },
    calories: { type: Number, min: 0, default: 0 },
    selectionType: {
      type: String,
      enum: [MEAL_SELECTION_TYPES.SANDWICH],
      default: MEAL_SELECTION_TYPES.SANDWICH,
    },
    categoryKey: { type: String, enum: ["sandwich"], default: "sandwich" },
    pricingModel: { type: String, enum: ["included"], default: "included" },
    priceHalala: { type: Number, min: 0, default: 0 },
    proteinFamilyKey: { type: String, enum: PROTEIN_FAMILY_KEYS, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);

SandwichSchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });
SandwichSchema.index({ proteinFamilyKey: 1, isActive: 1 });

module.exports = mongoose.model("Sandwich", SandwichSchema);
