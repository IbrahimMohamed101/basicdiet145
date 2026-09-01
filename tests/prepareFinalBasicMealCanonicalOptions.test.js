"use strict";

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
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const {
  BASIC_MEAL_PRODUCT_ID,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  BASIC_MEAL_CARB_GROUP_ID,
  EXECUTE_CONFIRMATION,
  CARBS,
  runPreparation,
} = require("../scripts/migrations/prepare-final-basic-meal-canonical-options");

let mongoServer;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function databaseFingerprint() {
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const snapshot = {};
  for (const name of collections.map((row) => row.name).sort()) {
    snapshot[name] = await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(snapshot);
}

async function documentsFingerprint(Model, query = {}) {
  return JSON.stringify(await Model.find(query).sort({ _id: 1 }).lean());
}

function executeArgs() {
  return [
    "--execute",
    `--confirm-live-basic-meal-data=${EXECUTE_CONFIRMATION}`,
    `--confirm-product=${BASIC_MEAL_PRODUCT_ID}`,
    `--confirm-protein-group=${BASIC_MEAL_PROTEIN_GROUP_ID}`,
    `--confirm-carb-group=${BASIC_MEAL_CARB_GROUP_ID}`,
  ];
}

async function createOption(payload) {
  return MenuOption.create({
    name: { ar: payload.key, en: payload.key },
    description: { ar: `وصف ${payload.key}`, en: `${payload.key} description` },
    imageUrl: `https://example.test/${payload.key}.jpg`,
    nutrition: { calories: 123, proteinGrams: 4, carbGrams: 20, fatGrams: 3 },
    extraPriceHalala: 0,
    extraFeeHalala: 0,
    availableFor: ["one_time", "subscription"],
    availableForSubscription: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...payload,
  });
}

async function createRelation({ productId, groupId, optionId, sortOrder = 0, extraPriceHalala = 0 }) {
  return ProductGroupOption.create({
    productId,
    groupId,
    optionId,
    sortOrder,
    extraPriceHalala,
    extraWeightUnitGrams: 0,
    extraWeightPriceHalala: 0,
    isActive: true,
    isVisible: true,
    isAvailable: true,
  });
}

async function setup() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongoServer.getUri());

  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const basicMeal = await MenuProduct.create({
    _id: BASIC_MEAL_PRODUCT_ID,
    categoryId: category._id,
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    priceHalala: 1900,
    pricingModel: "per_100g",
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
  const basicSalad = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_salad_test",
    name: { ar: "سلطة بيسك", en: "Basic Salad" },
    priceHalala: 2500,
    pricingModel: "fixed",
    isCustomizable: true,
    publishedAt: new Date(),
  });
  const premiumLargeSalad = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_large_salad_test",
    name: { ar: "سلطة كبيرة", en: "Premium Large Salad" },
    priceHalala: 2900,
    pricingModel: "fixed",
    isCustomizable: true,
    publishedAt: new Date(),
  });

  const [proteinGroup, carbGroup, wrongGroup, saladProteinGroup] = await MenuOptionGroup.create([
    {
      _id: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "proteins",
      name: { ar: "البروتين", en: "Proteins" },
      publishedAt: new Date(),
    },
    {
      _id: BASIC_MEAL_CARB_GROUP_ID,
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      publishedAt: new Date(),
    },
    {
      key: "protein",
      name: { ar: "سياق بروتين آخر", en: "Other Protein Context" },
      publishedAt: new Date(),
    },
    {
      key: "salad_proteins",
      name: { ar: "بروتينات السلطة", en: "Salad Proteins" },
      publishedAt: new Date(),
    },
  ]);

  await ProductOptionGroup.create([
    { productId: basicMeal._id, groupId: proteinGroup._id, isRequired: true, minSelections: 1, maxSelections: 1 },
    { productId: basicMeal._id, groupId: carbGroup._id, isRequired: true, minSelections: 1, maxSelections: 2 },
    { productId: basicSalad._id, groupId: saladProteinGroup._id, isRequired: false, minSelections: 0, maxSelections: 2 },
    { productId: premiumLargeSalad._id, groupId: wrongGroup._id, isRequired: true, minSelections: 1, maxSelections: 1 },
  ]);

  const grilledChicken = await createOption({
    _id: "6a62197b79ee075a57f70128",
    groupId: proteinGroup._id,
    key: "grilled_chicken",
    selectionType: "standard_meal",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    sortOrder: 4,
  });
  await createRelation({ productId: basicMeal._id, groupId: proteinGroup._id, optionId: grilledChicken._id, sortOrder: 4 });

  const bbqChicken = await createOption({
    groupId: proteinGroup._id,
    key: "bbq_chicken",
    selectionType: "standard_meal",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    sortOrder: 13,
  });
  const lemonChicken = await createOption({
    groupId: proteinGroup._id,
    key: "lemon_chicken",
    selectionType: "standard_meal",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    sortOrder: 14,
  });
  await createRelation({ productId: basicMeal._id, groupId: proteinGroup._id, optionId: bbqChicken._id, sortOrder: 13 });
  await createRelation({ productId: basicMeal._id, groupId: proteinGroup._id, optionId: lemonChicken._id, sortOrder: 14 });

  const wrongContextLemon = await createOption({
    groupId: wrongGroup._id,
    key: "lemon_bbq_chicken",
    selectionType: "premium_large_salad",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    sortOrder: 7,
  });
  await createRelation({
    productId: premiumLargeSalad._id,
    groupId: wrongGroup._id,
    optionId: wrongContextLemon._id,
    sortOrder: 7,
  });

  const carbRows = [];
  for (const definition of CARBS) {
    carbRows.push(await createOption({
      _id: definition.id,
      groupId: carbGroup._id,
      key: definition.key,
      name: { ar: `الاسم ${definition.key}`, en: `Name ${definition.key}` },
      description: { ar: `الوصف ${definition.key}`, en: `Description ${definition.key}` },
      imageUrl: `https://example.test/preserved-${definition.key}.jpg`,
      nutrition: { calories: 200 + definition.sortOrder, proteinGrams: 5, carbGrams: 33, fatGrams: 2 },
      availableFor: ["one_time"],
      availableForSubscription: false,
      selectionType: "",
      displayCategoryKey: "",
      premiumKey: "",
      isActive: false,
      isVisible: false,
      isAvailable: false,
      publishedAt: null,
      sortOrder: 50 + definition.sortOrder,
    }));
  }

  const meatballs = await createOption({
    groupId: saladProteinGroup._id,
    key: "meatballs",
    selectionType: "premium_large_salad",
    proteinFamilyKey: "beef",
    displayCategoryKey: "beef",
    extraPriceHalala: 300,
    extraFeeHalala: 300,
  });
  await createRelation({
    productId: basicSalad._id,
    groupId: saladProteinGroup._id,
    optionId: meatballs._id,
    extraPriceHalala: 300,
  });

  const beefSteak = await createOption({
    groupId: proteinGroup._id,
    key: "beef_steak",
    selectionType: "premium_meal",
    proteinFamilyKey: "beef",
    displayCategoryKey: "premium",
    premiumKey: "beef_steak",
    extraPriceHalala: 2000,
    extraFeeHalala: 2000,
  });
  await createRelation({
    productId: basicMeal._id,
    groupId: proteinGroup._id,
    optionId: beefSteak._id,
    extraPriceHalala: 2000,
  });
  const premiumConfig = await PremiumUpgradeConfig.create({
    sourceType: "menu_option",
    sourceId: beefSteak._id,
    sourceProductId: basicMeal._id,
    sourceGroupId: proteinGroup._id,
    selectionType: "premium_meal",
    premiumKey: "beef_steak",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 2000,
    isEnabled: true,
    isVisible: true,
    status: "active",
    metadata: { preserve: true },
    revision: 9,
  });

  await mongoose.connection.db.collection("subscriptiondays").insertOne({
    marker: "historical-selection",
    groupId: proteinGroup._id,
    optionId: lemonChicken._id,
  });
  await mongoose.connection.db.collection("orders").insertOne({ marker: "historical-order" });

  return {
    basicMeal,
    proteinGroup,
    carbGroup,
    wrongGroup,
    saladProteinGroup,
    bbqChicken,
    lemonChicken,
    wrongContextLemon,
    carbRows,
    meatballs,
    beefSteak,
    premiumConfig,
  };
}

