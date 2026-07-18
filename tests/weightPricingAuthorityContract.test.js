process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const menuPricingService = require("../src/services/orders/menuPricingService");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const TEST_WEIGHT_CHOICES = [
  { weightGrams: 100, priceHalala: 1900 },
  { weightGrams: 150, priceHalala: 2400 },
  { weightGrams: 200, priceHalala: 2900 },
  { weightGrams: 250, priceHalala: 3400 },
];

function quoteProduct(product, weightGrams) {
  return menuPricingService.priceMenuCart({
    userId: new mongoose.Types.ObjectId(),
    items: [{ productId: String(product._id), qty: 1, weightGrams, selectedOptions: [] }],
    fulfillmentMethod: "pickup",
    pickup: { branchId: "main" },
    lang: "en",
    requestBody: {},
  });
}

async function main() {
  const dbName = `weight_pricing_authority_${Date.now()}`;
  const mongo = await MongoMemoryServer.create({ instance: { dbName } });

  try {
    await mongoose.connect(mongo.getUri(dbName));
    const app = createApp();
    const now = new Date();

    const category = await MenuCategory.create({
      key: `weighted_meals_${Date.now()}`,
      name: { ar: "وجبات بالوزن", en: "Weighted Meals" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    const product = await MenuProduct.create({
      categoryId: category._id,
      key: `spicy_chicken_meal_100g_${Date.now()}`,
      name: { ar: "وجبة دجاج سبايسي 100 جرام", en: "Spicy Chicken Meal 100g" },
      itemType: "product",
      pricingModel: "per_100g",
      priceHalala: 1900,
      baseUnitGrams: 100,
      defaultWeightGrams: 100,
      minWeightGrams: 100,
      maxWeightGrams: 250,
      weightStepGrams: 50,
      weightStepPriceHalala: 500,
      availableFor: ["one_time"],
      isCustomizable: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    const { headers } = await dashboardAuth("admin", "weight-pricing-authority");

    const initialMenu = await request(app).get("/api/orders/menu?includePublicV2=true");
    assert.strictEqual(initialMenu.status, 200, JSON.stringify(initialMenu.body));
    const initiallySeededProduct = initialMenu.body.data.categories
      .flatMap((item) => item.products || [])
      .find((item) => item.id === String(product._id));
    assert(initiallySeededProduct, "test-priced product appears in the public menu");
    assert.strictEqual(initiallySeededProduct.weightPricing.contractVersion, "weight_pricing.v1");
    assert.deepStrictEqual(initiallySeededProduct.weightPricing.choices, TEST_WEIGHT_CHOICES);
    assert.strictEqual(initiallySeededProduct.weightPricing.choices.length, 4);
    assert(!initiallySeededProduct.weightPricing.choices.some((choice) => choice.weightGrams === 300));

    for (const choice of TEST_WEIGHT_CHOICES) {
      const quote = await quoteProduct(product, choice.weightGrams);
      assert.strictEqual(quote.items[0].unitPriceHalala, choice.priceHalala);
      assert.strictEqual(quote.pricing.totalHalala, choice.priceHalala);
    }
    for (const invalidWeight of [50, 125, 175, 300]) {
      await assert.rejects(
        () => quoteProduct(product, invalidWeight),
        (err) => err && err.code === "INVALID_WEIGHT_GRAMS"
      );
    }

    const incompatible = await request(app)
      .patch(`/api/dashboard/menu/products/${product._id}/weight-pricing`)
      .set(headers)
      .send({
        priceHalala: 1900,
        baseUnitGrams: 120,
        defaultWeightGrams: 120,
        minWeightGrams: 120,
        maxWeightGrams: 500,
        weightStepGrams: 50,
        weightStepPriceHalala: 500,
      });
    assert.strictEqual(incompatible.status, 400, JSON.stringify(incompatible.body));
    assert.strictEqual(incompatible.body.error.code, "INVALID_WEIGHT_PRICING_CONFIGURATION");

    const update = await request(app)
      .patch(`/api/dashboard/menu/products/${product._id}/weight-pricing`)
      .set(headers)
      .send({
        priceHalala: 2100,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 500,
        weightStepGrams: 100,
        weightStepPriceHalala: 700,
      });

    assert.strictEqual(update.status, 200, JSON.stringify(update.body));
    assert.strictEqual(update.body.data.contractVersion, "dashboard_weight_pricing.v1");
    assert.strictEqual(update.body.data.product.priceHalala, 2100);
    assert.strictEqual(update.body.data.product.weightStepPriceHalala, 700);
    assert.deepStrictEqual(update.body.data.weightPricing.choices, [
      { weightGrams: 100, priceHalala: 2100 },
      { weightGrams: 200, priceHalala: 2800 },
      { weightGrams: 300, priceHalala: 3500 },
      { weightGrams: 400, priceHalala: 4200 },
      { weightGrams: 500, priceHalala: 4900 },
    ]);

    const menu = await request(app).get("/api/orders/menu?includePublicV2=true");
    assert.strictEqual(menu.status, 200, JSON.stringify(menu.body));
    const publicProduct = menu.body.data.categories
      .flatMap((item) => item.products || [])
      .find((item) => item.id === String(product._id));
    assert(publicProduct, "weighted product appears in legacy public menu");
    assert.strictEqual(publicProduct.priceHalala, 2100);
    assert.strictEqual(publicProduct.weightStepPriceHalala, 700);
    assert.strictEqual(publicProduct.weightPricing.contractVersion, "weight_pricing.v1");
    assert.strictEqual(publicProduct.weightPricing.strategy, "base_plus_steps");
    assert.deepStrictEqual(publicProduct.weightPricing.choices, [
      { weightGrams: 100, priceHalala: 2100 },
      { weightGrams: 200, priceHalala: 2800 },
      { weightGrams: 300, priceHalala: 3500 },
      { weightGrams: 400, priceHalala: 4200 },
      { weightGrams: 500, priceHalala: 4900 },
    ]);

    const publicV2Product = menu.body.data.publicMenuV2.sections
      .flatMap((item) => item.products || [])
      .find((item) => item.id === String(product._id));
    assert(publicV2Product, "weighted product appears in publicMenuV2");
    assert.strictEqual(publicV2Product.pricing.strategy, "base_plus_steps");
    assert.strictEqual(publicV2Product.pricing.requiresWeightSelection, true);
    assert.strictEqual(publicV2Product.pricing.weightStepPriceHalala, 700);
    assert.deepStrictEqual(publicV2Product.pricing.weightChoices[2], {
      weightGrams: 300,
      priceHalala: 3500,
    });

    const quote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [{
        productId: String(product._id),
        qty: 1,
        weightGrams: 300,
        selectedOptions: [],
      }],
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      lang: "en",
      requestBody: {},
    });

    assert.strictEqual(quote.items[0].weightGrams, 300);
    assert.strictEqual(quote.items[0].unitPriceHalala, 3500);
    assert.strictEqual(quote.items[0].lineTotalHalala, 3500);
    assert.strictEqual(quote.items[0].pricingSnapshot.weightPricing.strategy, "base_plus_steps");
    assert.strictEqual(quote.items[0].pricingSnapshot.weightPricing.stepCount, 2);
    assert.strictEqual(quote.pricing.subtotalHalala, 3500);
    assert.strictEqual(quote.pricing.totalHalala, 3500);

    console.log("✅ dashboard weight pricing endpoint");
    console.log("✅ incompatible base/step validation");
    console.log("✅ legacy and publicMenuV2 serialization");
    console.log("✅ authoritative quote and stored pricing snapshot");
  } finally {
    await MenuAuditLog.deleteMany({});
    await DashboardUser.deleteMany({});
    await MenuProduct.deleteMany({});
    await MenuCategory.deleteMany({});
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
