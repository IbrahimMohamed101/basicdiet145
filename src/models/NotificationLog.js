const mongoose = require("mongoose");

const NotificationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String },
    dedupeKey: { type: String },
    entityType: { type: String },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed },
    scheduledFor: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    status: { type: String, enum: ["processing", "sent", "failed", "no_tokens"], default: "sent" },
    error: { type: String },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    errorCodes: [{ type: String }],
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

NotificationLogSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("NotificationLog", NotificationLogSchema);
