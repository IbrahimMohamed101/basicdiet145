"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "protein-family-closure-jwt";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "protein-family-closure-dashboard";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const mealBuilderService = require("../src/services/subscription/dashboardMealPlannerDashboardService");
const { serializePublicOption } = require("../src/services/orders/menuCatalogPresenter");
const {
  PROTEIN_VISUAL_FAMILY_OPTION_KEYS,
  resolveProteinFamilyClassification,
} = require("../src/config/mealPlannerContract");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const {
  BASIC_MEAL_ID,
  PROTEINS_GROUP_ID,
  TARGETS,
  repairBasicMealProteinFamilyMetadata,
} = require("../scripts/repair-basic-meal-protein-family-metadata");

const PROTECTED_MODELS = [Order, Payment, Subscription, SubscriptionDay];
let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`protein_family_closure_${Date.now()}`);
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

function card(fixture, familyKey, optionIds, key = `${familyKey}_card`) {
  return {
    cardType: "option_family",
    key,
    titleOverride: { ar: familyKey, en: familyKey },
    optionRole: "protein",
    familyKey,
    productContextId: String(fixture.product._id),
    sourceGroupId: String(fixture.proteins._id),
    selectedOptionIds: optionIds.map(String),
    selectionType: "standard_meal",
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    sortOrder: 10,
  };
}

async function createFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "protein_family_closure",
    name: { ar: "إغلاق عائلة البروتين", en: "Protein family closure" },
    publishedAt: now,
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    itemType: "basic_meal",
    pricingModel: "fixed",
    priceHalala: 1900,
    availableFor: ["subscription"],
    isCustomizable: true,
    publishedAt: now,
  });
  const proteins = await MenuOptionGroup.create({
    key: "proteins",
    name: { ar: "البروتين", en: "Proteins" },
    publishedAt: now,
  });
  const carbs = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "النشويات", en: "Carbs" },
    publishedAt: now,
  });
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: proteins._id,
    minSelections: 0,
    maxSelections: 1,
    isRequired: false,
  });
  await MealBuilderConfig.create({ status: "draft", isCurrent: true, source: "dashboard", sections: [] });
  return { category, product, proteins, carbs };
}

async function createGlobalProtein(api, headers, fixture, key, familyKey) {
  const response = await api
    .post(`/api/dashboard/menu/option-groups/${fixture.proteins._id}/options`)
    .set(headers)
    .send({
      key,
      name: { ar: key, en: key },
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      proteinFamilyKey: familyKey,
      displayCategoryKey: familyKey,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
  expectStatus(response, 201, `create ${key}`);
  assert.equal(response.body.data.proteinFamilyKey, familyKey);
  assert.equal(response.body.data.displayCategoryKey, familyKey);
  assert.equal(response.body.data.resolvedFamilyKey, familyKey);
  assert.equal(response.body.data.selectionType, "standard_meal");
  return response.body.data;
}

async function expectLowLevelUnavailable(action, reasonCode, label) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, "MEAL_BUILDER_OPTION_CARD_UNAVAILABLE", label);
    assert(
      error.details.problems.some((problem) => problem.reasonCodes.includes(reasonCode)),
      `${label}: ${JSON.stringify(error.details)}`
    );
    return true;
  });
}

