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
const User = require("../src/models/User");

function tokenFor(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "31d" }
  );
}

async function connect() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "planner_stale_catalog" },
  });
  const uri = mongoServer.getUri("planner_stale_catalog");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoServer;
}

async function seedFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { en: "Custom Order", ar: "Custom Order" },
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { en: "Protein", ar: "Protein" },
    publishedAt: now,
  });
  const carbsGroup = await MenuOptionGroup.create({
    key: "carbs",
    name: { en: "Carbs", ar: "Carbs" },
    publishedAt: now,
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    key: "basic_meal",
    itemType: "basic_meal",
    name: { en: "Basic Meal", ar: "Basic Meal" },
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const chicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const rice = await MenuOption.create({
    groupId: carbsGroup._id,
    key: "white_rice",
    name: { en: "White Rice", ar: "White Rice" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const proteinGroupRelation = await ProductOptionGroup.create({
    productId: product._id,
    groupId: proteinsGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  const carbGroupRelation = await ProductOptionGroup.create({
    productId: product._id,
    groupId: carbsGroup._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
  });
  const proteinOptionRelation = await ProductGroupOption.create({
    productId: product._id,
    groupId: proteinsGroup._id,
    optionId: chicken._id,
  });
  const carbOptionRelation = await ProductGroupOption.create({
    productId: product._id,
    groupId: carbsGroup._id,
    optionId: rice._id,
  });
  return {
    product,
    proteinsGroup,
    carbsGroup,
    chicken,
    rice,
    proteinGroupRelation,
    carbGroupRelation,
    proteinOptionRelation,
    carbOptionRelation,
  };
}

function body(fixture, overrides = {}) {
  return {
    contractVersion: "meal_planner_menu.v3",
    mealSlots: [{
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
    }],
  };
}

async function expectCode(api, url, auth, payload, code) {
  const res = await api.post(url).set(auth).send(payload);
  assert.strictEqual(res.status, 422, `${code} status: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.error.code, code, `${code} response code: ${JSON.stringify(res.body)}`);
  const first = res.body.error.details?.slotErrors?.[0];
  assert(first?.hint === "Refresh planner catalog and retry." || code === "PLANNER_MIXED_LEGACY_CANONICAL_SLOT", `${code} exposes refresh hint or is mixed payload`);
}

async function run() {
  const mongoServer = await connect();
  try {
    const fixture = await seedFixture();
    const user = await User.create({ phone: "+966500000002", password: "password" });
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
    const api = request(createApp());
    const auth = { Authorization: `Bearer ${tokenFor(user._id)}` };
    const url = `/api/subscriptions/${subscription._id}/days/2026-10-12/selection/validate`;

    await expectCode(api, url, auth, body(fixture, { productId: String(new mongoose.Types.ObjectId()) }), "PLANNER_PRODUCT_NOT_FOUND");

    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { isActive: false } });
    await expectCode(api, url, auth, body(fixture), "PLANNER_PRODUCT_INACTIVE");
    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { isActive: true, isAvailable: false } });
    await expectCode(api, url, auth, body(fixture), "PLANNER_PRODUCT_UNAVAILABLE");
    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { isAvailable: true, publishedAt: null } });
    await expectCode(api, url, auth, body(fixture), "PLANNER_PRODUCT_UNPUBLISHED");
    await MenuProduct.updateOne({ _id: fixture.product._id }, { $set: { publishedAt: new Date() } });

    await ProductOptionGroup.deleteOne({ _id: fixture.carbGroupRelation._id });
    await expectCode(api, url, auth, body(fixture), "PLANNER_OPTION_GROUP_RELATION_NOT_FOUND");
    fixture.carbGroupRelation = await ProductOptionGroup.create({
      productId: fixture.product._id,
      groupId: fixture.carbsGroup._id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      isAvailable: false,
    });
    await expectCode(api, url, auth, body(fixture), "PLANNER_OPTION_GROUP_RELATION_UNAVAILABLE");
    await ProductOptionGroup.updateOne({ _id: fixture.carbGroupRelation._id }, { $set: { isAvailable: true } });

    await expectCode(api, url, auth, body(fixture, {
      selectedOptions: [{
        groupId: String(fixture.proteinsGroup._id),
        groupKey: "proteins",
        optionId: String(new mongoose.Types.ObjectId()),
        optionKey: "missing",
        quantity: 1,
      }],
    }), "PLANNER_OPTION_NOT_FOUND");

    await ProductGroupOption.updateOne({ _id: fixture.carbOptionRelation._id }, { $set: { isAvailable: false } });
    await expectCode(api, url, auth, body(fixture), "PLANNER_PRODUCT_OPTION_RELATION_UNAVAILABLE");
    await ProductGroupOption.updateOne({ _id: fixture.carbOptionRelation._id }, { $set: { isAvailable: true } });

    await expectCode(api, url, auth, body(fixture, { proteinId: String(fixture.chicken._id) }), "PLANNER_MIXED_LEGACY_CANONICAL_SLOT");

    const legacyRes = await api
      .put(`/api/subscriptions/${subscription._id}/days/2026-10-12/selection`)
      .set(auth)
      .send({ selections: [String(fixture.chicken._id)] });
    assert.strictEqual(legacyRes.status, 422, `legacy root rejected: ${JSON.stringify(legacyRes.body)}`);
    assert.strictEqual(legacyRes.body.error.code, "LEGACY_DAY_SELECTION_UNSUPPORTED");

    console.log("subscription planner stale catalog checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
