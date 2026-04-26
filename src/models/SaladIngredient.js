const mongoose = require("mongoose");

const SaladIngredientSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    price: { type: Number, required: true }, // SAR
    calories: { type: Number },
    maxQuantity: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SaladIngredient", SaladIngredientSchema);
