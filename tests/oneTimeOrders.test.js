process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const Addon = require("../src/models/Addon");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const Setting = require("../src/models/Setting");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const moyasarService = require("../src/services/moyasarService");
const { JWT_SECRET } = require("../src/middleware/auth");
const {
  FINAL_ORDER_STATUSES,
  ORDER_STATUSES,
  canTransitionOrderStatus,
  isFinalOrderStatus,
  normalizeLegacyOrderStatus,
} = require("../src/utils/orderState");

const results = { passed: 0, failed: 0 };
const TEST_TAG = `one-time-orders-${Date.now()}`;
const SETTING_KEYS = [
  "one_time_standard_meal_price_halala",
  "one_time_salad_base_price_halala",
  "one_time_delivery_fee_halala",
  "one_time_delivery_fee",
  "delivery_windows",
  "pickup_windows",
  "vat_percentage",
  "restaurant_open_time",
  "restaurant_close_time",
];
const settingSnapshots = new Map();
let invoiceCounter = 0;
const moyasarInvoices = new Map();

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

function objectId() {
  return new mongoose.Types.ObjectId();
}

function buildBaseOrder(overrides = {}) {
  return {
    userId: objectId(),
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-05-04",
    items: [
      {
        itemType: "standard_meal",
        name: { ar: "وجبة", en: "Meal" },
        qty: 1,
        unitPriceHalala: 2500,
        lineTotalHalala: 2500,
        selections: {
          proteinId: objectId(),
          carbs: [{ carbId: objectId(), grams: 150 }],
        },
      },
    ],
    pricing: {
      subtotalHalala: 2500,
      deliveryFeeHalala: 0,
      discountHalala: 0,
      totalHalala: 2500,
      vatPercentage: 15,
      vatHalala: 326,
      vatIncluded: true,
      currency: "SAR",
    },
    ...overrides,
  };
}

function getOrderStatusEnumValues() {
  return Order.schema.path("status").enumValues.slice().sort();
}

function assertNoTtlIndex() {
  const ttlIndexes = Order.schema.indexes().filter(([, options]) => (
    options && Object.prototype.hasOwnProperty.call(options, "expireAfterSeconds")
  ));
  assert.deepStrictEqual(ttlIndexes, []);
}

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

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

async function snapshotSettings() {
  const settings = await Setting.find({ key: { $in: SETTING_KEYS } }).lean();
  for (const key of SETTING_KEYS) {
    const found = settings.find((setting) => setting.key === key);
    settingSnapshots.set(key, found || null);
  }
}

async function restoreSettings() {
  await Promise.all(SETTING_KEYS.map(async (key) => {
    const snapshot = settingSnapshots.get(key);
    if (!snapshot) {
      await Setting.deleteOne({ key });
      return;
    }
    await Setting.updateOne(
      { key },
      {
        $set: {
          value: snapshot.value,
          description: snapshot.description,
          skipAllowance: snapshot.skipAllowance,
        },
      },
      { upsert: true }
    );
  }));
}

async function upsertSetting(key, value) {
  await Setting.updateOne(
    { key },
    { $set: { value, description: `${TEST_TAG} test setting` } },
    { upsert: true }
  );
}

async function cleanupCatalogData() {
  const [
    userIds,
    addonIds,
    categoryIds,
    proteinIds,
    carbIds,
    sandwichIds,
    saladIngredientIds,
    zoneIds,
  ] = await Promise.all([
    User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean(),
    Addon.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
    BuilderCategory.find({ key: { $regex: TEST_TAG } }).select("_id").lean(),
    BuilderProtein.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
    BuilderCarb.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
    Sandwich.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
    SaladIngredient.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
    Zone.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean(),
  ]);

  const users = userIds.map((row) => row._id);
  await Promise.all([
    SubscriptionDay.deleteMany({ userId: { $in: users } }),
    Order.deleteMany({ userId: { $in: users } }),
    Payment.deleteMany({ userId: { $in: users } }),
    User.deleteMany({ _id: { $in: users } }),
    Addon.deleteMany({ _id: { $in: addonIds.map((row) => row._id) } }),
    BuilderProtein.deleteMany({ _id: { $in: proteinIds.map((row) => row._id) } }),
    BuilderCarb.deleteMany({ _id: { $in: carbIds.map((row) => row._id) } }),
    Sandwich.deleteMany({ _id: { $in: sandwichIds.map((row) => row._id) } }),
    SaladIngredient.deleteMany({ _id: { $in: saladIngredientIds.map((row) => row._id) } }),
    Zone.deleteMany({ _id: { $in: zoneIds.map((row) => row._id) } }),
    BuilderCategory.deleteMany({ _id: { $in: categoryIds.map((row) => row._id) } }),
  ]);
}

