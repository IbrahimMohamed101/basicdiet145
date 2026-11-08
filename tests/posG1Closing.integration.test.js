"use strict";
process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = "g1-local-disposable-ci-secret";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const express = require("express");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");
const DashboardUser = require("../src/models/DashboardUser");
const DailyCashClosing = require("../src/models/DailyCashClosing");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");
const PosInvoice = require("../src/models/PosInvoice");
const { resolveClosingVersion, versionAt, scheduleStartDate } = require("../src/services/pos/posClosingSetting");
const { reasonCodesFor, calculateClosing, addOtherReceivables } = require("../src/services/dashboard/dailyCashClosingService");
const router = require("../src/routes/dashboardDailyCashClosings");
const { dashboardRoleHasPermission } = require("../src/constants/dashboardRoles");
const start = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard/daily-closings", router);
  const server = await new Promise(resolve => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  return { base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise(resolve => server.close(resolve)) };
};
const body = (cash = 150965, card = 335240) => ({
  channels: { other: [] }, collections: { cashHalala: cash, cardHalala: card },
  confirmedSubscriptionCount: null, discrepancyReason: "", notes: "",
});
test("G1 pure POS reason codes exclude legacy manual amount differences", () => {
  const totals = { expected: { cashHalalas: 150965, networkHalalas: 335240,
    appReceivableHalalas: 7600, totalHalalas: 493805 } };
  const { reconcileCountedWithServer } = require("../src/services/dashboard/dailyCashClosingService");
  const zero = reconcileCountedWithServer(body().collections, totals);
  const old = calculateClosing({ restaurantHalala: 0, hungerstationHalala: 0, keetaHalala: 0, other: [] },
    body().collections, { count: 0, amountHalala: 0, cashHalala: 0, cardHalala: 0, moyasarHalala: 0 }, null);
  assert.equal(old.localDifferenceHalala, 486205);
  assert.deepEqual(reasonCodesFor({ version: "POS_V2", summary: old, reconciliation: zero,
    automatic: { reviewPaymentsCount: 0, refundsHalala: 0 } }), []);
  const missing = reconcileCountedWithServer(body(150865).collections, totals);
  assert.deepEqual(reasonCodesFor({ version: "POS_V2", summary: old, reconciliation: missing,
    automatic: { reviewPaymentsCount: 0, refundsHalala: 0 } }), ["CASH_DIFFERENCE"]);
  assert.equal(missing.cashDifferenceHalala, -100);
  const other = addOtherReceivables(totals, { other: [{ name: "External", reference: "ORDER-1", amountHalala: 200 }] });
  assert.equal(other.expected.appReceivableHalalas, 7800);
  assert.equal(other.expected.totalHalalas, 494005);
  assert.equal(other.expected.cashHalalas, 150965);
});
test("G1 absent start date is legacy and changes are effective dated", () => {
  assert.equal(versionAt("2026-11-08", null), "LEGACY_V1");
  const policy = { baselineStartDate: null, changes: [
    { effectiveFrom: "2026-11-08", startDate: "2026-11-08" },
  ] };
  assert.equal(versionAt("2026-11-07", policy), "LEGACY_V1");
  assert.equal(versionAt("2026-11-08", policy), "POS_V2");
});
test("G1 real isolated rs0: POS submit/return/approve, frozen snapshots, legacy golden, and roles", async () => {
  const uri = process.env.MONGO_URI_TEST || "";
  if (process.env.NODE_ENV !== "test" || !/^mongodb:\/\/127\.0\.0\.1:27017\/basicdiet_pos_g1_ci_test\?replicaSet=rs0$/.test(uri)) {
    throw new Error("G1 refuses all non-disposable local replica databases");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  let server;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, "rs0");
    await mongoose.connection.dropDatabase();
    assert.equal(await resolveClosingVersion("2026-11-08"), "LEGACY_V1");
    const users = {};
    for (const role of ["cashier", "restaurant", "admin", "kitchen", "courier"]) {
      const user = await DashboardUser.create({ email: role + "@g1-ci.invalid",
        name: role, passwordHash: "not-a-production-credential", role, isActive: true });
      users[role] = issueDashboardAccessToken(user);
    }
    const adminActor = await DashboardUser.findOne({ role: "admin" });
    const scheduled = await scheduleStartDate({ startDate: "2026-11-08",
      effectiveFrom: "2026-11-08", actorId: adminActor._id, actorRole: "admin" }, { testOnly: true });
    assert.equal(scheduled.startDate, "2026-11-08");
    assert.equal(await resolveClosingVersion("2026-11-07"), "LEGACY_V1");
    assert.equal(await resolveClosingVersion("2026-11-08"), "POS_V2");
    const audit = await ActivityLog.findOne({ action: "pos_closing_start_date_scheduled" }).lean();
    assert.equal(audit.meta.startDate, "2026-11-08");
    await assert.rejects(() => scheduleStartDate({ startDate: "2026-11-09",
      effectiveFrom: "2026-11-09", actorId: adminActor._id, actorRole: "cashier" }, { testOnly: true }),
      /Admin actor required/);
    // Purely synthetic POS finance fixtures; no actual customer or prices.
    await PosInvoice.collection.insertMany([
      { number: "STG-G1-000001", idempotencyKey: "g1-synthetic-000001", channel: "restaurant", tender: { method: "cash" },
        totals: { grossHalalas: 150965, vatHalalas: 0 }, businessDate: "2026-11-08", issuedAt: new Date("2026-11-08T09:00:00Z") },
      { number: "STG-G1-000002", idempotencyKey: "g1-synthetic-000002", channel: "restaurant", tender: { method: "network" },
        totals: { grossHalalas: 335240, vatHalalas: 0 }, businessDate: "2026-11-08", issuedAt: new Date("2026-11-08T09:01:00Z") },
      { number: "STG-G1-000003", idempotencyKey: "g1-synthetic-000003", channel: "hungerstation", tender: { method: "app_receivable" },
        totals: { grossHalalas: 7600, vatHalalas: 0 }, businessDate: "2026-11-08", issuedAt: new Date("2026-11-08T09:02:00Z") },
    ]);
    server = await start();
    async function call(role, method, date, path = "", payload) {
      const result = await fetch(server.base + "/api/dashboard/daily-closings/" + date + path, {
        method, headers: { Authorization: "Bearer " + users[role], "content-type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: result.status, json: await result.json() };
    }
    const date = "2026-11-08";
    let first = await call("cashier", "GET", date);
    assert.equal(first.json.data.closingVersion, "POS_V2");
    assert.equal(first.json.data.expectedTotals.expected.totalHalalas, 493805);
    assert.equal(first.json.data.expectedTotals.expected.cashHalalas, 150965);
    assert.equal(first.json.data.expectedTotals.expected.networkHalalas, 335240);
    assert.equal(first.json.data.expectedTotals.expected.appReceivableHalalas, 7600);
    assert.equal((await call("kitchen", "GET", date)).status, 403);
    assert.equal((await call("courier", "GET", date)).status, 403);
    const forged = await call("cashier", "PUT", date, "", { ...body(),
      channels: { restaurantHalala: 1, other: [] } });
    assert.equal(forged.status, 400);
    assert.equal(forged.json.code, "MANUAL_CHANNEL_RECORDED_IN_POS");
    const zeroManual = await call("cashier", "PUT", date, "", {
      ...body(), channels: { keetaHalala: 0, other: [] },
    });
    assert.equal(zeroManual.status, 400);
    assert.equal(zeroManual.json.code, "MANUAL_CHANNEL_RECORDED_IN_POS");
    assert.equal((await call("restaurant", "PUT", date, "", body())).status, 201);
    let view = await call("cashier", "GET", date);
    assert.equal(view.json.data.requiresReason, false);
    assert.deepEqual(view.json.data.reasonCodes, []);
    assert.equal((await call("cashier", "POST", date, "/submit", {})).status, 200);
    let frozen = await DailyCashClosing.findOne({ businessDate: date }).lean();
    assert.equal(frozen.snapshot.closingVersion, "POS_V2");
    assert.equal(frozen.snapshot.reconciliation.localDifferenceHalala, 0);
    assert.equal(frozen.snapshot.counted.cashHalala, 150965);
    assert.ok(frozen.snapshot.businessDayBounds.start);
    assert.equal((await call("restaurant", "POST", date, "/approve", {})).status, 403);
    assert.equal((await call("cashier", "POST", date, "/return", { reason: "No" })).status, 403);
    assert.equal((await call("admin", "POST", date, "/return", { reason: "Recheck" })).status, 200);
    const returned = await DailyCashClosing.findOne({ businessDate: date }).lean();
    assert.equal(returned.snapshot, null);
    assert.equal(returned.returnedSnapshots.length, 1);
    assert.equal(returned.returnedSnapshots[0].snapshot.expectedTotals.expected.totalHalalas, 493805);
    assert.equal((await call("cashier", "PUT", date, "", body(150865))).status, 200);
    view = await call("restaurant", "GET", date);
    assert.equal(view.json.data.requiresReason, true);
    assert.deepEqual(view.json.data.reasonCodes, ["CASH_DIFFERENCE"]);
    const refused = await call("cashier", "POST", date, "/submit", {});
    assert.equal(refused.status, 400);
    assert.equal(refused.json.code, "DISCREPANCY_REASON_REQUIRED");
    assert.equal((await call("restaurant", "PUT", date, "", { ...body(150865), discrepancyReason: "Counted one SAR shortage" })).status, 200);
    assert.equal((await call("restaurant", "POST", date, "/submit", {})).status, 200);
    frozen = await DailyCashClosing.findOne({ businessDate: date }).lean();
    assert.equal(frozen.snapshot.reconciliation.cashDifferenceHalala, -100);
    assert.equal(frozen.snapshot.discrepancyReason, "Counted one SAR shortage");
    assert.equal((await call("admin", "POST", date, "/approve", {})).status, 200);
    await PosInvoice.collection.insertOne({ number: "STG-G1-000004", idempotencyKey: "g1-synthetic-000004", channel: "restaurant",
      tender: { method: "cash" }, totals: { grossHalalas: 50, vatHalalas: 0 },
      businessDate: date, issuedAt: new Date("2026-11-08T10:00:00Z") });
    const approved = await call("cashier", "GET", date);
    assert.equal(approved.json.data.expectedTotals.expected.totalHalalas, 493805);
    assert.equal(approved.json.data.reconciliation.cashDifferenceHalala, -100);
    assert.equal((await call("admin", "POST", date, "/return", { reason: "Cannot" })).status, 409);

    // Golden Legacy fixture remains without version; GET/approval cannot reclassify it.
    const legacy = "2026-11-07";
    const oldInputs = {
      channels: { restaurantHalala: 10000, hungerstationHalala: 2000, keetaHalala: 3000, other: [] },
      collections: { cashHalala: 10000, cardHalala: 0 },
      confirmedSubscriptionCount: null, discrepancyReason: "", notes: "",
    };
    const summary = calculateClosing(oldInputs.channels, oldInputs.collections,
      { count: 0, amountHalala: 0, cashHalala: 0, cardHalala: 0, moyasarHalala: 0, unknownHalala: 0 }, null);
    const owner = await DashboardUser.findOne({ role: "admin" });
    await DailyCashClosing.create({ businessDate: legacy, status: "approved",
      ...oldInputs, createdBy: owner._id, approvedBy: owner._id,
      snapshot: { ...oldInputs, summary,
        automatic: { count: 0, amountHalala: 0, cashHalala: 0, cardHalala: 0, moyasarHalala: 0, unknownHalala: 0 },
        expectedTotals: { expected: { cashHalalas: 0, networkHalalas: 0, appReceivableHalalas: 0, totalHalalas: 0 } },
        reconciliation: { cashDifferenceHalala: 0, networkDifferenceHalala: 0, localDifferenceHalala: 0 } },
    });
    const golden = await call("admin", "GET", legacy);
    assert.equal(golden.json.data.closingVersion, "LEGACY_V1");
    assert.deepEqual(golden.json.data.summary, summary);
    const inDb = await DailyCashClosing.collection.findOne({ businessDate: legacy });
    assert.equal(Object.hasOwn(inDb, "closingVersion"), false);
    assert.equal(dashboardRoleHasPermission("cashier", ["admin"]), false);
  } finally {
    if (server) await server.close();
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  }
});
