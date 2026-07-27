process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "customer-auth-secret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "4";
process.env.AUTH_PASSWORD_LOGIN_ENABLED = "true";
process.env.RATE_LIMIT_MOBILE_LOGIN_MAX = "100";

require("dotenv").config();
require("./customerTemporaryPasswordPolicy.test");

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const ActivityLog = require("../src/models/ActivityLog");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const RefreshSession = require("../src/models/RefreshSession");
const User = require("../src/models/User");

const TEST_TAG = `dashboard-users-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL_DOMAIN = "example.test";
const LIFECYCLE_PHONE = "+966547896328";
const SECOND_LIFECYCLE_PHONE = "+966547896329";
const TEMPORARY_PIN = "12345678";
const PERMANENT_PASSWORD = "ClientPassword123";
const TEST_PHONES = [
  "+966550100001",
  "+966550100002",
  "+966550100003",
  "+966550100004",
  LIFECYCLE_PHONE,
  SECOND_LIFECYCLE_PHONE,
];

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  } else if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  }
}

async function cleanup() {
  const users = await User.find({
    $or: [
      { name: { $regex: TEST_TAG } },
      { email: { $regex: TEST_TAG } },
      { phone: { $in: TEST_PHONES } },
      { phoneE164: { $in: TEST_PHONES } },
    ],
  }).select("_id phone phoneE164").lean();
  const userIds = users.map((user) => user._id);
  const phones = Array.from(new Set([
    ...TEST_PHONES,
    ...users.flatMap((user) => [user.phone, user.phoneE164]).filter(Boolean),
  ]));

  await Promise.all([
    ActivityLog.deleteMany({ entityType: "user", entityId: { $in: userIds } }),
    RefreshSession.deleteMany({ userId: { $in: userIds } }),
    AppUser.deleteMany({
      $or: [
        { coreUserId: { $in: userIds } },
        { phone: { $in: phones } },
        { email: { $regex: TEST_TAG } },
        { fullName: { $regex: TEST_TAG } },
      ],
    }),
    User.deleteMany({ _id: { $in: userIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function seedUsers() {
  const active = await User.create({
    phone: "+966550100001",
    phoneE164: "+966550100001",
    name: `${TEST_TAG} Alpha Client`,
    email: `${TEST_TAG}.alpha@${EMAIL_DOMAIN}`,
    role: "client",
    isActive: true,
  });
  const inactive = await User.create({
    phone: "+966550100002",
    phoneE164: "+966550100002",
    name: `${TEST_TAG} Beta Client`,
    email: `${TEST_TAG}.beta@${EMAIL_DOMAIN}`,
    role: "client",
    isActive: false,
  });
  const arabic = await User.create({
    phone: "+966550100003",
    phoneE164: "+966550100003",
    name: `${TEST_TAG} عميل عربي`,
    email: `${TEST_TAG}.arabic@${EMAIL_DOMAIN}`,
    role: "client",
    isActive: true,
  });
  const temporary = await User.create({
    phone: "+966550100004",
    phoneE164: "+966550100004",
    name: `${TEST_TAG} Temporary Client`,
    email: `${TEST_TAG}.temporary@${EMAIL_DOMAIN}`,
    role: "client",
    isActive: true,
    forcePasswordChange: true,
    temporaryPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  await AppUser.create({
    coreUserId: active._id,
    phone: active.phone,
    email: `${TEST_TAG}.linked@${EMAIL_DOMAIN}`,
    fullName: `${TEST_TAG} Linked Profile`,
  });

  return { active, inactive, arabic, temporary };
}

function idsFrom(res) {
  return (res.body.data || []).map((user) => user.id);
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function expectErrorCode(res, code, label) {
  assert.strictEqual(res.body && res.body.ok, false, `${label}: expected ok=false, got ${JSON.stringify(res.body)}`);
  assert.strictEqual(
    res.body && res.body.error && res.body.error.code,
    code,
    `${label}: expected ${code}, got ${JSON.stringify(res.body)}`
  );
}

async function verifyDashboardCustomerAuthLifecycle(api, headers) {
  const createPayload = {
    fullName: "Numeric PIN Client",
    phone: LIFECYCLE_PHONE,
    email: "test@gmail.com",
    temporaryPassword: TEMPORARY_PIN,
    isActive: true,
  };

  let res = await api.post("/api/dashboard/users").set(headers).send(createPayload);
  expectStatus(res, 201, "create customer with numeric temporary PIN");
  assert.strictEqual(res.body.status, true);
  assert.strictEqual(res.body.data.phone, LIFECYCLE_PHONE);
  assert.strictEqual(res.body.data.email, null, "dashboard email must be ignored");
  assert.strictEqual(res.body.data.forcePasswordChange, true);
  assert.strictEqual(res.body.data.temporaryCredentials.temporaryPassword, TEMPORARY_PIN);
  assert.strictEqual(res.body.data.temporaryCredentials.mustChangePassword, true);

  const createdUser = await User.findOne({ phoneE164: LIFECYCLE_PHONE });
  const createdAppUser = await AppUser.findOne({ phone: LIFECYCLE_PHONE }).lean();
  assert(createdUser && createdUser.passwordHash, "core customer and password hash must be created atomically");
  assert(createdAppUser && String(createdAppUser.coreUserId) === String(createdUser._id), "AppUser must link to the core user");
  assert.strictEqual(createdUser.email, undefined, "core user must not persist a dashboard default email");
  assert.strictEqual(createdAppUser.email, undefined, "AppUser must not persist a dashboard default email");
  assert.strictEqual(createdUser.forcePasswordChange, true);
  assert(createdUser.temporaryPasswordExpiresAt, "temporary password expiry must be stored");

  res = await api.post("/api/dashboard/users").set(headers).send({
    ...createPayload,
    fullName: "Second Numeric PIN Client",
    phone: SECOND_LIFECYCLE_PHONE,
  });
  expectStatus(res, 201, "same default email must not block a different phone");
  assert.strictEqual(res.body.data.email, null);

  res = await api.post("/api/dashboard/users").set(headers).send({
    fullName: "Duplicate Phone",
    phone: LIFECYCLE_PHONE,
    temporaryPassword: "87654321",
    isActive: true,
  });
  expectStatus(res, 409, "duplicate phone must remain blocked");
  expectErrorCode(res, "CONFLICT", "duplicate phone");

  res = await api.post("/api/auth/login").send({
    phoneE164: LIFECYCLE_PHONE,
    password: TEMPORARY_PIN,
  });
  expectStatus(res, 200, "temporary PIN login");
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.status, "password_change_required");
  assert.strictEqual(res.body.mustChangePassword, true);
  assert(res.body.passwordChangeToken, "temporary login must return a password-change token");
  assert.strictEqual(res.body.accessToken, undefined, "temporary PIN must never receive a normal access token");
  assert.strictEqual(res.body.refreshToken, undefined, "temporary PIN must never receive a refresh token");
  const passwordChangeToken = res.body.passwordChangeToken;

  res = await api
    .post("/api/auth/complete-password-change")
    .set({ Authorization: `Bearer ${passwordChangeToken}` })
    .send({ newPassword: "87654321", confirmPassword: "87654321" });
  expectStatus(res, 400, "numeric permanent password must remain weak");
  expectErrorCode(res, "WEAK_PASSWORD", "numeric permanent password");

  res = await api
    .post("/api/auth/complete-password-change")
    .set({ Authorization: `Bearer ${passwordChangeToken}` })
    .send({ newPassword: PERMANENT_PASSWORD, confirmPassword: PERMANENT_PASSWORD });
  expectStatus(res, 200, "complete mandatory password change");
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.status, "password_changed");
  assert.strictEqual(res.body.mustChangePassword, false);
  assert(res.body.accessToken, "permanent password completion must return an access token");
  assert(res.body.refreshToken, "permanent password completion must return a refresh token");

  const completedUser = await User.findOne({ phoneE164: LIFECYCLE_PHONE }).lean();
  assert.strictEqual(completedUser.forcePasswordChange, false);
  assert.strictEqual(completedUser.temporaryPasswordReason, null);
  assert.strictEqual(completedUser.temporaryPasswordIssuedAt, null);
  assert.strictEqual(completedUser.temporaryPasswordExpiresAt, null);

  res = await api
    .post("/api/auth/complete-password-change")
    .set({ Authorization: `Bearer ${passwordChangeToken}` })
    .send({ newPassword: "AnotherPassword123", confirmPassword: "AnotherPassword123" });
  expectStatus(res, 409, "password-change token must not be reusable");
  expectErrorCode(res, "PASSWORD_CHANGE_ALREADY_COMPLETED", "password-change token reuse");

  res = await api.post("/api/auth/login").send({
    phoneE164: LIFECYCLE_PHONE,
    password: TEMPORARY_PIN,
  });
  expectStatus(res, 401, "temporary PIN must stop working after completion");
  expectErrorCode(res, "INVALID_CREDENTIALS", "old temporary PIN");

  res = await api.post("/api/auth/login").send({
    phoneE164: LIFECYCLE_PHONE,
    password: PERMANENT_PASSWORD,
  });
  expectStatus(res, 200, "permanent password login");
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.status, "logged_in");
  assert(res.body.accessToken);
  assert(res.body.refreshToken);
}

async function run() {
  await connect();
  await cleanup();
  const app = createApp();
  const api = request(app);
  const { headers } = await dashboardAuth("admin", TEST_TAG);
  const users = await seedUsers();

  try {
    await verifyDashboardCustomerAuthLifecycle(api, headers);

    let res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(users.active.phone)}&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "exact phone search");
    assert.deepStrictEqual(idsFrom(res), [String(users.active._id)]);
    assert.strictEqual(res.body.meta.total, 1);

    res = await api.get("/api/dashboard/users?q=55010000&page=1&limit=10").set(headers);
    expectStatus(res, 200, "partial phone search");
    assert(idsFrom(res).includes(String(users.active._id)));
    assert(idsFrom(res).includes(String(users.inactive._id)));
    assert.strictEqual(res.body.meta.total, 4);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(`${TEST_TAG}.ALPHA@${EMAIL_DOMAIN}`)}&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "case-insensitive email search");
    assert.deepStrictEqual(idsFrom(res), [String(users.active._id)]);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(`${TEST_TAG}.linked@${EMAIL_DOMAIN}`)}&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "linked app user email search");
    assert.deepStrictEqual(idsFrom(res), [String(users.active._id)]);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent("عميل عربي")}&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "Arabic name search");
    assert.deepStrictEqual(idsFrom(res), [String(users.arabic._id)]);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(TEST_TAG)}&status=inactive&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "status filter combined with q");
    assert.deepStrictEqual(idsFrom(res), [String(users.inactive._id)]);
    assert.strictEqual(res.body.meta.total, 1);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(TEST_TAG)}&authState=temporary_password&page=1&limit=10`).set(headers);
    expectStatus(res, 200, "authState filter combined with q");
    assert.deepStrictEqual(idsFrom(res), [String(users.temporary._id)]);

    res = await api.get(`/api/dashboard/users?q=${encodeURIComponent(TEST_TAG)}&page=1&limit=2`).set(headers);
    expectStatus(res, 200, "filtered pagination total");
    assert.strictEqual(res.body.data.length, 2);
    assert.strictEqual(res.body.meta.total, 4);

    res = await api.get("/api/dashboard/users?q=no-such-user&page=1&limit=10").set(headers);
    expectStatus(res, 200, "no-match search");
    assert.deepStrictEqual(res.body.data, []);
    assert.strictEqual(res.body.meta.total, 0);

    res = await api.get("/api/dashboard/users?role=admin&page=1&limit=10").set(headers);
    expectStatus(res, 400, "invalid role filter");
    assert.strictEqual(res.body.error.code, "INVALID");

    console.log("dashboard users search and customer auth lifecycle tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(`dashboard users search tests failed: ${err.stack || err.message}`);
  process.exit(1);
});