async function testAuthoringAndAssignmentMatrix() {
  const api = request(createApp());
  const { headers } = await dashboardAuth("admin", "protein-family-closure");
  const fixture = await createFixture();
  const protectedBefore = await protectedCounts();

  let response = await api
    .post(`/api/dashboard/menu/option-groups/${fixture.proteins._id}/options`)
    .set(headers)
    .send({ key: "missing_global_family", name: { ar: "بلا عائلة", en: "Missing family" } });
  expectStatus(response, 422, "global protein authoring requires family");
  assert.equal(response.body.error.code, "PROTEIN_FAMILY_REQUIRED");

  response = await api
    .post(`/api/dashboard/menu/option-groups/${fixture.proteins._id}/options`)
    .set(headers)
    .send({
      key: "invalid_global_family",
      name: { ar: "خطأ", en: "Invalid" },
      proteinFamilyKey: "seafood",
      displayCategoryKey: "seafood",
    });
  expectStatus(response, 422, "invalid family rejected");
  assert.equal(response.body.error.code, "INVALID_PROTEIN_FAMILY_KEY");

  response = await api
    .post(`/api/dashboard/menu/option-groups/${fixture.proteins._id}/options`)
    .set(headers)
    .send({
      key: "conflicting_global_family",
      name: { ar: "تعارض", en: "Conflict" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "beef",
    });
  expectStatus(response, 422, "conflicting display family rejected");
  assert.equal(response.body.error.code, "PROTEIN_FAMILY_DISPLAY_CONFLICT");

  response = await api
    .post(`/api/dashboard/menu/option-groups/${fixture.carbs._id}/options`)
    .set(headers)
    .send({
      key: "carb_with_family",
      name: { ar: "كارب", en: "Carb" },
      proteinFamilyKey: "chicken",
    });
  expectStatus(response, 422, "non-protein option rejects protein family");
  assert.equal(response.body.error.code, "PROTEIN_FAMILY_NOT_ALLOWED_FOR_GROUP");

  const chickenKeys = [
    "new_chicken_recipe_a",
    "new_chicken_recipe_b",
    "new_chicken_recipe_c",
    "new_chicken_recipe_d",
  ];
  const chicken = [];
  for (const key of chickenKeys) {
    assert.equal(PROTEIN_VISUAL_FAMILY_OPTION_KEYS[key], undefined, `${key} is not statically mapped`);
    chicken.push(await createGlobalProtein(api, headers, fixture, key, "chicken"));
  }
  const beef = await createGlobalProtein(api, headers, fixture, "new_beef_recipe_next_week", "beef");
  const fish = await createGlobalProtein(api, headers, fixture, "new_fish_recipe_next_week", "fish");

  response = await api
    .patch(`/api/dashboard/menu/options/${chicken[0].id}`)
    .set(headers)
    .send({ name: { ar: "دجاج محدث", en: "Updated chicken" } });
  expectStatus(response, 200, "PATCH omitting family preserves metadata");
  assert.equal(response.body.data.proteinFamilyKey, "chicken");
  assert.equal(response.body.data.displayCategoryKey, "chicken");

  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(headers)
    .send(card(fixture, "chicken", chicken.map((option) => option.id)));
  expectStatus(response, 201, "four future chicken keys save without static allowlist");
  assert.equal(response.body.data.section.selectedOptionIds.length, 4);
  assert.equal(await ProductGroupOption.countDocuments({
    productId: fixture.product._id,
    groupId: fixture.proteins._id,
    optionId: { $in: chicken.map((option) => option.id) },
  }), 4, "missing product relations are created exactly once");

  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(headers)
    .send(card(fixture, "beef", [beef.id]));
  expectStatus(response, 201, "future beef key saves without static allowlist");
  response = await api
    .post("/api/dashboard/meal-builder/sections")
    .set(headers)
    .send(card(fixture, "fish", [fish.id]));
  expectStatus(response, 201, "future fish key saves without static allowlist");

  const missing = await MenuOption.create({
    groupId: fixture.proteins._id,
    key: "new_unclassified_recipe",
    name: { ar: "غير مصنف", en: "Unclassified" },
    availableFor: ["subscription"],
    publishedAt: new Date(),
  });
  await ProductGroupOption.create({
    productId: fixture.product._id,
    groupId: fixture.proteins._id,
    optionId: missing._id,
  });
  await expectLowLevelUnavailable(
    () => mealBuilderService.updateProductSection({
      sectionKey: "chicken_card",
      patch: { selectedOptionIds: [...chicken.map((option) => option.id), String(missing._id)] },
      actor: { role: "admin" },
    }),
    "OPTION_FAMILY_MISMATCH",
    "low-level validator fails closed on blank family"
  );

  response = await api
    .patch("/api/dashboard/meal-builder/sections/chicken_card")
    .set(headers)
    .send({ selectedOptionIds: [...chicken.map((option) => option.id), String(missing._id)] });
  expectStatus(response, 200, "explicit Chicken-card flow completes blank metadata");
  const classifiedMissing = await MenuOption.findById(missing._id).lean();
  assert.equal(classifiedMissing.proteinFamilyKey, "chicken");
  assert.equal(classifiedMissing.displayCategoryKey, "chicken");
  assert(await MenuAuditLog.findOne({
    entityId: missing._id,
    action: "protein_family_classification_completed",
    "meta.source": "meal_builder_family_card",
  }).lean(), "blank completion writes an audit record");

  await expectLowLevelUnavailable(
    () => mealBuilderService.updateProductSection({
      sectionKey: "chicken_card",
      patch: { selectedOptionIds: [beef.id] },
      actor: { role: "admin" },
    }),
    "OPTION_FAMILY_MISMATCH",
    "Beef -> Chicken remains rejected"
  );
  await expectLowLevelUnavailable(
    () => mealBuilderService.updateProductSection({
      sectionKey: "chicken_card",
      patch: { selectedOptionIds: [fish.id] },
      actor: { role: "admin" },
    }),
    "OPTION_FAMILY_MISMATCH",
    "Fish -> Chicken remains rejected"
  );
  await expectLowLevelUnavailable(
    () => mealBuilderService.updateProductSection({
      sectionKey: "beef_card",
      patch: { selectedOptionIds: [chicken[0].id] },
      actor: { role: "admin" },
    }),
    "OPTION_FAMILY_MISMATCH",
    "Chicken -> Beef remains rejected"
  );
  await expectLowLevelUnavailable(
    () => mealBuilderService.updateProductSection({
      sectionKey: "fish_card",
      patch: { selectedOptionIds: [chicken[0].id] },
      actor: { role: "admin" },
    }),
    "OPTION_FAMILY_MISMATCH",
    "Chicken -> Fish remains rejected"
  );

  response = await api
    .patch("/api/dashboard/meal-builder/sections/chicken_card")
    .set(headers)
    .send({ selectedOptionIds: [beef.id] });
  expectStatus(response, 422, "product-scoped wrong family rejected before rewrite");
  assert.equal(response.body.error.code, "OPTION_FAMILY_MISMATCH");
  assert.equal((await MenuOption.findById(beef.id).lean()).proteinFamilyKey, "beef");

  const wrongGroup = await MenuOption.create({
    groupId: fixture.carbs._id,
    key: "wrong_group_chicken_metadata",
    name: { ar: "مجموعة خاطئة", en: "Wrong group" },
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    publishedAt: new Date(),
  });
  response = await api
    .patch("/api/dashboard/meal-builder/sections/chicken_card")
    .set(headers)
    .send({ selectedOptionIds: [String(wrongGroup._id)] });
  expectStatus(response, 422, "wrong group rejected");
  assert.equal(response.body.error.code, "MEAL_BUILDER_OPTION_GROUP_MISMATCH");

  const premium = await MenuOption.create({
    groupId: fixture.proteins._id,
    key: "system_premium_fixture",
    name: { ar: "بريميوم", en: "Premium" },
    proteinFamilyKey: "beef",
    displayCategoryKey: "premium",
    premiumKey: "system_premium_fixture",
    selectionType: "premium_meal",
    publishedAt: new Date(),
  });
  response = await api
    .patch("/api/dashboard/meal-builder/sections/chicken_card")
    .set(headers)
    .send({ selectedOptionIds: [String(premium._id)] });
  expectStatus(response, 422, "Premium remains system-managed");
  assert.equal(response.body.error.code, "MEAL_BUILDER_PREMIUM_OPTION_SYSTEM_MANAGED");
  assert.equal(await ProductGroupOption.countDocuments({ optionId: premium._id }), 0);

  for (const [field, value, expectedReason] of [
    ["isActive", false, "OPTION_INACTIVE"],
    ["isVisible", false, "OPTION_HIDDEN"],
    ["isAvailable", false, "OPTION_UNAVAILABLE"],
    ["publishedAt", null, "OPTION_UNPUBLISHED"],
  ]) {
    const unavailable = await MenuOption.create({
      groupId: fixture.proteins._id,
      key: `unavailable_${field.toLowerCase()}`,
      name: { ar: field, en: field },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      publishedAt: new Date(),
      [field]: value,
    });
    await ProductGroupOption.create({
      productId: fixture.product._id,
      groupId: fixture.proteins._id,
      optionId: unavailable._id,
    });
    await expectLowLevelUnavailable(
      () => mealBuilderService.updateProductSection({
        sectionKey: "chicken_card",
        patch: { selectedOptionIds: [String(unavailable._id)] },
        actor: { role: "admin" },
      }),
      expectedReason,
      `${field}=false/null rejected`
    );
  }

  for (const option of [chicken[0], beef, fish]) {
    const persisted = await MenuOption.findById(option.id).lean();
    const publicOption = serializePublicOption({ sortOrder: 0 }, persisted, "en");
    assert.equal(publicOption.proteinFamilyKey, option.proteinFamilyKey);
    assert.equal(publicOption.displayCategoryKey, option.proteinFamilyKey);
  }
  assert.deepEqual(await protectedCounts(), protectedBefore, "no order/payment/subscription/day writes");
  assert.equal(await MealBuilderConfig.countDocuments({ status: "published" }), 0, "no auto-publish");
}

async function testRepairIsIdempotentAndNarrow() {
  await mongoose.connection.dropDatabase();
  await MenuProduct.create({
    _id: BASIC_MEAL_ID,
    categoryId: new mongoose.Types.ObjectId(),
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    priceHalala: 1900,
  });
  await MenuOptionGroup.create({
    _id: PROTEINS_GROUP_ID,
    key: "proteins",
    name: { ar: "البروتين", en: "Proteins" },
  });
  for (const target of TARGETS) {
    await MenuOption.create({
      _id: target.id,
      groupId: PROTEINS_GROUP_ID,
      key: target.key,
      name: { ar: target.key, en: target.key },
    });
    await ProductGroupOption.create({
      productId: BASIC_MEAL_ID,
      groupId: PROTEINS_GROUP_ID,
      optionId: target.id,
    });
  }
  const dryRun = await repairBasicMealProteinFamilyMetadata();
  assert.equal(dryRun.mode, "DRY_RUN");
  assert.deepEqual(dryRun.plan.map((row) => row.action), ["UPDATE", "UPDATE", "UPDATE", "UPDATE"]);
  assert.equal(await MenuOption.countDocuments({ proteinFamilyKey: "chicken" }), 0);

  const executed = await repairBasicMealProteinFamilyMetadata({ execute: true });
  assert.equal(executed.blocked, false);
  assert.equal(executed.readBack.length, 4);
  assert(executed.readBack.every((row) => row.resolvedFamily === "chicken"));
  assert.equal(await ProductGroupOption.countDocuments({}), 4, "repair preserves relations");

  const repeated = await repairBasicMealProteinFamilyMetadata({ execute: true });
  assert.deepEqual(repeated.plan.map((row) => row.action), ["NO-OP", "NO-OP", "NO-OP", "NO-OP"]);
  assert.equal(await MenuOption.countDocuments({}), 4, "repair never duplicates options");
  assert.equal(await ProductGroupOption.countDocuments({}), 4, "repair never duplicates relations");
  assert(TARGETS.every((target) => {
    const classification = executed.readBack.find((row) => row.optionId === target.id);
    return classification && resolveProteinFamilyClassification(classification).familyKey === "chicken";
  }));
}

async function run() {
  await connect();
  try {
    await testAuthoringAndAssignmentMatrix();
    await testRepairIsIdempotentAndNarrow();
    console.log("mealBuilderProteinFamilyClosure.test.js passed");
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
