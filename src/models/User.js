const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    name: { type: String },
    email: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ["client", "admin", "kitchen", "courier"], default: "client" },
    isActive: { type: Boolean, default: true },
    fcmTokens: [{ type: String }],
  },
  { timestamps: true }
);

UserSchema.index(
  { email: 1 },
  {
    name: "email_1_unique_sparse",
    unique: true,
    sparse: true,
    partialFilterExpression: { email: { $type: "string", $ne: "" } },
  }
);

module.exports = mongoose.model("User", UserSchema);
