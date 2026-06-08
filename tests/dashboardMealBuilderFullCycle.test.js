process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dashboard_meal_builder_full_cycle_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function seedCatalog() {
  const now = new Date();
  const [customCategory, sandwichCategory] = await Promise.all([
    MenuCategory.create({ key: "custom_order", name: { en: "Custom Order", ar: "Custom Order" }, publishedAt: now }),
    MenuCategory.create({ key: "cold_sandwiches", name: { en: "Sandwiches", ar: "Sandwiches" }, publishedAt: now }),
  ]);
  const [proteinsGroup, carbsGroup] = await Promise.all([
    MenuOptionGroup.create({ key: "proteins", name: { en: "Proteins", ar: "Proteins" }, publishedAt: now }),
    MenuOptionGroup.create({ key: "carbs", name: { en: "Carbs", ar: "Carbs" }, publishedAt: now }),
  ]);
  const [basicMeal, premiumLargeSalad, sandwich] = await Promise.all([
    MenuProduct.create({
      categoryId: customCategory._id,
      key: "basic_meal",
      itemType: "basic_meal",
      name: { en: "Basic Meal", ar: "Basic Meal" },
      pricingModel: "per_100g",
      priceHalala: 1900,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId: customCategory._id,
      key: "premium_large_salad",
      itemType: "premium_large_salad",
      isCustomizable: true,
      name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
      pricingModel: "fixed",
      priceHalala: 2900,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId: sandwichCategory._id,
      key: "grilled_chicken_cold_sandwich",
      itemType: "cold_sandwich",
      name: { en: "Chicken Sandwich", ar: "Chicken Sandwich" },
      pricingModel: "fixed",
      priceHalala: 1200,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);

  const proteinRows = [
    { key: "chicken", family: "chicken" },
    { key: "chicken_fajita", family: "chicken", disabledRelation: true },
    { key: "grilled_chicken", family: "chicken" },
    { key: "beef", family: "beef" },
    { key: "meatballs", family: "beef", disabledRelation: true },
    { key: "fish", family: "fish" },
    { key: "tuna", family: "fish", disabledRelation: true },
    { key: "eggs", family: "eggs" },
    { key: "boiled_eggs", family: "eggs", disabledRelation: true },
    { key: "beef_steak", family: "beef", premium: true, price: 3000 },
    { key: "shrimp", family: "fish", premium: true, price: 3000 },
    { key: "salmon", family: "fish", premium: true, price: 3000 },
  ];
  const proteins = await Promise.all(proteinRows.map((row, index) => MenuOption.create({
    groupId: proteinsGroup._id,
    key: row.key,
    premiumKey: row.premium ? row.key : "",
    name: { en: row.key, ar: row.key },
    proteinFamilyKey: row.family,
    displayCategoryKey: row.premium ? "premium" : row.family,
    extraPriceHalala: row.price || 0,
    availableFor: ["subscription"],
    availableForSubscription: true,
    sortOrder: index + 1,
    publishedAt: now,
  })));
  const proteinByKey = new Map(proteins.map((option) => [option.key, option]));

  const carbs = await Promise.all(["white_rice", "sweet_potato"].map((key, index) => MenuOption.create({
    groupId: carbsGroup._id,
    key,
    name: { en: key, ar: key },
    availableFor: ["subscription"],
    availableForSubscription: true,
    sortOrder: index + 1,
    publishedAt: now,
  })));

  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: carbsGroup._id, minSelections: 1, maxSelections: 2, isRequired: true, sortOrder: 2 });
  for (const row of proteinRows) {
    const option = proteinByKey.get(row.key);
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: option._id,
      extraPriceHalala: option.extraPriceHalala || 0,
      isActive: row.disabledRelation ? false : true,
      isVisible: row.disabledRelation ? false : true,
      isAvailable: row.disabledRelation ? false : true,
      sortOrder: option.sortOrder,
    });
  }
  for (const option of carbs) {
    await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: option._id, sortOrder: option.sortOrder });
  }
  await ProductOptionGroup.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductGroupOption.create({
    productId: premiumLargeSalad._id,
    groupId: proteinsGroup._id,
    optionId: proteinByKey.get("grilled_chicken")._id,
    sortOrder: 1,
  });

  return { basicMeal, premiumLargeSalad, sandwich, proteinByKey };
}

function keys(rows) {
  return rows.map((row) => row.key);
}

