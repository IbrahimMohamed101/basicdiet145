"use strict";

const { Router } = require("express");
const DailyCashClosing = require("../models/DailyCashClosing");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const { isValidKSADateString } = require("../utils/date");
const closingService = require("../services/dashboard/dailyCashClosingService");
const { getClosingVersion, calculationMode, POS_V2 } = require("../services/pos/closingVersionService");
const { getBusinessDayBounds } = require("../services/pos/businessDaySetting");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();
router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["cashier", "restaurant", "admin"]));

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function money(value, key) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e12)
    throw fail(400, "INVALID_AMOUNT", `${key} must be a non-negative integer halala value`);
  return value;
}
function text(value, limit, key) {
  if (value !== undefined && typeof value !== "string")
    throw fail(400, "INVALID_FIELD", `${key} must be text`);
  const normalized = String(value || "").trim();
  if (normalized.length > limit) throw fail(400, "INVALID_FIELD", `${key} too long`);
  return normalized;
}
function parsePayload(body, version) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw fail(400, "INVALID_INPUT", "Expected a closing object");
  const c = body.channels, p = body.collections;
  if (!c || !p || typeof c !== "object" || typeof p !== "object")
    throw fail(400, "INVALID_INPUT", "Missing channels or collections");
  if (!Array.isArray(c.other) || c.other.length > 12)
    throw fail(400, "INVALID_INPUT", "Other channels must be a list with max 12 entries");
  const other = c.other.map((item, index) => {
    const name = text(item?.name, 80, "other channel name");
    if (!name) throw fail(400, "INVALID_INPUT", `Other channel ${index + 1} needs a name`);
    const reference = text(item?.reference, 120, "other channel reference");
    if (version === POS_V2 && !reference)
      throw fail(400, "INVALID_OTHER_CHANNEL_REFERENCE", "مرجع القناة الإضافية إجباري");
    return { name, ...(reference ? { reference } : {}), amountHalala: money(item?.amountHalala, "other channel amount") };
  });
  const confirmed = body.confirmedSubscriptionCount === null || body.confirmedSubscriptionCount === undefined
    ? null : body.confirmedSubscriptionCount;
  if (confirmed !== null && (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > 100000))
    throw fail(400, "INVALID_COUNT", "Invalid confirmed subscription count");
  if (version === POS_V2 && ["restaurantHalala", "hungerstationHalala", "keetaHalala"].some(k => Object.hasOwn(c, k)))
    throw fail(400, "MANUAL_CHANNEL_RECORDED_IN_POS", "قنوات المطعم والتطبيقات المسجلة في POS لا تُدخل يدويًا");
  return {
    channels: {
      restaurantHalala: version === POS_V2 ? 0 : money(c.restaurantHalala, "restaurant"),
      hungerstationHalala: version === POS_V2 ? 0 : money(c.hungerstationHalala, "hungerstation"),
      keetaHalala: version === POS_V2 ? 0 : money(c.keetaHalala, "keeta"),
      other,
    },
    collections: {
      cashHalala: money(p.cashHalala, "cash"),
      cardHalala: money(p.cardHalala, "card"),
    },
    confirmedSubscriptionCount: confirmed,
    discrepancyReason: text(body.discrepancyReason, 1000, "discrepancyReason"),
    notes: text(body.notes, 1500, "notes"),
  };
}
function dateParam(req) {
  const date = req.params.date;
  if (!isValidKSADateString(date)) throw fail(400, "INVALID_DATE", "Invalid Saudi business date");
  return date;
}
function respondError(res, error) {
  return res.status(error.status || 500).json({
    status: false,
    code: error.code || "CLOSING_ERROR",
    message: error.status ? error.message : "تعذر إتمام العملية",
  });
}
function handle(fn) {
  return asyncHandler(async (req, res) => {
    try { await fn(req, res); } catch (err) {
      // Restrict unexpected errors; client must not receive internals.
      if (err && err.code === 11000) return respondError(res, fail(409, "ALREADY_EXISTS", "A closing already exists for this date"));
      if (err && err.name === "ValidationError") return respondError(res, fail(400, "INVALID_INPUT", "Invalid closing data"));
      if (!err?.status) throw err;
      return respondError(res, err);
    }
  });
}

router.get("/:date", handle(async (req, res) => {
  const date = dateParam(req);
  const closing = await DailyCashClosing.findOne({ businessDate: date }).lean();
  res.json({ status: true, data: await closingService.buildClosingView(closing, date, req.dashboardUserRole) });
}));

