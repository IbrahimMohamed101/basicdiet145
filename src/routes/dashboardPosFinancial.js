"use strict";
const { Router } = require("express");
const mongoose = require("mongoose");
const asyncHandler = require("../middleware/asyncHandler");
const errorResponse = require("../utils/errorResponse");
const { isPosStagingRuntime } = require("../utils/posStagingRuntime");
const { getCatalog } = require("../services/pos/catalogService");
const { pricePosCheckout, PosFinancialError } = require("../services/pos/financialQuoteService");
const { requireFinancialStagingWrites, hasPosCapability } = require("../services/pos/financialRuntime");
const { issueStagingInvoice, recordStagingRefund, verifiedActor } = require("../services/pos/financialLedgerService");
const { readOperation, abandonOperation, findOperationForActor } = require("../services/pos/operationService");
const PosInvoice = require("../models/PosInvoice");
const PosRefund = require("../models/PosRefund");
const router = Router();
const readers = new Set(["cashier", "restaurant", "admin", "superadmin"]);
function access(req, res, next) {
  if (!isPosStagingRuntime() || mongoose.connection.name !== "basicdiet_pos_staging_test") {
    return errorResponse(res, 403, "POS_STAGING_ONLY", "خدمات فواتير الكاشير متاحة في بيئة Staging المعزولة فقط.");
  }
  if (!readers.has(req.dashboardUserRole)) {
    return errorResponse(res, 403, "FORBIDDEN", "صلاحية نقطة البيع غير متاحة.");
  }
  return next();
}
function errorHandler(error, res) {
  if (error instanceof PosFinancialError || (error && error.status === 400
    && error.code === "POS_DISCOUNT_INVALID")) {
    return errorResponse(res, error.status || 400, error.code, error.message);
  }
  throw error;
}
router.use(access);
// Operation state is read-only evidence. Even 404 does not authorize resubmission
// with a different key: only successful abandon settles an unknown result.
router.get("/operations/active/:kind", asyncHandler(async (req, res) => {
  try {
    requireFinancialStagingWrites();
    const actor = await verifiedActor(req);
    const operation = await findOperationForActor(actor, req.params.kind);
    return res.json({ status: true, data: operation });
  } catch (error) { return errorHandler(error, res); }
}));
router.get("/operations/:key", asyncHandler(async (req, res) => {
  try {
    requireFinancialStagingWrites();
    const actor = await verifiedActor(req);
    const operation = await readOperation(req.params.key, actor);
    if (!operation) return errorResponse(res, 404, "POS_OPERATION_NOT_FOUND", "المحاولة غير موجودة.");
    return res.json({ status: true, data: operation });
  } catch (error) { return errorHandler(error, res); }
}));
router.post("/operations/:key/abandon", asyncHandler(async (req, res) => {
  try {
    requireFinancialStagingWrites();
    const actor = await verifiedActor(req);
    if (req.body?.kind === "refund" && !hasPosCapability(actor.role, "pos.refund")) {
      return errorResponse(res, 403, "FORBIDDEN", "صلاحية المرتجع غير متاحة.");
    }
    const operation = await abandonOperation(req.params.key, actor, req.body?.kind);
    return res.json({ status: true, data: operation });
  } catch (error) { return errorHandler(error, res); }
}));
router.post("/checkout/quote", asyncHandler(async (req, res) => {
  const doc = await getCatalog();
  try {
    const quote = pricePosCheckout(doc, req.body, { cashierDiscountCapHalalas: null });
    return res.json({ status: true, data: quote });
  } catch (error) { return errorHandler(error, res); }
}));
router.post("/sales", asyncHandler(async (req, res) => {
  try {
    requireFinancialStagingWrites();
    const result = await issueStagingInvoice(req, req.body, req.get("Idempotency-Key"));
    res.set("Idempotent-Replay", result.replayed ? "true" : "false");
    return res.status(result.replayed ? 200 : 201).json({ status: true, data: result.invoice });
  } catch (error) { return errorHandler(error, res); }
}));
router.get("/sales", asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
  const invoices = await PosInvoice.find({}).sort({ issuedAt: -1 }).limit(limit).lean();
  return res.json({ status: true, data: invoices });
}));
router.get("/sales/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return errorResponse(res, 400, "POS_INVOICE_INVALID", "رقم الفاتورة غير صالح.");
  }
  const invoice = await PosInvoice.findById(req.params.id).lean();
  if (!invoice) return errorResponse(res, 404, "POS_INVOICE_NOT_FOUND", "الفاتورة غير موجودة.");
  return res.json({ status: true, data: invoice });
}));
router.get("/sales/:id/refunds", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return errorResponse(res, 400, "POS_INVOICE_INVALID", "رقم الفاتورة غير صالح.");
  }
  const refunds = await PosRefund.find({ invoiceId: req.params.id })
    .sort({ recordedAt: -1 }).limit(100).lean();
  return res.json({ status: true, data: refunds });
}));
router.post("/refunds", asyncHandler(async (req, res) => {
  if (!hasPosCapability(req.dashboardUserRole, "pos.refund")) {
    return errorResponse(res, 403, "FORBIDDEN", "غير مصرح لهذا الموظف بعمل مرتجع.");
  }
  try {
    requireFinancialStagingWrites();
    const result = await recordStagingRefund(req, req.body, req.get("Idempotency-Key"));
    res.set("Idempotent-Replay", result.replayed ? "true" : "false");
    return res.status(result.replayed ? 200 : 201).json({ status: true, data: result.refund });
  } catch (error) { return errorHandler(error, res); }
}));
router.get("/refunds/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return errorResponse(res, 400, "POS_REFUND_INVALID", "رقم المرتجع غير صالح.");
  }
  const refund = await PosRefund.findById(req.params.id).lean();
  if (!refund) return errorResponse(res, 404, "POS_REFUND_NOT_FOUND", "المرتجع غير موجود.");
  return res.json({ status: true, data: refund });
}));
module.exports = router;
