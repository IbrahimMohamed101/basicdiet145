process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "email-auth-test-secret";
process.env.JWT_ACCESS_SECRET = "email-auth-test-access-secret";
process.env.REFRESH_TOKEN_HASH_SECRET = "email-auth-test-refresh-secret";
process.env.EMAIL_OTP_HASH_SECRET = "email-auth-test-otp-secret";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_EMAIL_OTP_ENABLED = "true";
process.env.EMAIL_OTP_TEST_MODE = "true";
process.env.ALLOW_TEST_AUTH = "true";
process.env.EMAIL_OTP_TEST_EMAIL = "new.customer@example.com";
process.env.EMAIL_OTP_TEST_CODE = "654321";
process.env.EMAIL_OTP_RESEND_SECONDS = "10";
process.env.EMAIL_OTP_MAX_ATTEMPTS = "5";
process.env.RATE_LIMIT_OTP_MAX = "1000";
process.env.RATE_LIMIT_OTP_VERIFY_MAX = "1000";
process.env.RATE_LIMIT_MOBILE_LOGIN_MAX = "1000";

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet, MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const AppUser = require("../src/models/AppUser");
const EmailOtpChallenge = require("../src/models/EmailOtpChallenge");
const RefreshSession = require("../src/models/RefreshSession");
const User = require("../src/models/User");
const { compareAppPassword, hashAppPassword } = require("../src/services/appPasswordService");
const { hashRefreshToken } = require("../src/services/refreshSessionService");

const api = request(createApp());
const OTP = process.env.EMAIL_OTP_TEST_CODE;
const PASSWORD = "StrongPassword123";
const NEW_PASSWORD = "ChangedPassword123";

