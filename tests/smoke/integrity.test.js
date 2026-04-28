/**
 * Integrity & Response Contract Smoke Tests
 *
 * Verifies:
 * - Unified API response envelope (status: true)
 * - Plan viability filtering
 * - Health check authorization
 * - Admin write-path integrity enforcement
 *
 * Run with: npm run smoke:integrity
 */

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const http = require("http");

const { createApp } = require("../../src/app");
const User = require("../../src/models/User");
const Plan = require("../../src/models/Plan");
const DashboardUser = require("../../src/models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
const BASE_URL = "http://localhost:3000";

const TEST_USER_PHONE = "+966501234888";
const TEST_DASHBOARD_EMAIL = "integrity-admin@example.com";
const PLAN_NAMES = [
  "Integrity Viable Plan",
  "Integrity Non-Viable Plan",
  "Integrity Zero Price Plan",
  "Integrity Activation Missing Meals Plan",
  "Integrity Activation Zero Price Plan",
  "Integrity Toggle Grams Plan",
  "Integrity Toggle Meals Plan",
  "Integrity Delete Grams Plan",
  "Integrity Delete Meals Plan",
];

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function issueDashboardAccessToken(userId, role = "admin") {
  return jwt.sign(
    { userId: String(userId), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

let server = null;
let app = null;
let testUser = null;
let dashboardUser = null;
let appAuthToken = null;
let dashboardAuthToken = null;

const planRefs = {
  viablePlan: null,
  nonViablePlan: null,
  zeroPricePlan: null,
  activationMissingMealsPlan: null,
  activationZeroPricePlan: null,
  toggleGramsPlan: null,
  toggleMealsPlan: null,
  deleteGramsPlan: null,
  deleteMealsPlan: null,
};

async function makeRequest(method, path, body = null, { token = appAuthToken } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (_err) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(actual, msg) {
  if (actual !== true) {
    throw new Error(`${msg || "Assertion failed"}: expected true, got ${actual}`);
  }
}

function assertNoTopLevelOk(body, msg) {
  if (Object.prototype.hasOwnProperty.call(body || {}, "ok")) {
    throw new Error(`${msg || "Assertion failed"}: top-level ok must be absent`);
  }
}

async function setup() {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/basicdiet_test";
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  testUser = await User.findOne({ phone: TEST_USER_PHONE });
  if (!testUser) {
    testUser = new User({
      phone: TEST_USER_PHONE,
      name: "Integrity Test User",
      role: "client",
      isActive: true,
    });
    await testUser.save();
  }
  appAuthToken = issueAppAccessToken(testUser._id);

  dashboardUser = await DashboardUser.findOne({ email: TEST_DASHBOARD_EMAIL });
  if (!dashboardUser) {
    dashboardUser = new DashboardUser({
      email: TEST_DASHBOARD_EMAIL,
      passwordHash: "test-password-hash",
      role: "admin",
      isActive: true,
    });
    await dashboardUser.save();
  }
  dashboardAuthToken = issueDashboardAccessToken(dashboardUser._id, dashboardUser.role);

  await Plan.deleteMany({ "name.en": { $in: PLAN_NAMES } });

  planRefs.viablePlan = await Plan.create({
    name: { ar: "Integrity Viable Plan", en: "Integrity Viable Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 50000, compareAtHalala: 50000, isActive: true }],
    }],
  });

  planRefs.nonViablePlan = new Plan({
    name: { ar: "Integrity Non-Viable Plan", en: "Integrity Non-Viable Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [],
    }],
  });
  await mongoose.connection.collection("plans").insertOne(planRefs.nonViablePlan.toObject());

  planRefs.zeroPricePlan = new Plan({
    name: { ar: "Integrity Zero Price Plan", en: "Integrity Zero Price Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 350,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 0, compareAtHalala: 1000, isActive: true }],
    }],
  });
  await mongoose.connection.collection("plans").insertOne(planRefs.zeroPricePlan.toObject());

  planRefs.activationMissingMealsPlan = await Plan.create({
    name: { ar: "Integrity Activation Missing Meals Plan", en: "Integrity Activation Missing Meals Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: false,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [],
    }],
  });

  planRefs.activationZeroPricePlan = await Plan.create({
    name: { ar: "Integrity Activation Zero Price Plan", en: "Integrity Activation Zero Price Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: false,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 0, compareAtHalala: 1500, isActive: true }],
    }],
  });

  planRefs.toggleGramsPlan = await Plan.create({
    name: { ar: "Integrity Toggle Grams Plan", en: "Integrity Toggle Grams Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 50000, compareAtHalala: 50000, isActive: true }],
    }],
  });

  planRefs.toggleMealsPlan = await Plan.create({
    name: { ar: "Integrity Toggle Meals Plan", en: "Integrity Toggle Meals Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 320,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 51000, compareAtHalala: 51000, isActive: true }],
    }],
  });

  planRefs.deleteGramsPlan = await Plan.create({
    name: { ar: "Integrity Delete Grams Plan", en: "Integrity Delete Grams Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [
      {
        grams: 300,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 2, priceHalala: 52000, compareAtHalala: 52000, isActive: true }],
      },
      {
        grams: 400,
        isActive: false,
        mealsOptions: [{ mealsPerDay: 2, priceHalala: 54000, compareAtHalala: 54000, isActive: true }],
      },
    ],
  });

  planRefs.deleteMealsPlan = await Plan.create({
    name: { ar: "Integrity Delete Meals Plan", en: "Integrity Delete Meals Plan" },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 330,
      isActive: true,
      mealsOptions: [
        { mealsPerDay: 2, priceHalala: 53000, compareAtHalala: 53000, isActive: true },
        { mealsPerDay: 3, priceHalala: 56000, compareAtHalala: 56000, isActive: false },
      ],
    }],
  });

  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(3000, resolve));
}

