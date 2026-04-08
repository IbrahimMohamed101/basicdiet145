const mongoose = require("mongoose");

const DeliverySchema = new mongoose.Schema(
  {
    // Two delivery types:
    // 1) Subscription delivery: uses subscriptionId + dayId
    // 2) One-time order delivery: uses orderId only (no subscription/day link)
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    status: { type: String, enum: ["scheduled", "out_for_delivery", "delivered", "canceled"], default: "scheduled" },
    address: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    window: { type: String },
    etaAt: { type: Date, default: null },
    arrivingSoonReminderSentAt: { type: Date, default: null },
    deliveredNotificationSentAt: { type: Date, default: null },
    deliveredAt: { type: Date },
    canceledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: null },
    cancellationCategory: { type: String, enum: ["customer_issue", "delivery_issue"], default: null },
    cancellationNote: { type: String, trim: true, default: null },
    canceledByRole: { type: String, trim: true, default: null },
    canceledByUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

DeliverySchema.index({ dayId: 1 }, { unique: true, partialFilterExpression: { dayId: { $type: "objectId" } } });
DeliverySchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { orderId: { $type: "objectId" } } });

module.exports = mongoose.model("Delivery", DeliverySchema);
