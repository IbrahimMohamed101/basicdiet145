const mongoose = require("mongoose");

const AddonSchema = new mongoose.Schema(
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
    priceHalala: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "SAR" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

    // New explicit billing behavior control.
    // flat_once: total = price (usually for ad-hoc one-day purchase)
    // per_day: total = price * days (standard for subscription plans)
    // per_meal: total = price * days * mealsPerDay
    billingMode: {
      type: String,
      enum: ["flat_once", "per_day", "per_meal"],
      default: "per_day",
    },

    // New Addon categorization
    // plan: The entity purchased at checkout (e.g. "Juice Subscription Plan")
    // item: The specific entity selected daily (e.g. "Orange Juice")
    kind: {
      type: String,
      enum: ["plan", "item"],
      default: "item",
      required: true,
    },

    category: {
      type: String,
      enum: ["juice", "snack", "small_salad"],
      required: true,
      trim: true,
    },

    // Backward-compat fields.
    price: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AddonSchema.pre("validate", function syncBillingModeAndKind(next) {
  // 1. Sync legacy priceHalala
  if (this.priceHalala === undefined && Number.isFinite(this.price)) {
    this.priceHalala = Math.max(0, Math.round(Number(this.price) * 100));
  }
  if ((!Number.isFinite(this.price) || this.price === 0) && Number.isFinite(this.priceHalala)) {
    this.price = Number(this.priceHalala) / 100;
  }

  // 2. Sync billingMode and kind
  // If kind is "item", billingMode should usually be "flat_once" (as it's priced per selection)
  if (this.kind === "item" && !this.isModified("billingMode")) {
    this.billingMode = "flat_once";
  }
  // If kind is "plan", billingMode is usually "per_day" (subscription)
  if (this.kind === "plan" && !this.isModified("billingMode")) {
    this.billingMode = "per_day";
  }

  next();
});

module.exports = mongoose.model("Addon", AddonSchema);
