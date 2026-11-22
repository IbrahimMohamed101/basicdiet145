"use strict";

/**
 * Persistent meal-ledger alerts.
 *
 * A daily scan runs the same reconciliation as scripts/reconcile-meal-balances.js
 * over the CURRENT subscriptions and keeps one alert per problem in
 * MealLedgerAlert. Alerts stay visible to dashboard staff until someone verifies
 * them or the problem disappears. The scan never touches a customer balance.
 */

const dateUtils = require("../../utils/date");
const ActivityLog = require("../../models/ActivityLog");
const MealLedgerAlert = require("../../models/MealLedgerAlert");
const Setting = require("../../models/Setting");
const { loadReconciliationReports } = require("./subscriptionMealLedgerRunner");

const ACK_ACTION = "meal_ledger_alert_acknowledged";
const LAST_SCAN_KEY = "meal_ledger_alerts_last_scan";
const MIN_ACK_NOTE_LENGTH = 3;
const MAX_NOTE_LENGTH = 500;

class MealLedgerAlertError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MealLedgerAlertError";
    this.code = code;
    this.status = status;
  }
}

const idOf = (value) => (value === undefined || value === null ? "" : String(value));

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86400000));
}

/**
 * Pure: turn one reconciliation report into alert candidates.
 * A stale reservation is split per day so each stuck day is its own alert and
 * disappears on its own once that day is settled.
 */
function deriveAlertCandidates(report, { today } = {}) {
  if (!report || !Array.isArray(report.findings)) return [];
  const base = {
    subscriptionId: idOf(report.subscriptionId),
    userId: report.userId || "",
    customerName: report.customer || "",
    customerPhone: report.phone || "",
  };
  const candidates = [];
  for (const finding of report.findings) {
    const common = {
      ...base,
      code: finding.code,
      severity: finding.severity || "high",
      message: finding.message || "",
      action: finding.action || "",
    };
    if (finding.code === "STALE_RESERVATION") {
      const days = Array.isArray(finding.details && finding.details.days) ? finding.details.days : [];
      for (const day of days) {
        candidates.push({
          ...common,
          date: day.date,
          dedupeKey: `${finding.code}:${day.date}`,
          details: {
            meals: day.meals,
            dayStatus: day.dayStatus,
            ageDays: today ? daysBetween(day.date, today) : null,
          },
        });
      }
      continue;
    }
    const date = finding.details && finding.details.date ? String(finding.details.date) : null;
    candidates.push({
      ...common,
      date,
      dedupeKey: date ? `${finding.code}:${date}` : finding.code,
      details: finding.details || null,
    });
  }
  return candidates;
}

/**
 * Pure: compare this scan's candidates with the stored alerts.
 *
 * - new problem                      -> create (open)
 * - known problem, open/acknowledged -> refresh lastSeenAt/details, keep status
 * - known problem, was resolved      -> reopen (acknowledgement is cleared)
 * - stored open/acknowledged alert whose problem was not found again, or whose
 *   subscription is no longer current -> resolve
 */
function planAlertSync({ candidates, existing, scannedSubscriptionIds, now }) {
  const scanned = new Set([...scannedSubscriptionIds].map(String));
  const keyOf = (row) => `${idOf(row.subscriptionId)}|${row.dedupeKey}`;
  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const seen = new Set();
  const plan = { create: [], refresh: [], reopen: [], resolve: [] };

  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const stored = existingByKey.get(key);
    if (!stored) {
      plan.create.push({ ...candidate, status: "open", firstSeenAt: now, lastSeenAt: now });
    } else if (stored.status === "resolved") {
      plan.reopen.push({ id: stored._id, candidate, reopenCount: Number(stored.reopenCount || 0) + 1 });
    } else {
      plan.refresh.push({ id: stored._id, candidate });
    }
  }

  for (const stored of existing) {
    if (stored.status === "resolved" || seen.has(keyOf(stored))) continue;
    const reason = scanned.has(idOf(stored.subscriptionId)) ? "condition_cleared" : "subscription_not_current";
    plan.resolve.push({ id: stored._id, reason });
  }
  return plan;
}

