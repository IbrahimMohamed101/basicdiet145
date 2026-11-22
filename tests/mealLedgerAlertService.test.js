"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const ActivityLog = require("../src/models/ActivityLog");
const MealLedgerAlert = require("../src/models/MealLedgerAlert");
const Setting = require("../src/models/Setting");
const {
  MealLedgerAlertError,
  acknowledgeAlert,
  deriveAlertCandidates,
  getAlertSummary,
  listAlerts,
  planAlertSync,
  runMealLedgerAlertScan,
} = require("../src/services/subscription/mealLedgerAlertService");

const NOW = new Date("2026-11-23T03:00:00Z");
const SUB_A = "0000000000000000000000a1";
const SUB_B = "0000000000000000000000a2";

const report = (subscriptionId, findings) => ({
  subscriptionId, userId: "0000000000000000000000c1", customer: "Customer", phone: "+966500000000", findings,
});
const stale = (days) => ({
  code: "STALE_RESERVATION", severity: "high", message: "m", action: "a",
  details: { meals: days.reduce((sum, d) => sum + d.meals, 0), days },
});
const over = (date) => ({
  code: "DAY_OVER_DEDUCTED", severity: "high", message: "m", action: "a",
  details: { date, deductedMeals: 4 },
});

async function main() {
  // 1. A stale reservation becomes one alert per stuck day, with its age.
  {
    const out = deriveAlertCandidates(report(SUB_A, [stale([
      { date: "2026-11-09", dayStatus: "ready_for_delivery", meals: 1 },
      { date: "2026-11-17", dayStatus: "open", meals: 3 },
    ])]), { today: "2026-11-23" });
    assert.deepEqual(out.map((c) => c.dedupeKey), ["STALE_RESERVATION:2026-11-09", "STALE_RESERVATION:2026-11-17"]);
    assert.equal(out[0].details.ageDays, 14);
    assert.equal(out[1].details.meals, 3);
    assert.equal(out[1].customerName, "Customer");
  }

  // 2. A dated finding is keyed by its date, an undated one by its code.
  {
    const out = deriveAlertCandidates(report(SUB_A, [over("2026-11-15"), {
      code: "EQUATION_MISMATCH", severity: "critical", message: "m", action: "a", details: { equationDifference: 2 },
    }]));
    assert.deepEqual(out.map((c) => c.dedupeKey), ["DAY_OVER_DEDUCTED:2026-11-15", "EQUATION_MISMATCH"]);
    assert.equal(out[1].date, null);
    assert.equal(out[1].severity, "critical");
  }

  // 3. No findings, no alerts.
  assert.deepEqual(deriveAlertCandidates(report(SUB_A, [])), []);
  assert.deepEqual(deriveAlertCandidates(null), []);

  // 4. Sync plan: create / refresh / reopen / resolve.
  {
    const cand = (sub, key) => ({ subscriptionId: sub, dedupeKey: key, code: key.split(":")[0] });
    const stored = (id, sub, key, status, extra = {}) => ({ _id: id, subscriptionId: sub, dedupeKey: key, status, ...extra });
    const plan = planAlertSync({
      candidates: [
        cand(SUB_A, "STALE_RESERVATION:2026-11-17"),   // already open        -> refresh
        cand(SUB_A, "STALE_RESERVATION:2026-11-18"),   // brand new           -> create
        cand(SUB_A, "DAY_OVER_DEDUCTED:2026-11-15"),   // was acknowledged    -> refresh, stays acknowledged
        cand(SUB_A, "STALE_RESERVATION:2026-11-09"),   // was resolved before -> reopen
        cand(SUB_A, "STALE_RESERVATION:2026-11-18"),   // duplicate candidate -> ignored
      ],
      existing: [
        stored("1", SUB_A, "STALE_RESERVATION:2026-11-17", "open"),
        stored("2", SUB_A, "DAY_OVER_DEDUCTED:2026-11-15", "acknowledged"),
        stored("3", SUB_A, "STALE_RESERVATION:2026-11-09", "resolved", { reopenCount: 1 }),
        stored("4", SUB_A, "STALE_RESERVATION:2026-11-01", "open"),   // scanned, gone   -> resolve
        stored("5", SUB_B, "STALE_RESERVATION:2026-11-02", "open"),   // not scanned     -> resolve
        stored("6", SUB_B, "STALE_RESERVATION:2026-11-03", "resolved"), // stays resolved
      ],
      scannedSubscriptionIds: [SUB_A],
      now: NOW,
    });
    assert.deepEqual(plan.create.map((r) => r.dedupeKey), ["STALE_RESERVATION:2026-11-18"]);
    assert.equal(plan.create[0].status, "open");
    assert.deepEqual(plan.refresh.map((r) => r.id).sort(), ["1", "2"]);
    assert.deepEqual(plan.reopen.map((r) => [r.id, r.reopenCount]), [["3", 2]]);
    assert.deepEqual(plan.resolve.map((r) => [r.id, r.reason]).sort(), [["4", "condition_cleared"], ["5", "subscription_not_current"]]);
  }

  // 5. The scan writes the plan in one bulk call and records its stats.
  {
    const calls = { ops: null, setting: null };
    MealLedgerAlert.find = () => ({ lean: async () => [
      { _id: "o1", subscriptionId: SUB_A, dedupeKey: "STALE_RESERVATION:2026-11-01", status: "open" },
    ] });
    MealLedgerAlert.bulkWrite = async (ops) => { calls.ops = ops; };
    Setting.updateOne = async (filter, update) => { calls.setting = { filter, update }; };
    const stats = await runMealLedgerAlertScan({
      now: NOW,
      loadReports: async () => ({
        subscriptions: [{ _id: SUB_A }],
        skippedEnded: 198,
        reports: [report(SUB_A, [stale([{ date: "2026-11-17", dayStatus: "open", meals: 3 }])])],
      }),
    });
    assert.equal(stats.subscriptionsScanned, 1);
    assert.equal(stats.endedButStillActiveSkipped, 198);
    assert.equal(stats.problemsFound, 1);
    assert.equal(stats.created, 1);
    assert.equal(stats.resolved, 1);
    assert.equal(calls.ops.length, 2);
    const upsert = calls.ops.find((op) => op.updateOne.upsert);
    assert.equal(upsert.updateOne.filter.dedupeKey, "STALE_RESERVATION:2026-11-17");
    assert.equal(upsert.updateOne.update.$setOnInsert.status, "open");
    const resolve = calls.ops.find((op) => op.updateOne.update.$set.status === "resolved");
    assert.deepEqual(resolve.updateOne.filter, { _id: "o1", status: { $ne: "resolved" } });
    assert.equal(calls.setting.filter.key, "meal_ledger_alerts_last_scan");
    assert.equal(calls.setting.update.$set.value.created, 1);
  }

  // 6. A failed reconciliation writes nothing, so it can never resolve alerts.
  {
    let wrote = false;
    MealLedgerAlert.bulkWrite = async () => { wrote = true; };
    Setting.updateOne = async () => { wrote = true; };
    await assert.rejects(() => runMealLedgerAlertScan({
      now: NOW,
      loadReports: async () => { throw new Error("db unavailable"); },
    }), /db unavailable/);
    assert.equal(wrote, false);
  }

  // 7. Acknowledging needs a real note and only works on an open alert.
  {
    const logged = [];
    ActivityLog.create = async (rows) => { logged.push(...rows); };
    let received = null;
    MealLedgerAlert.findOneAndUpdate = (filter, update) => {
      received = { filter, update };
      return { lean: async () => ({ _id: "x1", subscriptionId: SUB_A, code: "DAY_OVER_DEDUCTED", date: "2026-11-15", status: "acknowledged", acknowledgedNote: "ok", acknowledgedBy: { role: "admin" } }) };
    };
    await assert.rejects(() => acknowledgeAlert({ id: "x1", note: "  " }), (e) => e.code === "NOTE_REQUIRED");
    await assert.rejects(() => acknowledgeAlert({ id: "x1", note: "ab" }), (e) => e.code === "NOTE_REQUIRED");
    await assert.rejects(() => acknowledgeAlert({ id: "x1", note: "x".repeat(501) }), (e) => e.code === "NOTE_TOO_LONG");
    assert.equal(received, null, "no write for an invalid note");

    const done = await acknowledgeAlert({ id: "x1", actorId: "u1", actorRole: "admin", note: "تم التأكد من الموظف", now: NOW });
    assert.equal(done.status, "acknowledged");
    assert.deepEqual(received.filter, { _id: "x1", status: "open" });
    assert.equal(received.update.$set.acknowledgedNote, "تم التأكد من الموظف");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].action, "meal_ledger_alert_acknowledged");
    assert.equal(logged[0].meta.alertId, "x1");

    MealLedgerAlert.findOneAndUpdate = () => ({ lean: async () => null });
    MealLedgerAlert.exists = async () => ({ _id: "x1" });
    await assert.rejects(() => acknowledgeAlert({ id: "x1", note: "تم التأكد" }), (e) => e instanceof MealLedgerAlertError && e.code === "ALERT_NOT_OPEN" && e.status === 409);
    MealLedgerAlert.exists = async () => null;
    await assert.rejects(() => acknowledgeAlert({ id: "x1", note: "تم التأكد" }), (e) => e.code === "ALERT_NOT_FOUND" && e.status === 404);
  }

  // 8. The summary separates pending from acknowledged and carries the last scan.
  {
    MealLedgerAlert.aggregate = async () => [
      { _id: { status: "open", severity: "high" }, count: 4, oldest: new Date("2026-11-10T00:00:00Z") },
      { _id: { status: "open", severity: "critical" }, count: 1, oldest: new Date("2026-11-12T00:00:00Z") },
      { _id: { status: "acknowledged", severity: "high" }, count: 2, oldest: new Date("2026-11-01T00:00:00Z") },
    ];
    Setting.findOne = () => ({ lean: async () => ({ value: { at: "2026-11-23T03:00:00.000Z", created: 1 } }) });
    const summary = await getAlertSummary();
    assert.equal(summary.pending, 5);
    assert.deepEqual(summary.pendingBySeverity, { critical: 1, high: 4, medium: 0, low: 0 });
    assert.equal(summary.acknowledged, 2);
    assert.equal(summary.oldestPendingAt.toISOString(), "2026-11-10T00:00:00.000Z");
    assert.equal(summary.lastScan.created, 1);
  }

  // 9. Listing: "pending" means open only; critical sorts first; bad filter rejected.
  {
    let query = null;
    MealLedgerAlert.find = (q) => {
      query = q;
      const rows = [
        { _id: "a", subscriptionId: SUB_A, severity: "high", date: "2026-11-09", status: "open" },
        { _id: "b", subscriptionId: SUB_A, severity: "critical", date: "2026-11-17", status: "open" },
      ];
      const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => rows };
      return chain;
    };
    MealLedgerAlert.countDocuments = async () => 2;
    const out = await listAlerts({ status: "pending" });
    assert.deepEqual(query, { status: "open" });
    assert.deepEqual(out.alerts.map((a) => a.id), ["b", "a"]);
    assert.equal(out.total, 2);
    await assert.rejects(() => listAlerts({ status: "weird" }), (e) => e.code === "INVALID_STATUS");
  }



  console.log("mealLedgerAlertService tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
