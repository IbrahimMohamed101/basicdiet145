process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const {
  normalizeAddonAuthoringListOptions,
} = require("../src/services/installDashboardAddonCatalogAuthoring");
const menuCatalogService = require("../src/services/orders/menuCatalogService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`addon_full_catalog_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function seed() {
  const now = new Date();
  const [ready, hidden, inactive] = await MenuCategory.insertMany([
    {
      key: "ready_category",
      name: { ar: "جاهز", en: "Ready" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
    {
      key: "hidden_category",
      name: { ar: "مخفي", en: "Hidden" },
      isActive: true,
      isVisible: false,
      isAvailable: false,
      publishedAt: null,
    },
    {
      key: "inactive_category",
      name: { ar: "غير نشط", en: "Inactive" },
      isActive: false,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
  ]);

  await MenuProduct.insertMany([
    {
      categoryId: ready._id,
      key: "ready_product",
      name: { ar: "منتج جاهز", en: "Ready Product" },
      pricingModel: "fixed",
      priceHalala: 1000,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
    {
      categoryId: hidden._id,
      key: "hidden_draft_product",
      name: { ar: "منتج مخفي", en: "Hidden Draft Product" },
      pricingModel: "fixed",
      priceHalala: 1200,
      availableFor: ["one_time"],
      isActive: true,
      isVisible: false,
      isAvailable: false,
      publishedAt: null,
    },
    {
      categoryId: inactive._id,
      key: "inactive_product",
      name: { ar: "منتج غير نشط", en: "Inactive Product" },
      pricingModel: "fixed",
      priceHalala: 1400,
      availableFor: [],
      isActive: false,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    },
  ]);
}

async function run() {
  await connect();
  try {
    await seed();

    const legacyDashboardQuery = {
      view: "picker",
      context: "addon_plan",
      linkableFor: "addon_plan",
      isVisible: "true",
      isAvailable: "true",
    };

    const normalized = normalizeAddonAuthoringListOptions(legacyDashboardQuery);
    assert.strictEqual(normalized.includeInactive, true);
    assert.strictEqual("isActive" in normalized, false);
    assert.strictEqual("isVisible" in normalized, false);
    assert.strictEqual("isAvailable" in normalized, false);
    assert.strictEqual("published" in normalized, false);
    assert.strictEqual("availableFor" in normalized, false);

    const products = await menuCatalogService.listProducts(legacyDashboardQuery);
    assert.deepStrictEqual(
      products.map((item) => item.key).sort(),
      ["hidden_draft_product", "inactive_product", "ready_product"]
    );

    const categories = await menuCatalogService.listCategories(legacyDashboardQuery);
    assert.deepStrictEqual(
      categories.map((item) => item.key).sort(),
      ["hidden_category", "inactive_category", "ready_category"]
    );
    assert.strictEqual(
      categories.reduce((sum, item) => sum + Number(item.productsCount || 0), 0),
      3
    );

    const customerStylePicker = await menuCatalogService.listProducts({
      view: "picker",
      isVisible: "true",
      isAvailable: "true",
    });
    assert.deepStrictEqual(customerStylePicker.map((item) => item.key), ["ready_product"]);

    console.log("dashboard add-on full catalog authoring passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
