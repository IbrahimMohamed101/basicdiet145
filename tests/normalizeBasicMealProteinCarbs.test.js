process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const { seedNewMenu } = require("../scripts/bootstrap/seed-new-menu");
const { seedSettings } = require("../scripts/bootstrap/seed-catalog");

const {
  runNormalization,
  BASIC_MEAL_PROTEIN_GROUP_ID,
} = require("../scripts/migrations/normalize-basic-meal-protein-carbs");

let mongoServer;

async function setup() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  await seedSettings({ sync: false });
  await seedNewMenu({ sync: false });

  let category = await MenuCategory.findOne({ key: "meals" });
  if (!category) {
    category = await MenuCategory.create({
      key: "meals",
      name: { ar: "الوجبات", en: "Meals" },
    });
  }

  let product = await MenuProduct.findOne({ key: "basic_meal" });
  if (!product) {
    product = await MenuProduct.create({
      key: "basic_meal",
      categoryId: category._id,
      name: { ar: "وجبة أساسية", en: "Basic Meal" },
      itemType: "basic_meal",
      priceHalala: 3000,
      isActive: true,
    });
  }

  let proteinGroup = await MenuOptionGroup.findById(BASIC_MEAL_PROTEIN_GROUP_ID);
  if (!proteinGroup) {
    proteinGroup = await MenuOptionGroup.create({
      _id: new mongoose.Types.ObjectId(BASIC_MEAL_PROTEIN_GROUP_ID),
      key: "proteins",
      name: { ar: "بروتين", en: "Proteins" },
    });
  }

  let carbGroup = await MenuOptionGroup.findOne({ key: "carbs" });
  if (!carbGroup) {
    carbGroup = await MenuOptionGroup.create({
      key: "carbs",
      name: { ar: "نشويات", en: "Carbs" },
    });
  }

  // Ensure ProductOptionGroup links basic_meal to proteinGroup and carbGroup
  await ProductOptionGroup.updateOne(
    { productId: product._id, groupId: proteinGroup._id },
    { $set: { minSelections: 1, maxSelections: 1 } },
    { upsert: true }
  );

  await ProductOptionGroup.updateOne(
    { productId: product._id, groupId: carbGroup._id },
    { $set: { minSelections: 1, maxSelections: 2 } },
    { upsert: true }
  );

  // Ensure paid options exist in MenuOption so unknown/ambiguous count is 0
  const paidOptions = [
    { key: "meatballs", name: { ar: "كرات لحم", en: "Meatballs" }, extraPriceHalala: 300 },
    { key: "beef_stroganoff", name: { ar: "لحم استرغانوف", en: "Beef Stroganoff" }, extraPriceHalala: 300 },
    { key: "beef_steak", name: { ar: "ستيك لحم", en: "Beef Steak" }, extraPriceHalala: 1600 },
    { key: "shrimp", name: { ar: "جمبري", en: "Shrimp" }, extraPriceHalala: 1600 },
    { key: "salmon", name: { ar: "سالمون", en: "Salmon" }, extraPriceHalala: 1600 },
  ];

  for (const opt of paidOptions) {
    const existing = await MenuOption.findOne({ key: opt.key });
    if (!existing) {
      await MenuOption.create({
        key: opt.key,
        groupId: proteinGroup._id,
        name: opt.name,
        extraPriceHalala: opt.extraPriceHalala,
        isActive: true,
      });
    }
  }

  // Add an unapproved relation to test deactivation
  const unapprovedProtein = await MenuOption.create({
    key: "exotic_ostrich_meat",
    groupId: proteinGroup._id,
    name: { ar: "نعام", en: "Ostrich" },
  });

  const relUnapproved = await ProductGroupOption.create({
    productId: product._id,
    groupId: proteinGroup._id,
    optionId: unapprovedProtein._id,
    isActive: true, // Should be deactivated
  });

  return { product, relUnapproved };
}

async function teardown() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

async function runTests() {
  const seeded = await setup();

  try {
    console.log("Testing dry run normalization...");
    const dryRunResult = await runNormalization({
      argv: ["--dry-run"],
      closeConnection: false,
    });

    assert.strictEqual(dryRunResult.mode, "dry_run");
    assert.strictEqual(dryRunResult.summaryCounters.deletedRecords, 0);
    assert.strictEqual(dryRunResult.summaryCounters.historicalRewrites, 0);
    assert.strictEqual(dryRunResult.summaryCounters.regularProteinActiveAfter, 13);
    assert.strictEqual(dryRunResult.summaryCounters.paidPreservedOptionsActive, 5);
    assert.strictEqual(dryRunResult.summaryCounters.carbsActiveAfter, 9);
    assert.strictEqual(dryRunResult.summaryCounters.unknownAmbiguousOptions, 0);

    // Verify DB was NOT mutated during dry-run
    const checkRelDry = await ProductGroupOption.findById(seeded.relUnapproved._id);
    assert.strictEqual(checkRelDry.isActive, true);

    console.log("Testing execute normalization...");
    const executeResult = await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
    });

    assert.strictEqual(executeResult.mode, "execute");
    assert.strictEqual(executeResult.summaryCounters.deletedRecords, 0);
    assert.strictEqual(executeResult.summaryCounters.historicalRewrites, 0);
    assert.strictEqual(executeResult.summaryCounters.unknownAmbiguousOptions, 0);

    // Verify DB WAS mutated on execute: unapproved item deactivated
    const checkRelExecute = await ProductGroupOption.findById(seeded.relUnapproved._id);
    assert.strictEqual(checkRelExecute.isActive, false);

    console.log("\nAll normalize-basic-meal-protein-carbs unit tests passed successfully!");
  } finally {
    await teardown();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
