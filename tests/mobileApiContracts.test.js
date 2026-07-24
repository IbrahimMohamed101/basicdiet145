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
const { JWT_SECRET } = require("../src/middleware/auth");
const { seedOneTimeMenu } = require("../scripts/seed-one-time-menu");

const TEST_TAG = `mobile-contracts-${Date.now()}`;
const TEST_DB_NAME = TEST_TAG.replace(/-/g, "_");
const results = { passed: 0, failed: 0 };

let replSet;
let invoiceCounter = 0;
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

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be object`);
}

function assertLocalizedName(value, label) {
  assert(
    (value && typeof value === "object")
    || (typeof value === "string" && value.trim()),
    `${label} must be localized object or non-empty string`
  );
}

function assertHalalaInteger(value, label) {
  assert.strictEqual(typeof value, "number", `${label} must be number`);
  assert(Number.isInteger(value), `${label} must be integer halala`);
  assert(value >= 0, `${label} must be non-negative`);
}

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    category.products || []
  ).map((product) => ({ ...product, categoryKey: category.key })));
}

function findOrderableFixedProducts(menu, count = 2) {
  return flattenProducts(menu).filter((product) => {
    if (!product) return false;
    if (product.pricingModel !== "fixed") return false;
    if (product.requiresBuilder === true) return false;
    if (!Number.isInteger(product.priceHalala) || product.priceHalala <= 0) return false;
    return !(product.optionGroups || []).some(
      (group) => Number(group.minSelections || 0) > 0
    );
  }).slice(0, count);
}

function assertMenuProductContract(product, label) {
  assert(product.id || product._id, `${label}.id or _id exists`);
  assertLocalizedName(product.nameI18n || product.name, `${label}.name`);
  assert(typeof product.pricingModel === "string" && product.pricingModel, `${label}.pricingModel exists`);
  assertHalalaInteger(product.priceHalala, `${label}.priceHalala`);
  assert(product.ui && ["large", "medium", "small"].includes(product.ui.cardSize), `${label}.ui.cardSize is public card size`);
  assert.deepStrictEqual(Object.keys(product.ui), ["cardSize"], `${label}.ui only exposes cardSize`);
  if (product.requiresBuilder) {
    assert(Array.isArray(product.optionGroups), `${label}.optionGroups array exists for custom product`);
    assert(product.optionGroups.length > 0, `${label}.optionGroups has groups`);
    assert(product.optionGroups.every((group) => group.ui && typeof group.ui.displayStyle === "string"), `${label}.optionGroups keep builder ui`);
  }
}

function assertQuoteItemContract(item, label) {
  assert(item.productId || (item.productSnapshot && item.productSnapshot.id), `${label}.productId exists`);
  assertLocalizedName(item.name, `${label}.name`);
  assert.strictEqual(typeof item.itemType, "string", `${label}.itemType is string`);
  assertHalalaInteger(item.unitPriceHalala, `${label}.unitPriceHalala`);
  assertHalalaInteger(item.lineTotalHalala, `${label}.lineTotalHalala`);
  assertObject(item.productSnapshot, `${label}.productSnapshot`);
  assert(Array.isArray(item.selectedOptions), `${label}.selectedOptions array exists`);
  assertObject(item.pricingSnapshot, `${label}.pricingSnapshot`);
}

function assertOrderCheckoutItemContract(item, label) {
  assertObject(item.productSnapshot, `${label}.productSnapshot`);
  assert(Array.isArray(item.selectedOptions), `${label}.selectedOptions array exists`);
  assertObject(item.pricingSnapshot, `${label}.pricingSnapshot`);
  assertHalalaInteger(item.unitPriceHalala, `${label}.unitPriceHalala`);
  assertHalalaInteger(item.lineTotalHalala, `${label}.lineTotalHalala`);
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

    let orderBody;
    let createPayload;

    await test("GET /api/orders/menu preserves mobile contract", async () => {
      const res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu");
      assert.strictEqual(res.body.status, true);
      assert.strictEqual(res.body.data.fulfillmentMethod, "pickup");
      assert.strictEqual(res.body.data.vatIncluded, true);
      assert(Array.isArray(res.body.data.categories), "data.categories is array");
      assert.strictEqual(res.body.data.delivery, undefined, "pickup menu does not return delivery");

      const category = res.body.data.categories[0];
      assert(Array.isArray(category.products), "category.products is array");
      assert(!category.ui || Object.keys(category.ui).length === 0, "category visual ui is omitted from mobile contract");

      const fixedProducts = findOrderableFixedProducts(res.body.data, 2);
      assert.strictEqual(
        fixedProducts.length,
        2,
        "the published one-time menu exposes at least two orderable fixed-price products"
      );
      fixedProducts.forEach((product, index) => {
        assertMenuProductContract(product, `fixedProducts[${index}](${product.key})`);
      });

      orderBody = {
        fulfillmentMethod: "pickup",
        fulfillmentDate: "2026-05-10",
        pickup: {
          branchId: "main",
          pickupWindow: "18:00-20:00",
        },
        items: fixedProducts.map((product, index) => ({
          productId: product.id || product._id,
          qty: index === 0 ? 2 : 1,
          selectedOptions: [],
        })),
        successUrl: "basicdiet://orders/payment-success",
        backUrl: "basicdiet://orders/payment-cancel",
      };
    });

    await test("POST /api/orders/quote preserves mobile contract", async () => {
      const res = await api.post("/api/orders/quote").set(clientHeaders).send(orderBody);
      expectStatus(res, 200, "quote");
      assert.strictEqual(res.body.status, true);
      assert.strictEqual(res.body.data.currency, "SAR");
      assert(Array.isArray(res.body.data.items), "data.items is array");
      assert(res.body.data.items.length >= 2, "quote includes multiple fixed-price items");
      res.body.data.items.forEach((item, index) => assertQuoteItemContract(item, `data.items[${index}]`));
      assertHalalaInteger(res.body.data.pricing.subtotalHalala, "data.pricing.subtotalHalala");
      assertHalalaInteger(res.body.data.pricing.totalHalala, "data.pricing.totalHalala");
      assert.strictEqual(res.body.data.pricing.vatIncluded, true);
      assertHalalaInteger(res.body.data.pricing.vatHalala, "data.pricing.vatHalala");
    });

    await test("POST /api/orders requires an idempotency key", async () => {
      const res = await api.post("/api/orders").set(clientHeaders).send(orderBody);
      expectStatus(res, 400, "missing idempotency key");
      assert.strictEqual(res.body.ok, false);
      assert.strictEqual(res.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    });

    await test("POST /api/orders accepts body idempotencyKey compatibility", async () => {
      const res = await api
        .post("/api/orders")
        .set(clientHeaders)
        .send({ ...orderBody, fulfillmentDate: "2026-05-11", idempotencyKey: `${TEST_TAG}-body-checkout` });
      expectStatus(res, 201, "body idempotency checkout");
      assert.strictEqual(res.body.status, true);
      assert(res.body.data.orderId, "data.orderId exists");
      assert(res.body.data.paymentId, "data.paymentId exists");
    });

    await test("POST /api/orders preserves mobile checkout contract", async () => {
      const res = await api
        .post("/api/orders")
        .set({ ...clientHeaders, "Idempotency-Key": `${TEST_TAG}-checkout` })
        .send(orderBody);
      expectStatus(res, 201, "create order");
      assert.strictEqual(res.body.status, true);
      createPayload = res.body.data;
      assert(createPayload.orderId, "data.orderId exists");
      assert(createPayload.paymentId, "data.paymentId exists");
      assert(createPayload.paymentUrl, "data.paymentUrl exists");
      assert(createPayload.invoiceId, "data.invoiceId exists");
      assert.strictEqual(createPayload.status, "pending_payment");
      assert.strictEqual(createPayload.paymentStatus, "initiated");
      assertHalalaInteger(createPayload.pricing.subtotalHalala, "data.pricing.subtotalHalala");
      assertHalalaInteger(createPayload.pricing.totalHalala, "data.pricing.totalHalala");
      assertHalalaInteger(createPayload.pricing.vatHalala, "data.pricing.vatHalala");
      assert(Array.isArray(createPayload.items), "data.items is array");
      createPayload.items.forEach((item, index) => assertOrderCheckoutItemContract(item, `data.items[${index}]`));
    });

    await test("POST /api/orders/:orderId/payments/:paymentId/verify preserves mobile success contract", async () => {
      invoiceResponses.set(createPayload.invoiceId, {
        id: createPayload.invoiceId,
        status: "paid",
        amount: createPayload.pricing.totalHalala,
        currency: "SAR",
        payments: [{
          id: `pay_${TEST_TAG}_verify`,
          status: "paid",
          amount: createPayload.pricing.totalHalala,
          currency: "SAR",
        }],
      });

      const res = await api
        .post(`/api/orders/${createPayload.orderId}/payments/${createPayload.paymentId}/verify`)
        .set(clientHeaders)
        .send({});
      expectStatus(res, 200, "verify payment");
      assert.strictEqual(res.body.status, true);
      assert(res.body.data.orderId, "data.orderId exists");
      assert(res.body.data.paymentId, "data.paymentId exists");
      assert.strictEqual(res.body.data.orderStatus, "confirmed");
      assert.strictEqual(res.body.data.paymentStatus, "paid");
      assert.strictEqual(res.body.data.applied, true);
      assertObject(res.body.data.order, "data.order");
      assert(Array.isArray(res.body.data.order.items), "data.order.items is array");
      assertObject(res.body.data.order.pricing, "data.order.pricing");
      assertHalalaInteger(res.body.data.order.pricing.subtotalHalala, "data.order.pricing.subtotalHalala");
      assertHalalaInteger(res.body.data.order.pricing.totalHalala, "data.order.pricing.totalHalala");
      assertHalalaInteger(res.body.data.order.pricing.vatHalala, "data.order.pricing.vatHalala");
    });

    await test("GET /api/orders/:id preserves mobile tracking/detail contract", async () => {
      const res = await api.get(`/api/orders/${createPayload.orderId}`).set(clientHeaders);
      expectStatus(res, 200, "mobile order detail");
      assert.strictEqual(res.body.status, true);
      const order = res.body.data;
      assert(order.id || order.orderId, "order id exists");
      assert.strictEqual(typeof order.orderNumber, "string", "orderNumber exists");
      assert.strictEqual(typeof order.status, "string", "status exists");
      assert.strictEqual(order.paymentStatus, "paid");
      assert.strictEqual(order.fulfillmentMethod, "pickup");
      assertObject(order.pickup, "pickup");
      assert(Array.isArray(order.items), "items is array");
      assertObject(order.pricing, "pricing");
      assertHalalaInteger(order.pricing.subtotalHalala, "pricing.subtotalHalala");
      assertHalalaInteger(order.pricing.totalHalala, "pricing.totalHalala");
      assertHalalaInteger(order.pricing.vatHalala, "pricing.vatHalala");
      order.items.forEach((item, index) => {
        assert.strictEqual(typeof item.itemType, "string", `items[${index}].itemType is string`);
        assertLocalizedName(item.name, `items[${index}].name`);
        assertHalalaInteger(item.unitPriceHalala, `items[${index}].unitPriceHalala`);
        assertHalalaInteger(item.lineTotalHalala, `items[${index}].lineTotalHalala`);
      });
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
  console.error("❌ mobile API contract tests crashed");
  console.error(err && err.stack ? err.stack : err);
  await disconnect().catch(() => {});
  process.exitCode = 1;
});