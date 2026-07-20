process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-key-0000000000000000";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-000000000";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_option_family_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expected, label) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "option_family_test",
      name: { ar: "اختبار الوجبة المركبة", en: "Option family test" },
      publishedAt: now,
    });
    const basicMeal = await MenuProduct.create({
      categoryId: category._id,
      key: "basic_meal",
      name: { ar: "وجبة بيسك", en: "Basic Meal" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1900,
      availableFor: ["subscription"],
      availableForSubscription: true,
      isCustomizable: true,
      ui: { cardVariant: "hero_builder" },
      publishedAt: now,
    });
    const [proteins, carbs] = await MenuOptionGroup.insertMany([
      {
        key: "proteins",
        name: { ar: "البروتين", en: "Proteins" },
        publishedAt: now,
        sortOrder: 10,
      },
      {
        key: "carbs",
        name: { ar: "الكارب", en: "Carbs" },
        publishedAt: now,
        sortOrder: 20,
      },
    ]);
    const [fishFillet, tuna, chicken, rice] = await MenuOption.insertMany([
      {
        groupId: proteins._id,
        key: "fish_fillet",
        name: { ar: "سمك فيليه", en: "Fish Fillet" },
        availableFor: ["subscription"],
        availableForSubscription: true,
        selectionType: "standard_meal",
        proteinFamilyKey: "fish",
        displayCategoryKey: "fish",
        publishedAt: now,
        sortOrder: 10,
      },
      {
        groupId: proteins._id,
        key: "tuna",
        name: { ar: "تونة", en: "Tuna" },
        availableFor: ["subscription"],
        availableForSubscription: true,
        selectionType: "standard_meal",
        proteinFamilyKey: "fish",
        displayCategoryKey: "fish",
        publishedAt: now,
        sortOrder: 20,
      },
      {
        groupId: proteins._id,
        key: "grilled_chicken",
        name: { ar: "دجاج مشوي", en: "Grilled Chicken" },
        availableFor: ["subscription"],
        availableForSubscription: true,
        selectionType: "standard_meal",
        proteinFamilyKey: "chicken",
        displayCategoryKey: "chicken",
        publishedAt: now,
        sortOrder: 30,
      },
      {
        groupId: carbs._id,
        key: "white_rice",
        name: { ar: "رز أبيض", en: "White Rice" },
        availableFor: ["subscription"],
        availableForSubscription: true,
        selectionType: "standard_meal",
        publishedAt: now,
        sortOrder: 10,
      },
    ]);

    await ProductOptionGroup.insertMany([
      {
        productId: basicMeal._id,
        groupId: proteins._id,
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        sortOrder: 10,
      },
      {
        productId: basicMeal._id,
        groupId: carbs._id,
        minSelections: 1,
        maxSelections: 2,
        isRequired: true,
        sortOrder: 20,
      },
    ]);
    await ProductGroupOption.insertMany([
      {
        productId: basicMeal._id,
        groupId: proteins._id,
        optionId: fishFillet._id,
        sortOrder: 10,
      },
      {
        productId: basicMeal._id,
        groupId: proteins._id,
        optionId: tuna._id,
        sortOrder: 20,
      },
      {
        productId: basicMeal._id,
        groupId: proteins._id,
        optionId: chicken._id,
        sortOrder: 30,
      },
      {
        productId: basicMeal._id,
        groupId: carbs._id,
        optionId: rice._id,
        sortOrder: 10,
      },
    ]);
    await MealBuilderConfig.create({
      status: "draft",
      isCurrent: true,
      source: "dashboard",
      sections: [],
    });

    const app = createApp();
    const auth = await dashboardAuth("admin", "option-family-lifecycle");

    const picker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/options")
      .query({
        productContextId: String(basicMeal._id),
        sourceGroupId: String(proteins._id),
        optionRole: "protein",
        familyKey: "fish",
        includeUnavailable: true,
        unassignedOnly: true,
        limit: 100,
        lang: "ar",
      })
      .set(auth.headers);
    expectStatus(picker, 200, "explicit option picker");
    assert.strictEqual(
      picker.body.data.contractVersion,
      "dashboard_meal_builder_picker.v2"
    );
    assert.strictEqual(picker.body.data.context.product.key, "basic_meal");
    assert.strictEqual(picker.body.data.context.group.key, "proteins");
    assert.deepStrictEqual(
      picker.body.data.candidates.map((item) => item.key),
      ["fish_fillet", "tuna"]
    );
    assert.ok(picker.body.data.candidates.every((item) => item.assignable));

    const createCard = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "fish_options",
        titleOverride: { ar: "اختيارات السمك", en: "Fish Options" },
        optionRole: "protein",
        familyKey: "fish",
        productContextId: String(basicMeal._id),
        sourceGroupId: String(proteins._id),
        selectedOptionIds: [String(fishFillet._id)],
        selectionType: "standard_meal",
        required: false,
        minSelections: 0,
        maxSelections: 1,
        multiSelect: false,
        visible: true,
        sortOrder: 30,
      });
    expectStatus(createCard, 201, "create option family card");
    assert.strictEqual(
      createCard.body.data.contractVersion,
      "dashboard_meal_builder_card_action.v2"
    );
    assert.strictEqual(createCard.body.data.section.sectionType, "option_group");
    assert.strictEqual(createCard.body.data.section.selectionType, "standard_meal");
    assert.strictEqual(createCard.body.data.section.metadata.cardType, "option_family");
    assert.strictEqual(createCard.body.data.section.metadata.proteinFamilyKey, "fish");
    assert.deepStrictEqual(createCard.body.data.section.selectedOptionIds, [
      String(fishFillet._id),
    ]);

    const selectedPicker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/options")
      .query({
        targetSectionKey: "fish_options",
        productContextId: String(basicMeal._id),
        sourceGroupId: String(proteins._id),
        optionRole: "protein",
        familyKey: "fish",
        includeUnavailable: true,
        unassignedOnly: true,
        limit: 100,
      })
      .set(auth.headers);
    expectStatus(selectedPicker, 200, "picker after create");
    assert.strictEqual(
      selectedPicker.body.data.candidates.find((item) => item.key === "fish_fillet")
        .selected,
      true
    );

    const replaceItems = await request(app)
      .put("/api/dashboard/meal-builder/sections/fish_options/items")
      .set(auth.headers)
      .send({ optionIds: [String(tuna._id)] });
    expectStatus(replaceItems, 200, "replace option card items");
    assert.deepStrictEqual(replaceItems.body.data.section.selectedOptionIds, [
      String(tuna._id),
    ]);

    const conflictingCard = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        cardType: "option_family",
        key: "fish_options_duplicate",
        titleOverride: { ar: "سمك مكرر", en: "Duplicate Fish" },
        optionRole: "protein",
        familyKey: "fish",
        productContextId: String(basicMeal._id),
        sourceGroupId: String(proteins._id),
        selectedOptionIds: [String(tuna._id)],
        selectionType: "standard_meal",
        maxSelections: 1,
        visible: true,
      });
    expectStatus(conflictingCard, 409, "prevent duplicate option assignment");

    const deleteCard = await request(app)
      .delete("/api/dashboard/meal-builder/sections/fish_options")
      .set(auth.headers);
    expectStatus(deleteCard, 200, "delete option family card");
    assert.strictEqual(deleteCard.body.data.previousSectionKey, "fish_options");
    assert.strictEqual(
      deleteCard.body.data.draft.sections.some((section) => section.key === "fish_options"),
      false
    );

    console.log("dashboard Meal Builder option family lifecycle passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
