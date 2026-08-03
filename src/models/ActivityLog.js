const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true }, // subscription_day, delivery
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, required: true }, // state_change, arriving_soon, delivered, pickup_prepare, etc
    byUserId: { type: mongoose.Schema.Types.ObjectId },
    byRole: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Performance: Activity log queries commonly filter by entityType/entityId and sort by time.
ActivityLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
ActivityLogSchema.index({ entityType: 1, createdAt: -1 }, { background: true });
ActivityLogSchema.index(
  { entityType: 1, action: 1, entityId: 1, "meta.businessDate": 1 },
  {
    name: "delivery_manual_subscription_deduction_once_per_day",
    unique: true,
    partialFilterExpression: {
      entityType: "subscription",
      action: "manual_subscription_meal_deduction",
      "meta.fulfillmentMethod": "delivery",
    },
  }
);
ActivityLogSchema.index(
  { entityType: 1, action: 1, entityId: 1, "meta.repairKey": 1 },
  {
    name: "subscription_manual_deduction_reversal_repair_once",
    unique: true,
    partialFilterExpression: {
      entityType: "subscription",
      action: "subscription_manual_deduction_reversal",
      "meta.repairKey": { $type: "string" },
    },
  }
);

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
