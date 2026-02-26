const mongoose = require("mongoose");

const MealSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    type: { type: String, enum: ["regular", "premium"], default: "regular" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meal", MealSchema);
