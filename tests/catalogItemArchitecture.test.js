process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const menuCatalogService = require("../src/services/orders/menuCatalogService");
const { priceMenuCart } = require("../src/services/orders/menuPricingService");

let mongoServer;
const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri("catalog_item_architecture_test");
  process.env.MONGO_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) => category.products || []);
}

async function createPublishedCategory(key = "meals") {
  return MenuCategory.create({
    key,
    name: { en: key, ar: key },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
}

async function createPublishedProduct(category, key, catalogItemId, overrides = {}) {
  return MenuProduct.create({
    categoryId: category._id,
    catalogItemId: catalogItemId || null,
    key,
    name: { en: key, ar: key },
    pricingModel: "fixed",
    priceHalala: 1200,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    availableFor: ["one_time", "subscription"],
    publishedAt: new Date(),
    ...overrides,
  });
}

async function createBuilderOption(product, catalogItemId, key = "white_rice", groupKey = "carbs") {
  const group = await MenuOptionGroup.create({
    key: groupKey,
    name: { en: groupKey, ar: groupKey },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const option = await MenuOption.create({
    groupId: group._id,
    catalogItemId: catalogItemId || null,
    key,
    name: { en: key, ar: key },
    extraPriceHalala: 100,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    availableFor: ["one_time", "subscription"],
    publishedAt: new Date(),
  });
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: group._id,
    minSelections: 0,
    maxSelections: null,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });
  await ProductGroupOption.create({
    productId: product._id,
    groupId: group._id,
    optionId: option._id,
    extraPriceHalala: 50,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });
  return { group, option };
}

async function assertRejectsCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert(caught, `expected ${code} rejection`);
  assert.strictEqual(caught.code, code);
}

async function run() {
  await connect();
  try {
    await test("CatalogItem generates a unique immutable key", async () => {
      const item = await CatalogItem.create({
        nameI18n: { en: "White Rice", ar: "أرز أبيض" },
        itemKind: "carb",
      });
      assert.strictEqual(item.key, "white_rice");
      item.key = "other_key";
      await item.save();
      const reloaded = await CatalogItem.findById(item._id).lean();
      assert.strictEqual(reloaded.key, "white_rice");
    });

    await test("MenuProduct and MenuOption catalogItemId are optional", async () => {
      const category = await createPublishedCategory("optional_links");
      const product = await createPublishedProduct(category, "legacy_product", null);
      const { option } = await createBuilderOption(product, null, "legacy_option");
      assert.strictEqual(product.catalogItemId, null);
      assert.strictEqual(option.catalogItemId, null);
    });

    await test("Dashboard menu service rejects invalid and switched catalog links", async () => {
      const category = await createPublishedCategory("service_links");
      await assertRejectsCode(
        () => menuCatalogService.createProduct({
          categoryId: category._id,
          catalogItemId: new mongoose.Types.ObjectId(),
          name: { en: "Invalid Link", ar: "" },
          priceHalala: 100,
        }),
        "CATALOG_ITEM_NOT_FOUND"
      );
      const itemA = await CatalogItem.create({ nameI18n: { en: "Item A", ar: "" }, itemKind: "product" });
      const itemB = await CatalogItem.create({ nameI18n: { en: "Item B", ar: "" }, itemKind: "product" });
      const created = await menuCatalogService.createProduct({
        categoryId: category._id,
        catalogItemId: itemA._id,
        name: { en: "Linked Product", ar: "" },
        priceHalala: 100,
      });
      await assertRejectsCode(
        () => menuCatalogService.updateProduct(created.id, { catalogItemId: itemB._id }),
        "IMMUTABLE_CATALOG_ITEM_LINK"
      );
      await assertRejectsCode(
        () => menuCatalogService.updateProduct(created.id, { catalogItemId: null }),
        "IMMUTABLE_CATALOG_ITEM_LINK"
      );
    });

    await test("Global product disable hides linked products while legacy products remain visible", async () => {
      const category = await createPublishedCategory("global_product_disable");
      const availableItem = await CatalogItem.create({ nameI18n: { en: "Available Product", ar: "" }, itemKind: "product" });
      const disabledItem = await CatalogItem.create({ nameI18n: { en: "Disabled Product", ar: "" }, itemKind: "product", isAvailable: false });
      await createPublishedProduct(category, "available_product", availableItem._id);
      await createPublishedProduct(category, "disabled_product", disabledItem._id);
      await createPublishedProduct(category, "legacy_visible_product", null);
      const menu = await menuCatalogService.getPublishedMenu({ lang: "en" });
      const keys = flattenProducts(menu).map((product) => product.key);
      assert(keys.includes("available_product"));
      assert(keys.includes("legacy_visible_product"));
      assert(!keys.includes("disabled_product"));
    });

    await test("light_collection categories are preserved in the public menu", async () => {
      const category = await MenuCategory.create({
        key: "light_collection_category",
        name: { en: "Light Collection", ar: "اختيارات خفيفة" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        ui: { cardVariant: "light_collection" },
      });
      await createPublishedProduct(category, "light_collection_product", null, {
        priceHalala: 900,
      });
      const menu = await menuCatalogService.getPublishedMenu({ lang: "en" });
      const publicCategory = (menu.categories || []).find((row) => row.key === "light_collection_category");
      assert(publicCategory);
      assert.strictEqual(publicCategory.ui.cardVariant, "light_collection");
      assert(publicCategory.products.some((product) => product.key === "light_collection_product"));
    });

    await test("Global option disable hides linked builder options and quote rejects them", async () => {
      const category = await createPublishedCategory("global_option_disable");
      const product = await createPublishedProduct(category, "builder_product", null);
      const disabledItem = await CatalogItem.create({ nameI18n: { en: "Disabled Option", ar: "" }, itemKind: "carb", isAvailable: false });
      const { group, option } = await createBuilderOption(product, disabledItem._id, "disabled_option");
      const menu = await menuCatalogService.getPublishedMenu({ lang: "en" });
      const publicProduct = flattenProducts(menu).find((row) => row.key === "builder_product");
      assert(publicProduct);
      assert.strictEqual(publicProduct.optionGroups[0].options.length, 0);
      await assertRejectsCode(
        () => priceMenuCart({
          userId: new mongoose.Types.ObjectId(),
          fulfillmentMethod: "pickup",
          items: [{
            productId: product._id,
            selectedOptions: [{ groupId: group._id, optionId: option._id, qty: 1 }],
          }],
        }),
        "CATALOG_ITEM_UNAVAILABLE"
      );
    });

    await test("CatalogItem metadata changes do not affect quote pricing", async () => {
      const category = await createPublishedCategory("metadata_price_invariance");
      const productItem = await CatalogItem.create({
        nameI18n: { en: "Initial Product Name", ar: "" },
        imageUrl: "https://example.test/product-a.png",
        itemKind: "product",
        nutrition: { calories: 100, proteinGrams: 10, carbsGrams: 20, fatGrams: 3 },
      });
      const optionItem = await CatalogItem.create({
        nameI18n: { en: "Initial Option Name", ar: "" },
        imageUrl: "https://example.test/option-a.png",
        itemKind: "carb",
        nutrition: { calories: 20, proteinGrams: 1, carbsGrams: 4, fatGrams: 0 },
      });
      const product = await createPublishedProduct(category, "metadata_priced_product", productItem._id, {
        priceHalala: 1200,
      });
      const { group, option } = await createBuilderOption(product, optionItem._id, "metadata_priced_option");

      const quoteInput = {
        userId: new mongoose.Types.ObjectId(),
        fulfillmentMethod: "pickup",
        items: [{
          productId: product._id,
          selectedOptions: [{ groupId: group._id, optionId: option._id, qty: 1 }],
        }],
      };
      const before = await priceMenuCart(quoteInput);

      await CatalogItem.updateOne(
        { _id: productItem._id },
        {
          $set: {
            nameI18n: { en: "Renamed Product", ar: "منتج جديد" },
            imageUrl: "https://example.test/product-b.png",
            itemKind: "other",
            nutrition: { calories: 999, proteinGrams: 99, carbsGrams: 88, fatGrams: 77 },
          },
        }
      );
      await CatalogItem.updateOne(
        { _id: optionItem._id },
        {
          $set: {
            nameI18n: { en: "Renamed Option", ar: "خيار جديد" },
            imageUrl: "https://example.test/option-b.png",
            itemKind: "other",
            nutrition: { calories: 777, proteinGrams: 66, carbsGrams: 55, fatGrams: 44 },
          },
        }
      );

      const after = await priceMenuCart(quoteInput);
      assert.strictEqual(after.items[0].pricingSnapshot.basePriceHalala, before.items[0].pricingSnapshot.basePriceHalala);
      assert.strictEqual(after.items[0].pricingSnapshot.optionsTotalHalala, before.items[0].pricingSnapshot.optionsTotalHalala);
      assert.strictEqual(after.items[0].unitPriceHalala, before.items[0].unitPriceHalala);
      assert.strictEqual(after.pricing.totalHalala, before.pricing.totalHalala);
    });

    await test("Local product disable does not hide a linked option usage", async () => {
      const category = await createPublishedCategory("local_disable");
      const sharedItem = await CatalogItem.create({ nameI18n: { en: "Shared Item", ar: "" }, itemKind: "product" });
      await createPublishedProduct(category, "local_disabled_product", sharedItem._id, { isAvailable: false });
      const builder = await createPublishedProduct(category, "builder_with_shared_option", null);
      await createBuilderOption(builder, sharedItem._id, "shared_option", "proteins");
      const menu = await menuCatalogService.getPublishedMenu({ lang: "en" });
      const keys = flattenProducts(menu).map((product) => product.key);
      assert(!keys.includes("local_disabled_product"));
      const publicBuilder = flattenProducts(menu).find((product) => product.key === "builder_with_shared_option");
      assert(publicBuilder);
      assert.strictEqual(publicBuilder.optionGroups[0].options.length, 1);
    });
  } finally {
    await disconnect();
  }

  if (results.failed > 0) {
    console.error(`catalogItemArchitecture: ${results.failed} failed, ${results.passed} passed`);
    process.exit(1);
  }
  console.log(`catalogItemArchitecture: ${results.passed} passed`);
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await disconnect();
  process.exit(1);
});
