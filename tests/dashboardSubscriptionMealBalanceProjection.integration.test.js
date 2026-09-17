"use strict";

process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "dashboard-projection-test-secret";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "client-projection-test-secret";
process.env.DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED = "false";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const User = require("../src/models/User");
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

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: DB_NAME,
      storageEngine: "wiredTiger",
    },
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

    mongoose.connection.client.off("commandStarted", commandListener);

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
      `read and rejected-write verification emitted writes: ${writeCommands.join(",")}`
    );

    console.log(
      "dashboardSubscriptionMealBalanceProjection.integration.test.js passed"
    );
  } finally {
    process.env.DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED = "false";
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await replSet.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
