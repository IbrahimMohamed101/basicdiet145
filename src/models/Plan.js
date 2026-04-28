const mongoose = require("mongoose");

const MealsOptionSchema = new mongoose.Schema(
  {
    mealsPerDay: { type: Number, required: true },
    priceHalala: { type: Number, required: true },
    compareAtHalala: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const GramsOptionSchema = new mongoose.Schema(
  {
    grams: { type: Number, required: true },
    mealsOptions: { type: [MealsOptionSchema], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const PlanSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    description: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    daysCount: { type: Number, required: true },
    currency: { type: String, default: "SAR" },
    gramsOptions: { type: [GramsOptionSchema], default: [] },
    skipPolicy: {
      enabled: { type: Boolean, default: true },
      maxDays: { type: Number, default: 0, min: 0 },
    },
    freezePolicy: {
      enabled: { type: Boolean, default: true },
      maxDays: { type: Number, default: 31 },
      maxTimes: { type: Number, default: 1 },
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PlanSchema.statics.isViable = function (plan) {
  if (!plan) return false;
  const activeGramsOptions = (plan.gramsOptions || []).filter((g) => g.isActive !== false);
  if (activeGramsOptions.length === 0) return false;

  return activeGramsOptions.every((gramsOption) => {
    const activeMealsOptions = (gramsOption.mealsOptions || []).filter((mealOption) => mealOption.isActive !== false);
    if (activeMealsOptions.length === 0) return false;

    return activeMealsOptions.every((mealOption) => Number.isInteger(mealOption.priceHalala) && mealOption.priceHalala > 0);
  });
};

PlanSchema.methods.isViable = function () {
  return this.constructor.isViable(this);
};

module.exports = mongoose.model("Plan", PlanSchema);
