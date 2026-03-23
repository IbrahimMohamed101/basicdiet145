const mongoose = require("mongoose");

const ZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    deliveryFeeHalala: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Zone", ZoneSchema);
