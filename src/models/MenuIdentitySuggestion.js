const mongoose = require("mongoose");

const MenuIdentitySuggestionSchema = new mongoose.Schema(
  {
    identityKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    identityName: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    type: {
      type: String,
      enum: ["product", "protein", "carb", "addon", "category", "other"],
      required: true,
    },
    proposedLinks: [
      {
        channel: { type: String, enum: ["one_time", "subscription"], required: true },
        sourceModel: { type: String, required: true },
        sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
        sourceKey: { type: String },
        sourceDisplayName: { type: String },
        sourceType: { type: String },
      },
    ],
    confidence: { type: String, enum: ["exact", "alias", "manual"], default: "manual" },
    reason: { type: String },
    warnings: [String],
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
    reviewedAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

// Ensure we don't have multiple pending suggestions for the exact same source link set if needed
// But for now, simple indexes are enough.

module.exports = mongoose.model("MenuIdentitySuggestion", MenuIdentitySuggestionSchema);
