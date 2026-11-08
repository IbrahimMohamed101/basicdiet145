"use strict";

// D-093: existing closings without a version are always LEGACY_V1.
// An absent setting is fail-safe; Production cannot silently switch to POS_V2.
const mongoose = require("mongoose");
const Setting = require("../../models/Setting");
const ActivityLog = require("../../models/ActivityLog");
const { getBusinessDateAt } = require("./businessDaySetting");
const { boundsForBusinessDate } = require("./businessDate");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");

const LEGACY_V1 = "LEGACY_V1";
const POS_V2 = "POS_V2";
const SETTING_KEY = "posClosingStartDate";
const STAGING_START_DATE = "2026-11-08";
const MODE = Object.freeze({ LEGACY_V1: "legacy_calculate_closing", POS_V2: "pos_expected_totals" });

function validDate(value) {
  if (typeof value !== "string") throw new TypeError("Invalid posClosingStartDate");
  boundsForBusinessDate(value);
  return value;
}
function nextDate(value) {
  return new Date(Date.parse(validDate(value) + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}
function normalizeClosingPolicy(value) {
  if (value == null) return { baselineStartDate: null, changes: [] };
  if (typeof value === "string") return { baselineStartDate: validDate(value), changes: [] };
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.changes)) {
    throw new TypeError("Invalid versioned posClosingStartDate setting");
  }
  const baselineStartDate = value.baselineStartDate == null ? null : validDate(value.baselineStartDate);
  let previous = "";
  const changes = value.changes.map((entry) => {
    const effectiveFrom = validDate(entry.effectiveFrom);
    const startDate = entry.startDate == null ? null : validDate(entry.startDate);
    if (effectiveFrom <= previous || (startDate && startDate < effectiveFrom)) {
      throw new TypeError("Invalid chronological closing version policy");
    }
    previous = effectiveFrom;
    return { ...entry, effectiveFrom, startDate };
  });
  return { baselineStartDate, changes };
}
function closingVersionForDate(date, value) {
  validDate(date);
  const policy = normalizeClosingPolicy(value);
  let startDate = policy.baselineStartDate;
  for (const change of policy.changes) {
    if (change.effectiveFrom > date) break;
    startDate = change.startDate;
  }
  return startDate && date >= startDate ? POS_V2 : LEGACY_V1;
}
function closingVersionOf(closing, date, policy) {
  if (closing) return closing.closingVersion === POS_V2 ? POS_V2 : LEGACY_V1;
  return closingVersionForDate(date, policy);
}
async function loadClosingPolicy(session) {
  const query = Setting.findOne({ key: SETTING_KEY }).select("value");
  if (session) query.session(session);
  const doc = await query.lean();
  return normalizeClosingPolicy(doc?.value ?? null);
}
async function getClosingVersion(date, closing = null) {
  if (closing) return closingVersionOf(closing);
  return closingVersionForDate(date, await loadClosingPolicy());
}
function calculationMode(version) {
  return MODE[version] || MODE.LEGACY_V1;
}
function assertIsolatedStaging(options = {}) {
  const isolatedCi = options.testOnly === true && process.env.NODE_ENV === "test" &&
    process.env.MONGO_URI_TEST === "mongodb://127.0.0.1:27017/basicdiet_pos_g1_ci_test?directConnection=true" &&
    mongoose.connection.name === "basicdiet_pos_g1_ci_test" &&
    mongoose.connection.host === "127.0.0.1";
  if (isolatedCi) return;
  if (!isPosStagingRuntime() || mongoose.connection.name !== "basicdiet_pos_staging_test" ||
      mongoose.connection.host !== "mongodb-qxhu.railway.internal") {
    const error = new Error("Closing version setting writes are isolated Staging only");
    error.status = 403; error.code = "POS_STAGING_ONLY"; throw error;
  }
}
async function modifyPolicy({ startDate, effectiveFrom, actorId = null, actorRole = "system", seed = false }, options = {}) {
  assertIsolatedStaging(options);
  validDate(startDate);
  validDate(effectiveFrom);
  if (seed && (startDate !== STAGING_START_DATE || effectiveFrom !== STAGING_START_DATE)) {
    throw new Error("Staging seed is pinned to 2026-11-08");
  }
  if (!seed && actorRole !== "admin" && actorRole !== "superadmin") {
    const error = new Error("Only an admin may schedule closing version changes");
    error.status = 403; error.code = "FORBIDDEN"; throw error;
  }
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (hello.setName !== "rs0") {
    const error = new Error("posClosingStartDate requires real rs0 transactions");
    error.status = 409; error.code = "POS_CLOSING_REQUIRES_RS0"; throw error;
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const doc = await Setting.findOne({ key: SETTING_KEY }).session(session);
      const policy = normalizeClosingPolicy(doc?.value ?? null);
      if (seed && policy.changes.some(c => c.effectiveFrom === STAGING_START_DATE && c.startDate === STAGING_START_DATE)) {
        result = { unchanged: true, effectiveFrom, startDate };
        return;
      }
      if (seed && doc) throw new Error("Existing closing version policy needs manual review before seed");
      if (!seed && policy.changes.length && effectiveFrom <= policy.changes.at(-1).effectiveFrom) {
        throw new Error("Cannot alter an effective or historical closing version");
      }
      const prior = closingVersionForDate(effectiveFrom, policy);
      const changes = [...policy.changes, { effectiveFrom, startDate,
        changedBy: actorId ? String(actorId) : "staging-g1-seed", changedByRole: actorRole,
        changedAt: new Date().toISOString(), previousVersion: prior }];
      const value = { baselineStartDate: policy.baselineStartDate, changes };
      if (doc) await Setting.updateOne({ _id: doc._id }, { $set: { value } }, { session });
      else await Setting.create([{ key: SETTING_KEY, value }], { session });
      await ActivityLog.create([{
        entityType: "settings", entityId: new mongoose.Types.ObjectId(),
        ...(actorId ? { byUserId: actorId } : {}), byRole: actorRole,
        action: seed ? "pos_closing_staging_seeded" : "pos_closing_start_scheduled",
        meta: { key: SETTING_KEY, startDate, effectiveFrom, previousVersion: prior, seed },
      }], { session });
      result = { unchanged: false, effectiveFrom, startDate, previousVersion: prior };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } finally { await session.endSession(); }
}
async function scheduleClosingStartDate({ startDate, actorId, actorRole, at = new Date() }, options = {}) {
  const current = await getBusinessDateAt(at);
  const effectiveFrom = nextDate(current);
  if (startDate !== effectiveFrom) throw new Error("A new closing policy can only start next business date");
  if (!actorId) throw new Error("Authenticated admin actor required");
  return modifyPolicy({ startDate, effectiveFrom, actorId, actorRole }, options);
}
function seedStagingClosingStartDate(options = {}) {
  return modifyPolicy({ startDate: STAGING_START_DATE, effectiveFrom: STAGING_START_DATE, seed: true }, options);
}
module.exports = {
  LEGACY_V1, POS_V2, SETTING_KEY, STAGING_START_DATE,
  normalizeClosingPolicy, closingVersionForDate, closingVersionOf, calculationMode,
  loadClosingPolicy, getClosingVersion, scheduleClosingStartDate, seedStagingClosingStartDate,
  assertIsolatedStaging,
};