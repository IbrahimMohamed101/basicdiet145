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
      .send({ sections: [], notes: "two-type isolated draft" });
    expectStatus(response, 201, "create empty draft");

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
    assert(
      response.body.data.candidates.every(
        (candidate) => candidate.selectionType === "full_meal_product"
      ),
      "all direct product candidates use the canonical selection type"
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "direct_product",
        key: "sandwiches",
        titleOverride: { ar: "ساندويتشات", en: "Sandwiches" },
        selectionType: "sandwich",
        selectedProductIds: [String(product._id)],
        visible: true,
        sortOrder: 10,
      });
    expectStatus(response, 201, "accept legacy sandwich alias");
    assert.equal(
      response.body.data.section.selectionType,
      "full_meal_product"
    );
    assert.equal(
      response.body.data.section.metadata.cardKind,
      "full_meal_product"
    );

    let draft = await MealBuilderConfig.findOne({
      status: "draft",
      isCurrent: true,
    }).lean();
    assert.equal(draft.sections[0].selectionType, "full_meal_product");

    await MealBuilderConfig.updateOne(
      { _id: draft._id, "sections.key": "sandwiches" },
      { $set: { "sections.$.selectionType": "sandwich" } }
    );

    response = await api
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(response, 200, "canonicalize historical dashboard config");
    const dashboardSection = response.body.data.draft.sections.find(
      (section) => section.key === "sandwiches"
    );
    assert.equal(dashboardSection.selectionType, "full_meal_product");

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
    expectStatus(response, 200, "publish canonicalized legacy draft");

    const published = await MealBuilderConfig.findOne({
      status: "published",
      isCurrent: true,
    }).lean();
    const storedPublishedSection = published.sections.find(
      (section) => section.key === "sandwiches"
    );
    assert.equal(storedPublishedSection.selectionType, "full_meal_product");

    response = await api.get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "read Flutter V3 canonical contract");
    const contract = response.body.data.builderCatalog;
    const publicSection = findSection(contract, "sandwiches");
    assert(publicSection, "named Sandwiches card remains available");
    assert.equal(publicSection.selectionType, "full_meal_product");
    assert(
      !selectionTypes(contract).includes("sandwich"),
      "Flutter V3 does not expose sandwich as a selection type"
    );
    const directProduct = (publicSection.products || [])[0];
    assert(directProduct, "direct product reaches Flutter V3");
    assert.equal(directProduct.selectionType, "full_meal_product");
    assert.equal(directProduct.action.type, "direct_add");
    assert.equal(directProduct.action.requiresBuilder, false);
    assert.equal(directProduct.action.treatAsFullMeal, true);

    assert.equal(
      (await MenuProduct.findById(product._id).lean()).itemType,
      "product",
      "selection type migration never mutates MenuProduct"
    );

    console.log("dashboard Meal Planner two-type policy passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
