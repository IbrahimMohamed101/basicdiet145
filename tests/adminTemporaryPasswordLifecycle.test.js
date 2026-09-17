process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-auth-secret";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test-dashboard-secret";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.BCRYPT_ROUNDS = "4";
process.env.OTP_TEST_MODE = "true";
process.env.ALLOW_TEST_AUTH = "true";
process.env.OTP_TEST_CODE = "123456";
process.env.RATE_LIMIT_MOBILE_LOGIN_MAX = "200";
process.env.RATE_LIMIT_ADMIN_PASSWORD_RESET_MAX = "200";
process.env.RATE_LIMIT_OTP_MAX = "200";
process.env.RATE_LIMIT_OTP_VERIFY_MAX = "200";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const RefreshSession = require("../src/models/RefreshSession");
const ActivityLog = require("../src/models/ActivityLog");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");
const { hashDashboardPassword } = require("../src/services/dashboardPasswordService");
const { compareAppPassword } = require("../src/services/appPasswordService");
const { hashRefreshToken } = require("../src/services/refreshSessionService");

const app = createApp();
const api = request(app);
const TEST_OTP = process.env.OTP_TEST_CODE;

let replSet;
const results = { passed: 0, failed: 0 };

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

function expectErrorCode(res, code, label) {
  assert.strictEqual(res.body && res.body.ok, false, `${label}: ok false`);
  assert.strictEqual(res.body && res.body.error && res.body.error.code, code, `${label}: expected ${code}, got ${JSON.stringify(res.body)}`);
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function startMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "basicdiet_admin_temp_password_test" },
  });
  const uri = replSet.getUri("basicdiet_admin_temp_password_test");
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

async function createDashboardToken(role, email) {
  const user = await DashboardUser.create({
    email,
    passwordHash: await hashDashboardPassword("DashboardPassword123!"),
    role,
    isActive: true,
  });
  return issueDashboardAccessToken(user);
}

function assertNoSecretLeak(value, secrets) {
  const json = JSON.stringify(value);
  for (const secret of secrets) {
    assert(!json.includes(secret), `response/log leaked secret ${secret}`);
  }
  assert(!json.includes("passwordHash"), "payload leaked passwordHash");
}

