process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const TEST_TAG = `meal-builder-dashboard-mobile-parity-${Date.now()}`;
const TEST_KEY_TAG = TEST_TAG.replace(/-/g, "_");
const TEST_DB_NAME = `${TEST_KEY_TAG}_test`;
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

let replSet;
let adminHeaders;

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "31d" }
  );
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
    instanceOpts: [{ args: ["--setParameter", "maxTransactionLockRequestTimeoutMillis=20000"] }],
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  assert(uri.includes("127.0.0.1") || uri.includes("localhost"), `refusing non-local MongoDB URI: ${uri}`);
  assert(uri.includes(TEST_DB_NAME), `refusing MongoDB URI without isolated test db: ${uri}`);
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

async function createClientContext() {
  const user = await User.create({ phone: `+9665${Date.now().toString().slice(-8)}`, password: "password" });
  const subscription = await Subscription.create({
    userId: user._id,
    status: "active",
    planId: new mongoose.Types.ObjectId(),
    startDate: "2026-10-01",
    endDate: "2026-10-30",
    totalMeals: 30,
    remainingMeals: 30,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    premiumBalance: [],
  });
  return {
    subscription,
    auth: { Authorization: `Bearer ${issueAppAccessToken(user._id)}`, "Accept-Language": "en" },
  };
}

function flattenPlannerProducts(plannerCatalog) {
  return (plannerCatalog?.sections || []).flatMap((section) => (
    section.products || []
  ).map((product) => ({ ...product, sectionKey: section.key })));
}

function findPlannerProduct(plannerCatalog, productId) {
  return flattenPlannerProducts(plannerCatalog).find((product) => String(product.id || product.productId) === String(productId));
}

function findProductGroup(product, groupId) {
  return (product?.optionGroups || []).find((group) => String(group.groupId || group.id) === String(groupId));
}

function optionIds(group) {
  return (group?.options || []).map((option) => String(option.optionId || option.id));
}

function assertGroupProjection({ dashboardGroup, mobileGroup, expected }) {
  assert(dashboardGroup, "Dashboard Meal Builder planner exposes linked group");
  assert(mobileGroup, "Mobile v3 planner exposes linked group");
  assert.strictEqual(String(dashboardGroup.groupId || dashboardGroup.id), expected.groupId, "Dashboard group identity");
  assert.strictEqual(String(mobileGroup.groupId || mobileGroup.id), expected.groupId, "Mobile group identity");
  assert.strictEqual(dashboardGroup.key, expected.groupKey, "Dashboard group key");
  assert.strictEqual(mobileGroup.key, expected.groupKey, "Mobile group key");
  assert.strictEqual(mobileGroup.minSelections, expected.minSelections, "Mobile group minSelections");
  assert.strictEqual(mobileGroup.maxSelections, expected.maxSelections, "Mobile group maxSelections");
  assert.deepStrictEqual(optionIds(mobileGroup), expected.optionIds, "Mobile options preserve relation order");
  assert.deepStrictEqual((mobileGroup.options || []).map((option) => option.key), expected.optionKeys, "Mobile option keys");
  assert.deepStrictEqual(optionIds(dashboardGroup), expected.optionIds, "Dashboard planner options match Mobile");
}

function canonicalBody(selection) {
  return {
    contractVersion: selection.contractVersion,
    mealSlots: [{
      slotIndex: 1,
      selectionType: selection.product.selectionType,
      productId: selection.product.id || selection.product.productId,
      selectedOptions: [{
        groupId: selection.group.groupId || selection.group.id,
        optionId: selection.option.optionId || selection.option.id,
        quantity: 1,
      }],
    }],
  };
}

async function validateSelection(api, subscriptionId, date, auth, body) {
  return api
    .post(`/api/subscriptions/${subscriptionId}/days/${date}/selection/validate`)
    .set(auth)
    .send(body);
}

