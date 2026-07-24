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
const AppUser = require("../src/models/AppUser");
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
  } catch (error) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function expectStatus(response, expected, label) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

function appAuth(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) =>
    (category.products || []).map((product) => ({
      ...product,
      categoryKey: category.key,
    }))
  );
}

function selectedRequiredOptions(product) {
  return (product.optionGroups || []).flatMap((group) => {
    const count = Number(group.minSelections || 0);
    if (count <= 0) return [];
    assert(
      (group.options || []).length >= count,
      `${product.key}.${group.key} has enough options`
    );
    return group.options.slice(0, count).map((option) => ({
      groupId: group.id,
      optionId: option.id,
    }));
  });
}

async function startMemoryMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
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
      const error = new Error(`Mock invoice not found: ${invoiceId}`);
      error.status = 404;
      throw error;
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

async function resetAndSeedCatalog() {
  await mongoose.connection.db.dropDatabase();
  await Promise.all([
    ActivityLog.deleteMany({}),
    Payment.deleteMany({}),
    Order.deleteMany({}),
    ProductOptionGroup.deleteMany({}),
    ProductGroupOption.deleteMany({}),
    MenuVersion.deleteMany({}),
    MenuOption.deleteMany({}),
    MenuOptionGroup.deleteMany({}),
    MenuProduct.deleteMany({}),
    MenuCategory.deleteMany({}),
    Setting.deleteMany({ key: "vat_percentage" }),
  ]);
  await Setting.updateOne(
    { key: "vat_percentage" },
    { $set: { value: 15, description: `${TEST_TAG} VAT` } },
    { upsert: true }
  );
  await seedOneTimeMenu({
    actor: { role: "test" },
    notes: TEST_TAG,
    mode: "force",
  });
}

