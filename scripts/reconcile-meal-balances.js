#!/usr/bin/env node
"use strict";

/**
 * READ-ONLY meal balance reconciliation for every subscription.
 *
 * Recomputes the consumed meals from day, allocation, journal and staff
 * deduction evidence and compares them with the subscription counters. It only
 * issues find queries and writes a CSV file on the machine running it.
 *
 *   MONGO_URI="<connection string>" node scripts/reconcile-meal-balances.js \
 *     [--all-statuses] [--include-ended] [--subscription-id <id>] [--out report.csv] [--include-pii]
 *
 * By default only CURRENT subscriptions are checked: status "active" and a
 * validity end date that has not passed. --include-ended also checks the rest.
 *
 * The CSV contains NO customer names or phone numbers by default (subscription
 * ids are enough to look a customer up in the dashboard). --include-pii adds
 * them; the file is then private data and must not be shared or committed.
 * Exit code 2 means at least one critical finding.
 */

const fs = require("node:fs");
const { parseArgs } = require("node:util");
const mongoose = require("mongoose");
const ActivityLog = require("../src/models/ActivityLog");
const {
  DELIVERY_BATCH_JOURNAL,
  HISTORICAL_DELIVERY_BATCH_JOURNAL,
  MANUAL_BATCH_JOURNAL,
} = require("../src/services/dashboard/manualDeduction/constants");
const {
  group,
  loadReconciliationReports,
} = require("../src/services/subscription/subscriptionMealLedgerRunner");

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "all-statuses": { type: "boolean", default: false },
      "include-ended": { type: "boolean", default: false },
      "subscription-id": { type: "string" },
      out: { type: "string" },
      explain: { type: "boolean", default: false },
      "include-pii": { type: "boolean", default: false },
    },
  });
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI to the intended environment's database.");
  if (values["subscription-id"] && !mongoose.Types.ObjectId.isValid(values["subscription-id"])) {
    throw new Error("--subscription-id is not a valid ObjectId");
  }

  await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
  try {
    const now = new Date();
    const {
      subscriptions, skippedEnded, reports, stackedBySub, batchesBySub, logsBySub, releasesFor,
    } = await loadReconciliationReports({
      subscriptionId: values["subscription-id"] || null,
      allStatuses: values["all-statuses"],
      includeEnded: values["include-ended"],
      now,
    });

    if (values.explain) {
      // Compact per-subscription detail WITHOUT customer data, to tell real
      // balance errors from rule artifacts. With --subscription-id it explains
      // that subscription; otherwise it samples a few subscriptions per finding.
      const has = (report, code, predicate = () => true) =>
        report.findings.some((finding) => finding.code === code && predicate(finding.details || {}));
      const sample = (rows, size) => {
        if (rows.length <= size) return rows;
        const picked = [rows[0], rows[rows.length - 1], rows[Math.floor(rows.length / 2)]];
        return [...new Set(picked)].slice(0, size);
      };
      const bySize = (code) => (left, right) =>
        (left.findings.find((f) => f.code === code)?.details?.meals || 0)
        - (right.findings.find((f) => f.code === code)?.details?.meals || 0);
      const overSignature = (report) => {
        const d = report.findings.find((f) => f.code === "DAY_OVER_DEDUCTED")?.details || {};
        const src = d.sources || {};
        return [src.allocationConsumed > 0 ? "alloc" : "-", src.legacySnapshotMeals > 0 ? "legacy" : "-",
          d.manualMeals > 0 ? "manual" : "-", d.dayStatus].join("+");
      };

      let selected;
      if (values["subscription-id"]) {
        selected = reports;
      } else {
        const groups = [
          reports.filter((r) => has(r, "EVIDENCE_EXCEEDS_CONSUMED", (d) => d.counterBasis === "consumedMeals"))
            .sort(bySize("EVIDENCE_EXCEEDS_CONSUMED")),
          reports.filter((r) => has(r, "EVIDENCE_EXCEEDS_CONSUMED", (d) => d.counterBasis === "batches"))
            .sort(bySize("EVIDENCE_EXCEEDS_CONSUMED")),
          reports.filter((r) => has(r, "CONSUMED_EXCEEDS_EVIDENCE")),
          reports.filter((r) => has(r, "COUNTERS_DIFFER_FROM_ACTIVE_BATCHES")),
          reports.filter((r) => has(r, "STALE_RESERVATION")),
        ];
        selected = groups.flatMap((rows) => sample(rows, 3));
        const bySig = new Map();
        for (const report of reports.filter((r) => has(r, "DAY_OVER_DEDUCTED"))) {
          const sig = overSignature(report);
          if (!bySig.has(sig)) bySig.set(sig, []);
          bySig.get(sig).push(report);
        }
        for (const rows of bySig.values()) selected.push(...sample(rows, 2));
        selected = [...new Set(selected)];
      }

      const selectedIds = selected.map((report) => report.subscriptionId);
      const actionCounts = await ActivityLog.aggregate([
        { $match: { entityType: "subscription", entityId: { $in: selectedIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
        { $group: { _id: { id: "$entityId", action: "$action" }, count: { $sum: 1 } } },
      ]);
      const actionsBySub = new Map();
      for (const row of actionCounts) {
        const id = String(row._id.id);
        if (!actionsBySub.has(id)) actionsBySub.set(id, {});
        actionsBySub.get(id)[row._id.action] = row.count;
      }
      const subscriptionsById = new Map(subscriptions.map((row) => [String(row._id), row]));
      // Unknown correction/repair operations written outside this repo: show only
      // numeric facts and short labels (no free text that could hold customer data).
      const correctionRows = await ActivityLog.find({
        entityType: "subscription",
        entityId: { $in: selectedIds.map((id) => new mongoose.Types.ObjectId(id)) },
        action: { $regex: /correction|repair|restore|release|adjust|refund/i },
      }).lean();
      const correctionsBySub = group(correctionRows, (row) => row.entityId);
      const safeMeta = (meta) => Object.fromEntries(Object.entries(meta || {})
        .filter(([key, value]) => !/notes|reason|customer|phone|name/i.test(key)
          && (typeof value === "number" || typeof value === "boolean"
            || (typeof value === "string" && value.length <= 40)))
        .slice(0, 25));

      for (const report of selected) {
        const key = report.subscriptionId;
        const { customer, phone, days: evidenceDays, findings, ...rest } = report;
        const sub = subscriptionsById.get(key) || {};
        const manualLogs = (logsBySub.get(key) || []).map((log) => {
          const meta = log.meta || {};
          const deducted = Number(meta.deductedTotalMeals ?? 0);
          const delta = meta.before && meta.after
            ? Number(meta.before.remainingMeals) - Number(meta.after.remainingMeals) : null;
          return {
            action: log.action, date: meta.businessDate || null, deducted, delta,
            reserved: Array.isArray(meta.allocationKeys) ? meta.allocationKeys.length : 0,
            status: meta.status || null, source: meta.source || null, createdAt: log.createdAt,
          };
        });
        const overDeductedDates = new Set(report.findings
          .filter((finding) => finding.code === "DAY_OVER_DEDUCTED").map((finding) => finding.details.date));
        console.log(JSON.stringify({
          ...rest,
          findings: findings.map((finding) => ({ code: finding.code, details: finding.details })),
          legacyMealBalanceOperationKeys: (sub.legacyMealBalanceOperationKeys || []).length,
          pickupReleases: releasesFor(sub).map((release) => ({
            mealCount: release.request ? release.request.mealCount : null,
            status: release.request ? release.request.status : "request-not-found",
          })),
          stackingAggregate: sub.stacking && sub.stacking.hasEntitlementBatches
            ? sub.stacking.aggregateBalance || "missing" : null,
          corrections: (correctionsBySub.get(key) || []).map((row) => ({
            action: row.action, createdAt: row.createdAt, meta: safeMeta(row.meta),
          })),
          activityActions: actionsBySub.get(key) || {},
          batches: (batchesBySub.get(key) || []).map((batch) => ({
            status: batch.status, totalMeals: batch.totalMeals, remainingMeals: batch.remainingMeals,
            startsOn: batch.effectiveStartDate, endsOn: batch.validityEndDate,
            activatedAt: batch.activatedAt, exhaustedAt: batch.exhaustedAt, expiredAt: batch.expiredAt,
            reservedMeals: batch.reservedMeals, consumedMeals: batch.consumedMeals,
            forfeitedMeals: batch.forfeitedMeals,
            journals: {
              manual: (batch.metadata?.[MANUAL_BATCH_JOURNAL] || []).length,
              delivery: (batch.metadata?.[DELIVERY_BATCH_JOURNAL] || []).length,
              historical: (batch.metadata?.[HISTORICAL_DELIVERY_BATCH_JOURNAL] || []).length,
            },
          })),
          stackedAllocations: (stackedBySub.get(key) || []).length,
          manualSummary: {
            logs: manualLogs.length,
            deductedTotal: manualLogs.reduce((sum, log) => sum + log.deducted, 0),
            logsWithNoCounterMove: manualLogs.filter((log) => log.delta !== null && log.delta === 0 && log.reserved === 0).length,
            logsWhereCounterMovedLess: manualLogs.filter((log) => log.delta !== null && log.delta < log.deducted && log.reserved === 0).length,
            logsWithBeforeAfter: manualLogs.filter((log) => log.delta !== null).length,
            lastLogs: manualLogs.slice(-4),
          },
          overDeductedDayLogs: manualLogs.filter((log) => overDeductedDates.has(log.date)),
          evidenceDays: values["subscription-id"]
            ? evidenceDays.filter((day) => day.automaticMeals > 0 || day.manualMeals > 0)
            : evidenceDays.filter((day) => overDeductedDates.has(day.date)),
        }, null, 1));
      }
      return;
    }

    const byVerdict = { ok: 0, review: 0, critical: 0 };
    const byCode = {};
    for (const report of reports) {
      byVerdict[report.verdict] += 1;
      for (const finding of report.findings) byCode[finding.code] = (byCode[finding.code] || 0) + 1;
    }

    // Aggregate-only diagnostics (no customer data) to tell real problems from
    // rule artifacts: which evidence sources a finding comes from, by version.
    const tally = (map, key) => { map[key] = (map[key] || 0) + 1; };
    const diagnostics = { byVersion: {}, byBasis: {}, overDeductedBySources: {}, overDeductedBySize: {}, evidenceExceeds: {}, consumedExceeds: {}, counterDifferences: {}, unaccountedBatches: {} };
    for (const report of reports) {
      const version = `v${report.entitlementVersion}`;
      const bucket = diagnostics.byVersion[version] || (diagnostics.byVersion[version] = { subscriptions: 0, ok: 0, review: 0, critical: 0 });
      bucket.subscriptions += 1;
      bucket[report.verdict] += 1;
      tally(diagnostics.byBasis, `${version} basis=${report.counterBasis}`);
      for (const finding of report.findings) {
        const d = finding.details || {};
        if (finding.code === "DAY_OVER_DEDUCTED") {
          const src = d.sources || {};
          const sig = [src.allocationConsumed > 0 ? "alloc" : "-", src.journalMeals > 0 ? "journal" : "-",
            src.legacySnapshotMeals > 0 ? "legacy" : "-", d.manualMeals > 0 ? "manual" : "-"].join("+");
          tally(diagnostics.overDeductedBySources, `${version} ${sig} dayStatus=${d.dayStatus}`);
          tally(diagnostics.overDeductedBySize, `over by ${d.deductedMeals - d.expectedMeals}`);
        } else if (finding.code === "EVIDENCE_EXCEEDS_CONSUMED") {
          tally(diagnostics.evidenceExceeds,
            `${version} basis=${d.counterBasis} counter=${d.counterConsumed === 0 ? 0 : ">0"} manual=${report.evidence.manualMeals > 0 ? "yes" : "no"} gap=${d.meals}`);
        } else if (finding.code === "CONSUMED_EXCEEDS_EVIDENCE") {
          tally(diagnostics.consumedExceeds, `${version} basis=${d.counterBasis} gap=${d.meals}`);
        } else if (finding.code === "COUNTERS_DIFFER_FROM_ACTIVE_BATCHES") {
          tally(diagnostics.counterDifferences, `${version} ${Object.keys(d.differences).join("+")}`);
        } else if (finding.code === "BATCH_UNACCOUNTED_MEALS") {
          for (const batch of d.batches) tally(diagnostics.unaccountedBatches, `${batch.status} unaccounted=${batch.unaccountedMeals}`);
        }
      }
    }

    const sampleIds = reports
      .filter((report) => report.findings.some((finding) => finding.code === "EVIDENCE_EXCEEDS_CONSUMED"))
      .sort((left, right) => left.consumedGap - right.consumedGap);
    diagnostics.sampleEvidenceExceeds = [
      ...sampleIds.slice(-3), ...sampleIds.slice(0, 3),
    ].map((report) => ({ subscriptionId: report.subscriptionId, gap: -report.consumedGap }));

    const includePii = values["include-pii"] === true;
    const header = ["verdict", "code", "severity", "subscriptionId", ...(includePii ? ["customer", "phone"] : []), "status",
      "deliveryMode", "total", "available", "reserved", "consumed", "forfeited", "evidenceConsumed", "gap", "details", "action"];
    const lines = [header.join(",")];
    for (const report of reports.filter((row) => row.verdict !== "ok")) {
      for (const finding of report.findings) {
        lines.push([
          report.verdict, finding.code, finding.severity, report.subscriptionId,
          ...(includePii ? [report.customer, report.phone] : []),
          report.status, report.deliveryMode, report.counters.total, report.counters.available, report.counters.reserved,
          report.counters.consumed, report.counters.forfeited, report.evidence.consumedMeals, report.consumedGap,
          JSON.stringify(finding.details), finding.action,
        ].map(csvCell).join(","));
      }
    }
    const out = values.out || `meal-balance-reconciliation-${now.toISOString().slice(0, 10)}.csv`;
    fs.writeFileSync(out, `﻿${lines.join("\n")}\n`);

    console.log(JSON.stringify({
      readOnly: true,
      subscriptionsScanned: reports.length,
      endedButStillActiveSkipped: skippedEnded,
      verdicts: byVerdict,
      findingsByCode: byCode,
      diagnostics,
      csv: out,
    }, null, 2));
    if (byVerdict.critical > 0) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
