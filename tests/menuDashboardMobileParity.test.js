process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuVersion = require("../src/models/MenuVersion");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const TEST_TAG = `menu-dashboard-mobile-parity-${Date.now()}`;
const TEST_KEY_TAG = TEST_TAG.replace(/-/g, "_");
const TEST_DB_NAME = `${TEST_KEY_TAG}_test`;

let replSet;
let adminHeaders;

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function assertSafeMongoUri(uri) {
  assert(uri && typeof uri === "string", "test MongoDB URI is required");
  assert(
    uri.includes("127.0.0.1") || uri.includes("localhost"),
    `refusing non-local MongoDB URI: ${uri}`
  );
  assert(
    uri.includes(TEST_DB_NAME),
    `refusing MongoDB URI without isolated test database ${TEST_DB_NAME}: ${uri}`
  );
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: TEST_DB_NAME,
    },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  assertSafeMongoUri(uri);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
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

async function cleanup() {
  if (mongoose.connection.readyState !== 1) return;
  const keyRegex = new RegExp(TEST_KEY_TAG);
  const nameRegex = new RegExp(TEST_TAG);
  const [categories, products] = await Promise.all([
    MenuCategory.find({ $or: [{ key: keyRegex }, { "name.en": nameRegex }] }).select("_id").lean(),
    MenuProduct.find({ $or: [{ key: keyRegex }, { "name.en": nameRegex }] }).select("_id").lean(),
  ]);
  const categoryIds = categories.map((row) => row._id);
  const productIds = products.map((row) => row._id);
  await Promise.all([
    MenuAuditLog.deleteMany({ entityId: { $in: [...categoryIds, ...productIds] } }),
    MenuVersion.deleteMany({ notes: { $regex: TEST_TAG } }),
    MenuProduct.deleteMany({ _id: { $in: productIds } }),
    MenuCategory.deleteMany({ _id: { $in: categoryIds } }),
  ]);
}

function flattenMobileProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    category.products || []
  ).map((product, index) => ({
    ...product,
    categoryKey: category.key,
    categoryName: category.name,
    categorySortOrder: category.sortOrder,
    index,
  })));
}

function findMobileProduct(menu, productIdOrKey) {
  return flattenMobileProducts(menu).find((product) => (
    product.id === productIdOrKey || product.key === productIdOrKey
  ));
}

function flattenSubscriptionProducts(data) {
  const sections = [
    ...(data?.builderCatalogV2?.sections || []),
    ...(data?.plannerCatalog?.sections || []),
    ...(data?.builderCatalog?.sections || []),
  ];
  return sections.flatMap((section) => (
    section.products || []
  ).map((product) => ({
    ...product,
    sectionKey: section.key || section.selectionType,
  })));
}

function normalizeDashboardCommercial(productDetail) {
  const product = productDetail.product || productDetail;
  const category = productDetail.category || {};
  return {
    id: product.id,
    key: product.key,
    nameEn: product.name?.en || "",
    nameAr: product.name?.ar || "",
    categoryId: String(product.categoryId || category.id || ""),
    categoryKey: category.key || "",
    priceHalala: Number(product.priceHalala || 0),
    imageUrl: product.imageUrl || "",
    sortOrder: Number(product.sortOrder || 0),
    isActive: product.isActive !== false,
    isVisible: product.isVisible !== false,
    isAvailable: product.isAvailable !== false,
    availableFor: product.availableFor || [],
  };
}

function normalizeMobileCommercial(product) {
  return {
    id: product.id,
    key: product.key,
    nameEn: product.nameI18n?.en || product.name || "",
    nameAr: product.nameI18n?.ar || "",
    categoryId: String(product.categoryId || ""),
    categoryKey: product.categoryKey || "",
    priceHalala: Number(product.priceHalala || 0),
    imageUrl: product.imageUrl || "",
    sortOrder: Number(product.sortOrder || 0),
  };
}