const useStandaloneMongo = process.env.EMAIL_AUTH_TEST_STANDALONE === "true";
let mongoServer;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: ${JSON.stringify(res.body)}`);
}

function expectError(res, code, label) {
  assert.strictEqual(res.body && res.body.ok, false, `${label}: expected ok=false`);
  assert.strictEqual(res.body && res.body.error && res.body.error.code, code, `${label}: ${JSON.stringify(res.body)}`);
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function startMongo() {
  mongoServer = useStandaloneMongo
    ? await MongoMemoryServer.create()
    : await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: "email_otp_auth_test" } });
  const uri = mongoServer.getUri("email_otp_auth_test");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    User.syncIndexes(),
    AppUser.syncIndexes(),
    EmailOtpChallenge.syncIndexes(),
    RefreshSession.syncIndexes(),
  ]);
}

async function stopMongo() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function run() {
  await startMongo();

  let registrationChallengeId;
  let accessToken;
  let refreshToken;
  let legacyAccessToken;
  let resetToken;

  await test("email OTP endpoints are inert when feature flag is disabled", async () => {
    process.env.AUTH_EMAIL_OTP_ENABLED = "false";
    const res = await api.post("/api/auth/email/register/start").send({
      fullName: "Disabled User",
      phoneE164: "+966500000111",
      email: "disabled@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 503, "feature disabled");
    expectError(res, "EMAIL_OTP_DISABLED", "feature disabled");
    assert.strictEqual(await User.countDocuments({ phoneE164: "+966500000111" }), 0);
    process.env.AUTH_EMAIL_OTP_ENABLED = "true";
  });

  await test("registration start stores only hashes and does not create a customer", async () => {
    const res = await api.post("/api/auth/email/register/start").send({
      fullName: "New Customer",
      phoneE164: "+966500000112",
      email: "New.Customer@Example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 200, "registration start");
    assert.strictEqual(res.body.status, "email_otp_sent");
    assert(res.body.challengeId);
    registrationChallengeId = res.body.challengeId;
    assert.strictEqual(await User.countDocuments({ phoneE164: "+966500000112" }), 0);

    const challenge = await EmailOtpChallenge.findOne({ challengeId: registrationChallengeId })
      .select("+codeHash +pendingRegistration.passwordHash")
      .lean();
    assert(challenge && challenge.codeHash);
    assert.notStrictEqual(challenge.codeHash, OTP);
    assert(challenge.pendingRegistration && challenge.pendingRegistration.passwordHash);
    assert.notStrictEqual(challenge.pendingRegistration.passwordHash, PASSWORD);
    assert(!JSON.stringify(challenge).includes(PASSWORD));
  });

  await test("wrong email OTP decrements attempts without creating a user", async () => {
    const res = await api.post("/api/auth/email/register/verify").send({
      challengeId: registrationChallengeId,
      otp: "000000",
    });
    expectStatus(res, 400, "wrong registration OTP");
    expectError(res, "EMAIL_OTP_INVALID", "wrong registration OTP");
    const challenge = await EmailOtpChallenge.findOne({ challengeId: registrationChallengeId }).lean();
    assert.strictEqual(challenge.attemptsLeft, 4);
    assert.strictEqual(await User.countDocuments({ phoneE164: "+966500000112" }), 0);
  });

  await test("verified registration atomically creates a verified customer and session", async () => {
    const res = await api.post("/api/auth/email/register/verify").send({
      challengeId: registrationChallengeId,
      otp: OTP,
      deviceId: "email-test-device",
      deviceName: "Email Test",
    });
    expectStatus(res, 201, "registration verify");
    assert.strictEqual(res.body.status, "registered");
    assert.strictEqual(res.body.user.email, "new.customer@example.com");
    assert.strictEqual(res.body.user.emailVerified, true);
    assert(res.body.accessToken && res.body.refreshToken);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;

    const user = await User.findOne({ phoneE164: "+966500000112" });
    assert(user);
    assert.strictEqual(user.emailVerified, true);
    assert.strictEqual(user.phoneVerified, false);
    assert(user.emailVerifiedAt instanceof Date);
    assert(await compareAppPassword(PASSWORD, user.passwordHash));
    assert.strictEqual(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null }), 1);
    const challenge = await EmailOtpChallenge.findOne({ challengeId: registrationChallengeId }).lean();
    assert(challenge.consumedAt instanceof Date);
  });

  await test("registration OTP is single-use and duplicate email remains rejected", async () => {
    let res = await api.post("/api/auth/email/register/verify").send({ challengeId: registrationChallengeId, otp: OTP });
    expectStatus(res, 400, "reused registration OTP");
    expectError(res, "EMAIL_OTP_INVALID", "reused registration OTP");

    res = await api.post("/api/auth/email/register/start").send({
      fullName: "Duplicate Email",
      phoneE164: "+966500000113",
      email: "NEW.CUSTOMER@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expectStatus(res, 409, "duplicate email");
    expectError(res, "EMAIL_OR_PHONE_IN_USE", "duplicate email");
  });

  await test("current-user contract exposes email verification state", async () => {
    const res = await api.get("/api/auth/me").set(authHeader(accessToken));
    expectStatus(res, 200, "me");
    assert.strictEqual(res.body.user.emailVerified, true);
    assert.strictEqual(res.body.user.emailVerificationRequired, false);
  });

  await test("legacy customer without email can still log in unchanged", async () => {
    const legacyPassword = "LegacyPassword123";
    await User.create({
      name: "Legacy Customer",
      phone: "+966500000114",
      phoneE164: "+966500000114",
      phoneVerified: true,
      passwordHash: await hashAppPassword(legacyPassword),
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(Date.now() - 2000),
      authVersion: 1,
      authProvider: "password",
      authMethods: ["password"],
      role: "client",
    });
    await AppUser.create({
      fullName: "Legacy Customer",
      phone: "+966500000114",
      email: "legacy.customer@example.com",
      coreUserId: null,
    });
    const res = await api.post("/api/auth/login").send({
      phoneE164: "+966500000114",
      password: legacyPassword,
    });
    expectStatus(res, 200, "legacy login");
    assert(res.body.accessToken);
    assert.strictEqual(res.body.user.email, null);
    assert.strictEqual(res.body.user.emailVerified, false);
    legacyAccessToken = res.body.accessToken;
  });

  await test("legacy customer can add and verify email without changing it before OTP", async () => {
    process.env.EMAIL_OTP_TEST_EMAIL = "legacy.customer@example.com";
    let res = await api
      .post("/api/auth/email/verification/request")
      .set(authHeader(legacyAccessToken))
      .send({ email: "Legacy.Customer@Example.com" });
    expectStatus(res, 200, "legacy email request");
    const challengeId = res.body.challengeId;
    let user = await User.findOne({ phoneE164: "+966500000114" }).lean();
    assert.strictEqual(user.email, undefined);
    assert.strictEqual(user.emailVerified, false);

    res = await api
      .post("/api/auth/email/verification/confirm")
      .set(authHeader(legacyAccessToken))
      .send({ challengeId, otp: OTP });
    expectStatus(res, 200, "legacy email confirm");
    assert.strictEqual(res.body.user.emailVerified, true);
    user = await User.findOne({ phoneE164: "+966500000114" }).lean();
    assert.strictEqual(user.email, "legacy.customer@example.com");
    assert.strictEqual(user.emailVerified, true);
    const linkedAppUser = await AppUser.findOne({ phone: "+966500000114" }).lean();
    assert.strictEqual(String(linkedAppUser.coreUserId), String(user._id));
  });

  await test("password-reset request does not reveal whether an email exists", async () => {
    process.env.EMAIL_OTP_TEST_EMAIL = "new.customer@example.com";
    const existing = await api.post("/api/auth/password/email/request").send({ email: "new.customer@example.com" });
    const missing = await api.post("/api/auth/password/email/request").send({ email: "missing@example.com" });
    expectStatus(existing, 200, "existing reset request");
    expectStatus(missing, 200, "missing reset request");
    assert.strictEqual(existing.body.status, "otp_sent_if_account_exists");
    assert.strictEqual(missing.body.status, "otp_sent_if_account_exists");
    assert(existing.body.challengeId && missing.body.challengeId);
    assert.strictEqual(typeof existing.body.expiresIn, typeof missing.body.expiresIn);
    assert.strictEqual(typeof existing.body.resendAfter, typeof missing.body.resendAfter);
    assert.notStrictEqual(existing.body.challengeId, missing.body.challengeId);

    const existingAgain = await api.post("/api/auth/password/email/request").send({ email: "new.customer@example.com" });
    const missingAgain = await api.post("/api/auth/password/email/request").send({ email: "missing@example.com" });
    expectStatus(existingAgain, 200, "existing reset request during cooldown");
    expectStatus(missingAgain, 200, "missing reset request during cooldown");
    assert.strictEqual(existingAgain.body.challengeId, existing.body.challengeId);
    assert.strictEqual(missingAgain.body.challengeId, missing.body.challengeId);
    registrationChallengeId = existing.body.challengeId;
  });

  await test("unverified email creates only an unlinked decoy reset challenge", async () => {
    await User.create({
      name: "Unverified Email",
      phone: "+966500000115",
      phoneE164: "+966500000115",
      phoneVerified: true,
      email: "unverified@example.com",
      emailVerified: false,
      passwordHash: await hashAppPassword(PASSWORD),
      role: "client",
    });
    const res = await api.post("/api/auth/password/email/request").send({ email: "unverified@example.com" });
    expectStatus(res, 200, "unverified reset request");
    const challenge = await EmailOtpChallenge.findOne({
      purpose: "password_reset",
      email: "unverified@example.com",
    }).lean();
    assert(challenge);
    assert.strictEqual(challenge.userId, null);
  });

  await test("email OTP verification issues a scoped one-time reset token", async () => {
    let res = await api.post("/api/auth/password/email/verify").send({
      challengeId: registrationChallengeId,
      otp: "111111",
    });
    expectStatus(res, 400, "wrong reset OTP");
    expectError(res, "EMAIL_OTP_INVALID", "wrong reset OTP");

    res = await api.post("/api/auth/password/email/verify").send({
      challengeId: registrationChallengeId,
      otp: OTP,
    });
    expectStatus(res, 200, "verify reset OTP");
    assert(res.body.passwordResetToken);
    resetToken = res.body.passwordResetToken;
    const challenge = await EmailOtpChallenge.findOne({ challengeId: registrationChallengeId })
      .select("+resetTokenHash")
      .lean();
    assert(challenge.resetTokenHash);
    assert.notStrictEqual(challenge.resetTokenHash, resetToken);
  });

  await test("email password reset revokes old sessions and token cannot be reused", async () => {
    let res = await api.post("/api/auth/password/email/reset").send({
      passwordResetToken: resetToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expectStatus(res, 200, "email password reset");
    assert.strictEqual(res.body.status, "password_reset");

    const user = await User.findOne({ email: "new.customer@example.com" });
    assert(await compareAppPassword(NEW_PASSWORD, user.passwordHash));
    const oldSession = await RefreshSession.findOne({
      userId: user._id,
      refreshTokenHash: hashRefreshToken(refreshToken),
    }).lean();
    assert(oldSession && oldSession.revokedAt, "existing session should be revoked");

    const refreshRes = await api.post("/api/auth/refresh").send({ refreshToken });
    expectStatus(refreshRes, 401, "refresh after email reset");
    expectError(refreshRes, "SESSION_REVOKED", "refresh after email reset");

    res = await api.post("/api/auth/password/email/reset").send({
      passwordResetToken: resetToken,
      newPassword: "AnotherPassword123",
      confirmPassword: "AnotherPassword123",
    });
    expectStatus(res, 401, "reused reset token");
    expectError(res, "PASSWORD_RESET_TOKEN_INVALID", "reused reset token");

    const oldLogin = await api.post("/api/auth/login").send({ phoneE164: "+966500000112", password: PASSWORD });
    expectStatus(oldLogin, 401, "old password login");
    const newLogin = await api.post("/api/auth/login").send({ phoneE164: "+966500000112", password: NEW_PASSWORD });
    expectStatus(newLogin, 200, "new password login");
  });

  await stopMongo();
  const topology = useStandaloneMongo ? "standalone" : "replica set";
  console.log(`\nEmail OTP auth tests (${topology}): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await stopMongo();
  process.exitCode = 1;
});
