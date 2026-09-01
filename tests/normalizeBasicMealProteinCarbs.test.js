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
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");

const { runNormalization } = require("../scripts/migrations/normalize-basic-meal-protein-carbs");

let mongoServer;

async function setup() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Seed test data
  const category = await MenuCategory.create({
    key: "main_meals",
    name: { ar: "الوجبات الرئيسية", en: "Main Meals" },
    sortOrder: 1,
  });

  const product = await MenuProduct.create({
    key: "basic_meal",
    categoryId: category._id,
    name: { ar: "وجبة أساسية", en: "Basic Meal" },
    itemType: "basic_meal",
    priceHalala: 3000,
    isActive: true,
  });

  const proteinGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { ar: "بروتين", en: "Proteins" },
  });

  const carbGroup = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "كربوهيدرات", en: "Carbs" },
  });

  await ProductOptionGroup.create({
    productId: product._id,
    groupId: proteinGroup._id,
    minSelections: 1,
    maxSelections: 1,
  });

  await ProductOptionGroup.create({
    productId: product._id,
    groupId: carbGroup._id,
    minSelections: 1,
    maxSelections: 2,
  });

  // Approved options
  const grilledChicken = await MenuOption.create({
    key: "grilled_chicken",
    groupId: proteinGroup._id,
    name: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  });

  const whiteRice = await MenuOption.create({
    key: "white_rice",
    groupId: carbGroup._id,
    name: { ar: "أرز أبيض", en: "White Rice" },
  });

  // Disallowed options
  const unapprovedProtein = await MenuOption.create({
    key: "exotic_ostrich_meat",
    groupId: proteinGroup._id,
    name: { ar: "نعام", en: "Ostrich" },
  });

  const unapprovedCarb = await MenuOption.create({
    key: "exotic_truffle_fries",
    groupId: carbGroup._id,
    name: { ar: "بطاطس ترافل", en: "Truffle Fries" },
  });

  const rel1 = await ProductGroupOption.create({
    productId: product._id,
    groupId: proteinGroup._id,
    optionId: grilledChicken._id,
    isActive: false, // Should be activated
  });

  const rel2 = await ProductGroupOption.create({
    productId: product._id,
    groupId: proteinGroup._id,
    optionId: unapprovedProtein._id,
    isActive: true, // Should be deactivated
  });

  const rel3 = await ProductGroupOption.create({
    productId: product._id,
    groupId: carbGroup._id,
    optionId: whiteRice._id,
    isActive: true,
  });

  const rel4 = await ProductGroupOption.create({
    productId: product._id,
    groupId: carbGroup._id,
    optionId: unapprovedCarb._id,
    isActive: true, // Should be deactivated
  });

  return { product, rel1, rel2, rel3, rel4 };
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
    assert.strictEqual(dryRunResult.deleted_records, 0);
    assert.strictEqual(dryRunResult.historical_rewrites, 0);
    assert.strictEqual(dryRunResult.proposedUpdatesCount, 3); // rel1 to activate, rel2 & rel4 to deactivate
    assert.strictEqual(dryRunResult.enabledCount, 1);
    assert.strictEqual(dryRunResult.disabledCount, 2);

    // Verify DB was NOT mutated during dry-run
    const checkRel1Dry = await ProductGroupOption.findById(seeded.rel1._id);
    assert.strictEqual(checkRel1Dry.isActive, false);

    console.log("Testing apply normalization...");
    const applyResult = await runNormalization({
      argv: ["--apply"],
      closeConnection: false,
    });

    assert.strictEqual(applyResult.mode, "apply");
    assert.strictEqual(applyResult.deleted_records, 0);
    assert.strictEqual(applyResult.historical_rewrites, 0);

    // Verify DB WAS mutated on apply
    const checkRel1Apply = await ProductGroupOption.findById(seeded.rel1._id);
    assert.strictEqual(checkRel1Apply.isActive, true);

    const checkRel2Apply = await ProductGroupOption.findById(seeded.rel2._id);
    assert.strictEqual(checkRel2Apply.isActive, false);

    const checkRel4Apply = await ProductGroupOption.findById(seeded.rel4._id);
    assert.strictEqual(checkRel4Apply.isActive, false);

    console.log("Testing idempotency...");
    const repeatApplyResult = await runNormalization({
      argv: ["--apply"],
      closeConnection: false,
    });

    assert.strictEqual(repeatApplyResult.proposedUpdatesCount, 0);

    console.log("All normalize-basic-meal-protein-carbs tests passed successfully!");
  } finally {
    await teardown();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
