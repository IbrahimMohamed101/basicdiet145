"use strict";
const mongoose = require("mongoose");
// Provisional receipt counter only; not a ZATCA tax invoice sequence.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
}, { versionKey: false, autoIndex: false, collection: "pos_counters" });
module.exports = mongoose.model("PosCounter", schema);
