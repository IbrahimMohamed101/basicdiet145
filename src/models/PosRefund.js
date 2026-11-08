"use strict";
const mongoose = require("mongoose");
const { businessDateAt } = require("../services/pos/businessDate");
const schema = new mongoose.Schema({
  sequence: { type: Number, required: true, immutable: true },
  number: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  payloadHash: { type: String, required: true, immutable: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  invoiceNumber: { type: String, required: true, immutable: true },
  actor: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  reason: { type: String, required: true, immutable: true },
  method: { type: String, required: true, immutable: true },
  lines: { type: [mongoose.Schema.Types.Mixed], required: true, immutable: true },
  totals: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  documentKind: { type: String, required: true, enum: ["STAGING_TEST_NON_TAX"], immutable: true },
  note: { type: String, required: true, default: "مرتجع تجريبي — لا يمثل رد مبالغ فعلي", immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
  businessDate: { type: String, default: () => businessDateAt(), required: true, immutable: true },
}, { collection: "pos_refunds", strict: "throw", versionKey: false });
schema.index({ invoiceId: 1, recordedAt: -1 });
schema.index({ businessDate: 1, method: 1 });
module.exports = mongoose.model("PosRefund", schema);
