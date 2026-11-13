"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, immutable: true },
  branchId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  isActive: { type: Boolean, default: true },
  printer: {
    paperWidthMm: { type: Number, enum: [58, 80], default: 80 },
    label: { type: String, maxlength: 120 },
  },
}, { timestamps: true, autoIndex: false, collection: "pos_terminals" });
schema.index({ code: 1 }, { name: "pos_terminal_code", unique: true });
schema.index({ branchId: 1, isActive: 1 }, { name: "pos_terminal_branch_active" });
module.exports = mongoose.model("PosTerminal", schema);
