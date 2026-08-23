process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "customer-management-standalone-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-customer-management-standalone-secret";

const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const path = require("path");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const EmailOtpChallenge = require("../src/models/EmailOtpChallenge");
const Otp = require("../src/models/Otp");
const RefreshSession = require("../src/models/RefreshSession");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

let mongoServer;
let mongoDbPath;

async function run() {
  mongoDbPath = fs.mkdtempSync(path.join(process.cwd(), "tmp-customer-management-standalone-"));
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: "dashboard_customer_management_standalone_test",
      dbPath: mongoDbPath,
      storageEngine: "wiredTiger",
      args: ["--nounixsocket"],
    },
  });
  await mongoose.connect(mongoServer.getUri("dashboard_customer_management_standalone_test"), {
    serverSelectionTimeoutMS: 10000,
  });

  const dashboardUser = await DashboardUser.create({
    email: "standalone-superadmin@example.test",
    role: "superadmin",
    passwordHash: "not-used",
    isActive: true,
  });
  const headers = {
    Authorization: `Bearer ${issueDashboardAccessToken(dashboardUser)}`,
    "Accept-Language": "en",
  };
  const customer = await User.create({
    phone: "+966500000201",
    phoneE164: "+966500000201",
    phoneVerified: true,
    name: "Standalone Customer",
    email: "standalone-old@example.test",
    emailVerified: true,
    emailVerifiedAt: new Date(),
    role: "client",
    authVersion: 4,
    isActive: true,
  });
  const appUser = await AppUser.create({
    coreUserId: customer._id,
    phone: customer.phone,
    fullName: customer.name,
    email: customer.email,
  });
  const subscription = await Subscription.create({
    userId: customer._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    totalMeals: 12,
    remainingMeals: 9,
    deliveryMode: "delivery",
    deliveryAddress: { line1: "Standalone old address", city: "Riyadh" },
  });
  await RefreshSession.create({
    userId: customer._id,
    refreshTokenHash: "standalone-refresh-session-hash",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await Otp.create({
    phone: customer.phone,
    codeHash: "hash",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    attemptsLeft: 5,
    lastSentAt: new Date(),
  });
  await EmailOtpChallenge.create({
    challengeId: "standalone-email-challenge",
    lookupKey: "verify_existing_email:standalone-old@example.test",
    purpose: "verify_existing_email",
    email: customer.email,
    userId: customer._id,
    codeHash: "hash",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    cleanupAt: new Date(Date.now() + 10 * 60 * 1000),
    attemptsLeft: 5,
    lastSentAt: new Date(),
  });

  const api = request(createApp());
  let response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(headers)
    .send({
      fullName: "Standalone Updated Customer",
      phone: "+966500000202",
      email: "standalone-new@example.test",
      isActive: false,
      deliveryAddress: { line1: "Standalone new address", city: "Riyadh" },
      reason: "Production standalone MongoDB customer correction",
    });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.fullName, "Standalone Updated Customer");
  assert.strictEqual(response.body.data.phoneE164, "+966500000202");
  assert.strictEqual(response.body.data.activeSubscription.deliveryAddress.line1, "Standalone new address");
  assert.strictEqual(response.body.meta.sessionsRevoked, true);

  const [updatedUser, updatedAppUser, updatedSubscription, refreshSession, oldOtp, emailChallenge, audit] = await Promise.all([
    User.findById(customer._id).lean(),
    AppUser.findById(appUser._id).lean(),
    Subscription.findById(subscription._id).lean(),
    RefreshSession.findOne({ userId: customer._id }).lean(),
    Otp.findOne({ phone: "+966500000201" }).lean(),
    EmailOtpChallenge.findOne({ userId: customer._id }).lean(),
    ActivityLog.findOne({
      entityType: "user",
      entityId: customer._id,
      action: "customer_profile_updated_by_superadmin",
    }).lean(),
  ]);
  assert.strictEqual(updatedUser.name, "Standalone Updated Customer");
  assert.strictEqual(updatedUser.phone, "+966500000202");
  assert.strictEqual(updatedUser.email, "standalone-new@example.test");
  assert.strictEqual(updatedUser.emailVerified, false);
  assert.strictEqual(updatedUser.emailVerificationRequired, true);
  assert.strictEqual(updatedUser.authVersion, 5);
  assert.strictEqual(updatedAppUser.fullName, updatedUser.name);
  assert.strictEqual(updatedAppUser.phone, updatedUser.phone);
  assert.strictEqual(updatedAppUser.email, updatedUser.email);
  assert.strictEqual(updatedSubscription.deliveryAddress.line1, "Standalone new address");
  assert(refreshSession.revokedAt);
  assert.strictEqual(oldOtp, null);
  assert.strictEqual(emailChallenge, null);
  assert(audit);
  assert.strictEqual(audit.meta.persistenceMode, "standalone_compare_and_set");

  const conflicting = await User.create({
    phone: "+966500000203",
    phoneE164: "+966500000203",
    email: "standalone-conflict@example.test",
    role: "client",
  });
  response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(headers)
    .send({ phone: conflicting.phone, reason: "Conflict must remain atomic" });
  assert.strictEqual(response.status, 409, JSON.stringify(response.body));
  assert.strictEqual((await User.findById(customer._id).lean()).phone, "+966500000202");

  response = await api
    .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
    .set(headers)
    .send({
      quantity: 3,
      reason: "Standalone customer compensation",
      idempotencyKey: "standalone-compensation-0001",
    });
  assert.strictEqual(response.status, 201, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.activeSubscription.balances.remainingMeals, 12);

  console.log("dashboardCustomerManagementStandalone: all tests passed");
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
