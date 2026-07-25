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

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_planner_card_lifecycle_${Date.now()}`);
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

function sectionByKey(sections, key) {
  return (sections || []).find((section) => section.key === key) || null;
}

function plannerSectionByKey(catalog, key) {
  return (catalog?.sections || []).find((section) => section.key === key) || null;
}

function productIdsFromPlanner(catalog) {
  return new Set(
    (catalog?.sections || []).flatMap((section) =>
      (section.products || []).map((product) =>
        String(product.productId || product.id)
      )
    )
  );
}

async function seedMenu() {
  const now = new Date();
  const [mainCategory, sandwichCategory] = await MenuCategory.create([
    {
      key: "main_meals",
      name: { ar: "الوجبات الرئيسية", en: "Main Meals" },
      publishedAt: now,
      sortOrder: 1,
    },
    {
      key: "sandwiches",
      name: { ar: "الساندويتشات", en: "Sandwiches" },
      publishedAt: now,
      sortOrder: 2,
    },
  ]);

  const directProducts = await MenuProduct.insertMany([
    ...Array.from({ length: 5 }, (_, index) => ({
      categoryId: mainCategory._id,
      key: `full_meal_${index + 1}`,
      name: {
        ar: `وجبة كاملة ${index + 1}`,
        en: `Full Meal ${index + 1}`,
      },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 1000 + index * 100,
      currency: "SAR",
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: index + 1,
    })),
    {
      categoryId: sandwichCategory._id,
      key: "cold_sandwich_1",
      name: { ar: "ساندويتش بارد", en: "Cold Sandwich" },
      itemType: "cold_sandwich",
      pricingModel: "fixed",
      priceHalala: 1600,
      currency: "SAR",
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 20,
    },
  ]);

  await MenuProduct.create([
    {
      categoryId: mainCategory._id,
      key: "unavailable_direct_meal",
      name: { ar: "وجبة غير متاحة", en: "Unavailable Direct Meal" },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 900,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      isAvailable: false,
      publishedAt: now,
      sortOrder: 30,
    },
    {
      categoryId: mainCategory._id,
      key: "technical_basic_meal",
      name: { ar: "منتج تقني", en: "Technical Product" },
      itemType: "basic_meal",
      pricingModel: "per_100g",
      priceHalala: 1900,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 40,
    },
  ]);

  return directProducts;
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const auth = await dashboardAuth("admin", "meal-planner-card-lifecycle");
    const products = await seedMenu();
    const ids = products.map((product) => String(product._id));

    const createDraft = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({
        sections: [
          {
            key: "main_card",
            sectionType: "product_list",
            sourceKind: "product_list",
            titleOverride: { ar: "الكارت الرئيسي", en: "Main Card" },
            selectedProductIds: ids.slice(0, 2),
            selectedOptionIds: [],
            includeMode: "selected",
            selectionType: "full_meal_product",
            sortOrder: 10,
            required: false,
            minSelections: 0,
            maxSelections: 1,
            multiSelect: false,
            visible: true,
            availableFor: ["subscription"],
          },
        ],
      });
    expectStatus(createDraft, 201, "create initial draft");
    assert.deepStrictEqual(
      sectionByKey(createDraft.body.data.sections, "main_card").selectedProductIds,
      ids.slice(0, 2)
    );

    const initialPicker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(initialPicker, 200, "initial product picker");
    assert.strictEqual(initialPicker.body.data.meta.catalogTotal, 6);
    assert.strictEqual(initialPicker.body.data.meta.assignedToOtherCards, 2);
    assert.strictEqual(initialPicker.body.data.meta.unassigned, 4);
    assert.deepStrictEqual(
      new Set(
        initialPicker.body.data.candidates.map((product) => product.productId)
      ),
      new Set(ids.slice(2))
    );

    const createCard = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "secondary_card",
        selectionType: "full_meal_product",
        titleOverride: { ar: "كارت إضافي", en: "Secondary Card" },
        selectedProductIds: ids.slice(2, 4),
        sortOrder: 20,
      });
    expectStatus(createCard, 201, "create secondary card");
    assert.strictEqual(createCard.body.data.summary.sectionCount, 2);

    const duplicateAssignment = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "duplicate_card",
        selectionType: "full_meal_product",
        titleOverride: { ar: "مكرر", en: "Duplicate" },
        selectedProductIds: [ids[0]],
      });
    expectStatus(duplicateAssignment, 409, "reject duplicate product assignment");
    assert.strictEqual(
      duplicateAssignment.body.error.code,
      "MEAL_BUILDER_PRODUCT_ALREADY_ASSIGNED"
    );

    const addProducts = await request(app)
      .post("/api/dashboard/meal-builder/sections/secondary_card/products")
      .set(auth.headers)
      .send({ productIds: ids.slice(4) });
    expectStatus(addProducts, 200, "add remaining products to secondary card");
    assert.deepStrictEqual(
      new Set(addProducts.body.data.section.selectedProductIds),
      new Set(ids.slice(2))
    );

    const noUnassignedProducts = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(noUnassignedProducts, 200, "all products assigned picker");
    assert.strictEqual(noUnassignedProducts.body.data.meta.unassigned, 0);
    assert.strictEqual(noUnassignedProducts.body.data.meta.total, 0);

    const publish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "card lifecycle publish" });
    expectStatus(publish, 200, "publish complete card layout");
    assert.strictEqual(publish.body.data.validation.ready, true);
    assert.ok(sectionByKey(publish.body.data.config.sections, "main_card"));
    assert.ok(sectionByKey(publish.body.data.config.sections, "secondary_card"));

    const publicMenu = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicMenu, 200, "public menu after publish");
    assert.ok(
      plannerSectionByKey(publicMenu.body.data.builderCatalog, "main_card")
    );
    assert.ok(
      plannerSectionByKey(publicMenu.body.data.builderCatalog, "secondary_card")
    );
    assert.strictEqual(
      plannerSectionByKey(publicMenu.body.data.builderCatalog, "sandwich"),
      null,
      "no app-only sandwich card may be injected"
    );
    assert.deepStrictEqual(
      productIdsFromPlanner(publicMenu.body.data.builderCatalog),
      new Set(ids)
    );

    const deleteCard = await request(app)
      .delete("/api/dashboard/meal-builder/sections/secondary_card")
      .set(auth.headers);
    expectStatus(deleteCard, 200, "delete secondary card");
    assert.strictEqual(deleteCard.body.data.action, "deleted");
    assert.strictEqual(deleteCard.body.data.previousSectionKey, "secondary_card");
    assert.strictEqual(deleteCard.body.data.summary.sectionCount, 1);
    assert.ok(sectionByKey(deleteCard.body.data.draft.sections, "main_card"));
    assert.strictEqual(
      sectionByKey(deleteCard.body.data.draft.sections, "secondary_card"),
      null
    );
    assert.strictEqual(
      sectionByKey(deleteCard.body.data.draft.sections, "sandwich"),
      null,
      "deleting a dashboard card must not create a hidden system card"
    );

    const productsAfterDelete = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(productsAfterDelete, 200, "released products after card delete");
    assert.strictEqual(productsAfterDelete.body.data.meta.unassigned, 4);
    assert.strictEqual(productsAfterDelete.body.data.meta.total, 4);
    assert.deepStrictEqual(
      new Set(
        productsAfterDelete.body.data.candidates.map(
          (product) => product.productId
        )
      ),
      new Set(ids.slice(2))
    );

    const publicBeforeRepublish = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(
      publicBeforeRepublish,
      200,
      "published layout remains stable before republish"
    );
    assert.ok(
      plannerSectionByKey(
        publicBeforeRepublish.body.data.builderCatalog,
        "secondary_card"
      ),
      "draft delete must not alter published output before republish"
    );

    const republish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "remove secondary card" });
    expectStatus(republish, 200, "publish card delete");
    assert.ok(sectionByKey(republish.body.data.config.sections, "main_card"));
    assert.strictEqual(
      sectionByKey(republish.body.data.config.sections, "secondary_card"),
      null
    );
    assert.strictEqual(
      sectionByKey(republish.body.data.config.sections, "sandwich"),
      null
    );

    const publicAfterRepublish = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(
      publicAfterRepublish,
      200,
      "public menu after card delete publish"
    );
    assert.ok(
      plannerSectionByKey(
        publicAfterRepublish.body.data.builderCatalog,
        "main_card"
      )
    );
    assert.strictEqual(
      plannerSectionByKey(
        publicAfterRepublish.body.data.builderCatalog,
        "secondary_card"
      ),
      null
    );
    assert.strictEqual(
      plannerSectionByKey(
        publicAfterRepublish.body.data.builderCatalog,
        "sandwich"
      ),
      null
    );
    assert.deepStrictEqual(
      productIdsFromPlanner(publicAfterRepublish.body.data.builderCatalog),
      new Set(ids.slice(0, 2))
    );

    console.log("mealPlannerCardLifecycle.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
