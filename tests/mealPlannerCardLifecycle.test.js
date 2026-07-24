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
      (section.products || []).map((product) => String(product.id))
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

    const initialState = await request(app)
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(initialState, 200, "initial builder state");
    assert.ok(initialState.body.data.draft);
    assert.ok(sectionByKey(initialState.body.data.draft.sections, "main_card"));
    for (const field of [
      "draft",
      "published",
      "preview",
      "plannerCatalog",
      "premiumSection",
      "validation",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(initialState.body.data, field));
    }

    const initialHydrated = await request(app)
      .get("/api/dashboard/meal-builder/draft/hydrated?lang=en")
      .set(auth.headers);
    expectStatus(initialHydrated, 200, "initial hydrated draft");
    const hydratedMain = sectionByKey(initialHydrated.body.data.sections, "main_card");
    assert.ok(hydratedMain);
    assert.deepStrictEqual(
      new Set(hydratedMain.selectedProducts.map((product) => product.productId)),
      new Set(ids.slice(0, 2))
    );

    const createPicker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(createPicker, 200, "new card picker");
    assert.strictEqual(
      createPicker.body.data.contractVersion,
      "dashboard_meal_builder_picker.v1"
    );
    assert.strictEqual(createPicker.body.data.meta.catalogTotal, 6);
    assert.strictEqual(createPicker.body.data.meta.assignedToOtherCards, 2);
    assert.strictEqual(createPicker.body.data.meta.unassigned, 4);
    assert.strictEqual(createPicker.body.data.meta.total, 4);
    assert.deepStrictEqual(
      new Set(createPicker.body.data.candidates.map((product) => product.productId)),
      new Set(ids.slice(2))
    );
    assert.ok(
      !createPicker.body.data.candidates.some(
        (product) => product.key === "technical_basic_meal"
      )
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
    assert.strictEqual(
      createCard.body.data.contractVersion,
      "dashboard_meal_builder_card_action.v1"
    );
    assert.strictEqual(createCard.body.data.action, "created");
    assert.strictEqual(createCard.body.data.summary.sectionCount, 2);
    assert.strictEqual(createCard.body.data.validation.ready, true);
    assert.deepStrictEqual(
      new Set(createCard.body.data.section.selectedProductIds),
      new Set(ids.slice(2, 4))
    );

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

    const editPicker = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/secondary_card?limit=1000"
      )
      .set(auth.headers);
    expectStatus(editPicker, 200, "edit card picker");
    assert.strictEqual(editPicker.body.data.meta.selectedInCurrentCard, 2);
    assert.strictEqual(editPicker.body.data.meta.assignedToOtherCards, 2);
    assert.strictEqual(editPicker.body.data.meta.unassigned, 2);
    assert.deepStrictEqual(
      new Set(editPicker.body.data.candidates.map((product) => product.productId)),
      new Set(ids.slice(2))
    );
    assert.ok(
      editPicker.body.data.candidates
        .filter((product) => ids.slice(2, 4).includes(product.productId))
        .every((product) => product.selected)
    );

    const addProducts = await request(app)
      .post("/api/dashboard/meal-builder/sections/secondary_card/products")
      .set(auth.headers)
      .send({ productIds: ids.slice(4) });
    expectStatus(addProducts, 200, "add products to card");
    assert.strictEqual(addProducts.body.data.action, "products_added");
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

    const updateCard = await request(app)
      .patch("/api/dashboard/meal-builder/sections/secondary_card")
      .set(auth.headers)
      .send({
        titleOverride: { ar: "الكارت الثاني", en: "Second Card" },
        sortOrder: 5,
        visible: true,
      });
    expectStatus(updateCard, 200, "update card");
    assert.strictEqual(updateCard.body.data.action, "updated");
    assert.strictEqual(updateCard.body.data.section.titleOverride.en, "Second Card");
    assert.strictEqual(updateCard.body.data.section.sortOrder, 5);

    const removeProduct = await request(app)
      .delete(
        `/api/dashboard/meal-builder/sections/secondary_card/products/${ids[3]}`
      )
      .set(auth.headers);
    expectStatus(removeProduct, 200, "remove product from card");
    assert.strictEqual(removeProduct.body.data.action, "product_removed");
    assert.ok(!removeProduct.body.data.section.selectedProductIds.includes(ids[3]));

    const releasedProductPicker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(releasedProductPicker, 200, "released product picker");
    assert.deepStrictEqual(
      releasedProductPicker.body.data.candidates.map((product) => product.productId),
      [ids[3]]
    );

    const addReleasedProduct = await request(app)
      .post("/api/dashboard/meal-builder/sections/secondary_card/products")
      .set(auth.headers)
      .send({ productIds: [ids[3]] });
    expectStatus(addReleasedProduct, 200, "re-add released product");
    assert.deepStrictEqual(
      new Set(addReleasedProduct.body.data.section.selectedProductIds),
      new Set(ids.slice(2))
    );

    const publish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "card lifecycle publish" });
    expectStatus(publish, 200, "publish complete card layout");
    assert.strictEqual(publish.body.data.validation.ready, true);
    assert.ok(sectionByKey(publish.body.data.config.sections, "main_card"));
    assert.ok(sectionByKey(publish.body.data.config.sections, "secondary_card"));
    assert.deepStrictEqual(productIdsFromPlanner({
      sections: publish.body.data.contract.sections.map((section) => ({
        ...section,
        products: (section.items || []).filter((item) => item.type === "product"),
      })),
    }), new Set(ids));

    const publishedState = await request(app)
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(publishedState, 200, "published builder state");
    assert.ok(sectionByKey(publishedState.body.data.published.sections, "main_card"));
    assert.ok(
      sectionByKey(publishedState.body.data.published.sections, "secondary_card")
    );
    assert.deepStrictEqual(
      productIdsFromPlanner(publishedState.body.data.plannerCatalog),
      new Set(ids)
    );

    const publicMenu = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicMenu, 200, "public menu after publish");
    assert.strictEqual(
      publicMenu.body.data.builderCatalog.contractVersion,
      "meal_planner_menu.v3"
    );
    assert.ok(
      plannerSectionByKey(publicMenu.body.data.builderCatalog, "main_card")
    );
    assert.ok(
      plannerSectionByKey(publicMenu.body.data.builderCatalog, "secondary_card")
    );
    assert.deepStrictEqual(
      productIdsFromPlanner(publicMenu.body.data.builderCatalog),
      new Set(ids)
    );
    assert.strictEqual(publicMenu.body.data.builderCatalogV2, undefined);
    assert.strictEqual(publicMenu.body.data.plannerCatalog, undefined);

    const deleteCard = await request(app)
      .delete("/api/dashboard/meal-builder/sections/secondary_card")
      .set(auth.headers);
    expectStatus(deleteCard, 200, "delete secondary card");
    assert.strictEqual(deleteCard.body.data.action, "deleted");
    assert.strictEqual(deleteCard.body.data.previousSectionKey, "secondary_card");
    assert.strictEqual(deleteCard.body.data.summary.sectionCount, 1);
    assert.strictEqual(
      sectionByKey(deleteCard.body.data.draft.sections, "secondary_card"),
      null
    );

    const productsAfterDelete = await request(app)
      .get("/api/dashboard/meal-builder/pickers/products?limit=1000")
      .set(auth.headers);
    expectStatus(productsAfterDelete, 200, "products released after card delete");
    assert.deepStrictEqual(
      new Set(productsAfterDelete.body.data.candidates.map((product) => product.productId)),
      new Set(ids.slice(2))
    );

    const publicBeforeRepublish = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicBeforeRepublish, 200, "published layout remains stable");
    assert.ok(
      plannerSectionByKey(
        publicBeforeRepublish.body.data.builderCatalog,
        "secondary_card"
      ),
      "draft delete must not alter the published response before republish"
    );

    const republish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "remove secondary card" });
    expectStatus(republish, 200, "publish card delete");
    assert.strictEqual(
      sectionByKey(republish.body.data.config.sections, "secondary_card"),
      null
    );

    const publicAfterRepublish = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicAfterRepublish, 200, "public menu after card delete publish");
    assert.strictEqual(
      plannerSectionByKey(
        publicAfterRepublish.body.data.builderCatalog,
        "secondary_card"
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
