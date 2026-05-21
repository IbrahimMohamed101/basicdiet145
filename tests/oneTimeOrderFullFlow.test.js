process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.NODE_ENV = "test";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const MenuVersion = require("../src/models/MenuVersion");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Setting = require("../src/models/Setting");
const User = require("../src/models/User");
const moyasarService = require("../src/services/moyasarService");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const { JWT_SECRET } = require("../src/middleware/auth");
const { seedOneTimeMenu } = require("../scripts/seed-one-time-menu");

const TEST_TAG = `one-time-full-flow-${Date.now()}`;
const TEST_DB_NAME = TEST_TAG.replace(/-/g, "_");
const results = { passed: 0, failed: 0 };

let replSet;
let invoiceCounter = 0;
const invoicePayloads = [];
const invoiceResponses = new Map();

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

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function appAuth(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

// function dashboardAuth replaced by helper

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    category.products || []
  ).map((product) => ({ ...product, categoryKey: category.key })));
}

function findProduct(menu, key) {
  return flattenProducts(menu).find((product) => product.key === key);
}

function selectedRequiredOptions(product) {
  return (product.optionGroups || []).flatMap((group) => {
    const count = Number(group.minSelections || 0);
    if (count <= 0) return [];
    assert((group.options || []).length >= count, `${product.key}.${group.key} has enough options`);
    return group.options.slice(0, count).map((option) => ({
      groupId: group.id,
      optionId: option.id,
    }));
  });
}