async function createFixture(api) {
  let res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
    key: "custom_order",
    name: { en: `${TEST_TAG} Custom Order`, ar: "طلبات مخصصة اختبار" },
    description: { en: `${TEST_TAG} category`, ar: "تصنيف اختبار" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
  });
  expectStatus(res, 201, "create active category");
  const category = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: "basic_meal",
    name: { en: `${TEST_TAG} Basic Meal`, ar: "وجبة أساسية اختبار" },
    description: { en: `${TEST_TAG} product`, ar: "منتج اختبار" },
    imageUrl: "https://cdn.example.test/meal-builder-parity/basic-meal.png",
    itemType: "basic_meal",
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
  });
  expectStatus(res, 201, "create subscription product");
  const product = res.body.data;

  res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
    key: "proteins",
    name: { en: `${TEST_TAG} Proteins`, ar: "بروتين اختبار" },
    description: { en: `${TEST_TAG} group`, ar: "مجموعة اختبار" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
    ui: { displayStyle: "radio_cards" },
  });
  expectStatus(res, 201, "create option group");
  const group = res.body.data;

  const optionPayloads = [
    {
      key: `${TEST_KEY_TAG}_grilled_chicken`,
      name: "Grilled Chicken",
      familyKey: "chicken",
      sortOrder: 10,
    },
    {
      key: `${TEST_KEY_TAG}_chicken_strips`,
      name: "Chicken Strips",
      familyKey: "chicken",
      sortOrder: 20,
    },
  ];
  const options = [];
  for (const payload of optionPayloads) {
    res = await api.post(`/api/dashboard/menu/option-groups/${group.id}/options`).set(adminHeaders).send({
      key: payload.key,
      name: { en: `${TEST_TAG} ${payload.name}`, ar: payload.name },
      description: { en: `${payload.name} option`, ar: payload.name },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      proteinFamilyKey: payload.familyKey,
      displayCategoryKey: payload.familyKey,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: payload.sortOrder,
    });
    expectStatus(res, 201, `create option ${payload.key}`);
    assert.strictEqual(res.body.data.selectionType, "standard_meal", "created option preserves selectionType");
    assert.strictEqual(res.body.data.proteinFamilyKey, payload.familyKey, "created option preserves protein family");
    assert.strictEqual(res.body.data.displayCategoryKey, payload.familyKey, "created option preserves display family");
    options.push(res.body.data);
  }

  res = await api.post(`/api/dashboard/menu/products/${product.id}/option-groups`).set(adminHeaders).send({
    groupId: group.id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
  });
  expectStatus(res, 201, "attach product group relation");
  const productGroupRelation = res.body.data;

  for (const option of options) {
    res = await api.post(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options`).set(adminHeaders).send({
      optionId: option.id,
      extraPriceHalala: 0,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: option.sortOrder,
    });
    expectStatus(res, 201, `attach option ${option.key}`);
  }

  res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} publish menu` });
  expectStatus(res, 200, "publish menu catalog");

  res = await api.post("/api/dashboard/meal-builder/draft").set(adminHeaders).send({
    notes: `${TEST_TAG} draft`,
    sections: [{
      key: `${TEST_KEY_TAG}_standard_proteins`,
      sectionType: "option_group",
      sourceKind: "configurable_product",
      productContextId: product.id,
      sourceGroupId: group.id,
      selectedOptionIds: options.map((option) => option.id),
      selectionType: "standard_meal",
      titleOverride: { en: `${TEST_TAG} Proteins`, ar: "بروتين اختبار" },
      required: true,
      minSelections: 1,
      maxSelections: 1,
      multiSelect: false,
      visible: true,
      availableFor: ["subscription"],
      sortOrder: 10,
    }],
  });
  expectStatus(res, 201, "create Meal Builder draft");

  res = await api.post("/api/dashboard/meal-builder/publish").set(adminHeaders).send({ notes: `${TEST_TAG} publish builder` });
  expectStatus(res, 200, "publish Meal Builder");

  const [persistedGroupRelation, persistedOptionRelations] = await Promise.all([
    ProductOptionGroup.findOne({ productId: product.id, groupId: group.id }).lean(),
    ProductGroupOption.find({ productId: product.id, groupId: group.id }).sort({ sortOrder: 1 }).lean(),
  ]);
  assert(persistedGroupRelation, "product-group relation is persisted");
  assert.strictEqual(persistedOptionRelations.length, 2, "two product-option relations are persisted");

  return {
    category,
    product,
    group,
    options,
    productGroupRelation,
    expected: {
      productId: product.id,
      groupId: group.id,
      groupKey: group.key,
      minSelections: 1,
      maxSelections: 1,
      optionIds: options.map((option) => option.id),
      optionKeys: options.map((option) => option.key),
    },
  };
}