async function seedOneTimeOrderCatalog() {
  await cleanupCatalogData();
  await snapshotSettings();
  await Promise.all([
    upsertSetting("one_time_standard_meal_price_halala", 4200),
    upsertSetting("one_time_salad_base_price_halala", 800),
    upsertSetting("vat_percentage", 15),
    upsertSetting("delivery_windows", ["18:00-20:00", "20:00-22:00"]),
    upsertSetting("pickup_windows", ["18:00-20:00"]),
    upsertSetting("restaurant_open_time", "00:00"),
    upsertSetting("restaurant_close_time", "23:59"),
  ]);

  const user = await User.create({
    phone: `${TEST_TAG}-+966500000000`,
    name: `${TEST_TAG} User`,
    role: "client",
    isActive: true,
  });
  const otherUser = await User.create({
    phone: `${TEST_TAG}-+966511111111`,
    name: `${TEST_TAG} Other User`,
    role: "client",
    isActive: true,
  });
  const proteinCategory = await BuilderCategory.create({
    key: `${TEST_TAG}-protein`,
    dimension: "protein",
    name: { ar: "", en: `${TEST_TAG} Protein Category` },
    isActive: true,
  });
  const carbCategory = await BuilderCategory.create({
    key: `${TEST_TAG}-carb`,
    dimension: "carb",
    name: { ar: "", en: `${TEST_TAG} Carb Category` },
    isActive: true,
  });
  const protein = await BuilderProtein.create({
    key: `${TEST_TAG}-chicken`,
    name: { ar: "", en: `${TEST_TAG} Chicken` },
    description: { ar: "", en: "Grilled chicken" },
    displayCategoryId: proteinCategory._id,
    displayCategoryKey: "chicken",
    proteinFamilyKey: "chicken",
    extraFeeHalala: 300,
    isActive: true,
    sortOrder: 1,
  });
  const carb = await BuilderCarb.create({
    key: `${TEST_TAG}-rice`,
    name: { ar: "", en: `${TEST_TAG} Rice` },
    description: { ar: "", en: "Rice" },
    displayCategoryId: carbCategory._id,
    displayCategoryKey: "rice",
    isActive: true,
    sortOrder: 1,
  });
  const sandwich = await Sandwich.create({
    name: { ar: "", en: `${TEST_TAG} Sandwich` },
    description: { ar: "", en: "Chicken sandwich" },
    priceHalala: 2500,
    proteinFamilyKey: "chicken",
    isActive: true,
    sortOrder: 1,
  });
  const inactiveSandwich = await Sandwich.create({
    name: { ar: "", en: `${TEST_TAG} Inactive Sandwich` },
    description: { ar: "", en: "Inactive" },
    priceHalala: 2600,
    proteinFamilyKey: "chicken",
    isActive: false,
    sortOrder: 2,
  });
  const addon = await Addon.create({
    name: { ar: "", en: `${TEST_TAG} Juice` },
    description: { ar: "", en: "Orange juice" },
    category: "juice",
    kind: "item",
    billingMode: "flat_once",
    priceHalala: 900,
    isActive: true,
    sortOrder: 1,
  });
  const ingredient = await SaladIngredient.create({
    name: { ar: "", en: `${TEST_TAG} Lettuce` },
    groupKey: "vegetables",
    price: 2.5,
    calories: 5,
    isActive: true,
    sortOrder: 1,
  });
  const activeZone = await Zone.create({
    name: { ar: "", en: `${TEST_TAG} Active Zone` },
    deliveryFeeHalala: 1350,
    isActive: true,
    sortOrder: 1,
  });
  const inactiveZone = await Zone.create({
    name: { ar: "", en: `${TEST_TAG} Inactive Zone` },
    deliveryFeeHalala: 1400,
    isActive: false,
    sortOrder: 2,
  });

  return {
    user,
    otherUser,
    token: issueAppAccessToken(user._id),
    otherToken: issueAppAccessToken(otherUser._id),
    protein,
    carb,
    sandwich,
    inactiveSandwich,
    addon,
    ingredient,
    activeZone,
    inactiveZone,
  };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function sandwichQuotePayload(ctx, overrides = {}) {
  return {
    fulfillmentMethod: "pickup",
    pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
    items: [
      {
        itemType: "sandwich",
        qty: 1,
        selections: { sandwichId: String(ctx.sandwich._id) },
      },
    ],
    ...overrides,
  };
}

function installMoyasarInvoiceMock() {
  const originalCreateInvoice = moyasarService.createInvoice;
  const originalGetInvoice = moyasarService.getInvoice;
  moyasarService.createInvoice = async (payload) => {
    invoiceCounter += 1;
    const invoice = {
      id: `inv_${TEST_TAG}_${invoiceCounter}`,
      url: `https://payments.example.test/invoices/${invoiceCounter}`,
      amount: payload.amount,
      currency: payload.currency || "SAR",
      status: "initiated",
      metadata: payload.metadata,
    };
    moyasarInvoices.set(invoice.id, invoice);
    return invoice;
  };
  moyasarService.getInvoice = async (invoiceId) => {
    const invoice = moyasarInvoices.get(String(invoiceId));
    if (!invoice) {
      const err = new Error("Invoice not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    return { ...invoice, metadata: { ...(invoice.metadata || {}) } };
  };
  return () => {
    moyasarService.createInvoice = originalCreateInvoice;
    moyasarService.getInvoice = originalGetInvoice;
    moyasarInvoices.clear();
  };
}

function setMoyasarInvoice(invoiceId, updates = {}) {
  const current = moyasarInvoices.get(String(invoiceId));
  assert(current, `Missing mocked Moyasar invoice ${invoiceId}`);
  const next = {
    ...current,
    ...updates,
    metadata: { ...(current.metadata || {}), ...(updates.metadata || {}) },
  };
  moyasarInvoices.set(String(invoiceId), next);
  return next;
}

(async function run() {
  await test("Order status enum contains only final one-time order statuses", () => {
    assert.deepStrictEqual(getOrderStatusEnumValues(), FINAL_ORDER_STATUSES.slice().sort());
  });

  await test("Order rejects unknown statuses", async () => {
    const order = new Order(buildBaseOrder({ status: "preparing_in_a_hurry" }));
    await assert.rejects(() => order.validate(), /`preparing_in_a_hurry` is not a valid enum value/);
  });

  await test("Order validation normalizes legacy status values before enum validation", async () => {
    const order = new Order(buildBaseOrder({
      status: "preparing",
      fulfillmentMethod: undefined,
      fulfillmentDate: undefined,
      deliveryMode: "delivery",
      deliveryDate: "2026-05-05",
    }));
    await order.validate();
    assert.strictEqual(order.status, ORDER_STATUSES.IN_PREPARATION);
    assert.strictEqual(order.fulfillmentMethod, "delivery");
    assert.strictEqual(order.deliveryMode, "delivery");
    assert.strictEqual(order.fulfillmentDate, "2026-05-05");
    assert.strictEqual(order.deliveryDate, "2026-05-05");
  });

  await test("Transition helper follows final order lifecycle", () => {
    assert.strictEqual(canTransitionOrderStatus("pending_payment", "confirmed"), true);
    assert.strictEqual(canTransitionOrderStatus("confirmed", "in_preparation"), true);
    assert.strictEqual(canTransitionOrderStatus("in_preparation", "ready_for_pickup"), true);
    assert.strictEqual(canTransitionOrderStatus("in_preparation", "out_for_delivery"), true);
    assert.strictEqual(canTransitionOrderStatus("ready_for_pickup", "fulfilled"), true);
    assert.strictEqual(canTransitionOrderStatus("out_for_delivery", "fulfilled"), true);
    assert.strictEqual(canTransitionOrderStatus("fulfilled", "confirmed"), false);
    assert.strictEqual(canTransitionOrderStatus("cancelled", "confirmed"), false);
  });

  await test("Transition helper accepts legacy transition names through normalization", () => {
    assert.strictEqual(canTransitionOrderStatus("created", "confirmed"), true);
    assert.strictEqual(canTransitionOrderStatus("confirmed", "preparing"), true);
    assert.strictEqual(canTransitionOrderStatus("preparing", "canceled"), true);
    assert.strictEqual(canTransitionOrderStatus("out_for_delivery", "delivered"), true);
  });

  await test("Final status helper identifies terminal statuses", () => {
    assert.strictEqual(isFinalOrderStatus("fulfilled"), true);
    assert.strictEqual(isFinalOrderStatus("cancelled"), true);
    assert.strictEqual(isFinalOrderStatus("canceled"), true);
    assert.strictEqual(isFinalOrderStatus("expired"), true);
    assert.strictEqual(isFinalOrderStatus("confirmed"), false);
  });

  await test("Legacy status normalization maps old values to final values", () => {
    assert.strictEqual(normalizeLegacyOrderStatus("created"), ORDER_STATUSES.PENDING_PAYMENT);
    assert.strictEqual(normalizeLegacyOrderStatus("created", { paymentStatus: "paid" }), ORDER_STATUSES.CONFIRMED);
    assert.strictEqual(normalizeLegacyOrderStatus("preparing"), ORDER_STATUSES.IN_PREPARATION);
    assert.strictEqual(normalizeLegacyOrderStatus("canceled"), ORDER_STATUSES.CANCELLED);
    assert.strictEqual(normalizeLegacyOrderStatus("delivered"), ORDER_STATUSES.FULFILLED);
  });

  await test("Order schema has no TTL index", () => {
    assertNoTtlIndex();
  });

  await test("Can validate a pickup Order document", async () => {
    const order = new Order(buildBaseOrder({
      status: "pending_payment",
      fulfillmentMethod: "pickup",
      pickup: {
        branchId: "main",
        branchName: { ar: "الفرع الرئيسي", en: "Main Branch" },
        pickupWindow: "18:00-20:00",
      },
    }));
    await order.validate();
    assert.strictEqual(order.fulfillmentMethod, "pickup");
    assert.strictEqual(order.deliveryMode, "pickup");
    assert.strictEqual(order.status, "pending_payment");
  });

  await test("Can validate a delivery Order document", async () => {
    const zoneId = objectId();
    const order = new Order(buildBaseOrder({
      status: "confirmed",
      fulfillmentMethod: "delivery",
      delivery: {
        zoneId,
        zoneName: { ar: "شمال الرياض", en: "North Riyadh" },
        deliveryFeeHalala: 1500,
        address: {
          label: "Home",
          line1: "Street 1",
          district: "North",
          city: "Riyadh",
          phone: "+966500000000",
        },
      },
      pricing: {
        subtotalHalala: 2500,
        deliveryFeeHalala: 1500,
        discountHalala: 0,
        totalHalala: 4000,
        vatPercentage: 15,
        vatHalala: 522,
        vatIncluded: true,
        currency: "SAR",
      },
    }));
    await order.validate();
    assert.strictEqual(String(order.delivery.zoneId), String(zoneId));
    assert.strictEqual(order.fulfillmentMethod, "delivery");
    assert.strictEqual(order.deliveryMode, "delivery");
  });

  await connectDatabase();
  const app = createApp();
  const api = request(app);
  const ctx = await seedOneTimeOrderCatalog();
  const restoreMoyasarInvoiceMock = installMoyasarInvoiceMock();

  try {
    await test("GET /api/orders/menu returns active catalog shape", async () => {
      const res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu");
      assert.strictEqual(res.body.status, true);
      assert.strictEqual(res.body.data.currency, "SAR");
      assert(Array.isArray(res.body.data.itemTypes));
      assert(Array.isArray(res.body.data.standardMeals.proteins));
      assert(Array.isArray(res.body.data.standardMeals.carbs));
      assert(Array.isArray(res.body.data.sandwiches));
      assert(Array.isArray(res.body.data.salad.ingredients));
      assert(Array.isArray(res.body.data.salad.groups));
      assert(Array.isArray(res.body.data.addons.items));
      assert(Array.isArray(res.body.data.delivery.windows));
      assert(Array.isArray(res.body.data.delivery.zones));
      assert(res.body.data.sandwiches.some((item) => item.id === String(ctx.sandwich._id)));
      assert(!res.body.data.sandwiches.some((item) => item.id === String(ctx.inactiveSandwich._id)));
    });

    await test("POST /api/orders/quote rejects empty items", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send({
        fulfillmentMethod: "pickup",
        items: [],
      });
      expectStatus(res, 400, "empty quote");
      assert.strictEqual(res.body.error.code, "EMPTY_ORDER");
    });

    await test("POST /api/orders/quote prices pickup with deliveryFeeHalala=0", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(res, 200, "pickup quote");
      assert.strictEqual(res.body.data.pricing.subtotalHalala, 2500);
      assert.strictEqual(res.body.data.pricing.deliveryFeeHalala, 0);
      assert.strictEqual(res.body.data.pricing.totalHalala, 2500);
    });

    await test("POST /api/orders/quote prices delivery using zone fee if active zone exists", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        fulfillmentMethod: "delivery",
        delivery: {
          zoneId: String(ctx.activeZone._id),
          deliveryWindow: "18:00-20:00",
          address: { line1: "Street 1", city: "Riyadh" },
        },
        pickup: undefined,
      }));
      expectStatus(res, 200, "delivery quote");
      assert.strictEqual(res.body.data.pricing.subtotalHalala, 2500);
      assert.strictEqual(res.body.data.pricing.deliveryFeeHalala, 1350);
      assert.strictEqual(res.body.data.pricing.totalHalala, 3850);
    });

    await test("POST /api/orders/quote rejects inactive zone", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        fulfillmentMethod: "delivery",
        delivery: {
          zoneId: String(ctx.inactiveZone._id),
          deliveryWindow: "18:00-20:00",
        },
        pickup: undefined,
      }));
      expectStatus(res, 409, "inactive zone quote");
      assert.strictEqual(res.body.error.code, "ZONE_INACTIVE");
    });

    await test("POST /api/orders/quote rejects unavailable item", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send({
        fulfillmentMethod: "pickup",
        items: [{
          itemType: "sandwich",
          qty: 1,
          selections: { sandwichId: String(ctx.inactiveSandwich._id) },
        }],
      });
      expectStatus(res, 409, "unavailable item quote");
      assert.strictEqual(res.body.error.code, "ITEM_UNAVAILABLE");
    });

    await test("POST /api/orders/quote rejects unknown item type", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send({
        fulfillmentMethod: "pickup",
        items: [{ itemType: "mystery_box", qty: 1, selections: {} }],
      });
      expectStatus(res, 400, "unknown item type quote");
      assert.strictEqual(res.body.error.code, "INVALID_ITEM_TYPE");
    });

    await test("POST /api/orders/quote returns VAT included breakdown", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(res, 200, "vat quote");
      assert.strictEqual(res.body.data.pricing.vatIncluded, true);
      assert.strictEqual(res.body.data.pricing.vatPercentage, 15);
      assert.strictEqual(res.body.data.pricing.vatHalala, 326);
      assert.strictEqual(res.body.data.pricing.totalHalala, 2500);
    });

    await test("POST /api/orders/quote does not create Order document", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      const before = await Order.countDocuments({ userId: ctx.user._id });
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(res, 200, "no order quote");
      const after = await Order.countDocuments({ userId: ctx.user._id });
      assert.strictEqual(before, 0);
      assert.strictEqual(after, 0);
    });

    await test("POST /api/orders/quote does not create Payment document", async () => {
      await Payment.deleteMany({ userId: ctx.user._id });
      const before = await Payment.countDocuments({ userId: ctx.user._id });
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(res, 200, "no payment quote");
      const after = await Payment.countDocuments({ userId: ctx.user._id });
      assert.strictEqual(before, 0);
      assert.strictEqual(after, 0);
    });

    await test("POST /api/orders/quote rejects promoCode while order promo support is disabled", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        promoCode: "WELCOME",
      }));
      expectStatus(res, 400, "promo quote");
      assert.strictEqual(res.body.error.code, "PROMO_NOT_SUPPORTED_FOR_ORDERS");
    });

    await test("POST /api/orders/quote can price standard meal, salad, and addon items", async () => {
      const res = await api.post("/api/orders/quote").set(auth(ctx.token)).send({
        fulfillmentMethod: "pickup",
        items: [
          {
            itemType: "standard_meal",
            qty: 1,
            selections: {
              proteinId: String(ctx.protein._id),
              carbs: [{ carbId: String(ctx.carb._id), grams: 150 }],
            },
          },
          {
            itemType: "salad",
            qty: 1,
            selections: {
              salad: {
                groups: {
                  vegetables: [String(ctx.ingredient._id)],
                },
              },
            },
          },
          {
            itemType: "addon_item",
            qty: 2,
            selections: { addonItemId: String(ctx.addon._id) },
          },
        ],
      });
      expectStatus(res, 200, "mixed quote");
      assert.strictEqual(res.body.data.pricing.subtotalHalala, 7050);
      assert.strictEqual(res.body.data.items.length, 3);
    });

    await test("POST /api/orders creates pending_payment order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        successUrl: "basicdiet://orders/payment-success",
        backUrl: "basicdiet://orders/payment-cancel",
      }));
      expectStatus(res, 201, "create order");
      assert.strictEqual(res.body.data.status, "pending_payment");
      const order = await Order.findById(res.body.data.orderId).lean();
      assert(order);
      assert.strictEqual(order.status, "pending_payment");
      assert.strictEqual(order.paymentStatus, "initiated");
      assert.strictEqual(order.fulfillmentMethod, "pickup");
    });

    await test("POST /api/orders creates Payment type=one_time_order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        items: [{
          itemType: "sandwich",
          qty: 2,
          selections: { sandwichId: String(ctx.sandwich._id) },
        }],
      }));
      expectStatus(res, 201, "create payment order");
      const payment = await Payment.findById(res.body.data.paymentId).lean();
      assert(payment);
      assert.strictEqual(payment.type, "one_time_order");
      assert.strictEqual(payment.status, "initiated");
      assert.strictEqual(payment.amount, 5000);
      assert.strictEqual(String(payment.orderId), res.body.data.orderId);
    });

    await test("POST /api/orders returns paymentUrl", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        items: [{
          itemType: "addon_item",
          qty: 1,
          selections: { addonItemId: String(ctx.addon._id) },
        }],
      }));
      expectStatus(res, 201, "paymentUrl order");
      assert(/^https:\/\/payments\.example\.test\/invoices\//.test(res.body.data.paymentUrl));
      assert(res.body.data.invoiceId);
    });

    await test("POST /api/orders recalculates pricing and ignores client price fields", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const payload = sandwichQuotePayload(ctx);
      payload.items[0].unitPriceHalala = 1;
      payload.items[0].lineTotalHalala = 1;
      payload.pricing = { totalHalala: 1 };
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(payload);
      expectStatus(res, 201, "recalculate order");
      assert.strictEqual(res.body.data.pricing.totalHalala, 2500);
      const order = await Order.findById(res.body.data.orderId).lean();
      assert.strictEqual(order.pricing.totalHalala, 2500);
    });

    await test("POST /api/orders with promoCode returns PROMO_NOT_SUPPORTED_FOR_ORDERS", async () => {
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        promoCode: "WELCOME",
      }));
      expectStatus(res, 400, "create promo order");
      assert.strictEqual(res.body.error.code, "PROMO_NOT_SUPPORTED_FOR_ORDERS");
    });

    await test("GET /api/orders/:orderId returns only owner order", async () => {
      await Order.deleteMany({ userId: { $in: [ctx.user._id, ctx.otherUser._id] } });
      await Payment.deleteMany({ userId: { $in: [ctx.user._id, ctx.otherUser._id] } });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "owner create");
      const ownerRes = await api.get(`/api/orders/${createRes.body.data.orderId}`).set(auth(ctx.token));
      expectStatus(ownerRes, 200, "owner detail");
      assert.strictEqual(ownerRes.body.data.orderId, createRes.body.data.orderId);
      const otherRes = await api.get(`/api/orders/${createRes.body.data.orderId}`).set(auth(ctx.otherToken));
      expectStatus(otherRes, 404, "other detail");
    });

    await test("GET /api/orders/:orderId expires pending order when expiresAt is past", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "expiry create");
      await Order.updateOne(
        { _id: createRes.body.data.orderId },
        { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } }
      );
      const detailRes = await api.get(`/api/orders/${createRes.body.data.orderId}`).set(auth(ctx.token));
      expectStatus(detailRes, 200, "expired detail");
      assert.strictEqual(detailRes.body.data.status, "expired");
      assert.strictEqual(detailRes.body.data.paymentStatus, "expired");
      const payment = await Payment.findById(createRes.body.data.paymentId).lean();
      assert.strictEqual(payment.status, "expired");
    });

    await test("GET /api/orders returns paginated order history", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        items: [{ itemType: "addon_item", qty: 1, selections: { addonItemId: String(ctx.addon._id) } }],
      }));
      await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx, {
        items: [{ itemType: "addon_item", qty: 2, selections: { addonItemId: String(ctx.addon._id) } }],
      }));
      const listRes = await api.get("/api/orders?page=1&limit=1").set(auth(ctx.token));
      expectStatus(listRes, 200, "history");
      assert.strictEqual(listRes.body.data.items.length, 1);
      assert.strictEqual(listRes.body.data.pagination.total, 2);
      assert.strictEqual(listRes.body.data.pagination.pages, 2);
      assert.strictEqual(listRes.body.data.items[0].source, "one_time_order");
    });

    await test("DELETE /api/orders/:orderId cancels pending order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "cancel create");
      const cancelRes = await api.delete(`/api/orders/${createRes.body.data.orderId}`).set(auth(ctx.token));
      expectStatus(cancelRes, 200, "cancel pending");
      assert.strictEqual(cancelRes.body.data.status, "cancelled");
      assert.strictEqual(cancelRes.body.data.paymentStatus, "canceled");
      const payment = await Payment.findById(createRes.body.data.paymentId).lean();
      assert.strictEqual(payment.status, "canceled");
    });

    await test("DELETE /api/orders/:orderId rejects confirmed order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "confirmed cancel create");
      await Order.updateOne(
        { _id: createRes.body.data.orderId },
        { $set: { status: "confirmed", paymentStatus: "paid" } }
      );
      await Payment.updateOne(
        { _id: createRes.body.data.paymentId },
        { $set: { status: "paid" } }
      );
      const cancelRes = await api.delete(`/api/orders/${createRes.body.data.orderId}`).set(auth(ctx.token));
      expectStatus(cancelRes, 409, "cancel confirmed");
      assert(["INVALID_TRANSITION", "PAYMENT_ALREADY_PAID"].includes(cancelRes.body.error.code));
    });

    await test("Idempotency-key same request returns existing pending order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const key = `${TEST_TAG}-same-key`;
      const first = await api.post("/api/orders").set({ ...auth(ctx.token), "Idempotency-Key": key }).send(sandwichQuotePayload(ctx));
      expectStatus(first, 201, "first idempotent create");
      const second = await api.post("/api/orders").set({ ...auth(ctx.token), "Idempotency-Key": key }).send(sandwichQuotePayload(ctx));
      expectStatus(second, 200, "second idempotent create");
      assert.strictEqual(second.body.data.orderId, first.body.data.orderId);
      assert.strictEqual(second.body.data.reused, true);
    });

    await test("Idempotency-key different request returns conflict", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const key = `${TEST_TAG}-different-key`;
      const first = await api.post("/api/orders").set({ ...auth(ctx.token), "Idempotency-Key": key }).send(sandwichQuotePayload(ctx));
      expectStatus(first, 201, "first conflict create");
      const second = await api.post("/api/orders").set({ ...auth(ctx.token), "Idempotency-Key": key }).send(sandwichQuotePayload(ctx, {
        items: [{
          itemType: "sandwich",
          qty: 2,
          selections: { sandwichId: String(ctx.sandwich._id) },
        }],
      }));
      expectStatus(second, 409, "second conflict create");
      assert.strictEqual(second.body.error.code, "IDEMPOTENCY_CONFLICT");
    });

    await test("POST /api/orders/:orderId/payments/:paymentId/verify confirms paid invoice", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify paid create");
      setMoyasarInvoice(createRes.body.data.invoiceId, {
        status: "paid",
        payments: [{ id: `pay_${TEST_TAG}_verify_paid`, status: "paid", amount: 2500, currency: "SAR" }],
      });

      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(verifyRes, 200, "verify paid");
      assert.strictEqual(verifyRes.body.data.orderStatus, "confirmed");
      assert.strictEqual(verifyRes.body.data.paymentStatus, "paid");
      assert.strictEqual(verifyRes.body.data.applied, true);
      assert.strictEqual(verifyRes.body.data.isFinal, true);
      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert.strictEqual(order.status, "confirmed");
      assert.strictEqual(order.paymentStatus, "paid");
      assert.strictEqual(order.expiresAt, null);
    });

    await test("Verify paid invoice marks Payment paid/applied", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify payment create");
      setMoyasarInvoice(createRes.body.data.invoiceId, {
        status: "paid",
        payments: [{ id: `pay_${TEST_TAG}_verify_payment`, status: "paid", amount: 2500, currency: "SAR" }],
      });
      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(verifyRes, 200, "verify payment");
      const payment = await Payment.findById(createRes.body.data.paymentId).lean();
      assert.strictEqual(payment.status, "paid");
      assert.strictEqual(payment.applied, true);
      assert(payment.paidAt);
      assert.strictEqual(payment.providerPaymentId, `pay_${TEST_TAG}_verify_payment`);
    });

    await test("Verify pending invoice returns isFinal=false and keeps order pending_payment", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify pending create");
      setMoyasarInvoice(createRes.body.data.invoiceId, { status: "initiated" });
      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(verifyRes, 200, "verify pending");
      assert.strictEqual(verifyRes.body.data.isFinal, false);
      assert.strictEqual(verifyRes.body.data.providerInvoiceStatus, "pending");
      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert.strictEqual(order.status, "pending_payment");
      assert.strictEqual(order.paymentStatus, "initiated");
    });

    await test("Verify mismatch paymentId returns MISMATCH", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify mismatch create");
      const otherPayment = await Payment.create({
        provider: "moyasar",
        type: "one_time_order",
        status: "initiated",
        amount: 2500,
        currency: "SAR",
        userId: ctx.user._id,
        orderId: createRes.body.data.orderId,
      });
      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${otherPayment._id}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(verifyRes, 409, "verify mismatch");
      assert.strictEqual(verifyRes.body.error.code, "MISMATCH");
    });

    await test("Verify non-owner returns NOT_FOUND", async () => {
      await Order.deleteMany({ userId: { $in: [ctx.user._id, ctx.otherUser._id] } });
      await Payment.deleteMany({ userId: { $in: [ctx.user._id, ctx.otherUser._id] } });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify non-owner create");
      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.otherToken))
        .send({});
      expectStatus(verifyRes, 404, "verify non-owner");
      assert.strictEqual(verifyRes.body.error.code, "NOT_FOUND");
    });

    await test("Verify expired/cancelled unpaid order returns ORDER_NOT_PAYABLE", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify not payable create");
      await Order.updateOne(
        { _id: createRes.body.data.orderId },
        { $set: { status: "expired", paymentStatus: "expired" } }
      );
      await Payment.updateOne({ _id: createRes.body.data.paymentId }, { $set: { status: "expired" } });
      const verifyRes = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(verifyRes, 409, "verify not payable");
      assert.strictEqual(verifyRes.body.error.code, "ORDER_NOT_PAYABLE");
    });

    await test("Verify is idempotent after already paid", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(createRes, 201, "verify idempotent create");
      setMoyasarInvoice(createRes.body.data.invoiceId, {
        status: "paid",
        payments: [{ id: `pay_${TEST_TAG}_idempotent`, status: "paid", amount: 2500, currency: "SAR" }],
      });
      const first = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(first, 200, "verify first paid");
      const second = await api
        .post(`/api/orders/${createRes.body.data.orderId}/payments/${createRes.body.data.paymentId}/verify`)
        .set(auth(ctx.token))
        .send({});
      expectStatus(second, 200, "verify second paid");
      assert.strictEqual(second.body.data.idempotent, true);
      assert.strictEqual(second.body.data.orderStatus, "confirmed");
      assert.strictEqual(second.body.data.paymentStatus, "paid");
    });

    await test("Webhook paid invoice confirms pending order and is idempotent", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const previousSecret = process.env.MOYASAR_WEBHOOK_SECRET;
      process.env.MOYASAR_WEBHOOK_SECRET = `${TEST_TAG}-secret`;
      try {
        const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
        expectStatus(createRes, 201, "webhook paid create");
        const payload = {
          secret_token: process.env.MOYASAR_WEBHOOK_SECRET,
          type: "invoice.paid",
          data: {
            id: createRes.body.data.invoiceId,
            status: "paid",
            amount: 2500,
            currency: "SAR",
            metadata: {
              source: "one_time_order",
              type: "one_time_order",
              orderId: createRes.body.data.orderId,
              paymentId: createRes.body.data.paymentId,
            },
          },
        };
        const first = await api.post("/api/webhooks/moyasar").send(payload);
        expectStatus(first, 200, "webhook paid first");
        const second = await api.post("/api/webhooks/moyasar").send(payload);
        expectStatus(second, 200, "webhook paid second");
        const [order, payment] = await Promise.all([
          Order.findById(createRes.body.data.orderId).lean(),
          Payment.findById(createRes.body.data.paymentId).lean(),
        ]);
        assert.strictEqual(order.status, "confirmed");
        assert.strictEqual(order.paymentStatus, "paid");
        assert.strictEqual(payment.status, "paid");
        assert.strictEqual(payment.applied, true);
      } finally {
        if (previousSecret === undefined) delete process.env.MOYASAR_WEBHOOK_SECRET;
        else process.env.MOYASAR_WEBHOOK_SECRET = previousSecret;
      }
    });

    await test("Webhook failed invoice cancels pending order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const previousSecret = process.env.MOYASAR_WEBHOOK_SECRET;
      process.env.MOYASAR_WEBHOOK_SECRET = `${TEST_TAG}-secret`;
      try {
        const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
        expectStatus(createRes, 201, "webhook failed create");
        const res = await api.post("/api/webhooks/moyasar").send({
          secret_token: process.env.MOYASAR_WEBHOOK_SECRET,
          type: "invoice.failed",
          data: {
            id: createRes.body.data.invoiceId,
            status: "failed",
            amount: 2500,
            currency: "SAR",
            metadata: {
              source: "one_time_order",
              type: "one_time_order",
              orderId: createRes.body.data.orderId,
              paymentId: createRes.body.data.paymentId,
            },
          },
        });
        expectStatus(res, 200, "webhook failed");
        const [order, payment] = await Promise.all([
          Order.findById(createRes.body.data.orderId).lean(),
          Payment.findById(createRes.body.data.paymentId).lean(),
        ]);
        assert.strictEqual(order.status, "cancelled");
        assert.strictEqual(order.paymentStatus, "failed");
        assert.strictEqual(payment.status, "failed");
      } finally {
        if (previousSecret === undefined) delete process.env.MOYASAR_WEBHOOK_SECRET;
        else process.env.MOYASAR_WEBHOOK_SECRET = previousSecret;
      }
    });

    await test("Webhook does not downgrade confirmed order", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const previousSecret = process.env.MOYASAR_WEBHOOK_SECRET;
      process.env.MOYASAR_WEBHOOK_SECRET = `${TEST_TAG}-secret`;
      try {
        const createRes = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
        expectStatus(createRes, 201, "webhook no downgrade create");
        await Order.updateOne(
          { _id: createRes.body.data.orderId },
          { $set: { status: "confirmed", paymentStatus: "paid", confirmedAt: new Date() } }
        );
        await Payment.updateOne(
          { _id: createRes.body.data.paymentId },
          { $set: { status: "paid", applied: true, paidAt: new Date() } }
        );
        const res = await api.post("/api/webhooks/moyasar").send({
          secret_token: process.env.MOYASAR_WEBHOOK_SECRET,
          type: "invoice.failed",
          data: {
            id: createRes.body.data.invoiceId,
            status: "failed",
            amount: 2500,
            currency: "SAR",
            metadata: {
              source: "one_time_order",
              type: "one_time_order",
              orderId: createRes.body.data.orderId,
              paymentId: createRes.body.data.paymentId,
            },
          },
        });
        expectStatus(res, 200, "webhook no downgrade");
        const order = await Order.findById(createRes.body.data.orderId).lean();
        assert.strictEqual(order.status, "confirmed");
        assert.strictEqual(order.paymentStatus, "paid");
      } finally {
        if (previousSecret === undefined) delete process.env.MOYASAR_WEBHOOK_SECRET;
        else process.env.MOYASAR_WEBHOOK_SECRET = previousSecret;
      }
    });

    await test("POST /api/orders does not create SubscriptionDay documents", async () => {
      await Order.deleteMany({ userId: ctx.user._id });
      await Payment.deleteMany({ userId: ctx.user._id });
      const before = await SubscriptionDay.countDocuments({});
      const res = await api.post("/api/orders").set(auth(ctx.token)).send(sandwichQuotePayload(ctx));
      expectStatus(res, 201, "no subscription day create");
      const after = await SubscriptionDay.countDocuments({});
      assert.strictEqual(after, before);
    });
  } finally {
    restoreMoyasarInvoiceMock();
    await restoreSettings();
    await cleanupCatalogData();
  }

  if (results.failed > 0) {
    console.error(`\n${results.failed} failed, ${results.passed} passed`);
    process.exit(1);
  }
  console.log(`\n${results.passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
