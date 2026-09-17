"use strict";

require("./helpers/installMongoTestSafetyGuard");

require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const { ORDER_STATUSES } = require("../src/utils/orderState");

const TEST_TAG = `idempotency-test-${Date.now()}`;
const MOYASAR_WEBHOOK_SECRET = process.env.MOYASAR_WEBHOOK_SECRET || "test_secret";

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/basicdiet_test";
  await mongoose.connect(mongoUri);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map(u => u._id);
  await Promise.all([
    User.deleteMany({ _id: { $in: userIds } }),
    Order.deleteMany({ userId: { $in: userIds } }),
    Payment.deleteMany({ userId: { $in: userIds } }),
    ActivityLog.deleteMany({ byUserId: { $in: userIds } }),
    ActivityLog.deleteMany({ "meta.orderId": { $exists: true }, "meta.source": "webhook" }) // Cleanup webhook logs
  ]);
}

async function seedData({ orderStatus = "pending_payment", paymentStatus = "initiated" } = {}) {
  const user = await User.create({
    phone: `${TEST_TAG}-${Math.random()}`,
    name: "Test User",
    role: "client",
    isActive: true
  });

  const order = await Order.create({
    orderNumber: `ORD-${TEST_TAG}-${Math.random()}`,
    userId: user._id,
    status: orderStatus,
    paymentStatus: paymentStatus,
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-05-10",
    pricing: { totalHalala: 2500 }
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "one_time_order",
    status: paymentStatus,
    amount: 2500,
    currency: "SAR",
    userId: user._id,
    orderId: order._id,
    providerInvoiceId: `inv_${TEST_TAG}_${Math.random()}`,
    applied: paymentStatus === "paid"
  });

  order.paymentId = payment._id;
  order.providerInvoiceId = payment.providerInvoiceId;
  await order.save();

  return { user, order, payment };
}

function buildWebhookPayload({ order, payment, type = "invoice.paid", status = "paid" }) {
  return {
    secret_token: MOYASAR_WEBHOOK_SECRET,
    type: type,
    data: {
      id: order.providerInvoiceId,
      status: status,
      amount: 2500,
      currency: "SAR",
      payments: [
        {
          id: `pay_${TEST_TAG}_${Math.random()}`,
          status: status,
          amount: 2500,
          currency: "SAR"
        }
      ],
      metadata: {
        source: "one_time_order",
        type: "one_time_order",
        orderId: String(order._id),
        paymentId: String(payment._id)
      }
    }
  };
}

const results = { passed: 0, failed: 0 };
async function it(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    results.passed++;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    results.failed++;
  }
}

