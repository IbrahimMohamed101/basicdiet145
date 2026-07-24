process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const { MEAL_SELECTION_TYPES } = require("../src/config/mealPlannerContract");
const mealBuilderService = require("../src/services/subscription/mealBuilderConfigService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dynamic_direct_meals_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function directSection(selectedProductIds) {
  return {
    key: "sandwich",
    sectionType: "product_list",
    sourceKind: "product_list",
    includeMode: "selected",
    selectedProductIds,
    selectionType: MEAL_SELECTION_TYPES.SANDWICH,
    titleOverride: { ar: "الوجبات", en: "Meals" },
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
    metadata: {
      cardType: "direct_product",
      requiresBuilder: false,
      treatAsFullMeal: true,
    },
    rules: { carbsRequired: false },
    sortOrder: 20,
  };
}

async function createProduct(categoryId, key, overrides = {}) {
  return MenuProduct.create({
    categoryId,
    key,
    name: { ar: key, en: key },
    description: { ar: `${key} description`, en: `${key} description` },
    itemType: "full_meal_product",
    pricingModel: "fixed",
    priceHalala: 1800,
    currency: "SAR",
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
    sortOrder: 10,
    ...overrides,
  });
}

function productIds(catalog) {
  const section = (catalog.sections || []).find(
    (row) => row.key === "sandwich"
  );
  assert(section, "dynamic direct meal section must exist");
  return (section.products || []).map((product) => String(product.id)).sort();
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const api = request(app);
    const auth = await dashboardAuth("admin", "dynamic-direct-meals");
    const now = new Date();
    const category = await MenuCategory.create({
      key: "dynamic_meals",
      name: { ar: "وجبات", en: "Meals" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    const configured = await createProduct(
      category._id,
      "configured_ready_meal",
      { sortOrder: 10 }
    );
    const unconfigured = await createProduct(
      category._id,
      "unconfigured_ready_meal",
      {
        itemType: "product",
        ui: { cardVariant: "ready_meal" },
        sortOrder: 20,
      }
    );
    const disabled = await createProduct(
      category._id,
      "disabled_stale_meal",
      { isActive: false, sortOrder: 30 }
    );
    await createProduct(category._id, "builder_must_not_leak", {
      itemType: "basic_meal",
      isCustomizable: true,
      ui: { cardVariant: "hero_builder" },
      sortOrder: 40,
    });
    await createProduct(category._id, "addon_must_not_leak", {
      itemType: "addon",
      ui: { cardVariant: "addon_card" },
      sortOrder: 50,
    });

    const sections = [
      directSection([
        String(configured._id),
        String(disabled._id),
      ]),
    ];
    await MealBuilderConfig.create({
      status: "published",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      versionNumber: 1,
      source: "dashboard",
      createdBySystem: false,
      publishedAt: now,
      sections,
    });
    await MealBuilderConfig.create({
      status: "draft",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      source: "dashboard",
      createdBySystem: false,
      sections,
    });

    const publicResponse = await api.get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    assert.strictEqual(
      publicResponse.status,
      200,
      JSON.stringify(publicResponse.body)
    );
    const flutterCatalog = publicResponse.body.data.builderCatalog;
    assert.strictEqual(flutterCatalog.contractVersion, "meal_planner_menu.v3");
    assert.deepStrictEqual(productIds(flutterCatalog), [
      String(configured._id),
      String(unconfigured._id),
    ].sort());
    const flutterSection = flutterCatalog.sections.find(
      (row) => row.key === "sandwich"
    );
    for (const product of flutterSection.products) {
      assert.strictEqual(
        product.selectionType,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
      );
      assert.deepStrictEqual(product.action, {
        type: "direct_add",
        requiresBuilder: false,
        treatAsFullMeal: true,
      });
      assert(product.id, "Flutter direct product id is required");
    }

    const readiness = await api
      .get("/api/dashboard/meal-builder/readiness")
      .set(auth.headers);
    assert.strictEqual(readiness.status, 200, JSON.stringify(readiness.body));
    assert.strictEqual(
      readiness.body.data.ready,
      true,
      JSON.stringify(readiness.body.data)
    );
    assert.strictEqual(
      readiness.body.data.errors.some(
        (error) => error.code === "MEAL_BUILDER_PRODUCT_INACTIVE"
      ),
      false
    );
    assert.strictEqual(
      readiness.body.data.summary.directMembershipSource,
      "live_catalog"
    );

    const publish = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({});
    assert.strictEqual(publish.status, 200, JSON.stringify(publish.body));
    const publishedIds = publish.body.data.config.sections
      .find((section) => section.key === "sandwich")
      .selectedProductIds.map(String)
      .sort();
    assert.deepStrictEqual(publishedIds, [
      String(configured._id),
      String(unconfigured._id),
    ].sort());

    const addedLater = await createProduct(
      category._id,
      "added_after_publish",
      { itemType: "standalone_meal", sortOrder: 5 }
    );
    let directCatalog = await mealBuilderService.buildPlannerCatalogFromPublishedBuilder({
      lang: "en",
    });
    assert(productIds(directCatalog).includes(String(addedLater._id)));

    let membership = await mealBuilderService.buildPublishedMembership();
    assert.strictEqual(
      mealBuilderService.isProductIncluded(
        membership.membership,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        addedLater._id
      ),
      true,
      "new live meal must be accepted by the same membership validator"
    );

    await MenuProduct.updateOne(
      { _id: unconfigured._id },
      { $set: { isActive: false } }
    );
    directCatalog = await mealBuilderService.buildPlannerCatalogFromPublishedBuilder({
      lang: "en",
    });
    assert(!productIds(directCatalog).includes(String(unconfigured._id)));
    membership = await mealBuilderService.buildPublishedMembership();
    assert.strictEqual(
      mealBuilderService.isProductIncluded(
        membership.membership,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        unconfigured._id
      ),
      false,
      "disabled meal must disappear from display and membership"
    );

    await MenuProduct.deleteOne({ _id: configured._id });
    directCatalog = await mealBuilderService.buildPlannerCatalogFromPublishedBuilder({
      lang: "en",
    });
    assert(!productIds(directCatalog).includes(String(configured._id)));
    assert(productIds(directCatalog).includes(String(addedLater._id)));

    const readinessAfterLifecycle = await api
      .get("/api/dashboard/meal-builder/readiness")
      .set(auth.headers);
    assert.strictEqual(readinessAfterLifecycle.status, 200);
    assert.strictEqual(
      readinessAfterLifecycle.body.data.ready,
      true,
      JSON.stringify(readinessAfterLifecycle.body.data)
    );

    console.log("dynamic direct meal catalog policy passed");
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
