process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-auth-secret";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.BCRYPT_ROUNDS = "4";
process.env.OTP_TEST_MODE = "true";
process.env.ALLOW_TEST_AUTH = "true";
process.env.OTP_TEST_PHONE = "+201110021106";
process.env.OTP_TEST_CODE = "123456";
process.env.RATE_LIMIT_OTP_MAX = "100";
process.env.RATE_LIMIT_OTP_VERIFY_MAX = "100";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const Otp = require("../src/models/Otp");
const RefreshSession = require("../src/models/RefreshSession");
const { JWT_ACCESS_SECRET } = require("../src/services/appTokenService");
const { hashRefreshToken } = require("../src/services/refreshSessionService");

const app = createApp();
const api = request(app);
const TEST_PHONE = process.env.OTP_TEST_PHONE;
const TEST_OTP = process.env.OTP_TEST_CODE;
const TEST_PASSWORD = "UserStrongPassword123";
const NEW_PASSWORD = "NewStrongPassword123";

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

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function startMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "basicdiet_flutter_auth_test" },
  });
  const uri = replSet.getUri("basicdiet_flutter_auth_test");
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

async function run() {
  await startMongo();

  let accessToken;
  let refreshToken;
  let secondRefreshToken;
  let resetAccessToken;
  let resetRefreshToken;

  await test("registration OTP request creates OTP and no session", async () => {
    const res = await api
      .post("/api/auth/register/request-otp")
      .send({ phoneE164: TEST_PHONE });
    expectStatus(res, 200, "request register otp");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "otp_sent");
    assert.strictEqual(res.body.phoneE164, TEST_PHONE);
    assert.strictEqual(typeof res.body.cooldownSeconds, "number");
    assert.strictEqual(await Otp.countDocuments({ phone: TEST_PHONE }), 1);
    assert.strictEqual(await RefreshSession.countDocuments({}), 0);
  });

  await test("register verify returns accessToken and refreshToken", async () => {
    const res = await api
      .post("/api/auth/register/verify")
      .send({
        phoneE164: TEST_PHONE,
        otp: TEST_OTP,
        password: TEST_PASSWORD,
        deviceId: "device-1",
        deviceName: "iPhone 15",
      });
    expectStatus(res, 200, "verify register");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "registered");
    assert(res.body.accessToken, "accessToken returned");
    assert(res.body.refreshToken, "refreshToken returned");
    assert.strictEqual(res.body.expiresIn, 900);
    assert.strictEqual(res.body.refreshExpiresIn, 2592000);
    assert.strictEqual(res.body.user.phoneE164, TEST_PHONE);
    assert.strictEqual(res.body.user.phoneVerified, true);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    const user = await User.findOne({ phoneE164: TEST_PHONE });
    assert(user && user.passwordHash, "password hash persisted");
    assert.notStrictEqual(user.passwordHash, TEST_PASSWORD);
    const session = await RefreshSession.findOne({ userId: user._id }).lean();
    assert(session && session.refreshTokenHash, "refresh token hash persisted");
    assert.strictEqual(session.refreshToken, undefined, "raw refresh token not stored");
    assert.notStrictEqual(session.refreshTokenHash, refreshToken, "refresh token hash is not raw token");
  });

  await test("normal login returns tokens and does not create OTP", async () => {
    await Otp.deleteMany({});
    const res = await api
      .post("/api/auth/login")
      .send({
        phoneE164: TEST_PHONE,
        password: TEST_PASSWORD,
        deviceId: "device-2",
        deviceName: "Android",
      });
    expectStatus(res, 200, "login");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "logged_in");
    assert(res.body.accessToken);
    assert(res.body.refreshToken);
    secondRefreshToken = res.body.refreshToken;
    assert.strictEqual(await Otp.countDocuments({ phone: TEST_PHONE }), 0);
  });

  await test("wrong password returns INVALID_CREDENTIALS", async () => {
    const res = await api.post("/api/auth/login").send({ phoneE164: TEST_PHONE, password: "WrongPassword123" });
    expectStatus(res, 401, "wrong password");
    expectErrorCode(res, "INVALID_CREDENTIALS", "wrong password");
  });

  await test("registered user cannot request registration OTP again", async () => {
    const res = await api.post("/api/auth/register/request-otp").send({ phoneE164: TEST_PHONE });
    expectStatus(res, 409, "registered duplicate");
    expectErrorCode(res, "USER_ALREADY_REGISTERED", "registered duplicate");
  });

  await test("/me works with accessToken", async () => {
    const res = await api.get("/api/auth/me").set(authHeader(accessToken));
    expectStatus(res, 200, "me");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.user.phoneE164, TEST_PHONE);
  });

  await test("invalid access token returns TOKEN_INVALID", async () => {
    const res = await api.get("/api/auth/me").set(authHeader("not-a-token"));
    expectStatus(res, 401, "invalid access");
    expectErrorCode(res, "TOKEN_INVALID", "invalid access");
  });

  await test("expired access token returns TOKEN_EXPIRED", async () => {
    const user = await User.findOne({ phoneE164: TEST_PHONE });
    const expired = jwt.sign(
      { userId: String(user._id), role: "client", tokenType: "app_access" },
      JWT_ACCESS_SECRET,
      { expiresIn: "-1s" }
    );
    const res = await api.get("/api/auth/me").set(authHeader(expired));
    expectStatus(res, 401, "expired access");
    expectErrorCode(res, "TOKEN_EXPIRED", "expired access");
  });

  await test("valid refresh rotates refreshToken and returns new accessToken", async () => {
    const oldRefreshToken = refreshToken;
    const res = await api.post("/api/auth/refresh").send({ refreshToken });
    expectStatus(res, 200, "refresh");
    assert.strictEqual(res.body.ok, true);
    assert(res.body.accessToken);
    assert(res.body.refreshToken);
    assert.notStrictEqual(res.body.refreshToken, oldRefreshToken);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    const oldSession = await RefreshSession.findOne({ refreshTokenHash: hashRefreshToken(oldRefreshToken) }).lean();
    assert(oldSession && oldSession.revokedAt, "old refresh session revoked during rotation");
    const newSession = await RefreshSession.findOne({ refreshTokenHash: hashRefreshToken(refreshToken) }).lean();
    assert(newSession && !newSession.revokedAt, "new refresh session is active");
  });

  await test("invalid refresh token returns REFRESH_TOKEN_INVALID", async () => {
    const res = await api.post("/api/auth/refresh").send({ refreshToken: "invalid-refresh" });
    expectStatus(res, 401, "invalid refresh");
    expectErrorCode(res, "REFRESH_TOKEN_INVALID", "invalid refresh");
  });

  await test("logout revokes current refresh token", async () => {
    const res = await api.post("/api/auth/logout").set(authHeader(accessToken)).send({ refreshToken });
    expectStatus(res, 200, "logout");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "logged_out");
  });

  await test("refresh after logout fails with SESSION_REVOKED", async () => {
    const res = await api.post("/api/auth/refresh").send({ refreshToken });
    expectStatus(res, 401, "refresh after logout");
    expectErrorCode(res, "SESSION_REVOKED", "refresh after logout");
  });

  await test("logout-all revokes all sessions", async () => {
    const login = await api.post("/api/auth/login").send({ phoneE164: TEST_PHONE, password: TEST_PASSWORD });
    expectStatus(login, 200, "login before logout all");
    const tokenForLogoutAll = login.body.accessToken;
    const tokenToRevoke = login.body.refreshToken;
    const res = await api.post("/api/auth/logout-all").set(authHeader(tokenForLogoutAll)).send({});
    expectStatus(res, 200, "logout all");
    assert.strictEqual(res.body.status, "logged_out_all_devices");
    const refreshRes = await api.post("/api/auth/refresh").send({ refreshToken: tokenToRevoke });
    expectStatus(refreshRes, 401, "refresh after logout all");
    expectErrorCode(refreshRes, "SESSION_REVOKED", "refresh after logout all");
  });

  await test("forgot password returns generic success for existing and missing users", async () => {
    let res = await api.post("/api/auth/password/forgot").send({ phoneE164: TEST_PHONE });
    expectStatus(res, 200, "forgot existing");
    assert.deepStrictEqual(res.body, { ok: true, status: "otp_sent_if_account_exists" });

    res = await api.post("/api/auth/password/forgot").send({ phoneE164: "+201110021107" });
    expectStatus(res, 200, "forgot missing");
    assert.deepStrictEqual(res.body, { ok: true, status: "otp_sent_if_account_exists" });
  });

  await test("reset password changes password and revokes old sessions", async () => {
    const beforeReset = await api.post("/api/auth/login").send({ phoneE164: TEST_PHONE, password: TEST_PASSWORD });
    expectStatus(beforeReset, 200, "login before reset");
    resetRefreshToken = beforeReset.body.refreshToken;

    const res = await api
      .post("/api/auth/password/reset")
      .send({ phoneE164: TEST_PHONE, otp: TEST_OTP, newPassword: NEW_PASSWORD });
    expectStatus(res, 200, "reset password");
    assert.deepStrictEqual(res.body, { ok: true, status: "password_reset" });

    const oldRefresh = await api.post("/api/auth/refresh").send({ refreshToken: resetRefreshToken });
    expectStatus(oldRefresh, 401, "old refresh after reset");
    expectErrorCode(oldRefresh, "SESSION_REVOKED", "old refresh after reset");
  });

  await test("old password fails after reset", async () => {
    const res = await api.post("/api/auth/login").send({ phoneE164: TEST_PHONE, password: TEST_PASSWORD });
    expectStatus(res, 401, "old password after reset");
    expectErrorCode(res, "INVALID_CREDENTIALS", "old password after reset");
  });

  await test("new password login succeeds after reset", async () => {
    const res = await api.post("/api/auth/login").send({ phoneE164: TEST_PHONE, password: NEW_PASSWORD });
    expectStatus(res, 200, "new password login");
    resetAccessToken = res.body.accessToken;
    resetRefreshToken = res.body.refreshToken;
    assert(resetAccessToken);
    assert(resetRefreshToken);
  });

  await test("weak password is rejected", async () => {
    await Otp.deleteMany({});
    await User.deleteOne({ phone: "+201110021108" });
    process.env.OTP_TEST_PHONE = "+201110021108";
    const requestOtpRes = await api.post("/api/auth/register/request-otp").send({ phoneE164: "+201110021108" });
    expectStatus(requestOtpRes, 200, "weak password otp request");
    const res = await api
      .post("/api/auth/register/verify")
      .send({ phoneE164: "+201110021108", otp: TEST_OTP, password: "short" });
    expectStatus(res, 400, "weak password");
    expectErrorCode(res, "WEAK_PASSWORD", "weak password");
    process.env.OTP_TEST_PHONE = TEST_PHONE;
  });

  await test("existing verified user without password gets PASSWORD_RESET_REQUIRED and can set password", async () => {
    const setupPhone = "+201110021109";
    await User.create({ phone: setupPhone, phoneE164: setupPhone, phoneVerified: true, role: "client" });
    const login = await api.post("/api/auth/login").send({ phoneE164: setupPhone, password: "AnyPassword123" });
    expectStatus(login, 403, "password setup required");
    expectErrorCode(login, "PASSWORD_RESET_REQUIRED", "password setup required");

    process.env.OTP_TEST_PHONE = setupPhone;
    const forgot = await api.post("/api/auth/password/forgot").send({ phoneE164: setupPhone });
    expectStatus(forgot, 200, "forgot setup user");
    const reset = await api
      .post("/api/auth/password/reset")
      .send({ phoneE164: setupPhone, otp: TEST_OTP, newPassword: "SetupPassword123" });
    expectStatus(reset, 200, "reset setup user");
    const newLogin = await api.post("/api/auth/login").send({ phoneE164: setupPhone, password: "SetupPassword123" });
    expectStatus(newLogin, 200, "login setup user");
    process.env.OTP_TEST_PHONE = TEST_PHONE;
  });

  await test("app startup flow is supported: /me then refresh after expiry", async () => {
    const me = await api.get("/api/auth/me").set(authHeader(resetAccessToken));
    expectStatus(me, 200, "startup me");
    const refreshRes = await api.post("/api/auth/refresh").send({ refreshToken: resetRefreshToken });
    expectStatus(refreshRes, 200, "startup refresh");
    const retryMe = await api.get("/api/auth/me").set(authHeader(refreshRes.body.accessToken));
    expectStatus(retryMe, 200, "startup retry me");
  });

  await test("legacy OTP/app endpoints still respond", async () => {
    process.env.OTP_TEST_PHONE = "+201110021110";
    const legacyRegister = await api
      .post("/api/app/register")
      .send({ fullName: "Legacy User", phoneE164: "+201110021110" });
    expectStatus(legacyRegister, 200, "legacy app register");
    const legacyVerify = await api
      .post("/api/auth/otp/verify")
      .send({ phoneE164: "+201110021110", otp: TEST_OTP });
    expectStatus(legacyVerify, 200, "legacy otp verify");
    assert(legacyVerify.body.token, "legacy token returned");
    const legacyProfile = await api.get("/api/app/profile").set(authHeader(legacyVerify.body.token));
    expectStatus(legacyProfile, 200, "legacy app profile");

    process.env.OTP_TEST_PHONE = "+201110021111";
    const legacyLogin = await api
      .post("/api/app/login")
      .send({ phoneE164: "+201110021111" });
    expectStatus(legacyLogin, 200, "legacy app login");
    assert.strictEqual(legacyLogin.body.status, true);
    assert.strictEqual(legacyLogin.body.data.nextStep, "verify");
    process.env.OTP_TEST_PHONE = TEST_PHONE;
  });

  await stopMongo();

  console.log(`\nFlutter auth tests: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await stopMongo();
  process.exitCode = 1;
});
