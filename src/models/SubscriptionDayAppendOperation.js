const mongoose = require("mongoose");

const APPEND_OPERATION_STATUSES = [
  "started",
  "day_saved",
  "payment_pending",
  "credits_reserved",
  "addons_reserved",
  "completed",
  "compensating",
  "compensated",
  "recovery_required",
  "failed",
];

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
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: APPEND_OPERATION_STATUSES,
      default: "started",
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    leaseToken: { type: String, default: "", trim: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    attemptCount: { type: Number, min: 0, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    preSlotCount: { type: Number, min: 0, default: 0 },
    expectedSlotKeys: { type: [String], default: [] },
    appendedSlotKeys: { type: [String], default: [] },
    allocationKeys: { type: [String], default: [] },
    newlyChangedAllocationKeys: { type: [String], default: [] },
    previousPlannerRevisionHash: { type: String, default: "", trim: true },
    appliedPlannerRevisionHash: { type: String, default: "", trim: true },
    compensationPlannerRevisionHash: { type: String, default: "", trim: true },
    previousDaySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    previousExplicitAddonSelections: { type: [mongoose.Schema.Types.Mixed], default: [] },
    paymentRequired: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    daySavedAt: { type: Date, default: null },
    creditsReservedAt: { type: Date, default: null },
    addonsReservedAt: { type: Date, default: null },
    paymentPendingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    compensationStartedAt: { type: Date, default: null },
    compensatedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureStep: { type: String, default: null, trim: true },
    errorCode: { type: String, default: null, trim: true },
    errorMessage: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

SubscriptionDayAppendOperationSchema.index(
  { subscriptionId: 1, date: 1, idempotencyKey: 1 },
  { unique: true }
);

// Only one unresolved append may own a subscription day at a time. The lease
// fields allow the same durable operation to resume after a process crash.
SubscriptionDayAppendOperationSchema.index(
  { subscriptionDayId: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
  }
);
SubscriptionDayAppendOperationSchema.index({ active: 1, leaseExpiresAt: 1, status: 1 });

module.exports = mongoose.model(
  "SubscriptionDayAppendOperation",
  SubscriptionDayAppendOperationSchema
);
