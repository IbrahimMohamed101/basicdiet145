"use strict";
const mongoose = require("mongoose");
const { nonnegativeHalala: money } = require("../money");
const positiveQty = { type: Number, required: true, min: 1, validate: Number.isSafeInteger };
const localized = new mongoose.Schema({ ar: String, en: String }, { _id: false });
const item = new mongoose.Schema({
  lineId: { type: String, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  nameSnapshot: localized,
  qty: positiveQty,
  weightGrams: { type: Number, min: 0, validate: Number.isSafeInteger },
  options: [{ optionId: mongoose.Schema.Types.ObjectId, nameSnapshot: localized, qty: positiveQty, totalHalala: money, _id: false }],
  unitPriceHalala: { ...money, required: true },
  lineDiscountHalala: money,
  lineTotalHalala: { ...money, required: true },
  note: { type: String, maxlength: 300 },
}, { _id: false });
const pay = new mongoose.Schema({
  method: { type: String, required: true, enum: ["cash","card","delivery_company"] },
  amountHalala: { ...money, required: true, min: 1 },
  tenderedHalala: money, changeHalala: money,
  reference: { type: String, maxlength: 150 },
  deliveryCompany: { type: String, maxlength: 80 },
  at: { type: Date, default: Date.now },
}, { _id: false });
const refund = new mongoose.Schema({
  refundId: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  lines: [{ lineId: String, qty: positiveQty, _id: false }],
  amountHalala: { ...money, required: true, min: 1 },
  method: { type: String, required: true, enum: ["cash","card","delivery_company"] },
  reason: { type: String, required: true, maxlength: 500 },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });
const schema = new mongoose.Schema({
  receiptNumber: { type: String, required: true, immutable: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "PosShift", required: true, immutable: true },
  branchId: { type: String, required: true, immutable: true },
  businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  channel: { type: String, required: true, enum: ["dine_in","takeaway","delivery_company"] },
  deliveryCompany: { type: String, maxlength: 80 },
  status: { type: String, default: "held", enum: ["held","sent_to_kitchen","paid","voided","refunded","partially_refunded"] },
  customer: { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, name: String, phone: String },
  items: { type: [item], default: [] },
  pricing: {
    grossHalala: { ...money, required: true }, discountHalala: money,
    totalHalala: { ...money, required: true }, vatPercentage: { type: Number, default: 15, min: 0, max: 100 },
    vatHalala: { ...money, required: true }, netHalala: { ...money, required: true },
  },
  discount: { type: { type: String, enum: ["amount","percent"] }, value: money, reason: String, approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" } },
  payments: { type: [pay], default: [] }, refunds: { type: [refund], default: [] },
  idempotencyKey: { type: String, required: true, immutable: true }, requestHash: { type: String, required: true, immutable: true },
}, { timestamps: true, optimisticConcurrency: true, autoIndex: false, collection: "pos_orders" });
schema.index({ receiptNumber: 1 }, { name: "pos_order_receipt_unique", unique: true });
schema.index({ idempotencyKey: 1 }, { name: "pos_order_idempotency_unique", unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
schema.index({ shiftId: 1, createdAt: -1 }, { name: "pos_order_shift_time" });
schema.index({ branchId: 1, businessDate: 1, status: 1 }, { name: "pos_order_branch_date" });
schema.index({ "customer.phone": 1 }, { name: "pos_order_customer_phone", partialFilterExpression: { "customer.phone": { $type: "string" } } });
module.exports = mongoose.model("PosOrder", schema);
