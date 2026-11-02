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
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const Payment = require("../src/models/Payment");
const Merge = require("../src/models/CustomerAccountMerge");
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
    totalMeals: 15, totalPriceHalala: 10000,
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

  response = await client.post(followupUrl).set(auth(superadmin))
    .send({ ...payload, requestId: "retention-integration-blocked", outcome: "contacted" });
  assert.equal(response.status, 409, "Opt-out must be enforced server-side");
  assert.equal(response.body.error.code, "CUSTOMER_DO_NOT_CONTACT");
  response = await client.post(followupUrl).set(auth(superadmin)).send(payload);
  assert.equal(response.status, 200, "Replaying a pre-opt-out write remains a read of the original event");
  assert.equal(response.body.meta.replayed, true);
  response = await client.get(url).set(auth(superadmin)).query({ contactableOnly: true });
  assert.equal(response.body.data.rows.length, 0, "Suppressed customers cannot appear in contactable lists");
  response = await client.get(url).set(auth(superadmin)).query({ contactableOnly: "invalid" });
  assert.equal(response.status, 400);
  for (const role of ["restaurant", "kitchen", "courier", "cashier"]) {
    const user = await DashboardUser.create({ email: "retention-" + role + "@example.test", role,
      passwordHash: "test", isActive: true });
    for (const route of [url, followupUrl]) {
      response = await client.get(route).set(auth(user));
      assert.equal(response.status, 403, role + " must not read customer retention");
      assert.equal(response.body.data, undefined);
    }
    response = await client.post(followupUrl).set(auth(user)).send(payload);
    assert.equal(response.status, 403);
  }
  response = await client.get(followupUrl);
  assert.equal(response.status, 401);
  // Parallel retries exercise the _id uniqueness race against a real MongoDB.
  const second = await User.create({ name: "Synthetic Parallel Customer", role: "client", phone: "+966500000503" });
  const secondUrl = url + "/" + second._id + "/followups";
  const parallelPayload = { ...payload, requestId: "retention-parallel-0001", outcome: "not_interested", reasonCode: "price", note: "Synthetic customer stated price" };
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => client.post(secondUrl).set(auth(superadmin)).send(parallelPayload)));
  assert.equal(concurrent.filter((r) => r.status === 201).length, 1);
  assert.equal(concurrent.filter((r) => r.status === 200).length, 7);
  assert.equal(await Followup.countDocuments({ userId: second._id }), 1);
  // Old source opt-out remains effective after merge and beyond the 30-row UI history.
  await Followup.create({ _id: "retention-source-optout", userId: second._id, actorId: superadmin._id,
    channel: "phone", outcome: "do_not_contact", createdAt: new Date("2026-01-01") });
  await Followup.insertMany(Array.from({ length: 31 }, (_, i) => ({
    _id: "retention-source-history-" + String(i).padStart(3, "0"), userId: second._id,
    actorId: superadmin._id, channel: "phone", outcome: "no_answer", createdAt: new Date(Date.now() + i),
  })));
  const target = await User.create({ name: "Synthetic Merge Target", role: "client", phone: "+966500000504" });
  await User.updateOne({ _id: second._id }, { $set: { mergedIntoUserId: target._id } });
  await Merge.collection.insertOne({ sourceUserId: second._id, targetUserId: target._id, state: "completed" });
  const targetUrl = url + "/" + target._id + "/followups";
  response = await client.get(targetUrl).set(auth(superadmin));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 30);
  assert.equal(response.body.data.some((e) => e.outcome === "do_not_contact"), false,
    "Opt-out is deliberately outside the last 30 events; server policy must still find it");
  response = await client.post(targetUrl).set(auth(superadmin)).send({ ...payload, requestId: "retention-merge-blocked" });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "CUSTOMER_DO_NOT_CONTACT");
  response = await client.post(secondUrl).set(auth(superadmin)).send(parallelPayload);
  assert.equal(response.status, 409, "Merged source cannot accept new follow-ups");
  // Real database payment evidence and pagination/search/filter contracts.
  const s = await Subscription.create({ userId: target._id, planId: new mongoose.Types.ObjectId(), status: "active",
    startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 30 * 86400000),
    remainingMeals: 10, reservedMeals: 2, totalMeals: 20, deliveryMode: "pickup", totalPriceHalala: 10000 });
  const payment = await Payment.create({ userId: target._id, subscriptionId: s._id, provider: "manual",
    type: "subscription_activation", amount: 10000, status: "paid" });
  await Batch.collection.insertOne({ userId: target._id, containerSubscriptionId: s._id,
    sourceType: "checkout", paymentId: payment._id, applicationState: "applied", status: "active",
    createdAt: new Date(), effectiveStartDate: s.startDate, validityEndDate: s.endDate,
    remainingMeals: 5, reservedMeals: 2 });
  response = await client.get(url).set(auth(superadmin)).query({ search: "Synthetic Merge", status: "active", pageSize: 1 });
  assert.equal(response.body.data.rows.length, 1);
  assert.equal(response.body.data.rows[0].remainingAndReserved, 7, "Parent and batch cannot double-count");
  assert.equal(response.body.data.rows[0].subscriptionRecordCount, 1);
  assert.equal(response.body.data.rows[0].doNotContact, true);
  const total = response.body.data.totals.all;
  response = await client.get(url).set(auth(superadmin)).query({ page: 2, pageSize: 1 });
  assert.equal(response.body.data.pagination.total, total);
  assert.equal(response.body.data.rows.length, 1);
  await Payment.updateOne({ _id: payment._id }, { $set: { status: "canceled" } });
  response = await client.get(url).set(auth(superadmin)).query({ search: "Synthetic Merge" });
  assert.equal(response.body.data.rows[0].status, "review", "Canceled payment cannot establish live paid eligibility");
  // Fresh role/deactivation checks must override stale token claims.
  const staleToken = auth(superadmin);
  await DashboardUser.updateOne({ _id: superadmin._id }, { $set: { role: "admin" } });
  response = await client.get(url).set(staleToken);
  assert.equal(response.status, 403);
  await DashboardUser.updateOne({ _id: superadmin._id }, { $set: { role: "superadmin", isActive: false } });
  response = await client.get(url).set(staleToken);
  assert.equal(response.status, 403);
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
