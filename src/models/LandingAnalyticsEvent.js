"use strict";
const mongoose = require("mongoose");

const EVENTS = [
  "lp_view", "lp_section_view", "lp_cta_click", "lp_store_click",
  "lp_nav_click", "lp_faq_open", "lp_reel_click",
];

const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, immutable: true },
  sessionId: { type: String, required: true, index: true },
  event: { type: String, required: true, enum: EVENTS, index: true },
  path: { type: String, required: true, default: "/" },
  device: { type: String, enum: ["ios", "android", "desktop", "other"], default: "other" },
  referrerHost: { type: String, default: "" },
  source: { type: String, default: "" },
  medium: { type: String, default: "" },
  campaign: { type: String, default: "" },
  content: { type: String, default: "" },
  term: { type: String, default: "" },
  location: { type: String, default: "" },
  section: { type: String, default: "" },
  platform: { type: String, default: "" },
  store: { type: String, default: "" },
  action: { type: String, default: "" },
  reel: { type: String, default: "" },
  planDays: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false, strict: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ createdAt: -1, event: 1 });
schema.index({ event: 1, createdAt: -1, source: 1 });
module.exports = mongoose.models.LandingAnalyticsEvent || mongoose.model("LandingAnalyticsEvent", schema);
