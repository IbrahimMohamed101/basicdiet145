process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

async function connect() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "dashboard_subscription_menu_readiness" },
  });
  const uri = mongoServer.getUri("dashboard_subscription_menu_readiness");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoServer;
}

async function createCatalogItem(key, itemKind = "product", isAvailable = true) {
  return CatalogItem.create({
    key,
    itemKind,
    nameI18n: { en: key, ar: key },
    isActive: true,
    isAvailable,
  });
}

async function seedReadyCatalog() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { en: "Custom Order", ar: "Custom Order" },
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { en: "Protein", ar: "Protein" },
    publishedAt: now,
  });
  const carbsGroup = await MenuOptionGroup.create({
    key: "carbs",
    name: { en: "Carbs", ar: "Carbs" },
    publishedAt: now,
  });
  const basicCatalogItem = await createCatalogItem("basic_meal_item");
  const saladCatalogItem = await createCatalogItem("premium_large_salad_item");
  const basicMeal = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: basicCatalogItem._id,
    key: "basic_meal",
    itemType: "basic_meal",
    name: { en: "Basic Meal", ar: "Basic Meal" },
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const salad = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: saladCatalogItem._id,
    key: "premium_large_salad",
    itemType: "premium_large_salad",
    name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
    pricingModel: "fixed",
    priceHalala: 2900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const chickenItem = await createCatalogItem("grilled_chicken_item", "protein");
  const riceItem = await createCatalogItem("white_rice_item", "carb");
  const chicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    catalogItemId: chickenItem._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const rice = await MenuOption.create({
    groupId: carbsGroup._id,
    catalogItemId: riceItem._id,
    key: "white_rice",
    name: { en: "White Rice", ar: "White Rice" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  for (const product of [basicMeal, salad]) {
    await ProductOptionGroup.create({
      productId: product._id,
      groupId: proteinsGroup._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
    });
    await ProductGroupOption.create({
      productId: product._id,
      groupId: proteinsGroup._id,
      optionId: chicken._id,
    });
  }
  await ProductOptionGroup.create({
    productId: basicMeal._id,
    groupId: carbsGroup._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
  });
  await ProductGroupOption.create({
    productId: basicMeal._id,
    groupId: carbsGroup._id,
    optionId: rice._id,
  });
  return { basicMeal, salad, proteinsGroup, carbsGroup, chicken, rice, chickenItem };
}

async function health(api, headers) {
  const res = await api.get("/api/dashboard/health/meal-planner").set(headers);
  assert.strictEqual(res.status, 200, `health status: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

function hasCode(rows, code) {
  return rows.some((row) => row.code === code);
}

async function resetCatalogCollections() {
  await Promise.all([
    CatalogItem.deleteMany({}),
    MenuCategory.deleteMany({}),
    MenuOption.deleteMany({}),
    MenuOptionGroup.deleteMany({}),
    MenuProduct.deleteMany({}),
    ProductGroupOption.deleteMany({}),
    ProductOptionGroup.deleteMany({}),
  ]);
}

async function run() {
  const mongoServer = await connect();
  try {
    const fixture = await seedReadyCatalog();
    const { headers } = await dashboardAuth("admin", "dashboard-readiness");
    const api = request(createApp());

    let data = await health(api, headers);
    assert.strictEqual(data.ready, true, JSON.stringify(data, null, 2));
    assert.strictEqual(data.status, "warning", "optional missing daily add-on choices are warnings");

    await MenuProduct.deleteOne({ _id: fixture.basicMeal._id });
    data = await health(api, headers);
    assert.strictEqual(data.ready, false);
    assert(hasCode(data.errors, "PLANNER_PRODUCT_NOT_FOUND"), "missing required product is an error");

    await resetCatalogCollections();
    const disallowedFixture = await seedReadyCatalog();
    const beef = await MenuOption.create({
      groupId: disallowedFixture.proteinsGroup._id,
      key: "beef",
      name: { en: "Beef", ar: "Beef" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create({
      productId: disallowedFixture.salad._id,
      groupId: disallowedFixture.proteinsGroup._id,
      optionId: beef._id,
    });
    data = await health(api, headers);
    assert.strictEqual(data.ready, false);
    assert(hasCode(data.errors, "PREMIUM_LARGE_SALAD_PROTEIN_NOT_ALLOWED"), "disallowed salad protein is an error");

    await resetCatalogCollections();
    const extraFixture = await seedReadyCatalog();
    const extraGroup = await MenuOptionGroup.create({
      key: "extra_protein_50g",
      name: { en: "Extra Protein", ar: "Extra Protein" },
      publishedAt: new Date(),
    });
    const extraOption = await MenuOption.create({
      groupId: extraGroup._id,
      key: "extra_chicken_50g",
      name: { en: "Extra Chicken", ar: "Extra Chicken" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });
    await ProductOptionGroup.create({ productId: extraFixture.salad._id, groupId: extraGroup._id });
    await ProductGroupOption.create({
      productId: extraFixture.salad._id,
      groupId: extraGroup._id,
      optionId: extraOption._id,
    });
    data = await health(api, headers);
    assert.strictEqual(data.ready, false);
    assert(hasCode(data.errors, "PREMIUM_LARGE_SALAD_EXTRA_PROTEIN_EXPOSED"), "extra protein group is an error");

    await resetCatalogCollections();
    const catalogFixture = await seedReadyCatalog();
    await CatalogItem.updateOne({ _id: catalogFixture.chickenItem._id }, { $set: { isAvailable: false } });
    data = await health(api, headers);
    assert.strictEqual(data.ready, false);
    assert(hasCode(data.errors, "PLANNER_OPTION_CATALOG_ITEM_UNAVAILABLE"), "unavailable linked CatalogItem is an error");

    const anon = await api.get("/api/dashboard/health/meal-planner");
    assert.strictEqual(anon.status, 401, `dashboard health requires auth: ${JSON.stringify(anon.body)}`);

    console.log("dashboard subscription menu readiness checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
