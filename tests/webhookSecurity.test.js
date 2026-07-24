"use strict";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");

const TEST_TAG = `webhook-security-${Date.now()}`;
const VALID_WEBHOOK_SECRET = `${TEST_TAG}-secret`;
const VALID_IP = "192.168.1.100";
const INVALID_IP = "192.168.1.200";

const results = { passed: 0, failed: 0 };
let ownedMemoryServer = null;

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

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  let mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
  if (!mongoUri && process.env.NODE_ENV === "test") {
    const dbName = `webhook_security_${process.pid}_${Date.now()}_test`;
    ownedMemoryServer = await MongoMemoryServer.create({
      instance: { dbName },
    });
    mongoUri = ownedMemoryServer.getUri(dbName);
  }
  if (!mongoUri) mongoUri = "mongodb://localhost:27017/basicdiet_test";
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    console.error("Database connection failed with exact error:");
    console.error(err && err.stack ? err.stack : err);
    throw err;
  }
}

async function cleanup() {
  if (mongoose.connection.readyState !== 1) return;
  const orders = await Order.find({ orderNumber: { $regex: TEST_TAG } }).select("_id paymentId").lean();
  const orderIds = orders.map((order) => order._id);
  const paymentIds = orders.map((order) => order.paymentId).filter(Boolean);
  const payments = await Payment.find({
    $or: [
      { _id: { $in: paymentIds } },
      { providerInvoiceId: { $regex: TEST_TAG } },
      { providerPaymentId: { $regex: TEST_TAG } },
    ],
  }).select("_id orderId").lean();
  const allPaymentIds = payments.map((payment) => payment._id);
  const allOrderIds = [...orderIds, ...payments.map((payment) => payment.orderId).filter(Boolean)];

  await Promise.all([
    ActivityLog.deleteMany({ entityId: { $in: allOrderIds } }),
    Payment.deleteMany({ _id: { $in: allPaymentIds } }),
    Order.deleteMany({ _id: { $in: allOrderIds } }),
  ]);
}

function benignPayload(secret = VALID_WEBHOOK_SECRET) {
  return {
    secret_token: secret,
    type: "moyasar.test_event",
  };
}

