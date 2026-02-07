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

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
