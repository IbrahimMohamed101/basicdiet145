const mongoose = require("mongoose");

const SubscriptionDayAppendOperationSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    subscriptionDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: String, required: true, trim: true, index: true },
    idempotencyKey: { type: String, required: true, trim: true },
    requestHash: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["started", "day_saved", "credits_reserved", "completed", "failed", "compensated"],
      default: "started",
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    preSlotCount: { type: Number, min: 0, default: 0 },
    expectedSlotKeys: { type: [String], default: [] },
    appendedSlotKeys: { type: [String], default: [] },
    allocationKeys: { type: [String], default: [] },
    previousPlannerRevisionHash: { type: String, default: "", trim: true },
    appliedPlannerRevisionHash: { type: String, default: "", trim: true },
    previousDaySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    errorCode: { type: String, default: null, trim: true },
    errorMessage: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

SubscriptionDayAppendOperationSchema.index(
  { subscriptionId: 1, date: 1, idempotencyKey: 1 },
  { unique: true }
);

// Standalone MongoDB has no multi-document rollback boundary. This unique active
// operation lock serializes append mutations per subscription day while a durable
// operation record lets retries resume instead of appending the same meals twice.
SubscriptionDayAppendOperationSchema.index(
  { subscriptionDayId: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
  }
);

module.exports = mongoose.model(
  "SubscriptionDayAppendOperation",
  SubscriptionDayAppendOperationSchema
);
