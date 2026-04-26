const mongoose = require("mongoose");

const BuilderCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    dimension: { type: String, enum: ["protein", "carb"], required: true },
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
    rules: {
      dailyLimit: { type: Number, min: 1, default: null },
      ruleKey: { type: String, default: null, trim: true },
    },
  },
  { timestamps: true }
);

BuilderCategorySchema.index({ dimension: 1, key: 1 }, { unique: true });
BuilderCategorySchema.index({ dimension: 1, isActive: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("BuilderCategory", BuilderCategorySchema);
