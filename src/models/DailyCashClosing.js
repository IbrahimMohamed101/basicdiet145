"use strict";

const mongoose = require("mongoose");
const money = { type: Number, min: 0, default: 0, validate: Number.isSafeInteger };

const DailyCashClosingSchema = new mongoose.Schema({
  businessDate: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["draft", "submitted", "approved"], default: "draft" },
  channels: {
    restaurantHalala: { ...money },
    hungerstationHalala: { ...money },
    keetaHalala: { ...money },
    other: [{
      name: { type: String, required: true, trim: true, maxlength: 80 },
      amountHalala: { ...money },
      _id: false,
    }],
  },
  collections: {
    cashHalala: { ...money },
    cardHalala: { ...money },
  },
  confirmedSubscriptionCount: { type: Number, default: null, min: 0, validate: { validator: v => v === null || Number.isSafeInteger(v), message: "Invalid confirmed count" } },
  discrepancyReason: { type: String, trim: true, maxlength: 1000, default: "" },
  notes: { type: String, trim: true, maxlength: 1500, default: "" },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  submittedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  approvedAt: { type: Date },
  history: [{
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
    action: { type: String, enum: ["create", "edit", "submit", "return", "approve"], required: true },
    reason: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    _id: false,
  }],
}, { timestamps: true, optimisticConcurrency: true });

module.exports = mongoose.model("DailyCashClosing", DailyCashClosingSchema);
