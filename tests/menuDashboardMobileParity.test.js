"use strict";

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
  assert.strictEqual(
    res.status,
    status,
    `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`
  );
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  assert(uri.includes("127.0.0.1") || uri.includes("localhost"), `unsafe test MongoDB URI: ${uri}`);
  assert(uri.includes(TEST_DB_NAME), `test MongoDB URI does not contain ${TEST_DB_NAME}: ${uri}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
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
  ).map((product) => ({
    ...product,
    categoryKey: category.key,
    categoryName: category.name,
    categorySortOrder: category.sortOrder,
  })));
}

function findMobileProduct(menu, productIdOrKey) {
  return flattenMobileProducts(menu).find((product) => (
    product.id === productIdOrKey || product.key === productIdOrKey
  ));
}

function flattenSubscriptionProducts(data) {
  const sections = [
    ...(data && data.builderCatalogV2 && data.builderCatalogV2.sections || []),
    ...(data && data.plannerCatalog && data.plannerCatalog.sections || []),
    ...(data && data.builderCatalog && data.builderCatalog.sections || []),
  ];
  return sections.flatMap((section) => (section.products || []).map((product) => ({
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
    nameEn: product.name && product.name.en || "",
    nameAr: product.name && product.name.ar || "",
    categoryId: String(product.categoryId || category.id || ""),
    categoryKey: category.key || "",
    priceHalala: Number(product.priceHalala || 0),
    imageUrl: product.imageUrl || "",
    sortOrder: Number(product.sortOrder || 0),
    availableFor: product.availableFor || [],
    isActive: product.isActive !== false,
  };
}

function normalizeMobileCommercial(product) {
  return {
    id: product.id,
    key: product.key,
    nameEn: product.nameI18n && product.nameI18n.en || product.name || "",
    nameAr: product.nameI18n && product.nameI18n.ar || "",
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
  for (const field of ["id", "key", "nameEn", "nameAr", "categoryId", "categoryKey", "priceHalala", "imageUrl", "sortOrder"]) {
    assert.strictEqual(mobile[field], dashboard[field], `${label}: ${field}`);
  }
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
  return api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
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

    res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({
      notes: `${TEST_TAG} initial publish`,
    });
    expectStatus(res, 200, "publish menu");

    let dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    let mobileMenu = await getMobileMenu(api);
    let mobileProduct = findMobileProduct(mobileMenu, primaryProduct.id);
    assert(mobileProduct, "created one-time product is present in mobile one-time menu");
    assertSharedCommercialFields(dashboardProduct, mobileProduct, "create and publish");
    assert.deepStrictEqual(normalizeDashboardCommercial(dashboardProduct).availableFor, ["one_time"]);

    // The production planner intentionally fails closed when there is no
    // subscription-selectable content. A one-time-only product must not turn an
    // empty subscription catalog into a successful response.
    let plannerResponse = await getSubscriptionPlanner(api);
    expectStatus(plannerResponse, 503, "empty subscription planner fails closed");
    assert.strictEqual(plannerResponse.body.error.code, "MEAL_PLANNER_CATALOG_EMPTY");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders).send({
      name: { en: `${TEST_TAG} Turkey Sandwich Updated`, ar: "ساندويتش تركي محدث" },
      priceHalala: 2150,
      sortOrder: 30,
    });
    expectStatus(res, 200, "update primary product commercial fields");

    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    mobileMenu = await getMobileMenu(api);
    mobileProduct = findMobileProduct(mobileMenu, primaryProduct.id);
    assert(mobileProduct, "updated product remains present in one-time menu");
    assertSharedCommercialFields(dashboardProduct, mobileProduct, "update propagation");
    assert.strictEqual(mobileProduct.nameI18n.en, `${TEST_TAG} Turkey Sandwich Updated`);
    assert.strictEqual(mobileProduct.priceHalala, 2150);
    assert.strictEqual(mobileProduct.sortOrder, 30);

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders).send({
      availableFor: ["one_time", "subscription"],
    });
    expectStatus(res, 200, "add subscription channel");

    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    assert.deepStrictEqual(
      normalizeDashboardCommercial(dashboardProduct).availableFor,
      ["one_time", "subscription"]
    );
    plannerResponse = await getSubscriptionPlanner(api);
    expectStatus(plannerResponse, 200, "subscription planner after enabling channel");
    const subscriptionProducts = flattenSubscriptionProducts(plannerResponse.body.data);
    assert(
      subscriptionProducts.some((product) => product.id === primaryProduct.id && product.key === primaryProduct.key),
      "subscription-enabled product appears in subscription planner"
    );

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/visibility`).set(adminHeaders).send({ isVisible: false });
    expectStatus(res, 200, "hide product");
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id), "hidden product is absent from mobile menu");
    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/visibility`).set(adminHeaders).send({ isVisible: true });
    expectStatus(res, 200, "restore visibility");

    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/availability`).set(adminHeaders).send({ isAvailable: false });
    expectStatus(res, 200, "mark unavailable");
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id), "unavailable product is absent from mobile menu");
    res = await api.patch(`/api/dashboard/menu/products/${primaryProduct.id}/availability`).set(adminHeaders).send({ isAvailable: true });
    expectStatus(res, 200, "restore availability");

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
      "mobile menu preserves backend order"
    );

    res = await api.delete(`/api/dashboard/menu/products/${primaryProduct.id}`).set(adminHeaders);
    expectStatus(res, 200, "soft archive primary product");
    assert.strictEqual(res.body.data.id, primaryProduct.id);
    assert.strictEqual(res.body.data.isActive, false);
    dashboardProduct = await getDashboardProduct(api, primaryProduct.id);
    assert.strictEqual(dashboardProduct.product.isActive, false);
    assert(!findMobileProduct(await getMobileMenu(api), primaryProduct.id));
    const persisted = await MenuProduct.findById(primaryProduct.id).lean();
    assert(persisted && persisted.isActive === false, "soft-archived product remains persisted and inactive");

    console.log("menu dashboard mobile parity checks passed");
  } finally {
    await cleanup();
    await disconnect();
  }
}

main().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try { await disconnect(); } catch (_error) {}
  process.exit(1);
});
