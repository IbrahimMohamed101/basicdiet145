const mongoose = require("mongoose");

const SubscriptionAuditLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true }, // subscription_day, subscription
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, required: true }, // transition, lock, skip, freeze, cancel
    fromStatus: { type: String },
    toStatus: { type: String },
    actorType: { type: String, required: true }, // system, client, admin, kitchen, courier
    actorId: { type: mongoose.Schema.Types.ObjectId },
    note: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

SubscriptionAuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model("SubscriptionAuditLog", SubscriptionAuditLogSchema);