async function readPlannerState(api, fixture) {
  let res = await api.get("/api/dashboard/meal-builder").set(adminHeaders);
  expectStatus(res, 200, "Dashboard Meal Builder read");
  const dashboardProduct = findPlannerProduct(res.body.data.plannerCatalog, fixture.product.id);
  const dashboardGroup = findProductGroup(dashboardProduct, fixture.group.id);

  res = await api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
  expectStatus(res, 200, "Mobile v3 meal planner catalog");
  const mobileProduct = findPlannerProduct(res.body.data.builderCatalog, fixture.product.id);
  const mobileGroup = findProductGroup(mobileProduct, fixture.group.id);

  return {
    dashboardProduct,
    dashboardGroup,
    mobileProduct,
    mobileGroup,
    plannerCatalog: res.body.data.builderCatalog,
  };
}

async function main() {
  assert.strictEqual(process.env.NODE_ENV, "test", "test must run with NODE_ENV=test");
  await connect();
  try {
    const api = request(createApp());
    ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));
    const fixture = await createFixture(api);
    const { subscription, auth } = await createClientContext();
    const date = "2026-10-15";

    let state = await readPlannerState(api, fixture);
    assert(state.dashboardProduct, "Dashboard planner exposes fixture product");
    assert(state.mobileProduct, "Mobile planner exposes fixture product");
    assert.strictEqual(String(state.dashboardProduct.id || state.dashboardProduct.productId), fixture.expected.productId, "Dashboard product identity");
    assert.strictEqual(String(state.mobileProduct.id || state.mobileProduct.productId), fixture.expected.productId, "Mobile product identity");
    assertGroupProjection({ dashboardGroup: state.dashboardGroup, mobileGroup: state.mobileGroup, expected: fixture.expected });

    const unlinkedOption = await MenuOption.create({
      groupId: fixture.group.id,
      key: `${TEST_KEY_TAG}_unlinked_option`,
      name: { en: `${TEST_TAG} Unlinked`, ar: "غير مربوط" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      sortOrder: 99,
    });
    assert(!optionIds(state.mobileGroup).includes(String(unlinkedOption._id)), "unlinked active option is absent from Mobile planner");

    const selection = {
      contractVersion: state.plannerCatalog.contractVersion,
      product: state.mobileProduct,
      group: state.mobileGroup,
      option: state.mobileGroup.options[0],
    };
    const body = canonicalBody(selection);
    let res = await validateSelection(api, subscription._id, date, auth, body);
    expectStatus(res, 200, "validate exposed Mobile selection");
    assert.strictEqual(res.body.data.valid, true, "Mobile-exposed canonical selection validates");
    assert.strictEqual(res.body.data.mealSlots[0].productId, fixture.product.id, "validated product identity is preserved");
    assert.strictEqual(res.body.data.mealSlots[0].selectedOptions[0].groupId, fixture.group.id, "validated group identity is preserved");
    assert.strictEqual(res.body.data.mealSlots[0].selectedOptions[0].optionId, selection.option.optionId || selection.option.id, "validated option identity is preserved");
    assert.strictEqual(await SubscriptionDay.countDocuments({ subscriptionId: subscription._id, date }), 0, "validate does not persist day state");

    const beforeRelation = await ProductOptionGroup.findOne({ productId: fixture.product.id, groupId: fixture.group.id }).lean();
    res = await api.patch(`/api/dashboard/menu/products/${fixture.product.id}/option-groups/${fixture.group.id}/visibility`).set(adminHeaders).send({ isVisible: false });
    expectStatus(res, 200, "hide product-group relation");
    assert.strictEqual(res.body.data.isVisible, false, "Dashboard mutation marks relation hidden");
    const hiddenRelation = await ProductOptionGroup.findOne({ productId: fixture.product.id, groupId: fixture.group.id }).lean();
    assert(hiddenRelation, "soft-hidden relation remains persisted");
    assert.strictEqual(hiddenRelation.isVisible, false, "persisted relation is hidden");

    res = await api.get("/api/dashboard/meal-builder").set(adminHeaders);
    expectStatus(res, 200, "Dashboard Meal Builder read after hide");
    const hiddenDashboardProduct = findPlannerProduct(res.body.data.plannerCatalog, fixture.product.id);
    assert(!findProductGroup(hiddenDashboardProduct, fixture.group.id), "hidden relation is removed from Dashboard planner");

    res = await api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
    expectStatus(res, 503, "Mobile planner rejects catalog with no selectable content");
    assert.strictEqual(res.body.error.code, "MEAL_PLANNER_CATALOG_EMPTY");

    res = await api.get(`/api/dashboard/menu/products/${fixture.product.id}/composer?contractVersion=v4`).set(adminHeaders);
    expectStatus(res, 200, "Dashboard composer read after hide");
    const adminGroup = res.body.data.customization.groups.find((candidate) => candidate.groupId === fixture.group.id);
    assert(adminGroup, "Dashboard administrative read still shows soft-hidden relation");
    assert.strictEqual(adminGroup.status.product.isVisible, false, "Dashboard administrative read shows relation hidden state");

    res = await validateSelection(api, subscription._id, date, auth, body);
    expectStatus(res, 422, "reject stale selection after relation hide");
    assert.strictEqual(res.body.error.code, "PLANNER_OPTION_GROUP_RELATION_UNAVAILABLE", "stale selection fails with relation unavailable code");
    assert.strictEqual(res.body.error.details.slotErrors[0].groupId, fixture.group.id, "stale rejection keeps group identity");
    assert.strictEqual(res.body.error.details.slotErrors[0].optionId, undefined, "group-relation rejection does not rewrite option identity");
    assert.strictEqual(await SubscriptionDay.countDocuments({ subscriptionId: subscription._id, date }), 0, "stale validation does not persist day state");

    res = await api.patch(`/api/dashboard/menu/products/${fixture.product.id}/option-groups/${fixture.group.id}/visibility`).set(adminHeaders).send({ isVisible: true });
    expectStatus(res, 200, "restore product-group relation visibility");
    state = await readPlannerState(api, fixture);
    assertGroupProjection({ dashboardGroup: state.dashboardGroup, mobileGroup: state.mobileGroup, expected: fixture.expected });
    res = await validateSelection(api, subscription._id, date, auth, body);
    expectStatus(res, 200, "validate restored relation selection");
    assert.strictEqual(res.body.data.valid, true, "restored canonical selection validates");
    assert.strictEqual(await ProductOptionGroup.countDocuments({ productId: fixture.product.id, groupId: fixture.group.id }), 1, "restore does not duplicate product-group relation");
    assert.strictEqual(await ProductGroupOption.countDocuments({ productId: fixture.product.id, groupId: fixture.group.id }), 2, "restore does not duplicate option relations");
    assert.deepStrictEqual(
      {
        before: {
          id: String(beforeRelation._id),
          isActive: beforeRelation.isActive !== false,
          isVisible: beforeRelation.isVisible !== false,
          isAvailable: beforeRelation.isAvailable !== false,
        },
        hidden: {
          id: String(hiddenRelation._id),
          isActive: hiddenRelation.isActive !== false,
          isVisible: hiddenRelation.isVisible !== false,
          isAvailable: hiddenRelation.isAvailable !== false,
        },
      },
      {
        before: {
          id: String(hiddenRelation._id),
          isActive: true,
          isVisible: true,
          isAvailable: true,
        },
        hidden: {
          id: String(hiddenRelation._id),
          isActive: true,
          isVisible: false,
          isAvailable: true,
        },
      },
      "before/hidden persisted relation states document soft-hide transition"
    );

    console.log("meal builder dashboard/mobile parity checks passed");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    await disconnect();
  } catch (_err) {}
  process.exit(1);
});