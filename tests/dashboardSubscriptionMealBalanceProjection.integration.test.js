"use strict";

process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "dashboard-projection-test-secret";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "client-projection-test-secret";
process.env.DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED = "false";

const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const User = require("../src/models/User");
const { inspectSubscription, applyCorrection } = require("../scripts/reconcile-stacked-delivery-balances");
const { getTodayKSADate } = require("../src/utils/date");
const { issueAppAccessToken } = require("../src/services/appTokenService");
const {
  issueDashboardAccessToken,
} = require("../src/services/dashboardTokenService");

const DB_NAME = "dashboard_balance_projection_integration_test";
const WRITE_COMMANDS = new Set([
  "insert",
  "update",
  "delete",
  "findAndModify",
  "bulkWrite",
]);

async function verifyHistoricalDeliveryReconciliation({ api, user, plan }) {
  const today = getTodayKSADate();
  const now = new Date(`${today}T00:00:00+03:00`);
  const dateAt = (offset) => new Date(now.getTime() + offset * 86400000);
  const subscription = await Subscription.create({
    userId: user._id, planId: plan._id, status: "active",
    startDate: dateAt(-20), endDate: dateAt(2), validityEndDate: dateAt(2),
    totalMeals: 52, remainingMeals: 12, consumedMeals: 40, entitlementVersion: 2,
    deliveryMode: "delivery", selectedGrams: 150, selectedMealsPerDay: 2,
  });
  const batch = await Batch.create({
    userId: user._id, containerSubscriptionId: subscription._id, planId: plan._id,
    sourceType: "dashboard", sourceKey: "synthetic-delivery-reconciliation",
    applicationState: "applied", status: "active", requestedStartDate: dateAt(-20),
    effectiveStartDate: dateAt(-20), endDate: dateAt(2), validityEndDate: dateAt(2),
    totalMeals: 52, remainingMeals: 46, consumedMeals: 6,
    daysCount: 26, mealsPerDay: 2, proteinGrams: 150, deliverySnapshot: { mode: "delivery" },
  });
  const days = Array.from({ length: 17 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(), subscriptionId: subscription._id,
    date: getTodayKSADate(dateAt(index - 17)),
    status: "fulfilled", creditsDeducted: true, fulfilledAt: dateAt(index - 17),
    fulfilledSnapshot: { deductedCredits: 2 },
  }));
  await SubscriptionDay.collection.insertMany(days);
  await Delivery.insertMany(days.map((day) => ({
    dayId: day._id, subscriptionId: subscription._id, date: day.date,
    status: "delivered", deliveredAt: day.fulfilledAt,
  })));
  const audits = days.map((day) => ({
    entityType: "subscription_day", entityId: day._id, action: "fulfill",
    fromStatus: "out_for_delivery", toStatus: "fulfilled", actorType: "admin",
  }));
  await SubscriptionAuditLog.insertMany(audits.slice(0, -1));
  const parentBefore = await Subscription.findById(subscription._id).lean();
  const batchBefore = await Batch.findById(batch._id).lean();
  const missingEvidence = await inspectSubscription(parentBefore, [batchBefore]);
  assert.strictEqual(missingEvidence.outcome, "evidence-does-not-close-gap");
  assert.strictEqual(missingEvidence.evidenced, 32);
  await SubscriptionAuditLog.create(audits.at(-1));
  const repair = await inspectSubscription(parentBefore, [batchBefore]);
  assert.strictEqual(repair.outcome, "reconcilable");
  assert.strictEqual(repair.quantity, 34);
  assert.strictEqual(repair.deliveries.length, 17);
  const applied = await applyCorrection(parentBefore, repair);
  assert.deepStrictEqual([applied.remainingMeals, applied.consumedMeals], [12, 40]);
  await assert.rejects(applyCorrection(parentBefore, repair), /Package changed/);
  assert.deepStrictEqual(await Subscription.findById(subscription._id).lean(), parentBefore);
  assert.strictEqual(
    (await inspectSubscription(parentBefore, [await Batch.findById(batch._id).lean()])).outcome,
    "no-reconcilable-drift"
  );

  const admin = await DashboardUser.create({
    email: "balance-reconciliation@example.test", passwordHash: "not-used",
    role: "superadmin", isActive: true,
  });
  const headers = { Authorization: `Bearer ${issueDashboardAccessToken(admin)}` };
  const detail = await api.get(`/api/dashboard/subscriptions/${subscription._id}`).set(headers);
  const search = await api.get("/api/dashboard/subscriptions/search").query({ phone: user.phone }).set(headers);
  const profile = await api.get(`/api/dashboard/customer-management/${user._id}`).set(headers);
  const summary = await api.get("/api/dashboard/subscriptions/summary").set(headers);
  for (const response of [detail, search, profile, summary]) assert.strictEqual(response.status, 200);
  assert.strictEqual(detail.body.data.stacking.aggregateBalance.remainingMeals, 12);
  assert.strictEqual(detail.body.data.stacking.packages[0].remainingMeals, 12);
  assert.strictEqual(search.body.data.subscription.displayRemainingMeals, 12);
  assert.strictEqual(profile.body.data.activeSubscription.balances.remainingMeals, 12);
  assert.strictEqual(profile.body.data.activeSubscription.balances.consumedMeals, 40);
  assert.strictEqual(summary.body.data.summary.totalRemainingMeals, 48);

  await Batch.updateOne({ _id: batch._id }, { $inc: { remainingMeals: -2, reservedMeals: 2 } });
  const listing = await api.get("/api/dashboard/subscriptions").set(headers);
  const listingRow = listing.body.data.find((row) => row.id === String(subscription._id));
  const exported = await api.get("/api/dashboard/subscriptions/export").set(headers);
  const exportRow = exported.body.data.items.find((row) => row.id === String(subscription._id));
  const reservedProfile = await api.get(`/api/dashboard/customer-management/${user._id}`).set(headers);
  for (const row of [listingRow, exportRow]) {
    assert.strictEqual(row.remainingMeals, 12);
    assert.strictEqual(row.availableMeals, 10);
    assert.strictEqual(row.stacking.packages[0].remainingMeals, 10);
    assert.strictEqual(row.stacking.aggregateBalance.reservedMeals, 2);
  }
  assert.strictEqual(reservedProfile.body.data.activeSubscription.balances.remainingMeals, 12);
  assert.strictEqual(reservedProfile.body.data.activeSubscription.balances.reservedMeals, 2);
}

