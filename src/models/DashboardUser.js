const mongoose = require("mongoose");

const DashboardUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ["admin", "kitchen", "courier"], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DashboardUser", DashboardUserSchema);
