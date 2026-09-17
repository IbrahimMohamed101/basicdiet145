process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const {
  createIndependentConfig,
  listIndependentSources,
} = require("../src/services/installIndependentPremiumAuthoring");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`independent_premium_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "premium_dynamic",
      name: { ar: "مميز", en: "Premium" },
      publishedAt: now,
    });
    const [readyProduct, oneTimeOnlyProduct] = await MenuProduct.insertMany([
      {
        categoryId: category._id,
        key: "dynamic_steak",
        name: { ar: "ستيك ديناميكي", en: "Dynamic Steak" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 3900,
        availableFor: ["subscription"],
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "one_time_cake",
        name: { ar: "كيك", en: "Cake" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 900,
        availableFor: ["one_time"],
        publishedAt: now,
      },
    ]);
    const group = await MenuOptionGroup.create({
      key: "dynamic_proteins",
      name: { ar: "بروتينات", en: "Proteins" },
      publishedAt: now,
    });
    const option = await MenuOption.create({
      groupId: group._id,
      key: "dynamic_salmon",
      name: { ar: "سالمون", en: "Salmon" },
      availableFor: ["subscription"],
      publishedAt: now,
    });
    await ProductOptionGroup.create({
      productId: readyProduct._id,
      groupId: group._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
    });
    await ProductGroupOption.create({
      productId: readyProduct._id,
      groupId: group._id,
      optionId: option._id,
    });

    const allProducts = await listIndependentSources({
      kind: "product",
      status: "all",
      limit: 100,
    });
    assert.strictEqual(allProducts.meta.total, 2);
    assert.strictEqual(
      allProducts.data.find((row) => row.key === "dynamic_steak").selectable,
      true
    );
    assert.strictEqual(
      allProducts.data.find((row) => row.key === "one_time_cake").selectable,
      false
    );

    const activeProducts = await listIndependentSources({
      kind: "product",
      status: "active",
      limit: 100,
    });
    assert.deepStrictEqual(activeProducts.data.map((row) => row.key), ["dynamic_steak"]);

    const optionSources = await listIndependentSources({
      kind: "option",
      status: "all",
      limit: 100,
    });
    assert.strictEqual(optionSources.meta.total, 1);
    assert.strictEqual(optionSources.data[0].selectable, true);
    assert.ok(optionSources.data[0].relationId);

    const created = await createIndependentConfig({
      kind: "product",
      sourceId: String(readyProduct._id),
      upgradeDeltaHalala: 2000,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    });
    assert.strictEqual(created.source.type, "menu_product");
    assert.strictEqual(created.source.key, "dynamic_steak");

    const stored = await PremiumUpgradeConfig.findOne({
      premiumKey: "dynamic_steak",
    }).lean();
    assert.ok(stored);
    assert.strictEqual(stored.selectionType, "premium_meal");

    console.log("independent premium dashboard authoring passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