async function startMemoryMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: TEST_DB_NAME,
    },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function resetDatabase() {
  await mongoose.connection.db.dropDatabase();
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

function installMoyasarMock() {
  const originalCreateInvoice = moyasarService.createInvoice;
  const originalGetInvoice = moyasarService.getInvoice;

  moyasarService.createInvoice = async (payload) => {
    invoiceCounter += 1;
    const invoice = {
      id: `inv_${TEST_TAG}_${invoiceCounter}`,
      url: `https://payments.example.test/${invoiceCounter}`,
      amount: payload.amount,
      currency: payload.currency || "SAR",
      status: "initiated",
      metadata: payload.metadata,
    };
    invoicePayloads.push(payload);
    invoiceResponses.set(invoice.id, invoice);
    return invoice;
  };

  moyasarService.getInvoice = async (invoiceId) => {
    const invoice = invoiceResponses.get(invoiceId);
    if (!invoice) {
      const err = new Error(`Mock invoice not found: ${invoiceId}`);
      err.status = 404;
      throw err;
    }
    return invoice;
  };

  return () => {
    moyasarService.createInvoice = originalCreateInvoice;
    moyasarService.getInvoice = originalGetInvoice;
    invoicePayloads.length = 0;
    invoiceResponses.clear();
  };
}

async function seedPublishedCatalog() {
  await Setting.updateOne(
    { key: "vat_percentage" },
    { $set: { value: 15, description: `${TEST_TAG} VAT` } },
    { upsert: true }
  );
  await seedOneTimeMenu({ actor: { role: "test" }, notes: TEST_TAG, mode: "force" });
}

async function cleanupCatalog() {
  await Promise.all([
    ActivityLog.deleteMany({}),
    Payment.deleteMany({}),
    Order.deleteMany({}),
    User.deleteMany({ phone: { $regex: TEST_TAG } }),
    ProductOptionGroup.deleteMany({}),
    ProductGroupOption.deleteMany({}),
    MenuVersion.deleteMany({}),
    MenuOption.deleteMany({}),
    MenuOptionGroup.deleteMany({}),
    MenuProduct.deleteMany({}),
    MenuCategory.deleteMany({}),
    Setting.deleteMany({ key: "vat_percentage" }),
  ]);
}

(async function run() {
  const restoreMoyasar = installMoyasarMock();
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://api.example.test";

  try {
    await startMemoryMongo();
    await resetDatabase();
    await cleanupCatalog();
    await seedPublishedCatalog();

    const app = createApp();
    const api = request(app);
    const user = await User.create({
      phone: `${TEST_TAG}-+966500000000`,
      name: `${TEST_TAG} Client`,
      role: "client",
      isActive: true,
    });
    const clientHeaders = appAuth(user._id);
    const { headers: adminHeaders } = await dashboardAuth("superadmin", TEST_TAG);

    await test("complete one-time pickup order lifecycle from menu to fulfillment", async () => {
      const menuRes = await api.get("/api/orders/menu?lang=en");
      expectStatus(menuRes, 200, "menu");
      assert.strictEqual(menuRes.body.status, true);
      assert.strictEqual(menuRes.body.data.fulfillmentMethod, "pickup");
      assert.strictEqual(menuRes.body.data.vatIncluded, true);
      assert.strictEqual(menuRes.body.data.delivery, undefined);
      assert(Array.isArray(menuRes.body.data.categories) && menuRes.body.data.categories.length > 0, "menu has categories");
      assert(flattenProducts(menuRes.body.data).length > 0, "menu has products");

      const water = findProduct(menuRes.body.data, "water");
      const basicSalad = findProduct(menuRes.body.data, "basic_salad");
      assert(water, "water product exists");
      assert(basicSalad, "basic_salad product exists");
      assert.strictEqual(water.pricingModel, "fixed");
      assert.strictEqual(basicSalad.pricingModel, "per_100g");

      const fulfillmentDate = "2026-05-10";
      const orderBody = {
        fulfillmentMethod: "pickup",
        fulfillmentDate,
        pickup: {
          branchId: "main",
          pickupWindow: "18:00-20:00",
        },
        items: [
          {
            productId: water.id,
            qty: 2,
            selectedOptions: [],
          },
          {
            productId: basicSalad.id,
            qty: 1,
            weightGrams: 150,
            selectedOptions: selectedRequiredOptions(basicSalad),
          },
        ],
        successUrl: "basicdiet://orders/payment-success",
        backUrl: "basicdiet://orders/payment-cancel",
      };

      const quoteRes = await api.post("/api/orders/quote").set(clientHeaders).send(orderBody);
      expectStatus(quoteRes, 200, "quote");
      assert.strictEqual(quoteRes.body.status, true);
      assert(quoteRes.body.data.pricing.totalHalala > 0, "quote total is positive");
      assert.strictEqual(quoteRes.body.data.pricing.vatIncluded, true);
      assert.strictEqual(quoteRes.body.data.pricing.deliveryFeeHalala, 0);
      assert.strictEqual(quoteRes.body.data.delivery, undefined);

      const idempotencyKey = `${TEST_TAG}-create-order`;
      const createRes = await api
        .post("/api/orders")
        .set({ ...clientHeaders, "Idempotency-Key": idempotencyKey })
        .send(orderBody);
      expectStatus(createRes, 201, "create order");
      assert.strictEqual(createRes.body.status, true);
      assert(createRes.body.data.orderId, "orderId exists");
      assert(createRes.body.data.paymentId, "paymentId exists");
      assert(createRes.body.data.paymentUrl, "paymentUrl exists");
      assert.strictEqual(createRes.body.data.status, "pending_payment");
      assert.strictEqual(createRes.body.data.pricing.vatIncluded, true);

      assert.strictEqual(invoicePayloads.length, 1, "one Moyasar invoice was created");
      assert.strictEqual(invoicePayloads[0].successUrl, "https://api.example.test/payment-success");
      assert.strictEqual(invoicePayloads[0].backUrl, "https://api.example.test/payment-cancel");
      assert.strictEqual(invoicePayloads[0].callbackUrl, "https://api.example.test/api/webhooks/moyasar");
      assert.notStrictEqual(invoicePayloads[0].successUrl.slice(0, "basicdiet://".length), "basicdiet://");
      assert.strictEqual(invoicePayloads[0].metadata.type, "one_time_order");

      const retryCreateRes = await api
        .post("/api/orders")
        .set({ ...clientHeaders, "Idempotency-Key": idempotencyKey })
        .send(orderBody);
      expectStatus(retryCreateRes, 200, "retry create");
      assert.strictEqual(retryCreateRes.body.data.reused, true);
      assert.strictEqual(retryCreateRes.body.data.orderId, createRes.body.data.orderId);
      assert.strictEqual(retryCreateRes.body.data.paymentId, createRes.body.data.paymentId);
      assert.strictEqual(invoicePayloads.length, 1, "idempotent retry did not create a second invoice");

      const createdOrder = await Order.findById(createRes.body.data.orderId).lean();
      assert(createdOrder, "created order persisted");
      assert.strictEqual(createdOrder.fulfillmentMethod, "pickup");
      assert.strictEqual(createdOrder.pickup.branchId, "main");
      assert.strictEqual(createdOrder.pickup.pickupWindow, "18:00-20:00");
      assert.strictEqual(createdOrder.delivery.zoneId, undefined);
      assert.strictEqual(createdOrder.pricing.vatIncluded, true);
      assert(createdOrder.items.every((item) => item.productSnapshot), "item product snapshots are persisted");
      assert(createdOrder.items.every((item) => item.pricingSnapshot), "item pricing snapshots are persisted");
      const originalSnapshotNames = createdOrder.items.map((item) => item.productSnapshot.name.en);

      await MenuProduct.updateOne({ _id: water.id }, { $set: { name: { en: `${TEST_TAG} Mutated Water`, ar: "ماء معدل" }, priceHalala: 999999 } });
      const snapshotAfterCatalogMutation = await Order.findById(createRes.body.data.orderId).lean();
      assert.deepStrictEqual(
        snapshotAfterCatalogMutation.items.map((item) => item.productSnapshot.name.en),
        originalSnapshotNames,
        "order item snapshots stay immutable after catalog mutation"
      );

      invoiceResponses.set(createRes.body.data.invoiceId, {
        id: createRes.body.data.invoiceId,
        status: "paid",
        amount: createRes.body.data.pricing.totalHalala,
        currency: "SAR",
        payments: [{
          id: `pay_${TEST_TAG}_manual_verify`,
          status: "paid",
          amount: createRes.body.data.pricing.totalHalala,
          currency: "SAR",
        }],
      });

      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(clientHeaders)
        .send({});
      expectStatus(verifyRes, 200, "verify payment");
      assert.strictEqual(verifyRes.body.data.orderStatus, "confirmed");
      assert.strictEqual(verifyRes.body.data.paymentStatus, "paid");
      assert.strictEqual(verifyRes.body.data.applied, true);
      assert.strictEqual(verifyRes.body.data.isFinal, true);

      let listRes = await api.get("/api/dashboard/orders").set(adminHeaders);
      expectStatus(listRes, 200, "dashboard list");
      assert(listRes.body.data.items.some((item) => item.orderId === createRes.body.data.orderId), "dashboard list includes order");

      let actionRes = await api.post(`/api/dashboard/orders/${createRes.body.data.orderId}/actions/prepare`).set(adminHeaders).send({});
      expectStatus(actionRes, 200, "prepare");
      assert.strictEqual(actionRes.body.data.status, "in_preparation");

      actionRes = await api.post(`/api/dashboard/orders/${createRes.body.data.orderId}/actions/ready_for_pickup`).set(adminHeaders).send({});
      expectStatus(actionRes, 200, "ready_for_pickup");
      assert.strictEqual(actionRes.body.data.status, "ready_for_pickup");
      assert(actionRes.body.data.pickup.pickupCode, "pickup code exists");

      actionRes = await api.post(`/api/dashboard/orders/${createRes.body.data.orderId}/actions/fulfill`).set(adminHeaders).send({});
      expectStatus(actionRes, 200, "fulfill");
      assert.strictEqual(actionRes.body.data.status, "fulfilled");

      const detailRes = await api.get(`/api/dashboard/orders/${createRes.body.data.orderId}`).set(adminHeaders);
      expectStatus(detailRes, 200, "final detail");
      assert.strictEqual(detailRes.body.data.status, "fulfilled");
      assert.strictEqual(detailRes.body.data.fulfillmentMethod, "pickup");
      assert.strictEqual(detailRes.body.data.pricing.vatIncluded, true);
      assert(Array.isArray(detailRes.body.data.items) && detailRes.body.data.items.length === 2, "final detail has items");
      assert(detailRes.body.data.pricing.totalHalala > 0, "final detail keeps pricing snapshot");
      assert.deepStrictEqual(detailRes.body.data.delivery, {}, "pickup dashboard detail has no delivery payload");

      const activityActions = new Set((detailRes.body.data.activity || []).map((entry) => entry.action));
      [
        "order_created",
        "order_payment_confirmed",
        "dashboard_order_prepare",
        "dashboard_order_ready_for_pickup",
        "dashboard_order_fulfill",
      ].forEach((action) => assert(activityActions.has(action), `activity includes ${action}`));

      const finalOrder = await Order.findById(createRes.body.data.orderId).lean();
      const finalPayment = await Payment.findById(createRes.body.data.paymentId).lean();
      assert.strictEqual(finalOrder.status, "fulfilled");
      assert.strictEqual(finalOrder.paymentStatus, "paid");
      assert(finalOrder.items.every((item) => item.productSnapshot), "persisted final order keeps item snapshots");
      assert(finalOrder.items.every((item) => item.pricingSnapshot), "persisted final order keeps pricing snapshots");
      assert.strictEqual(finalPayment.status, "paid");
      assert.strictEqual(finalPayment.applied, true);
    });
  } finally {
    restoreMoyasar();
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await disconnect();
  }

  console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exitCode = 1;
})().catch(async (err) => {
  console.error("❌ one-time order full flow test crashed");
  console.error(err && err.stack ? err.stack : err);
  await disconnect().catch(() => {});
  process.exitCode = 1;
});
