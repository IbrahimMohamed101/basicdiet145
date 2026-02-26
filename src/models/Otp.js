const mongoose = require("mongoose");

const OtpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attemptsLeft: { type: Number, required: true, min: 0 },
    lastSentAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "otps" }
);

OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Otp", OtpSchema);
