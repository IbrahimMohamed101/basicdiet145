process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "menu-image-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "menu-image-dashboard-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { EventEmitter } = require("events");
const { MongoMemoryServer } = require("mongodb-memory-server");

const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const {
  computePlannerCatalogHash,
  createTtlSingleFlightCache,
  hydrateAndOptimizeMenuImages,
  optimizeCloudinaryImageUrl,
} = require("../src/services/menu/menuImageDeliveryService");
const {
  getMenuDeliveryOptimizationState,
  invalidateMenuDeliveryOptimizationCache,
  isMenuMutationRequest,
  menuMutationCacheInvalidationMiddleware,
} = require("../src/services/installMenuDeliveryOptimization");

let mongoServer;
let usesExternalTestDatabase = false;

async function connectTestDatabase() {
  const dbName = `menu_image_delivery_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const externalUri = String(process.env.MONGODB_URI_TEST || "").trim();
  if (externalUri) {
    usesExternalTestDatabase = true;
    await mongoose.connect(externalUri, {
      dbName,
      serverSelectionTimeoutMS: 15000,
    });
    return;
  }

  mongoServer = await MongoMemoryServer.create({ instance: { dbName } });
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
}

function assertOptimizedCloudinaryUrl(value, expectedWidth = 900) {
  const parsed = new URL(value);
  assert.strictEqual(parsed.protocol, "https:");
  assert.strictEqual(parsed.hostname, "res.cloudinary.com");
  assert(
    parsed.pathname.includes(`/upload/f_auto,q_auto:eco,c_limit,w_${expectedWidth}/`),
    `expected bounded Cloudinary transformation in ${value}`
  );
}

async function testCloudinaryOptimization() {
  const raw = "http://res.cloudinary.com/basicdiet/image/upload/v123/menu/sample.png";
  const optimized = optimizeCloudinaryImageUrl(raw, { width: 720 });
  assertOptimizedCloudinaryUrl(optimized, 720);
  assert.strictEqual(
    optimizeCloudinaryImageUrl(optimized, { width: 720 }),
    optimized,
    "Cloudinary optimization must be idempotent"
  );
  assert.strictEqual(
    optimizeCloudinaryImageUrl("https://images.example.com/menu/sample.png"),
    "https://images.example.com/menu/sample.png",
    "non-Cloudinary URLs must remain unchanged"
  );

  const signed = "https://res.cloudinary.com/basicdiet/image/upload/s--signed-token--/v1/menu/sample.png";
  assert.strictEqual(
    optimizeCloudinaryImageUrl(signed),
    signed,
    "signed Cloudinary URLs must not be rewritten"
  );
}

async function testDatabaseImageHydration() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: `test_menu_${Date.now()}`,
    name: { ar: "اختبار", en: "Test" },
    publishedAt: now,
  });
  const productCatalogItem = await CatalogItem.create({
    key: `test_product_catalog_${Date.now()}`,
    nameI18n: { ar: "صنف", en: "Item" },
    imageUrl: "https://res.cloudinary.com/basicdiet/image/upload/v1/catalog/product.jpg",
    itemKind: "product",
  });
  const optionCatalogItem = await CatalogItem.create({
    key: `test_option_catalog_${Date.now()}`,
    nameI18n: { ar: "اختيار", en: "Option" },
    imageUrl: "https://res.cloudinary.com/basicdiet/image/upload/v1/catalog/option.jpg",
    itemKind: "protein",
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: productCatalogItem._id,
    key: `test_product_${Date.now()}`,
    name: { ar: "منتج", en: "Product" },
    imageUrl: "",
    itemType: "product",
    pricingModel: "fixed",
    priceHalala: 1900,
    publishedAt: now,
  });
  const group = await MenuOptionGroup.create({
    key: `test_group_${Date.now()}`,
    name: { ar: "مجموعة", en: "Group" },
    publishedAt: now,
  });
  const option = await MenuOption.create({
    groupId: group._id,
    catalogItemId: optionCatalogItem._id,
    key: `test_option_${Date.now()}`,
    name: { ar: "اختيار", en: "Option" },
    imageUrl: "",
    publishedAt: now,
  });

  const originalPayload = {
    categories: [
      {
        id: String(category._id),
        products: [
          {
            id: String(product._id),
            name: "Product",
            optionGroups: [
              {
                id: String(group._id),
                options: [
                  {
                    optionId: String(option._id),
                    name: "Option",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    plannerCatalog: {
      contractVersion: "meal_planner_menu.v3",
      currency: "SAR",
      sections: [
        {
          id: "section:test",
          key: "test",
          products: [{ id: String(product._id), name: "Product" }],
        },
      ],
      rules: { version: "meal_planner_rules.v4" },
      catalogHash: "sha256:stale-before-image-hydration",
    },
  };

  const hydrated = await hydrateAndOptimizeMenuImages(originalPayload, { width: 900 });
  const hydratedProduct = hydrated.categories[0].products[0];
  const hydratedOption = hydratedProduct.optionGroups[0].options[0];
  const plannerProduct = hydrated.plannerCatalog.sections[0].products[0];

  assertOptimizedCloudinaryUrl(hydratedProduct.imageUrl);
  assertOptimizedCloudinaryUrl(hydratedOption.imageUrl);
  assertOptimizedCloudinaryUrl(plannerProduct.imageUrl);
  assert.strictEqual(
    hydrated.plannerCatalog.catalogHash,
    computePlannerCatalogHash(hydrated.plannerCatalog),
    "planner ETag hash must describe the final image-hydrated payload"
  );
  assert.notStrictEqual(
    hydrated.plannerCatalog.catalogHash,
    originalPayload.plannerCatalog.catalogHash,
    "image hydration must replace a stale planner hash"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(originalPayload.categories[0].products[0], "imageUrl"),
    false,
    "hydration must not mutate the source menu payload"
  );
}

async function testSingleFlightCache() {
  let clock = 1000;
  let loads = 0;
  const cache = createTtlSingleFlightCache({
    ttlMs: 50,
    maxEntries: 4,
    now: () => clock,
  });
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { nested: { value: loads } };
  };

  const [first, second] = await Promise.all([
    cache.getOrLoad("menu:ar", loader),
    cache.getOrLoad("menu:ar", loader),
  ]);
  assert.strictEqual(loads, 1, "concurrent cache misses must share one database build");
  assert.deepStrictEqual(first, second);

  first.nested.value = 999;
  const cached = await cache.getOrLoad("menu:ar", loader);
  assert.strictEqual(cached.nested.value, 1, "cached values must be returned as defensive clones");
  assert.strictEqual(loads, 1);

  clock += 51;
  const expired = await cache.getOrLoad("menu:ar", loader);
  assert.strictEqual(expired.nested.value, 2);
  assert.strictEqual(loads, 2, "expired entries must rebuild safely");

  cache.clear();
  await cache.getOrLoad("menu:ar", loader);
  assert.strictEqual(loads, 3, "explicit invalidation must force a rebuild");
}

async function testMutationInvalidationPolicy() {
  assert.strictEqual(
    isMenuMutationRequest({ method: "PATCH", originalUrl: "/api/dashboard/menu/products/1" }),
    true
  );
  assert.strictEqual(
    isMenuMutationRequest({ method: "GET", originalUrl: "/api/dashboard/menu/products" }),
    false
  );
  assert.strictEqual(
    isMenuMutationRequest({ method: "POST", originalUrl: "/api/orders" }),
    false
  );

  const req = { method: "PATCH", originalUrl: "/api/dashboard/meal-builder/sections/1" };
  const res = new EventEmitter();
  res.statusCode = 200;
  let nextCalled = false;
  menuMutationCacheInvalidationMiddleware(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
  res.emit("finish");

  const state = getMenuDeliveryOptimizationState();
  assert.strictEqual(state.installed, true);
  assert.strictEqual(state.oneTimeMenuCache.clears > 0, true);
  assert.strictEqual(state.plannerCatalogCache.clears > 0, true);
  invalidateMenuDeliveryOptimizationCache();
}

async function main() {
  await testCloudinaryOptimization();
  await connectTestDatabase();
  await testDatabaseImageHydration();
  await testSingleFlightCache();
  await testMutationInvalidationPolicy();
  console.log(
    `menuImageDeliveryOptimization.test.js passed (${usesExternalTestDatabase ? "MONGODB_URI_TEST" : "mongodb-memory-server"})`
  );
}

main()
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      if (mongoose.connection.db) await mongoose.connection.db.dropDatabase();
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
