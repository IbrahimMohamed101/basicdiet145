const mongoose = require("mongoose");

const SaladIngredientSchema = new mongoose.Schema(
  {
    name_en: { type: String },
    name_ar: { type: String },
    price: { type: Number, required: true }, // SAR
    calories: { type: Number },
    maxQuantity: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SaladIngredient", SaladIngredientSchema);
