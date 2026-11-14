"use strict";
const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  kind: { type: String, enum: ["sale", "refund"], required: true },
  operatorId: { type: String, required: true },
  payloadHash: { type: String, default: null },
  status: { type: String, enum: ["pending", "committed", "rejected", "abandoned"], required: true },
  resultId: { type: mongoose.Schema.Types.ObjectId, default: null },
  resultNumber: { type: String, default: null },
  errorCode: { type: String, default: null },
}, { collection: "pos_operations", timestamps: true, versionKey: false, strict: "throw" });

// One unresolved operation per cashier and operation type. Never auto-expire pending
// records: only explicit abandonment or transaction settlement can release the fence.
schema.index({ operatorId: 1, kind: 1 }, {
  unique: true, partialFilterExpression: { status: "pending" },
});
module.exports = mongoose.model("PosOperation", schema);
