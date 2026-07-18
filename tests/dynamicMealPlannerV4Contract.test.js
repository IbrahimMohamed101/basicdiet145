process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dynamic_meal_planner_flutter_contract_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(
    res.status,
    status,
    `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`
  );
}

function findSection(catalog, key) {
  return (catalog.sections || []).find((section) => section.key === key || section.selectionType === key);
}

function optionsFromSection(section) {
  const options = [];
  for (const product of section?.products || []) {
    for (const group of product.optionGroups || []) {
      options.push(...(group.options || []));
    }
  }
  return options;
}

async function seedMenu() {
  const now = new Date();
  const [mealsCategory, customCategory] = await Promise.all([
    MenuCategory.create({
      key: "meals",
      name: { ar: "الوجبات", en: "Meals" },
      publishedAt: now,
    }),
    MenuCategory.create({
      key: "custom_order",
      name: { ar: "تخصيص الوجبة", en: "Custom Meal" },
      publishedAt: now,
    }),
  ]);

  const [proteinsGroup, carbsGroup] = await Promise.all([
    MenuOptionGroup.create({
      key: "proteins",
      name: { ar: "البروتين", en: "Proteins" },
      publishedAt: now,
    }),
    MenuOptionGroup.create({
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      publishedAt: now,
    }),
  ]);

  const basicMeal = await MenuProduct.create({
    categoryId: customCategory._id,
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    itemType: "basic_meal",
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
    sortOrder: 1,
  });

  const [chickenOption, premiumOption, whiteRiceOption] = await Promise.all([
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "spicy_chicken",
      name: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 10,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "beef_steak",
      premiumKey: "beef_steak",
      name: { ar: "ستيك لحم", en: "Beef Steak" },
      proteinFamilyKey: "beef",
      displayCategoryKey: "premium",
      extraPriceHalala: 700,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 20,
    }),
    MenuOption.create({
      groupId: carbsGroup._id,
      key: "white_rice",
      name: { ar: "رز أبيض", en: "White Rice" },
      displayCategoryKey: "carbs",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 10,
    }),
  ]);

  await ProductOptionGroup.insertMany([
    {
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 1,
    },
    {
      productId: basicMeal._id,
      groupId: carbsGroup._id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      sortOrder: 2,
    },
  ]);
  await ProductGroupOption.insertMany([
    {
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: chickenOption._id,
      sortOrder: 10,
    },
    {
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: premiumOption._id,
      extraPriceHalala: 700,
      sortOrder: 20,
    },
    {
      productId: basicMeal._id,
      groupId: carbsGroup._id,
      optionId: whiteRiceOption._id,
      sortOrder: 10,
    },
  ]);

  await PremiumUpgradeConfig.create({
    sourceType: "menu_option",
    sourceId: premiumOption._id,
    sourceProductId: basicMeal._id,
    sourceGroupId: proteinsGroup._id,
    selectionType: "premium_meal",
    premiumKey: "beef_steak",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 700,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 1,
    sourceSnapshot: {
      key: premiumOption.key,
      name: premiumOption.name,
      context: {
        productKey: basicMeal.key,
        groupKey: proteinsGroup.key,
      },
    },
  });

  const products = await MenuProduct.insertMany(
    Array.from({ length: 125 }, (_, index) => ({
      categoryId: mealsCategory._id,
      key: `meal_${String(index + 1).padStart(3, "0")}`,
      name: { ar: `وجبة ${index + 1}`, en: `Meal ${index + 1}` },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 1000 + index,
      availableFor: ["one_time", "subscription"],
      publishedAt: now,
      sortOrder: index + 1,
    }))
  );

  return {
    products,
    basicMeal,
    proteinsGroup,
    carbsGroup,
    chickenOption,
    premiumOption,
    whiteRiceOption,
  };
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const auth = await dashboardAuth("admin", "meal-planner-flutter-contract");
    const seeded = await seedMenu();

    const picker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/new_dynamic_section?limit=500")
      .set(auth.headers);
    expectStatus(picker, 200, "product picker");
    assert.strictEqual(picker.body.data.candidateType, "product");
    assert.strictEqual(picker.body.data.meta.total, 126);
    assert.strictEqual(picker.body.data.candidates.length, 126);

    const createDraft = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({
        sections: [
          {
            key: "premium",
            sectionType: "option_group",
            sourceKind: "premium_visual",
            titleOverride: { ar: "الوجبات المميزة", en: "Premium Meals" },
            productContextId: String(seeded.basicMeal._id),
            sourceGroupId: String(seeded.proteinsGroup._id),
            selectedOptionIds: [String(seeded.premiumOption._id)],
            includeMode: "selected",
            selectionType: "premium_meal",
            sortOrder: 10,
            metadata: { premiumDynamic: true },
          },
          {
            key: "chicken",
            sectionType: "option_group",
            sourceKind: "visual_family",
            titleOverride: { ar: "دجاج", en: "Chicken" },
            productContextId: String(seeded.basicMeal._id),
            sourceGroupId: String(seeded.proteinsGroup._id),
            selectedOptionIds: [String(seeded.chickenOption._id)],
            includeMode: "selected",
            selectionType: "standard_meal",
            sortOrder: 30,
          },
          {
            key: "carbs",
            sectionType: "option_group",
            sourceKind: "configurable_product",
            titleOverride: { ar: "نشويات", en: "Carbs" },
            productContextId: String(seeded.basicMeal._id),
            sourceGroupId: String(seeded.carbsGroup._id),
            selectedOptionIds: [String(seeded.whiteRiceOption._id)],
            includeMode: "selected",
            selectionType: "carbs",
            sortOrder: 70,
          },
        ],
      });
    expectStatus(createDraft, 201, "create draft");
    const firstHash = createDraft.body.data.draftHash;
    assert.ok(firstHash);

    const createSection = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "chef_choices",
        titleOverride: { ar: "اختيارات الشيف", en: "Chef Choices" },
        sectionType: "product_list",
        sourceKind: "product_list",
        selectionType: "full_meal_product",
        sortOrder: 20,
        expectedDraftHash: firstHash,
      });
    expectStatus(createSection, 201, "create dynamic section");
    const secondHash = createSection.body.data.draft.draftHash;
    assert.notStrictEqual(secondHash, firstHash);

    const addProducts = await request(app)
      .post("/api/dashboard/meal-builder/sections/chef_choices/products")
      .set(auth.headers)
      .send({
        productIds: [String(seeded.products[0]._id), String(seeded.products[124]._id)],
        expectedDraftHash: secondHash,
      });
    expectStatus(addProducts, 200, "add products");
    const thirdHash = addProducts.body.data.draft.draftHash;

    const staleRemove = await request(app)
      .delete(`/api/dashboard/meal-builder/sections/chef_choices/products/${seeded.products[0]._id}`)
      .set(auth.headers)
      .send({ expectedDraftHash: secondHash });
    expectStatus(staleRemove, 409, "stale hash protection");
    assert.strictEqual(staleRemove.body.error.code, "MEAL_PLANNER_DRAFT_CONFLICT");

    const removeProduct = await request(app)
      .delete(`/api/dashboard/meal-builder/sections/chef_choices/products/${seeded.products[0]._id}`)
      .set(auth.headers)
      .send({ expectedDraftHash: thirdHash });
    expectStatus(removeProduct, 200, "remove product");
    const fourthHash = removeProduct.body.data.draft.draftHash;

    const publish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ expectedDraftHash: fourthHash });
    expectStatus(publish, 200, "publish planner");

    const publicOne = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicOne, 200, "Flutter meal planner first read");
    assert.match(publicOne.headers["cache-control"], /no-store/);
    assert.ok(publicOne.body.data.builderCatalog);
    assert.strictEqual(
      publicOne.body.data.builderCatalog.contractVersion,
      "meal_planner_menu.v3"
    );
    assert.strictEqual(publicOne.body.data.plannerCatalog, undefined);
    assert.strictEqual(publicOne.body.data.builderCatalogV2, undefined);
    assert.ok(publicOne.body.data.addonCatalog);

    const catalog = publicOne.body.data.builderCatalog;
    assert.ok(catalog.catalogHash);
    const chefSection = findSection(catalog, "chef_choices");
    assert.ok(chefSection, "dynamic product section must be present in Flutter catalog");
    assert.strictEqual(chefSection.products.length, 1);
    assert.strictEqual(chefSection.products[0].id, String(seeded.products[124]._id));
    assert.strictEqual(chefSection.products[0].action.type, "direct_add");
    assert.strictEqual(chefSection.products[0].action.requiresBuilder, false);
    assert.strictEqual(chefSection.products[0].action.treatAsFullMeal, true);

    const premiumSection = findSection(catalog, "premium_meal") || findSection(catalog, "premium");
    assert.ok(premiumSection, "premium section must exist");
    assert.ok(
      optionsFromSection(premiumSection).some((option) => option.premiumKey === "beef_steak"),
      "premium section must be derived from active PremiumUpgradeConfig"
    );

    const standardOptions = optionsFromSection(findSection(catalog, "standard_meal"));
    assert.ok(
      standardOptions.some((option) => option.id === String(seeded.chickenOption._id)),
      "standard protein option must be available to Flutter"
    );

    const alias = await request(app).get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(alias, 200, "meal builder alias");
    assert.deepStrictEqual(alias.body.data.builderCatalog, catalog);
    assert.strictEqual(alias.body.data.plannerCatalog, undefined);

    const publicTwo = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicTwo, 200, "Flutter meal planner second read");
    assert.strictEqual(
      publicTwo.body.data.builderCatalog.catalogHash,
      catalog.catalogHash
    );

    await MenuProduct.updateOne(
      { _id: seeded.products[124]._id },
      { $set: { priceHalala: 9999 } }
    );
    const publicThree = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicThree, 200, "Flutter meal planner after catalog update");
    assert.notStrictEqual(
      publicThree.body.data.builderCatalog.catalogHash,
      catalog.catalogHash
    );
    const updatedChef = findSection(publicThree.body.data.builderCatalog, "chef_choices");
    assert.strictEqual(updatedChef.products[0].priceHalala, 9999);

    console.log("dynamicMealPlannerV4Contract.test.js Flutter compatibility passed");
  } finally {
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