function candidateFields(candidate, now) {
  return {
    userId: candidate.userId || null,
    customerName: candidate.customerName,
    customerPhone: candidate.customerPhone,
    code: candidate.code,
    date: candidate.date || null,
    severity: candidate.severity,
    message: candidate.message,
    action: candidate.action,
    details: candidate.details,
    lastSeenAt: now,
  };
}

async function applyAlertPlan(plan, now) {
  const operations = [];
  for (const row of plan.create) {
    operations.push({
      updateOne: {
        filter: { subscriptionId: row.subscriptionId, dedupeKey: row.dedupeKey },
        update: {
          $setOnInsert: { status: "open", firstSeenAt: now, reopenCount: 0 },
          $set: candidateFields(row, now),
        },
        upsert: true,
      },
    });
  }
  for (const row of plan.refresh) {
    operations.push({ updateOne: { filter: { _id: row.id }, update: { $set: candidateFields(row.candidate, now) } } });
  }
  for (const row of plan.reopen) {
    operations.push({
      updateOne: {
        filter: { _id: row.id },
        update: {
          $set: {
            ...candidateFields(row.candidate, now),
            status: "open",
            resolvedAt: null,
            resolvedReason: "",
            acknowledgedAt: null,
            acknowledgedBy: { id: null, role: "" },
            acknowledgedNote: "",
            reopenCount: row.reopenCount,
          },
        },
      },
    });
  }
  for (const row of plan.resolve) {
    operations.push({
      updateOne: {
        filter: { _id: row.id, status: { $ne: "resolved" } },
        update: { $set: { status: "resolved", resolvedAt: now, resolvedReason: row.reason } },
      },
    });
  }
  if (operations.length) await MealLedgerAlert.bulkWrite(operations, { ordered: false });
}

/**
 * Runs the reconciliation over current subscriptions and syncs the alerts.
 * Nothing is written unless the whole reconciliation finished, so a failed run
 * can never resolve alerts by mistake.
 */
async function runMealLedgerAlertScan({ now = new Date(), loadReports = loadReconciliationReports } = {}) {
  const { subscriptions, skippedEnded, reports } = await loadReports({ now });
  const today = dateUtils.getTodayKSADate(now);
  const candidates = reports.flatMap((report) => deriveAlertCandidates(report, { today }));
  const scannedIds = subscriptions.map((row) => idOf(row._id));
  const existing = await MealLedgerAlert.find({ status: { $in: ["open", "acknowledged", "resolved"] } }).lean();
  const plan = planAlertSync({ candidates, existing, scannedSubscriptionIds: scannedIds, now });
  await applyAlertPlan(plan, now);

  const stats = {
    at: now.toISOString(),
    subscriptionsScanned: subscriptions.length,
    endedButStillActiveSkipped: skippedEnded,
    problemsFound: candidates.length,
    created: plan.create.length,
    reopened: plan.reopen.length,
    refreshed: plan.refresh.length,
    resolved: plan.resolve.length,
  };
  await Setting.updateOne(
    { key: LAST_SCAN_KEY },
    { $set: { value: stats, description: "Last meal ledger alert scan" } },
    { upsert: true }
  );
  return stats;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

async function listAlerts({ status = "pending", severity, subscriptionId, limit = 100, page = 1 } = {}) {
  const query = {};
  if (status === "pending") query.status = "open";
  else if (status === "all") query.status = { $in: ["open", "acknowledged", "resolved"] };
  else if (["open", "acknowledged", "resolved"].includes(status)) query.status = status;
  else throw new MealLedgerAlertError("INVALID_STATUS", "Invalid alert status filter", 400);
  if (severity) query.severity = severity;
  if (subscriptionId) query.subscriptionId = subscriptionId;
  const pageSize = Math.min(Math.max(Math.floor(Number(limit) || 100), 1), 200);
  const skip = (Math.max(Math.floor(Number(page) || 1), 1) - 1) * pageSize;
  const [rows, total] = await Promise.all([
    MealLedgerAlert.find(query).sort({ lastSeenAt: -1 }).skip(skip).limit(pageSize).lean(),
    MealLedgerAlert.countDocuments(query),
  ]);
  rows.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    || String(a.date || "").localeCompare(String(b.date || "")));
  return { alerts: rows.map(serializeAlert), total, page: Math.max(Math.floor(Number(page) || 1), 1), pageSize };
}