router.put("/:date", handle(async (req, res) => {
  const date = dateParam(req);
  const existing = await DailyCashClosing.findOne({ businessDate: date }).lean();
  const version = await getClosingVersion(date, existing);
  const payload = parsePayload(req.body, version);
  // Server-side collision guard before the draft is modified.
  if (version === POS_V2) {
    closingService.applyPosOtherReceivables(await closingService.expectedTotals(date), payload.channels);
  }
  const actor = req.dashboardUserId;
  const closing = await DailyCashClosing.findOneAndUpdate(
    { businessDate: date, status: "draft" },
    { $set: { ...payload, updatedBy: actor }, $push: { history: { actor, action: "edit" } } },
    { new: true, runValidators: true }
  );
  if (closing) return res.json({ status: true, data: await closingService.buildClosingView(closing.toObject(), date, req.dashboardUserRole) });
  if (await DailyCashClosing.exists({ businessDate: date }))
    throw fail(409, "CLOSING_LOCKED", "Closing submitted or approved. Ask a manager to return it.");
  const created = await DailyCashClosing.create({
    businessDate: date, closingVersion: version, calculationMode: calculationMode(version), ...payload, createdBy: actor, updatedBy: actor,
    history: [{ actor, action: "create" }],
  });
  return res.status(201).json({ status: true, data: await closingService.buildClosingView(created.toObject(), date, req.dashboardUserRole) });
}));

router.post("/:date/submit", handle(async (req, res) => {
  const date = dateParam(req);
  const existing = await DailyCashClosing.findOne({ businessDate: date, status: "draft" }).lean();
  if (!existing) throw fail(409, "NO_EDITABLE_CLOSING", "Save a draft before submitting, or closing already locked");
  const version = await getClosingVersion(date, existing);
  const inputs = closingService.inputSnapshot(existing);
  const calculated = await closingService.calculateForVersion(date, version, inputs);
  if (calculated.requiresReason && !inputs.discrepancyReason.trim())
    throw fail(400, "DISCREPANCY_REASON_REQUIRED", "وضح سبب اختلاف المبالغ أو الاشتراكات قبل الإرسال");
  const bounds = await getBusinessDayBounds(date);
  const snapshot = {
    ...inputs,
    closingVersion: version, calculationMode: calculationMode(version),
    calculationFormulaVersion: version === POS_V2 ? 2 : 1,
    businessDayBounds: { start: bounds.start, end: bounds.end,
      timezone: bounds.timezone, cutoff: bounds.cutoff },
    ...calculated,
    counted: { ...inputs.collections },
    differences: {
      cashDifferenceHalala: calculated.reconciliation.cashDifferenceHalala,
      networkDifferenceHalala: calculated.reconciliation.networkDifferenceHalala,
      subscriptionCountDifference: calculated.summary.subscriptionCountDifference,
    },
    takenAt: new Date(),
  };
  const closing = await DailyCashClosing.findOneAndUpdate(
    { _id: existing._id, status: "draft", updatedAt: existing.updatedAt },
    { $set: { status: "submitted", snapshot, submittedBy: req.dashboardUserId, submittedAt: new Date() },
      $push: { history: { actor: req.dashboardUserId, action: "submit", reason: inputs.discrepancyReason } } },
    { new: true }
  ).lean();
  if (!closing) throw fail(409, "CLOSING_CHANGED", "Closing changed. Refresh and submit again.");
  res.json({ status: true, data: await closingService.buildClosingView(closing, date, req.dashboardUserRole) });
}));

router.post("/:date/return", dashboardRoleMiddleware(["admin"]), handle(async (req, res) => {
  const date = dateParam(req);
  const reason = text(req.body?.reason, 1000, "reason");
  if (!reason) throw fail(400, "REASON_REQUIRED", "A return reason is required");
  const previous = await DailyCashClosing.findOne({
    businessDate: date, status: "submitted", snapshot: { $ne: null },
  }).lean();
  if (!previous) throw fail(409, "CLOSING_NOT_SUBMITTED", "Closing is not pending review");
  const at = new Date();
  // Atomic append and clear, guarded by status + timestamp. The old snapshot
  // remains in immutable audit history even if the new draft is resubmitted.
  const closing = await DailyCashClosing.findOneAndUpdate(
    { _id: previous._id, status: "submitted", updatedAt: previous.updatedAt },
    { $set: { status: "draft", snapshot: null, updatedBy: req.dashboardUserId },
      $push: {
        returnedSnapshots: { actor: req.dashboardUserId, reason, at, snapshot: previous.snapshot },
        history: { actor: req.dashboardUserId, action: "return", reason, at },
      } }, { new: true }
  ).lean();
  if (!closing) throw fail(409, "CLOSING_NOT_SUBMITTED", "Closing is not pending review");
  res.json({ status: true, data: await closingService.buildClosingView(closing, date, req.dashboardUserRole) });
}));

router.post("/:date/approve", dashboardRoleMiddleware(["admin"]), handle(async (req, res) => {
  const date = dateParam(req);
  const closing = await DailyCashClosing.findOneAndUpdate(
    { businessDate: date, status: "submitted", snapshot: { $ne: null } },
    { $set: { status: "approved", approvedBy: req.dashboardUserId, approvedAt: new Date() },
      $push: { history: { actor: req.dashboardUserId, action: "approve" } } },
    { new: true }
  ).lean();
  if (!closing) throw fail(409, "CLOSING_NOT_SUBMITTED", "Closing is not awaiting approval");
  res.json({ status: true, data: await closingService.buildClosingView(closing, date, req.dashboardUserRole) });
}));

module.exports = router;
