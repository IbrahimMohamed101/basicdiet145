process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`builder_premium_meals_admin_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function seedFixture() {
  const now = new Date();
  const categoryId = new mongoose.Types.ObjectId();
  const [proteinsGroup, builderCategory, basicMeal, premiumSalad] = await Promise.all([
    MenuOptionGroup.create({
      key: "proteins",
      name: { en: "Proteins", ar: "بروتين" },
      publishedAt: now,
    }),
    BuilderCategory.create({
      key: "premium",
      dimension: "protein",
      name: { en: "Premium", ar: "Premium" },
    }),
    MenuProduct.create({
      categoryId,
      key: "basic_meal",
      name: { en: "Basic Meal", ar: "وجبة" },
      description: { en: "Build a meal", ar: "" },
      priceHalala: 0,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId,
      key: "premium_large_salad",
      name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
      description: { en: "Premium Large Salad with protein", ar: "" },
      imageUrl: "https://cdn.example.com/salad.jpg",
      priceHalala: 3500,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);

  const [beef, hiddenOption] = await Promise.all([
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "beef_steak",
      premiumKey: "beef_steak",
      name: { en: "Beef Steak", ar: "ستيك" },
      description: { en: "Steak protein", ar: "" },
      imageUrl: "https://cdn.example.com/beef.jpg",
      extraPriceHalala: 9999,
      extraFeeHalala: 9999,
      availableFor: ["subscription"],
      publishedAt: now,
      nutrition: { calories: 260, proteinGrams: 34, carbGrams: 0, fatGrams: 12 },
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "hidden_config_source",
      premiumKey: "hidden_config_source",
      name: { en: "Hidden Source", ar: "" },
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);

  await Promise.all([
    ProductOptionGroup.create({ productId: basicMeal._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true }),
    ProductGroupOption.create({ productId: basicMeal._id, groupId: proteinsGroup._id, optionId: beef._id, extraPriceHalala: 9999 }),
    ProductGroupOption.create({ productId: basicMeal._id, groupId: proteinsGroup._id, optionId: hiddenOption._id }),
  ]);

  const [beefConfig, saladConfig] = await Promise.all([
    PremiumUpgradeConfig.create({
      sourceType: "menu_option",
      sourceId: beef._id,
      sourceProductId: basicMeal._id,
      sourceGroupId: proteinsGroup._id,
      selectionType: "premium_meal",
      premiumKey: "beef_steak",
      upgradeDeltaHalala: 2900,
      currency: "SAR",
      sortOrder: 1,
      sourceSnapshot: {
        key: "beef_steak",
        name: beef.name,
        context: { productKey: "basic_meal", groupKey: "proteins" },
      },
    }),
    PremiumUpgradeConfig.create({
      sourceType: "menu_product",
      sourceId: premiumSalad._id,
      sourceProductId: premiumSalad._id,
      selectionType: "premium_large_salad",
      premiumKey: "premium_large_salad",
      upgradeDeltaHalala: 2900,
      currency: "SAR",
      sortOrder: 2,
      sourceSnapshot: {
        key: "premium_large_salad",
        name: premiumSalad.name,
        context: { productKey: "premium_large_salad" },
      },
    }),
  ]);

  await Promise.all([
    PremiumUpgradeConfig.create({
      sourceType: "menu_option",
      sourceId: hiddenOption._id,
      sourceProductId: basicMeal._id,
      sourceGroupId: proteinsGroup._id,
      selectionType: "premium_meal",
      premiumKey: "hidden_config_source",
      upgradeDeltaHalala: 1100,
      isVisible: false,
    }),
    PremiumUpgradeConfig.create({
      sourceType: "menu_product",
      sourceId: new mongoose.Types.ObjectId(),
      selectionType: "premium_large_salad",
      premiumKey: "broken_product_source",
      upgradeDeltaHalala: 1200,
    }),
    PremiumUpgradeConfig.create({
      sourceType: "menu_product",
      sourceId: new mongoose.Types.ObjectId(),
      selectionType: "premium_large_salad",
      premiumKey: "archived_product_source",
      upgradeDeltaHalala: 1300,
      status: "archived",
      isEnabled: false,
      isVisible: false,
    }),
    BuilderProtein.create({
      key: "beef_steak",
      premiumKey: "beef_steak",
      name: { en: "Legacy Beef", ar: "" },
      description: { en: "Legacy stale row", ar: "" },
      displayCategoryId: builderCategory._id,
      displayCategoryKey: "premium",
      proteinFamilyKey: "beef",
      selectionType: "premium_meal",
      isPremium: true,
      extraFeeHalala: 9999,
      availableForSubscription: true,
      isActive: true,
    }),
    BuilderProtein.create({
      key: "legacy_turkey",
      premiumKey: "legacy_turkey",
      name: { en: "Legacy Turkey", ar: "" },
      description: { en: "Legacy fallback", ar: "" },
      displayCategoryId: builderCategory._id,
      displayCategoryKey: "premium",
      proteinFamilyKey: "other",
      selectionType: "premium_meal",
      isPremium: true,
      extraFeeHalala: 1500,
      availableForSubscription: true,
      isActive: true,
    }),
  ]);

  return { beef, beefConfig, premiumSalad, saladConfig };
}

async function main() {
  await connect();
  try {
    const fixture = await seedFixture();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "builder-premium-meals");

    const listRes = await api.get("/api/admin/builder-premium-meals").set(headers);
    expectStatus(listRes, 200, "admin builder premium meals list");
    const rows = listRes.body.data || [];
    const byKey = new Map(rows.map((row) => [row.premiumKey, row]));

    assert(byKey.has("beef_steak"), "active ready option config appears");
    assert(byKey.has("premium_large_salad"), "active ready product config appears");
    assert.strictEqual(rows.filter((row) => row.premiumKey === "premium_large_salad").length, 1, "premium_large_salad appears once");
    assert.strictEqual(byKey.get("premium_large_salad").kind, "product", "product row kind");
    assert.strictEqual(byKey.get("premium_large_salad").sourceType, "menu_product", "product source type");
    assert.strictEqual(byKey.get("premium_large_salad").selectionType, "premium_large_salad", "product selection type");
    assert.strictEqual(byKey.get("beef_steak").kind, "option", "option row kind");
    assert.strictEqual(byKey.get("beef_steak").sourceType, "menu_option", "option source type");
    assert.strictEqual(byKey.get("beef_steak").selectionType, "premium_meal", "option selection type");
    assert.strictEqual(byKey.get("beef_steak").extraFeeHalala, 2900, "config price overrides stale legacy price");
    assert.strictEqual(rows.filter((row) => row.premiumKey === "beef_steak").length, 1, "same premiumKey is not duplicated");
    assert(!byKey.has("broken_product_source"), "broken source is excluded");
    assert(!byKey.has("hidden_config_source"), "hidden config is excluded");
    assert(!byKey.has("archived_product_source"), "archived config is excluded");
    assert(!byKey.has("custom_premium_salad"), "fake custom premium salad duplicate is absent");
    assert.deepStrictEqual(byKey.get("premium_large_salad").legacyAliases, ["custom_premium_salad"], "legacy salad alias lives on product row");

    for (const field of [
      "_id", "id", "key", "name", "description", "imageUrl", "premiumKey", "selectionType",
      "extraFeeHalala", "currency", "isPremium", "isActive", "sortOrder", "nutrition",
    ]) {
      assert(Object.prototype.hasOwnProperty.call(byKey.get("beef_steak"), field), `create-subscription field ${field} remains present`);
    }
    assert.strictEqual(byKey.get("beef_steak").id, String(fixture.beefConfig._id), "config-backed id is config id");
    assert.strictEqual(byKey.get("beef_steak").sourceId, String(fixture.beef._id), "sourceId is separate");

    let detailRes = await api.get(`/api/admin/builder-premium-meals/${fixture.saladConfig._id}`).set(headers);
    expectStatus(detailRes, 200, "product-backed detail by config id");
    assert.strictEqual(detailRes.body.data.premiumKey, "premium_large_salad");
    assert.strictEqual(detailRes.body.data.kind, "product");

    detailRes = await api.get(`/api/admin/builder-premium-meals/${fixture.beefConfig._id}`).set(headers);
    expectStatus(detailRes, 200, "option-backed detail by config id");
    assert.strictEqual(detailRes.body.data.premiumKey, "beef_steak");
    assert.strictEqual(detailRes.body.data.kind, "option");

    detailRes = await api.get(`/api/admin/builder-premium-meals/${fixture.premiumSalad._id}`).set(headers);
    expectStatus(detailRes, 200, "product-backed detail by source id");
    assert.strictEqual(detailRes.body.data.configId, String(fixture.saladConfig._id));

    const legacyRow = rows.find((row) => row.premiumKey === "legacy_turkey");
    assert(legacyRow, "legacy fallback remains temporarily available");
    assert.strictEqual(legacyRow.sourceType, "builder_protein");
    assert.strictEqual(legacyRow.legacy, true);
    detailRes = await api.get(`/api/admin/builder-premium-meals/${legacyRow.id}`).set(headers);
    expectStatus(detailRes, 200, "legacy detail fallback");
    assert.strictEqual(detailRes.body.data.managementSource, "legacy_builder_protein");

    const deleteConfigRes = await api.delete(`/api/admin/builder-premium-meals/${fixture.saladConfig._id}`).set(headers);
    expectStatus(deleteConfigRes, 409, "config-backed delete is rejected by legacy endpoint");
    assert.strictEqual(deleteConfigRes.body.code || deleteConfigRes.body.error?.code, "UNSUPPORTED_CONFIG_BACKED_ROW");

    console.log("builder premium meals admin endpoint checks passed");
  } finally {
    await disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