async function seedPendingOneTimeOrder() {
  const userId = new mongoose.Types.ObjectId();
  const invoiceId = `inv_${TEST_TAG}_${new mongoose.Types.ObjectId().toString()}`;
  const order = await Order.create({
    orderNumber: `${TEST_TAG}-${Date.now()}`,
    userId,
    status: "pending_payment",
    paymentStatus: "initiated",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-05-07",
    pickup: {
      branchId: "main",
      pickupWindow: "18:00-20:00",
    },
    items: [
      {
        itemType: "sandwich",
        name: { ar: "", en: `${TEST_TAG} Sandwich` },
        qty: 1,
        unitPriceHalala: 2500,
        lineTotalHalala: 2500,
        selections: { sandwichId: new mongoose.Types.ObjectId() },
      },
    ],
    pricing: {
      subtotalHalala: 2500,
      deliveryFeeHalala: 0,
      discountHalala: 0,
      totalHalala: 2500,
      vatPercentage: 16,
      vatHalala: 345,
      vatIncluded: true,
      currency: "SAR",
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "one_time_order",
    status: "initiated",
    amount: 2500,
    currency: "SAR",
    userId,
    orderId: order._id,
    providerInvoiceId: invoiceId,
    metadata: {
      source: "one_time_order",
      type: "one_time_order",
      orderId: String(order._id),
    },
  });
  order.paymentId = payment._id;
  order.providerInvoiceId = invoiceId;
  await order.save();
  return { order, payment, invoiceId };
}

function paidWebhookPayload({ order, payment, invoiceId }) {
  return {
    secret_token: VALID_WEBHOOK_SECRET,
    type: "invoice.paid",
    data: {
      id: invoiceId,
      status: "paid",
      amount: 2500,
      currency: "SAR",
      payments: [
        {
          id: `pay_${TEST_TAG}_${payment._id}`,
          status: "paid",
          amount: 2500,
          currency: "SAR",
        },
      ],
      metadata: {
        source: "one_time_order",
        type: "one_time_order",
        orderId: String(order._id),
        paymentId: String(payment._id),
      },
    },
  };
}

function setWebhookEnv({ secret = VALID_WEBHOOK_SECRET, allowedIps } = {}) {
  process.env.MOYASAR_WEBHOOK_SECRET = secret;
  if (allowedIps === undefined) delete process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;
  else process.env.MOYASAR_WEBHOOK_ALLOWED_IPS = allowedIps;
}

(async function run() {
  const originalSecret = process.env.MOYASAR_WEBHOOK_SECRET;
  const originalAllowedIps = process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;
  const originalTrustProxy = process.env.TRUST_PROXY;

  try {
    process.env.TRUST_PROXY = "true";
    await connect();
    await cleanup();
    const api = request(createApp());

    await test("invalid secret rejected", async () => {
      setWebhookEnv({ secret: VALID_WEBHOOK_SECRET });
      const res = await api.post("/api/webhooks/moyasar").send(benignPayload("invalid-secret"));
      assert.strictEqual(res.status, 401, `expected 401, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    });

    await test("valid secret accepted when whitelist is not configured", async () => {
      setWebhookEnv({ secret: VALID_WEBHOOK_SECRET });
      const res = await api.post("/api/webhooks/moyasar").set("X-Forwarded-For", INVALID_IP).send(benignPayload());
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.notStrictEqual(res.body && res.body.error && res.body.error.code, "UNAUTHORIZED");
    });

    await test("invalid IP rejected only when whitelist configured", async () => {
      setWebhookEnv({ secret: VALID_WEBHOOK_SECRET, allowedIps: VALID_IP });
      const res = await api.post("/api/webhooks/moyasar").set("X-Forwarded-For", INVALID_IP).send(benignPayload());
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    await test("valid IP accepted when whitelist configured", async () => {
      setWebhookEnv({ secret: VALID_WEBHOOK_SECRET, allowedIps: VALID_IP });
      const res = await api.post("/api/webhooks/moyasar").set("X-Forwarded-For", VALID_IP).send(benignPayload());
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.notStrictEqual(res.body && res.body.error && res.body.error.code, "FORBIDDEN");
    });

    await test("duplicate webhook idempotent", async () => {
      setWebhookEnv({ secret: VALID_WEBHOOK_SECRET });
      const seeded = await seedPendingOneTimeOrder();
      const payload = paidWebhookPayload(seeded);

      const first = await api.post("/api/webhooks/moyasar").send(payload);
      const second = await api.post("/api/webhooks/moyasar").send(payload);
      assert.strictEqual(first.status, 200, `first expected 200, got ${first.status} ${JSON.stringify(first.body)}`);
      assert.strictEqual(second.status, 200, `second expected 200, got ${second.status} ${JSON.stringify(second.body)}`);

      const [order, payment, activityLogs] = await Promise.all([
        Order.findById(seeded.order._id).lean(),
        Payment.findById(seeded.payment._id).lean(),
        ActivityLog.find({
          entityType: "order",
          entityId: seeded.order._id,
          action: "order_webhook_confirmed",
          "meta.paymentId": String(seeded.payment._id),
        }).lean(),
      ]);

      assert.strictEqual(order.status, "confirmed");
      assert.strictEqual(order.paymentStatus, "paid");
      assert.strictEqual(payment.status, "paid");
      assert.strictEqual(payment.applied, true);
      assert.strictEqual(activityLogs.length, 1, `expected one webhook confirmation log, got ${activityLogs.length}`);
    });
  } finally {
    if (originalSecret === undefined) delete process.env.MOYASAR_WEBHOOK_SECRET;
    else process.env.MOYASAR_WEBHOOK_SECRET = originalSecret;
    if (originalAllowedIps === undefined) delete process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;
    else process.env.MOYASAR_WEBHOOK_ALLOWED_IPS = originalAllowedIps;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (ownedMemoryServer) {
      await ownedMemoryServer.stop();
      ownedMemoryServer = null;
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }
  if (ownedMemoryServer) {
    await ownedMemoryServer.stop().catch(() => {});
  }
  process.exit(1);
});