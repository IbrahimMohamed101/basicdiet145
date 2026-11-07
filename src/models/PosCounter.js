"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String, sequence: { type: Number, required: true, default: 0 },
}, { collection: "pos_staging_counters", versionKey: false });
module.exports = mongoose.model("PosCounter", schema);
