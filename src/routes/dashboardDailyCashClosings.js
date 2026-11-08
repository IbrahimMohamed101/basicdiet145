"use strict";

const { Router } = require("express");
const DailyCashClosing = require("../models/DailyCashClosing");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const { isValidKSADateString } = require("../utils/date");
const closingService = require("../services/dashboard/dailyCashClosingService");
const { LEGACY, POS, resolveClosingVersion, calculationMode } = require("../services/pos/posClosingSetting");
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
    const reference = version === POS ? text(item?.reference, 120, "other channel reference") : (typeof item?.reference === "string" ? text(item.reference, 120, "other channel reference") : "");
    if (version === POS && !reference) throw fail(400, "OTHER_CHANNEL_REFERENCE_REQUIRED", "Other POS channels require a reference");
    if (version === POS) {
      const normalized = name.toLowerCase().replace(/\s+/gu, "");
      if (["restaurant", "therestaurant", "hungerstation", "keeta", "المطعم",
        "مطعم", "هنجرستيشن", "كيتا"].includes(normalized)) {
        throw fail(400, "MANUAL_CHANNEL_RECORDED_IN_POS", "POS-managed channels cannot be entered as other channels");
      }
    }
    return { name, reference, amountHalala: money(item?.amountHalala, "other channel amount") };
  });
  if (version === POS && ["restaurantHalala", "hungerstationHalala", "keetaHalala"].some(key =>
    Object.hasOwn(c, key))) {
    throw fail(400, "MANUAL_CHANNEL_RECORDED_IN_POS", "POS-recorded channel totals cannot be submitted manually");
  }
  if (version === POS && new Set(other.map(row =>
    row.name.trim().toLowerCase() + ":" + row.reference)).size !== other.length) {
    throw fail(400, "OTHER_CHANNEL_REFERENCE_DUPLICATE", "Other-channel references must be unique");
  }
  const confirmed = body.confirmedSubscriptionCount === null || body.confirmedSubscriptionCount === undefined
    ? null : body.confirmedSubscriptionCount;
  if (confirmed !== null && (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > 100000))
    throw fail(400, "INVALID_COUNT", "Invalid confirmed subscription count");
  return {
    channels: {
      restaurantHalala: money(version === POS ? 0 : c.restaurantHalala, "restaurant"),
      hungerstationHalala: money(version === POS ? 0 : c.hungerstationHalala, "hungerstation"),
      keetaHalala: money(version === POS ? 0 : c.keetaHalala, "keeta"),
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
  res.json({ status: true, data: await closingService.buildClosingView(closing, date) });
}));

router.put("/:date", handle(async (req, res) => {
  const date = dateParam(req);
  const existingVersion = await DailyCashClosing.findOne({ businessDate: date }).select("closingVersion").lean();
  const version = await resolveClosingVersion(date, existingVersion);
  const payload = parsePayload(req.body, version);
  const actor = req.dashboardUserId;
  const closing = await DailyCashClosing.findOneAndUpdate(
    { businessDate: date, status: "draft" },
    { $set: { ...payload, updatedBy: actor }, $push: { history: { actor, action: "edit" } } },
    { new: true, runValidators: true }
  );
  if (closing) return res.json({ status: true, data: await closingService.buildClosingView(closing.toObject(), date) });
  if (await DailyCashClosing.exists({ businessDate: date }))
    throw fail(409, "CLOSING_LOCKED", "Closing submitted or approved. Ask a manager to return it.");
  const created = await DailyCashClosing.create({
    businessDate: date, closingVersion: version, calculationMode: calculationMode(version),
    ...payload, createdBy: actor, updatedBy: actor,
    history: [{ actor, action: "create" }],
  });
  return res.status(201).json({ status: true, data: await closingService.buildClosingView(created.toObject(), date) });
}));

router.post("/:date/submit", handle(async (req, res) => {
  const date = dateParam(req);
  const existing = await DailyCashClosing.findOne({ businessDate: date, status: "draft" }).lean();
  if (!existing) throw fail(409, "NO_EDITABLE_CLOSING", "Save a draft before submitting, or closing already locked");
  const inputs = closingService.inputSnapshot(existing);
  const calculations = await closingService.closingCalculations(date, existing, inputs);
  if (calculations.requiresReason && !inputs.discrepancyReason.trim()) {
    throw fail(400, "DISCREPANCY_REASON_REQUIRED", "وضح سبب اختلاف الاشتراكات أو المبالغ قبل الإرسال");
  }
  // Only the authoritative server-side calculation is frozen, not the live UI math.
  const snapshot = { ...inputs, ...calculations,
    counted: { ...inputs.collections }, differences: {
      cashDifferenceHalala: calculations.reconciliation.cashDifferenceHalala,
      networkDifferenceHalala: calculations.reconciliation.networkDifferenceHalala,
      subscriptionCountDifference: calculations.summary.subscriptionCountDifference,
    }, takenAt: new Date() };
  const closing = await DailyCashClosing.findOneAndUpdate(
    { _id: existing._id, status: "draft", updatedAt: existing.updatedAt },
    { $set: { status: "submitted", snapshot, submittedBy: req.dashboardUserId, submittedAt: new Date() },
      $push: { history: { actor: req.dashboardUserId, action: "submit", reason: inputs.discrepancyReason } } },
    { new: true }
  ).lean();
  if (!closing) throw fail(409, "CLOSING_CHANGED", "Closing changed. Refresh and submit again.");
  res.json({ status: true, data: await closingService.buildClosingView(closing, date) });
}));

router.post("/:date/return", dashboardRoleMiddleware(["admin"]), handle(async (req, res) => {
  const date = dateParam(req);
  const reason = text(req.body?.reason, 1000, "reason");
  if (!reason) throw fail(400, "REASON_REQUIRED", "A return reason is required");
  const current = await DailyCashClosing.findOne({ businessDate: date, status: "submitted",
    snapshot: { $ne: null } }).lean();
  if (!current) throw fail(409, "CLOSING_NOT_SUBMITTED", "Closing is not pending review");
  const at = new Date();
  // CAS keeps the immutable returned snapshot and the clearing operation atomic.
  const closing = await DailyCashClosing.findOneAndUpdate(
    { _id: current._id, status: "submitted", updatedAt: current.updatedAt },
    { $set: { status: "draft", snapshot: null, updatedBy: req.dashboardUserId },
      $push: { history: { actor: req.dashboardUserId, action: "return", reason, at },
        returnedSnapshots: { actor: req.dashboardUserId, reason, at, snapshot: current.snapshot } } },
    { new: true, runValidators: true }
  ).lean();
  if (!closing) throw fail(409, "CLOSING_NOT_SUBMITTED", "Closing is not pending review");
  res.json({ status: true, data: await closingService.buildClosingView(closing, date) });
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
  res.json({ status: true, data: await closingService.buildClosingView(closing, date) });
}));

module.exports = router;