async function main() {
  const mongoDbPath = fs.mkdtempSync(path.join(process.cwd(), "tmp-dashboard-balance-mongo-"));
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: DB_NAME,
      storageEngine: "wiredTiger",
    },
    instanceOpts: [{ dbPath: mongoDbPath, args: ["--nounixsocket"] }],
  });
  const mongoUri = replSet.getUri(DB_NAME);
  const parsedUri = new URL(mongoUri);
  console.log(
    `Isolated test database: host=${parsedUri.hostname}:${parsedUri.port} db=${DB_NAME}`
  );

  try {
    await mongoose.connect(mongoUri, { monitorCommands: true });

    const user = await User.create({
      phone: `+9665${String(Date.now()).slice(-8)}`,
      name: "Dashboard Projection Test User",
      role: "client",
      isActive: true,
    });
    const otherUser = await User.create({
      phone: `+9666${String(Date.now()).slice(-8)}`,
      name: "Other Projection Test User",
      role: "client",
      isActive: true,
    });
    const plan = await Plan.create({
      name: { ar: "اختبار إسقاط الرصيد", en: "Balance Projection Test" },
      daysCount: 30,
      currency: "SAR",
      isActive: true,
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: "active",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      validityEndDate: new Date("2026-12-31T00:00:00.000Z"),
      totalMeals: 52,
      remainingMeals: 36,
      entitlementVersion: 2,
      reservedMeals: 16,
      consumedMeals: 0,
      forfeitedMeals: 0,
      selectedGrams: 150,
      selectedMealsPerDay: 2,
      deliveryMode: "pickup",
    });
    const dashboardUser = await DashboardUser.create({
      email: `dashboard-projection-${Date.now()}@example.com`,
      passwordHash: "not-used",
      role: "admin",
      isActive: true,
    });

    const dashboardHeaders = {
      Authorization: `Bearer ${issueDashboardAccessToken(dashboardUser)}`,
      "Accept-Language": "en",
    };
    const otherCustomerHeaders = {
      Authorization: `Bearer ${issueAppAccessToken(otherUser)}`,
      "Accept-Language": "en",
    };
    const app = createApp();
    const api = request(app);
    const detailPath = `/api/dashboard/subscriptions/${subscription._id}`;

    const disabled = await api.get(detailPath).set(dashboardHeaders);
    assert.strictEqual(disabled.status, 200);
    assert.strictEqual(disabled.body.data.remainingMeals, 36);
    assert.strictEqual(disabled.body.data.displayRemainingMeals, undefined);
    assert.strictEqual(disabled.body.data.balanceProjection, undefined);

    process.env.DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED = "true";

    const before = await Subscription.collection.findOne({
      _id: subscription._id,
    });
    const auditCountBefore = await SubscriptionAuditLog.countDocuments({
      $or: [
        { entityId: subscription._id },
        { "meta.subscriptionId": String(subscription._id) },
      ],
    });
    const activityCountBefore = await ActivityLog.countDocuments({
      entityId: subscription._id,
    });
    const writeCommands = [];
    const commandListener = (event) => {
      if (WRITE_COMMANDS.has(event.commandName)) {
        writeCommands.push(event.commandName);
      }
    };
    mongoose.connection.client.on("commandStarted", commandListener);

    const concurrentDetailResponses = await Promise.all(
      Array.from({ length: 8 }, () => api.get(detailPath).set(dashboardHeaders))
    );
    for (const response of concurrentDetailResponses) {
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.remainingMeals, 52);
      assert.strictEqual(response.body.data.displayRemainingMeals, 52);
      assert.strictEqual(response.body.data.availableMeals, 36);
      assert.strictEqual(response.body.data.reservedMeals, 16);
      assert.strictEqual(response.body.data.consumedMeals, 0);
    }

    const listResponse = await api
      .get("/api/dashboard/subscriptions")
      .set(dashboardHeaders);
    assert.strictEqual(listResponse.status, 200);
    const listRow = listResponse.body.data.find(
      (row) => String(row._id || row.id) === String(subscription._id)
    );
    assert(listRow, "subscription must be present in Dashboard list");
    assert.strictEqual(listRow.remainingMeals, 52);
    assert.strictEqual(listRow.availableMeals, 36);

    const exportResponse = await api
      .get("/api/dashboard/subscriptions/export")
      .set(dashboardHeaders);
    assert.strictEqual(exportResponse.status, 200);
    const exportRow = exportResponse.body.data.items.find(
      (row) => String(row._id || row.id) === String(subscription._id)
    );
    assert(exportRow, "subscription must be present in Dashboard export");
    assert.strictEqual(exportRow.remainingMeals, 52);
    assert.strictEqual(exportRow.availableMeals, 36);

    const summaryResponse = await api
      .get("/api/dashboard/subscriptions/summary")
      .set(dashboardHeaders);
    assert.strictEqual(summaryResponse.status, 200);
    assert.strictEqual(
      summaryResponse.body.data.summary.totalRemainingMeals,
      36
    );
    assert.strictEqual(summaryResponse.body.data.balanceProjection, undefined);

    const customerAttempt = await api
      .get(detailPath)
      .set(otherCustomerHeaders);
    assert.strictEqual(customerAttempt.status, 401);

    mongoose.connection.client.off("commandStarted", commandListener);

    const excessiveDeduction = await api
      .post(`${detailPath}/manual-deduction`)
      .set(dashboardHeaders)
      .send({
        regularMeals: 37,
        premiumMeals: 0,
        reason: "Projected credit must not be deductible",
      });
    assert.strictEqual(excessiveDeduction.status, 409);
    assert.strictEqual(
      excessiveDeduction.body.error.code,
      "INSUFFICIENT_REMAINING_MEALS"
    );

    const after = await Subscription.collection.findOne({
      _id: subscription._id,
    });
    const auditCountAfter = await SubscriptionAuditLog.countDocuments({
      $or: [
        { entityId: subscription._id },
        { "meta.subscriptionId": String(subscription._id) },
      ],
    });
    const activityCountAfter = await ActivityLog.countDocuments({
      entityId: subscription._id,
    });

    assert.deepStrictEqual(after, before, "stored subscription must be unchanged");
    assert.strictEqual(auditCountAfter, auditCountBefore);
    assert.strictEqual(activityCountAfter, activityCountBefore);
    assert.deepStrictEqual(
      writeCommands,
      [],
      `read verification emitted writes: ${writeCommands.join(",")}`
    );

    await verifyHistoricalDeliveryReconciliation({ api, user: otherUser, plan });

    console.log(
      "dashboardSubscriptionMealBalanceProjection.integration.test.js passed"
    );
  } finally {
    process.env.DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED = "false";
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await replSet.stop();
    fs.rmSync(mongoDbPath, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