(async function run() {
  const restoreMoyasar = installMoyasarMock();
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://api.example.test";

  try {
    await startMemoryMongo();
    await resetAndSeedCatalog();

    const app = createApp();
    const api = request(app);
    const user = await User.create({
      phone: `${TEST_TAG}-+966500000000`,
      name: `${TEST_TAG} Client`,
      role: "client",
      isActive: true,
    });
    const clientHeaders = appAuth(user._id);
    const { headers: adminHeaders } = await dashboardAuth(
      "superadmin",
      TEST_TAG
    );

    await test(
      "complete one-time pickup order lifecycle from menu to fulfillment",
      async () => {
        const menuResponse = await api.get("/api/orders/menu?lang=en");
        expectStatus(menuResponse, 200, "menu");
        assert.strictEqual(menuResponse.body.status, true);
        assert.strictEqual(menuResponse.body.data.fulfillmentMethod, "pickup");
        assert.strictEqual(menuResponse.body.data.vatIncluded, true);
        assert.strictEqual(menuResponse.body.data.delivery, undefined);

        const menuProducts = flattenProducts(menuResponse.body.data);
        const fixedProducts = menuProducts.filter(
          (product) => product.pricingModel === "fixed"
        );
        assert(
          fixedProducts.length >= 2,
          "menu has at least two ready fixed-price products"
        );
        const primaryProduct = fixedProducts[0];
        const secondaryProduct = fixedProducts.find(
          (product) => product.id !== primaryProduct.id
        );
        assert(secondaryProduct, "second fixed-price product exists");

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
              productId: primaryProduct.id,
              qty: 2,
              selectedOptions: selectedRequiredOptions(primaryProduct),
            },
            {
              productId: secondaryProduct.id,
              qty: 1,
              selectedOptions: selectedRequiredOptions(secondaryProduct),
            },
          ],
          successUrl: "basicdiet://orders/payment-success",
          backUrl: "basicdiet://orders/payment-cancel",
        };

        const quoteResponse = await api
          .post("/api/orders/quote")
          .set(clientHeaders)
          .send(orderBody);
        expectStatus(quoteResponse, 200, "quote");
        assert.strictEqual(quoteResponse.body.status, true);
        assert(quoteResponse.body.data.pricing.totalHalala > 0);
        assert.strictEqual(
          quoteResponse.body.data.pricing.deliveryFeeHalala,
          0
        );

        const idempotencyKey = `${TEST_TAG}-create-order`;
        const createResponse = await api
          .post("/api/orders")
          .set({ ...clientHeaders, "Idempotency-Key": idempotencyKey })
          .send(orderBody);
        expectStatus(createResponse, 201, "create order");
        assert.strictEqual(createResponse.body.data.status, "pending_payment");
        assert(createResponse.body.data.orderId);
        assert(createResponse.body.data.paymentId);
        assert(createResponse.body.data.paymentUrl);

        assert.strictEqual(invoicePayloads.length, 1);
        assert.strictEqual(
          invoicePayloads[0].successUrl,
          "https://api.example.test/payment-success"
        );
        assert.strictEqual(
          invoicePayloads[0].backUrl,
          "https://api.example.test/payment-cancel"
        );
        assert.strictEqual(
          invoicePayloads[0].callbackUrl,
          "https://api.example.test/api/webhooks/moyasar"
        );

        const retryResponse = await api
          .post("/api/orders")
          .set({ ...clientHeaders, "Idempotency-Key": idempotencyKey })
          .send(orderBody);
        expectStatus(retryResponse, 200, "retry create");
        assert.strictEqual(retryResponse.body.data.reused, true);
        assert.strictEqual(
          retryResponse.body.data.orderId,
          createResponse.body.data.orderId
        );
        assert.strictEqual(invoicePayloads.length, 1);

        const createdOrder = await Order.findById(
          createResponse.body.data.orderId
        ).lean();
        assert(createdOrder);
        assert.strictEqual(createdOrder.fulfillmentMethod, "pickup");
        assert.strictEqual(createdOrder.pickup.branchId, "main");
        assert.strictEqual(createdOrder.pickup.branchName.en, "Main Branch");
        assert.strictEqual(createdOrder.pickup.pickupWindow, "18:00-20:00");
        assert(
          createdOrder.items.every((item) => item.productSnapshot),
          "product snapshots persisted"
        );
        assert(
          createdOrder.items.every((item) => item.pricingSnapshot),
          "pricing snapshots persisted"
        );
        createdOrder.items.forEach((item, index) => {
          assert.strictEqual(
            item.pricingSnapshot.unitPriceHalala,
            quoteResponse.body.data.items[index].pricingSnapshot
              .unitPriceHalala
          );
          assert.strictEqual(
            item.pricingSnapshot.lineTotalHalala,
            quoteResponse.body.data.items[index].pricingSnapshot
              .lineTotalHalala
          );
        });

        const originalSnapshotNames = createdOrder.items.map(
          (item) => item.productSnapshot.name.en
        );
        await MenuProduct.updateOne(
          { _id: primaryProduct.id },
          {
            $set: {
              name: {
                en: `${TEST_TAG} Mutated Product`,
                ar: "منتج معدل",
              },
              priceHalala: 999999,
            },
          }
        );
        const orderAfterMutation = await Order.findById(
          createResponse.body.data.orderId
        ).lean();
        assert.deepStrictEqual(
          orderAfterMutation.items.map(
            (item) => item.productSnapshot.name.en
          ),
          originalSnapshotNames,
          "order snapshots remain immutable"
        );

        invoiceResponses.set(createResponse.body.data.invoiceId, {
          id: createResponse.body.data.invoiceId,
          status: "paid",
          amount: createResponse.body.data.pricing.totalHalala,
          currency: "SAR",
          payments: [
            {
              id: `pay_${TEST_TAG}_manual_verify`,
              status: "paid",
              amount: createResponse.body.data.pricing.totalHalala,
              currency: "SAR",
            },
          ],
        });

        const verifyResponse = await api
          .post(
            `/api/orders/${createResponse.body.data.orderId}/payments/${createResponse.body.data.paymentId}/verify`
          )
          .set(clientHeaders)
          .send({});
        expectStatus(verifyResponse, 200, "verify payment");
        assert.strictEqual(verifyResponse.body.data.orderStatus, "confirmed");
        assert.strictEqual(verifyResponse.body.data.paymentStatus, "paid");
        assert.strictEqual(verifyResponse.body.data.applied, true);

        const expectedCustomerName = `${TEST_TAG} App Profile`;
        await AppUser.create({
          coreUserId: user._id,
          phone: user.phone,
          fullName: expectedCustomerName,
        });
        await User.updateOne({ _id: user._id }, { $unset: { name: 1 } });

        const expectedLabels = {
          confirmed: "Confirmed",
          in_preparation: "Preparing",
          ready_for_pickup: "Ready for pickup",
          fulfilled: "Fulfilled",
        };
        const actionIds = (row) =>
          (row.allowedActions || []).map((action) => action.id);

        const getOpsOrder = async (expectedStatus) => {
          const response = await api
            .get(`/api/dashboard/ops/list?date=${fulfillmentDate}`)
            .set(adminHeaders);
          expectStatus(response, 200, `ops list ${expectedStatus}`);
          const row = response.body.data.find(
            (item) => item.orderId === createResponse.body.data.orderId
          );
          assert(row, `ops list includes order in ${expectedStatus}`);
          assert.strictEqual(row.status, expectedStatus);
          assert.strictEqual(row.statusLabel, expectedLabels[expectedStatus]);
          return row;
        };

        const executeAction = async (action, expectedStatus) => {
          const response = await api
            .post(`/api/dashboard/ops/actions/${action}`)
            .set(adminHeaders)
            .send({
              entityId: createResponse.body.data.orderId,
              entityType: "order",
              source: "one_time_order",
            });
          expectStatus(response, 200, `ops action ${action}`);
          assert.strictEqual(response.body.data.status, expectedStatus);
          const nextRow = await getOpsOrder(expectedStatus);
          assert.deepStrictEqual(
            actionIds(response.body.data),
            actionIds(nextRow)
          );
          return nextRow;
        };

        let opsRow = await getOpsOrder("confirmed");
        assert.strictEqual(opsRow.customer.name, expectedCustomerName);
        assert.deepStrictEqual(actionIds(opsRow), ["prepare", "cancel"]);
        assert.strictEqual(opsRow.kitchenDetails, undefined);
        assert.strictEqual(opsRow.kitchen.version, "v2");
        assert.strictEqual(opsRow.kitchen.cards.length, 2);
        assert.strictEqual(
          opsRow.fulfillment.pickup.branchName.en,
          "Main Branch"
        );
        assert.strictEqual(
          opsRow.fulfillment.pickup.pickupWindow,
          "18:00-20:00"
        );

        const confirmedDetailResponse = await api
          .get(`/api/dashboard/orders/${createResponse.body.data.orderId}`)
          .set(adminHeaders);
        expectStatus(confirmedDetailResponse, 200, "confirmed order detail");
        const confirmedDetail = confirmedDetailResponse.body.data;
        assert.strictEqual(confirmedDetail.items.length, 2);
        assert.strictEqual(
          confirmedDetail.pricing.totalHalala,
          createdOrder.pricing.totalHalala
        );

        const persistedSecondaryItem = createdOrder.items.find(
          (item) => item.productSnapshot.key === secondaryProduct.key
        );
        const detailSecondaryItem = confirmedDetail.items.find(
          (item) => item.productSnapshot?.key === secondaryProduct.key
        );
        assert(persistedSecondaryItem);
        assert(detailSecondaryItem);
        assert.strictEqual(
          detailSecondaryItem.productSnapshot.name.en,
          persistedSecondaryItem.productSnapshot.name.en
        );
        assert.strictEqual(
          detailSecondaryItem.unitPriceHalala,
          persistedSecondaryItem.pricingSnapshot.unitPriceHalala
        );
        assert.strictEqual(
          detailSecondaryItem.lineTotalHalala,
          persistedSecondaryItem.pricingSnapshot.lineTotalHalala
        );
        assert(
          opsRow.kitchen.cards.some(
            (card) =>
              card.titleI18n?.en ===
                persistedSecondaryItem.productSnapshot.name.en ||
              card.title === persistedSecondaryItem.productSnapshot.name.en
          ),
          "kitchen card preserves snapshot name"
        );

        opsRow = await executeAction("prepare", "in_preparation");
        assert.deepStrictEqual(actionIds(opsRow), [
          "ready_for_pickup",
          "cancel",
        ]);
        opsRow = await executeAction(
          "ready_for_pickup",
          "ready_for_pickup"
        );
        assert.deepStrictEqual(actionIds(opsRow), ["fulfill", "cancel"]);
        assert(opsRow.fulfillment.pickup.pickupCode);
        opsRow = await executeAction("fulfill", "fulfilled");
        assert.deepStrictEqual(actionIds(opsRow), []);

        const listResponse = await api
          .get("/api/dashboard/orders")
          .set(adminHeaders);
        expectStatus(listResponse, 200, "dashboard list");
        const listedOrder = listResponse.body.data.items.find(
          (item) => item.orderId === createResponse.body.data.orderId
        );
        assert(listedOrder);
        assert.strictEqual(listedOrder.status, "fulfilled");

        const finalDetailResponse = await api
          .get(`/api/dashboard/orders/${createResponse.body.data.orderId}`)
          .set(adminHeaders);
        expectStatus(finalDetailResponse, 200, "final detail");
        const finalDetail = finalDetailResponse.body.data;
        assert.strictEqual(finalDetail.status, "fulfilled");
        assert.strictEqual(finalDetail.fulfillmentMethod, "pickup");
        assert.strictEqual(finalDetail.items.length, 2);
        assert.deepStrictEqual(finalDetail.delivery, {});

        const activityActions = new Set(
          (finalDetail.activity || []).map((entry) => entry.action)
        );
        [
          "order_created",
          "order_payment_confirmed",
          "dashboard_order_prepare",
          "dashboard_order_ready_for_pickup",
          "dashboard_order_fulfill",
        ].forEach((action) =>
          assert(activityActions.has(action), `activity includes ${action}`)
        );

        const finalOrder = await Order.findById(
          createResponse.body.data.orderId
        ).lean();
        const finalPayment = await Payment.findById(
          createResponse.body.data.paymentId
        ).lean();
        assert.strictEqual(finalOrder.status, "fulfilled");
        assert.strictEqual(finalOrder.paymentStatus, "paid");
        assert.strictEqual(finalPayment.status, "paid");
        assert.strictEqual(finalPayment.applied, true);
      }
    );
  } finally {
    restoreMoyasar();
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await disconnect();
  }

  console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exitCode = 1;
})().catch(async (error) => {
  console.error("❌ one-time order full flow test crashed");
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exitCode = 1;
});