function assertSharedCommercialFields(dashboardProduct, mobileProduct, label) {
  const dashboard = normalizeDashboardCommercial(dashboardProduct);
  const mobile = normalizeMobileCommercial(mobileProduct);

  assert.strictEqual(mobile.id, dashboard.id, `${label}: shared MenuProduct identity`);
  assert.strictEqual(mobile.key, dashboard.key, `${label}: key`);
  assert.strictEqual(mobile.nameEn, dashboard.nameEn, `${label}: English display name`);
  assert.strictEqual(mobile.nameAr, dashboard.nameAr, `${label}: Arabic display name`);
  assert.strictEqual(mobile.categoryId, dashboard.categoryId, `${label}: category identity`);
  assert.strictEqual(mobile.categoryKey, dashboard.categoryKey, `${label}: category key`);
  assert.strictEqual(mobile.priceHalala, dashboard.priceHalala, `${label}: priceHalala`);
  assert.strictEqual(mobile.imageUrl, dashboard.imageUrl, `${label}: imageUrl`);
  assert.strictEqual(mobile.sortOrder, dashboard.sortOrder, `${label}: sortOrder`);

  // Intentionally excluded from the mobile product card: administrative
  // isActive/isVisible/isAvailable/availableFor fields. Dashboard reads and
  // public presence/absence assertions verify those policies directly.
}

async function getDashboardProduct(api, productId) {
  const res = await api.get(`/api/dashboard/menu/products/${productId}`).set(adminHeaders);
  expectStatus(res, 200, `dashboard product ${productId}`);
  return res.body.data;
}

async function getMobileMenu(api) {
  const res = await api.get("/api/orders/menu?includePublicV2=true&lang=en");
  expectStatus(res, 200, "mobile one-time menu");
  return res.body.data;
}

async function getSubscriptionPlanner(api) {
  const res = await api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
  expectStatus(res, 200, "subscription planner menu");
  return res.body.data;
}

