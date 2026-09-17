process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");
const { seedNewMenu } = require("../scripts/bootstrap/seed-new-menu");
const { verifyMenuWorkbookSource } = require("../scripts/bootstrap/verify-menu-workbook-source");

let mongoServer;

async function main() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `workbook_menu_source_${Date.now()}` },
  });
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  const first = await seedNewMenu({ sync: false, log: { log() {} } });
  assert.strictEqual(first.counts.categoryCount, 10);
  assert.strictEqual(first.counts.productCount, 106);
  assert.strictEqual(first.counts.builderOptionCount, 33);

  const counts = await Promise.all([
    MenuCategory.countDocuments({}),
    MenuProduct.countDocuments({}),
    MenuOptionGroup.countDocuments({}),
    MenuOption.countDocuments({}),
    ProductOptionGroup.countDocuments({}),
    ProductGroupOption.countDocuments({}),
  ]);
  assert.deepStrictEqual(counts, [10, 106, 4, 33, 0, 0]);

  assert.strictEqual(
    await MenuProduct.countDocuments({
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: { $ne: null },
    }),
    55,
    "only workbook Ready products are published"
  );
  assert.strictEqual(
    await MenuProduct.countDocuments({ publishedAt: null }),
    51,
    "workbook review products remain dashboard drafts"
  );
  assert.strictEqual(
    await MenuOption.countDocuments({ publishedAt: { $ne: null } }),
    0,
    "workbook Draft builder options are not published"
  );

  for (const candidate of source.productCandidates) {
    assert.strictEqual(await MenuProduct.exists({ key: candidate.key }), null);
  }

  const verification = await verifyMenuWorkbookSource({ strict: true, log: { log() {} } });
  assert.strictEqual(verification.ok, true);

  const editedKey = source.products[0].key;
  await MenuProduct.updateOne({ key: editedKey }, { $set: { priceHalala: 9999 } });
  await seedNewMenu({ sync: false, log: { log() {} } });
  assert.strictEqual(
    (await MenuProduct.findOne({ key: editedKey }).lean()).priceHalala,
    9999,
    "rerunning the importer must preserve dashboard edits"
  );

  await assert.rejects(
    () => verifyMenuWorkbookSource({ strict: true, log: { log() {} } }),
    (error) => error && error.code === "WORKBOOK_MENU_SOURCE_MISMATCH"
  );

  assert.strictEqual(
    await CatalogItem.countDocuments({ key: { $in: source.products.map((row) => row.key) } }),
    106
  );

  console.log("workbookMenuSource.integration.test.js passed");
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
