const mongoose = require("mongoose");

const AddonSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    price: { type: Number, required: true },
    type: { type: String, enum: ["subscription", "one_time"], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Addon", AddonSchema);
