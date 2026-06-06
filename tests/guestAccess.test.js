process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-guest-access-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test-dashboard-guest-secret";
process.env.GUEST_TOKEN_EXPIRES_IN = "30m";
process.env.ACCESS_TOKEN_EXPIRES_IN = "15m";
process.env.RATE_LIMIT_MOBILE_LOGIN_MAX = "100";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Plan = require("../src/models/Plan");
const User = require("../src/models/User");
const { issueAppAccessToken } = require("../src/services/appTokenService");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");
const DashboardUser = require("../src/models/DashboardUser");

const app = createApp();
const api = request(app);
const results = { passed: 0, failed: 0 };
let replSet;

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

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function expectErrorCode(res, code, label) {
  assert.strictEqual(res.body && res.body.ok, false, `${label}: ok false`);
  assert.strictEqual(res.body && res.body.error && res.body.error.code, code, `${label}: expected ${code}, got ${JSON.stringify(res.body)}`);
}

async function startMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "basicdiet_guest_access_test" },
  });
  const uri = replSet.getUri("basicdiet_guest_access_test");
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

async function seedPlan() {
  return Plan.create({
    key: "guest_mode_plan",
    name: { en: "Guest Browse Plan", ar: "Guest Browse Plan" },
    description: { en: "Visible to guests", ar: "Visible to guests" },
    daysCount: 7,
    durationDays: 7,
    currency: "SAR",
    gramsOptions: [
      {
        grams: 150,
        isActive: true,
        mealsOptions: [
          {
            mealsPerDay: 2,
            priceHalala: 5000,
            compareAtHalala: 6000,
            isActive: true,
          },
        ],
      },
    ],
    isActive: true,
    sortOrder: 1,
  });
}

async function seedClient() {
  const user = await User.create({
    phone: "+15550001111",
    phoneE164: "+15550001111",
    phoneVerified: true,
    role: "client",
    name: "Real Client",
    isActive: true,
  });
  return { user, token: issueAppAccessToken(user) };
}

async function seedDashboardUser() {
  const user = await DashboardUser.create({
    email: "guest-mode-admin@example.com",
    passwordHash: "unused",
    role: "admin",
    isActive: true,
  });
  return { user, token: issueDashboardAccessToken(user) };
}

