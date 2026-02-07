const mongoose = require("mongoose");

const DeliverySchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay", required: true },
    courierId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["scheduled", "out_for_delivery", "delivered"], default: "scheduled" },
    address: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    window: { type: String },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

DeliverySchema.index({ dayId: 1 }, { unique: true });

module.exports = mongoose.model("Delivery", DeliverySchema);
