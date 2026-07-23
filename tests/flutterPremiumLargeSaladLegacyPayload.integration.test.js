"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

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
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");

function tokenFor(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "31d" }
  );
}

async function createGroupWithOption({ key, optionKey, minSelections, maxSelections }) {
  const now = new Date();
  const group = await MenuOptionGroup.create({
    key,
    name: { en: key, ar: key },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const option = await MenuOption.create({
    groupId: group._id,
    key: optionKey,
    name: { en: optionKey, ar: optionKey },
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  return { group, option, minSelections, maxSelections };
}

async function seedFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "salads",
    name: { en: "Salads", ar: "السلطات" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });
  const salad = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_large_salad",
    itemType: "premium_large_salad",
    name: { en: "Large Salad + Protein", ar: "سلطة كبيرة + بروتين" },
    pricingModel: "fixed",
    priceHalala: 2900,
    currency: "SAR",
    availableFor: ["subscription"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });

  const protein = await createGroupWithOption({
    key: "protein",
    optionKey: "grilled_chicken",
    minSelections: 1,
    maxSelections: 1,
  });
  const sauce = await createGroupWithOption({
    key: "sauce",
    optionKey: "ranch",
    minSelections: 1,
    maxSelections: 1,
  });

  for (const fixture of [protein, sauce]) {
    await ProductOptionGroup.create({
      productId: salad._id,
      groupId: fixture.group._id,
      minSelections: fixture.minSelections,
      maxSelections: fixture.maxSelections,
      isRequired: fixture.minSelections > 0,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
    await ProductGroupOption.create({
      productId: salad._id,
      groupId: fixture.group._id,
      optionId: fixture.option._id,
      extraPriceHalala: 0,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
  }

  await PremiumUpgradeConfig.create({
    sourceType: "menu_product",
    sourceId: salad._id,
    sourceProductId: salad._id,
    sourceGroupId: null,
    selectionType: "premium_large_salad",
    premiumKey: "premium_large_salad",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 2900,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 130,
    sourceSnapshot: {
      key: salad.key,
      name: salad.name,
      context: { productKey: salad.key },
    },
  });

  return { salad, protein, sauce };
}

function flutterPayload(fixture) {
  return {
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "premium_large_salad",
      proteinId: String(fixture.protein.option._id),
      salad: {
        presetKey: "large_salad",
        groups: {
          leafy_greens: [],
          vegetables: [],
          protein: [String(fixture.protein.option._id)],
          cheese_nuts: [],
          fruits: [],
          sauce: [String(fixture.sauce.option._id)],
        },
      },
    }],
    addonsOneTime: [],
  };
}

async function run() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "flutter_premium_salad_payload" },
  });
  const uri = mongoServer.getUri("flutter_premium_salad_payload");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const fixture = await seedFixture();
    const user = await User.create({
      phone: "+966500000091",
      password: "password",
    });
    const subscription = await Subscription.create({
      userId: user._id,
      status: "active",
      planId: new mongoose.Types.ObjectId(),
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      validityEndDate: "2026-10-30",
      totalMeals: 30,
      remainingMeals: 30,
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      premiumBalance: [],
    });

    const api = request(createApp());
    const auth = { Authorization: `Bearer ${tokenFor(user._id)}` };
    const date = "2026-10-10";
    const validateUrl = `/api/subscriptions/${subscription._id}/days/${date}/selection/validate`;
    const saveUrl = `/api/subscriptions/${subscription._id}/days/${date}/selection`;
    const payload = flutterPayload(fixture);

    const validation = await api.post(validateUrl).set(auth).send(payload);
    assert.strictEqual(
      validation.status,
      200,
      `Flutter premium salad payload validates: ${JSON.stringify(validation.body)}`
    );
    assert.strictEqual(validation.body.data.valid, true);
    assert.strictEqual(validation.body.data.mealSlots.length, 1);
    assert.strictEqual(validation.body.data.mealSlots[0].selectionType, "premium_large_salad");
    assert.strictEqual(validation.body.data.mealSlots[0].productId, String(fixture.salad._id));
    assert.strictEqual(validation.body.data.mealSlots[0].selectedOptions.length, 2);
    assert.strictEqual(validation.body.data.mealSlots[0].salad.groups.protein[0], String(fixture.protein.option._id));
    assert.strictEqual(validation.body.data.mealSlots[0].salad.groups.sauce[0], String(fixture.sauce.option._id));

    const save = await api.put(saveUrl).set(auth).send(payload);
    assert.strictEqual(
      save.status,
      402,
      `uncovered Premium salad is saved as payable draft: ${JSON.stringify(save.body)}`
    );
    assert.strictEqual(save.body.status, true);
    assert.strictEqual(save.body.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(save.body.data.paymentRequirement.amountHalala, 2900);
    assert.strictEqual(save.body.data.mealSlots[0].productId, String(fixture.salad._id));
    assert.strictEqual(save.body.data.mealSlots[0].selectedOptions.length, 2);

    const persisted = await SubscriptionDay.findOne({
      subscriptionId: subscription._id,
      date,
    }).lean();
    assert(persisted, "Premium salad draft must be persisted before payment");
    assert.strictEqual(persisted.mealSlots[0].productId.toString(), String(fixture.salad._id));
    assert.strictEqual(persisted.mealSlots[0].selectedOptions.length, 2);
    assert.strictEqual(persisted.plannerMeta.premiumPendingPaymentCount, 1);
    assert.strictEqual(persisted.plannerMeta.premiumTotalHalala, 2900);

    console.log("flutterPremiumLargeSaladLegacyPayload.integration.test.js passed");
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