async function run() {
  await startMongo();
  const plan = await seedPlan();
  const client = await seedClient();
  const dashboard = await seedDashboardUser();
  let guestToken;

  await test("POST /api/auth/guest returns stateless guest identity", async () => {
    const res = await api.post("/api/auth/guest").send({});
    expectStatus(res, 200, "guest auth");
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "guest");
    assert(res.body.accessToken, "accessToken returned");
    assert.strictEqual(res.body.user.id, "guest");
    assert.strictEqual(res.body.user.role, "guest");
    assert.strictEqual(res.body.user.isGuest, true);
    assert.strictEqual(typeof res.body.expiresIn, "number");
    guestToken = res.body.accessToken;
    assert.strictEqual(await User.countDocuments({ role: "guest" }), 0, "guest auth must not create users");
  });

  await test("POST /api/app/guest returns app-compatible guest identity", async () => {
    const res = await api.post("/api/app/guest").send({});
    expectStatus(res, 200, "app guest auth");
    assert.strictEqual(res.body.status, true);
    assert(res.body.data.accessToken, "accessToken returned");
    assert.strictEqual(res.body.data.user.id, "guest");
    assert.strictEqual(res.body.data.user.role, "guest");
    assert.strictEqual(res.body.data.user.isGuest, true);
  });

  await test("unauthenticated user can browse one-time menu and subscription plans", async () => {
    const menuRes = await api.get("/api/orders/menu");
    expectStatus(menuRes, 200, "public one-time menu");
    assert.strictEqual(menuRes.body.status, true);

    const plansRes = await api.get("/api/plans");
    expectStatus(plansRes, 200, "public plans");
    assert.strictEqual(plansRes.body.status, true);
    assert.strictEqual(plansRes.body.data.length, 1);
  });

  await test("guest can browse one-time menu and subscription plan detail", async () => {
    const menuRes = await api.get("/api/orders/menu").set(authHeader(guestToken));
    expectStatus(menuRes, 200, "guest one-time menu");
    assert.strictEqual(menuRes.body.status, true);

    const planRes = await api.get(`/api/plans/${plan._id}`).set(authHeader(guestToken));
    expectStatus(planRes, 200, "guest plan detail");
    assert.strictEqual(planRes.body.status, true);
    assert.strictEqual(planRes.body.data.id, String(plan._id));
  });

  await test("guest cannot access client profile or account operations", async () => {
    const meRes = await api.get("/api/auth/me").set(authHeader(guestToken));
    expectStatus(meRes, 403, "guest me");
    expectErrorCode(meRes, "GUEST_ACCESS_NOT_ALLOWED", "guest me");

    const profileRes = await api.put("/api/app/profile").set(authHeader(guestToken)).send({ fullName: "Guest" });
    expectStatus(profileRes, 403, "guest update profile");
    expectErrorCode(profileRes, "GUEST_ACCESS_NOT_ALLOWED", "guest update profile");

    const deletionRes = await api
      .post("/api/app/account-deletion/request")
      .set(authHeader(guestToken))
      .send({ email: "guest@example.com", confirmation: true });
    expectStatus(deletionRes, 403, "guest account deletion");
    expectErrorCode(deletionRes, "GUEST_ACCESS_NOT_ALLOWED", "guest account deletion");
  });

  await test("guest cannot order, checkout, create subscription, save planner, confirm planner, or pay", async () => {
    const restricted = [
      api.post("/api/orders/quote").set(authHeader(guestToken)).send({ items: [] }),
      api.post("/api/orders").set(authHeader(guestToken)).send({ items: [] }),
      api.post("/api/orders/checkout").set(authHeader(guestToken)).send({ items: [] }),
      api.post("/api/subscriptions/quote").set(authHeader(guestToken)).send({ planId: String(plan._id) }),
      api.post("/api/subscriptions/checkout").set(authHeader(guestToken)).send({ planId: String(plan._id) }),
      api.put(`/api/subscriptions/${new mongoose.Types.ObjectId()}/days/2026-06-07/selection`).set(authHeader(guestToken)).send({ mealSlots: [] }),
      api.post(`/api/subscriptions/${new mongoose.Types.ObjectId()}/days/2026-06-07/confirm`).set(authHeader(guestToken)).send({}),
      api.post(`/api/subscriptions/${new mongoose.Types.ObjectId()}/days/2026-06-07/payments`).set(authHeader(guestToken)).send({}),
    ];

    const responses = await Promise.all(restricted);
    responses.forEach((res, index) => {
      expectStatus(res, 403, `restricted guest request ${index}`);
      expectErrorCode(res, "GUEST_ACCESS_NOT_ALLOWED", `restricted guest request ${index}`);
    });
  });

  await test("guest cannot access dashboard, courier, kitchen, pickup, or admin endpoints", async () => {
    const restricted = [
      api.get("/api/dashboard/menu/categories").set(authHeader(guestToken)),
      api.get("/api/courier/orders").set(authHeader(guestToken)),
      api.get("/api/kitchen/orders").set(authHeader(guestToken)),
      api.get("/api/app/today-pickup").set(authHeader(guestToken)),
      api.get("/api/admin/users").set(authHeader(guestToken)),
    ];

    const responses = await Promise.all(restricted);
    responses.forEach((res, index) => {
      assert([401, 403, 404].includes(res.status), `restricted ops request ${index}: ${res.status} ${JSON.stringify(res.body)}`);
      assert.notStrictEqual(res.status, 200, `restricted ops request ${index} must not succeed`);
    });
  });

  await test("real client token still works for client endpoints", async () => {
    const meRes = await api.get("/api/auth/me").set(authHeader(client.token));
    expectStatus(meRes, 200, "real client me");
    assert.strictEqual(meRes.body.ok, true);
    assert.strictEqual(meRes.body.user.id, String(client.user._id));

    const profileRes = await api.get("/api/app/profile").set(authHeader(client.token));
    expectStatus(profileRes, 200, "real client app profile");
    assert.strictEqual(profileRes.body.status, true);
  });

  await test("dashboard token still works for dashboard endpoints", async () => {
    const res = await api.get("/api/dashboard/menu/categories").set(authHeader(dashboard.token));
    expectStatus(res, 200, "dashboard categories");
    assert.strictEqual(res.body.status, true);
  });
}

run()
  .catch((err) => {
    results.failed += 1;
    console.error(err && err.stack ? err.stack : err);
  })
  .finally(async () => {
    await stopMongo();
    console.log(`guestAccess: ${results.passed} passed, ${results.failed} failed`);
    if (results.failed > 0) {
      process.exitCode = 1;
    }
  });
