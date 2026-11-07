"use strict";
const mongoose = require("mongoose");
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
}, { collection: "pos_ledgers", versionKey: false, strict: "throw" });
schema.index({ recordedAt: -1, type: 1 });
module.exports = mongoose.model("PosLedger", schema);
