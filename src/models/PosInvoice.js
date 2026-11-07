"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  sequence: { type: Number, required: true, immutable: true },
  number: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  payloadHash: { type: String, required: true, immutable: true },
  publishedRevision: { type: Number, required: true, immutable: true },
  channel: { type: String, required: true, immutable: true },
  serviceMode: { type: String, required: true, immutable: true },
  externalOrderNumber: { type: String, default: null, immutable: true },
  appPaymentStatus: { type: String, default: null, immutable: true },
  actor: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  lines: { type: [mongoose.Schema.Types.Mixed], required: true, immutable: true },
  totals: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  invoiceDiscount: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  tender: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  documentKind: { type: String, required: true, enum: ["STAGING_TEST_NON_TAX"], immutable: true },
  note: { type: String, required: true, default: "فاتورة تجريبية — غير ضريبية", immutable: true },
  issuedAt: { type: Date, required: true, immutable: true },
}, { collection: "pos_invoices", strict: "throw", versionKey: false });
schema.index({ channel: 1, issuedAt: -1 });
module.exports = mongoose.model("PosInvoice", schema);
