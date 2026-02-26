const mongoose = require("mongoose");

const AppUserSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ["app_user"], default: "app_user", immutable: true },
    fcmTokens: [{ type: String }],
    coreUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "app_users" }
);

AppUserSchema.index({ phone: 1 }, { unique: true });
AppUserSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("AppUser", AppUserSchema);
