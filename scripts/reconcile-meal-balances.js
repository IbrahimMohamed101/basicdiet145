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
        ].join(" "))
        .lean(),
      ActivityLog.find({
        entityType: "subscription",
        entityId: { $in: ids },
        action: { $in: [MANUAL_DEDUCTION_ACTION, DAILY_DEDUCTION_ACTION, MANUAL_DEDUCTION_REVERSAL_ACTION] },
      }).sort({ createdAt: 1 }).lean(),
      User.find({ _id: { $in: subscriptions.map((row) => row.userId).filter(Boolean) } })
        .select("name phone phoneE164").lean(),
    ]);

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
        now,
      });
      const user = usersById.get(String(subscription.userId)) || {};
      return { ...report, customer: user.name || "", phone: user.phoneE164 || user.phone || "" };
    });

    const byVerdict = { ok: 0, review: 0, critical: 0 };
    const byCode = {};
    for (const report of reports) {
      byVerdict[report.verdict] += 1;
      for (const finding of report.findings) byCode[finding.code] = (byCode[finding.code] || 0) + 1;
    }

    // Aggregate-only diagnostics (no customer data) to tell real problems from
    // rule artifacts: which evidence sources a finding comes from, by version.
    const tally = (map, key) => { map[key] = (map[key] || 0) + 1; };
    const diagnostics = { byVersion: {}, overDeductedBySources: {}, overDeductedBySize: {}, evidenceExceeds: {}, consumedExceeds: {} };
    for (const report of reports) {
      const version = `v${report.entitlementVersion}`;
      const bucket = diagnostics.byVersion[version] || (diagnostics.byVersion[version] = { subscriptions: 0, ok: 0, review: 0, critical: 0 });
      bucket.subscriptions += 1;
      bucket[report.verdict] += 1;
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
          tally(diagnostics.consumedExceeds, `${version} gap=${d.meals}`);
        }
      }
    }

    const header = ["verdict", "code", "severity", "subscriptionId", "customer", "phone", "status",
      "total", "available", "reserved", "consumed", "forfeited", "evidenceConsumed", "gap", "details", "action"];
    const lines = [header.join(",")];
    for (const report of reports.filter((row) => row.verdict !== "ok")) {
      for (const finding of report.findings) {
        lines.push([
          report.verdict, finding.code, finding.severity, report.subscriptionId, report.customer, report.phone,
          report.status, report.counters.total, report.counters.available, report.counters.reserved,
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
