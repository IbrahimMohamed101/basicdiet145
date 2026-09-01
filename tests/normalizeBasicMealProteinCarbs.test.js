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
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
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
  deactivateNonApprovedAfterPublish,
  runNormalization,
} = require("../scripts/migrations/normalize-basic-meal-protein-carbs");

let mongoServer;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function databaseFingerprint() {
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const snapshot = {};
  for (const { name } of collections.map((row) => row.name).sort().map((name) => ({ name }))) {
    snapshot[name] = await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(snapshot);
}

async function collectionsFingerprint(names) {
  const snapshot = {};
  for (const name of [...names].sort()) {
    snapshot[name] = await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(snapshot);
}

async function configSectionsByKey(configId, keys) {
  const config = await MealBuilderConfig.findById(configId).lean();
  return plain((config.sections || [])
    .filter((section) => keys.includes(section.key))
    .map((section) => {
      const copy = plain(section);
      return copy;
    }));
}

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

  const sharedLegacy = await createOptionWithRelation({
    productId,
    groupId: proteinGroupId,
    option: {
      key: "shared_old_protein",
      name: { ar: "بروتين مشترك قديم", en: "Shared Old Protein" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      selectionType: "standard_meal",
      sortOrder: 998,
    },
  });
  const otherProductId = new mongoose.Types.ObjectId();
  const sharedOtherRelation = await ProductGroupOption.create({
    productId: otherProductId,
    groupId: proteinGroupId,
    optionId: sharedLegacy.option._id,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });

  const quarantinedSpicy = await MenuOption.create({
    _id: new mongoose.Types.ObjectId("6a7a0a293fe0240a4bf6cedd"),
    groupId: wrongGroup._id,
    key: "spicy_chicken",
    name: { ar: "دجاج حار محجور", en: "Quarantined Spicy Chicken" },
  });

  const beefSteak = paidRows.find(({ option }) => option.key === "beef_steak").option;
  const premiumConfig = await PremiumUpgradeConfig.create({
    sourceType: "menu_option",
    sourceId: beefSteak._id,
    sourceProductId: productId,
    sourceGroupId: proteinGroupId,
    selectionType: "premium_meal",
    premiumKey: "beef_steak",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 1600,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 10,
    metadata: { balanceKey: "premium_meal", preserve: true },
    sourceSnapshot: {
      key: "beef_steak",
      name: { ar: "ستيك", en: "Beef Steak" },
      context: { groupKey: "proteins" },
    },
    revision: 7,
  });

  const targetSection = (key, selectedOptionIds, sortOrder) => ({
    key,
    sectionType: "option_group",
    sourceKind: "visual_family",
    productContextId: productId,
    sourceGroupId: key === "carbs" ? carbGroupId : proteinGroupId,
    selectedOptionIds,
    includeMode: "selected",
    selectionType: "standard_meal",
    sortOrder,
    visible: true,
    metadata: key === "carbs"
      ? { visualRole: "carbs" }
      : { visualRole: "protein_family", proteinFamilyKey: key },
    rules: { preserve: key },
  });
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    notes: "existing draft",
    sections: [
      targetSection("chicken", [proteinRows[0].option._id], 10),
      targetSection("beef", [proteinRows[1].option._id], 20),
      targetSection("fish", [proteinRows[2].option._id], 30),
      targetSection("carbs", [carbRows[0].option._id], 40),
      {
        key: "basic_salad",
        sectionType: "option_group",
        sourceKind: "configurable_product",
        productContextId: otherProductId,
        sourceGroupId: wrongGroup._id,
        selectedOptionIds: [wrongContextLemon._id],
        selectionType: "standard_meal",
        sortOrder: 50,
        metadata: { preserve: "basic_salad" },
        rules: { maxSelections: 1 },
      },
      {
        key: "premium_large_salad",
        sectionType: "option_group",
        sourceKind: "configurable_product",
        productContextId: otherProductId,
        sourceGroupId: wrongGroup._id,
        selectedOptionIds: [quarantinedSpicy._id],
        selectionType: "premium_large_salad",
        sortOrder: 60,
        metadata: { preserve: "premium_large_salad" },
        rules: { fixedPriceHalala: 2900 },
      },
      {
        key: "premium",
        sectionType: "option_group",
        sourceKind: "premium_visual",
        productContextId: productId,
        sourceGroupId: proteinGroupId,
        selectedOptionIds: [beefSteak._id],
        selectionType: "premium_meal",
        sortOrder: 70,
        metadata: { preserve: "premium" },
        rules: { balanceKey: "premium_meal" },
      },
    ],
  });

  const historicalOptionId = obsolete.option._id;
  const historicalGroupId = obsolete.option.groupId;
  await mongoose.connection.collection("subscriptiondays").insertOne({
    _id: new mongoose.Types.ObjectId(),
    date: "2026-08-31",
    historicalSelection: { optionId: historicalOptionId, groupId: historicalGroupId, key: "old_protein" },
  });
  await mongoose.connection.collection("orders").insertOne({
    _id: new mongoose.Types.ObjectId(),
    snapshot: { optionId: historicalOptionId, groupId: historicalGroupId, key: "old_protein" },
  });
  await mongoose.connection.collection("menuversions").insertOne({
    _id: new mongoose.Types.ObjectId(),
    snapshot: { optionId: historicalOptionId, groupId: historicalGroupId, key: "old_protein" },
  });
  await mongoose.connection.collection("activitylogs").insertOne({
    _id: new mongoose.Types.ObjectId(),
    entityType: "menu_option",
    entityId: historicalOptionId,
    action: "historical_selection",
    meta: { groupId: historicalGroupId, key: "old_protein" },
  });

  return {
    proteinRows,
    carbRows,
    paidRows,
    obsolete,
    sharedLegacy,
    sharedOtherRelation,
    wrongContextLemon,
    quarantinedSpicy,
    premiumConfig,
    draft,
  };
}

