process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "customer-management-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-customer-management-test-secret";

const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
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

let replSet;
let mongoDbPath;

async function dashboardHeaders(role) {
  const dashboardUser = await DashboardUser.create({
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    role,
    passwordHash: "not-used",
    isActive: true,
  });
  return {
    headers: {
      Authorization: `Bearer ${issueDashboardAccessToken(dashboardUser)}`,
      "Accept-Language": "en",
    },
    dashboardUser,
  };
}

async function run() {
  mongoDbPath = fs.mkdtempSync(path.join(process.cwd(), "tmp-customer-management-mongo-"));
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "dashboard_customer_management_test" },
    instanceOpts: [{
      dbPath: mongoDbPath,
      storageEngine: "wiredTiger",
      args: ["--nounixsocket"],
    }],
  });
  const uri = replSet.getUri("dashboard_customer_management_test");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const app = createApp();
  const api = request(app);
  const superadmin = await dashboardHeaders("superadmin");
  const admin = await dashboardHeaders("admin");

  const customer = await User.create({
    phone: "+966500000101",
    phoneE164: "+966500000101",
    phoneVerified: true,
    name: "Original Customer",
    email: "original@example.test",
    emailVerified: true,
    emailVerifiedAt: new Date(),
    role: "client",
    authVersion: 2,
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
    totalMeals: 14,
    remainingMeals: 14,
    deliveryMode: "delivery",
    deliveryAddress: {
      line1: "Old address",
      city: "Riyadh",
      lat: 24.7136,
      lng: 46.6753,
    },
  });
  await RefreshSession.create({
    userId: customer._id,
    refreshTokenHash: "customer-management-refresh-hash",
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
    challengeId: "customer-management-email-challenge",
    lookupKey: "verify_existing_email:original@example.test",
    purpose: "verify_existing_email",
    email: customer.email,
    userId: customer._id,
    codeHash: "hash",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    cleanupAt: new Date(Date.now() + 10 * 60 * 1000),
    attemptsLeft: 5,
    lastSentAt: new Date(),
  });

  let response = await api
    .get(`/api/dashboard/customer-management/${customer._id}`)
    .set(admin.headers);
  assert.strictEqual(response.status, 403, JSON.stringify(response.body));

  response = await api
    .get(`/api/dashboard/customer-management/${customer._id}`)
    .set(superadmin.headers);
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.data.phoneE164, "+966500000101");
  assert.strictEqual(response.body.data.activeSubscription.id, String(subscription._id));
  assert.strictEqual(response.body.data.activeSubscription.deliveryAddress.line1, "Old address");
  assert.strictEqual(response.body.data.activeSubscription.balances.totalMeals, 14);
  assert.strictEqual(response.body.data.activeSubscription.balances.remainingRegularMeals, 14);
  assert.deepStrictEqual(response.body.data.activeSubscription.compensationHistory, []);

  response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(admin.headers)
    .send({ fullName: "Forbidden Change", reason: "Admin must not edit" });
  assert.strictEqual(response.status, 403, JSON.stringify(response.body));

  response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(superadmin.headers)
    .send({
      fullName: "Updated Customer",
      phone: "0500000102",
      email: "updated@example.test",
      isActive: false,
      deliveryAddress: {
        line1: "New address",
        city: "Riyadh",
        district: "Al Olaya",
      },
      reason: "Customer requested identity and delivery address correction",
    });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.deepStrictEqual(
    response.body.meta.changedFields.sort(),
    ["deliveryAddress", "email", "fullName", "isActive", "phone"].sort()
  );
  assert.strictEqual(response.body.meta.sessionsRevoked, true);

  const [updatedUser, updatedAppUser, updatedSubscription, auditLog, refreshSession, oldOtp, emailChallenge] = await Promise.all([
    User.findById(customer._id).lean(),
    AppUser.findById(appUser._id).lean(),
    Subscription.findById(subscription._id).lean(),
    ActivityLog.findOne({
      entityType: "user",
      entityId: customer._id,
      action: "customer_profile_updated_by_superadmin",
    }).lean(),
    RefreshSession.findOne({ userId: customer._id }).lean(),
    Otp.findOne({ phone: "+966500000101" }).lean(),
    EmailOtpChallenge.findOne({ userId: customer._id }).lean(),
  ]);

  assert.strictEqual(updatedUser.name, "Updated Customer");
  assert.strictEqual(updatedUser.phone, "+966500000102");
  assert.strictEqual(updatedUser.phoneE164, "+966500000102");
  assert.strictEqual(updatedUser.email, "updated@example.test");
  assert.strictEqual(updatedUser.emailVerified, false);
  assert.strictEqual(updatedUser.emailVerifiedAt, null);
  assert.strictEqual(updatedUser.emailVerificationRequired, true);
  assert.strictEqual(updatedUser.isActive, false);
  assert.strictEqual(updatedUser.authVersion, 3);
  assert.strictEqual(updatedAppUser.fullName, updatedUser.name);
  assert.strictEqual(updatedAppUser.phone, updatedUser.phone);
  assert.strictEqual(updatedAppUser.email, updatedUser.email);
  assert.strictEqual(updatedSubscription.deliveryAddress.line1, "New address");
  assert.strictEqual(updatedSubscription.deliveryAddress.district, "Al Olaya");
  assert.strictEqual(updatedSubscription.deliveryAddress.lat, 24.7136, "existing coordinates must be preserved");
  assert(auditLog, "profile update must create an audit log");
  assert.strictEqual(auditLog.byRole, "superadmin");
  assert.strictEqual(auditLog.meta.before.phone, "+966500000101");
  assert.strictEqual(auditLog.meta.after.phone, "+966500000102");
  assert(refreshSession.revokedAt, "identity change must revoke refresh sessions");
  assert.strictEqual(refreshSession.revokedReason, "security");
  assert.strictEqual(oldOtp, null, "old phone OTP must be invalidated");
  assert.strictEqual(emailChallenge, null, "pending email OTP challenges must be invalidated");

  response = await api
    .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
    .set(admin.headers)
    .send({
      quantity: 5,
      reason: "Forbidden admin compensation",
      idempotencyKey: "admin-forbidden-compensation",
    });
  assert.strictEqual(response.status, 403, JSON.stringify(response.body));

  const compensationPayload = {
    quantity: 5,
    reason: "Service recovery compensation approved by the customer care manager",
    idempotencyKey: "customer-compensation-0001",
  };
  response = await api
    .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
    .set(superadmin.headers)
    .send(compensationPayload);
  assert.strictEqual(response.status, 201, JSON.stringify(response.body));
  assert.strictEqual(response.body.meta.replayed, false);
  assert.strictEqual(response.body.meta.compensation.quantity, 5);
  assert.strictEqual(response.body.data.activeSubscription.balances.totalMeals, 19);
  assert.strictEqual(response.body.data.activeSubscription.balances.remainingMeals, 19);
  assert.strictEqual(response.body.data.activeSubscription.balances.compensatedMealsTotal, 5);
  assert.strictEqual(response.body.data.activeSubscription.compensationHistory.length, 1);

  response = await api
    .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
    .set(superadmin.headers)
    .send(compensationPayload);
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  assert.strictEqual(response.body.meta.replayed, true);

  const [compensatedSubscription, compensationLogs] = await Promise.all([
    Subscription.findById(subscription._id).lean(),
    ActivityLog.find({
      entityType: "subscription",
      entityId: subscription._id,
      action: "subscription_meal_compensation_granted_by_superadmin",
    }).lean(),
  ]);
  assert.strictEqual(compensatedSubscription.totalMeals, 19, "idempotent replay must not double-add total meals");
  assert.strictEqual(compensatedSubscription.remainingMeals, 19, "idempotent replay must not double-add remaining meals");
  assert.strictEqual(compensatedSubscription.compensatedMealsTotal, 5);
  assert.strictEqual(compensatedSubscription.adminMealCompensations.length, 1);
  assert.strictEqual(compensationLogs.length, 1, "exactly one activity log must be written");
  assert.strictEqual(compensationLogs[0].meta.before.remainingMeals, 14);
  assert.strictEqual(compensationLogs[0].meta.after.remainingMeals, 19);

  const concurrentPayload = {
    quantity: 2,
    reason: "Concurrent compensation request must be applied exactly once",
    idempotencyKey: "customer-compensation-concurrent-0002",
  };
  const concurrentResponses = await Promise.all([
    api
      .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
      .set(superadmin.headers)
      .send(concurrentPayload),
    api
      .post(`/api/dashboard/customer-management/${customer._id}/meal-compensations`)
      .set(superadmin.headers)
      .send(concurrentPayload),
  ]);
  assert.deepStrictEqual(
    concurrentResponses.map((row) => row.status).sort(),
    [200, 201],
    concurrentResponses.map((row) => JSON.stringify(row.body)).join("\n")
  );
  const afterConcurrentCompensation = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(afterConcurrentCompensation.totalMeals, 21);
  assert.strictEqual(afterConcurrentCompensation.remainingMeals, 21);
  assert.strictEqual(afterConcurrentCompensation.compensatedMealsTotal, 7);
  assert.strictEqual(afterConcurrentCompensation.adminMealCompensations.length, 2);

  const conflicting = await User.create({
    phone: "+966500000103",
    phoneE164: "+966500000103",
    email: "conflict@example.test",
    role: "client",
  });
  response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(superadmin.headers)
    .send({
      phone: conflicting.phone,
      reason: "This conflict must be rejected atomically",
    });
  assert.strictEqual(response.status, 409, JSON.stringify(response.body));
  const unchangedAfterConflict = await User.findById(customer._id).lean();
  assert.strictEqual(unchangedAfterConflict.phone, "+966500000102");

  response = await api
    .patch(`/api/dashboard/customer-management/${customer._id}`)
    .set(superadmin.headers)
    .send({ remainingMeals: 999, reason: "Unsupported accounting change" });
  assert.strictEqual(response.status, 400, JSON.stringify(response.body));

  console.log("dashboardCustomerManagement: all tests passed");
}

run()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (replSet) await replSet.stop();
    if (mongoDbPath) fs.rmSync(mongoDbPath, { recursive: true, force: true });
  });
