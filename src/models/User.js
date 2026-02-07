const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    name: { type: String },
    role: { type: String, enum: ["client", "admin", "kitchen", "courier"], default: "client" },
    isActive: { type: Boolean, default: true },
    fcmTokens: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
