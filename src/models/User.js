const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    phoneE164: { type: String },
    phoneVerified: { type: Boolean, default: false },
    passwordHash: { type: String, default: null },
    passwordSetAt: { type: Date, default: null },
    forcePasswordChange: { type: Boolean, default: false },
    passwordChangedAt: { type: Date, default: null },
    authProvider: { type: String, default: "otp" },
    authMethods: [{ type: String }],
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    name: { type: String },
    email: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ["client", "admin", "kitchen", "courier"], default: "client" },
    isActive: { type: Boolean, default: true },
    fcmTokens: [{ type: String }],
  },
  { timestamps: true }
);

UserSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

UserSchema.set("toObject", {
  transform(_doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

UserSchema.index(
  { email: 1 },
  {
    name: "email_1_unique_sparse",
    unique: true,
    sparse: true,
    partialFilterExpression: { email: { $type: "string", $ne: "" } },
  }
);

UserSchema.index(
  { phoneE164: 1 },
  {
    name: "phoneE164_1_unique_sparse",
    unique: true,
    sparse: true,
    partialFilterExpression: { phoneE164: { $type: "string", $ne: "" } },
  }
);

UserSchema.index({ role: 1, createdAt: -1 });

UserSchema.pre("validate", function syncPhoneFields(next) {
  if (!this.phoneE164 && this.phone) {
    this.phoneE164 = this.phone;
  }
  if (!this.phone && this.phoneE164) {
    this.phone = this.phoneE164;
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);
