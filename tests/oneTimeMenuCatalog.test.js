process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuAuditLog = require("../src/models/MenuAuditLog");
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
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const { JWT_SECRET } = require("../src/middleware/auth");

const TEST_TAG = `one-time-menu-${Date.now()}`;
const TEST_KEY_TAG = TEST_TAG.replace(/-/g, "_");
const TEST_DB_NAME = `${TEST_KEY_TAG}_test`;
const results = { passed: 0, failed: 0 };
let invoiceCounter = 0;
let mongoServer;

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

function dashboardAuth(role = "admin") {
  const token = jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

function appAuth(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function startMemoryMongo() {
  if (mongoServer) return;
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: TEST_DB_NAME,
    },
  });
  const uri = mongoServer.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
}

async function connect() {
  await startMemoryMongo();
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
}

async function resetDatabase() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

async function cleanup() {
  if (mongoose.connection.readyState !== 1) return;
  const regex = new RegExp(TEST_TAG);
  const keyRegex = new RegExp(TEST_KEY_TAG);
  const [categoryIds, productIds, groupIds, optionIds, userIds] = await Promise.all([
    MenuCategory.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuProduct.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuOptionGroup.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuOption.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    User.find({ phone: regex }).select("_id").lean(),
  ]);
  const categories = categoryIds.map((row) => row._id);
  const products = productIds.map((row) => row._id);
  const groups = groupIds.map((row) => row._id);
  const options = optionIds.map((row) => row._id);
  const users = userIds.map((row) => row._id);
  await Promise.all([
    ProductOptionGroup.deleteMany({ $or: [{ productId: { $in: products } }, { groupId: { $in: groups } }] }),
    ProductGroupOption.deleteMany({ $or: [{ productId: { $in: products } }, { groupId: { $in: groups } }, { optionId: { $in: options } }] }),
    MenuAuditLog.deleteMany({ $or: [{ entityId: { $in: [...categories, ...products, ...groups, ...options] } }, { "meta.testTag": TEST_TAG }] }),
    MenuVersion.deleteMany({ notes: { $regex: TEST_TAG } }),
    Order.deleteMany({ userId: { $in: users } }),
    Payment.deleteMany({ userId: { $in: users } }),
    User.deleteMany({ _id: { $in: users } }),
    MenuOption.deleteMany({ _id: { $in: options } }),
    MenuOptionGroup.deleteMany({ _id: { $in: groups } }),
    MenuProduct.deleteMany({ _id: { $in: products } }),
    MenuCategory.deleteMany({ _id: { $in: categories } }),
  ]);
}

function installMoyasarMock() {
  const originalCreateInvoice = moyasarService.createInvoice;
  moyasarService.createInvoice = async (payload) => {
    invoiceCounter += 1;
    return {
      id: `inv_${TEST_TAG}_${invoiceCounter}`,
      url: `https://payments.example.test/${invoiceCounter}`,
      amount: payload.amount,
      currency: payload.currency || "SAR",
      status: "initiated",
      metadata: payload.metadata,
    };
  };
  return () => {
    moyasarService.createInvoice = originalCreateInvoice;
  };
}

