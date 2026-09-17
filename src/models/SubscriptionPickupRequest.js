const mongoose = require("mongoose");

const SUBSCRIPTION_PICKUP_REQUEST_STATUSES = [
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "fulfilled",
  "no_show",
  "canceled",
];

const PICKUP_RESERVATION_STATES = [
  "pending",
  "reserving",
  "reserved",
  "consumed",
  "released",
  "failed",
];

const SubscriptionPickupRequestSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    mealCount: {
      type: Number,
      required: true,
      min: 0,
    },
    selectedMealSlotIds: {
      type: [String],
      default: undefined,
    },
    selectedPickupItemIds: {
      type: [String],
      default: undefined,
    },
    selectedPickupItems: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },
    requestPayloadHash: { type: String, trim: true, default: null },
    selectionMode: {
      type: String,
      enum: ["pickup_item_ids", "slot_ids", "legacy_meal_count"],
      default: "legacy_meal_count",
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_PICKUP_REQUEST_STATUSES,
      default: "locked",
      required: true,
    },
    pickupCode: { type: String, trim: true, default: null },
    pickupCodeIssuedAt: { type: Date, default: null },
    preparationStartedAt: { type: Date, default: null },
    pickupPreparedAt: { type: Date, default: null },
    pickupNoShowAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    fulfilledByDashboardUserId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
    canceledAt: { type: Date, default: null },
    canceledBy: { type: String, trim: true, default: null },
    cancellationReason: { type: String, trim: true, default: null },
    cancellationNote: { type: String, trim: true, default: null },
    settledAt: { type: Date, default: null },
    settlementReason: { type: String, trim: true, default: null },
    settledBy: { type: String, trim: true, default: null },
    creditsReserved: { type: Boolean, default: false },
    creditsReservedAt: { type: Date, default: null },
    creditsConsumedAt: { type: Date, default: null },
    creditsReleasedAt: { type: Date, default: null },
    reservationState: {
      type: String,
      enum: PICKUP_RESERVATION_STATES,
      default: "pending",
      index: true,
    },
    reservationAttemptCount: { type: Number, min: 0, default: 0 },
    lastReservationAttemptAt: { type: Date, default: null },
    reservationCompletedAt: { type: Date, default: null },
    reservationErrorCode: { type: String, trim: true, default: null },
    reservationErrorMessage: { type: String, trim: true, default: null },
    // Server-derived entitlement references; never required from a client.
    baseAllocationKeys: { type: [String], default: undefined },
    baseAllocationMode: {
      type: String,
      enum: ["none", "linked_day", "standalone"],
      default: "none",
    },
    idempotencyKey: { type: String, trim: true, default: null },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    operationAuditLog: {
      type: [
        {
          action: { type: String, required: true },
          by: { type: String, default: "" },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

SubscriptionPickupRequestSchema.index({ subscriptionId: 1, date: 1, createdAt: -1 });
SubscriptionPickupRequestSchema.index({ subscriptionId: 1, status: 1 });
SubscriptionPickupRequestSchema.index({ userId: 1, date: 1, createdAt: -1 });
SubscriptionPickupRequestSchema.index({ pickupCode: 1, status: 1 });
SubscriptionPickupRequestSchema.index({ reservationState: 1, lastReservationAttemptAt: 1 });
SubscriptionPickupRequestSchema.index(
  { subscriptionId: 1, userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $type: "string" },
    },
  }
);

module.exports = mongoose.model("SubscriptionPickupRequest", SubscriptionPickupRequestSchema);
