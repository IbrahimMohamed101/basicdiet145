require("dotenv").config();

const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const { createApp } = require("../src/app");
const subscriptionController = require("../src/controllers/subscriptionController");
const { applyPaymentSideEffects } = require("../src/services/paymentApplicationService");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Addon = require("../src/models/Addon");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const { ensureSafeForDestructiveOp } = require("../src/utils/dbSafety");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const BASE_URL = "http://localhost:3000";

let app = null;
let server = null;
let ownerUser = null;
let otherUser = null;
let ownerToken = null;
let otherToken = null;
let plan = null;
let addon = null;
let ownerSubscription = null;
let otherSubscription = null;

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || "Assertion failed");
  }
}

function buildDateOffset(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split("T")[0];
}

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function buildMockReq({
  userId,
  params = {},
  body = {},
  headers = {},
} = {}) {
  return {
    userId: String(userId),
    params,
    body,
    headers: {
      "accept-language": "en",
      ...headers,
    },
  };
}

function invokeController(handler, req, runtimeOverrides = null) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      req,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };

    Promise.resolve(handler(req, res, runtimeOverrides)).catch(reject);
  });
}

async function makeRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en",
        Authorization: `Bearer ${token}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }
  await mongoose.connect(mongoUri);
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

async function startServer() {
  await new Promise((resolve, reject) => {
    app = createApp();
    server = http.createServer(app);
    server.listen(3000, resolve);
    server.on("error", reject);
  });
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

async function createFixtures() {
  ownerUser = await User.create({
    phone: `+9665000${Date.now()}1`,
    name: "Alias Owner",
    role: "client",
    isActive: true,
  });
  otherUser = await User.create({
    phone: `+9665000${Date.now()}2`,
    name: "Alias Other",
    role: "client",
    isActive: true,
  });
  ownerToken = issueAppAccessToken(ownerUser._id);
  otherToken = issueAppAccessToken(otherUser._id);

  plan = await Plan.create({
    name: { ar: "خطة", en: "Alias Test Plan" },
    description: { ar: "خطة", en: "Alias Test Plan" },
    daysCount: 28,
    currency: "SAR",
    gramsOptions: [
      {
        grams: 250,
        isActive: true,
        mealsOptions: [
          {
            mealsPerDay: 2,
            priceHalala: 49000,
            compareAtHalala: 49000,
            isActive: true,
          },
        ],
      },
    ],
    isActive: true,
  });

  addon = await Addon.create({
    name: { ar: "عصير", en: "Alias Juice" },
    description: { ar: "عصير", en: "Alias Juice" },
    category: "juice",
    kind: "item",
    billingMode: "flat_once",
    priceHalala: 1100,
    isActive: true,
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endDate = new Date(tomorrow);
  endDate.setDate(endDate.getDate() + 28);

  ownerSubscription = await Subscription.create({
    userId: ownerUser._id,
    planId: plan._id,
    status: "active",
    startDate: tomorrow,
    endDate,
    totalMeals: 56,
    remainingMeals: 56,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
  });

  otherSubscription = await Subscription.create({
    userId: otherUser._id,
    planId: plan._id,
    status: "active",
    startDate: tomorrow,
    endDate,
    totalMeals: 56,
    remainingMeals: 56,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
  });
}

async function cleanupFixtures() {
  ensureSafeForDestructiveOp("cleanupFixtures (wipe all test data)");
  await Promise.all([
    Payment.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    Subscription.deleteMany({}),
    Addon.deleteMany({}),
    Plan.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function seedPendingDayAndPayment({
  subscription,
  user,
  date,
  paymentStatus = "initiated",
  applied = false,
  providerInvoiceId = "inv_alias_verify",
} = {}) {
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "open",
    addonSelections: [
      {
        addonId: addon._id,
        name: "Alias Juice",
        category: "juice",
        source: paymentStatus === "paid" && applied ? "paid" : "pending_payment",
        priceHalala: 1100,
        currency: "SAR",
      },
    ],
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "one_time_addon_day_planning",
    status: paymentStatus,
    amount: 1100,
    currency: "SAR",
    userId: user._id,
    subscriptionId: subscription._id,
    providerInvoiceId,
    applied,
    paidAt: paymentStatus === "paid" ? new Date() : undefined,
    metadata: {
      subscriptionId: String(subscription._id),
      userId: String(user._id),
      dayId: String(day._id),
      date,
      oneTimeAddonSelections: [
        {
          addonId: String(addon._id),
          name: "Alias Juice",
          category: "juice",
          unitPriceHalala: 1100,
          currency: "SAR",
        },
      ],
      paymentUrl: "https://example.com/pay",
    },
  });

  if (paymentStatus === "paid" && applied) {
    day.addonSelections[0].paymentId = payment._id;
    await day.save();
  }

  return { day, payment };
}

async function runTests() {
  const results = { passed: 0, failed: 0 };

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed += 1;
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      results.failed += 1;
    }
  }

  const VERIFY_DATE = buildDateOffset(5);
  const NO_PAYMENT_DATE = buildDateOffset(7);
  const MISSING_DAY_DATE = buildDateOffset(9);

  await test("alias verify marks pending one-time add-ons paid and keeps item price", async () => {
    const { payment } = await seedPendingDayAndPayment({
      subscription: ownerSubscription,
      user: ownerUser,
      date: VERIFY_DATE,
    });

    const req = buildMockReq({
      userId: ownerUser._id,
      params: {
        id: String(ownerSubscription._id),
        date: VERIFY_DATE,
      },
    });

    const invoice = {
      id: payment.providerInvoiceId,
      status: "paid",
      amount: 1100,
      currency: "SAR",
      payments: [
        {
          id: "pay_alias_verify",
          status: "paid",
          amount: 1100,
          currency: "SAR",
        },
      ],
    };

    const res = await invokeController(
      subscriptionController.verifyOneTimeAddonDayPlanningPayment,
      req,
      {
        getInvoice: async () => invoice,
        startSession: () => mongoose.startSession(),
        applyPaymentSideEffects,
      }
    );

    assertEqual(res.status, 200, "verify status");
    assertEqual(res.body.status, true, "verify response envelope");
    assertEqual(res.body.data.paymentStatus, "paid", "payment status");
    assertEqual(res.body.data.pendingCount, 0, "pending count");

    const refreshedDay = await SubscriptionDay.findOne({
      subscriptionId: ownerSubscription._id,
      date: VERIFY_DATE,
    }).lean();
    const selection = refreshedDay.addonSelections[0];
    assertEqual(selection.source, "paid", "selection source updated");
    assertEqual(Number(selection.priceHalala), 1100, "selection price preserved");
    assertEqual(String(selection.paymentId), String(payment._id), "selection linked to payment");
  });

  await test("alias verify is idempotent and does not double-apply payment", async () => {
    const paymentBefore = await Payment.findOne({
      subscriptionId: ownerSubscription._id,
      type: "one_time_addon_day_planning",
      "metadata.date": VERIFY_DATE,
    }).lean();

    const req = buildMockReq({
      userId: ownerUser._id,
      params: {
        id: String(ownerSubscription._id),
        date: VERIFY_DATE,
      },
    });

    const res = await invokeController(
      subscriptionController.verifyOneTimeAddonDayPlanningPayment,
      req,
      {
        getInvoice: async () => {
          throw new Error("getInvoice should not be called for already applied payment");
        },
        startSession: () => mongoose.startSession(),
        applyPaymentSideEffects,
      }
    );

    assertEqual(res.status, 200, "repeat verify status");
    assertEqual(res.body.status, true, "repeat response envelope");
    assertEqual(res.body.data.paymentId, String(paymentBefore._id), "same payment returned");
    assertEqual(res.body.data.paymentStatus, "paid", "payment still paid");
    assertEqual(res.body.data.pendingCount, 0, "pending count still zero");

    const payments = await Payment.countDocuments({
      subscriptionId: ownerSubscription._id,
      type: "one_time_addon_day_planning",
      "metadata.date": VERIFY_DATE,
    });
    assertEqual(payments, 1, "payment count unchanged");
  });

  await test("alias verify returns 403 for non-owner", async () => {
    const req = buildMockReq({
      userId: otherUser._id,
      params: {
        id: String(ownerSubscription._id),
        date: VERIFY_DATE,
      },
    });

    const res = await invokeController(
      subscriptionController.verifyOneTimeAddonDayPlanningPayment,
      req,
      {
        getInvoice: async () => {
          throw new Error("should not reach provider");
        },
      }
    );

    assertEqual(res.status, 403, "non-owner status");
    assertEqual(res.body.error.code, "FORBIDDEN", "non-owner code");
  });

  await test("alias verify returns 404 for nonexistent day", async () => {
    const req = buildMockReq({
      userId: ownerUser._id,
      params: {
        id: String(ownerSubscription._id),
        date: MISSING_DAY_DATE,
      },
    });

    const res = await invokeController(
      subscriptionController.verifyOneTimeAddonDayPlanningPayment,
      req,
      {
        getInvoice: async () => {
          throw new Error("should not reach provider");
        },
      }
    );

    assertEqual(res.status, 404, "missing day status");
    assertEqual(res.body.error.code, "NOT_FOUND", "missing day code");
  });

  await test("alias verify returns 404 when no matching payment exists for the day", async () => {
    await SubscriptionDay.create({
      subscriptionId: ownerSubscription._id,
      date: NO_PAYMENT_DATE,
      status: "open",
      addonSelections: [
        {
          addonId: addon._id,
          name: "Alias Juice",
          category: "juice",
          source: "pending_payment",
          priceHalala: 1100,
          currency: "SAR",
        },
      ],
    });

    const req = buildMockReq({
      userId: ownerUser._id,
      params: {
        id: String(ownerSubscription._id),
        date: NO_PAYMENT_DATE,
      },
    });

    const res = await invokeController(
      subscriptionController.verifyOneTimeAddonDayPlanningPayment,
      req,
      {
        getInvoice: async () => {
          throw new Error("should not reach provider");
        },
      }
    );

    assertEqual(res.status, 404, "no payment status");
    assertEqual(res.body.error.code, "NOT_FOUND", "no payment code");
  });

  await test("route-level alias path returns 200 instead of 404", async () => {
    const res = await makeRequest(
      "POST",
      `/api/subscriptions/${ownerSubscription._id}/days/${VERIFY_DATE}/one-time-addons/payments/verify`,
      ownerToken
    );

    assertEqual(res.status, 200, "alias route status");
    assertEqual(res.body.status, true, "alias route envelope");
    assertEqual(res.body.data.paymentStatus, "paid", "alias route payment status");
  });

  await test("route-level explicit verify path still returns 200", async () => {
    const payment = await Payment.findOne({
      subscriptionId: ownerSubscription._id,
      type: "one_time_addon_day_planning",
      "metadata.date": VERIFY_DATE,
    }).lean();

    const res = await makeRequest(
      "POST",
      `/api/subscriptions/${ownerSubscription._id}/days/${VERIFY_DATE}/one-time-addons/payments/${payment._id}/verify`,
      ownerToken
    );

    assertEqual(res.status, 200, "explicit route status");
    assertEqual(res.body.status, true, "explicit route envelope");
    assertEqual(res.body.data.paymentId, String(payment._id), "explicit route payment id");
  });

  await test("route-level alias path does not leak another user's subscription", async () => {
    const res = await makeRequest(
      "POST",
      `/api/subscriptions/${ownerSubscription._id}/days/${VERIFY_DATE}/one-time-addons/payments/verify`,
      otherToken
    );

    assertEqual(res.status, 403, "route non-owner status");
    assertEqual(res.body.error.code, "FORBIDDEN", "route non-owner code");
  });

  return results;
}

async function main() {
  try {
    await connectDatabase();
    await cleanupFixtures();
    await createFixtures();
    await startServer();

    const results = await runTests();

    await stopServer();
    await cleanupFixtures();
    await disconnectDatabase();

    console.log(`\nRESULTS: ${results.passed} passed, ${results.failed} failed`);
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error("Test runner failed:", err);
    await stopServer();
    await cleanupFixtures().catch(() => {});
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}

main();