async function teardown() {
  await Plan.deleteMany({ "name.en": { $in: PLAN_NAMES } });
  if (testUser) {
    await User.deleteOne({ _id: testUser._id });
  }
  if (dashboardUser) {
    await DashboardUser.deleteOne({ _id: dashboardUser._id });
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
}

async function runTests() {
  console.log("--- A) Canonical Client Response Envelope ---");

  const plansRes = await makeRequest("GET", "/api/plans");
  assertEqual(plansRes.status, 200, "plans status");
  assertEqual(plansRes.body.status, true, "plans status envelope");
  assertNoTopLevelOk(plansRes.body, "plans response");

  const subscriptionsRes = await makeRequest("GET", "/api/subscriptions");
  assertEqual(subscriptionsRes.status, 200, "subscriptions status");
  assertEqual(subscriptionsRes.body.status, true, "subscriptions status envelope");
  assertNoTopLevelOk(subscriptionsRes.body, "subscriptions response");
  assertTrue(Array.isArray(subscriptionsRes.body.data), "subscriptions data is array");

  const overviewRes = await makeRequest("GET", "/api/subscriptions/current/overview");
  assertEqual(overviewRes.status, 200, "overview status");
  assertEqual(overviewRes.body.status, true, "overview status envelope");
  assertNoTopLevelOk(overviewRes.body, "overview response");
  assertEqual(overviewRes.body.data, null, "overview returns null without active subscription");

  console.log("--- B) Plan Viability Filtering ---");

  const plans = plansRes.body.data || [];
  const names = plans.map((plan) => plan.name);
  assertTrue(names.includes("Integrity Viable Plan"), "viable plan present in catalog");
  assertEqual(names.includes("Integrity Non-Viable Plan"), false, "missing-meals plan filtered");
  assertEqual(names.includes("Integrity Zero Price Plan"), false, "zero-price plan filtered");
  console.log("✅ Public plans endpoint only returns viable sellable plans");

  console.log("--- C) Health Authorization & Detection ---");

  const unauthorizedCatalogRes = await makeRequest("GET", "/api/health/catalog", null, { token: null });
  assertEqual(unauthorizedCatalogRes.status, 401, "health catalog requires auth");
  assertEqual(unauthorizedCatalogRes.body.ok, false, "unauthorized catalog uses error envelope");

  const unauthorizedSubscriptionsHealthRes = await makeRequest("GET", "/api/health/subscriptions", null, { token: null });
  assertEqual(unauthorizedSubscriptionsHealthRes.status, 401, "health subscriptions requires auth");
  assertEqual(unauthorizedSubscriptionsHealthRes.body.ok, false, "unauthorized subscriptions health uses error envelope");

  const healthCatalogRes = await makeRequest("GET", "/api/health/catalog", null, { token: dashboardAuthToken });
  assertEqual(healthCatalogRes.status, 200, "authorized health catalog status");
  assertEqual(healthCatalogRes.body.status, true, "authorized health catalog status");
  assertNoTopLevelOk(healthCatalogRes.body, "authorized health catalog response");
  const anomalies = healthCatalogRes.body.data?.anomalies || [];
  assertTrue(anomalies.some((row) => row.name && row.name.en === "Integrity Non-Viable Plan"), "health detects missing meals plan");
  assertTrue(anomalies.some((row) => row.name && row.name.en === "Integrity Zero Price Plan"), "health detects zero-price plan");

  const healthSubscriptionsRes = await makeRequest("GET", "/api/health/subscriptions", null, { token: dashboardAuthToken });
  assertEqual(healthSubscriptionsRes.status, 200, "authorized health subscriptions status");
  assertEqual(healthSubscriptionsRes.body.status, true, "authorized health subscriptions status");
  assertNoTopLevelOk(healthSubscriptionsRes.body, "authorized health subscriptions response");

  console.log("--- D) Admin Write-Path Integrity Enforcement ---");

  const activateMissingMealsRes = await makeRequest(
    "PATCH",
    `/api/admin/plans/${planRefs.activationMissingMealsPlan._id}/toggle`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(activateMissingMealsRes.status, 400, "activate missing-meals plan rejected");
  assertEqual(activateMissingMealsRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "activate missing-meals code");
  const activationMissingMealsPlan = await Plan.findById(planRefs.activationMissingMealsPlan._id).lean();
  assertEqual(Boolean(activationMissingMealsPlan.isActive), false, "missing-meals plan remains inactive");

  const activateZeroPriceRes = await makeRequest(
    "PATCH",
    `/api/admin/plans/${planRefs.activationZeroPricePlan._id}/toggle`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(activateZeroPriceRes.status, 400, "activate zero-price plan rejected");
  assertEqual(activateZeroPriceRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "activate zero-price code");
  const activationZeroPricePlan = await Plan.findById(planRefs.activationZeroPricePlan._id).lean();
  assertEqual(Boolean(activationZeroPricePlan.isActive), false, "zero-price activation plan remains inactive");

  const toggleGramsRes = await makeRequest(
    "PATCH",
    `/api/admin/plans/${planRefs.toggleGramsPlan._id}/grams/300/toggle`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(toggleGramsRes.status, 400, "toggle last active grams rejected");
  assertEqual(toggleGramsRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "toggle grams code");
  const toggleGramsPlan = await Plan.findById(planRefs.toggleGramsPlan._id).lean();
  assertEqual(Boolean(toggleGramsPlan.gramsOptions[0].isActive), true, "active grams row preserved");

  const toggleMealsRes = await makeRequest(
    "PATCH",
    `/api/admin/plans/${planRefs.toggleMealsPlan._id}/grams/320/meals/2/toggle`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(toggleMealsRes.status, 400, "toggle last active meals rejected");
  assertEqual(toggleMealsRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "toggle meals code");
  const toggleMealsPlan = await Plan.findById(planRefs.toggleMealsPlan._id).lean();
  assertEqual(Boolean(toggleMealsPlan.gramsOptions[0].mealsOptions[0].isActive), true, "active meals option preserved");

  const deleteGramsRes = await makeRequest(
    "DELETE",
    `/api/admin/plans/${planRefs.deleteGramsPlan._id}/grams/300`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(deleteGramsRes.status, 400, "delete last sellable grams path rejected");
  assertEqual(deleteGramsRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "delete grams code");
  const deleteGramsPlan = await Plan.findById(planRefs.deleteGramsPlan._id).lean();
  assertEqual(deleteGramsPlan.gramsOptions.length, 2, "grams rows preserved after failed delete");

  const deleteMealsRes = await makeRequest(
    "DELETE",
    `/api/admin/plans/${planRefs.deleteMealsPlan._id}/grams/330/meals/2`,
    null,
    { token: dashboardAuthToken }
  );
  assertEqual(deleteMealsRes.status, 400, "delete last sellable meals path rejected");
  assertEqual(deleteMealsRes.body.error?.code, "INVALID_PLAN_STRUCTURE", "delete meals code");
  const deleteMealsPlan = await Plan.findById(planRefs.deleteMealsPlan._id).lean();
  assertEqual(deleteMealsPlan.gramsOptions[0].mealsOptions.length, 2, "meals options preserved after failed delete");
}

(async () => {
  try {
    await setup();
    await runTests();
    console.log("\nSUCCESS: All integrity smoke tests passed.");
    await teardown();
    process.exit(0);
  } catch (err) {
    console.error("\nFAIL: Integrity smoke tests failed:", err.message);
    await teardown();
    process.exit(1);
  }
})();
