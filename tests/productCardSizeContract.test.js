process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

const TEST_TAG = `card-size-${Date.now()}`;
const TEST_KEY = TEST_TAG.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

let app;
let mongoServer;
let adminHeaders;

function expectStatus(res, statusCode, label) {
  assert.strictEqual(
    res.status,
    statusCode,
    `${label}: expected ${statusCode}, got ${res.status} ${JSON.stringify(res.body)}`
  );
}

async function setup() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  app = createApp();
  ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));
}

async function teardown() {
  await mongoose.disconnect();
  await mongoServer.stop();
}

async function createCategory() {
  const res = await request(app)
    .post("/api/dashboard/menu/categories")
    .set(adminHeaders)
    .send({
      key: `${TEST_KEY}_category`,
      name: { en: "Card Size Category", ar: "Card Size Category" },
    });
  expectStatus(res, 201, "create category");
  return res.body.data;
}

async function createProduct(categoryId, key, ui, priceHalala = 1000) {
  const body = {
    categoryId,
    key,
    name: { en: key, ar: key },
    itemType: "product",
    pricingModel: "fixed",
    priceHalala,
  };
  if (ui !== undefined) body.ui = ui;

  const res = await request(app)
    .post("/api/dashboard/menu/products")
    .set(adminHeaders)
    .send(body);
  expectStatus(res, 201, `create product ${key}`);
  return res.body.data;
}

