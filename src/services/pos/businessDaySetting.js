"use strict";

// The cutoff is versioned by business date. The new cutoff determines the END
// of its first effective business day, while that day's START stays at the old
// cutoff. This avoids gaps/overlaps and never re-buckets a completed day.
const mongoose = require("mongoose");
const Setting = require("../../models/Setting");
const ActivityLog = require("../../models/ActivityLog");
const { ZONE, boundsForBusinessDate, parseBusinessDayCutoff } = require("./businessDate");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");
const DAY_MS = 86400000;
const RIYADH_MS = 10800000;

function assertDate(date) {
  boundsForBusinessDate(date);
  return date;
}
function shiftDate(date, days) {
  return new Date(Date.parse(assertDate(date) + "T00:00:00Z") + days * DAY_MS)
    .toISOString().slice(0, 10);
}
function normalizeCutoffPolicy(value) {
  if (value == null) return { baselineCutoff: "00:00", changes: [] };
  if (typeof value === "string") {
    return { baselineCutoff: parseBusinessDayCutoff(value), changes: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid versioned businessDayCutoff setting");
  }
  const baselineCutoff = parseBusinessDayCutoff(value.baselineCutoff);
  const changes = Array.isArray(value.changes) ? value.changes : [];
  if (!Array.isArray(value.changes)) throw new TypeError("Invalid cutoff change history");
  let lastDate = "";
  for (const item of changes) {
    assertDate(item.effectiveFrom);
    parseBusinessDayCutoff(item.cutoff);
    if (item.effectiveFrom < lastDate) {
      throw new TypeError("Business cutoff changes must be chronological");
    }
    lastDate = item.effectiveFrom;
  }
  return { baselineCutoff, changes };
}
function cutoffForBusinessDate(date, policy) {
  assertDate(date);
  const normalized = normalizeCutoffPolicy(policy);
  let cutoff = normalized.baselineCutoff;
  for (const item of normalized.changes) {
    if (item.effectiveFrom > date) break;
    cutoff = item.cutoff;
  }
  return cutoff;
}
function businessDayBoundsWithPolicy(date, policy) {
  const normalized = normalizeCutoffPolicy(policy);
  // Boundary of day D is the END of day D-1 (its active cutoff).
  // The END of day D is governed by D's cutoff, including effectiveFrom.
  const prior = shiftDate(date, -1);
  const start = boundsForBusinessDate(prior,
    cutoffForBusinessDate(prior, normalized)).end;
  const end = boundsForBusinessDate(date,
    cutoffForBusinessDate(date, normalized)).end;
  if (start >= end) throw new TypeError("Invalid business cutoff chronology");
  return { businessDate: date, start, end, timezone: ZONE,
    cutoff: cutoffForBusinessDate(date, normalized) };
}
function businessDateAtWithPolicy(instant, policy) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError("Invalid financial instant");
  }
  const calendarDate = new Date(instant.getTime() + RIYADH_MS).toISOString().slice(0, 10);
  // Local financial cutoff is at most one day; the business date must be
  // the Riyadh calendar date or its immediate predecessor.
  for (const date of [shiftDate(calendarDate, -1), calendarDate]) {
    const { start, end } = businessDayBoundsWithPolicy(date, policy);
    if (instant >= start && instant < end) return date;
  }
  throw new TypeError("Financial instant falls outside versioned business-day bounds");
}
async function loadBusinessDayPolicy(session) {
  const query = Setting.findOne({ key: "businessDayCutoff" }).select("value");
  if (session) query.session(session);
  const doc = await query.lean();
  return normalizeCutoffPolicy(doc ? doc.value : null);
}
async function getBusinessDayBounds(date) {
  return businessDayBoundsWithPolicy(date, await loadBusinessDayPolicy());
}
async function getBusinessDateAt(instant = new Date()) {
  return businessDateAtWithPolicy(instant, await loadBusinessDayPolicy());
}
async function getBusinessDayCutoff(instant = new Date()) {
  const policy = await loadBusinessDayPolicy();
  return cutoffForBusinessDate(businessDateAtWithPolicy(instant, policy), policy);
}
function assertSafeStagingCutoffMutation(options = {}) {
  const disposableCiRs0 = options.testOnly === true
    && process.env.NODE_ENV === "test"
    && process.env.MONGO_URI_TEST ===
      "mongodb:" + "//127.0.0.1:27017/basicdiet_pos_g_d091_ci_test?directConnection=true"
    && mongoose.connection.name === "basicdiet_pos_g_d091_ci_test"
    && mongoose.connection.host === "127.0.0.1";
  if (disposableCiRs0) return;
  if (!isPosStagingRuntime() ||
      mongoose.connection.name !== "basicdiet_pos_staging_test" ||
      mongoose.connection.host !== "mongodb-qxhu.railway.internal") {
    const error = new Error("Business cutoff mutation is restricted to isolated POS Staging");
    error.status = 403; error.code = "POS_STAGING_ONLY"; throw error;
  }
}
async function scheduleBusinessDayCutoff({ newCutoff, actorId, actorRole, at = new Date() }, options = {}) {
  assertSafeStagingCutoffMutation(options);
  if (typeof newCutoff !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(newCutoff)) {
    throw new TypeError("New businessDayCutoff must be provided as HH:mm Asia/Riyadh");
  }
  const cutoff = parseBusinessDayCutoff(newCutoff);
  if (!actorId || !actorRole) {
    const error = new Error("Authenticated actor required");
    error.status = 403; error.code = "FORBIDDEN"; throw error;
  }
  // Changes and audit must commit atomically. Fail closed on standalone:
  // otherwise Settings may move without a matching immutable audit event.
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (topology.setName !== "rs0") {
    const error = new Error("Business cutoff changes require rs0 transactions");
    error.status = 409; error.code = "BUSINESS_CUTOFF_REQUIRES_RS0"; throw error;
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const doc = await Setting.findOne({ key: "businessDayCutoff" }).session(session);
      const policy = normalizeCutoffPolicy(doc ? doc.value : null);
      const currentDate = businessDateAtWithPolicy(at, policy);
      const effectiveFrom = shiftDate(currentDate, 1);
      const oldCutoff = cutoffForBusinessDate(effectiveFrom, policy);
      const changes = [...policy.changes, {
        effectiveFrom, cutoff, previousCutoff: oldCutoff,
        changedAt: at.toISOString(), changedBy: String(actorId), changedByRole: actorRole,
      }];
      const updated = { baselineCutoff: policy.baselineCutoff, changes };
      if (doc) {
        doc.value = updated;
        doc.markModified("value");
        await doc.save({ session });
      } else {
        await Setting.create([{ key: "businessDayCutoff", value: updated }], { session });
      }
      await ActivityLog.create([{
        entityType: "settings", entityId: actorId,
        action: "business_day_cutoff_scheduled",
        byUserId: actorId, byRole: actorRole,
        meta: { key: "businessDayCutoff", previousCutoff: oldCutoff, newCutoff: cutoff,
          effectiveFrom, changedAt: at.toISOString(), timezone: ZONE },
      }], { session });
      result = { previousCutoff: oldCutoff, newCutoff: cutoff,
        effectiveFrom, changedAt: at.toISOString(), timezone: ZONE };
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      readPreference: "primary",
    });
    return result;
  } finally {
    await session.endSession();
  }
}
module.exports = {
  normalizeCutoffPolicy, cutoffForBusinessDate, businessDayBoundsWithPolicy,
  businessDateAtWithPolicy, loadBusinessDayPolicy,
  getBusinessDayBounds, getBusinessDateAt, getBusinessDayCutoff,
  scheduleBusinessDayCutoff,
};