async function seedViaDashboard(api) {
  await Setting.updateOne(
    { key: "vat_percentage" },
    { $set: { value: 15, description: `${TEST_TAG} VAT` } },
    { upsert: true }
  );
  let res = await api.post("/api/dashboard/menu/categories").set(dashboardAuth()).send({
    key: `${TEST_TAG}_salads`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Salads`, ar: "سلطات" },
    sortOrder: 1,
  });
  expectStatus(res, 201, "create category");
  const category = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
    categoryId: category.id,
    key: `${TEST_TAG}_fixed`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Fixed Product`, ar: "منتج ثابت" },
    itemType: "dessert",
    pricingModel: "fixed",
    priceHalala: 1000,
    sortOrder: 1,
  });
  expectStatus(res, 201, "create fixed product");
  const fixedProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
    categoryId: category.id,
    key: `${TEST_TAG}_per100`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Per 100g`, ar: "بالوزن" },
    itemType: "basic_salad",
    pricingModel: "per_100g",
    priceHalala: 1500,
    defaultWeightGrams: 100,
    minWeightGrams: 100,
    weightStepGrams: 50,
    sortOrder: 2,
  });
  expectStatus(res, 201, "create per100 product");
  const per100Product = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
    categoryId: category.id,
    key: `${TEST_TAG}_inactive`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Inactive Product`, ar: "مخفي" },
    itemType: "drink",
    pricingModel: "fixed",
    priceHalala: 100,
    isActive: false,
    sortOrder: 99,
  });
  expectStatus(res, 201, "create inactive product");
  const inactiveProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
    categoryId: category.id,
    key: `${TEST_TAG}_required`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Required Product`, ar: "مطلوب" },
    itemType: "dessert",
    pricingModel: "fixed",
    priceHalala: 500,
    sortOrder: 3,
  });
  expectStatus(res, 201, "create required product");
  const requiredProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/option-groups").set(dashboardAuth()).send({
    key: `${TEST_TAG}_sauces`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Sauces`, ar: "صوصات" },
  });
  expectStatus(res, 201, "create group");
  const group = res.body.data;

  const optionPayloads = [
    { key: `${TEST_TAG}_ranch`, name: "Ranch", extraPriceHalala: 300, extraWeightUnitGrams: 50, extraWeightPriceHalala: 500 },
    { key: `${TEST_TAG}_pesto`, name: "Pesto", extraPriceHalala: 200 },
    { key: `${TEST_TAG}_hidden`, name: "Hidden", extraPriceHalala: 900 },
    { key: `${TEST_TAG}_inactive_option`, name: "Inactive Option", extraPriceHalala: 700, isActive: false },
  ];
  const options = [];
  for (const payload of optionPayloads) {
    res = await api.post("/api/dashboard/menu/options").set(dashboardAuth()).send({
      groupId: group.id,
      key: payload.key.replace(/-/g, "_"),
      name: { en: `${TEST_TAG} ${payload.name}`, ar: payload.name },
      extraPriceHalala: payload.extraPriceHalala,
      extraWeightUnitGrams: payload.extraWeightUnitGrams || 0,
      extraWeightPriceHalala: payload.extraWeightPriceHalala || 0,
      isActive: payload.isActive !== false,
    });
    expectStatus(res, 201, `create option ${payload.name}`);
    options.push(res.body.data);
  }

  res = await api.put(`/api/dashboard/menu/products/${fixedProduct.id}/groups`).set(dashboardAuth()).send({
    groups: [{ groupId: group.id, minSelections: 0, maxSelections: 1, sortOrder: 1 }],
  });
  expectStatus(res, 200, "set product groups");

  res = await api.put(`/api/dashboard/menu/products/${fixedProduct.id}/groups/${group.id}/options`).set(dashboardAuth()).send({
    options: [
      { optionId: options[0].id, extraPriceHalala: 300, extraWeightPriceHalala: 500, sortOrder: 1 },
      { optionId: options[1].id, extraPriceHalala: 200, sortOrder: 2 },
      { optionId: options[3].id, extraPriceHalala: 700, sortOrder: 3 },
    ],
  });
  expectStatus(res, 200, "set group options");

  res = await api.put(`/api/dashboard/menu/products/${requiredProduct.id}/groups`).set(dashboardAuth()).send({
    groups: [{ groupId: group.id, minSelections: 1, maxSelections: 1, sortOrder: 1 }],
  });
  expectStatus(res, 200, "set required product groups");

  res = await api.put(`/api/dashboard/menu/products/${requiredProduct.id}/groups/${group.id}/options`).set(dashboardAuth()).send({
    options: [{ optionId: options[1].id, extraPriceHalala: 0, sortOrder: 1 }],
  });
  expectStatus(res, 200, "set required product options");

  res = await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: TEST_TAG });
  expectStatus(res, 200, "publish menu");

  return { category, fixedProduct, per100Product, inactiveProduct, requiredProduct, group, options };
}

