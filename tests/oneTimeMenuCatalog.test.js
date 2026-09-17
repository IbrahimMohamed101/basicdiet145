process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuProduct = require("../src/models/MenuProduct");
const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");
const { productRows, seedOneTimeMenu } = require("../scripts/seed-one-time-menu");

let mongoServer;

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    (category.products || []).map((product) => ({ ...product, categoryKey: category.key }))
  ));
}

async function main() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `one_time_workbook_menu_${Date.now()}` },
  });
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  assert.strictEqual(productRows, source.products, "legacy export must reference the workbook product rows");
  await seedOneTimeMenu({ log: { log() {} } });

  const api = request(createApp());
  const response = await api.get("/api/orders/menu?includePublicV2=true&lang=en");
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));

  const menu = response.body.data;
  const products = flattenProducts(menu);
  const expectedReadyKeys = new Set(
    source.products.filter((row) => row.status === "Ready").map((row) => row.key)
  );
  const actualKeys = new Set(products.map((row) => row.key));

  assert.strictEqual(products.length, 55, "public menu exposes only workbook Ready products");
  assert.deepStrictEqual([...actualKeys].sort(), [...expectedReadyKeys].sort());
  assert.deepStrictEqual(
    (menu.categories || []).map((category) => category.key).sort(),
    ["breakfast", "meals", "salads", "sandwiches"].sort(),
    "categories without a Ready product are omitted from the public response"
  );

  for (const product of products) {
    const workbook = source.products.find((row) => row.key === product.key);
    assert(workbook, `${product.key} must exist in the workbook source`);
    assert.strictEqual(product.nameI18n.ar, workbook.name.ar);
    assert.strictEqual(product.nameI18n.en, workbook.name.en);
    assert.strictEqual(product.priceHalala, workbook.priceHalala);
    assert.strictEqual(product.categoryKey, workbook.categoryKey);
  }

  for (const row of source.products.filter((product) => product.status !== "Ready")) {
    assert(!actualKeys.has(row.key), `${row.key} is a dashboard draft and must not be public`);
  }
  for (const candidate of source.productCandidates) {
    assert(!actualKeys.has(candidate.key), `${candidate.key} is a review candidate and must not be public`);
  }

  assert.strictEqual(menu.publicMenuV2.contractVersion, "one_time_menu.v2");
  assert.strictEqual(menu.publicMenuV2.sections.flatMap((section) => section.products || []).length, 55);
  assert.strictEqual(await MenuProduct.countDocuments({}), 106);

  await assert.rejects(
    () => seedOneTimeMenu({ sync: true, log: { log() {} } }),
    /never supports sync\/force mode/
  );

  console.log("oneTimeMenuCatalog.test.js workbook menu contract passed");
}

main()
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
