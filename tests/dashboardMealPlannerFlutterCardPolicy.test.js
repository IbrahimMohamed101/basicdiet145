"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-jwt-flutter-card-policy-111111";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-flutter-card-policy";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_planner_flutter_cards_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expected, label) {
  assert.equal(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(
      response.body
    )}`
  );
}

function findSection(contract, sectionKey) {
  return (contract?.sections || []).find((section) => section.key === sectionKey);
}

function findProduct(section, productId) {
  return (section?.products || []).find(
    (product) => String(product.id || product.productId) === String(productId)
  );
}

function findGroup(product, groupId) {
  return (product?.optionGroups || []).find(
    (group) => String(group.id || group.groupId) === String(groupId)
  );
}

function optionIds(group) {
  return (group?.options || []).map((option) =>
    String(option.id || option.optionId)
  );
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "flutter_card_policy",
      name: { ar: "اختبار مخطط الوجبات", en: "Meal Planner Test" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 1,
    });

    const [readyMeal, baseMeal] = await MenuProduct.insertMany([
      {
        categoryId: category._id,
        key: "chocolate_ice_cream_ready_meal",
        name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1500,
        availableFor: ["subscription"],
        ui: { cardVariant: "ready_meal" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: 10,
      },
      {
        categoryId: category._id,
        key: "basic_meal_flutter_context",
        name: { ar: "وجبة أساسية", en: "Basic Meal" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1900,
        availableFor: ["subscription"],
        isCustomizable: true,
        ui: { cardVariant: "hero_builder" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: 20,
      },
    ]);

    const [proteinsGroup, carbsGroup] = await MenuOptionGroup.insertMany([
      {
        key: "proteins",
        name: { ar: "البروتين", en: "Proteins" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: 10,
      },
      {
        key: "carbs",
        name: { ar: "النشويات", en: "Carbs" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: 20,
      },
    ]);

    const [beefSteak, beefStrips, whiteRice, unlinkedBeef] =
      await MenuOption.insertMany([
        {
          groupId: proteinsGroup._id,
          key: "flutter_beef_steak",
          name: { ar: "ستيك لحم", en: "Beef Steak" },
          selectionType: "standard_meal",
          proteinFamilyKey: "beef",
          displayCategoryKey: "beef",
          availableFor: ["subscription"],
          isActive: true,
          isVisible: true,
          isAvailable: true,
          publishedAt: now,
          sortOrder: 10,
        },
        {
          groupId: proteinsGroup._id,
          key: "flutter_beef_strips",
          name: { ar: "شرائح لحم", en: "Beef Strips" },
          selectionType: "standard_meal",
          proteinFamilyKey: "beef",
          displayCategoryKey: "beef",
          availableFor: ["subscription"],
          isActive: true,
          isVisible: true,
          isAvailable: true,
          publishedAt: now,
          sortOrder: 20,
        },
        {
          groupId: carbsGroup._id,
          key: "flutter_white_rice",
          name: { ar: "أرز أبيض", en: "White Rice" },
          selectionType: "standard_meal",
          displayCategoryKey: "carbs",
          availableFor: ["subscription"],
          isActive: true,
          isVisible: true,
          isAvailable: true,
          publishedAt: now,
          sortOrder: 10,
        },
        {
          groupId: proteinsGroup._id,
          key: "flutter_unlinked_beef",
          name: { ar: "لحم غير مربوط", en: "Unlinked Beef" },
          selectionType: "standard_meal",
          proteinFamilyKey: "beef",
          displayCategoryKey: "beef",
          availableFor: ["subscription"],
          isActive: true,
          isVisible: true,
          isAvailable: true,
          publishedAt: now,
          sortOrder: 30,
        },
      ]);

    await ProductOptionGroup.insertMany([
      {
        productId: baseMeal._id,
        groupId: proteinsGroup._id,
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 10,
      },
      {
        productId: baseMeal._id,
        groupId: carbsGroup._id,
        minSelections: 1,
        maxSelections: 2,
        isRequired: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 20,
      },
    ]);

    await ProductGroupOption.insertMany([
      {
        productId: baseMeal._id,
        groupId: proteinsGroup._id,
        optionId: beefSteak._id,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 10,
      },
      {
        productId: baseMeal._id,
        groupId: proteinsGroup._id,
        optionId: beefStrips._id,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 20,
      },
      {
        productId: baseMeal._id,
        groupId: carbsGroup._id,
        optionId: whiteRice._id,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 10,
      },
    ]);

    const app = createApp();
    const api = request(app);
    const auth = await dashboardAuth("admin", "flutter-card-policy");

    let response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [], notes: "Flutter card policy live direct draft" });
    expectStatus(response, 201, "create live direct draft");

    response = await api
      .get("/api/dashboard/meal-builder/catalog?lang=en")
      .set(auth.headers);
    expectStatus(response, 200, "load complete dashboard catalog");
    assert.equal(
      response.body.data.cardContract.contractVersion,
      "dashboard_meal_planner_cards.v2"
    );
    assert.deepEqual(
      response.body.data.cardContract.dynamicCardTypes.map(
        (entry) => entry.cardType
      ),
      ["direct_product", "option_family"]
    );
    assert(
      response.body.data.searchFacets.productCategories.some(
        (entry) => entry.key === category.key
      )
    );
    assert(
      response.body.data.searchFacets.optionGroups.some(
        (entry) => entry.key === "proteins"
      )
    );
    assert(response.body.data.searchFacets.proteinFamilies.includes("beef"));

    response = await api
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(response, 200, "load live direct picker");
    const directCandidateIds = new Set(
      response.body.data.candidates.map((candidate) => String(candidate.productId))
    );
    assert(directCandidateIds.has(String(readyMeal._id)));
    assert(!directCandidateIds.has(String(baseMeal._id)));
    assert.equal(response.body.data.rules.membershipSource, "live_catalog");

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "beef",
        titleOverride: { ar: "اللحمة", en: "Beef" },
        optionRole: "protein",
        familyKey: "beef",
        productContextId: String(baseMeal._id),
        sourceGroupId: String(proteinsGroup._id),
        selectedOptionIds: [String(beefSteak._id), String(beefStrips._id)],
        visible: true,
        sortOrder: 20,
      });
    expectStatus(response, 201, "create beef option family card");
    assert.equal(response.body.data.section.cardType, "option_family");
    assert.equal(response.body.data.section.optionRole, "protein");
    assert.equal(response.body.data.section.completeByItself, false);
    assert.equal(
      response.body.data.section.flutterSlotContract.idField,
      "proteinId"
    );
    assert.equal(response.body.data.section.selectionType, "standard_meal");
    assert(
      response.body.data.validation.errors.some(
        (item) => item.code === "MEAL_BUILDER_CARBS_CARD_REQUIRED"
      )
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "invalid_protein_group",
        titleOverride: { ar: "خطأ", en: "Invalid" },
        optionRole: "protein",
        familyKey: "beef",
        productContextId: String(baseMeal._id),
        sourceGroupId: String(carbsGroup._id),
        selectedOptionIds: [String(whiteRice._id)],
      });
    expectStatus(response, 422, "reject role/group mismatch");
    assert.equal(
      response.body.error.code,
      "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH"
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "duplicate_beef",
        titleOverride: { ar: "لحم مكرر", en: "Duplicate Beef" },
        optionRole: "protein",
        familyKey: "beef",
        productContextId: String(baseMeal._id),
        sourceGroupId: String(proteinsGroup._id),
        selectedOptionIds: [String(beefSteak._id)],
      });
    expectStatus(response, 409, "reject duplicate option assignment");
    assert.equal(response.body.error.code, "MEAL_BUILDER_OPTION_ALREADY_ASSIGNED");

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "unlinked_beef",
        titleOverride: { ar: "لحم غير مربوط", en: "Unlinked Beef" },
        optionRole: "protein",
        familyKey: "beef",
        productContextId: String(baseMeal._id),
        sourceGroupId: String(proteinsGroup._id),
        selectedOptionIds: [String(unlinkedBeef._id)],
      });
    expectStatus(response, 422, "reject unlinked option");
    assert.equal(
      response.body.error.code,
      "MEAL_BUILDER_OPTION_RELATION_INVALID"
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "carbs",
        titleOverride: { ar: "النشويات", en: "Carbs" },
        optionRole: "carbs",
        productContextId: String(baseMeal._id),
        sourceGroupId: String(carbsGroup._id),
        selectedOptionIds: [String(whiteRice._id)],
        visible: true,
        sortOrder: 30,
      });
    expectStatus(response, 201, "create carbs option card");
    assert.equal(response.body.data.section.cardType, "option_family");
    assert.equal(response.body.data.section.optionRole, "carbs");
    assert.equal(
      response.body.data.section.flutterSlotContract.idField,
      "carbs[].carbId"
    );

    response = await api
      .get(
        `/api/dashboard/meal-builder/pickers/options?targetSectionKey=beef&productContextId=${baseMeal._id}&sourceGroupId=${proteinsGroup._id}&optionRole=protein&familyKey=beef&includeUnavailable=true&unassignedOnly=false`
      )
      .set(auth.headers);
    expectStatus(response, 200, "load option family picker");
    assert.equal(response.body.data.cardType, "option_family");
    assert.equal(response.body.data.rules.flutterSlotField, "proteinId");
    assert(
      response.body.data.candidates.some(
        (candidate) => candidate.optionId === String(beefSteak._id)
      )
    );
    assert.equal(
      response.body.data.candidates.some(
        (candidate) => candidate.optionId === String(unlinkedBeef._id)
      ),
      false
    );

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({});
    expectStatus(response, 200, "validate Flutter-compatible draft");
    assert.equal(response.body.data.ready, true, JSON.stringify(response.body.data));

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "Publish Flutter-aligned live and option cards" });
    expectStatus(response, 200, "publish Flutter-compatible cards");

    response = await api.get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "read public Flutter V3 contract");
    assert.equal(
      response.body.data.builderCatalog.contractVersion,
      "meal_planner_menu.v3"
    );

    const contract = response.body.data.builderCatalog;
    const directSection = findSection(contract, "sandwich");
    const beefSection = findSection(contract, "beef");
    const carbsSection = findSection(contract, "carbs");
    assert(directSection, "system direct product card reaches Flutter contract");
    assert(beefSection, "protein option card reaches Flutter contract");
    assert(carbsSection, "carbs option card reaches Flutter contract");

    const directProduct = findProduct(directSection, readyMeal._id);
    assert(directProduct, "ready meal reaches the live direct card");
    assert.equal(directProduct.selectionType, "full_meal_product");
    assert.equal(directProduct.action.type, "direct_add");
    assert.equal(directProduct.action.requiresBuilder, false);
    assert.equal(directProduct.action.treatAsFullMeal, true);

    const beefProduct = findProduct(beefSection, baseMeal._id);
    assert(beefProduct, "base product is preserved for protein options");
    const beefGroup = findGroup(beefProduct, proteinsGroup._id);
    assert(beefGroup, "real proteins group is preserved");
    assert.deepEqual(optionIds(beefGroup), [
      String(beefSteak._id),
      String(beefStrips._id),
    ]);

    const carbsProduct = findProduct(carbsSection, baseMeal._id);
    assert(carbsProduct, "base product is preserved for carbs");
    const publicCarbsGroup = findGroup(carbsProduct, carbsGroup._id);
    assert(publicCarbsGroup, "real carbs group is preserved");
    assert.deepEqual(optionIds(publicCarbsGroup), [String(whiteRice._id)]);

    console.log(
      "dashboard Meal Planner Flutter live Product/Option card policy passed"
    );
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
