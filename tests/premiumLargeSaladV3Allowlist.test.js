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
    replSet: { count: 1, dbName: "premium_salad_allowlist" },
  });
  const uri = mongoServer.getUri("premium_salad_allowlist");
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
  const extraProteinGroup = await MenuOptionGroup.create({
    key: "extra_protein_50g",
    name: { en: "Extra Protein", ar: "Extra Protein" },
    publishedAt: now,
  });
  const salad = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_large_salad",
    itemType: "premium_large_salad",
    name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
    pricingModel: "fixed",
    priceHalala: 2900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const allowedProtein = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const disallowedRegular = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "beef",
    name: { en: "Beef", ar: "Beef" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const disallowedPremium = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "beef_steak",
    premiumKey: "beef_steak",
    name: { en: "Beef Steak", ar: "Beef Steak" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    extraFeeHalala: 2000,
    publishedAt: now,
  });
  const extraProtein = await MenuOption.create({
    groupId: extraProteinGroup._id,
    key: "extra_chicken_50g",
    name: { en: "Extra Chicken", ar: "Extra Chicken" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });

  await ProductOptionGroup.create({
    productId: salad._id,
    groupId: proteinsGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  await ProductOptionGroup.create({
    productId: salad._id,
    groupId: extraProteinGroup._id,
    minSelections: 0,
    maxSelections: 1,
  });
  for (const option of [allowedProtein, disallowedRegular, disallowedPremium]) {
    await ProductGroupOption.create({
      productId: salad._id,
      groupId: proteinsGroup._id,
      optionId: option._id,
    });
  }
  await ProductGroupOption.create({
    productId: salad._id,
    groupId: extraProteinGroup._id,
    optionId: extraProtein._id,
  });

  return { salad, proteinsGroup, extraProteinGroup, allowedProtein, disallowedRegular, disallowedPremium, extraProtein };
}

function slot(fixture, option, group = fixture.proteinsGroup) {
  return {
    contractVersion: "meal_planner_menu.v3",
    mealSlots: [{
      slotIndex: 1,
      selectionType: "premium_large_salad",
      productId: String(fixture.salad._id),
      selectedOptions: [{
        groupId: String(group._id),
        groupKey: group.key,
        optionId: String(option._id),
        optionKey: option.key,
        quantity: 1,
      }],
    }],
  };
}

async function run() {
  const mongoServer = await connect();
  try {
    const fixture = await seedFixture();
    const user = await User.create({ phone: "+966500000001", password: "password" });
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
    const url = `/api/subscriptions/${subscription._id}/days/2026-10-10/selection/validate`;

    let res = await api.post(url).set(auth).send(slot(fixture, fixture.allowedProtein));
    assert.strictEqual(res.status, 200, `allowed salad protein accepted: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.valid, true);

    res = await api.post(url).set(auth).send(slot(fixture, fixture.disallowedRegular));
    assert.strictEqual(res.status, 422, `disallowed regular protein rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "SALAD_PROTEIN_NOT_ALLOWED");

    res = await api.post(url).set(auth).send(slot(fixture, fixture.disallowedPremium));
    assert.strictEqual(res.status, 422, `disallowed premium protein rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "SALAD_PROTEIN_NOT_ALLOWED");

    res = await api.post(url).set(auth).send(slot(fixture, fixture.extraProtein, fixture.extraProteinGroup));
    assert.strictEqual(res.status, 422, `extra_protein_50g rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_OPTION_GROUP_UNAVAILABLE");

    console.log("premium large salad v3 allowlist checks passed");
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
