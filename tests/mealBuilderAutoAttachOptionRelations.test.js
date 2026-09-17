"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "meal-builder-auto-attach-jwt";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "meal-builder-auto-attach-dashboard";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_auto_attach_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, status, label) {
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function createFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "auto_attach_meals",
    name: { ar: "وجبات", en: "Meals" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "auto_attach_basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    itemType: "basic_meal",
    pricingModel: "fixed",
    priceHalala: 1900,
    availableFor: ["one_time", "subscription"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    ui: { cardVariant: "hero_builder" },
  });
  const [proteins, carbs] = await MenuOptionGroup.insertMany([
    {
      key: "proteins",
      name: { ar: "البروتين", en: "Proteins" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
    {
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
  ]);
  await ProductOptionGroup.insertMany([
    {
      productId: product._id,
      groupId: proteins._id,
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    },
    {
      productId: product._id,
      groupId: carbs._id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    },
  ]);

  const [chickenA, chickenB, premiumProtein, carb] = await MenuOption.insertMany([
    {
      groupId: proteins._id,
      key: "auto_attach_chicken_a",
      name: { ar: "دجاج أ", en: "Chicken A" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 10,
    },
    {
      groupId: proteins._id,
      key: "auto_attach_chicken_b",
      name: { ar: "دجاج ب", en: "Chicken B" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 20,
    },
    {
      groupId: proteins._id,
      key: "auto_attach_premium",
      name: { ar: "بروتين بريميم", en: "Premium Protein" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "premium_meal",
      premiumKey: "premium_test",
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 30,
    },
    {
      groupId: carbs._id,
      key: "auto_attach_rice",
      name: { ar: "رز", en: "Rice" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      displayCategoryKey: "standard_carbs",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 10,
    },
  ]);

  await ProductGroupOption.create({
    productId: product._id,
    groupId: carbs._id,
    optionId: carb._id,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });

  return { product, proteins, carbs, chickenA, chickenB, premiumProtein, carb };
}

function carbsCard(fixture) {
  return {
    cardType: "option_family",
    key: "carbs",
    titleOverride: { ar: "النشويات", en: "Carbs" },
    optionRole: "carbs",
    productContextId: String(fixture.product._id),
    sourceGroupId: String(fixture.carbs._id),
    selectedOptionIds: [String(fixture.carb._id)],
    selectionType: "standard_meal",
    required: true,
    minSelections: 1,
    maxSelections: 2,
    multiSelect: true,
    visible: true,
    sortOrder: 20,
  };
}

function chickenCard(fixture, optionIds) {
  return {
    cardType: "option_family",
    key: "chicken",
    titleOverride: { ar: "دجاج", en: "Chicken" },
    optionRole: "protein",
    productContextId: String(fixture.product._id),
    sourceGroupId: String(fixture.proteins._id),
    selectedOptionIds: optionIds.map(String),
    selectionType: "standard_meal",
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    familyKey: "chicken",
    visible: true,
    sortOrder: 30,
  };
}

async function run() {
  await connect();
  try {
    const api = request(createApp());
    const auth = await dashboardAuth("admin", "meal-builder-auto-attach");
    const fixture = await createFixture();

    assert.equal(
      await ProductGroupOption.countDocuments({
        productId: fixture.product._id,
        groupId: fixture.proteins._id,
      }),
      0,
      "global protein options start without product relations"
    );

    let response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [], notes: "auto attach closure" });
    expectStatus(response, 201, "create draft");

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send(carbsCard(fixture));
    expectStatus(response, 201, "create companion carbs card");

    response = await api
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send(chickenCard(fixture, [fixture.chickenA._id]));
    expectStatus(response, 201, "creating chicken card auto-attaches missing relation");
    let relationA = await ProductGroupOption.findOne({
      productId: fixture.product._id,
      groupId: fixture.proteins._id,
      optionId: fixture.chickenA._id,
    }).lean();
    assert(relationA, "missing chicken relation must be created");
    assert.deepEqual(
      {
        isActive: relationA.isActive,
        isVisible: relationA.isVisible,
        isAvailable: relationA.isAvailable,
      },
      { isActive: true, isVisible: true, isAvailable: true }
    );

    await ProductGroupOption.updateOne(
      { _id: relationA._id },
      { $set: { isActive: false, isVisible: false, isAvailable: false } }
    );
    response = await api
      .put("/api/dashboard/meal-builder/sections/chicken/items")
      .set(auth.headers)
      .send({ optionIds: [String(fixture.chickenA._id)] });
    expectStatus(response, 200, "saving card reactivates disabled product relation");
    relationA = await ProductGroupOption.findById(relationA._id).lean();
    assert.deepEqual(
      {
        isActive: relationA.isActive,
        isVisible: relationA.isVisible,
        isAvailable: relationA.isAvailable,
      },
      { isActive: true, isVisible: true, isAvailable: true }
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections/chicken/options")
      .set(auth.headers)
      .send({ optionIds: [String(fixture.chickenB._id)] });
    expectStatus(response, 200, "adding another chicken option auto-attaches relation");
    assert.equal(
      await ProductGroupOption.countDocuments({
        productId: fixture.product._id,
        groupId: fixture.proteins._id,
        optionId: fixture.chickenB._id,
      }),
      1,
      "new option has exactly one product relation"
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections/chicken/options")
      .set(auth.headers)
      .send({ optionIds: [String(fixture.carb._id)] });
    expectStatus(response, 422, "wrong-group option rejected before attachment");
    assert.equal(response.body.error.code, "MEAL_BUILDER_OPTION_GROUP_MISMATCH");
    assert.equal(
      await ProductGroupOption.countDocuments({
        productId: fixture.product._id,
        groupId: fixture.proteins._id,
        optionId: fixture.carb._id,
      }),
      0,
      "wrong-group option must not gain a product relation"
    );

    response = await api
      .post("/api/dashboard/meal-builder/sections/chicken/options")
      .set(auth.headers)
      .send({ optionIds: [String(fixture.premiumProtein._id)] });
    expectStatus(response, 422, "Premium option rejected before attachment");
    assert.equal(response.body.error.code, "MEAL_BUILDER_PREMIUM_OPTION_SYSTEM_MANAGED");
    assert.equal(
      await ProductGroupOption.countDocuments({
        productId: fixture.product._id,
        groupId: fixture.proteins._id,
        optionId: fixture.premiumProtein._id,
      }),
      0,
      "Premium option must not be auto-attached by standard cards"
    );

    assert.equal(
      await ProductGroupOption.countDocuments({
        productId: fixture.product._id,
        groupId: fixture.proteins._id,
        optionId: fixture.chickenA._id,
      }),
      1,
      "retries must remain idempotent"
    );
    assert.equal(await MealBuilderConfig.countDocuments({ status: "published" }), 0, "no auto publish");
    assert.equal(await Subscription.countDocuments({}), 0, "no subscription writes");
    assert.equal(await Order.countDocuments({}), 0, "no order writes");
    assert.equal(await Payment.countDocuments({}), 0, "no payment writes");

    console.log("mealBuilderAutoAttachOptionRelations: PASS");
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
