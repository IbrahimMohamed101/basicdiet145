"use strict";
const mongoose = require("mongoose");
const { businessDateAt } = require("../services/pos/businessDate");
const schema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, immutable: true },
  invoiceNumber: { type: String, required: true, immutable: true },
  type: { type: String, required: true, enum: ["restaurant_cash", "restaurant_network", "app_receivable"], immutable: true },
  amountHalalas: { type: Number, required: true, immutable: true },
  amountReceivedHalalas: { type: Number, default: null, immutable: true },
  cashChangeHalalas: { type: Number, default: null, immutable: true },
  channel: { type: String, required: true, immutable: true },
  externalPaymentStatus: { type: String, default: null, immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
  businessDate: { type: String, default: () => businessDateAt(), immutable: true },
  refunds: { type: [{
    refundId: { type: mongoose.Schema.Types.ObjectId, required: true },
    refundNumber: { type: String, required: true },
    type: { type: String, enum: ["refund"], required: true },
    amountHalalas: { type: Number, required: true, max: 0, validate: Number.isSafeInteger },
    method: { type: String, required: true },
    businessDate: { type: String, required: true },
    recordedAt: { type: Date, required: true },
    _id: false,
  }], default: [] },
}, { collection: "pos_ledgers", versionKey: false, strict: "throw" });
schema.index({ recordedAt: -1, type: 1 });
schema.index({ businessDate: 1, type: 1 });
schema.index({ "refunds.businessDate": 1 });
module.exports = mongoose.model("PosLedger", schema);
