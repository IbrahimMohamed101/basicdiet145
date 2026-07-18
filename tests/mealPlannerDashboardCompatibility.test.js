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
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const {
  getMealPlannerCatalog,
} = require("../src/services/subscription/mealPlannerCatalogService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(
    `meal_planner_dashboard_compatibility_${Date.now()}`
  );
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expectedStatus, label) {
  assert.strictEqual(
    response.status,
    expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(
      response.body
    )}`
  );
}

function findDirectProductsSection(catalog) {
  return (catalog?.sections || []).find(
    (section) =>
      section.key === "sandwich" ||
      section.selectionType === "sandwich" ||
      (section.products || []).some((product) =>
        ["cold_sandwich", "full_meal_product"].includes(product.itemType)
      )
  );
}

async function seedMenu() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "main_meals",
    name: { ar: "الوجبات الرئيسية", en: "Main Meals" },
    publishedAt: now,
    sortOrder: 1,
  });

  const fullMeals = Array.from({ length: 125 }, (_, index) => ({
    categoryId: category._id,
    key: `direct_meal_${String(index + 1).padStart(3, "0")}`,
    name: {
      ar: `وجبة مباشرة ${index + 1}`,
      en: `Direct Meal ${index + 1}`,
    },
    itemType: "full_meal_product",
    pricingModel: "fixed",
    priceHalala: 1000 + index,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    availableForSubscription: true,
    publishedAt: now,
    sortOrder: index + 1,
  }));

  const products = await MenuProduct.insertMany([
    ...fullMeals,
    {
      categoryId: category._id,
      key: "direct_cold_sandwich",
      name: { ar: "ساندويتش مباشر", en: "Direct Sandwich" },
      itemType: "cold_sandwich",
      pricingModel: "fixed",
      priceHalala: 1500,
      currency: "SAR",
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 500,
    },
    {
      categoryId: category._id,
      key: "technical_basic_meal",
      name: { ar: "منتج تقني", en: "Technical Product" },
      itemType: "basic_meal",
      pricingModel: "per_100g",
      priceHalala: 1900,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 1000,
    },
  ]);

  return {
    category,
    directProducts: products.filter((product) =>
      ["cold_sandwich", "full_meal_product"].includes(product.itemType)
    ),
  };
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const auth = await dashboardAuth(
      "admin",
      "meal-planner-dashboard-compatibility"
    );
    const seeded = await seedMenu();

    const picker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/sandwich?limit=500")
      .set(auth.headers);
    expectStatus(picker, 200, "dashboard direct-products picker");
    assert.strictEqual(
      picker.body.data.contractVersion,
      "dashboard_meal_builder_picker.v1"
    );
    assert.strictEqual(picker.body.data.candidateType, "product");
    assert.strictEqual(picker.body.data.meta.total, 126);
    assert.strictEqual(picker.body.data.candidates.length, 126);
    assert.strictEqual(picker.body.data.meta.limit, 500);
    assert.ok(
      picker.body.data.candidates.every((candidate) =>
        ["cold_sandwich", "full_meal_product"].includes(candidate.itemType)
      )
    );
    assert.ok(
      !picker.body.data.candidates.some(
        (candidate) => candidate.key === "technical_basic_meal"
      )
    );

    const dashboardState = await request(app)
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(dashboardState, 200, "dashboard meal planner state");
    for (const field of [
      "draft",
      "published",
      "preview",
      "plannerCatalog",
      "premiumSection",
      "validation",
    ]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(dashboardState.body.data, field),
        `dashboard response must preserve ${field}`
      );
    }
    assert.strictEqual(
      dashboardState.body.data.plannerCatalog.contractVersion,
      "meal_planner_menu.v3"
    );
    assert.strictEqual(
      dashboardState.body.data.builderCatalogV2,
      undefined,
      "dashboard state must not expose a v2 mirror"
    );
    const dashboardDirectSection = findDirectProductsSection(
      dashboardState.body.data.plannerCatalog
    );
    assert.ok(dashboardDirectSection, "dashboard planner must expose direct meals");
    assert.strictEqual(dashboardDirectSection.products.length, 126);

    const requestedV3Only = await getMealPlannerCatalog({
      lang: "en",
      includeV3: true,
      includeV2: false,
    });
    assert.strictEqual(
      requestedV3Only.plannerCatalog.contractVersion,
      "meal_planner_menu.v3"
    );
    assert.strictEqual(
      requestedV3Only.builderCatalogV2,
      null,
      "requesting v3 must not automatically compile v2"
    );

    const publicMenu = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicMenu, 200, "public meal planner menu");
    assert.strictEqual(
      publicMenu.body.data.builderCatalog.contractVersion,
      "meal_planner_menu.v3"
    );
    assert.strictEqual(publicMenu.body.data.plannerCatalog, undefined);
    assert.strictEqual(publicMenu.body.data.builderCatalogV2, undefined);
    assert.strictEqual(publicMenu.body.data.sections, undefined);
    const publicDirectSection = findDirectProductsSection(
      publicMenu.body.data.builderCatalog
    );
    assert.ok(publicDirectSection, "public planner must expose direct meals");
    assert.strictEqual(publicDirectSection.products.length, 126);
    assert.ok(
      publicDirectSection.products.some(
        (product) => product.id === String(seeded.directProducts[0]._id)
      )
    );
    assert.match(publicMenu.headers["cache-control"], /no-store/);

    console.log("mealPlannerDashboardCompatibility.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
