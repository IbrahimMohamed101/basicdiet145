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
const Otp = require("../src/models/Otp");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const { compareAppPassword } = require("../src/services/appPasswordService");
const { hashDashboardPassword } = require("../src/services/dashboardPasswordService");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");

const app = createApp();
const api = request(app);
const TEST_PHONE = "+966501234567";
const DUPLICATE_PHONE = "+966501234568";
const PASSWORD = "Password123";
const TEMP_PASSWORD = "Temporary123";
const NEW_PASSWORD = "NewPassword123";
const results = { passed: 0, failed: 0 };

let replSet;
let customerId;
let accessToken;
let adminHeaders;
let superadminHeaders;
let cashierHeaders;

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

function expectNoPasswordHash(value, label) {
  assert(!JSON.stringify(value || {}).includes("passwordHash"), `${label}: passwordHash leaked`);
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function startMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "basicdiet_password_auth_test" },
  });
  const uri = replSet.getUri("basicdiet_password_auth_test");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function stopMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

async function dashboardHeaders(role) {
  const user = await DashboardUser.create({
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    role,
    passwordHash: "not-used",
    isActive: true,
  });
  return authHeader(issueDashboardAccessToken(user));
}

async function seedDashboardUsers() {
  adminHeaders = await dashboardHeaders("admin");
  superadminHeaders = await dashboardHeaders("superadmin");
  cashierHeaders = await dashboardHeaders("cashier");
}

