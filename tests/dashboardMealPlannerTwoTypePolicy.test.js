"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-jwt-two-type-policy-111111";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-two-type-policy";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_planner_two_types_${Date.now()}`);
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

function selectionTypes(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) selectionTypes(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "selectionType" || key === "directSelectionType") {
      output.push(String(entry || ""));
    }
    selectionTypes(entry, output);
  }
  return output;
}

function findSection(contract, key) {
  return (contract?.sections || []).find((section) => section.key === key);
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "two_type_policy",
      name: { ar: "اختبار النوعين", en: "Two Type Policy" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 1,
    });
    const product = await MenuProduct.create({
      categoryId: category._id,
      key: "legacy_sandwich_alias_product",
      name: { ar: "منتج مستقل", en: "Standalone Product" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1800,
      availableFor: ["subscription"],
      ui: { cardVariant: "sandwich_card" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 10,
    });

    const api = request(createApp());
    const auth = await dashboardAuth("admin", "two-type-policy");

    let response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [], notes: "two-type system-managed draft" });
    expectStatus(response, 201, "create system-managed draft");

    response = await api
      .get("/api/dashboard/meal-builder/catalog?lang=en")
      .set(auth.headers);
    expectStatus(response, 200, "read two-type contract");
    const directContract = response.body.data.cardContract.dynamicCardTypes.find(
      (entry) => entry.cardType === "direct_product"
    );
    const optionContract = response.body.data.cardContract.dynamicCardTypes.find(
      (entry) => entry.cardType === "option_family"
    );
    assert.deepEqual(directContract.allowedSelectionTypes, [
      "full_meal_product",
    ]);
    assert.deepEqual(directContract.deprecatedSelectionTypes, ["sandwich"]);
    assert.equal(
      directContract.legacyInputPolicy,
      "normalize_to_full_meal_product"
    );
    assert.equal(optionContract.selectionType, "standard_meal");
    assert.deepEqual(
      response.body.data.cardContract.canonicalSelectionTypes,
      {
        directProduct: "full_meal_product",
        optionMeal: "standard_meal",
        deprecatedAliases: ["sandwich"],
      }
    );

    response = await api
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=100&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(response, 200, "read direct product picker");
    assert.deepEqual(response.body.data.rules.allowedSelectionTypes, [
      "full_meal_product",
    ]);
    assert.deepEqual(response.body.data.rules.deprecatedSelectionTypes, [
      "sandwich",
    ]);
    assert.equal(response.body.data.rules.membershipSource, "live_catalog");
    assert(
      response.body.data.candidates.every(
        (candidate) => candidate.selectionType === "full_meal_product"
      ),
      "all direct candidates use the canonical selection type"
    );
    assert(
      response.body.data.candidates.some(
        (candidate) => candidate.productId === String(product._id)
      ),
      "live direct product is present without manual membership"
    );

    let draft = await MealBuilderConfig.findOne({
      status: "draft",
      isCurrent: true,
    }).lean();
    let storedSection = draft.sections.find(
      (section) => section.key === "sandwich"
    );
    assert(storedSection, "system-managed canonical section is stored");
    assert.equal(storedSection.selectionType, "full_meal_product");
    assert(
      storedSection.selectedProductIds.map(String).includes(String(product._id))
    );

    // Simulate a historical database document. Runtime state, validation and
    // publication must normalize both the old key and the deprecated type.
    await MealBuilderConfig.updateOne(
      { _id: draft._id, "sections.key": "sandwich" },
      {
        $set: {
          "sections.$.key": "sandwiches",
          "sections.$.selectionType": "sandwich",
          "sections.$.metadata.membershipSource": "legacy_selected_ids",
          "sections.$.metadata.systemManaged": false,
        },
      }
    );

    response = await api
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(response, 200, "canonicalize historical dashboard config");
    const dashboardSections = response.body.data.draft.sections.filter(
      (section) => section.key === "sandwich"
    );
    assert.equal(dashboardSections.length, 1);
    assert.equal(dashboardSections[0].selectionType, "full_meal_product");
    assert.equal(dashboardSections[0].metadata.membershipSource, "live_catalog");
    assert.equal(dashboardSections[0].metadata.systemManaged, true);

    response = await api
      .post("/api/dashboard/meal-builder/validate")
      .set(auth.headers)
      .send({});
    expectStatus(response, 200, "validate historical alias through canonical view");
    assert.equal(response.body.data.ready, true, JSON.stringify(response.body.data));

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish canonical two-type contract" });
    expectStatus(response, 200, "publish canonicalized historical draft");

    const published = await MealBuilderConfig.findOne({
      status: "published",
      isCurrent: true,
    }).lean();
    const publishedDirectSections = published.sections.filter(
      (section) => section.key === "sandwich"
    );
    assert.equal(publishedDirectSections.length, 1);
    assert.equal(
      publishedDirectSections[0].selectionType,
      "full_meal_product"
    );
    assert.equal(
      publishedDirectSections[0].metadata.membershipSource,
      "live_catalog"
    );

    response = await api.get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "read Flutter V3 canonical contract");
    const contract = response.body.data.builderCatalog;
    const publicSection = findSection(contract, "sandwich");
    assert(publicSection, "canonical direct section remains available");
    assert.equal(publicSection.selectionType, "full_meal_product");
    assert(
      !selectionTypes(contract).includes("sandwich"),
      "Flutter V3 does not expose sandwich as a selection type"
    );
    const directProduct = (publicSection.products || []).find(
      (item) => String(item.productId || item.id) === String(product._id)
    );
    assert(directProduct, "live direct product reaches Flutter V3");
    assert.equal(directProduct.selectionType, "full_meal_product");
    assert.equal(directProduct.action.type, "direct_add");
    assert.equal(directProduct.action.requiresBuilder, false);
    assert.equal(directProduct.action.treatAsFullMeal, true);

    assert.equal(
      (await MenuProduct.findById(product._id).lean()).itemType,
      "product",
      "normalization never mutates MenuProduct"
    );

    console.log("dashboard Meal Planner canonical two-type policy passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
