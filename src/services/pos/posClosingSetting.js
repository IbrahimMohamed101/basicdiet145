"use strict";

// G1 D-093: activation is effective-dated; absent setting fails safe to LEGACY_V1.
// Existing unversioned closings ALWAYS retain LEGACY_V1, including after activation.
const mongoose = require("mongoose");
const Setting = require("../../models/Setting");
const ActivityLog = require("../../models/ActivityLog");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");
const { boundsForBusinessDate } = require("./businessDate");
const KEY = "posClosingStartDate";
const LEGACY = "LEGACY_V1";
const POS = "POS_V2";
const MODES = Object.freeze({ LEGACY_V1: "legacy_calculate_closing", POS_V2: "pos_expected_totals" });
function validDate(date) {
  if (typeof date !== "string") throw new TypeError("Invalid Saudi business date");
  boundsForBusinessDate(date);
  return date;
}
function normalizePolicy(value) {
  if (value == null) return { baselineStartDate: null, changes: [] };
  if (typeof value === "string") return { baselineStartDate: validDate(value), changes: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid posClosingStartDate policy");
  const baselineStartDate = value.baselineStartDate == null ? null : validDate(value.baselineStartDate);
  if (!Array.isArray(value.changes)) throw new TypeError("Invalid posClosingStartDate history");
  let previous = "";
  for (const change of value.changes) {
    validDate(change.effectiveFrom);
    if (change.startDate != null) validDate(change.startDate);
    if (change.effectiveFrom <= previous) throw new TypeError("Non-monotonic posClosingStartDate history");
    previous = change.effectiveFrom;
  }
  return { baselineStartDate, changes: value.changes };
}
function effectiveStartDate(date, policy) {
  validDate(date);
  const normalized = normalizePolicy(policy);
  let start = normalized.baselineStartDate;
  for (const change of normalized.changes) {
    if (change.effectiveFrom > date) break;
    start = change.startDate ?? null;
  }
  return start;
}
function versionAt(date, policy) {
  const start = effectiveStartDate(date, policy);
  return start && date >= start ? POS : LEGACY;
}
async function loadPolicy(session) {
  const query = Setting.findOne({ key: KEY }).select("value");
  if (session) query.session(session);
  const row = await query.lean();
  return normalizePolicy(row?.value ?? null);
}
async function resolveClosingVersion(date, closing = null) {
  validDate(date);
  if (closing) return closing.closingVersion === POS ? POS : LEGACY;
  return versionAt(date, await loadPolicy());
}
function calculationMode(version) { return MODES[version] || MODES[LEGACY]; }
function assertStagingSeedRuntime() {
  if (!isPosStagingRuntime() || mongoose.connection.name !== "basicdiet_pos_staging_test"
    || mongoose.connection.host !== "mongodb-qxhu.railway.internal") {
    const error = new Error("POS closing date writes are restricted to isolated Staging");
    error.status = 403; error.code = "POS_STAGING_ONLY"; throw error;
  }
}
async function scheduleStartDate({ startDate, effectiveFrom, actorId, actorRole }) {
  assertStagingSeedRuntime();
  validDate(startDate); validDate(effectiveFrom);
  if (!actorId || !["admin", "superadmin"].includes(actorRole)) throw new Error("Admin actor required");
  // Never retroactively reclassify an already existing closing.
  if (startDate < effectiveFrom) throw new Error("Start date cannot precede effectiveFrom");
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (hello.setName !== "rs0") throw new Error("POS closing setting requires real rs0 transaction");
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const row = await Setting.findOne({ key: KEY }).session(session);
      const policy = normalizePolicy(row?.value ?? null);
      const latest = policy.changes[policy.changes.length - 1];
      if (latest && effectiveFrom <= latest.effectiveFrom) throw new Error("Effective date must advance");
      const existing = await require("../../models/DailyCashClosing").exists({ businessDate: { $gte: effectiveFrom } }).session(session);
      if (existing) throw new Error("Existing closings prohibit retroactive activation");
      const changedAt = new Date();
      policy.changes.push({ effectiveFrom, startDate, changedAt: changedAt.toISOString(),
        changedBy: String(actorId), changedByRole: actorRole });
      if (row) { row.value = policy; row.markModified("value"); await row.save({ session }); }
      else await Setting.create([{ key: KEY, value: policy }], { session });
      await ActivityLog.create([{ entityType: "settings", entityId: actorId,
        action: "pos_closing_start_date_scheduled", byUserId: actorId, byRole: actorRole,
        meta: { key: KEY, effectiveFrom, startDate, previousStartDate: effectiveStartDate(effectiveFrom, { ...policy, changes: policy.changes.slice(0, -1) }), changedAt } }], { session });
      result = { effectiveFrom, startDate };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { LEGACY, POS, KEY, MODES, normalizePolicy, effectiveStartDate,
  versionAt, loadPolicy, resolveClosingVersion, calculationMode, scheduleStartDate };
