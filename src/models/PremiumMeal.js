const mongoose = require("mongoose");

const PremiumMealSchema = new mongoose.Schema(
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
    calories: { type: Number, default: 0, min: 0 },
    proteinGrams: { type: Number, default: 33, min: 0 },
    carbGrams: { type: Number, default: 37, min: 0 },
    fatGrams: { type: Number, default: 19, min: 0 },
    category: { type: String, default: "" },
    currency: { type: String, default: "SAR" },
    extraFeeHalala: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PremiumMeal", PremiumMealSchema);
