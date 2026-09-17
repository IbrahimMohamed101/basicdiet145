const mongoose = require("mongoose");

const EmailOtpChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true, index: true },
    lookupKey: { type: String, required: true, unique: true, index: true },
    purpose: {
      type: String,
      required: true,
      enum: ["registration", "verify_existing_email", "password_reset"],
      index: true,
    },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: true },
    cleanupAt: { type: Date, required: true },
    attemptsLeft: { type: Number, required: true, min: 0 },
    lastSentAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null, index: true },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null },
    resetTokenUsedAt: { type: Date, default: null },
    pendingRegistration: {
      fullName: { type: String, trim: true },
      phoneE164: { type: String },
      passwordHash: { type: String, select: false },
    },
  },
  { timestamps: true, collection: "email_otp_challenges" }
);

EmailOtpChallengeSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
EmailOtpChallengeSchema.index({ purpose: 1, email: 1, consumedAt: 1 });
EmailOtpChallengeSchema.index(
  { resetTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { resetTokenHash: { $type: "string", $gt: "" } },
  }
);

module.exports = mongoose.model("EmailOtpChallenge", EmailOtpChallengeSchema);
