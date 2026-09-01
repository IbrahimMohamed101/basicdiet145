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

const {
  BASIC_MEAL_PRODUCT_ID,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  BASIC_MEAL_CARB_GROUP_ID,
  FINAL_PROTEINS,
  FINAL_CARBS,
  runNormalization,
} = require("../scripts/migrations/normalize-basic-meal-protein-carbs");

let mongoServer;

async function setup() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongoServer.getUri());

  const productId = new mongoose.Types.ObjectId(BASIC_MEAL_PRODUCT_ID);
  const proteinGroupId = new mongoose.Types.ObjectId(BASIC_MEAL_PROTEIN_GROUP_ID);
  const carbGroupId = new mongoose.Types.ObjectId(BASIC_MEAL_CARB_GROUP_ID);

  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  await MenuProduct.create({
    _id: productId,
    categoryId: category._id,
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    itemType: "basic_meal",
    priceHalala: 1900,
    pricingModel: "per_100g",
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  await MenuOptionGroup.create([
    {
      _id: proteinGroupId,
      key: "proteins",
      name: { ar: "البروتين", en: "Protein" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    },
    {
      _id: carbGroupId,
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    },
  ]);

  await ProductOptionGroup.create([
    {
      productId,
      groupId: proteinGroupId,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
    {
      productId,
      groupId: carbGroupId,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      isRequired: true,
      minSelections: 1,
      maxSelections: 2,
    },
  ]);

  const proteinDocs = [];
  for (const definition of FINAL_PROTEINS.filter((row) => !row.allowCreate)) {
    proteinDocs.push(await MenuOption.create({
      groupId: proteinGroupId,
      key: definition.key,
      name: { ar: definition.ar, en: definition.en },
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      proteinFamilyKey: definition.family,
      displayCategoryKey: definition.family,
      selectionType: "standard_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: definition.order,
      publishedAt: new Date(),
    }));
  }

  const carbDocs = [];
  for (const definition of FINAL_CARBS) {
    carbDocs.push(await MenuOption.create({
      groupId: carbGroupId,
      key: definition.key,
      name: { ar: definition.ar, en: definition.en },
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      displayCategoryKey: "standard_carbs",
      selectionType: "standard_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: definition.order,
      publishedAt: new Date(),
    }));
  }

  for (const option of [...proteinDocs, ...carbDocs]) {
    await ProductGroupOption.create({
      productId,
      groupId: option.groupId,
      optionId: option._id,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: option.sortOrder,
    });
  }

  const obsolete = await MenuOption.create({
    groupId: proteinGroupId,
    key: "old_protein",
    name: { ar: "بروتين قديم", en: "Old Protein" },
    selectionType: "standard_meal",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const obsoleteRelation = await ProductGroupOption.create({
    productId,
    groupId: proteinGroupId,
    optionId: obsolete._id,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });

  const wrongGroup = await MenuOptionGroup.create({
    key: "protein",
    name: { ar: "بروتين سلطة", en: "Salad Protein" },
  });
  const wrongContextLemon = await MenuOption.create({
    groupId: wrongGroup._id,
    key: "lemon_bbq_chicken",
    name: { ar: "دجاج ليمون باربكيو", en: "Lemon BBQ Chicken" },
  });

  return { obsolete, obsoleteRelation, wrongContextLemon };
}

async function teardown() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function runTests() {
  const seeded = await setup();

  try {
    const dryRun = await runNormalization({
      argv: ["--dry-run"],
      closeConnection: false,
      skipDraftSync: true,
    });

    assert.strictEqual(dryRun.mode, "dry_run");
    assert.strictEqual(dryRun.finalMenu.regularProteins.length, 13);
    assert.strictEqual(dryRun.finalMenu.carbs.length, 9);
    assert.strictEqual(
      dryRun.finalMenu.regularProteins.find((row) => row.key === "lemon_bbq_chicken").action,
      "create"
    );
    assert.deepStrictEqual(dryRun.safety, {
      deletedRecords: 0,
      historicalRewrites: 0,
      groupMerges: 0,
      premiumConfigChanges: 0,
      basicSaladChanges: 0,
      premiumLargeSaladChanges: 0,
      wrongContextMoves: 0,
    });

    assert.strictEqual((await ProductGroupOption.findById(seeded.obsoleteRelation._id)).isActive, true);
    assert.strictEqual(
      await MenuOption.countDocuments({
        groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
        key: "lemon_bbq_chicken",
      }),
      0
    );

    const execute = await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
      skipDraftSync: true,
    });

    assert.strictEqual(execute.mode, "execute_prepare_only");

    const canonicalLemon = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "lemon_bbq_chicken",
    }).lean();
    assert(canonicalLemon, "canonical lemon BBQ option was not created");
    assert.notStrictEqual(String(canonicalLemon._id), String(seeded.wrongContextLemon._id));
    assert.strictEqual(String(seeded.wrongContextLemon.groupId), String((await MenuOption.findById(seeded.wrongContextLemon._id)).groupId));

    assert.strictEqual((await ProductGroupOption.findById(seeded.obsoleteRelation._id)).isActive, true);

    const chicken65 = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "chicken_65",
    }).lean();
    assert.strictEqual(chicken65.selectionType, "standard_meal");
    assert.strictEqual(chicken65.proteinFamilyKey, "chicken");
    assert.strictEqual(chicken65.displayCategoryKey, "chicken");

    const lentil = await MenuOption.findOne({
      groupId: BASIC_MEAL_CARB_GROUP_ID,
      key: "lentil_rice",
    }).lean();
    assert.strictEqual(lentil.selectionType, "standard_meal");
    assert.strictEqual(lentil.displayCategoryKey, "standard_carbs");

    await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
      skipDraftSync: true,
    });
    assert.strictEqual(
      await MenuOption.countDocuments({
        groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
        key: "lemon_bbq_chicken",
      }),
      1
    );

    console.log("normalizeBasicMealProteinCarbs tests passed");
  } finally {
    await teardown();
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