async function run() {
  const seeded = await setup();
  try {
    await assert.rejects(
      () => runPreparation({ argv: ["--execute"], closeConnection: false }),
      /confirm-live-basic-meal-data/
    );

    const beforeDryRun = await databaseFingerprint();
    const dryRun = await runPreparation({ argv: [], closeConnection: false });
    assert.strictEqual(dryRun.mode, "dry_run");
    assert.deepStrictEqual(dryRun.target, {
      host: `${mongoose.connection.host}:${mongoose.connection.port}`,
      database: mongoose.connection.name,
    });
    assert(!JSON.stringify(dryRun.target).includes("@"), "target output must not contain credentials");
    assert.strictEqual(dryRun.plan.lemonBbqChicken.currentState, "missing");
    assert.strictEqual(dryRun.plan.lemonBbqChicken.optionAction, "create_canonical_menu_option");
    assert.strictEqual(dryRun.plan.lemonBbqChicken.relationAction, "create_basic_meal_relation");
    assert.deepStrictEqual(dryRun.plan.creates, { MenuOption: 1, ProductGroupOption: 5 });
    assert.deepStrictEqual(dryRun.plan.updates, { MenuOption: 4, ProductGroupOption: 0 });
    assert.strictEqual(await databaseFingerprint(), beforeDryRun, "default dry-run must perform zero writes");

    const optionCountBefore = await MenuOption.countDocuments({});
    const relationCountBefore = await ProductGroupOption.countDocuments({});
    const legacyBefore = await documentsFingerprint(MenuOption, {
      _id: { $in: [seeded.bbqChicken._id, seeded.lemonChicken._id, seeded.wrongContextLemon._id] },
    });
    const premiumBefore = await documentsFingerprint(PremiumUpgradeConfig);
    const paidBefore = await documentsFingerprint(MenuOption, { _id: { $in: [seeded.meatballs._id, seeded.beefSteak._id] } });
    const saladRelationsBefore = await documentsFingerprint(ProductGroupOption, {
      $or: [
        { groupId: seeded.saladProteinGroup._id },
        { productId: seeded.basicMeal._id, optionId: seeded.beefSteak._id },
        { productId: { $ne: seeded.basicMeal._id }, optionId: seeded.wrongContextLemon._id },
      ],
    });
    const productOwnershipBefore = await documentsFingerprint(ProductOptionGroup);
    const historicalBefore = JSON.stringify({
      days: await mongoose.connection.db.collection("subscriptiondays").find({}).sort({ _id: 1 }).toArray(),
      orders: await mongoose.connection.db.collection("orders").find({}).sort({ _id: 1 }).toArray(),
    });
    const preservedCarbFields = new Map(seeded.carbRows.map((row) => [String(row._id), plain({
      description: row.description,
      imageUrl: row.imageUrl,
      nutrition: row.nutrition,
      extraPriceHalala: row.extraPriceHalala,
      extraFeeHalala: row.extraFeeHalala,
    })]));

    const executed = await runPreparation({ argv: executeArgs(), closeConnection: false });
    assert.strictEqual(executed.mode, "execute");
    assert.strictEqual(executed.verification.converged, true);
    assert(mongoose.isValidObjectId(executed.verification.lemonBbqChickenId));
    assert.strictEqual(await MenuOption.countDocuments({}), optionCountBefore + 1);
    assert.strictEqual(await ProductGroupOption.countDocuments({}), relationCountBefore + 5);

    const canonicalLemons = await MenuOption.find({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: "lemon_bbq_chicken",
    }).lean();
    assert.strictEqual(canonicalLemons.length, 1);
    const [canonicalLemon] = canonicalLemons;
    assert.strictEqual(String(canonicalLemon._id), executed.verification.lemonBbqChickenId);
    assert.notStrictEqual(String(canonicalLemon._id), String(seeded.bbqChicken._id));
    assert.notStrictEqual(String(canonicalLemon._id), String(seeded.lemonChicken._id));
    assert.notStrictEqual(String(canonicalLemon._id), String(seeded.wrongContextLemon._id));
    assert.deepStrictEqual(plain(canonicalLemon.name), { ar: "دجاج ليمون باربكيو", en: "Lemon BBQ Chicken" });
    assert.strictEqual(canonicalLemon.selectionType, "standard_meal");
    assert.strictEqual(canonicalLemon.proteinFamilyKey, "chicken");
    assert.strictEqual(canonicalLemon.displayCategoryKey, "chicken");
    assert.strictEqual(canonicalLemon.premiumKey, "");
    assert.deepStrictEqual(canonicalLemon.availableFor, ["one_time", "subscription"]);
    assert(canonicalLemon.publishedAt);
    assert.strictEqual(canonicalLemon.sortOrder, 7);
    assert.strictEqual(await ProductGroupOption.countDocuments({
      productId: BASIC_MEAL_PRODUCT_ID,
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      optionId: canonicalLemon._id,
    }), 1);

    for (const definition of CARBS) {
      const option = await MenuOption.findById(definition.id).lean();
      assert(option, definition.key);
      assert.strictEqual(String(option._id), definition.id);
      assert.strictEqual(String(option.groupId), BASIC_MEAL_CARB_GROUP_ID);
      assert.strictEqual(option.key, definition.key);
      assert.strictEqual(option.selectionType, "standard_meal");
      assert.strictEqual(option.displayCategoryKey, "standard_carbs");
      assert.strictEqual(option.availableForSubscription, true);
      assert.deepStrictEqual(option.availableFor, ["one_time", "subscription"]);
      assert.strictEqual(option.isActive, true);
      assert.strictEqual(option.isVisible, true);
      assert.strictEqual(option.isAvailable, true);
      assert.strictEqual(option.sortOrder, definition.sortOrder);
      assert(option.publishedAt);
      assert.deepStrictEqual(plain({
        description: option.description,
        imageUrl: option.imageUrl,
        nutrition: option.nutrition,
        extraPriceHalala: option.extraPriceHalala,
        extraFeeHalala: option.extraFeeHalala,
      }), preservedCarbFields.get(definition.id));
      assert.strictEqual(await MenuOption.countDocuments({ key: definition.key }), 1);
      const relations = await ProductGroupOption.find({
        productId: BASIC_MEAL_PRODUCT_ID,
        groupId: BASIC_MEAL_CARB_GROUP_ID,
        optionId: definition.id,
      }).lean();
      assert.strictEqual(relations.length, 1);
      assert.strictEqual(relations[0].sortOrder, definition.sortOrder);
      assert.strictEqual(relations[0].extraPriceHalala, 0);
    }

    assert.strictEqual(await documentsFingerprint(MenuOption, {
      _id: { $in: [seeded.bbqChicken._id, seeded.lemonChicken._id, seeded.wrongContextLemon._id] },
    }), legacyBefore, "bbq_chicken, lemon_chicken, and wrong-context lemon must remain untouched");
    assert.strictEqual(await documentsFingerprint(PremiumUpgradeConfig), premiumBefore);
    assert.strictEqual(await documentsFingerprint(MenuOption, { _id: { $in: [seeded.meatballs._id, seeded.beefSteak._id] } }), paidBefore);
    assert.strictEqual(await documentsFingerprint(ProductGroupOption, {
      $or: [
        { groupId: seeded.saladProteinGroup._id },
        { productId: seeded.basicMeal._id, optionId: seeded.beefSteak._id },
        { productId: { $ne: seeded.basicMeal._id }, optionId: seeded.wrongContextLemon._id },
      ],
    }), saladRelationsBefore);
    assert.strictEqual(await documentsFingerprint(ProductOptionGroup), productOwnershipBefore);
    assert.strictEqual(JSON.stringify({
      days: await mongoose.connection.db.collection("subscriptiondays").find({}).sort({ _id: 1 }).toArray(),
      orders: await mongoose.connection.db.collection("orders").find({}).sort({ _id: 1 }).toArray(),
    }), historicalBefore, "historical selections and orders must remain unchanged");

    const beforeSecondExecute = await databaseFingerprint();
    const second = await runPreparation({ argv: executeArgs(), closeConnection: false });
    assert.deepStrictEqual(second.plan.creates, { MenuOption: 0, ProductGroupOption: 0 });
    assert.deepStrictEqual(second.plan.updates, { MenuOption: 0, ProductGroupOption: 0 });
    assert.strictEqual(await databaseFingerprint(), beforeSecondExecute, "second execute must be an exact no-op");

    const mismatch = CARBS[0];
    await MenuOption.updateOne({ _id: mismatch.id }, { $set: { key: "wrong_lentil_key" } });
    const beforeMismatch = await databaseFingerprint();
    await assert.rejects(
      () => runPreparation({ argv: [], closeConnection: false }),
      /Canonical carb identity mismatch/
    );
    assert.strictEqual(await databaseFingerprint(), beforeMismatch, "identity mismatch must fail before writes");
    await MenuOption.updateOne({ _id: mismatch.id }, { $set: { key: mismatch.key } });

    const wrongGroupCarb = CARBS[1];
    await MenuOption.updateOne({ _id: wrongGroupCarb.id }, { $set: { groupId: seeded.wrongGroup._id } });
    const beforeWrongGroup = await databaseFingerprint();
    await assert.rejects(
      () => runPreparation({ argv: [], closeConnection: false }),
      /Canonical carb identity mismatch/
    );
    assert.strictEqual(await databaseFingerprint(), beforeWrongGroup, "wrong group must fail before writes");
    await MenuOption.updateOne({ _id: wrongGroupCarb.id }, { $set: { groupId: BASIC_MEAL_CARB_GROUP_ID } });

    const missingCarb = CARBS[2];
    await MenuOption.deleteOne({ _id: missingCarb.id });
    const beforeMissing = await databaseFingerprint();
    await assert.rejects(
      () => runPreparation({ argv: [], closeConnection: false }),
      /Required canonical carb is missing/
    );
    assert.strictEqual(await databaseFingerprint(), beforeMissing, "missing exact carb must fail before writes");

    console.log("prepare final Basic Meal canonical options checks passed");
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
