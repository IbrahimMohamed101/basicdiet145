"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String,
  invoiceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  lineId: { type: String, required: true },
  refundedQuantity: { type: Number, required: true, default: 0 },
  refundedGrossHalalas: { type: Number, required: true, default: 0 },
  refundedVatHalalas: { type: Number, required: true, default: 0 },
  refundedNetHalalas: { type: Number, required: true, default: 0 },
}, { collection: "pos_refund_balances", versionKey: false });
schema.index({ invoiceId: 1, lineId: 1 }, { unique: true });
module.exports = mongoose.model("PosRefundBalance", schema);
