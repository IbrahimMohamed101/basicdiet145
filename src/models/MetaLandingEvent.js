"use strict";
const mongoose = require("mongoose");

// Short-lived, consented, de-identified delivery queue. Do not store customer phone/name.
const MetaLandingEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, immutable: true },
  eventName: { type: String, enum: ["Lead"], required: true, default: "Lead" },
  occurredAt: { type: Date, required: true },
  sourcePath: { type: String, enum: ["/", "/menu", "/jeddah/healthy-meals"], required: true },
  fbp: { type: String, default: "" },
  fbc: { type: String, default: "" },
  state: { type: String, enum: ["pending", "processing", "sent", "failed"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

MetaLandingEventSchema.index({ state: 1, nextAttemptAt: 1 });
MetaLandingEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.MetaLandingEvent
  || mongoose.model("MetaLandingEvent", MetaLandingEventSchema);
