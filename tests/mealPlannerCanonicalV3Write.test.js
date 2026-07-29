require("./helpers/temporaryEnvironment").setTemporaryEnvironment({
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "false",
});

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

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const TEST_DB_NAME = `meal_planner_v3_write_${Date.now()}`;

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

async function seedCanonicalPlannerFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Custom Order" },
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { ar: "بروتين", en: "Protein" },
    publishedAt: now,
    ui: { displayStyle: "radio_cards" },
  });
  const carbsGroup = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "كارب", en: "Carbs" },
    publishedAt: now,
    ui: { displayStyle: "checkbox_grid" },
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal",
    itemType: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const chicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "grilled_chicken",
    name: { ar: "دجاج مشوي", en: "Grilled Chicken" },
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const rice = await MenuOption.create({
    groupId: carbsGroup._id,
    key: "white_rice",
    name: { ar: "رز ابيض", en: "White Rice" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: proteinsGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    sortOrder: 10,
  });
  await ProductOptionGroup.create({
    productId: product._id,
    groupId: carbsGroup._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
    sortOrder: 20,
  });
  const proteinRelation = await ProductGroupOption.create({
    productId: product._id,
    groupId: proteinsGroup._id,
    optionId: chicken._id,
    extraPriceHalala: 0,
    sortOrder: 10,
  });
  const carbRelation = await ProductGroupOption.create({
    productId: product._id,
    groupId: carbsGroup._id,
    optionId: rice._id,
    extraPriceHalala: 0,
    sortOrder: 10,
  });

  return {
    product,
    proteinsGroup,
    carbsGroup,
    chicken,
    rice,
    proteinRelation,
    carbRelation,
  };
}

function buildCanonicalSlot(fixture, overrides = {}) {
  return {
    slotIndex: 1,
    selectionType: "standard_meal",
    productId: String(fixture.product._id),
    selectedOptions: [
      {
        groupId: String(fixture.proteinsGroup._id),
        groupKey: "proteins",
        optionId: String(fixture.chicken._id),
        optionKey: "grilled_chicken",
        quantity: 1,
      },
      {
        groupId: String(fixture.carbsGroup._id),
        groupKey: "carbs",
        optionId: String(fixture.rice._id),
        optionKey: "white_rice",
        quantity: 1,
        grams: 150,
      },
    ],
    ...overrides,
  };
}

async function createClientContext() {
  const user = await User.create({ phone: "+966500000001", password: "password" });
  const token = issueAppAccessToken(user._id);
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
  await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-10-09",
    status: "open",
    mealSlots: [],
  });
  await SubscriptionDay.deleteMany({ subscriptionId: subscription._id, date: "2026-10-09" });
  return { user, token, subscription };
}

async function run() {
  await connect();
  try {
    const fixture = await seedCanonicalPlannerFixture();
    const { token, subscription } = await createClientContext();
    const app = createApp();
    const api = request(app);
    const auth = { Authorization: `Bearer ${token}` };
    const date = "2026-10-10";

    let res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    assert.strictEqual(res.status, 200, `default catalog status: ${JSON.stringify(res.body)}`);
    assertObject(res.body.data.plannerCatalog, "default plannerCatalog");
    assertArray(res.body.data.plannerCatalog.sections, "default plannerCatalog.sections");

    const canonicalBody = {
      contractVersion: "meal_planner_menu.v3",
      mealSlots: [buildCanonicalSlot(fixture)],
    };

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/selection/validate`)
      .set(auth)
      .send(canonicalBody);
    assert.strictEqual(res.status, 200, `canonical validate status: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.valid, true, "canonical validate returns valid");

    res = await api
      .put(`/api/subscriptions/${subscription._id}/days/${date}/selection`)
      .set(auth)
      .send(canonicalBody);
    assert.strictEqual(res.status, 200, `canonical save status: ${JSON.stringify(res.body)}`);
    const savedSlot = res.body.data.mealSlots[0];
    assert.strictEqual(savedSlot.contractVersion, "meal_planner_menu.v3", "saved slot contract version");
    assert.strictEqual(savedSlot.productId, String(fixture.product._id), "saved slot productId");
    assertArray(savedSlot.selectedOptions, "saved selectedOptions");
    assert.strictEqual(savedSlot.selectedOptions.length, 2, "saved selectedOptions count");
    assert.strictEqual(savedSlot.proteinId, String(fixture.chicken._id), "legacy protein projection remains");
    assert.strictEqual(savedSlot.carbs[0].carbId, String(fixture.rice._id), "legacy carb projection remains");

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/confirm`)
      .set(auth)
      .send({});
    assert.strictEqual(res.status, 200, `canonical confirm status: ${JSON.stringify(res.body)}`);
    const confirmedSlot = res.body.data.mealSlots[0];
    assertObject(confirmedSlot.confirmationSnapshot, "confirmation snapshot");
    assert.strictEqual(confirmedSlot.confirmationSnapshot.product.key, "basic_meal", "snapshot product key");
    assert.strictEqual(confirmedSlot.confirmationSnapshot.selectedOptions.length, 2, "snapshot options");

    await ProductGroupOption.updateOne({ _id: fixture.carbRelation._id }, { $set: { isActive: false } });
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send(canonicalBody);
    assert.strictEqual(res.status, 422, `inactive relation rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_OPTION_RELATION_INACTIVE", "inactive option relation code");

    await ProductGroupOption.updateOne({ _id: fixture.carbRelation._id }, { $set: { isActive: true } });
    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { isActive: false } });
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send(canonicalBody);
    assert.strictEqual(res.status, 422, `inactive product rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_PRODUCT_INACTIVE", "inactive product code");

    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { isActive: true, publishedAt: null } });
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send(canonicalBody);
    assert.strictEqual(res.status, 422, `unpublished product rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_PRODUCT_UNPUBLISHED", "unpublished product code");

    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { publishedAt: new Date() } });
    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send({
        contractVersion: "v3",
        mealSlots: [buildCanonicalSlot(fixture, {
          selectedOptions: [
            {
              groupId: String(fixture.proteinsGroup._id),
              groupKey: "proteins",
              optionId: String(fixture.rice._id),
              optionKey: "white_rice",
              quantity: 1,
            },
          ],
        })],
      });
    assert.strictEqual(res.status, 422, `wrong group rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_OPTION_GROUP_MISMATCH", "wrong group code");

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send({
        contractVersion: "v3",
        mealSlots: [buildCanonicalSlot(fixture, {
          selectedOptions: [
            {
              groupId: String(fixture.proteinsGroup._id),
              groupKey: "proteins",
              optionId: String(fixture.chicken._id),
              optionKey: "grilled_chicken",
              quantity: 1,
            },
          ],
        })],
      });
    assert.strictEqual(res.status, 422, `required group rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_MIN_SELECTION_NOT_MET", "required group code");

    res = await api
      .post(`/api/subscriptions/${subscription._id}/days/2026-10-11/selection/validate`)
      .set(auth)
      .send({
        contractVersion: "v3",
        mealSlots: [buildCanonicalSlot(fixture, {
          selectedOptions: [
            {
              groupId: String(fixture.proteinsGroup._id),
              groupKey: "proteins",
              optionId: String(fixture.chicken._id),
              optionKey: "grilled_chicken",
              quantity: 0,
            },
          ],
        })],
      });
    assert.strictEqual(res.status, 422, `invalid quantity rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_INVALID_QUANTITY", "invalid quantity code");

    console.log("canonical v3 write checks passed");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
