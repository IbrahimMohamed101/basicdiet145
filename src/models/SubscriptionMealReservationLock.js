"use strict";

const mongoose = require("mongoose");

const SubscriptionMealReservationLockSchema = new mongoose.Schema(
  {
    subscriptionDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionDay",
      required: true,
      unique: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    date: { type: String, required: true, trim: true, index: true },
    token: { type: String, required: true, trim: true },
    leaseExpiresAt: { type: Date, required: true, index: true },
    acquiredAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SubscriptionMealReservationLockSchema.index({ leaseExpiresAt: 1, releasedAt: 1 });

module.exports = mongoose.model(
  "SubscriptionMealReservationLock",
  SubscriptionMealReservationLockSchema
);