async function run() {
  await startMongo();

  const adminToken = await createDashboardToken("admin", "admin@example.com");
  const cashierToken = await createDashboardToken("cashier", "cashier@example.com");
  const phone = "+201110030001";
  const email = "admin.created@example.com";
  let userId;
  let appUserId;
  let temporaryPassword;
  let passwordChangeToken;
  let accessToken;
  let refreshToken;
  let oldAccessToken;
  let oldRefreshToken;
  let resetTemporaryPassword;
  let resetPasswordChangeToken;

  await test("admin creates brand-new customer and linked AppUser", async () => {
    const res = await api
      .post("/api/admin/users")
      .set(authHeader(adminToken))
      .send({ fullName: "Admin Created", phoneE164: phone, email, isActive: true });
    expectStatus(res, 201, "admin create");
    assert.strictEqual(res.body.status, true);
    assert(res.body.data.user, "nested user returned");
    assert(res.body.data.temporaryCredentials, "temporary credentials returned");
    temporaryPassword = res.body.data.temporaryCredentials.temporaryPassword;
    userId = res.body.data.user.id;
    appUserId = res.body.data.user.appUserId;
    assert(temporaryPassword && temporaryPassword.length >= 8, "temporary password returned once");
    assert.strictEqual(res.body.data.user.forcePasswordChange, true);
    assert.strictEqual(res.body.data.user.authState, "temporary_password");
    assert.strictEqual(res.body.data.user.email, email);
    assert.strictEqual(res.body.data.user.emailVerified, false);
    assert.strictEqual(res.body.data.user.emailVerifiedAt, null);
    assert.strictEqual(res.body.data.user.emailVerificationRequired, true);
    assert(res.body.data.user.temporaryPasswordExpiresAt, "expiry returned");

    const user = await User.findById(userId).lean();
    const appUser = await AppUser.findById(appUserId).lean();
    assert(user, "User persisted");
    assert(appUser, "AppUser persisted");
    assert.strictEqual(String(appUser.coreUserId), String(user._id));
    assert.strictEqual(user.phoneVerified, true);
    assert.strictEqual(user.role, "client");
    assert.strictEqual(user.authProvider, "password");
    assert(user.authMethods.includes("password"));
    assert.strictEqual(user.forcePasswordChange, true);
    assert.strictEqual(user.temporaryPasswordReason, "admin_created");
    assert.strictEqual(user.passwordSetAt, null);
    assert.strictEqual(user.email, email);
    assert.strictEqual(user.emailVerified, false);
    assert.strictEqual(user.emailVerifiedAt, null);
    assert.strictEqual(user.emailVerificationRequired, true);
  });

  await test("admin-created customer without email is still marked for customer-owned verification", async () => {
    const noEmailPhone = "+201110030003";
    const res = await api
      .post("/api/admin/users")
      .set(authHeader(adminToken))
      .send({ fullName: "Admin Created Without Email", phoneE164: noEmailPhone, isActive: true });
    expectStatus(res, 201, "admin create without email");
    assert.strictEqual(res.body.data.user.email, null);
    assert.strictEqual(res.body.data.user.emailVerified, false);
    assert.strictEqual(res.body.data.user.emailVerifiedAt, null);
    assert.strictEqual(res.body.data.user.emailVerificationRequired, true);

    const user = await User.findOne({ phoneE164: noEmailPhone }).lean();
    assert(user, "customer without email persisted");
    assert.strictEqual(user.email, undefined);
    assert.strictEqual(user.emailVerified, false);
    assert.strictEqual(user.emailVerifiedAt, null);
    assert.strictEqual(user.emailVerificationRequired, true);
  });

  await test("database stores only temporary password hash", async () => {
    const user = await User.findById(userId).select("+passwordHash");
    assert(user.passwordHash, "password hash stored");
    assert.notStrictEqual(user.passwordHash, temporaryPassword);
    assert.strictEqual(await compareAppPassword(temporaryPassword, user.passwordHash), true);
  });

  await test("GET user does not return temporary password or passwordHash", async () => {
    const res = await api.get(`/api/admin/users/${userId}`).set(authHeader(adminToken));
    expectStatus(res, 200, "admin get user");
    assertNoSecretLeak(res.body, [temporaryPassword]);
    assert.strictEqual(res.body.data.forcePasswordChange, true);
    assert.strictEqual(res.body.data.authState, "temporary_password");
  });

  await test("temporary-password login returns restricted challenge only", async () => {
    const res = await api
      .post("/api/auth/login")
      .send({ phoneE164: phone, password: temporaryPassword, deviceId: "tmp-device", deviceName: "Tmp Device" });
    expectStatus(res, 200, "temporary login");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "password_change_required");
    assert.strictEqual(res.body.mustChangePassword, true);
    assert(res.body.passwordChangeToken, "passwordChangeToken returned");
    assert.strictEqual(res.body.accessToken, undefined);
    assert.strictEqual(res.body.refreshToken, undefined);
    passwordChangeToken = res.body.passwordChangeToken;
  });

  await test("restricted token cannot access normal endpoints", async () => {
    let res = await api.get("/api/auth/me").set(authHeader(passwordChangeToken));
    expectStatus(res, 401, "restricted /me");
    expectErrorCode(res, "TOKEN_INVALID", "restricted /me");
    res = await api.get("/api/subscriptions").set(authHeader(passwordChangeToken));
    expectStatus(res, 401, "restricted subscriptions");
    expectErrorCode(res, "TOKEN_INVALID", "restricted subscriptions");
  });

  await test("complete password change rejects weak, mismatch, and temporary reuse", async () => {
    let res = await api
      .post("/api/auth/complete-password-change")
      .set(authHeader(passwordChangeToken))
      .send({ newPassword: "weak", confirmPassword: "weak" });
    expectStatus(res, 400, "weak permanent password");
    expectErrorCode(res, "WEAK_PASSWORD", "weak permanent password");

    res = await api
      .post("/api/auth/complete-password-change")
      .set(authHeader(passwordChangeToken))
      .send({ newPassword: "PermanentPassword123", confirmPassword: "PermanentPassword124" });
    expectStatus(res, 400, "mismatch permanent password");
    expectErrorCode(res, "PASSWORD_CONFIRMATION_MISMATCH", "mismatch permanent password");

    res = await api
      .post("/api/auth/complete-password-change")
      .set(authHeader(passwordChangeToken))
      .send({ newPassword: temporaryPassword, confirmPassword: temporaryPassword });
    expectStatus(res, 400, "temporary password reuse");
    expectErrorCode(res, "PASSWORD_REUSE_FORBIDDEN", "temporary password reuse");
  });

  await test("complete password change clears forced state and returns normal tokens", async () => {
    const res = await api
      .post("/api/auth/complete-password-change")
      .set(authHeader(passwordChangeToken))
      .send({
        newPassword: "PermanentPassword123",
        confirmPassword: "PermanentPassword123",
        deviceId: "complete-device",
        deviceName: "Complete Device",
      });
    expectStatus(res, 200, "complete password change");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "password_changed");
    assert.strictEqual(res.body.mustChangePassword, false);
    assert(res.body.accessToken);
    assert(res.body.refreshToken);
    assert.strictEqual(res.body.user.email, email);
    assert.strictEqual(res.body.user.emailVerified, false);
    assert.strictEqual(res.body.user.emailVerificationRequired, true);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;

    const user = await User.findById(userId).lean();
    assert.strictEqual(user.forcePasswordChange, false);
    assert.strictEqual(user.temporaryPasswordReason, null);
    assert.strictEqual(user.temporaryPasswordIssuedAt, null);
    assert.strictEqual(user.temporaryPasswordExpiresAt, null);
    assert(user.passwordSetAt, "passwordSetAt set for permanent password");
    assert(user.passwordChangedAt, "passwordChangedAt set");
  });

  await test("temporary password and restricted token no longer work", async () => {
    let res = await api.post("/api/auth/login").send({ phoneE164: phone, password: temporaryPassword });
    expectStatus(res, 401, "old temporary password");
    expectErrorCode(res, "INVALID_CREDENTIALS", "old temporary password");

    res = await api
      .post("/api/auth/complete-password-change")
      .set(authHeader(passwordChangeToken))
      .send({ newPassword: "AnotherPermanent123", confirmPassword: "AnotherPermanent123" });
    expectStatus(res, 409, "restricted token reuse");
    expectErrorCode(res, "PASSWORD_CHANGE_ALREADY_COMPLETED", "restricted token reuse");
  });

  await test("permanent password login works normally", async () => {
    const res = await api.post("/api/auth/login").send({ phoneE164: phone, password: "PermanentPassword123" });
    expectStatus(res, 200, "permanent login");
    assert.strictEqual(res.body.status, "logged_in");
    assert(res.body.accessToken);
    assert(res.body.refreshToken);
    assert.strictEqual(res.body.user.emailVerified, false);
    assert.strictEqual(res.body.user.emailVerificationRequired, true);
    oldAccessToken = res.body.accessToken;
    oldRefreshToken = res.body.refreshToken;
  });

  await test("admin reset issues new temporary password and revokes old sessions", async () => {
    const res = await api
      .post(`/api/admin/users/${appUserId}/reset-password`)
      .set(authHeader(adminToken))
      .send({ reason: "Customer visited branch" });
    expectStatus(res, 200, "admin reset");
    resetTemporaryPassword = res.body.data.temporaryPassword;
    assert(resetTemporaryPassword && resetTemporaryPassword.length >= 8, "reset temporary password returned");
    assert.notStrictEqual(resetTemporaryPassword, temporaryPassword);
    assert.strictEqual(res.body.data.forcePasswordChange, true);
    assert.strictEqual(res.body.data.sessionsRevoked, true);

    const oldSession = await RefreshSession.findOne({ refreshTokenHash: hashRefreshToken(oldRefreshToken) }).lean();
    assert(oldSession && oldSession.revokedAt, "old refresh session revoked");
    const oldRefresh = await api.post("/api/auth/refresh").send({ refreshToken: oldRefreshToken });
    expectStatus(oldRefresh, 401, "old refresh after admin reset");
    expectErrorCode(oldRefresh, "SESSION_REVOKED", "old refresh after admin reset");
    const oldAccess = await api.get("/api/auth/me").set(authHeader(oldAccessToken));
    expectStatus(oldAccess, 401, "old access after admin reset");
    expectErrorCode(oldAccess, "SESSION_REVOKED", "old access after admin reset");
  });

  await test("old permanent password fails and new temporary password requires change", async () => {
    let res = await api.post("/api/auth/login").send({ phoneE164: phone, password: "PermanentPassword123" });
    expectStatus(res, 401, "old permanent password after reset");
    expectErrorCode(res, "INVALID_CREDENTIALS", "old permanent password after reset");

    res = await api.post("/api/auth/login").send({ phoneE164: phone, password: resetTemporaryPassword });
    expectStatus(res, 200, "new temporary login");
    assert.strictEqual(res.body.status, "password_change_required");
    assert.strictEqual(res.body.accessToken, undefined);
    resetPasswordChangeToken = res.body.passwordChangeToken;
  });

  await test("expired temporary password is rejected after correct password", async () => {
    await User.findByIdAndUpdate(userId, { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });
    const res = await api.post("/api/auth/login").send({ phoneE164: phone, password: resetTemporaryPassword });
    expectStatus(res, 403, "expired temporary password");
    expectErrorCode(res, "TEMPORARY_PASSWORD_EXPIRED", "expired temporary password");
    await User.findByIdAndUpdate(userId, { temporaryPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  });

  await test("missing customer reset returns 404 and cashier reset is forbidden", async () => {
    let res = await api
      .post(`/api/admin/users/${new mongoose.Types.ObjectId()}/reset-password`)
      .set(authHeader(adminToken))
      .send({});
    expectStatus(res, 404, "missing reset");

    res = await api.post(`/api/admin/users/${userId}/reset-password`).set(authHeader(cashierToken)).send({});
    expectStatus(res, 403, "cashier reset");
    expectErrorCode(res, "FORBIDDEN", "cashier reset");
  });

  await test("duplicate-phone admin creation returns conflict", async () => {
    const res = await api
      .post("/api/admin/users")
      .set(authHeader(adminToken))
      .send({ fullName: "Duplicate", phoneE164: phone });
    expectStatus(res, 409, "duplicate create");
    expectErrorCode(res, "CONFLICT", "duplicate create");
  });

  await test("OTP reset invalidates outstanding temporary password", async () => {
    process.env.OTP_TEST_PHONE = phone;
    const forgot = await api.post("/api/auth/password/forgot").send({ phoneE164: phone });
    expectStatus(forgot, 200, "forgot with temp outstanding");
    const reset = await api
      .post("/api/auth/password/reset")
      .send({ phoneE164: phone, otp: TEST_OTP, newPassword: "OtpPermanentPassword123" });
    expectStatus(reset, 200, "otp reset");
    assert.deepStrictEqual(reset.body, { ok: true, status: "password_reset" });

    const tempLogin = await api.post("/api/auth/login").send({ phoneE164: phone, password: resetTemporaryPassword });
    expectStatus(tempLogin, 401, "temporary after otp reset");
    expectErrorCode(tempLogin, "INVALID_CREDENTIALS", "temporary after otp reset");

    const permanentLogin = await api.post("/api/auth/login").send({ phoneE164: phone, password: "OtpPermanentPassword123" });
    expectStatus(permanentLogin, 200, "permanent after otp reset");
    assert.strictEqual(permanentLogin.body.status, "logged_in");
    process.env.OTP_TEST_PHONE = undefined;
  });

  await test("existing normal users continue logging in normally", async () => {
    const normalPhone = "+201110030002";
    const res = await api
      .post("/api/auth/register")
      .send({
        phoneE164: normalPhone,
        password: "NormalPassword123",
        confirmPassword: "NormalPassword123",
      });
    expectStatus(res, 201, "normal register");
    const login = await api.post("/api/auth/login").send({ phoneE164: normalPhone, password: "NormalPassword123" });
    expectStatus(login, 200, "normal login");
    assert.strictEqual(login.body.status, "logged_in");
    assert(login.body.accessToken);
    assert(login.body.refreshToken);
    assert.strictEqual(login.body.user.emailVerified, false);
    assert.strictEqual(login.body.user.emailVerificationRequired, false);
  });

  await test("no response or audit record contains passwordHash or plaintext password", async () => {
    assertNoSecretLeak({ accessToken, refreshToken, resetPasswordChangeToken }, [temporaryPassword, resetTemporaryPassword]);
    const logs = await ActivityLog.find({ entityType: "user", entityId: userId }).lean();
    assert(logs.length >= 2, "audit records created");
    assertNoSecretLeak(logs, [temporaryPassword, resetTemporaryPassword]);
  });

  await stopMongo();

  console.log(`\nAdmin temporary password lifecycle tests: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await stopMongo();
  process.exitCode = 1;
});
