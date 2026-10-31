"use strict";
const mongoose = require("mongoose");
// Append-only staff observation; never contacts customers.
// Event ID serves as atomic MongoDB idempotency key.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  channel: { type: String, enum: ["phone", "whatsapp", "in_person", "other"], required: true },
  outcome: { type: String, enum: [
    "no_answer", "contacted", "interested", "callback_requested",
    "not_interested", "client_claims_renewed", "do_not_contact",
  ], required: true },
  reasonCode: { type: String, enum: [
    "unknown", "price", "menu", "delivery", "quality", "payment", "no_need", "other",
  ], default: "unknown" },
  note: { type: String, trim: true, maxlength: 500, default: "" },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });
module.exports = mongoose.models.RetentionFollowupEvent
  || mongoose.model("RetentionFollowupEvent", schema);
