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
 *     [--all-statuses] [--subscription-id <id>] [--out report.csv]
 *
 * The CSV contains customer names and phone numbers: keep it private.
 * Exit code 2 means at least one critical finding.
 */

const fs = require("node:fs");
const { parseArgs } = require("node:util");
const mongoose = require("mongoose");
const ActivityLog = require("../src/models/ActivityLog");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const {
  DAILY_DEDUCTION_ACTION,
  DELIVERY_BATCH_JOURNAL,
  HISTORICAL_DELIVERY_BATCH_JOURNAL,
  MANUAL_BATCH_JOURNAL,
  MANUAL_DEDUCTION_ACTION,
  MANUAL_DEDUCTION_REVERSAL_ACTION,
} = require("../src/services/dashboard/manualDeduction/constants");
const {
  EXCESS_CORRECTION_ACTION,
  reconcileSubscriptionMealLedger,
} = require("../src/services/subscription/subscriptionMealLedgerReconciliationService");

function group(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || "");
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "all-statuses": { type: "boolean", default: false },
      "subscription-id": { type: "string" },
      out: { type: "string" },
      explain: { type: "boolean", default: false },
    },
  });
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI to the intended environment's database.");
  if (values["subscription-id"] && !mongoose.Types.ObjectId.isValid(values["subscription-id"])) {
    throw new Error("--subscription-id is not a valid ObjectId");
  }

  await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
  try {
    const query = {};
    if (values["subscription-id"]) query._id = values["subscription-id"];
    if (!values["all-statuses"]) query.status = "active";
    const subscriptions = await Subscription.find(query).lean();
    const ids = subscriptions.map((row) => row._id);

    const [days, stacked, batches, logs, users] = await Promise.all([
      SubscriptionDay.find({ subscriptionId: { $in: ids } })
        .select("subscriptionId date status creditsDeducted fulfilledSnapshot plannerMeta planningMeta lockedSnapshot")
        .lean(),
      SubscriptionEntitlementAllocation.find({ containerSubscriptionId: { $in: ids } })
        .select("containerSubscriptionId date allocationKey state quantity")
        .lean(),
      SubscriptionEntitlementBatch.find({ containerSubscriptionId: { $in: ids }, applicationState: "applied" })
        .select([
          "containerSubscriptionId",
          `metadata.${MANUAL_BATCH_JOURNAL}`,
          `metadata.${DELIVERY_BATCH_JOURNAL}`,
          `metadata.${HISTORICAL_DELIVERY_BATCH_JOURNAL}`,
          "status applicationState totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals",
          "effectiveStartDate validityEndDate activatedAt exhaustedAt expiredAt",
        ].join(" "))
        .lean(),
      ActivityLog.find({
        entityType: "subscription",
        entityId: { $in: ids },
        action: { $in: [MANUAL_DEDUCTION_ACTION, DAILY_DEDUCTION_ACTION, MANUAL_DEDUCTION_REVERSAL_ACTION, EXCESS_CORRECTION_ACTION] },
      }).sort({ createdAt: 1 }).lean(),
      User.find({ _id: { $in: subscriptions.map((row) => row.userId).filter(Boolean) } })
        .select("name phone phoneE164").lean(),
    ]);

    // Meals given back by legacy pickup releases leave the consumed counter, so
    // they must leave the evidence too. Keys look like "pickup_release:<requestId>".
    const releaseKeyIds = subscriptions.flatMap((row) => (row.legacyMealBalanceOperationKeys || [])
      .map((key) => /^pickup_release:([0-9a-f]{24})$/i.exec(String(key)))
      .filter(Boolean).map((match) => match[1]));
    const pickupRequests = releaseKeyIds.length
      ? await SubscriptionPickupRequest.find({ _id: { $in: releaseKeyIds } }).select("mealCount status").lean()
      : [];
    const pickupRequestById = new Map(pickupRequests.map((row) => [String(row._id), row]));
    const releasesFor = (subscription) => (subscription.legacyMealBalanceOperationKeys || [])
      .map((key) => /^pickup_release:([0-9a-f]{24})$/i.exec(String(key)))
      .filter(Boolean)
      .map((match) => ({ id: match[1], request: pickupRequestById.get(match[1]) || null }));

    const daysBySub = group(days, (row) => row.subscriptionId);
    const stackedBySub = group(stacked, (row) => row.containerSubscriptionId);
    const batchesBySub = group(batches, (row) => row.containerSubscriptionId);
    const logsBySub = group(logs, (row) => row.entityId);
    const usersById = new Map(users.map((row) => [String(row._id), row]));
    const now = new Date();

    const reports = subscriptions.map((subscription) => {
      const key = String(subscription._id);
      const report = reconcileSubscriptionMealLedger({
        subscription,
        days: daysBySub.get(key) || [],
        stackedAllocations: stackedBySub.get(key) || [],
        batches: batchesBySub.get(key) || [],
        deductionLogs: logsBySub.get(key) || [],
        releasedMeals: releasesFor(subscription)
          .reduce((sum, release) => sum + Number(release.request && release.request.mealCount || 0), 0),
        now,
      });
      const user = usersById.get(String(subscription.userId)) || {};
      return { ...report, customer: user.name || "", phone: user.phoneE164 || user.phone || "" };
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

    const header = ["verdict", "code", "severity", "subscriptionId", "customer", "phone", "status",
      "deliveryMode", "total", "available", "reserved", "consumed", "forfeited", "evidenceConsumed", "gap", "details", "action"];
    const lines = [header.join(",")];
    for (const report of reports.filter((row) => row.verdict !== "ok")) {
      for (const finding of report.findings) {
        lines.push([
          report.verdict, finding.code, finding.severity, report.subscriptionId, report.customer, report.phone,
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
