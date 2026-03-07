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

    // Backward-compat fields used by legacy flows.
    price: { type: Number, default: 0 },
    type: { type: String, enum: ["subscription", "one_time"], default: "subscription" },
  },
  { timestamps: true }
);

AddonSchema.pre("validate", function syncLegacyPrice(next) {
  if (this.priceHalala === undefined && Number.isFinite(this.price)) {
    this.priceHalala = Math.max(0, Math.round(Number(this.price) * 100));
  }
  if ((!Number.isFinite(this.price) || this.price === 0) && Number.isFinite(this.priceHalala)) {
    this.price = Number(this.priceHalala) / 100;
  }
  next();
});

module.exports = mongoose.model("Addon", AddonSchema);
