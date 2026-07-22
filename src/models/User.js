const mongoose = require("mongoose");

const MIN_TEMP_PASSWORD_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

function effectiveTemporaryPasswordExpiry(value, issuedAt, forcePasswordChange) {
  if (forcePasswordChange !== true || !issuedAt) return value || null;

  const issuedAtMs = new Date(issuedAt).getTime();
  if (!Number.isFinite(issuedAtMs)) return value || null;

  const minimumExpiry = new Date(issuedAtMs + MIN_TEMP_PASSWORD_VALIDITY_MS);
  const storedExpiryMs = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(storedExpiryMs) || storedExpiryMs < minimumExpiry.getTime()) {
    return minimumExpiry;
  }

  return value;
}

function sanitizeUserObject(_doc, ret) {
  delete ret.passwordHash;
  ret.temporaryPasswordExpiresAt = effectiveTemporaryPasswordExpiry(
    ret.temporaryPasswordExpiresAt,
    ret.temporaryPasswordIssuedAt,
    ret.forcePasswordChange
  );
  return ret;
}

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    phoneE164: { type: String },
    phoneVerified: { type: Boolean, default: false },
    passwordHash: { type: String, default: null },
    passwordSetAt: { type: Date, default: null },
    forcePasswordChange: { type: Boolean, default: false },
    passwordChangedAt: { type: Date, default: null },
    authVersion: { type: Number, default: 0 },
    authProvider: { type: String, default: "otp" },
    authMethods: [{ type: String }],
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    name: { type: String },
    email: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ["client", "admin", "kitchen", "courier"], default: "client" },
    isActive: { type: Boolean, default: true },
    accountStatus: { type: String, enum: ["active", "pending_activation", "reset_requested"], default: "active" },
    resetRequestedAt: { type: Date, default: null },
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
    temporaryPasswordIssuedAt: { type: Date, default: null },
    temporaryPasswordExpiresAt: {
      type: Date,
      default: null,
      get(value) {
        return effectiveTemporaryPasswordExpiry(
          value,
          this.temporaryPasswordIssuedAt,
          this.forcePasswordChange
        );
      },
    },
    temporaryPasswordGeneration: { type: Number, default: 0 },
    temporaryPasswordReason: {
      type: String,
      enum: ["admin_created", "admin_reset", null],
      default: null,
    },
    lastAdminPasswordResetAt: { type: Date, default: null },
    lastAdminPasswordResetBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
    fcmTokens: [{ type: String }],
  },
  { timestamps: true }
);

UserSchema.set("toJSON", {
  transform: sanitizeUserObject,
});

UserSchema.set("toObject", {
  transform: sanitizeUserObject,
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

UserSchema.pre("validate", function syncPhoneAndTemporaryPasswordFields(next) {
  if (!this.phoneE164 && this.phone) {
    this.phoneE164 = this.phone;
  }
  if (!this.phone && this.phoneE164) {
    this.phone = this.phoneE164;
  }
  if (this.forcePasswordChange === true && this.temporaryPasswordIssuedAt) {
    this.temporaryPasswordExpiresAt = effectiveTemporaryPasswordExpiry(
      this.temporaryPasswordExpiresAt,
      this.temporaryPasswordIssuedAt,
      true
    );
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);