function serializeAlert(row) {
  return {
    id: idOf(row._id),
    subscriptionId: idOf(row.subscriptionId),
    customerName: row.customerName || "",
    customerPhone: row.customerPhone || "",
    code: row.code,
    severity: row.severity,
    date: row.date || null,
    message: row.message || "",
    action: row.action || "",
    details: row.details || null,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    reopenCount: row.reopenCount || 0,
    resolvedAt: row.resolvedAt || null,
    resolvedReason: row.resolvedReason || "",
    acknowledgedAt: row.acknowledgedAt || null,
    acknowledgedNote: row.acknowledgedNote || "",
    acknowledgedByRole: row.acknowledgedBy && row.acknowledgedBy.role || "",
  };
}

/** The small payload the dashboard header/banner reads on every load. */
async function getAlertSummary() {
  const [rows, lastScan] = await Promise.all([
    MealLedgerAlert.aggregate([
      { $match: { status: { $in: ["open", "acknowledged"] } } },
      { $group: { _id: { status: "$status", severity: "$severity" }, count: { $sum: 1 }, oldest: { $min: "$firstSeenAt" } } },
    ]),
    Setting.findOne({ key: LAST_SCAN_KEY }).lean(),
  ]);
  const summary = {
    pending: 0,
    pendingBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    acknowledged: 0,
    oldestPendingAt: null,
    lastScan: lastScan ? lastScan.value : null,
  };
  for (const row of rows) {
    if (row._id.status === "open") {
      summary.pending += row.count;
      summary.pendingBySeverity[row._id.severity] = (summary.pendingBySeverity[row._id.severity] || 0) + row.count;
      if (!summary.oldestPendingAt || row.oldest < summary.oldestPendingAt) summary.oldestPendingAt = row.oldest;
    } else {
      summary.acknowledged += row.count;
    }
  }
  return summary;
}

/** A staff member verified the alert and says what they found. */
async function acknowledgeAlert({ id, actorId, actorRole, note, now = new Date() }) {
  const text = String(note || "").trim();
  if (text.length < MIN_ACK_NOTE_LENGTH) {
    throw new MealLedgerAlertError("NOTE_REQUIRED", "A note describing what was verified is required", 400);
  }
  if (text.length > MAX_NOTE_LENGTH) {
    throw new MealLedgerAlertError("NOTE_TOO_LONG", "Note is too long", 400);
  }
  const updated = await MealLedgerAlert.findOneAndUpdate(
    { _id: id, status: "open" },
    {
      $set: {
        status: "acknowledged",
        acknowledgedAt: now,
        acknowledgedBy: { id: actorId || null, role: String(actorRole || "") },
        acknowledgedNote: text,
      },
    },
    { new: true }
  ).lean();
  if (!updated) {
    const exists = await MealLedgerAlert.exists({ _id: id });
    throw new MealLedgerAlertError(
      exists ? "ALERT_NOT_OPEN" : "ALERT_NOT_FOUND",
      exists ? "Alert is not open" : "Alert not found",
      exists ? 409 : 404
    );
  }
  await ActivityLog.create([{
    entityType: "subscription",
    entityId: updated.subscriptionId,
    action: ACK_ACTION,
    byUserId: actorId || undefined,
    byRole: String(actorRole || ""),
    meta: { alertId: idOf(updated._id), code: updated.code, date: updated.date, note: text },
  }]);
  return serializeAlert(updated);
}

module.exports = {
  ACK_ACTION,
  LAST_SCAN_KEY,
  MealLedgerAlertError,
  acknowledgeAlert,
  deriveAlertCandidates,
  getAlertSummary,
  listAlerts,
  planAlertSync,
  runMealLedgerAlertScan,
};
