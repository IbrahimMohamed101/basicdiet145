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
const { buildCanonicalPlannerCatalogV3 } = require("../src/services/catalog/CatalogService");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");
const {
  isConfiguredPremiumLargeSaladProtein,
  isSubscriptionPremiumLargeSaladProtein,
} = require("../src/services/subscription/premiumLargeSaladEligibilityService");

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
  const disallowedShrimp = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "shrimp",
    premiumKey: "shrimp",
    name: { en: "Shrimp", ar: "Shrimp" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    extraFeeHalala: 2000,
    publishedAt: now,
  });
  const disallowedSalmon = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "salmon",
    premiumKey: "salmon",
    name: { en: "Salmon", ar: "Salmon" },
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
  for (const option of [allowedProtein, disallowedRegular, disallowedPremium, disallowedShrimp, disallowedSalmon]) {
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

  return {
    salad,
    proteinsGroup,
    extraProteinGroup,
    allowedProtein,
    disallowedRegular,
    disallowedPremium,
    disallowedShrimp,
    disallowedSalmon,
    extraProtein,
  };
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

    const plannerCatalog = await buildCanonicalPlannerCatalogV3({
      context: {
        premiumLargeSaladProduct: fixture.salad,
        premiumLargeSaladPricing: {
          priceHalala: 2900,
          extraFeeHalala: 2900,
          currency: "SAR",
        },
      },
      lang: "en",
    });
    const premiumSaladSection = plannerCatalog.sections.find((section) => section.key === "premium_large_salad");
    const premiumSaladProduct = premiumSaladSection?.products?.find((product) => product.key === "premium_large_salad");
    assert(premiumSaladProduct, "v3 catalog exposes premium_large_salad product");
    assert.strictEqual(premiumSaladProduct.selectionType, "premium_large_salad");
    assert.strictEqual(premiumSaladProduct.action.type, "open_builder");
    assert.strictEqual(premiumSaladProduct.action.requiresBuilder, true);
    const proteinGroup = premiumSaladProduct.optionGroups.find((group) => group.key === "protein");
    assert(proteinGroup, "v3 catalog exposes canonical protein group");
    assert.strictEqual(proteinGroup.isRequired || proteinGroup.required, true);
    assert.strictEqual(proteinGroup.minSelections, 1);
    assert.strictEqual(proteinGroup.maxSelections, 1);
    const catalogProteinKeys = proteinGroup.options.map((option) => option.key);
    assert(catalogProteinKeys.includes("grilled_chicken"), "catalog keeps allowlisted salad protein");
    for (const disallowedKey of ["beef", "beef_steak", "shrimp", "salmon", "extra_protein_50g"]) {
      assert(!catalogProteinKeys.includes(disallowedKey), `catalog excludes disallowed salad protein ${disallowedKey}`);
    }
    assert(!premiumSaladProduct.optionGroups.some((group) => group.key === "extra_protein_50g"), "v3 catalog excludes extra protein group");

    const stalePublishedConfig = {
      source: "dashboard",
      sections: [{
        key: "premium_large_salad",
        sectionType: "product_list",
        includeMode: "selected",
        selectedProductIds: [fixture.salad._id],
        selectionType: "premium_large_salad",
        visible: true,
        availableFor: ["subscription"],
        rules: {
          premium_large_salad: {
            linkedProductKey: "premium_large_salad",
            groups: [{
              groupKey: "proteins",
              allowedOptionKeys: ["grilled_chicken", "beef", "beef_steak"],
            }],
          },
        },
      }],
    };
    const publishedPlannerCatalog = await mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder({
      config: stalePublishedConfig,
      lang: "en",
    });
    const publishedSaladProduct = publishedPlannerCatalog.sections
      .flatMap((section) => section.products || [])
      .find((product) => product.key === "premium_large_salad");
    const publishedProteinGroup = publishedSaladProduct.optionGroups.find((group) => group.key === "proteins");
    assert.deepStrictEqual(
      publishedProteinGroup.options.map((option) => option.key),
      ["grilled_chicken"],
      "dashboard restrictions may narrow, but never widen, the subscription salad allowlist"
    );
    assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "grilled_chicken" }), true);
    assert.strictEqual(isSubscriptionPremiumLargeSaladProtein({ key: "beef" }), false);
    assert.strictEqual(
      isConfiguredPremiumLargeSaladProtein({ key: "beef" }, ["beef"]),
      false,
      "configured keys cannot bypass the canonical allowlist"
    );

    let res = await api.post(url).set(auth).send(slot(fixture, fixture.allowedProtein));
    assert.strictEqual(res.status, 200, `allowed salad protein accepted: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.valid, true);

    const repeatedRes = await api.post(url).set(auth).send(slot(fixture, fixture.allowedProtein));
    assert.strictEqual(repeatedRes.status, 200, `repeated validation accepted: ${JSON.stringify(repeatedRes.body)}`);
    assert.deepStrictEqual(
      {
        valid: repeatedRes.body.data.valid,
        mealSlots: repeatedRes.body.data.mealSlots,
        paymentRequirement: repeatedRes.body.data.paymentRequirement,
      },
      {
        valid: res.body.data.valid,
        mealSlots: res.body.data.mealSlots,
        paymentRequirement: res.body.data.paymentRequirement,
      },
      "repeated validation is deterministic"
    );

    for (const exposedOption of proteinGroup.options) {
      const matchingFixtureOption = [
        fixture.allowedProtein,
        fixture.disallowedRegular,
        fixture.disallowedPremium,
        fixture.disallowedShrimp,
        fixture.disallowedSalmon,
      ].find((option) => String(option._id) === String(exposedOption.id));
      assert(matchingFixtureOption, `fixture contains exposed option ${exposedOption.key}`);
      const exposedValidation = await api.post(url).set(auth).send(slot(fixture, matchingFixtureOption));
      assert.strictEqual(
        exposedValidation.status,
        200,
        `every exposed premium salad protein validates: ${exposedOption.key} ${JSON.stringify(exposedValidation.body)}`
      );
    }

    res = await api.post(url).set(auth).send(slot(fixture, fixture.disallowedRegular));
    assert.strictEqual(res.status, 422, `disallowed regular protein rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "SALAD_PROTEIN_NOT_ALLOWED");

    res = await api.post(url).set(auth).send(slot(fixture, fixture.disallowedPremium));
    assert.strictEqual(res.status, 422, `disallowed premium protein rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "SALAD_PROTEIN_NOT_ALLOWED");

    await MenuOption.updateOne({ _id: fixture.allowedProtein._id }, { $set: { isAvailable: false } });
    res = await api.post(url).set(auth).send(slot(fixture, fixture.allowedProtein));
    assert.strictEqual(res.status, 422, `unavailable allowed protein rejected: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PLANNER_OPTION_UNAVAILABLE");
    await MenuOption.updateOne({ _id: fixture.allowedProtein._id }, { $set: { isAvailable: true } });

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
