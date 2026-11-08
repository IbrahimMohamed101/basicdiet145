"use strict";
process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET ||= "synthetic-pos-g1-dashboard-secret";
process.env.JWT_SECRET ||= "synthetic-pos-g1-only-secret";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { createApp } = require("../src/app");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const DailyCashClosing = require("../src/models/DailyCashClosing");
const DashboardUser = require("../src/models/DashboardUser");
const Payment = require("../src/models/Payment");
const PosInvoice = require("../src/models/PosInvoice");
const Setting = require("../src/models/Setting");
const { getClosingVersion, seedStagingClosingStartDate } = require("../src/services/pos/closingVersionService");
const closingService = require("../src/services/dashboard/dailyCashClosingService");
const { buildDailyReport } = require("../src/services/dashboard/accountingDailyReportService");
const DATE = "2026-11-08";
const URI = "mongodb://127.0.0.1:27017/basicdiet_pos_g1_ci_test?directConnection=true";
function payload(cash, card, reason = "", other = []) {
  return { channels: { other }, collections: { cashHalala: cash, cardHalala: card },
    confirmedSubscriptionCount: null, discrepancyReason: reason, notes: "" };
}
function token(user) {
  return jwt.sign({ userId: String(user._id), role: user.role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET, { expiresIn: "1h" });
}
test("G1 rs0: version pin, zero reason, short cash, audit, legacy goldens and role guards", async () => {
  if (process.env.MONGO_URI_TEST !== URI) throw Error("Refusing any non-disposable local G1 database");
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 9000 });
  try {
    assert.equal(mongoose.connection.host, "127.0.0.1");
    assert.equal(mongoose.connection.name, "basicdiet_pos_g1_ci_test");
    assert.equal((await mongoose.connection.db.admin().command({ hello: 1 })).setName, "rs0");
    await mongoose.connection.dropDatabase();
    const roles = {};
    for (const role of ["cashier", "restaurant", "admin", "kitchen", "courier"]) {
      roles[role] = await DashboardUser.create({
        email: role + "@synthetic-g1.invalid", passwordHash: "synthetic-not-real-login", role, isActive: true,
      });
    }
    const app = createApp();
    const endpoint = "/api/dashboard/daily-closings/";
    const get = (date, role = "admin") => request(app).get(endpoint + date).set("Authorization", "Bearer " + token(roles[role]));
    const put = (date, body, role = "cashier") => request(app).put(endpoint + date)
      .set("Authorization", "Bearer " + token(roles[role])).send(body);
    const post = (date, action, body = {}, role = "cashier") => request(app).post(endpoint + date + "/" + action)
      .set("Authorization", "Bearer " + token(roles[role])).send(body);
    assert.equal(await getClosingVersion(DATE), "LEGACY_V1", "missing setting must fail safe");
    assert.equal((await get(DATE)).body.data.closingVersion, "LEGACY_V1");
    // A 2026-11-07 approved record predating the version schema stays legacy forever.
    const oldDate = "2026-11-07";
    const legacyChannels = { restaurantHalala: 500, hungerstationHalala: 100,
      keetaHalala: 0, other: [] };
    const legacyCollections = { cashHalala: 500, cardHalala: 0 };
    const oldAutomatic = { count: 0, amountHalala: 0, cashHalala: 0, cardHalala: 0,
      moyasarHalala: 0, unknownHalala: 0, refundsHalala: 0, reviewPaymentsCount: 0 };
    const legacySummary = closingService.calculateClosing(legacyChannels, legacyCollections, oldAutomatic, null);
    const older = await closingService.calculateForVersion(oldDate, "LEGACY_V1",
      { channels: legacyChannels, collections: legacyCollections, confirmedSubscriptionCount: null });
    await DailyCashClosing.collection.insertOne({
      businessDate: oldDate, status: "approved", channels: legacyChannels,
      collections: legacyCollections, confirmedSubscriptionCount: null, notes: "",
      discrepancyReason: "", createdBy: roles.admin._id,
      updatedAt: new Date(), createdAt: new Date(),
      snapshot: { ...older, summary: legacySummary, automatic: oldAutomatic,
        channels: legacyChannels, collections: legacyCollections, confirmedSubscriptionCount: null,
        discrepancyReason: "", notes: "", takenAt: new Date() },
    });
    const goldenView = (await get(oldDate)).body.data;
    const goldenReport = await buildDailyReport({ date: oldDate, includeDetails: false });
    assert.deepEqual(goldenView.summary, legacySummary);
    assert.equal(goldenView.closingVersion, "LEGACY_V1");
    assert.equal((await DailyCashClosing.findOne({ businessDate: oldDate }).lean()).closingVersion, undefined);
    const seeded = await seedStagingClosingStartDate({ testOnly: true });
    assert.equal(seeded.unchanged, false);
    assert.equal((await seedStagingClosingStartDate({ testOnly: true })).unchanged, true);
    assert.equal(await getClosingVersion(oldDate), "LEGACY_V1");
    assert.equal(await getClosingVersion(DATE), "POS_V2");
    assert.deepEqual((await get(oldDate)).body.data, goldenView, "legacy JSON remains unchanged");
    const afterReport = await buildDailyReport({ date: oldDate, includeDetails: false });
    // generatedAt is intentionally a fresh report timestamp, not a stored golden.
    assert.deepEqual({ ...afterReport, generatedAt: null },
      { ...goldenReport, generatedAt: null }, "legacy accounting content remains identical");
    // The synthetic acceptance fixture contains no customer names, phones or real prices.
    const instant = new Date("2026-11-08T11:00:00.000Z");
    await PosInvoice.collection.insertMany([
      { number: "STG-G1-001", idempotencyKey: "g1-001", businessDate: DATE, issuedAt: instant,
        channel: "restaurant", tender: { method: "cash" }, totals: { grossHalalas: 133565 } },
      { number: "STG-G1-002", idempotencyKey: "g1-002", businessDate: DATE, issuedAt: instant,
        channel: "restaurant", tender: { method: "network" }, totals: { grossHalalas: 317840 } },
      { number: "STG-G1-003", idempotencyKey: "g1-003", businessDate: DATE, issuedAt: instant,
        channel: "hungerstation", tender: { method: "app_receivable" }, totals: { grossHalalas: 7600 } },
    ]);
    const subCash = new mongoose.Types.ObjectId(), subVisa = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection("subscriptions").insertMany([
      { _id: subCash, userId: new mongoose.Types.ObjectId(), status: "active" },
      { _id: subVisa, userId: new mongoose.Types.ObjectId(), status: "active" },
    ]);
    await Payment.collection.insertMany([
      { subscriptionId: subCash, type: "subscription_activation", status: "paid",
        source: "dashboard_subscription_cash", provider: "cash", method: "cash",
        paidAt: instant, amount: 17400 },
      { subscriptionId: subVisa, type: "subscription_activation", status: "paid",
        source: "dashboard_subscription_visa", provider: "manual", method: "visa",
        paidAt: instant, amount: 17400 },
    ]);
    const initial = (await get(DATE)).body.data;
    assert.equal(initial.closingVersion, "POS_V2");
    assert.equal(initial.expectedTotals.expected.cashHalalas, 150965);
    assert.equal(initial.expectedTotals.expected.networkHalalas, 335240);
    assert.equal(initial.expectedTotals.expected.appReceivableHalalas, 7600);
    assert.equal(initial.expectedTotals.expected.totalHalalas, 493805);
    // Reject any POS-managed manual channel, even one explicitly sent as zero.
    const forbidden = await put(DATE, { ...payload(150965, 335240),
      channels: { restaurantHalala: 0, other: [] } });
    assert.equal(forbidden.status, 400, JSON.stringify(forbidden.body));
    assert.equal(forbidden.body.code, "MANUAL_CHANNEL_RECORDED_IN_POS");
    assert.equal((await get(DATE, "kitchen")).status, 403);
    assert.equal((await get(DATE, "courier")).status, 403);
    assert.equal((await put(DATE, payload(150965, 335240), "restaurant")).status, 201);
    const saved = await put(DATE, payload(150965, 335240), "cashier");
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.requiresReason, false, JSON.stringify(saved.body.data.reasonCodes));
    assert.deepEqual(saved.body.data.reasonCodes, []);
    assert.equal(saved.body.data.calculationMode, "pos_expected_totals");
    assert.equal((await post(DATE, "approve")).status, 403);
    const submitted = await post(DATE, "submit");
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.requiresReason, false);
    const firstSnapshot = (await DailyCashClosing.findOne({ businessDate: DATE }).lean()).snapshot;
    assert.equal(firstSnapshot.expectedTotals.expected.totalHalalas, 493805);
    assert.equal(firstSnapshot.closingVersion, "POS_V2");
    assert.equal(firstSnapshot.calculationFormulaVersion, 2);
    assert.ok(firstSnapshot.businessDayBounds.start);
    assert.equal(firstSnapshot.counted.cashHalala, 150965);
    assert.equal((await post(DATE, "return", { reason: "مراجعة اختبارية" })).status, 403);
    const returned = await post(DATE, "return", { reason: "مراجعة اختبارية" }, "admin");
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.equal(returned.body.data.returnedSnapshots.length, 1);
    assert.deepEqual(returned.body.data.returnedSnapshots[0].snapshot.expectedTotals.expected,
      firstSnapshot.expectedTotals.expected);
    assert.equal((await get(DATE, "cashier")).body.data.returnedSnapshots, undefined);
    const shortageSaved = await put(DATE, payload(150865, 335240), "restaurant");
    assert.equal(shortageSaved.status, 200);
    assert.equal(shortageSaved.body.data.requiresReason, true);
    assert.deepEqual(shortageSaved.body.data.reasonCodes, ["CASH_DIFFERENCE"]);
    assert.equal(shortageSaved.body.data.reconciliation.cashDifferenceHalala, -100);
    const denied = await post(DATE, "submit");
    assert.equal(denied.status, 400);
    assert.equal(denied.body.code, "DISCREPANCY_REASON_REQUIRED");
    assert.equal((await put(DATE, payload(150865, 335240, "عجز تجريبي ريال واحد"))).status, 200);
    const again = await post(DATE, "submit", {}, "restaurant");
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.reconciliation.cashDifferenceHalala, -100);
    const latest = await DailyCashClosing.findOne({ businessDate: DATE }).lean();
    assert.equal(latest.snapshot.discrepancyReason, "عجز تجريبي ريال واحد");
    assert.equal(latest.snapshot.differences.cashDifferenceHalala, -100);
    assert.equal(latest.returnedSnapshots.length, 1);
    // A sale arriving AFTER submit but BEFORE approval must not rewrite the frozen snapshot.
    await PosInvoice.collection.insertOne({ number: "STG-G1-LATER", idempotencyKey: "g1-later",
      businessDate: DATE, issuedAt: instant, channel: "restaurant",
      tender: { method: "cash" }, totals: { grossHalalas: 99 } });
    const approved = await post(DATE, "approve", {}, "admin");
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, "approved");
    assert.equal(approved.body.data.expectedTotals.expected.totalHalalas, 493805);
    const frozen = (await get(DATE, "admin")).body.data;
    assert.equal(frozen.expectedTotals.expected.totalHalalas, 493805);
    assert.equal(frozen.reconciliation.cashDifferenceHalala, -100);
    const report = await buildDailyReport({ date: DATE, includeDetails: false });
    assert.equal(report.financialClosing.closingVersion, "POS_V2");
    assert.equal(report.financialClosing.expectedTotals.expected.totalHalalas, 493805);
    assert.equal(report.financialClosing.reconciliation.cashDifferenceHalala, -100);
    // POS_V2 other manual channel is an app receivable, not counted cash/network.
    const enriched = closingService.applyPosOtherReceivables(initial.expectedTotals, {
      other: [{ name: "external-demo", reference: "synthetic-ref-001", amountHalala: 250 }],
    });
    assert.equal(enriched.expected.appReceivableHalalas, 7850);
    assert.equal(enriched.expected.totalHalalas, 494055);
    assert.equal(enriched.expected.cashHalalas, 150965);
    assert.throws(() => closingService.applyPosOtherReceivables(initial.expectedTotals, {
      other: [{ name: "hungerstation", reference: "synthetic-ref-002", amountHalala: 1 }],
    }), /POS/);
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  }
});
