const mongoose = require("mongoose");

const MealSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["regular", "premium"], default: "regular" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meal", MealSchema);
