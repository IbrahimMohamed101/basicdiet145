"use strict";

require("./helpers/installMongoTestSafetyGuard");

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const { JWT_SECRET } = require("../src/middleware/auth");

const TEST_TAG = `one-time-delivery-gate-${Date.now()}`;
const USER_PHONE = `${TEST_TAG}-+966500000001`;

const results = { passed: 0, failed: 0 };

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(token) {
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function connectDatabase() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  try {
    await mongoose.connect(mongoUri);
  } catch (err) {
    console.error("Database connection failed with exact error:");
    console.error(err && err.stack ? err.stack : err);
    throw err;
  }
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  await User.deleteMany({ _id: { $in: users.map((user) => user._id) } });
}

function deliveryPayload() {
  return {
    fulfillmentMethod: "delivery",
    delivery: {
      zoneId: String(new mongoose.Types.ObjectId()),
      deliveryWindow: "18:00-20:00",
      address: { line1: "Test Street 1", city: "Riyadh" },
    },
    items: [
      {
        itemType: "sandwich",
        qty: 1,
        selections: { sandwichId: String(new mongoose.Types.ObjectId()) },
      },
    ],
  };
}

function assertDeliveryGateResponse(res, label) {
  assert.strictEqual(res.status, 400, `${label}: expected 400, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body && res.body.error && res.body.error.code, "DELIVERY_NOT_SUPPORTED");
}

(async function run() {
  let originalDeliveryFlag;
  try {
    await connectDatabase();
    await cleanup();

    const user = await User.create({
      phone: USER_PHONE,
      name: `${TEST_TAG} User`,
      role: "client",
      isActive: true,
    });
    const token = issueAppAccessToken(user._id);
    const api = request(createApp());

    originalDeliveryFlag = process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;

    await test("POST /api/orders/quote rejects delivery after valid auth when gate disabled", async () => {
      const res = await api.post("/api/orders/quote").set(auth(token)).send(deliveryPayload());
      assertDeliveryGateResponse(res, "quote delivery gate");
    });

    await test("POST /api/orders rejects delivery after valid auth when gate disabled", async () => {
      const res = await api.post("/api/orders").set(auth(token)).send(deliveryPayload());
      assertDeliveryGateResponse(res, "create delivery gate");
    });
  } finally {
    if (originalDeliveryFlag === undefined) delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    else process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = originalDeliveryFlag;
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
