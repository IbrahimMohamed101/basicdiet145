process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-auth-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test-dashboard-secret";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_OTP_ENABLED = "false";
process.env.AUTH_PASSWORD_LOGIN_ENABLED = "true";
process.env.RATE_LIMIT_OTP_MAX = "100";
process.env.RATE_LIMIT_OTP_VERIFY_MAX = "100";
process.env.RATE_LIMIT_MOBILE_LOGIN_MAX = "100";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

const app = createApp();
const api = request(app);

const results = { passed: 0, failed: 0 };
let replSet;
let adminHeaders;

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function dashboardHeaders(role) {
  const user = await DashboardUser.create({
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    role,
    passwordHash: "not-used",
    isActive: true,
  });
  return { Authorization: `Bearer ${issueDashboardAccessToken(user)}`, "Accept-Language": "en" };
}

async function run() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "basicdiet_admin_registration_test" },
  });
  const uri = replSet.getUri("basicdiet_admin_registration_test");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  adminHeaders = await dashboardHeaders("admin");

  const testPhone = "+966500000001";
  
  await test("1. Admin creates user successfully", async () => {
    const res = await api.post("/api/dashboard/users").set(adminHeaders).send({
      phone: testPhone,
    });
    expectStatus(res, 201, "create user");
    
    const user = await User.findOne({ phone: testPhone }).lean();
    assert.strictEqual(user.accountStatus, "pending_activation");
  });

  await test("2. Mobile app login returns PENDING_ACTIVATION", async () => {
    const res = await api.post("/api/auth/login").send({
      phone: testPhone,
      password: "somePassword123"
    });
    expectStatus(res, 403, "login pending");
    assert.strictEqual(res.body.error.code, "PENDING_ACTIVATION");
  });

  await test("3. Mobile app register sets password and activates user", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: testPhone,
      password: "Password123",
      confirmPassword: "Password123"
    });
    expectStatus(res, 201, "register to activate");
    assert.strictEqual(res.body.ok, true);

    const user = await User.findOne({ phone: testPhone }).lean();
    assert.strictEqual(user.accountStatus, "active");
  });

  await test("4. 48 hour timeout blocks login and register", async () => {
    const user = await User.findOne({ phone: testPhone });
    user.accountStatus = "reset_requested";
    user.resetRequestedAt = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50 hours ago
    user.passwordHash = null;
    await user.save();

    const loginRes = await api.post("/api/auth/login").send({
      phone: testPhone,
      password: "Password123"
    });
    expectStatus(loginRes, 403, "login expired");
    assert.strictEqual(loginRes.body.error.code, "RESET_WINDOW_EXPIRED");

    const regRes = await api.post("/api/auth/register").send({
      phone: testPhone,
      password: "Password123",
      confirmPassword: "Password123"
    });
    expectStatus(regRes, 403, "register expired");
    assert.strictEqual(regRes.body.error.code, "RESET_WINDOW_EXPIRED");
  });

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }

  console.log(`adminUserRegistrationAndReset: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