(async function run() {
  let restoreMoyasar = () => {};

  try {
    await connect();
    await resetDatabase();
    restoreMoyasar = installMoyasarMock();
    const api = request(createApp());
    const user = await User.create({
      phone: `${TEST_TAG}-+966500000000`,
      name: `${TEST_TAG} User`,
      role: "client",
      isActive: true,
    });
    const ctx = await seedViaDashboard(api);

    await test("GET /api/orders/menu exposes published pickup-only catalog without delivery", async () => {
      const res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu");
      assert.strictEqual(res.body.data.fulfillmentMethod, "pickup");
      assert.strictEqual(res.body.data.vatIncluded, true);
      assert.strictEqual(res.body.data.delivery, undefined);
      const product = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
      assert(product, "published product appears");
      assert.strictEqual(product.priceHalala, 1000);
      assert(!res.body.data.categories.flatMap((category) => category.products).some((item) => item.id === ctx.inactiveProduct.id), "inactive product is hidden");
      assert(!product.optionGroups[0].options.some((item) => item.id === ctx.options[3].id), "inactive option is hidden");
    });

    await test("POST /api/orders/quote prices fixed item, option extra, and extra weight", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          priceHalala: 999999,
          unitPriceHalala: 999999,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[0].id, extraWeightGrams: 50 }],
        }],
      });
      expectStatus(res, 200, "fixed quote");
      assert.strictEqual(res.body.data.pricing.totalHalala, 1800);
      assert.strictEqual(res.body.data.pricing.vatIncluded, true);
      assert.strictEqual(res.body.data.pricing.vatHalala, 235);
    });

    await test("POST /api/orders/quote prices per_100g item in halala", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{ productId: ctx.per100Product.id, qty: 1, weightGrams: 150, selectedOptions: [] }],
      });
      expectStatus(res, 200, "per100 quote");
      assert.strictEqual(res.body.data.pricing.totalHalala, 3000);
    });

    await test("POST /api/orders/quote validates maxSelections and option-product relation", async () => {
      let res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [
            { groupId: ctx.group.id, optionId: ctx.options[0].id },
            { groupId: ctx.group.id, optionId: ctx.options[1].id },
          ],
        }],
      });
      expectStatus(res, 400, "max selections");
      assert.strictEqual(res.body.error.code, "MAX_SELECTIONS_EXCEEDED");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[2].id }],
        }],
      });
      expectStatus(res, 400, "not allowed option");
      assert.strictEqual(res.body.error.code, "OPTION_NOT_ALLOWED");
    });

    await test("POST /api/orders/quote validates minSelections", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.requiredProduct.id,
          qty: 1,
          selectedOptions: [],
        }],
      });
      expectStatus(res, 400, "min selections");
      assert.strictEqual(res.body.error.code, "MIN_SELECTIONS_NOT_MET");
    });

    await test("POST /api/orders rejects delivery and subscription fields", async () => {
      let res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "delivery",
        items: [{ productId: ctx.fixedProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "delivery rejected");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        mealSlots: [],
        items: [{ productId: ctx.fixedProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "subscription fields rejected");
      assert.strictEqual(res.body.error.code, "UNSUPPORTED_ONE_TIME_ORDER_FIELD");
    });

    await test("POST /api/orders stores immutable product and option snapshot", async () => {
      const createRes = await api.post("/api/orders").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[0].id }],
        }],
      });
      expectStatus(createRes, 201, "create order");
      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert.strictEqual(order.items[0].productSnapshot.name.en, `${TEST_TAG} Fixed Product`);
      assert.strictEqual(order.items[0].selectedOptions[0].name.en, `${TEST_TAG} Ranch`);

      await MenuProduct.updateOne({ _id: ctx.fixedProduct.id }, { $set: { name: { en: `${TEST_TAG} Changed`, ar: "تغيير" }, priceHalala: 9999 } });
      const unchanged = await Order.findById(order._id).lean();
      assert.strictEqual(unchanged.items[0].productSnapshot.name.en, `${TEST_TAG} Fixed Product`);
      assert.strictEqual(unchanged.items[0].unitPriceHalala, 1300);
    });

    await test("POST /api/orders creates dynamic catalog item orders without itemType enum regression", async () => {
      const createRes = await api.post("/api/orders").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.per100Product.id,
          qty: 1,
          weightGrams: 150,
          selectedOptions: [],
        }],
      });
      expectStatus(createRes, 201, "create dynamic catalog order");

      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert(order, "order was persisted");
      assert.strictEqual(order.status, "pending_payment");
      assert.strictEqual(order.items[0].itemType, "basic_salad");
      assert(order.items[0].productSnapshot, "productSnapshot is persisted");
      assert.strictEqual(order.items[0].productSnapshot.key, `${TEST_TAG}_per100`.replace(/-/g, "_"));
      assert(Array.isArray(order.items[0].selectedOptions), "selectedOptions snapshot array is persisted");
      assert(order.items[0].pricingSnapshot, "pricingSnapshot is persisted");
      assert(Object.prototype.hasOwnProperty.call(order.items[0], "menuVersionId"), "menuVersionId field is persisted when available");

      const payment = await Payment.findOne({ orderId: order._id, type: "one_time_order" }).lean();
      assert(payment, "one-time order payment was persisted");
      assert.strictEqual(payment.type, "one_time_order");
      assert.strictEqual(payment.status, "initiated");
    });

    await test("Dashboard menu requires admin role", async () => {
      const res = await api.post("/api/dashboard/menu/categories").set(dashboardAuth("kitchen")).send({
        key: `${TEST_TAG}_forbidden`.replace(/-/g, "_"),
        name: { en: "Forbidden" },
      });
      expectStatus(res, 403, "dashboard menu forbidden");
    });
  } catch (err) {
    results.failed += 1;
    console.error("❌ one-time menu catalog setup/run");
    console.error(err && err.stack ? err.stack : err);
  } finally {
    restoreMoyasar();
    await cleanup();
    await resetDatabase();
    await disconnect();
  }

  if (results.failed > 0) {
    console.error(`\n${results.failed} one-time menu catalog test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${results.passed} one-time menu catalog test(s) passed`);
})();
