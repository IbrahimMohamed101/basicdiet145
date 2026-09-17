process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "workbook-production-import-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "workbook-production-import-dashboard-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const CatalogItem = require("../src/models/CatalogItem");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");
const {
  IMPORT_KEY,
  SOURCE_SNAPSHOT_KEY,
  buildCanonicalBuilderRows,
  runWorkbookProductionImport,
  verifyWorkbookProductionImport,
} = require("../scripts/bootstrap/workbook-production-import");

const quietLog = { log() {}, info() {}, warn() {}, error() {} };

let mongoServer;

async function seedLegacyAddonSubscription() {
  const category = await MenuCategory.create({
    key: "legacy_drinks",
    name: { ar: "قديم", en: "Legacy" },
    publishedAt: new Date(),
  });
  const catalog = await CatalogItem.create({
    key: "legacy_juice_item",
    nameI18n: { ar: "عصير قديم", en: "Legacy Juice" },
    itemKind: "drink",
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: catalog._id,
    key: "legacy_juice_item",
    name: { ar: "عصير قديم", en: "Legacy Juice" },
    itemType: "juice",
    pricingModel: "fixed",
    priceHalala: 1000,
    availableFor: ["subscription"],
    publishedAt: new Date(),
  });
  const plan = await Addon.create({
    name: { ar: "اشتراك عصير قديم", en: "Legacy Juice Subscription" },
    priceHalala: 1000,
    kind: "plan",
    type: "subscription",
    category: "juice",
    billingMode: "per_day",
    pricingModel: "subscription",
    billingUnit: "day",
    menuProductIds: [product._id],
  });
  const result = await Subscription.collection.insertOne({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 26,
    remainingMeals: 20,
    deliveryMode: "pickup",
    addonSubscriptions: [{
      addonId: plan._id,
      addonPlanId: plan._id,
      category: "juice",
      purchasedDailyQty: 1,
      includedTotalQty: 26,
      menuProductIds: [product._id],
      menuProductsSnapshot: [{ id: product._id, key: product.key, category: "juice" }],
    }],
    addonBalance: [{
      addonId: plan._id,
      addonPlanId: plan._id,
      category: "juice",
      purchasedQty: 26,
      consumedQty: 4,
      reservedQty: 2,
      remainingQty: 20,
    }],
    addonSelections: [],
    premiumBalance: [],
    premiumSelections: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { subscriptionId: result.insertedId, oldProductId: product._id, oldPlanId: plan._id };
}

async function run() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`workbook_production_import_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const legacy = await seedLegacyAddonSubscription();
    const first = await runWorkbookProductionImport({ log: quietLog, connect: false });
    assert.strictEqual(first.skipped, false);

    const verification = await verifyWorkbookProductionImport();
    assert.strictEqual(verification.sourceSha256, source.metadata.sha256);
    assert.strictEqual(verification.categories, 10);
    assert.strictEqual(verification.workbookProducts, 106);
    assert.strictEqual(verification.liveWorkbookProducts, 104);
    assert.strictEqual(verification.draftWorkbookProducts, 2);
    assert.strictEqual(verification.candidates, 10);
    assert.strictEqual(verification.builderOptions, buildCanonicalBuilderRows().length);
    assert.strictEqual(verification.builderOptions, 36);
    assert.strictEqual(verification.subscriptionPlans, 3);
    assert.strictEqual(verification.addonPlans, 3);
    assert.strictEqual(verification.addonItems, 31);
    assert.strictEqual(verification.addonMatrixPrices, 9);
    assert.strictEqual(verification.premiumConfigs, 3);

    const marker = await Setting.findOne({ key: IMPORT_KEY }).lean();
    assert.strictEqual(marker.value.status, "completed");
    assert.strictEqual(marker.value.sourceSha256, source.metadata.sha256);
    const snapshot = await Setting.findOne({ key: SOURCE_SNAPSHOT_KEY }).lean();
    assert.strictEqual(snapshot.value.products.length, 106);
    assert.strictEqual(snapshot.value.productCandidates.length, 10);
    assert.strictEqual(snapshot.value.builderGroups.reduce((total, group) => total + group.options.length, 0), 33);

    const liveCategories = await MenuCategory.find({ isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }).lean();
    assert.deepStrictEqual(new Set(liveCategories.map((row) => row.key)), new Set(source.categories.map((row) => row.key)));

    const technicalProduct = await MenuProduct.findOne({ key: "basic_meal" }).lean();
    assert(technicalProduct);
    assert.deepStrictEqual(technicalProduct.availableFor, ["subscription"]);
    assert.strictEqual(technicalProduct.isActive, true);

    const builderSetupProducts = await MenuProduct.find({
      key: { $in: source.products.filter((row) => row.status === "Needs Builder Setup").map((row) => row.key) },
    }).lean();
    assert.strictEqual(builderSetupProducts.length, 2);
    assert(builderSetupProducts.every((row) => !row.isActive && !row.isVisible && !row.isAvailable && !row.publishedAt));

    const candidates = await MenuProduct.find({ key: { $in: source.productCandidates.map((row) => row.key) } }).lean();
    assert.strictEqual(candidates.length, 10);
    assert(candidates.every((row) => !row.isActive && !row.publishedAt));

    const groups = await MenuOptionGroup.find({ isActive: true }).sort({ key: 1 }).lean();
    assert.deepStrictEqual(groups.map((row) => row.key), ["carbs", "proteins"]);
    assert.strictEqual(await MenuOption.countDocuments({ isActive: true }), 36);
    assert.strictEqual(await ProductOptionGroup.countDocuments({ isActive: true }), 2);
    assert.strictEqual(await ProductGroupOption.countDocuments({ isActive: true }), 36);
    assert.strictEqual(await PremiumUpgradeConfig.countDocuments({ status: "active", isEnabled: true, isVisible: true }), 3);

    const published = await MealBuilderConfig.findOne({ status: "published", isCurrent: true }).lean();
    assert(published);
    assert.deepStrictEqual(
      published.sections.map((section) => section.key),
      ["premium", "sandwich", "ready_meals", "chicken", "beef", "fish", "carbs"]
    );

    assert.strictEqual(await Addon.countDocuments({ kind: "plan", isActive: true, isArchived: false }), 3);
    assert.strictEqual(await Addon.countDocuments({ kind: "item", isActive: true, isArchived: false }), 31);
    assert.strictEqual(await AddonPlanPrice.countDocuments({ isActive: true }), 9);

    const migrated = await Subscription.findById(legacy.subscriptionId).lean();
    assert(migrated);
    assert.strictEqual(migrated.addonSubscriptions[0].menuProductIds.length, 10);
    assert.strictEqual(migrated.addonSubscriptions[0].menuProductsSnapshot.length, 10);
    assert(!migrated.addonSubscriptions[0].menuProductIds.some((id) => String(id) === String(legacy.oldProductId)));
    assert.strictEqual(migrated.addonBalance[0].purchasedQty, 26);
    assert.strictEqual(migrated.addonBalance[0].consumedQty, 4);
    assert.strictEqual(migrated.addonBalance[0].reservedQty, 2);
    assert.strictEqual(migrated.addonBalance[0].remainingQty, 20);
    assert.strictEqual(String(migrated.addonSubscriptions[0].addonPlanId), String(legacy.oldPlanId));

    const countsBefore = {
      products: await MenuProduct.countDocuments({}),
      options: await MenuOption.countDocuments({}),
      addons: await Addon.countDocuments({}),
      configs: await MealBuilderConfig.countDocuments({}),
    };
    const second = await runWorkbookProductionImport({ log: quietLog, connect: false });
    assert.strictEqual(second.skipped, true);
    const countsAfter = {
      products: await MenuProduct.countDocuments({}),
      options: await MenuOption.countDocuments({}),
      addons: await Addon.countDocuments({}),
      configs: await MealBuilderConfig.countDocuments({}),
    };
    assert.deepStrictEqual(countsAfter, countsBefore);

    console.log("workbookProductionImport.integration.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.connection.dropDatabase();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); } catch (_error) {}
  try { if (mongoServer) await mongoServer.stop(); } catch (_error) {}
  process.exit(1);
});
