process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const {
  hasFlutterPrimaryMealPickerContent,
  summarizeFlutterPrimaryMealPickerContent,
} = require("../src/services/catalog/plannerCatalogContentValidator");
const {
  APPLY_ENV,
  parseArgs,
  repairMealPlannerPrimaryContent,
  resolveApplyMode,
} = require("../scripts/repair-production-meal-planner-primary-content");

const PRODUCT_ID = "6a522efeb3fb649917aee56f";
const GROUP_ID = "6a522e5cb3fb649917aee272";
const OPTION_ID = "6a522e5cb3fb649917aee273";

function primaryCatalog() {
  return {
    contractVersion: "meal_planner_menu.v3",
    sections: [{
      key: "standard_meal",
      products: [{
        selectionType: "standard_meal",
        optionGroups: [{ key: "proteins", options: [{ id: OPTION_ID }] }],
      }],
    }],
  };
}

function leanQuery(rows) {
  return { lean: async () => rows };
}

function eligibleProduct(overrides = {}) {
  return {
    _id: PRODUCT_ID,
    key: "basic_meal",
    itemType: "product",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
    ...overrides,
  };
}

function fakeModels({
  products = [eligibleProduct()],
  proteinGroups = [{ _id: GROUP_ID }],
  productGroupRelations = [{ _id: "relation" }],
  optionRelations = [{ optionId: OPTION_ID }],
  optionCount = 1,
  updateResult = { matchedCount: 1, modifiedCount: 1 },
} = {}) {
  const updates = [];
  return {
    updates,
    models: {
      MenuProduct: {
        find: () => leanQuery(products),
        async updateOne(filter, update) {
          updates.push({ filter, update });
          return updateResult;
        },
      },
      MenuOptionGroup: { find: () => leanQuery(proteinGroups) },
      ProductOptionGroup: { find: () => leanQuery(productGroupRelations) },
      ProductGroupOption: { find: () => leanQuery(optionRelations) },
      MenuOption: { countDocuments: async () => optionCount },
    },
  };
}

async function loadPrimaryCatalog() {
  return primaryCatalog();
}

async function testArgumentsAndSafety() {
  assert.deepStrictEqual(parseArgs([]), { applyRequested: false });
  assert.deepStrictEqual(parseArgs(["--apply"]), { applyRequested: true });
  assert.throws(() => parseArgs(["--unexpected"]), /Unknown argument/);
  assert.strictEqual(resolveApplyMode(false, {}), false);
  assert.throws(() => resolveApplyMode(true, {}), new RegExp(`${APPLY_ENV}=true`));
  assert.strictEqual(resolveApplyMode(true, { [APPLY_ENV]: "true" }), true);
}

async function testDryRunAndApply() {
  const dryRunStore = fakeModels();
  const dryRun = await repairMealPlannerPrimaryContent({ models: dryRunStore.models });
  assert.strictEqual(dryRun.status, "would_update");
  assert.strictEqual(dryRun.selectableProteinOptionCount, 1);
  assert.deepStrictEqual(dryRunStore.updates, []);

  const applyStore = fakeModels();
  const applied = await repairMealPlannerPrimaryContent({
    apply: true,
    models: applyStore.models,
    loadPlannerCatalog: loadPrimaryCatalog,
  });
  assert.strictEqual(applied.status, "updated");
  assert.strictEqual(applied.primaryContent.standardProteinOptionCount, 1);
  assert.strictEqual(applyStore.updates.length, 1);
  assert.deepStrictEqual(applyStore.updates[0].update, { $set: { itemType: "basic_meal" } });
  assert.strictEqual(applyStore.updates[0].filter.itemType, "product");
}

async function testIdempotencyAndFailures() {
  const currentStore = fakeModels({ products: [eligibleProduct({ itemType: "basic_meal" })] });
  const current = await repairMealPlannerPrimaryContent({
    apply: true,
    models: currentStore.models,
    loadPlannerCatalog: loadPrimaryCatalog,
  });
  assert.strictEqual(current.status, "already_current");
  assert.deepStrictEqual(currentStore.updates, []);

  await assert.rejects(
    () => repairMealPlannerPrimaryContent({ models: fakeModels({ products: [] }).models }),
    /found 0/
  );
  await assert.rejects(
    () => repairMealPlannerPrimaryContent({ models: fakeModels({ products: [eligibleProduct(), eligibleProduct()] }).models }),
    /found 2/
  );
  await assert.rejects(
    () => repairMealPlannerPrimaryContent({ models: fakeModels({ products: [eligibleProduct({ itemType: "basic_salad" })] }).models }),
    /unexpected basic_meal itemType/
  );
  await assert.rejects(
    () => repairMealPlannerPrimaryContent({ models: fakeModels({ optionCount: 0 }).models }),
    /no selectable subscription protein options/
  );
  await assert.rejects(
    () => repairMealPlannerPrimaryContent({
      apply: true,
      models: fakeModels({ updateResult: { matchedCount: 0, modifiedCount: 0 } }).models,
      loadPlannerCatalog: loadPrimaryCatalog,
    }),
    /changed or disappeared/
  );
}

async function connectTestDatabase() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "meal_planner_primary_repair_test" },
  });
  const mongoUri = mongoServer.getUri("meal_planner_primary_repair_test");
  process.env.MONGO_URI = mongoUri;
  process.env.MONGODB_URI = mongoUri;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  return mongoServer;
}

async function seedWrongPrimaryProduct() {
  const category = await MenuCategory.create({
    key: "primary_repair_meals",
    name: { en: "Meals", ar: "وجبات" },
    publishedAt: new Date(),
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal",
    name: { en: "Basic Meal", ar: "وجبة بيسك" },
    itemType: "product",
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["one_time", "subscription"],
    publishedAt: new Date(),
  });
  const group = await MenuOptionGroup.create({
    key: "proteins",
    name: { en: "Proteins", ar: "البروتين" },
    publishedAt: new Date(),
  });
  const option = await MenuOption.create({
    groupId: group._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "دجاج مشوي" },
    availableFor: ["subscription"],
    publishedAt: new Date(),
  });
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: group._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  await ProductGroupOption.create({ productId: product._id, groupId: group._id, optionId: option._id });
}

async function testMobileContractRepair() {
  const mongoServer = await connectTestDatabase();
  try {
    await seedWrongPrimaryProduct();
    const api = request(createApp());
    const beforeRepair = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    assert.strictEqual(beforeRepair.status, 503, JSON.stringify(beforeRepair.body));

    const applied = await repairMealPlannerPrimaryContent({ apply: true });
    assert.strictEqual(applied.status, "updated");
    assert(applied.primaryContent.standardProteinOptionCount > 0);

    for (const language of ["en", "ar"]) {
      const response = await api.get(`/api/subscriptions/meal-planner-menu?lang=${language}`);
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      assert(hasFlutterPrimaryMealPickerContent(response.body.data.builderCatalog));
      assert(summarizeFlutterPrimaryMealPickerContent(response.body.data.builderCatalog).standardProteinOptionCount > 0);
    }
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

async function run() {
  await testArgumentsAndSafety();
  await testDryRunAndApply();
  await testIdempotencyAndFailures();
  await testMobileContractRepair();
  console.log("mealPlannerPrimaryContentRepair.test.js passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
