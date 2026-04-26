const mongoose = require("mongoose");

const MealCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    description: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

MealCategorySchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model("MealCategory", MealCategorySchema);