(async function run() {
  process.env.MOYASAR_WEBHOOK_SECRET = MOYASAR_WEBHOOK_SECRET;
  await connect();
  const app = createApp();
  const api = request(app);

  console.log("Running Order Payment Idempotency Tests...");

  await it("1. Paid webhook for expired order does not confirm order", async () => {
    const { order, payment } = await seedData({ orderStatus: "expired", paymentStatus: "expired" });
    const payload = buildWebhookPayload({ order, payment });

    const res = await api.post("/api/webhooks/moyasar").send(payload);
    assert.strictEqual(res.status, 200);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "expired");
    assert.strictEqual(updatedOrder.paymentStatus, "paid");
  });

  await it("2. Paid webhook for cancelled order does not confirm order", async () => {
    const { order, payment } = await seedData({ orderStatus: "cancelled", paymentStatus: "canceled" });
    const payload = buildWebhookPayload({ order, payment });

    const res = await api.post("/api/webhooks/moyasar").send(payload);
    assert.strictEqual(res.status, 200);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "cancelled");
    assert.strictEqual(updatedOrder.paymentStatus, "paid");
  });

  await it("3. Paid webhook for non-payable order marks payment paid/applied and leaves order.status unchanged", async () => {
    const { order, payment } = await seedData({ orderStatus: "expired", paymentStatus: "expired" });
    const payload = buildWebhookPayload({ order, payment });

    await api.post("/api/webhooks/moyasar").send(payload);

    const updatedPayment = await Payment.findById(payment._id);
    assert.strictEqual(updatedPayment.status, "paid");
    assert.strictEqual(updatedPayment.applied, true);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "expired");
  });

  await it("4. Late paid webhook writes exactly one order_webhook_late_payment ActivityLog", async () => {
    const { order, payment } = await seedData({ orderStatus: "expired", paymentStatus: "expired" });
    const payload = buildWebhookPayload({ order, payment });

    await api.post("/api/webhooks/moyasar").send(payload);

    const logs = await ActivityLog.find({
      entityId: order._id,
      action: "order_webhook_late_payment"
    });
    assert.strictEqual(logs.length, 1);
    const meta = logs[0].meta;
    assert.strictEqual(meta.reason, "paid_webhook_for_non_payable_order");
    assert.strictEqual(meta.requiresManualReview, true);
    assert.strictEqual(meta.previousOrderStatus, "expired");
  });

  await it("5. Repeated late paid webhook is idempotent and does not duplicate logs", async () => {
    const { order, payment } = await seedData({ orderStatus: "expired", paymentStatus: "expired" });
    const payload = buildWebhookPayload({ order, payment });

    await api.post("/api/webhooks/moyasar").send(payload);
    await api.post("/api/webhooks/moyasar").send(payload);

    const logs = await ActivityLog.find({
      entityId: order._id,
      action: "order_webhook_late_payment"
    });
    assert.strictEqual(logs.length, 1);
  });

  await it("6. Manual verify for expired/cancelled order still rejects", async () => {
    const { user, order, payment } = await seedData({ orderStatus: "expired", paymentStatus: "expired" });
    const token = require("jsonwebtoken").sign({ userId: String(user._id), role: "client", tokenType: "app_access" }, process.env.JWT_SECRET || "supersecret");

    const res = await api.post(`/api/orders/${order._id}/verify-payment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ providerInvoiceId: order.providerInvoiceId });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, "ORDER_NOT_PAYABLE");
  });

  await it("7. Normal paid webhook for pending_payment order still confirms", async () => {
    const { order, payment } = await seedData({ orderStatus: "pending_payment", paymentStatus: "initiated" });
    const payload = buildWebhookPayload({ order, payment });

    const res = await api.post("/api/webhooks/moyasar").send(payload);
    assert.strictEqual(res.status, 200);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "confirmed");
    assert.strictEqual(updatedOrder.paymentStatus, "paid");
  });

  await it("8. Paid webhook after already confirmed remains idempotent", async () => {
    const { order, payment } = await seedData({ orderStatus: "confirmed", paymentStatus: "paid" });
    const payload = buildWebhookPayload({ order, payment });

    const res = await api.post("/api/webhooks/moyasar").send(payload);
    assert.strictEqual(res.status, 200);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "confirmed");
  });

  await it("9. Failed webhook after confirmed does not downgrade", async () => {
    const { order, payment } = await seedData({ orderStatus: "confirmed", paymentStatus: "paid" });
    const payload = buildWebhookPayload({ order, payment, type: "invoice.failed", status: "failed" });

    const res = await api.post("/api/webhooks/moyasar").send(payload);
    assert.strictEqual(res.status, 200);

    const updatedOrder = await Order.findById(order._id);
    assert.strictEqual(updatedOrder.status, "confirmed");
    assert.strictEqual(updatedOrder.paymentStatus, "paid");
  });

  await it("10. Concurrent verify + paid webhook results in one payment claim and one confirmation log", async () => {
    const { user, order, payment } = await seedData({ orderStatus: "pending_payment", paymentStatus: "initiated" });
    const token = require("jsonwebtoken").sign({ userId: String(user._id), role: "client", tokenType: "app_access" }, process.env.JWT_SECRET || "supersecret");
    const providerPaymentId = `pay_concurrent_${TEST_TAG}`;
    const payload = buildWebhookPayload({ order, payment });
    payload.data.payments[0].id = providerPaymentId;

    // Mock moyasarService.getInvoice to return a paid invoice
    const moyasarService = require("../src/services/moyasarService");
    const originalGetInvoice = moyasarService.getInvoice;
    moyasarService.getInvoice = async () => ({
      id: order.providerInvoiceId,
      status: "paid",
      amount: 2500,
      currency: "SAR",
      payments: [{ id: providerPaymentId, status: "paid", amount: 2500, currency: "SAR" }]
    });

    try {
      const results = await Promise.all([
        api.post(`/api/orders/${order._id}/verify-payment`).set("Authorization", `Bearer ${token}`).send({ providerInvoiceId: order.providerInvoiceId }),
        api.post("/api/webhooks/moyasar").send(payload)
      ]);

      assert.strictEqual(results[0].status, 200);
      assert.strictEqual(results[1].status, 200);

      const logs = await ActivityLog.find({
        entityId: order._id,
        action: { $in: ["order_payment_confirmed", "order_webhook_confirmed"] }
      });
      assert.strictEqual(logs.length, 1, `Expected 1 confirmation log, got ${logs.length}`);

      const paymentDoc = await Payment.findById(payment._id);
      assert.strictEqual(paymentDoc.applied, true);
    } finally {
      moyasarService.getInvoice = originalGetInvoice;
    }
  });

  console.log(`\nTests finished: ${results.passed} passed, ${results.failed} failed`);
  await cleanup();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(results.failed > 0 ? 1 : 0);
})();
