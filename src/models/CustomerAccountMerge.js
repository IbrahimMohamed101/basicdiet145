"use strict";

const mongoose = require("mongoose");

const CustomerAccountMergeSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourcePhone: { type: String, required: true },
    targetPhone: { type: String, required: true },
    reason: { type: String, required: true },
    state: {
      type: String,
      enum: ["pending", "in_progress", "completed", "failed"],
      default: "pending",
      index: true,
    },
    completedSteps: { type: [String], default: [] },
    previewCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    conflicts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
    actorRole: { type: String, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

CustomerAccountMergeSchema.index({ targetUserId: 1, createdAt: -1 });

module.exports = mongoose.model("CustomerAccountMerge", CustomerAccountMergeSchema);
