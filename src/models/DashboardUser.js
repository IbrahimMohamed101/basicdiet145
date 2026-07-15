const mongoose = require("mongoose");
const { DASHBOARD_ROLES } = require("../constants/dashboardRoles");

const DashboardUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: DASHBOARD_ROLES, required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DashboardUser", DashboardUserSchema);
