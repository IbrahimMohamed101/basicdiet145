"use strict";
const mongoose = require("mongoose");

const LandingLeadSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, default: "" },
  phone: { type: String, required: true },
  phoneHash: { type: String, required: true, select: false },
  dayBucket: { type: String, required: true, select: false },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
  daysCount: { type: Number, required: true },
  grams: { type: Number, required: true },
  mealsPerDay: { type: Number, required: true },
  contactConsent: { type: Boolean, required: true },
  marketingConsent: { type: Boolean, default: false },
  consentAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ["new", "contacted", "interested", "converted", "not_interested"],
    default: "new",
  },
  contactedAt: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
  staffNote: { type: String, default: "" },
  source: { type: String, default: "" },
  medium: { type: String, default: "" },
  campaign: { type: String, default: "" },
  content: { type: String, default: "" },
  referrerHost: { type: String, default: "" },
  location: { type: String, default: "" },
  sessionId: { type: String, default: "" },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

LandingLeadSchema.index({ phoneHash: 1, dayBucket: 1 }, { unique: true });
LandingLeadSchema.index({ createdAt: -1, status: 1 });
LandingLeadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.LandingLead || mongoose.model("LandingLead", LandingLeadSchema);
