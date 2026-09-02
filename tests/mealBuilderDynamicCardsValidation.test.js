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
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuProduct = require("../src/models/MenuProduct");
const { seedCatalog: seedCanonicalCatalog } = require("../scripts/bootstrap/seed-catalog");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_dynamic_cards_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expected, label) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

function issueCodes(validation) {
  return new Set([
    ...(validation?.errors || []),
    ...(validation?.warnings || []),
  ].map((issue) => issue.code));
}

function assertNoTemplateIssues(validation, label) {
  const codes = issueCodes(validation);
  for (const code of [
    "MEAL_BUILDER_VISUAL_SECTION_MISSING",
    "MEAL_BUILDER_VISUAL_SECTION_ORDER_CHANGED",
    "MEAL_BUILDER_LEGACY_VISUAL_TEMPLATE",
  ]) {
    assert(!codes.has(code), `${label}: unexpected ${code}`);
  }
}

function directCard({ key, productIds, sortOrder, selectionType = "full_meal_product" }) {
  const sandwich = selectionType === "sandwich";
  return {
    key,
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride: { ar: key, en: key },
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: null,
    selectedOptionIds: [],
    selectedProductIds: productIds,
    includeMode: "selected",
    selectionType,
    sortOrder,
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
    metadata: {
      requiresBuilder: false,
      treatAsFullMeal: true,
    },
    rules: sandwich ? { carbsRequired: false } : {},
  };
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const api = request(app);
    const auth = await dashboardAuth("admin", "meal-builder-dynamic-cards");

    const incompleteCategory = await MenuCategory.create({
      key: "incomplete_seed",
      name: { ar: "غير مكتمل", en: "Incomplete" },
      publishedAt: new Date(),
    });
    await MenuProduct.create({
      categoryId: incompleteCategory._id,
      key: "basic_meal",
      name: { ar: "وجبة أساسية", en: "Basic meal" },
      itemType: "basic_meal",
      pricingModel: "per_100g",
      priceHalala: 1900,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });

    let response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({});
    expectStatus(response, 201, "incomplete legacy seed opens independent authoring");
    assert.strictEqual(response.body.data.status, "draft");
    assert.strictEqual(response.body.data.bootstrapKey, "independent_dashboard_authoring_v1");
    assert.deepStrictEqual(response.body.data.sections, []);
    assert.strictEqual(await MealBuilderConfig.countDocuments({ status: "draft", isCurrent: true }), 1);

    await MealBuilderConfig.updateOne(
      { _id: response.body.data.id },
      { $set: { isCurrent: false } }
    );

    await seedCanonicalCatalog({
      reset: true,
      sync: false,
      includeSubscriptionPlans: false,
      skipStrictVerify: true,
    });

    const directProducts = await MenuProduct.find({
      itemType: { $in: ["cold_sandwich", "full_meal_product"] },
      isAvailable: { $ne: false },
    }).sort({ sortOrder: 1 }).lean();
    assert(directProducts.length >= 3, "canonical bootstrap must provide direct meal products");
    const [directOne, directTwo, directThree] = directProducts;
    const id = (product) => String(product._id);
    const category = await MenuCategory.findById(directOne.categoryId).lean();
    const unavailable = await MenuProduct.create({
      categoryId: category._id,
      key: "unavailable_dynamic_meal",
      name: { ar: "غير متاح", en: "Unavailable" },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 1000,
      availableFor: ["subscription"],
      availableForSubscription: true,
      isAvailable: false,
      publishedAt: new Date(),
    });

    response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({});
    expectStatus(response, 201, "optional seed draft");
    assert.deepStrictEqual(
      response.body.data.sections.map((section) => section.key),
      ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]
    );
    const seededSections = response.body.data.sections;

    const sandwichOnly = [
      directCard({
        key: "portable_lunches",
        productIds: [id(directOne)],
        sortOrder: 47,
        selectionType: "sandwich",
      }),
    ];
    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: sandwichOnly, notes: "sandwich only" });
    expectStatus(response, 200, "save sandwich-only draft");
    assert.deepStrictEqual(response.body.data.sections.map((section) => section.key), ["portable_lunches"]);

    response = await api
      .get("/api/dashboard/meal-builder/pickers/portable_lunches?limit=1000")
      .set(auth.headers);
    expectStatus(response, 200, "picker follows renamed sandwich card meaning");
    assert.strictEqual(response.body.data.candidateType, "product");

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: sandwichOnly });
    expectStatus(response, 200, "validate sandwich-only draft");
    assert.strictEqual(response.body.data.ready, true);
    assert.deepStrictEqual(response.body.data.errors, []);
    assert.deepStrictEqual(response.body.data.warnings, []);
    assertNoTemplateIssues(response.body.data, "sandwich-only validation");

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish sandwich only" });
    expectStatus(response, 200, "publish sandwich-only draft");
    assert.strictEqual(response.body.data.validation.ready, true);
    assert.deepStrictEqual(response.body.data.config.sections.map((section) => section.key), ["portable_lunches"]);

    response = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(response, 200, "public v3 sandwich-only catalog");
    assert.strictEqual(response.body.data.builderCatalog.contractVersion, "meal_planner_menu.v3");
    assert.strictEqual(
      response.body.data.plannerCatalog.catalogHash,
      response.body.data.builderCatalog.catalogHash
    );
    assert.strictEqual(response.body.data.builderCatalogV2.catalogVersion, "meal_planner_menu.v2");
    assert(response.body.data.builderCatalog.sections.some((section) => section.key === "portable_lunches"));

    const customOnly = [
      directCard({
        key: "chef_specials",
        productIds: [id(directTwo)],
        sortOrder: 900,
      }),
    ];
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: customOnly });
    expectStatus(response, 200, "validate custom-key card");
    assert.strictEqual(response.body.data.ready, true);
    assert.deepStrictEqual(response.body.data.errors, []);
    assert.deepStrictEqual(response.body.data.warnings, []);
    assertNoTemplateIssues(response.body.data, "custom-key validation");

    for (const [label, card] of [
      ["canonical sandwich key with unrelated meaning", directCard({ key: "sandwich", productIds: [id(directTwo)], sortOrder: 1 })],
      ["canonical carbs key with unrelated meaning", directCard({ key: "carbs", productIds: [id(directThree)], sortOrder: 1 })],
    ]) {
      response = await api
        .post("/api/dashboard/meal-builder/validate")
        .set(auth.headers)
        .send({ sections: [card] });
      expectStatus(response, 200, label);
      assert.strictEqual(response.body.data.ready, true);
      assert.deepStrictEqual(response.body.data.warnings, []);
      assert(!issueCodes(response.body.data).has("MEAL_BUILDER_CARBS_RULE_INVALID"));
      assert(!issueCodes(response.body.data).has("MEAL_BUILDER_SANDWICH_METADATA_INCOMPLETE"));
    }

    const renamedCarbs = {
      ...seededSections.find((section) => section.key === "carbs"),
      key: "daily_starches",
    };
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [{ ...renamedCarbs, maxSelections: 1 }] });
    expectStatus(response, 200, "renamed carbs semantics");
    assert(issueCodes(response.body.data).has("MEAL_BUILDER_CARBS_RULE_INVALID"));

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [renamedCarbs] });
    expectStatus(response, 200, "valid renamed carbs card");
    assert.strictEqual(response.body.data.ready, true);

    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [renamedCarbs] });
    expectStatus(response, 200, "save renamed carbs card");
    response = await api
      .get("/api/dashboard/meal-builder/pickers/daily_starches?limit=1000")
      .set(auth.headers);
    expectStatus(response, 200, "picker follows renamed carbs card meaning");
    assert.strictEqual(response.body.data.candidateType, "option");
    assert.strictEqual(response.body.data.rules.optionRole, "carbs");
    assert.strictEqual(response.body.data.rules.canonicalSelectionType, "standard_meal");

    const renamedBeef = {
      ...seededSections.find((section) => section.key === "beef"),
      key: "red_meat_choices",
      rules: {},
    };
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [renamedBeef] });
    expectStatus(response, 200, "renamed beef semantics");
    assert(issueCodes(response.body.data).has("MEAL_BUILDER_BEEF_DAILY_LIMIT_RULE_MISSING"));

    const renamedPremium = {
      ...seededSections.find((section) => section.key === "premium"),
      key: "vip_upgrades",
    };
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [renamedPremium] });
    expectStatus(response, 200, "renamed premium semantics");
    assert.strictEqual(response.body.data.ready, true);

    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [renamedPremium] });
    expectStatus(response, 200, "save premium-only authored draft");
    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "premium-only is not primary content" });
    expectStatus(response, 422, "block publish without primary picker content");
    assert(issueCodes(response.body.error.details).has("MEAL_BUILDER_PRIMARY_CONTENT_EMPTY"));

    const emptyFamily = {
      ...seededSections.find((section) => section.key === "chicken"),
      key: "poultry_choices",
      selectedOptionIds: [],
    };
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [emptyFamily] });
    expectStatus(response, 200, "renamed empty protein family semantics");
    assert(issueCodes(response.body.data).has("MEAL_BUILDER_PROTEIN_FAMILY_EMPTY"));

    const twoCards = [
      directCard({
        key: "later_card",
        productIds: [id(directThree)],
        sortOrder: 80,
      }),
      directCard({
        key: "first_card",
        productIds: [id(directTwo)],
        sortOrder: 3,
      }),
    ];
    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: twoCards });
    expectStatus(response, 200, "validate two independent cards");
    assert.strictEqual(response.body.data.ready, true);
    assert.deepStrictEqual(response.body.data.warnings, []);
    assertNoTemplateIssues(response.body.data, "two-card validation");

    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: twoCards });
    expectStatus(response, 200, "save independently ordered cards");
    assert.deepStrictEqual(response.body.data.sections.map((section) => section.key), ["first_card", "later_card"]);

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({
        sections: [
          directCard({
            key: "invalid_present_product",
            productIds: [id(unavailable)],
            sortOrder: 1,
          }),
        ],
      });
    expectStatus(response, 200, "validate unavailable present product");
    assert.strictEqual(response.body.data.ready, false);
    assert(issueCodes(response.body.data).has("MEAL_BUILDER_PRODUCT_UNAVAILABLE"));

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({
        sections: [
          directCard({
            key: "missing_product",
            productIds: [String(new mongoose.Types.ObjectId())],
            sortOrder: 1,
          }),
        ],
      });
    expectStatus(response, 200, "validate missing referenced product");
    assert.strictEqual(response.body.data.ready, false);
    assert(issueCodes(response.body.data).has("MEAL_BUILDER_PRODUCT_NOT_FOUND"));

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({
        sections: [
          directCard({ key: "bad_id", productIds: ["not-an-object-id"], sortOrder: 1 }),
        ],
      });
    expectStatus(response, 400, "reject invalid ObjectId");
    assert.strictEqual(response.body.error.code, "MEAL_BUILDER_INVALID_REFERENCE");

    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: customOnly });
    expectStatus(response, 200, "save custom card before card actions");

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "direct_product",
        key: "second_card",
        titleOverride: { ar: "ثانية", en: "Second" },
        selectedProductIds: [id(directOne), id(directThree)],
        selectionType: "full_meal_product",
        sortOrder: 12,
      });
    expectStatus(response, 201, "create arbitrary card");
    assert.strictEqual(response.body.data.action, "created");
    assert.strictEqual(response.body.data.validation.ready, true);

    response = await api
      .get("/api/dashboard/meal-builder/pickers/second_card?limit=1000")
      .set(auth.headers);
    expectStatus(response, 200, "picker for arbitrary card key");
    assert.strictEqual(response.body.data.sectionKey, "second_card");
    assert.strictEqual(response.body.data.candidateType, "product");

    response = await api
      .patch("/api/dashboard/meal-builder/sections/second_card")
      .set(auth.headers)
      .send({ titleOverride: { ar: "معدلة", en: "Updated" }, sortOrder: 2 });
    expectStatus(response, 200, "update arbitrary card");
    assert.strictEqual(response.body.data.section.titleOverride.en, "Updated");

    response = await api
      .delete(`/api/dashboard/meal-builder/sections/second_card/products/${id(directThree)}`)
      .set(auth.headers);
    expectStatus(response, 200, "remove product from arbitrary card");
    assert(!response.body.data.section.selectedProductIds.includes(id(directThree)));

    response = await api
      .delete("/api/dashboard/meal-builder/sections/second_card")
      .set(auth.headers);
    expectStatus(response, 200, "delete arbitrary card");
    assert.strictEqual(response.body.data.action, "deleted");
    assert.deepStrictEqual(response.body.data.draft.sections.map((section) => section.key), ["chef_specials"]);

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish exact partial custom layout" });
    expectStatus(response, 200, "publish exact partial custom layout");
    assert.deepStrictEqual(response.body.data.config.sections.map((section) => section.key), ["chef_specials"]);

    response = await api
      .put("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [] });
    expectStatus(response, 200, "save empty editable draft");
    assert.deepStrictEqual(response.body.data.sections, []);

    response = await api
      .get("/api/dashboard/meal-builder/draft/hydrated")
      .set(auth.headers);
    expectStatus(response, 200, "hydrate empty editable draft");
    assert.strictEqual(response.body.data.ready, true);
    assert.deepStrictEqual(response.body.data.errors, []);
    assert.deepStrictEqual(response.body.data.warnings, []);
    assertNoTemplateIssues(response.body.data.validation, "empty draft validation");

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({ sections: [] });
    expectStatus(response, 200, "ordinary empty draft validation");
    assert.strictEqual(response.body.data.ready, true);
    assert.deepStrictEqual(response.body.data.errors, []);
    assert.deepStrictEqual(response.body.data.warnings, []);

    response = await api.get("/api/dashboard/meal-builder/draft").set(auth.headers);
    expectStatus(response, 200, "open existing empty draft without reseeding");
    assert.deepStrictEqual(response.body.data.sections, []);

    response = await api.get("/api/dashboard/meal-builder").set(auth.headers);
    expectStatus(response, 200, "dashboard state accepts empty draft");
    assert.strictEqual(response.body.data.validation.draft.ready, true);
    assert.deepStrictEqual(response.body.data.validation.draft.errors, []);
    assert.deepStrictEqual(response.body.data.validation.draft.warnings, []);

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "must not publish empty" });
    expectStatus(response, 422, "block empty publish");
    assert.strictEqual(response.body.error.code, "MEAL_BUILDER_VALIDATION_FAILED");
    assert(issueCodes(response.body.error.details).has("MEAL_BUILDER_SECTIONS_EMPTY"));
    assert(issueCodes(response.body.error.details).has("MEAL_BUILDER_PRIMARY_CONTENT_EMPTY"));

    response = await api
      .post("/api/dashboard/meal-builder/draft/reset")
      .set(auth.headers)
      .send({});
    expectStatus(response, 200, "reset draft to exact published partial state");
    assert.strictEqual(response.body.data.reset, true);
    assert.deepStrictEqual(response.body.data.draft.sections.map((section) => section.key), ["chef_specials"]);
    assert.strictEqual(response.body.data.draft.sections.length, 1);

    response = await api.get("/api/dashboard/meal-builder").set(auth.headers);
    expectStatus(response, 200, "dashboard response compatibility");
    for (const field of [
      "draft",
      "published",
      "preview",
      "plannerCatalog",
      "premiumSection",
      "validation",
    ]) {
      assert(Object.prototype.hasOwnProperty.call(response.body.data, field));
    }
    assertNoTemplateIssues(response.body.data.validation.draft, "final dashboard draft");
    assertNoTemplateIssues(response.body.data.validation.published, "final dashboard published");

    console.log("mealBuilderDynamicCardsValidation.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
