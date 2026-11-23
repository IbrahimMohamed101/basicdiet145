"use strict";
const mongoose = require("mongoose");
const { nonnegativeHalala: money, signedHalala } = require("../money");
const movement = new mongoose.Schema({
  type: { type: String, enum: ["paid_in","paid_out"], required: true },
  amountHalala: { ...money, min: 1, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });
const schema = new mongoose.Schema({
  branchId: { type: String, required: true, trim: true },
  terminalId: { type: String, required: true, trim: true },
  cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["open","closed"], default: "open" },
  openingFloatHalala: { ...money, required: true },
  cashMovements: { type: [movement], default: [] },
  totals: {
    salesHalala: money, refundsHalala: money,
    byMethod: { cashHalala: money, cardHalala: money, deliveryCompanyHalala: money },
  },
  closing: {
    countedCashHalala: money, expectedCashHalala: money,
    varianceHalala: signedHalala,
    note: { type: String, maxlength: 1000 },
    closedAt: Date, closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  },
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false, collection: "pos_shifts" });
schema.index({ terminalId: 1 }, { name: "pos_one_open_shift_per_terminal", unique: true, partialFilterExpression: { status: "open" } });
schema.index({ branchId: 1, businessDate: 1 }, { name: "pos_shifts_branch_date" });
module.exports = mongoose.model("PosShift", schema);
