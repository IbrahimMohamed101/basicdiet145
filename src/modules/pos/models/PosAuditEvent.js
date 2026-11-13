"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  type: { type: String, required: true, enum: [
    "discount","void","refund","drawer_open","price_override","shift_open","shift_close","cash_movement",
  ] },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "PosOrder" },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "PosShift" },
  branchId: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  at: { type: Date, default: Date.now },
}, { autoIndex: false, versionKey: false, collection: "pos_audit_events" });
schema.index({ shiftId: 1, at: 1 }, { name: "pos_audit_shift_at" });
schema.index({ orderId: 1, at: 1 }, { name: "pos_audit_order_at" });
module.exports = mongoose.model("PosAuditEvent", schema);
