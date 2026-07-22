process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

require("dotenv").config();
require("./customerTemporaryPasswordPolicy.test");

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const User = require("../src/models/User");

const TEST_TAG = `dashboard-users-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL_DOMAIN = "example.test";

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
      { phone: { $in: ["+966550100001", "+966550100002", "+966550100003", "+966550100004"] } },
    ],
  }).select("_id phone").lean();
  const userIds = users.map((user) => user._id);
  const phones = users.map((user) => user.phone).filter(Boolean);

  await Promise.all([
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

async function run() {
  await connect();
  await cleanup();
  const app = createApp();
  const api = request(app);
  const { headers } = await dashboardAuth("admin", TEST_TAG);
  const users = await seedUsers();

  try {
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

    console.log("dashboard users search tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(`dashboard users search tests failed: ${err.stack || err.message}`);
  process.exit(1);
});
