"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  event: { type: String, required: true, immutable: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  refundId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  actor: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  at: { type: Date, required: true, immutable: true },
}, { collection: "pos_audit", versionKey: false, strict: "throw" });
schema.index({ invoiceId: 1, at: 1 });
module.exports = mongoose.model("PosAudit", schema);
