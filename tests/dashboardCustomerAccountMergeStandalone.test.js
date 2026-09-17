process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "customer-account-merge-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "customer-account-merge-dashboard-secret";

const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const path = require("path");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const AppUser = require("../src/models/AppUser");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const DashboardUser = require("../src/models/DashboardUser");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const RefreshSession = require("../src/models/RefreshSession");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

let mongoServer;
let mongoDbPath;

async function run() {
  mongoDbPath = fs.mkdtempSync(path.join(process.cwd(), "tmp-customer-account-merge-"));
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: "dashboard_customer_account_merge_test",
      dbPath: mongoDbPath,
      storageEngine: "wiredTiger",
      args: ["--nounixsocket"],
    },
  });
  await mongoose.connect(mongoServer.getUri("dashboard_customer_account_merge_test"), {
    serverSelectionTimeoutMS: 10000,
  });

  const dashboardUser = await DashboardUser.create({
    email: "merge-superadmin@example.test",
    role: "superadmin",
    passwordHash: "not-used",
    isActive: true,
  });
  const headers = {
    Authorization: `Bearer ${issueDashboardAccessToken(dashboardUser)}`,
    "Accept-Language": "en",
  };
  const target = await User.create({
    phone: "+966500284700",
    phoneE164: "+966500284700",
    name: "Canonical Customer",
    email: "canonical@example.test",
    passwordHash: "canonical-password-hash",
    authVersion: 7,
    role: "client",
    isActive: true,
  });
  const source = await User.create({
    phone: "+966500584700",
    phoneE164: "+966500584700",
    name: "Duplicate Customer",
    email: "duplicate@example.test",
    passwordHash: "duplicate-password-hash",
    authVersion: 2,
    role: "client",
    isActive: true,
  });
  const sourceAppUser = await AppUser.create({
    coreUserId: source._id,
    phone: source.phone,
    fullName: source.name,
    email: source.email,
    fcmTokens: ["duplicate-device-token"],
  });

  const targetSubscription = await Subscription.create({
    userId: target._id,
    planId: new mongoose.Types.ObjectId(),
    status: "completed",
    totalMeals: 10,
    remainingMeals: 0,
    deliveryMode: "pickup",
  });
  const sourceSubscription = await Subscription.create({
    userId: source._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 60,
    remainingMeals: 60,
    deliveryMode: "delivery",
  });
  await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 10000,
    userId: target._id,
    subscriptionId: targetSubscription._id,
  });
  const sourcePayment = await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 25000,
    userId: source._id,
    subscriptionId: sourceSubscription._id,
  });
  const sourceOrderId = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id: sourceOrderId,
    userId: source._id,
    idempotencyKey: "source-order-key",
    requestHash: "source-order-hash",
    status: "confirmed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await Order.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    userId: target._id,
    idempotencyKey: "target-order-key",
    requestHash: "target-order-hash",
    status: "confirmed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const sourceDraftId = new mongoose.Types.ObjectId();
  await CheckoutDraft.collection.insertOne({
    _id: sourceDraftId,
    userId: source._id,
    idempotencyKey: "source-draft-key",
    requestHash: "source-draft-hash",
    status: "completed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await RefreshSession.create({
    userId: source._id,
    refreshTokenHash: "source-refresh-hash",
    expiresAt: new Date(Date.now() + 86400000),
  });

  const api = request(createApp());
  let response = await api
    .post(`/api/dashboard/customer-management/${source._id}/account-merge/preview`)
    .set(headers)
    .send({ targetPhone: "500284700" });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.canMerge, true);
  assert.strictEqual(response.body.data.sourceCounts.subscriptions, 1);
  assert.strictEqual(response.body.data.targetCounts.subscriptions, 1);
  assert.strictEqual(response.body.data.sourceCounts.orders, 1);
  assert.strictEqual(response.body.data.target.phone, "+966500284700");

  const idempotencyKey = "merge-source-into-canonical-0001";
  response = await api
    .post(`/api/dashboard/customer-management/${source._id}/account-merge`)
    .set(headers)
    .send({
      targetPhone: "+966500284700",
      reason: "Correct duplicate customer identity and preserve all historical data",
      idempotencyKey,
    });
  assert.strictEqual(response.status, 201, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.state, "completed");

  const [updatedTarget, updatedSource, updatedAppUser, session, audit] = await Promise.all([
    User.findById(target._id).select("+passwordHash").lean(),
    User.findById(source._id).select("+passwordHash").lean(),
    AppUser.findById(sourceAppUser._id).lean(),
    RefreshSession.findOne({ userId: source._id }).lean(),
    ActivityLog.findOne({
      entityId: target._id,
      action: "customer_accounts_merged_by_superadmin",
    }).lean(),
  ]);
  assert.strictEqual(updatedTarget.phone, "+966500284700");
  assert.strictEqual(updatedTarget.email, "canonical@example.test");
  assert.strictEqual(updatedTarget.passwordHash, "canonical-password-hash");
  assert.strictEqual(updatedTarget.authVersion, 7);
  assert.strictEqual(updatedSource.isActive, false);
  assert.strictEqual(String(updatedSource.mergedIntoUserId), String(target._id));
  assert.strictEqual(updatedSource.accountMergeState, "completed");
  assert.strictEqual(updatedSource.authVersion, 3);
  assert.strictEqual(String(updatedAppUser.mergedIntoUserId), String(target._id));
  assert.deepStrictEqual(updatedAppUser.fcmTokens, []);
  assert(session.revokedAt);
  assert(audit);
  assert.strictEqual(audit.meta.persistenceMode, "standalone_forward_only_saga");

  assert.strictEqual(await Subscription.countDocuments({ userId: target._id }), 2);
  assert.strictEqual(await Payment.countDocuments({ userId: target._id }), 2);
  assert.strictEqual(await Order.countDocuments({ userId: target._id }), 2);
  assert.strictEqual(await CheckoutDraft.countDocuments({ userId: target._id }), 1);
  assert.strictEqual(String((await Payment.findById(sourcePayment._id).lean()).userId), String(target._id));
  assert.strictEqual(String((await Order.findById(sourceOrderId).lean()).userId), String(target._id));
  assert.strictEqual(String((await CheckoutDraft.findById(sourceDraftId).lean()).userId), String(target._id));

  response = await api
    .post(`/api/dashboard/customer-management/${source._id}/account-merge`)
    .set(headers)
    .send({
      targetPhone: "+966500284700",
      reason: "Correct duplicate customer identity and preserve all historical data",
      idempotencyKey,
    });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.meta.replayed, true);
  assert.strictEqual((await User.findById(source._id).lean()).authVersion, 3);

  const conflictSource = await User.create({
    phone: "+966500999101",
    phoneE164: "+966500999101",
    role: "client",
  });
  const conflictingSubscription = await Subscription.create({
    userId: conflictSource._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 5,
    remainingMeals: 5,
    deliveryMode: "pickup",
  });
  response = await api
    .post(`/api/dashboard/customer-management/${conflictSource._id}/account-merge/preview`)
    .set(headers)
    .send({ targetPhone: "+966500284700" });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.canMerge, false);
  assert(response.body.data.conflicts.some((row) => row.code === "MULTIPLE_ACTIVE_SUBSCRIPTIONS"));

  response = await api
    .post(`/api/dashboard/customer-management/${conflictSource._id}/account-merge`)
    .set(headers)
    .send({
      targetPhone: "+966500284700",
      reason: "Merge duplicate while preserving the canonical active subscription",
      idempotencyKey: "merge-active-conflict-keep-target-0001",
      activeSubscriptionResolution: "keep_target",
    });
  assert.strictEqual(response.status, 201, JSON.stringify(response.body));
  const frozenTransferredSubscription = await Subscription.findOne({
    _id: conflictingSubscription._id,
    userId: target._id,
    status: "frozen",
  }).lean();
  assert(frozenTransferredSubscription);
  assert.strictEqual(await Subscription.countDocuments({ userId: target._id, status: "active" }), 1);

  console.log("dashboardCustomerAccountMergeStandalone: all tests passed");
}

run()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    if (mongoDbPath) fs.rmSync(mongoDbPath, { recursive: true, force: true });
  });