async function main() {
  await connect();
  try {
    await cleanup();
    const api = request(createApp());
    ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));

    let res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_cold_sandwiches`,
      name: { en: `${TEST_TAG} Sandwiches`, ar: "ساندويتشات اختبار" },
      description: { en: `${TEST_TAG} category`, ar: "تصنيف اختبار" },
      imageUrl: "https://cdn.example.test/menu-parity/category.png",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 20,
    });
    expectStatus(res, 201, "create category");
    const category = res.body.data;

    const primaryCreatePayload = {
      categoryId: category.id,
      key: `${TEST_KEY_TAG}_primary`,
      name: { en: `${TEST_TAG} Turkey Sandwich`, ar: "ساندويتش تركي اختبار" },
      description: { en: `${TEST_TAG} original`, ar: "وصف اختبار" },
      imageUrl: "https://cdn.example.test/menu-parity/primary.png",
      itemType: "cold_sandwich",
      pricingModel: "fixed",
      priceHalala: 1750,
      sortOrder: 10,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      availableFor: ["one_time"],
    };
    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send(primaryCreatePayload);
    expectStatus(res, 201, "create primary product");
    const primaryProduct = res.body.data;

    res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} initial publish` });
    expectStatus(res, 200, "publish menu");

    let dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    let mobileMenu = await getMobileMenu(api);
    let mobileProduct = findMobileProduct(mobileMenu, primaryProduct.id);
    assert(mobileProduct, "created one-time product is present in mobile one-time menu");
    assertSharedCommercialFields(dashboardProduct, mobileProduct, "create and publish");
    assert.deepStrictEqual(normalizeDashboardCommercial(dashboardProduct).availableFor, ["one_time"], "dashboard read preserves one_time channel");

    let subscriptionProducts = flattenSubscriptionProducts(await getSubscriptionPlanner(api));
    assert(!subscriptionProducts.some((product) => product.id === primaryProduct.id || product.key === primaryProduct.key), "one_time-only product is absent from subscription planner");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders).send({
      name: { en: `${TEST_TAG} Turkey Sandwich Updated`, ar: "ساندويتش تركي محدث" },
      priceHalala: 2150,
      sortOrder: 30,
    });
    expectStatus(res, 200, "update primary product commercial fields");

    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    mobileMenu = await getMobileMenu(api);
    mobileProduct = findMobileProduct(mobileMenu, primaryProduct.id);
    assert(mobileProduct, "updated product remains present in mobile one-time menu");
    assertSharedCommercialFields(dashboardProduct, mobileProduct, "update propagation");
    assert.strictEqual(mobileProduct.nameI18n.en, `${TEST_TAG} Turkey Sandwich Updated`, "mobile shows updated name");
    assert.strictEqual(mobileProduct.priceHalala, 2150, "mobile shows updated price");
    assert.strictEqual(mobileProduct.sortOrder, 30, "mobile shows updated sort order");
    assert(!flattenMobileProducts(mobileMenu).some((product) => product.nameI18n?.en === primaryCreatePayload.name.en), "old name is absent from fresh mobile response");
    assert.strictEqual(mobileProduct.id, primaryProduct.id, "product identity remains stable after update");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders).send({
      availableFor: ["one_time", "subscription"],
    });
    expectStatus(res, 200, "add subscription channel");

    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    assert.deepStrictEqual(
      normalizeDashboardCommercial(dashboardProduct).availableFor,
      ["one_time", "subscription"],
      "dashboard read preserves expanded channels"
    );
    mobileProduct = findMobileProduct(await getMobileMenu(api), primaryProduct.id);
    assert(mobileProduct, "expanded channel product remains present in one-time menu");
    subscriptionProducts = flattenSubscriptionProducts(await getSubscriptionPlanner(api));
    assert(subscriptionProducts.some((product) => product.id === primaryProduct.id && product.key === primaryProduct.key), "subscription channel product appears in subscription planner");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/visibility`).set(adminHeaders).send({ isVisible: false });
    expectStatus(res, 200, "hide product");
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id), "hidden product is absent from mobile one-time menu");
    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/visibility`).set(adminHeaders).send({ isVisible: true });
    expectStatus(res, 200, "restore product visibility");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/availability`).set(adminHeaders).send({ isAvailable: false });
    expectStatus(res, 200, "mark product unavailable");
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id), "unavailable product is absent from mobile one-time menu");
    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/availability`).set(adminHeaders).send({ isAvailable: true });
    expectStatus(res, 200, "restore product availability");

    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: category.id,
      key: `${TEST_KEY_TAG}_secondary`,
      name: { en: `${TEST_TAG} Chicken Sandwich`, ar: "ساندويتش دجاج اختبار" },
      imageUrl: "https://cdn.example.test/menu-parity/secondary.png",
      itemType: "cold_sandwich",
      pricingModel: "fixed",
      priceHalala: 1950,
      sortOrder: 40,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      availableFor: ["one_time"],
    });
    expectStatus(res, 201, "create second product");
    const secondaryProduct = res.body.data;

    res = await api.patch("/api/dashboard/menu/products/reorder").set(adminHeaders).send({
      items: [
        { id: secondaryProduct.id, sortOrder: 5 },
        { id: primaryProduct.id, sortOrder: 15 },
      ],
    });
    expectStatus(res, 200, "reorder products");

    mobileMenu = await getMobileMenu(api);
    const categoryProducts = (mobileMenu.categories.find((row) => row.id === category.id)?.products || [])
      .filter((product) => [primaryProduct.id, secondaryProduct.id].includes(product.id));
    assert.deepStrictEqual(
      categoryProducts.map((product) => product.id),
      [secondaryProduct.id, primaryProduct.id],
      "mobile menu preserves backend product order"
    );

    res = await api.delete(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders);
    expectStatus(res, 200, "soft archive primary product");
    assert.strictEqual(res.body.data.id, primaryProduct.id, "archive response keeps product identity");
    assert.strictEqual(res.body.data.isActive, false, "archive response marks product inactive");

    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    assert.strictEqual(dashboardProduct.product.isActive, false, "dashboard detail still returns soft-archived product as inactive");
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id), "archived product is absent from mobile one-time menu");
    const persisted = await MenuProduct.findById(primaryProduct.id).lean();
    assert(persisted, "soft-archived product remains persisted");
    assert.strictEqual(persisted.isActive, false, "persisted product is inactive after soft archive");

    console.log("menu dashboard mobile parity checks passed");
  } finally {
    await cleanup();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
