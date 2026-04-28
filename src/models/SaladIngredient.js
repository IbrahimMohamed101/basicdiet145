const mongoose = require("mongoose");

const SaladIngredientSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    groupKey: { type: String, required: true, enum: ["vegetables", "addons", "fruits", "nuts", "sauce"] },
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
