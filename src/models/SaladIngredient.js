const mongoose = require("mongoose");
const { SALAD_INGREDIENT_GROUP_KEYS } = require("../config/mealPlannerContract");

const SaladIngredientSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    groupKey: { type: String, required: true, enum: Array.from(SALAD_INGREDIENT_GROUP_KEYS) },
    price: { type: Number, required: true },
    calories: { type: Number },
    maxQuantity: { type: Number },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SaladIngredientSchema.index({ groupKey: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("SaladIngredient", SaladIngredientSchema);