async function run() {
  await startMongo();
  await seedDashboardUsers();

  await test("1. Password register succeeds with phone, password and confirmPassword", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: TEST_PHONE,
      email: "optional@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 201, "register");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "registered");
    assert(res.body.accessToken, "access token returned");
    assert(res.body.refreshToken, "refresh token returned");
    assert.strictEqual(res.body.user.phoneE164, TEST_PHONE);
    assert.strictEqual(res.body.user.email, "optional@example.com");
    assert.strictEqual(res.body.user.forcePasswordChange, false);
    expectNoPasswordHash(res.body, "register response");
    accessToken = res.body.accessToken;
    customerId = res.body.user.id;
    const user = await User.findById(customerId).lean();
    assert(user.passwordHash, "password hash stored");
    assert.notStrictEqual(user.passwordHash, PASSWORD);
    assert.strictEqual(user.phoneVerified, true);
  });

  await test("2. Email is optional during register", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: DUPLICATE_PHONE,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 201, "register without email");
    assert.strictEqual(res.body.user.email, null);
  });

  await test("3. Register rejects missing phone", async () => {
    const res = await api.post("/api/auth/register").send({ password: PASSWORD, confirmPassword: PASSWORD });
    expectStatus(res, 400, "missing phone");
    assert.strictEqual(res.body.ok, false);
  });

  await test("4. Register rejects password/confirm mismatch", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: "+966501234569",
      password: PASSWORD,
      confirmPassword: "Password124",
    });
    expectStatus(res, 400, "password mismatch");
  });

  await test("5. Register rejects duplicate phone", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: TEST_PHONE,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 409, "duplicate phone");
  });

  await test("6. Login succeeds with phone and password", async () => {
    const res = await api.post("/api/auth/login").send({ phone: TEST_PHONE, password: PASSWORD });
    expectStatus(res, 200, "login");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "logged_in");
    assert(res.body.accessToken);
    expectNoPasswordHash(res.body, "login response");
  });

  await test("7. Wrong password returns generic error", async () => {
    const res = await api.post("/api/auth/login").send({ phone: TEST_PHONE, password: "WrongPassword123" });
    expectStatus(res, 401, "wrong password");
    assert.strictEqual(res.body.error.code, "INVALID_CREDENTIALS");
    assert.strictEqual(res.body.error.message, "Invalid phone or password");
  });

  await test("8. Unknown phone returns same generic error", async () => {
    const res = await api.post("/api/auth/login").send({ phone: "+966501234570", password: "WrongPassword123" });
    expectStatus(res, 401, "unknown phone");
    assert.strictEqual(res.body.error.code, "INVALID_CREDENTIALS");
    assert.strictEqual(res.body.error.message, "Invalid phone or password");
  });

  await test("9. OTP send endpoint is disabled and creates no OTP", async () => {
    const res = await api.post("/api/auth/otp/request").send({ phoneE164: TEST_PHONE });
    expectStatus(res, 403, "otp request disabled");
    assert.strictEqual(res.body.status, false);
    assert.strictEqual(await Otp.countDocuments({}), 0);
  });

  await test("10. OTP verify endpoint is disabled", async () => {
    const res = await api.post("/api/auth/otp/verify").send({ phoneE164: TEST_PHONE, otp: "123456" });
    expectStatus(res, 403, "otp verify disabled");
    assert.strictEqual(res.body.status, false);
  });

  await test("11. Existing OTP code remains configurable", async () => {
    const otpService = require("../src/services/otpService");
    assert.strictEqual(typeof otpService.requestOtpForPhone, "function");
    assert.strictEqual(typeof otpService.verifyOtpCode, "function");
    assert.strictEqual(otpService.isOtpAuthEnabled(), false);
  });

  await test("12. Admin can reset customer password", async () => {
    const res = await api.post(`/api/dashboard/users/${customerId}/reset-password`).set(adminHeaders).send({
      reason: "Customer forgot password",
    });
    expectStatus(res, 200, "admin reset");
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(res.body.data.userId, customerId);
    assert.strictEqual(res.body.data.accountStatus, "reset_requested");
  });

  await test("13. Superadmin can reset customer password", async () => {
    const res = await api.post(`/api/dashboard/users/${customerId}/reset-password`).set(superadminHeaders).send({});
    expectStatus(res, 200, "superadmin reset");
    assert.strictEqual(res.body.status, true);
  });

  await test("14. Cashier cannot reset customer password", async () => {
    const res = await api.post(`/api/dashboard/users/${customerId}/reset-password`).set(cashierHeaders).send({});
    expectStatus(res, 403, "cashier reset");
    assert.strictEqual(res.body.status, false);
  });

  await test("15. Reset requires an existing customer", async () => {
    const missingId = new mongoose.Types.ObjectId();
    const res = await api.post(`/api/dashboard/users/${missingId}/reset-password`).set(adminHeaders).send({});
    expectStatus(res, 404, "missing reset user");
    assert.strictEqual(res.body.status, false);
  });

  await test("16. Reset clears hashed password and logs ActivityLog", async () => {
    const user = await User.findById(customerId).lean();
    assert.strictEqual(user.passwordHash, null);
    assert.strictEqual(user.accountStatus, "reset_requested");
    const log = await ActivityLog.findOne({
      entityType: "user",
      entityId: customerId,
      action: "admin_requested_password_reset",
    }).lean();
    assert(log, "reset activity log exists");
  });

  await test("17. Customer login returns RESET_REQUESTED", async () => {
    const res = await api.post("/api/auth/login").send({ phone: TEST_PHONE, password: TEMP_PASSWORD });
    expectStatus(res, 403, "temporary login");
    assert.strictEqual(res.body.error.code, "RESET_REQUESTED");
  });

  await test("18. Customer can use register endpoint to set new password", async () => {
    const res = await api.post("/api/auth/register").send({
      phone: TEST_PHONE,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expectStatus(res, 201, "register to reset password");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "registered");
    accessToken = res.body.accessToken;
  });

  await test("19. Register endpoint sets accountStatus to active and sets password", async () => {
    const user = await User.findById(customerId).lean();
    assert.strictEqual(user.accountStatus, "active");
    assert.strictEqual(await compareAppPassword(NEW_PASSWORD, user.passwordHash), true);

    const newLogin = await api.post("/api/auth/login").send({ phone: TEST_PHONE, password: NEW_PASSWORD });
    expectStatus(newLogin, 200, "new password login");
  });

  await test("20. Existing dashboard admin auth still works", async () => {
    const password = "AdminPassword123!";
    const dashboardUser = await DashboardUser.create({
      email: "dashboard-auth-password-test@example.com",
      role: "admin",
      passwordHash: await hashDashboardPassword(password),
      isActive: true,
    });
    const res = await api.post("/api/dashboard/auth/login").send({ email: dashboardUser.email, password });
    expectStatus(res, 200, "dashboard login");
    assert.strictEqual(res.body.status, true);
    assert(res.body.token);
    expectNoPasswordHash(res.body, "dashboard login response");
  });

  await test("21. Cashier cash subscription permission route is not blocked by auth changes", async () => {
    const res = await api.post("/api/dashboard/subscriptions/quote").set(cashierHeaders).send({});
    assert.notStrictEqual(res.status, 401, `cashier quote unexpectedly unauthorized: ${JSON.stringify(res.body)}`);
    assert.notStrictEqual(res.status, 403, `cashier quote unexpectedly forbidden: ${JSON.stringify(res.body)}`);
  });

  await stopMongo();
  console.log(`authPasswordBackendContract: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await stopMongo();
  process.exitCode = 1;
});