async function teardown() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function runTests() {
  const seeded = await setup();

  try {
    const expectedProteinKeys = FINAL_PROTEINS.map((row) => row.key);
    const expectedCarbKeys = FINAL_CARBS.map((row) => row.key);
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

    const dryRunDatabaseBefore = await databaseFingerprint();
    const dryRun = await runNormalization({
      argv: ["--dry-run"],
      closeConnection: false,
    });
    assert.strictEqual(await databaseFingerprint(), dryRunDatabaseBefore, "dry-run must perform zero writes");
    assert.strictEqual(dryRun.mode, "dry_run");
    assert.strictEqual(dryRun.finalMenu.regularProteins.length, 13);
    assert.strictEqual(dryRun.finalMenu.carbs.length, 9);
    assert.strictEqual(dryRun.finalMenu.preservedPaidProteins.length, 5);
    assert.deepStrictEqual(dryRun.finalMenu.regularProteins.map((row) => row.key), expectedProteinKeys);
    assert.deepStrictEqual(dryRun.finalMenu.carbs.map((row) => row.key), expectedCarbKeys);
    assert.deepStrictEqual(
      dryRun.finalMenu.preservedPaidProteins.map((row) => row.key),
      PRESERVED_PAID_PROTEIN_KEYS
    );
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
      option: plain(await MenuOption.findById(option._id).lean()),
      relation: plain(await ProductGroupOption.findById(relation._id).lean()),
    })));
    const premiumConfigBefore = plain(await PremiumUpgradeConfig.findById(seeded.premiumConfig._id).lean());
    const protectedSectionsBefore = await configSectionsByKey(
      seeded.draft._id,
      ["basic_salad", "premium_large_salad", "premium"]
    );
    const historicalBefore = await collectionsFingerprint([
      "activitylogs",
      "menuversions",
      "orders",
      "subscriptiondays",
    ]);
    const optionCountBefore = await MenuOption.countDocuments({});
    const relationCountBefore = await ProductGroupOption.countDocuments({});

    const execute = await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
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

    const paidAfter = await Promise.all(seeded.paidRows.map(async ({ option, relation }) => ({
      option: plain(await MenuOption.findById(option._id).lean()),
      relation: plain(await ProductGroupOption.findById(relation._id).lean()),
    })));
    assert.deepStrictEqual(paidAfter, paidBefore, "paid protein pricing/metadata must remain unchanged");
    assert.deepStrictEqual(
      plain(await PremiumUpgradeConfig.findById(seeded.premiumConfig._id).lean()),
      premiumConfigBefore,
      "PremiumUpgradeConfig must remain byte-for-byte equivalent"
    );
    assert.deepStrictEqual(
      await configSectionsByKey(seeded.draft._id, ["basic_salad", "premium_large_salad", "premium"]),
      protectedSectionsBefore,
      "Basic Salad, Premium Large Salad, and premium sections must not mutate"
    );

    const regularProteinRows = seeded.proteinRows.map(({ option, relation }) => ({
      key: option.key,
      id: String(option._id),
      relation,
    }));
    const carbRows = seeded.carbRows.map(({ option, relation }) => ({
      key: option.key,
      id: String(option._id),
      relation,
    }));
    const paidRows = seeded.paidRows.map(({ option, relation }) => ({
      key: option.key,
      id: String(option._id),
      relation,
    }));
    const deactivationPlans = await deactivateNonApprovedAfterPublish({
      execute: true,
      regularProteinRows,
      carbRows,
      paidRows,
    });
    assert.deepStrictEqual(
      deactivationPlans.map((row) => row.key).sort(),
      ["old_protein", "shared_old_protein"],
      "only disallowed Basic Meal relations should be deactivated"
    );
    const obsoleteOptionAfter = await MenuOption.findById(seeded.obsolete.option._id).lean();
    const obsoleteRelationAfter = await ProductGroupOption.findById(seeded.obsolete.relation._id).lean();
    assert(obsoleteOptionAfter, "old disallowed option must not be deleted");
    assert.strictEqual(obsoleteOptionAfter.isActive, false, "unshared old option document may be disabled");
    assert.strictEqual(obsoleteRelationAfter.isActive, false, "old Basic Meal relation must be disabled");

    const sharedOptionAfter = await MenuOption.findById(seeded.sharedLegacy.option._id).lean();
    const sharedBasicRelationAfter = await ProductGroupOption.findById(seeded.sharedLegacy.relation._id).lean();
    const sharedOtherRelationAfter = await ProductGroupOption.findById(seeded.sharedOtherRelation._id).lean();
    assert.strictEqual(sharedBasicRelationAfter.isActive, false, "shared option's Basic Meal relation must be disabled");
    assert.strictEqual(sharedOptionAfter.isActive, true, "shared option document must remain active for another context");
    assert.strictEqual(sharedOtherRelationAfter.isActive, true, "other active context relation must remain active");

    assert.strictEqual(await MenuOption.countDocuments({}), optionCountBefore, "migration must not create/delete options");
    assert.strictEqual(await ProductGroupOption.countDocuments({}), relationCountBefore, "migration must not create/delete relations");
    assert.strictEqual(
      await collectionsFingerprint(["activitylogs", "menuversions", "orders", "subscriptiondays"]),
      historicalBefore,
      "historical records and identifiers must not be rewritten"
    );
    const quarantinedAfter = await MenuOption.findById("6a7a0a293fe0240a4bf6cedd").lean();
    assert(quarantinedAfter, "known spicy_chicken quarantine record must be preserved");
    assert.strictEqual(String(quarantinedAfter.groupId), String(seeded.quarantinedSpicy.groupId));

    const firstExecutionFingerprint = await databaseFingerprint();
    const secondExecution = await runNormalization({
      argv: ["--execute"],
      closeConnection: false,
    });
    assert.strictEqual(secondExecution.mode, "execute_prepare_only");
    assert.deepStrictEqual(secondExecution.deactivationPlans, [], "second execution must report no remaining changes");
    assert.strictEqual(
      await databaseFingerprint(),
      firstExecutionFingerprint,
      "second execution must be idempotent and perform no additional writes"
    );

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

    const menuOptionIndexes = await MenuOption.collection.indexes();
    const uniqueGroupKeyIndex = menuOptionIndexes.find((index) => (
      index.unique === true && index.key?.groupId === 1 && index.key?.key === 1
    ));
    assert(uniqueGroupKeyIndex, "test fixture requires the canonical group/key unique index");
    await MenuOption.collection.dropIndex(uniqueGroupKeyIndex.name);
    const canonicalKofta = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "kofta",
    }).lean();
    const duplicateKofta = plain(canonicalKofta);
    duplicateKofta._id = new mongoose.Types.ObjectId();
    duplicateKofta.groupId = new mongoose.Types.ObjectId(String(canonicalKofta.groupId));
    duplicateKofta.createdAt = new Date();
    duplicateKofta.updatedAt = new Date();
    await MenuOption.collection.insertOne(duplicateKofta);

    let ambiguousError = null;
    try {
      await runNormalization({
        argv: ["--dry-run"],
        closeConnection: false,
        skipDraftSync: true,
      });
    } catch (error) {
      ambiguousError = error;
    }
    assert(ambiguousError, "ambiguous canonical option must block even dry-run");
    assert.match(ambiguousError.message, /Approved option is ambiguous in canonical group: kofta/);

    console.log("normalizeBasicMealProteinCarbs tests passed");
  } finally {
    await teardown();
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
