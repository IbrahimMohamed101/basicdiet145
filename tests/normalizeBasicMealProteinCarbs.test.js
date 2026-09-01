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
  CUSTOMER_VISIBLE_CARB_KEYS,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEYS,
  resolveProteinVisualFamilyKey,
} = require("../src/config/mealPlannerContract");
const {
  BASIC_MEAL_PRODUCT_ID,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  BASIC_MEAL_CARB_GROUP_ID,
  FINAL_PROTEINS,
  FINAL_CARBS,
  PRESERVED_PAID_PROTEIN_KEYS,
  runNormalization,
} = require("../scripts/migrations/normalize-basic-meal-protein-carbs");

let mongoServer;

async function createOptionWithRelation({ productId, groupId, option }) {
  const created = await MenuOption.create({
    groupId,
    key: option.key,
    name: option.name || { ar: option.key, en: option.key },
    description: option.description || option.name || { ar: option.key, en: option.key },
    availableFor: ["one_time", "subscription"],
    availableForSubscription: true,
    selectionType: option.selectionType || "standard_meal",
    proteinFamilyKey: option.proteinFamilyKey || "",
    displayCategoryKey: option.displayCategoryKey || "",
    premiumKey: option.premiumKey || "",
    extraPriceHalala: Number(option.extraPriceHalala || 0),
    extraFeeHalala: Number(option.extraFeeHalala ?? option.extraPriceHalala ?? 0),
    isActive: option.isActive !== false,
    isVisible: option.isVisible !== false,
    isAvailable: option.isAvailable !== false,
    sortOrder: Number(option.sortOrder || 0),
    publishedAt: new Date(),
  });
  const relation = await ProductGroupOption.create({
    productId,
    groupId,
    optionId: created._id,
    extraPriceHalala: Number(option.relationExtraPriceHalala ?? option.extraPriceHalala ?? 0),
    isActive: option.relationActive !== false,
    isVisible: option.relationVisible !== false,
    isAvailable: option.relationAvailable !== false,
    sortOrder: Number(option.sortOrder || 0),
  });
  return { option: created, relation };
}

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
    availableFor: ["subscription"],
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

  const proteinRows = [];
  for (const definition of FINAL_PROTEINS) {
    proteinRows.push(await createOptionWithRelation({
      productId,
      groupId: proteinGroupId,
      option: {
        key: definition.key,
        name: { ar: definition.ar, en: definition.en },
        proteinFamilyKey: definition.family,
        displayCategoryKey: definition.family,
        selectionType: "standard_meal",
        sortOrder: definition.order,
        // prove execute can reactivate without rewriting business metadata
        isActive: definition.key !== "chicken_65",
        isVisible: definition.key !== "chicken_65",
        isAvailable: definition.key !== "chicken_65",
        relationActive: definition.key !== "chicken_65",
        relationVisible: definition.key !== "chicken_65",
        relationAvailable: definition.key !== "chicken_65",
      },
    }));
  }

  const carbRows = [];
  for (const definition of FINAL_CARBS) {
    carbRows.push(await createOptionWithRelation({
      productId,
      groupId: carbGroupId,
      option: {
        key: definition.key,
        name: { ar: definition.ar, en: definition.en },
        displayCategoryKey: "standard_carbs",
        selectionType: "standard_meal",
        sortOrder: definition.order,
      },
    }));
  }

  const paidDefinitions = [
    { key: "meatballs", family: "beef", selectionType: "standard_meal", displayCategoryKey: "beef", price: 300 },
    { key: "beef_stroganoff", family: "beef", selectionType: "standard_meal", displayCategoryKey: "beef", price: 450 },
    { key: "beef_steak", family: "beef", selectionType: "premium_meal", displayCategoryKey: "premium", price: 1600 },
    { key: "shrimp", family: "fish", selectionType: "premium_meal", displayCategoryKey: "premium", price: 1600 },
    { key: "salmon", family: "fish", selectionType: "premium_meal", displayCategoryKey: "premium", price: 1600 },
  ];

  const paidRows = [];
  for (const definition of paidDefinitions) {
    paidRows.push(await createOptionWithRelation({
      productId,
      groupId: proteinGroupId,
      option: {
        key: definition.key,
        name: { ar: definition.key, en: definition.key },
        proteinFamilyKey: definition.family,
        displayCategoryKey: definition.displayCategoryKey,
        selectionType: definition.selectionType,
        premiumKey: definition.selectionType === "premium_meal" ? definition.key : "",
        extraPriceHalala: definition.price,
        extraFeeHalala: definition.price,
        relationExtraPriceHalala: definition.price,
        sortOrder: 100 + paidRows.length,
      },
    }));
  }

  const obsolete = await createOptionWithRelation({
    productId,
    groupId: proteinGroupId,
    option: {
      key: "old_protein",
      name: { ar: "بروتين قديم", en: "Old Protein" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      selectionType: "standard_meal",
      sortOrder: 999,
    },
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

  return { proteinRows, carbRows, paidRows, obsolete, wrongContextLemon };
}

async function teardown() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function runTests() {
  const seeded = await setup();

  try {
    assert.deepStrictEqual(CUSTOMER_VISIBLE_CARB_KEYS, FINAL_CARBS.map((row) => row.key));
    for (const definition of FINAL_PROTEINS) {
      assert(
        STANDARD_MEAL_EXTENDED_PROTEIN_KEYS.includes(definition.key),
        `missing canonical picker protein key ${definition.key}`
      );
      assert.strictEqual(
        resolveProteinVisualFamilyKey({
          key: definition.key,
          proteinFamilyKey: definition.family,
          displayCategoryKey: definition.family,
          selectionType: "standard_meal",
        }),
        definition.family
      );
    }
    for (const key of PRESERVED_PAID_PROTEIN_KEYS) {
      assert(STANDARD_MEAL_EXTENDED_PROTEIN_KEYS.includes(key), `missing preserved paid key ${key}`);
    }

    const dryRun = await runNormalization({
      argv: ["--dry-run"],
      closeConnection: false,
      skipDraftSync: true,
    });
    assert.strictEqual(dryRun.mode, "dry_run");
    assert.strictEqual(dryRun.finalMenu.regularProteins.length, 13);
    assert.strictEqual(dryRun.finalMenu.carbs.length, 9);
    assert.strictEqual(dryRun.finalMenu.preservedPaidProteins.length, 5);
    assert.deepStrictEqual(dryRun.safety, {
      createdOptions: 0,
      createdRelations: 0,
      deletedRecords: 0,
      historicalRewrites: 0,
      groupMerges: 0,
      premiumConfigChanges: 0,
      paidProteinPricingMetadataChanges: 0,
      basicSaladChanges: 0,
      premiumLargeSaladChanges: 0,
      wrongContextMoves: 0,
    });

    const chicken65Before = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "chicken_65",
    }).lean();
    assert.strictEqual(chicken65Before.isActive, false, "dry-run must not mutate approved option state");
    assert.strictEqual((await ProductGroupOption.findById(seeded.obsolete.relation._id)).isActive, true);

    const paidBefore = await Promise.all(seeded.paidRows.map(async ({ option, relation }) => ({
      id: String(option._id),
      key: option.key,
      optionPrice: option.extraPriceHalala,
      optionFee: option.extraFeeHalala,
      relationPrice: relation.extraPriceHalala,
      selectionType: option.selectionType,
      displayCategoryKey: option.displayCategoryKey,
      premiumKey: option.premiumKey,
    }))));

    const execute = await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
      skipDraftSync: true,
    });
    assert.strictEqual(execute.mode, "execute_prepare_only");

    const chicken65After = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "chicken_65",
    }).lean();
    const chicken65Relation = await ProductGroupOption.findOne({
      productId: BASIC_MEAL_PRODUCT_ID,
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      optionId: chicken65After._id,
    }).lean();
    assert.strictEqual(chicken65After.isActive, true);
    assert.strictEqual(chicken65After.isVisible, true);
    assert.strictEqual(chicken65After.isAvailable, true);
    assert.strictEqual(chicken65Relation.isActive, true);
    assert.strictEqual(chicken65Relation.isVisible, true);
    assert.strictEqual(chicken65Relation.isAvailable, true);

    const paidAfter = await Promise.all(seeded.paidRows.map(async ({ option, relation }) => {
      const freshOption = await MenuOption.findById(option._id).lean();
      const freshRelation = await ProductGroupOption.findById(relation._id).lean();
      return {
        id: String(freshOption._id),
        key: freshOption.key,
        optionPrice: freshOption.extraPriceHalala,
        optionFee: freshOption.extraFeeHalala,
        relationPrice: freshRelation.extraPriceHalala,
        selectionType: freshOption.selectionType,
        displayCategoryKey: freshOption.displayCategoryKey,
        premiumKey: freshOption.premiumKey,
      };
    }));
    assert.deepStrictEqual(paidAfter, paidBefore, "paid protein pricing/metadata must remain unchanged");

    // Fail closed: deleting the canonical approved item must never cause the script
    // to steal/move the same key from another context or auto-create a replacement.
    const canonicalLemon = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "lemon_bbq_chicken",
    }).lean();
    await ProductGroupOption.deleteOne({ optionId: canonicalLemon._id });
    await MenuOption.deleteOne({ _id: canonicalLemon._id });

    let missingError = null;
    try {
      await runNormalization({
        argv: ["--execute"],
        closeConnection: false,
        skipDraftSync: true,
      });
    } catch (error) {
      missingError = error;
    }
    assert(missingError, "missing canonical approved option must block execute");
    assert.match(missingError.message, /Approved option missing from canonical group: lemon_bbq_chicken/);
    assert.strictEqual(
      await MenuOption.countDocuments({
        groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
        key: "lemon_bbq_chicken",
      }),
      0,
      "migration must not auto-create missing approved options"
    );
    const wrongContextAfter = await MenuOption.findById(seeded.wrongContextLemon._id).lean();
    assert(wrongContextAfter, "wrong-context option must remain untouched");
    assert.strictEqual(String(wrongContextAfter.groupId), String(seeded.wrongContextLemon.groupId));

    console.log("normalizeBasicMealProteinCarbs tests passed");
  } finally {
    await teardown();
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});