async function run() {
  try {
    await setup();

    const modelDefault = new MenuProduct({
      categoryId: new mongoose.Types.ObjectId(),
      key: "model_default_product",
      name: { en: "Model Default" },
      priceHalala: 1000,
    });
    await modelDefault.validate();
    assert.strictEqual(modelDefault.ui.cardSize, "medium", "model defaults ui.cardSize to medium");

    for (const size of ["large", "medium", "small"]) {
      const valid = new MenuProduct({
        categoryId: new mongoose.Types.ObjectId(),
        key: `model_${size}_product`,
        name: { en: `Model ${size}` },
        priceHalala: 1000,
        ui: { cardSize: size },
      });
      await valid.validate();
      assert.strictEqual(valid.ui.cardSize, size, `model accepts ${size}`);
    }

    const invalid = new MenuProduct({
      categoryId: new mongoose.Types.ObjectId(),
      key: "model_invalid_product",
      name: { en: "Model Invalid" },
      priceHalala: 1000,
      ui: { cardSize: "xl" },
    });
    await assert.rejects(() => invalid.validate(), /cardSize/, "model rejects invalid cardSize");

    const category = await createCategory();

    const defaultProduct = await createProduct(category.id, `${TEST_KEY}_default`, undefined, 1000);
    assert.strictEqual(defaultProduct.ui.cardSize, "medium", "create without cardSize returns medium");

    const largeProduct = await createProduct(category.id, `${TEST_KEY}_large`, { cardSize: "large" }, 1200);
    assert.strictEqual(largeProduct.ui.cardSize, "large", "create accepts large");

    const smallProduct = await createProduct(category.id, `${TEST_KEY}_small`, { cardSize: "small" }, 900);
    assert.strictEqual(smallProduct.ui.cardSize, "small", "create accepts small");

    const richUiProduct = await createProduct(category.id, `${TEST_KEY}_rich`, {
      cardVariant: "premium",
      cardSize: "medium",
      badge: "New",
      ctaLabel: "Customize",
      imageRatio: "wide",
      showPrice: true,
      showDescription: true,
      mediaPositionByLocale: { ar: "left", en: "right" },
      behaviorHint: "direct_add",
      priceLabelMode: "fixed",
    }, 1500);

    for (const cardSize of ["hero", "xl", ""]) {
      const res = await request(app)
        .post("/api/dashboard/menu/products")
        .set(adminHeaders)
        .send({
          categoryId: category.id,
          key: `${TEST_KEY}_invalid_${String(cardSize || "empty")}`,
          name: { en: "Invalid", ar: "Invalid" },
          itemType: "product",
          pricingModel: "fixed",
          priceHalala: 1000,
          ui: { cardSize },
        });
      expectStatus(res, 400, `create rejects invalid cardSize ${cardSize}`);
    }

    let res = await request(app)
      .patch(`/api/dashboard/menu/products/${defaultProduct.id}`)
      .set(adminHeaders)
      .send({ ui: { cardSize: "large" } });
    expectStatus(res, 200, "update cardSize to large");
    assert.strictEqual(res.body.data.ui.cardSize, "large", "update returns large");

    res = await request(app)
      .patch(`/api/dashboard/menu/products/${defaultProduct.id}`)
      .set(adminHeaders)
      .send({ name: { en: "Default renamed", ar: "Default renamed" } });
    expectStatus(res, 200, "update without cardSize");
    assert.strictEqual(res.body.data.ui.cardSize, "large", "update without cardSize preserves stored value");

    const optionGroupCountBefore = await ProductOptionGroup.countDocuments({ productId: richUiProduct.id });
    res = await request(app)
      .patch(`/api/dashboard/menu/products/${richUiProduct.id}`)
      .set(adminHeaders)
      .send({ ui: { cardSize: "small" } });
    expectStatus(res, 200, "partial cardSize update");
    assert.deepStrictEqual(res.body.data.ui, {
      cardVariant: "premium",
      cardSize: "small",
      badge: "New",
      ctaLabel: "Customize",
      imageRatio: "wide",
      mediaPositionByLocale: { ar: "left", en: "right" },
      showDescription: true,
      showPrice: true,
      priceLabelMode: "fixed",
      behaviorHint: "direct_add",
    }, "partial cardSize update preserves other ui fields");
    assert.strictEqual(
      await ProductOptionGroup.countDocuments({ productId: richUiProduct.id }),
      optionGroupCountBefore,
      "cardSize update does not change option group relations"
    );

    res = await request(app)
      .patch(`/api/dashboard/menu/products/${richUiProduct.id}`)
      .set(adminHeaders)
      .send({ ui: { cardSize: "xl" } });
    expectStatus(res, 400, "update rejects invalid cardSize");

    await MenuProduct.updateOne({ _id: defaultProduct.id }, { $unset: { "ui.cardSize": 1 } });

    res = await request(app).get(`/api/dashboard/menu/products/${defaultProduct.id}`).set(adminHeaders);
    expectStatus(res, 200, "product detail");
    assert.strictEqual(res.body.data.product.ui.cardSize, "medium", "detail defaults legacy missing cardSize");

    res = await request(app).get("/api/dashboard/menu/products").set(adminHeaders);
    expectStatus(res, 200, "product list");
    const listedDefault = res.body.data.find((product) => product.id === defaultProduct.id);
    assert(listedDefault, "default product appears in product list");
    assert.strictEqual(listedDefault.ui.cardSize, "medium", "list defaults legacy missing cardSize");
    assert(res.body.data.every((product) => product.ui && product.ui.cardSize), "every listed product has cardSize");

    res = await request(app).get(`/api/dashboard/menu/products/${richUiProduct.id}/composer`).set(adminHeaders);
    expectStatus(res, 200, "product composer");
    assert.strictEqual(res.body.data.product.ui.cardSize, "small", "composer returns cardSize");

    res = await request(app).post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: "card size contract" });
    expectStatus(res, 200, "publish local card size catalog");

    res = await request(app).get("/api/orders/menu?lang=en");
    expectStatus(res, 200, "public order menu");
    const publicProducts = res.body.data.categories.flatMap((item) => item.products || []);
    assert(publicProducts.every((product) => product.ui && product.ui.cardSize), "every public product has cardSize");

    const publicByKey = new Map(publicProducts.map((product) => [product.key, product]));
    assert.strictEqual(publicByKey.get(largeProduct.key).ui.cardSize, "large", "public returns explicit large");
    assert.strictEqual(publicByKey.get(smallProduct.key).ui.cardSize, "small", "public returns explicit small");
    assert.strictEqual(publicByKey.get(defaultProduct.key).ui.cardSize, "medium", "public defaults legacy missing cardSize");
    assert.strictEqual(publicByKey.get(largeProduct.key).priceHalala, 1200, "cardSize does not change pricing");
    assert.strictEqual(publicByKey.get(smallProduct.key).isAvailable, undefined, "public product availability shape unchanged");
    assert.deepStrictEqual(publicByKey.get(richUiProduct.key).optionGroups, [], "cardSize does not change option groups");

    console.log("product card size contract test passed");
  } finally {
    await teardown();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