async function main() {
  await connect();
  try {
    const fixture = await seedCatalog();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "meal-builder-full-cycle");

    let res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send({});
    expectStatus(res, 201, "create canonical draft");
    assert.deepStrictEqual(keys(res.body.data.sections), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);

    res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "hydrate canonical draft");
    assert.deepStrictEqual(keys(res.body.data.sections), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert(res.body.data.sections.every((section) => section.key && section.source?.kind && Number(section.sortOrder) > 0), "sections have canonical keys/source/sort");

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?include=all").set(headers);
    expectStatus(res, 200, "chicken picker");
    const chickenPicker = res.body.data;
    assert(chickenPicker.meta.total >= 3, JSON.stringify(chickenPicker.meta));
    const fajita = chickenPicker.candidates.find((item) => item.key === "chicken_fajita");
    assert(fajita, "disabled relation candidate discovered");
    assert.strictEqual(fajita.selected, false);
    assert.strictEqual(fajita.eligible, true, JSON.stringify(fajita));
    assert.strictEqual(fajita.state, "addable");
    assert.strictEqual(fajita.relationExists, false);

    const draft = (await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers)).body.data.draft;
    const sectionsWithAddedChicken = draft.sections.map((section) => section.key === "chicken"
      ? { ...section, selectedOptionIds: [...section.selectedOptionIds, fajita.optionId] }
      : section);
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: sectionsWithAddedChicken, notes: "add chicken fajita" });
    expectStatus(res, 200, "save added addable chicken");
    assert(res.body.data.sections.find((section) => section.key === "chicken").selectedOptionIds.includes(fajita.optionId), "added candidate persists on save");

    res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "reload after add");
    assert(res.body.data.sections.find((section) => section.key === "chicken").selectedOptions.some((item) => item.key === "chicken_fajita"), "added candidate hydrates after reload");

    const sectionsWithoutFajita = res.body.data.draft.sections.map((section) => section.key === "chicken"
      ? { ...section, selectedOptionIds: section.selectedOptionIds.filter((id) => id !== fajita.optionId) }
      : section);
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: sectionsWithoutFajita, notes: "remove chicken fajita" });
    expectStatus(res, 200, "save removed candidate");
    assert(!res.body.data.sections.find((section) => section.key === "chicken").selectedOptionIds.includes(fajita.optionId), "removed candidate stays removed");

    const reordered = res.body.data.sections.map((section) => {
      if (section.key === "beef") return { ...section, sortOrder: 30 };
      if (section.key === "chicken") return { ...section, sortOrder: 40 };
      return section;
    });
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: reordered, notes: "temporary reorder" });
    expectStatus(res, 200, "save reordered sections");
    assert.deepStrictEqual(keys(res.body.data.sections), ["premium", "sandwich", "beef", "chicken", "fish", "eggs", "carbs"]);
    assert.strictEqual(new Set(res.body.data.sections.map((section) => section.sortOrder)).size, 7, "sort orders remain unique");

    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: draft.sections, notes: "restore canonical order" });
    expectStatus(res, 200, "restore canonical sections");
    assert.deepStrictEqual(keys(res.body.data.sections), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);

    res = await api.post("/api/dashboard/meal-builder/validate").set(headers).send({ sections: res.body.data.sections });
    expectStatus(res, 200, "validate valid draft");
    assert.strictEqual(res.body.data.ready, true, JSON.stringify(res.body.data));

    res = await api.post("/api/dashboard/meal-builder/validate").set(headers).send({
      sections: draft.sections.filter((section) => section.key !== "chicken"),
    });
    expectStatus(res, 200, "validate missing canonical section");
    assert.strictEqual(res.body.data.ready, false, JSON.stringify(res.body.data));
    assert(res.body.data.errors.some((error) => error.code === "MEAL_BUILDER_VISUAL_SECTION_MISSING" && error.sectionKey === "chicken"), JSON.stringify(res.body.data.errors));

    const missingGroupSections = draft.sections.map((section) => section.key === "chicken"
      ? { ...section, key: "custom_missing_group", source: undefined, sourceGroupId: null }
      : section);
    res = await api.post("/api/dashboard/meal-builder/validate").set(headers).send({ sections: missingGroupSections });
    expectStatus(res, 400, "validate missing required group");
    assert.strictEqual(res.body.error.code, "MEAL_BUILDER_INVALID_SECTION_REFERENCE");

    await MenuOption.updateOne({ _id: fixture.proteinByKey.get("chicken_fajita")._id }, { $set: { publishedAt: null } });
    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?include=all").set(headers);
    expectStatus(res, 200, "picker includes unpublished addable candidate");
    const unpublished = res.body.data.candidates.find((item) => item.key === "chicken_fajita");
    assert(unpublished, "unpublished candidate is visible to Dashboard picker");
    assert.strictEqual(unpublished.eligible, true, JSON.stringify(unpublished));
    assert(unpublished.reasonCodes.includes("OPTION_UNPUBLISHED"), JSON.stringify(unpublished));

    const invalidSections = draft.sections.map((section) => section.key === "chicken"
      ? { ...section, selectedOptionIds: [...section.selectedOptionIds, String(fixture.proteinByKey.get("chicken_fajita")._id)] }
      : section);
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: invalidSections, notes: "invalid unpublished selected" });
    expectStatus(res, 200, "save unpublished selected candidate");
    res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});
    expectStatus(res, 422, "publish rejects unpublished selected candidate");
    assert.strictEqual(res.body.error.code, "MEAL_BUILDER_VALIDATION_FAILED");
    await MenuOption.updateOne({ _id: fixture.proteinByKey.get("chicken_fajita")._id }, { $set: { publishedAt: new Date() } });

    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: draft.sections, notes: "valid publish" });
    expectStatus(res, 200, "restore valid draft");
    res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({ notes: "full cycle publish" });
    expectStatus(res, 200, "publish valid draft");
    assert.strictEqual(res.body.data.validation.ready, true, JSON.stringify(res.body.data.validation));
    assert.deepStrictEqual(keys(res.body.data.config.sections), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert.strictEqual(res.body.data.config.sections[0].source.kind, "premium_mixed");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=ar");
    expectStatus(res, 200, "flutter planner menu after publish");
    const planner = res.body.data.plannerCatalog;
    assert.strictEqual(planner.contractVersion, "meal_planner_menu.v3");
    assert.deepStrictEqual(keys(planner.sections), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert.strictEqual(planner.sections.find((section) => section.key === "chicken").products[0].optionGroups[0].options[0].key, "chicken");
    assert.strictEqual(planner.rules.source, "meal_builder_config");
    assert(res.body.data.builderCatalog, "legacy builderCatalog remains compatibility output only");

    console.log("dashboard meal builder full cycle checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
