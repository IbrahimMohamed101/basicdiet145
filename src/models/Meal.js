const mongoose = require("mongoose");

const MealSchema = new mongoose.Schema(
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
    type: { type: String, enum: ["regular", "premium"], default: "regular" },
    availableForOrder: { type: Boolean, default: true },
    availableForSubscription: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meal", MealSchema);
