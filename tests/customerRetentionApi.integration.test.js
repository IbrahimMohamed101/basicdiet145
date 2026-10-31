"use strict";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "retention-integration-user-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "retention-integration-dashboard-secret";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const Followup = require("../src/models/RetentionFollowupEvent");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

let memory;
let dbPath;
async function run() {
  dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "basicdiet-retention-test-"));
  memory = await MongoMemoryServer.create({
    instance: { dbName: "basicdiet_retention_test", dbPath,
      storageEngine: "wiredTiger", args: ["--nounixsocket"] },
  });
  await mongoose.connect(memory.getUri("basicdiet_retention_test"), {
    serverSelectionTimeoutMS: 10000,
  });
  const [superadmin, admin] = await Promise.all([
    DashboardUser.create({ email: "retention-superadmin@example.test", role: "superadmin",
      passwordHash: "test", isActive: true }),
    DashboardUser.create({ email: "retention-admin@example.test", role: "admin",
      passwordHash: "test", isActive: true }),
  ]);
  const customer = await User.create({
    phone: "+966500000502", phoneE164: "+966500000502",
    name: "Test Retention Customer", role: "client", isActive: true,
  });
  await Subscription.create({
    userId: customer._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date(Date.now() - 5 * 86400000),
    endDate: new Date(Date.now() + 20 * 86400000),
    validityEndDate: new Date(Date.now() + 20 * 86400000),
    remainingMeals: 10,
    reservedMeals: 0,
    totalMeals: 15,
    deliveryMode: "pickup",
  });

  const client = request(createApp());
  const auth = (dashboardUser) => ({
    Authorization: "Bearer " + issueDashboardAccessToken(dashboardUser),
    "Accept-Language": "en",
  });
  const url = "/api/dashboard/customer-management/retention";
  let response = await client.get(url);
  assert.equal(response.status, 401, "Anonymous customer data access must be denied");
  response = await client.get(url).set(auth(admin));
  assert.equal(response.status, 403, "Admin (non-superadmin) must be denied");
  response = await client.get(url).set(auth(superadmin));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.body.data.mode, "live_operational_preview");
  assert.equal(response.body.data.totals.all, 1);
  assert.equal(response.body.data.rows[0].userId, String(customer._id));
  assert.equal(response.body.data.rows[0].status, "active");
  assert.equal(typeof response.body.data.rows[0].lastRecordedAt, "string");
  assert.equal(response.body.data.rows[0].lastPurchaseAt, undefined);
  response = await client.get(url).set(auth(superadmin)).query({ pageSize: 999 });
  assert.equal(response.status, 400, "Pagination must be bounded");
  response = await client.get(url).set(auth(superadmin)).query({ status: "unknown" });
  assert.equal(response.status, 400, "Unrecognized status must fail");

  const followupUrl = url + "/" + customer._id + "/followups";
  const payload = { requestId: "retention-integration-0001",
    channel: "phone", outcome: "no_answer", reasonCode: "unknown", note: "" };
  response = await client.post(followupUrl).send(payload);
  assert.equal(response.status, 401);
  response = await client.post(followupUrl).set(auth(admin)).send(payload);
  assert.equal(response.status, 403);
  response = await client.post(followupUrl).set(auth(superadmin)).send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.meta.replayed, false);
  response = await client.post(followupUrl).set(auth(superadmin)).send(payload);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.meta.replayed, true);
  assert.equal(await Followup.countDocuments({ userId: customer._id }), 1,
    "Duplicate requests must never create extra events");
  response = await client.post(followupUrl).set(auth(superadmin))
    .send({ ...payload, outcome: "contacted" });
  assert.equal(response.status, 409, "Idempotency collisions must fail");
  response = await client.get(followupUrl).set(auth(superadmin));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].outcome, "no_answer");
  response = await client.post(followupUrl).set(auth(superadmin))
    .send({ ...payload, requestId: "retention-integration-0002", outcome: "do_not_contact" });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  response = await client.get(followupUrl).set(auth(superadmin));
  assert.equal(response.body.data[0].outcome, "do_not_contact");
  response = await client.get(url).set(auth(superadmin));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.rows[0].doNotContact, true,
    "Superadmin list must expose no-contact requests before outreach");

  console.log("customerRetentionApi.integration.test.js: PASS");
}
run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memory) await memory.stop();
  if (dbPath) fs.rmSync(dbPath, { recursive: true, force: true });
});
