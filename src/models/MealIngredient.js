const mongoose = require("mongoose");

const MealIngredientSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    category: { type: String, default: "" },
    price: { type: Number, required: true }, // SAR
    calories: { type: Number },
    maxQuantity: { type: Number },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MealIngredient", MealIngredientSchema);
