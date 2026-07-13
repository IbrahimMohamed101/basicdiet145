process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");

const TEST_DB_NAME = `catalog_validator_consistency_${Date.now()}`;
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

let mongoServer;

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
    instanceOpts: [{
      args: ["--setParameter", "maxTransactionLockRequestTimeoutMillis=20000"],
    }],
  });
  const uri = mongoServer.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

async function seedFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "Custom Order", en: "Custom Order" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const group = await MenuOptionGroup.create({
    key: "proteins",
    name: { ar: "Protein", en: "Protein" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    ui: { displayStyle: "radio_cards" },
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal",
    itemType: "basic_meal",
    name: { ar: "Basic Meal", en: "Basic Meal" },
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
    publishedAt: now,
  });
  const linkedOption = await MenuOption.create({
    groupId: group._id,
    key: "grilled_chicken",
    name: { ar: "Grilled Chicken", en: "Grilled Chicken" },
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
    publishedAt: now,
  });
  const unlinkedOption = await MenuOption.create({
    groupId: group._id,
    key: "orphan_chicken",
    name: { ar: "Orphan Chicken", en: "Orphan Chicken" },
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 20,
    publishedAt: now,
  });

  await ProductOptionGroup.create({
    productId: product._id,
    groupId: group._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
  });
  await ProductGroupOption.create({
    productId: product._id,
    groupId: group._id,
    optionId: linkedOption._id,
    extraPriceHalala: 0,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 10,
  });

  await mealBuilderConfigService.createDraft({
    sections: [{
      key: "standard_protein",
      sectionType: "option_group",
      sourceKind: "visual_family",
      productContextId: String(product._id),
      sourceGroupId: String(group._id),
      selectedOptionIds: [String(linkedOption._id)],
      selectionType: "standard_meal",
      titleOverride: { ar: "Protein", en: "Protein" },
      required: true,
      minSelections: 1,
      maxSelections: 1,
      multiSelect: false,
      visible: true,
      availableFor: ["subscription"],
      sortOrder: 10,
    }],
  });
  await mealBuilderConfigService.publishDraft({});

  return { product, group, linkedOption, unlinkedOption };
}

async function createClientContext() {
  const user = await User.create({ phone: "+966500000991", password: "password" });
  const subscription = await Subscription.create({
    userId: user._id,
    status: "active",
    planId: new mongoose.Types.ObjectId(),
    startDate: "2026-10-01",
    endDate: "2026-10-30",
    totalMeals: 30,
    remainingMeals: 30,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    premiumBalance: [],
  });
  return {
    user,
    subscription,
    auth: { Authorization: `Bearer ${issueAppAccessToken(user._id)}` },
  };
}

function findPublishedFixtureSelection(plannerCatalog, fixture) {
  assertObject(plannerCatalog, "plannerCatalog");
  assert.strictEqual(plannerCatalog.contractVersion, "meal_planner_menu.v3", "plannerCatalog contract version");
  assertArray(plannerCatalog.sections, "plannerCatalog.sections");

  for (const section of plannerCatalog.sections) {
    for (const product of section.products || []) {
      const productId = product.productId || product.id;
      if (String(productId) !== String(fixture.product._id)) continue;
      const group = (product.optionGroups || []).find((candidate) => {
        const groupId = candidate.groupId || candidate.id;
        return String(groupId) === String(fixture.group._id);
      });
      assertObject(group, "catalog product option group");
      const option = (group.options || []).find((candidate) => {
        const optionId = candidate.optionId || candidate.id;
        return String(optionId) === String(fixture.linkedOption._id);
      });
      assertObject(option, "catalog group option");
      return {
        contractVersion: plannerCatalog.contractVersion,
        selectionType: product.selectionType,
        product,
        group,
        option,
      };
    }
  }

  assert.fail("published planner catalog did not expose the fixture product/group/option");
}

function canonicalBody(selection, optionId) {
  return {
    contractVersion: selection.contractVersion,
    mealSlots: [{
      slotIndex: 1,
      selectionType: selection.selectionType,
      productId: selection.product.productId || selection.product.id,
      selectedOptions: [{
        groupId: selection.group.groupId || selection.group.id,
        optionId,
        quantity: 1,
      }],
    }],
  };
}

async function run() {
  assert.strictEqual(process.env.NODE_ENV, "test", "catalog-validator consistency test must run with NODE_ENV=test");
  await connect();
  try {
    const fixture = await seedFixture();
    const { subscription, auth } = await createClientContext();
    const api = request(createApp());
    const date = "2026-10-10";

    let res = await api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
    assert.strictEqual(res.status, 200, `catalog status: ${JSON.stringify(res.body)}`);
    const selection = findPublishedFixtureSelection(res.body.data.plannerCatalog, fixture);
    assert.strictEqual(selection.selectionType, "standard_meal", "catalog selectionType");
    assert.strictEqual(selection.product.productId || selection.product.id, String(fixture.product._id), "catalog product identity");
    assert.strictEqual(selection.group.groupId || selection.group.id, String(fixture.group._id), "catalog group identity");
    assert.strictEqual(selection.option.optionId || selection.option.id, String(fixture.linkedOption._id), "catalog option identity");
    assert(
      !(selection.group.options || []).some((option) => String(option.optionId || option.id) === String(fixture.unlinkedOption._id)),
      "catalog does not expose active options missing the product/group relation"
    );

    const beforeDay = await SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).lean();
    assert.strictEqual(beforeDay, null, "validate fixture starts without a persisted day");

    const positiveBody = canonicalBody(selection, selection.option.optionId || selection.option.id);
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/selection/validate`)
      .set(auth)
      .send(positiveBody);
    assert.strictEqual(res.status, 200, `catalog-derived selection validate status: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.valid, true, "catalog-derived canonical selection is valid");
    assert.strictEqual(res.body.data.plannerState, "draft", "validation remains a draft");
    assertArray(res.body.data.mealSlots, "validated mealSlots");
    const validatedSlot = res.body.data.mealSlots[0];
    assert.strictEqual(validatedSlot.contractVersion, "meal_planner_menu.v3", "validated slot contract version");
    assert.strictEqual(validatedSlot.selectionType, selection.selectionType, "validated slot selectionType");
    assert.strictEqual(validatedSlot.productId, String(fixture.product._id), "validated slot product identity");
    assert.strictEqual(validatedSlot.selectedOptions[0].groupId, String(fixture.group._id), "validated slot group identity");
    assert.strictEqual(validatedSlot.selectedOptions[0].optionId, String(fixture.linkedOption._id), "validated slot option identity");
    assert.notStrictEqual(
      res.body.data.paymentRequirement?.status,
      "pending_payment",
      "validation does not require payment for the zero-fee catalog-derived selection"
    );
    assert.strictEqual(
      await SubscriptionDay.countDocuments({ subscriptionId: subscription._id, date }),
      0,
      "validate endpoint does not persist subscription-day mutations"
    );

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/selection/validate`)
      .set(auth)
      .send(canonicalBody(selection, String(fixture.unlinkedOption._id)));
    assert.strictEqual(res.status, 422, `unlinked option rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(
      res.body.error.code,
      "PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND",
      "unlinked active option is rejected by the existing canonical relation contract"
    );
    assertArray(res.body.error.details.slotErrors, "negative validation slotErrors");
    assert.strictEqual(
      res.body.error.details.slotErrors[0].code,
      "PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND",
      "negative validation keeps the canonical slot error code"
    );

    console.log("catalog/validator consistency checks passed");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    await disconnect();
  } catch (_err) {}
  process.exit(1);
});
