"use strict";

const mongoose = require("mongoose");

const EntitlementSlotSchema = new mongoose.Schema(
  {
    slotIndex: { type: Number, required: true, min: 1 },
    slotKey: { type: String, required: true, trim: true },
    entitlementBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionEntitlementBatch",
      required: true,
    },
    contributionIndex: { type: Number, required: true, min: 1 },
    sourceMealsPerDay: { type: Number, required: true, min: 1 },
    proteinGrams: { type: Number, required: true, min: 1 },
    effectiveStartDate: { type: String, required: true, trim: true },
    validityEndDate: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const FulfillmentProfileSchema = new mongoose.Schema(
  {
    signature: { type: String, required: true, trim: true },
    mealsPerDay: { type: Number, required: true, min: 1 },
    batchIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionEntitlementBatch",
    }],
  },
  { _id: false }
);

const SubscriptionEntitlementDayBlueprintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    containerSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    projectionVersion: {
      type: String,
      required: true,
      default: "subscription_stacking.v1",
      trim: true,
    },
    sourceHash: { type: String, required: true, trim: true },
    requiredSlotCount: { type: Number, required: true, min: 0 },
    slots: { type: [EntitlementSlotSchema], default: [] },
    fulfillmentProfiles: { type: [FulfillmentProfileSchema], default: [] },
    hasMixedProteinGrams: { type: Boolean, default: false },
    hasFulfillmentConflict: { type: Boolean, default: false },
    materializedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

SubscriptionEntitlementDayBlueprintSchema.pre("validate", function validateBlueprint(next) {
  const slots = Array.isArray(this.slots) ? this.slots : [];
  if (slots.length !== Number(this.requiredSlotCount || 0)) {
    this.invalidate("requiredSlotCount", "requiredSlotCount must match slots length");
  }

  const slotKeys = slots.map((slot) => String(slot && slot.slotKey || ""));
  if (new Set(slotKeys).size !== slotKeys.length) {
    this.invalidate("slots", "slotKey values must be unique within the day blueprint");
  }

  const slotIndexes = slots.map((slot) => Number(slot && slot.slotIndex || 0));
  if (new Set(slotIndexes).size !== slotIndexes.length) {
    this.invalidate("slots", "slotIndex values must be unique within the day blueprint");
  }

  const expectedIndexes = Array.from({ length: slots.length }, (_, index) => index + 1);
  if (!expectedIndexes.every((value, index) => slotIndexes[index] === value)) {
    this.invalidate("slots", "slotIndex values must be contiguous and ordered from 1");
  }

  next();
});

SubscriptionEntitlementDayBlueprintSchema.index(
  { containerSubscriptionId: 1, date: 1 },
  { unique: true, name: "uniq_subscription_entitlement_day_blueprint" }
);
SubscriptionEntitlementDayBlueprintSchema.index({ userId: 1, date: 1 });
SubscriptionEntitlementDayBlueprintSchema.index({ sourceHash: 1 });
SubscriptionEntitlementDayBlueprintSchema.index({
  containerSubscriptionId: 1,
  "slots.entitlementBatchId": 1,
  date: 1,
});

const SubscriptionEntitlementDayBlueprint =
  mongoose.models.SubscriptionEntitlementDayBlueprint
  || mongoose.model(
    "SubscriptionEntitlementDayBlueprint",
    SubscriptionEntitlementDayBlueprintSchema
  );

module.exports = SubscriptionEntitlementDayBlueprint;
