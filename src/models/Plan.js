const mongoose = require("mongoose");

const PlanSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    daysCount: { type: Number, required: true },
    mealsPerDay: { type: Number, required: true },
    grams: { type: Number, required: true },
    price: { type: Number, required: true },
    skipAllowance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plan", PlanSchema);
