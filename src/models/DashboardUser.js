const mongoose = require("mongoose");

const DashboardUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "kitchen", "courier"], required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DashboardUser", DashboardUserSchema);
