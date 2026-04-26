const mongoose = require("mongoose");

const ZoneSchema = new mongoose.Schema(
  {
    name: { type: mongoose.Schema.Types.Mixed, required: true },
    deliveryFeeHalala: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Zone", ZoneSchema);
