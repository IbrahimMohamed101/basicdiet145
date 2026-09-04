"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "meal-builder-option-relation-closure-jwt";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "meal-builder-option-relation-closure-dashboard";

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
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const {
  GROUP: REPAIR_GROUP,
  OPTIONS: REPAIR_OPTIONS,
  PRODUCT: REPAIR_PRODUCT,
  repairBasicMealCarbsRelations,
} = require("../scripts/repair-basic-meal-carbs-option-relations");

const NINE_CARB_KEYS = [
  "pesto_pasta",
  "grilled_vegetables",
  "turmeric_rice",
  "asian_white_rice",
  "white_rice",
  "brown_rice",
  "sweet_potato",
  "mashed_potato",
  "plain_pasta",
];

const PROTECTED_MODELS = [
  Order,
  Payment,
  Subscription,
  SubscriptionAuditLog,
  SubscriptionDay,
];

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_option_relation_closure_${Date.now()}`);
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
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function protectedCounts() {
  return Promise.all(PROTECTED_MODELS.map((Model) => Model.countDocuments({})));
}

async function createMenuFixture(api, headers) {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "relation_closure_meals",
    name: { ar: "وجبات اختبار العلاقات", en: "Relation closure meals" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal_relation_closure",
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
  const [carbs, proteins] = await MenuOptionGroup.insertMany([
    {
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
    {
      key: "proteins",
      name: { ar: "البروتين", en: "Proteins" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
  ]);
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: carbs._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });

  const options = [];
  for (const [index, key] of NINE_CARB_KEYS.entries()) {
    const response = await api
      .post(`/api/dashboard/menu/option-groups/${carbs._id}/options`)
      .set(headers)
      .send({
        key,
        name: { ar: `نشويات ${index + 1}`, en: key },
        availableFor: ["one_time", "subscription"],
        availableForSubscription: true,
        selectionType: "standard_meal",
        displayCategoryKey: "carbs",
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: index * 10,
      });
    expectStatus(response, 201, `global create ${key}`);
    options.push(response.body.data);
  }
  assert.equal(
    await ProductGroupOption.countDocuments({ productId: product._id, groupId: carbs._id }),
    0,
    "global group-only option creation must not attach options to Basic Meal"
  );

  const wrongGroupResponse = await api
    .post(`/api/dashboard/menu/option-groups/${proteins._id}/options`)
    .set(headers)
    .send({
      key: "wrong_group_protein",
      name: { ar: "بروتين خاطئ", en: "Wrong group protein" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      proteinFamilyKey: "chicken",
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
  expectStatus(wrongGroupResponse, 201, "create wrong-group option");

  return { product, carbs, proteins, options, wrongGroupOption: wrongGroupResponse.body.data };
}

function carbsCard(fixture, optionIds, key = "carbs_relation_closure") {
  return {
    cardType: "option_family",
    key,
    titleOverride: { ar: "النشويات", en: "Carbs" },
    optionRole: "carbs",
    productContextId: String(fixture.product._id),
    sourceGroupId: String(fixture.carbs._id),
    selectedOptionIds: optionIds,
    selectionType: "standard_meal",
    required: true,
    minSelections: 1,
    maxSelections: 2,
    multiSelect: true,
    visible: true,
    sortOrder: 20,
  };
}

async function testAuthoringAndMealBuilderClosure() {
  const api = request(createApp());
  const auth = await dashboardAuth("admin", "meal-builder-option-relation-closure");
  const protectedBefore = await protectedCounts();
  const fixture = await createMenuFixture(api, auth.headers);
  const firstOption = fixture.options[0];

  let response = await api
    .post("/api/dashboard/meal-builder/draft")
    .set(auth.headers)
    .send({ sections: [], notes: "option relation closure test" });
  expectStatus(response, 201, "create isolated Meal Builder draft");

  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(auth.headers)
    .send(carbsCard(fixture, [firstOption.id]));
  expectStatus(response, 422, "Meal Builder rejects group member missing product relation");
  assert.equal(response.body.error.code, "MEAL_BUILDER_OPTION_RELATION_INVALID");

  const attachPath = `/api/dashboard/menu/products/${fixture.product._id}/option-groups/${fixture.carbs._id}/options`;
  response = await api.post(attachPath).set(auth.headers).send({ optionId: firstOption.id });
  expectStatus(response, 201, "product-scoped attach creates ProductGroupOption");
  const relationId = String(response.body.data.id || response.body.data._id);
  assert.equal(await ProductGroupOption.countDocuments({
    productId: fixture.product._id,
    groupId: fixture.carbs._id,
    optionId: firstOption.id,
  }), 1);

  response = await api.post(attachPath).set(auth.headers).send({ optionId: firstOption.id });
  expectStatus(response, 201, "retry product-scoped attach");
  assert.equal(String(response.body.data.id || response.body.data._id), relationId);
  assert.equal(await ProductGroupOption.countDocuments({
    productId: fixture.product._id,
    groupId: fixture.carbs._id,
    optionId: firstOption.id,
  }), 1, "retry must not duplicate ProductGroupOption");

  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(auth.headers)
    .send(carbsCard(fixture, [firstOption.id]));
  expectStatus(response, 201, "Meal Builder accepts option after product attachment");

  await ProductGroupOption.updateOne(
    { productId: fixture.product._id, groupId: fixture.carbs._id, optionId: firstOption.id },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );
  response = await api
    .put("/api/dashboard/meal-builder/sections/carbs_relation_closure/items")
    .set(auth.headers)
    .send({ optionIds: [firstOption.id] });
  expectStatus(response, 422, "Meal Builder rejects inactive relation");
  assert.equal(response.body.error.code, "MEAL_BUILDER_OPTION_CARD_UNAVAILABLE");

  response = await api
    .post(attachPath)
    .set(auth.headers)
    .send({ optionId: firstOption.id, isActive: false, isVisible: false, isAvailable: false });
  expectStatus(response, 201, "re-attach inactive relation");
  const reactivated = await ProductGroupOption.findById(relationId).lean();
  assert.deepEqual(
    { isActive: reactivated.isActive, isVisible: reactivated.isVisible, isAvailable: reactivated.isAvailable },
    { isActive: true, isVisible: true, isAvailable: true }
  );
  response = await api
    .put("/api/dashboard/meal-builder/sections/carbs_relation_closure/items")
    .set(auth.headers)
    .send({ optionIds: [firstOption.id] });
  expectStatus(response, 200, "Meal Builder accepts reactivated relation");

  response = await api
    .post(attachPath)
    .set(auth.headers)
    .send({ optionId: fixture.wrongGroupOption.id });
  expectStatus(response, 422, "reject option belonging to another group");
  assert.equal(response.body.error.code, "OPTION_GROUP_MISMATCH");

  response = await api
    .delete(`${attachPath}/${firstOption.id}`)
    .set(auth.headers);
  expectStatus(response, 200, "remove option from Basic Meal only");
  assert.equal(await ProductGroupOption.countDocuments({ optionId: firstOption.id }), 0);
  assert(await MenuOption.findById(firstOption.id).lean(), "source MenuOption must still exist");

  for (const option of fixture.options) {
    response = await api.post(attachPath).set(auth.headers).send({ optionId: option.id });
    expectStatus(response, 201, `attach ${option.key}`);
  }
  assert.equal(await ProductGroupOption.countDocuments({
    productId: fixture.product._id,
    groupId: fixture.carbs._id,
  }), 9, "nine desired carbs have exactly nine relations");

  const hiddenOption = fixture.options[1];
  await ProductGroupOption.updateOne(
    { productId: fixture.product._id, groupId: fixture.carbs._id, optionId: hiddenOption.id },
    { $set: { isVisible: false } }
  );
  response = await api
    .put(attachPath)
    .set(auth.headers)
    .send({ optionIds: fixture.options.map((option) => option.id), preserveOverrides: true });
  expectStatus(response, 200, "product customization replacement restores selected options");
  const restoredByPut = await ProductGroupOption.findOne({
    productId: fixture.product._id,
    groupId: fixture.carbs._id,
    optionId: hiddenOption.id,
  }).lean();
  assert.deepEqual(
    { isActive: restoredByPut.isActive, isVisible: restoredByPut.isVisible, isAvailable: restoredByPut.isAvailable },
    { isActive: true, isVisible: true, isAvailable: true }
  );

  response = await api
    .delete("/api/dashboard/meal-builder/sections/carbs_relation_closure")
    .set(auth.headers);
  expectStatus(response, 200, "remove preliminary carbs card");
  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(auth.headers)
    .send(carbsCard(fixture, fixture.options.map((option) => option.id), "all_nine_carbs"));
  expectStatus(response, 201, "nine-carb regression card passes after all relations exist");
  assert.equal(response.body.data.section.selectedOptionIds.length, 9);

  response = await api
    .get("/api/dashboard/meal-builder/pickers/options")
    .query({
      targetSectionKey: "all_nine_carbs",
      productContextId: String(fixture.product._id),
      sourceGroupId: String(fixture.carbs._id),
      optionRole: "carbs",
      includeUnavailable: false,
      unassignedOnly: false,
      limit: 100,
    })
    .set(auth.headers);
  expectStatus(response, 200, "product-relation-scoped Meal Builder picker");
  assert.equal(response.body.data.candidates.length, 9);
  assert(response.body.data.candidates.every((candidate) => candidate.relationExists === true));
  assert(response.body.data.candidates.every((candidate) => candidate.assignable === true));

  assert.equal(await MealBuilderConfig.countDocuments({ status: "published" }), 0, "no Meal Builder publish");
  assert.deepEqual(await protectedCounts(), protectedBefore, "no subscription/order/payment/balance/history writes");
}

async function testProductionRepairMechanism() {
  await mongoose.connection.dropDatabase();
  const category = await MenuCategory.create({
    key: "repair_fixture_meals",
    name: { ar: "وجبات", en: "Meals" },
  });
  await MenuProduct.create({
    _id: REPAIR_PRODUCT.id,
    categoryId: category._id,
    key: REPAIR_PRODUCT.key,
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    pricingModel: "fixed",
    priceHalala: 1900,
  });
  await MenuOptionGroup.create({
    _id: REPAIR_GROUP.id,
    key: REPAIR_GROUP.key,
    name: { ar: "النشويات", en: "Carbs" },
  });
  const options = await MenuOption.insertMany(
    REPAIR_OPTIONS.map((option, index) => ({
      _id: option.id,
      groupId: REPAIR_GROUP.id,
      key: option.key,
      name: { ar: option.key, en: option.key },
      sortOrder: index * 10,
    }))
  );
  await ProductOptionGroup.create({
    productId: REPAIR_PRODUCT.id,
    groupId: REPAIR_GROUP.id,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });
  await ProductGroupOption.insertMany([
    {
      productId: REPAIR_PRODUCT.id,
      groupId: REPAIR_GROUP.id,
      optionId: options[1]._id,
      isActive: false,
      isVisible: true,
      isAvailable: true,
    },
    {
      productId: REPAIR_PRODUCT.id,
      groupId: REPAIR_GROUP.id,
      optionId: options[2]._id,
      isActive: true,
      isVisible: false,
      isAvailable: true,
    },
    {
      productId: REPAIR_PRODUCT.id,
      groupId: REPAIR_GROUP.id,
      optionId: options[3]._id,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    },
  ]);

  const dryRun = await repairBasicMealCarbsRelations();
  assert.equal(dryRun.mode, "DRY_RUN");
  assert.deepEqual(dryRun.plan.map((item) => item.action), [
    "CREATE",
    "REACTIVATE",
    "REACTIVATE",
    "NO-OP",
  ]);
  assert.equal(await ProductGroupOption.countDocuments({}), 3, "dry run performs no writes");

  const executed = await repairBasicMealCarbsRelations({ execute: true });
  assert.equal(executed.mode, "EXECUTE");
  assert.equal(await ProductGroupOption.countDocuments({}), 4);
  assert.equal(await ProductGroupOption.countDocuments({
    productId: REPAIR_PRODUCT.id,
    groupId: REPAIR_GROUP.id,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  }), 4);

  const repeated = await repairBasicMealCarbsRelations({ execute: true });
  assert.deepEqual(repeated.plan.map((item) => item.action), ["NO-OP", "NO-OP", "NO-OP", "NO-OP"]);
  assert.equal(await ProductGroupOption.countDocuments({}), 4, "repeated repair creates no duplicates");
}

async function run() {
  await connect();
  try {
    await testAuthoringAndMealBuilderClosure();
    await testProductionRepairMechanism();
    console.log("mealBuilderOptionRelationClosure.test.js passed (11 closure cases + repair safety)");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exitCode = 1;
});
