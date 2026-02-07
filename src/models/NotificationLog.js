const mongoose = require("mongoose");

const NotificationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    errorCodes: [{ type: String }],
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationLog", NotificationLogSchema);
