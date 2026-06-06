process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const MenuVersion = require("../src/models/MenuVersion");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Setting = require("../src/models/Setting");
const User = require("../src/models/User");
const moyasarService = require("../src/services/moyasarService");
const CatalogService = require("../src/services/catalog/CatalogService");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const { JWT_SECRET } = require("../src/middleware/auth");
const {
  productRows: seededProductRows,
  seedOneTimeMenu,
} = require("../scripts/seed-one-time-menu");

const TEST_TAG = `one-time-menu-${Date.now()}`;
const TEST_KEY_TAG = TEST_TAG.replace(/-/g, "_");
const TEST_DB_NAME = `${TEST_KEY_TAG}_test`;
const results = { passed: 0, failed: 0 };
let invoiceCounter = 0;
const moyasarInvoicePayloads = [];
let mongoServer;
let adminHeaders;
let kitchenHeaders;

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

// function dashboardAuth replaced by helper

function appAuth(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

function flattenMenuProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    category.products || []
  ).map((product) => ({ ...product, categoryKey: category.key })));
}

function assertMenuProductsStayInTheirCategories(menu) {
  for (const category of menu.categories || []) {
    for (const product of category.products || []) {
      assert.strictEqual(
        String(product.categoryId),
        String(category.id),
        `${product.key} appears under ${category.key} but has categoryId ${product.categoryId}`
      );
    }
  }
}

function findProduct(menu, key) {
  return flattenMenuProducts(menu).find((product) => product.key === key);
}

function findGroup(product, key) {
  return (product.optionGroups || []).find((group) => group.key === key);
}

function assertGroupRule(product, groupKey, minSelections, maxSelections) {
  const group = findGroup(product, groupKey);
  assert(group, `${product.key} includes ${groupKey}`);
  assert.strictEqual(group.minSelections, minSelections, `${product.key}.${groupKey} min`);
  assert.strictEqual(group.maxSelections, maxSelections, `${product.key}.${groupKey} max`);
  assert.strictEqual(group.isRequired, minSelections > 0, `${product.key}.${groupKey} required`);
  return group;
}

function assertFixedDirectProduct(product, key, priceHalala) {
  assert(product, `${key} appears`);
  assert.strictEqual(product.pricingModel, "fixed", `${key} pricingModel`);
  assert.strictEqual(product.priceHalala, priceHalala, `${key} price`);
  assert.strictEqual(product.requiresBuilder, false, `${key} requiresBuilder`);
  assert.strictEqual(product.canAddDirectly, true, `${key} canAddDirectly`);
  assert.strictEqual(product.optionGroups.length, 0, `${key} option groups`);
}

async function startMemoryMongo() {
  if (mongoServer) return;
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: TEST_DB_NAME,
    },
  });
  const uri = mongoServer.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
}

async function connect() {
  await startMemoryMongo();
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
}

async function resetDatabase() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
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

async function cleanup() {
  if (mongoose.connection.readyState !== 1) return;
  const regex = new RegExp(TEST_TAG);
  const keyRegex = new RegExp(TEST_KEY_TAG);
  const [categoryIds, productIds, groupIds, optionIds, userIds] = await Promise.all([
    MenuCategory.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuProduct.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuOptionGroup.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    MenuOption.find({ $or: [{ key: keyRegex }, { "name.en": regex }] }).select("_id").lean(),
    User.find({ phone: regex }).select("_id").lean(),
  ]);
  const categories = categoryIds.map((row) => row._id);
  const products = productIds.map((row) => row._id);
  const groups = groupIds.map((row) => row._id);
  const options = optionIds.map((row) => row._id);
  const users = userIds.map((row) => row._id);
  await Promise.all([
    ProductOptionGroup.deleteMany({ $or: [{ productId: { $in: products } }, { groupId: { $in: groups } }] }),
    ProductGroupOption.deleteMany({ $or: [{ productId: { $in: products } }, { groupId: { $in: groups } }, { optionId: { $in: options } }] }),
    MenuAuditLog.deleteMany({ $or: [{ entityId: { $in: [...categories, ...products, ...groups, ...options] } }, { "meta.testTag": TEST_TAG }] }),
    MenuVersion.deleteMany({ notes: { $regex: TEST_TAG } }),
    Order.deleteMany({ userId: { $in: users } }),
    Payment.deleteMany({ userId: { $in: users } }),
    User.deleteMany({ _id: { $in: users } }),
    MenuOption.deleteMany({ _id: { $in: options } }),
    MenuOptionGroup.deleteMany({ _id: { $in: groups } }),
    MenuProduct.deleteMany({ _id: { $in: products } }),
    MenuCategory.deleteMany({ _id: { $in: categories } }),
  ]);
}

function installMoyasarMock() {
  const originalCreateInvoice = moyasarService.createInvoice;
  moyasarService.createInvoice = async (payload) => {
    invoiceCounter += 1;
    moyasarInvoicePayloads.push(payload);
    return {
      id: `inv_${TEST_TAG}_${invoiceCounter}`,
      url: `https://payments.example.test/${invoiceCounter}`,
      amount: payload.amount,
      currency: payload.currency || "SAR",
      status: "initiated",
      metadata: payload.metadata,
    };
  };
  return () => {
    moyasarService.createInvoice = originalCreateInvoice;
    moyasarInvoicePayloads.length = 0;
  };
}

async function seedViaDashboard(api) {
  await Setting.updateOne(
    { key: "vat_percentage" },
    { $set: { value: 15, description: `${TEST_TAG} VAT` } },
    { upsert: true }
  );
  ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));
  ({ headers: kitchenHeaders } = await dashboardAuth("kitchen", TEST_TAG));
  let res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
    key: `${TEST_TAG}_salads`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Salads`, ar: "سلطات" },
    sortOrder: 1,
  });
  expectStatus(res, 201, "create category");
  const category = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_direct`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Direct Product`, ar: "منتج مباشر" },
    itemType: "drink",
    pricingModel: "fixed",
    priceHalala: 800,
    sortOrder: 0,
  });
  expectStatus(res, 201, "create direct product");
  const directProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_fixed`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Fixed Product`, ar: "منتج ثابت" },
    itemType: "dessert",
    pricingModel: "fixed",
    priceHalala: 1000,
    sortOrder: 1,
  });
  expectStatus(res, 201, "create fixed product");
  const fixedProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_per100`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Per 100g`, ar: "بالوزن" },
    itemType: "basic_salad",
    pricingModel: "per_100g",
    priceHalala: 1500,
    defaultWeightGrams: 100,
    minWeightGrams: 100,
    weightStepGrams: 50,
    sortOrder: 2,
  });
  expectStatus(res, 201, "create per100 product");
  const per100Product = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_inactive`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Inactive Product`, ar: "مخفي" },
    itemType: "drink",
    pricingModel: "fixed",
    priceHalala: 100,
    isActive: false,
    sortOrder: 99,
  });
  expectStatus(res, 201, "create inactive product");
  const inactiveProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_required`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Required Product`, ar: "مطلوب" },
    itemType: "dessert",
    pricingModel: "fixed",
    priceHalala: 500,
    sortOrder: 3,
  });
  expectStatus(res, 201, "create required product");
  const requiredProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_fruit_salad`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Fruit Salad`, ar: "سلطة فواكه" },
    itemType: "fruit_salad",
    pricingModel: "fixed",
    priceHalala: 1700,
    sortOrder: 4,
  });
  expectStatus(res, 201, "create fixed configurable fruit salad");
  const fruitSaladProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
    categoryId: category.id,
    key: `${TEST_TAG}_greek_yogurt`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Greek Yogurt`, ar: "زبادي يوناني" },
    itemType: "greek_yogurt",
    pricingModel: "fixed",
    priceHalala: 1700,
    sortOrder: 5,
  });
  expectStatus(res, 201, "create fixed configurable greek yogurt");
  const greekYogurtProduct = res.body.data;

  res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
    key: `${TEST_TAG}_sauces`.replace(/-/g, "_"),
    name: { en: `${TEST_TAG} Sauces`, ar: "صوصات" },
  });
  expectStatus(res, 201, "create group");
  const group = res.body.data;

  const optionPayloads = [
    { key: `${TEST_TAG}_ranch`, name: "Ranch", extraPriceHalala: 300, extraWeightUnitGrams: 50, extraWeightPriceHalala: 500 },
    { key: `${TEST_TAG}_pesto`, name: "Pesto", extraPriceHalala: 200 },
    { key: `${TEST_TAG}_hidden`, name: "Hidden", extraPriceHalala: 900 },
    { key: `${TEST_TAG}_inactive_option`, name: "Inactive Option", extraPriceHalala: 700, isActive: false },
  ];
  const options = [];
  for (const payload of optionPayloads) {
    res = await api.post("/api/dashboard/menu/options").set(adminHeaders).send({
      groupId: group.id,
      key: payload.key.replace(/-/g, "_"),
      name: { en: `${TEST_TAG} ${payload.name}`, ar: payload.name },
      extraPriceHalala: payload.extraPriceHalala,
      extraWeightUnitGrams: payload.extraWeightUnitGrams || 0,
      extraWeightPriceHalala: payload.extraWeightPriceHalala || 0,
      isActive: payload.isActive !== false,
    });
    expectStatus(res, 201, `create option ${payload.name}`);
    options.push(res.body.data);
  }

  async function linkProductGroup(product, rules, optionOverrides, label) {
    res = await api.post(`/api/dashboard/menu/products/${product.id}/option-groups`).set(adminHeaders).send({
      groupId: group.id,
      ...rules,
    });
    expectStatus(res, 201, `${label} link group`);

    const desiredOptionIds = new Set(optionOverrides.map((item) => String(item.optionId)));
    const existingRelations = await ProductGroupOption.find({ productId: product.id, groupId: group.id }).lean();
    for (const relation of existingRelations) {
      const optionId = String(relation.optionId);
      if (!desiredOptionIds.has(optionId)) {
        res = await api.delete(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${optionId}`).set(adminHeaders);
        expectStatus(res, 200, `${label} remove auto-linked option`);
      }
    }

    for (const override of optionOverrides) {
      const optionId = String(override.optionId);
      const body = { ...override };
      delete body.optionId;
      const exists = existingRelations.some((relation) => String(relation.optionId) === optionId);
      if (exists) {
        res = await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${optionId}`).set(adminHeaders).send(body);
        expectStatus(res, 200, `${label} update linked option`);
      } else {
        res = await api.post(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options`).set(adminHeaders).send(override);
        expectStatus(res, 201, `${label} add linked option`);
      }
    }
  }

  await linkProductGroup(
    fixedProduct,
    { minSelections: 0, maxSelections: 1, sortOrder: 1 },
    [
      { optionId: options[0].id, extraPriceHalala: 300, extraWeightPriceHalala: 500, sortOrder: 1 },
      { optionId: options[1].id, extraPriceHalala: 200, sortOrder: 2 },
      { optionId: options[3].id, extraPriceHalala: 700, sortOrder: 3 },
    ],
    "fixed product"
  );

  await linkProductGroup(
    requiredProduct,
    { minSelections: 1, maxSelections: 1, sortOrder: 1 },
    [{ optionId: options[1].id, extraPriceHalala: 0, sortOrder: 1 }],
    "required product"
  );

  await linkProductGroup(
    fruitSaladProduct,
    { minSelections: 1, maxSelections: 1, sortOrder: 1 },
    [{ optionId: options[1].id, extraPriceHalala: 0, sortOrder: 1 }],
    "fruit salad"
  );

  await linkProductGroup(
    greekYogurtProduct,
    { minSelections: 0, maxSelections: 3, sortOrder: 1 },
    [
      { optionId: options[0].id, extraPriceHalala: 0, sortOrder: 1 },
      { optionId: options[1].id, extraPriceHalala: 0, sortOrder: 2 },
    ],
    "greek yogurt"
  );

  res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: TEST_TAG });
  expectStatus(res, 200, "publish menu");

  return {
    category,
    directProduct,
    fixedProduct,
    per100Product,
    inactiveProduct,
    requiredProduct,
    fruitSaladProduct,
    greekYogurtProduct,
    group,
    options,
  };
}

(async function run() {
  let restoreMoyasar = () => {};

  try {
    await connect();
    await resetDatabase();
    restoreMoyasar = installMoyasarMock();
    const api = request(createApp());

    const legacyPublishedAt = new Date();
    const [legacySalads, legacyMeals] = await Promise.all([
      MenuCategory.create({
        key: "salads",
        name: { en: "Legacy Salads", ar: "سلطات" },
        isActive: true,
        sortOrder: 1,
        publishedAt: legacyPublishedAt,
      }),
      MenuCategory.create({
        key: "meals",
        name: { en: "Legacy Meals", ar: "وجبات" },
        isActive: true,
        sortOrder: 2,
        publishedAt: legacyPublishedAt,
      }),
    ]);
    await MenuProduct.create([
      {
        categoryId: legacySalads._id,
        key: "cold_boiled_egg",
        name: { en: "Old Cold Egg", ar: "بيض مسلوق" },
        itemType: "cold_sandwich",
        pricingModel: "fixed",
        priceHalala: 900,
        isActive: true,
        sortOrder: 1,
        publishedAt: legacyPublishedAt,
      },
      {
        categoryId: legacyMeals._id,
        key: "sourdough_halloumi",
        name: { en: "Old Sourdough Halloumi", ar: "ساوردو حلومي" },
        itemType: "sourdough",
        pricingModel: "fixed",
        priceHalala: 2300,
        isActive: true,
        sortOrder: 2,
        publishedAt: legacyPublishedAt,
      },
    ]);

    await seedOneTimeMenu({ actor: { role: "test" }, notes: TEST_TAG });

    await test("seed-one-time-menu publishes the final Basic Diet dynamic menu", async () => {
      const res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "seeded menu");
      const menu = res.body.data;
      assertMenuProductsStayInTheirCategories(menu);
      const categoriesByKey = new Map((menu.categories || []).map((category) => [category.key, category]));
      ["custom_order", "light_options", "cold_sandwiches", "sourdough", "desserts", "juices", "drinks", "ice_cream"].forEach((categoryKey) => {
        assert(categoriesByKey.has(categoryKey), `menu includes ${categoryKey}`);
      });
      assert(!categoriesByKey.has("salads"), "legacy salads category is not published in customer menu");
      assert(!categoriesByKey.has("meals"), "legacy meals category is not published in customer menu");
      assert.strictEqual(categoriesByKey.get("custom_order").nameI18n.ar, "اطلب على مزاجك");
      assert.deepStrictEqual(categoriesByKey.get("custom_order").ui, {
        cardVariant: "hero_builder_collection",
        layout: "vertical_hero_list",
      });
      assert.deepStrictEqual(categoriesByKey.get("light_options").ui, {
        cardVariant: "compact_builder_collection",
        layout: "vertical_compact_builder_list",
      });
      assert.strictEqual(categoriesByKey.get("sourdough").nameI18n.ar, "الساندويشات");
      assert.strictEqual(categoriesByKey.get("ice_cream").nameI18n.ar, "الايس كريم");

      const customOrderKeys = new Set((categoriesByKey.get("custom_order").products || []).map((product) => product.key));
      ["basic_salad", "basic_meal"].forEach((productKey) => {
        assert(customOrderKeys.has(productKey), `custom_order includes ${productKey}`);
      });
      assert.strictEqual(customOrderKeys.size, 2, "custom_order contains only hero builder products");
      const lightOptionKeys = new Set((categoriesByKey.get("light_options").products || []).map((product) => product.key));
      ["fruit_salad", "greek_yogurt", "green_salad"].forEach((productKey) => {
        assert(lightOptionKeys.has(productKey), `light_options includes ${productKey}`);
      });

      const basicSalad = findProduct(menu, "basic_salad");
      assert.strictEqual(basicSalad.categoryKey, "custom_order");
      assert.strictEqual(basicSalad.ui.cardVariant, "hero_builder");
      assert.strictEqual(basicSalad.ui.imageRatio, "wide");
      assert.strictEqual(basicSalad.ui.ctaLabel, "start_customizing");
      assert.deepStrictEqual(basicSalad.ui.ctaLabelI18n, { ar: "ابدأ التخصيص", en: "Start Customizing" });
      assert.deepStrictEqual(basicSalad.ui.mediaPositionByLocale, { ar: "left", en: "right" });
      assert.strictEqual(basicSalad.ui.behaviorHint, "open_builder");
      assert.strictEqual(basicSalad.ui.priceLabelMode, "per_unit_or_from");
      assert.strictEqual(basicSalad.ui.showDescription, true);
      assert.strictEqual(basicSalad.ui.showPrice, true);
      assert.strictEqual(basicSalad.nameI18n.en, "Basic Salad");
      assert.strictEqual(basicSalad.pricingModel, "per_100g");
      assert.strictEqual(basicSalad.priceHalala, 2900);
      assert.strictEqual(basicSalad.baseUnitGrams, 100);
      assert.strictEqual(basicSalad.defaultWeightGrams, 100);
      assert.strictEqual(basicSalad.minWeightGrams, 100);
      assert.strictEqual(basicSalad.maxWeightGrams, 0);
      assert.strictEqual(basicSalad.weightStepGrams, 50);
      assert.strictEqual(basicSalad.requiresBuilder, true);
      assert.strictEqual(basicSalad.canAddDirectly, false);
      assertGroupRule(basicSalad, "leafy_greens", 2, 2);
      assertGroupRule(basicSalad, "vegetables_legumes", 0, 19);
      assertGroupRule(basicSalad, "fruits", 0, 4);
      const basicSaladProteins = assertGroupRule(basicSalad, "proteins", 1, 1);
      assertGroupRule(basicSalad, "cheese_nuts", 0, 2);
      assertGroupRule(basicSalad, "sauces", 1, 1);

      const basicMeal = findProduct(menu, "basic_meal");
      assert.strictEqual(basicMeal.categoryKey, "custom_order");
      assert.strictEqual(basicMeal.ui.cardVariant, "hero_builder");
      assert.strictEqual(basicMeal.ui.ctaLabel, "start_customizing");
      assert.strictEqual(basicMeal.ui.behaviorHint, "open_builder");
      assert.strictEqual(basicMeal.ui.priceLabelMode, "per_unit_or_from");
      assert.strictEqual(basicMeal.pricingModel, "per_100g");
      assert.strictEqual(basicMeal.priceHalala, 1900);
      assert.strictEqual(basicMeal.requiresBuilder, true);
      assert.strictEqual(basicMeal.canAddDirectly, false);
      assertGroupRule(basicMeal, "carbs", 3, 3);
      const basicMealProteins = assertGroupRule(basicMeal, "proteins", 1, 1);

      const fruitSalad = findProduct(menu, "fruit_salad");
      assert.strictEqual(fruitSalad.categoryKey, "light_options");
      assert.strictEqual(fruitSalad.ui.cardVariant, "compact_builder");
      assert.strictEqual(fruitSalad.ui.ctaLabel, "start_customizing");
      assert.strictEqual(fruitSalad.ui.behaviorHint, "open_builder");
      assert.strictEqual(fruitSalad.ui.priceLabelMode, "final_depends_on_options");
      assert.deepStrictEqual(fruitSalad.ui.mediaPositionByLocale, { ar: "left", en: "right" });
      assert.strictEqual(fruitSalad.pricingModel, "fixed");
      assert.strictEqual(fruitSalad.priceHalala, 1700);
      assert.strictEqual(fruitSalad.requiresBuilder, true);
      assert.strictEqual(fruitSalad.canAddDirectly, false);
      const fruitSaladFruits = assertGroupRule(fruitSalad, "fruits", 9, 9);
      assert(fruitSaladFruits.options.some((option) => option.nameI18n.ar === "عسل"), "fruit_salad fruits include honey");

      const greekYogurt = findProduct(menu, "greek_yogurt");
      assert.strictEqual(greekYogurt.categoryKey, "light_options");
      assert.strictEqual(greekYogurt.ui.cardVariant, "compact_builder");
      assert.strictEqual(greekYogurt.ui.ctaLabel, "start_customizing");
      assert.strictEqual(greekYogurt.pricingModel, "fixed");
      assert.strictEqual(greekYogurt.priceHalala, 1700);
      assert.strictEqual(greekYogurt.requiresBuilder, true);
      assert.strictEqual(greekYogurt.canAddDirectly, false);
      assertGroupRule(greekYogurt, "fruits", 5, 5);
      assertGroupRule(greekYogurt, "nuts", 0, 3);

      const greenSalad = findProduct(menu, "green_salad");
      assert.strictEqual(greenSalad.categoryKey, "light_options");
      assert.strictEqual(greenSalad.ui.cardVariant, "compact_builder");
      assert.strictEqual(greenSalad.ui.ctaLabel, "start_customizing");
      assert.strictEqual(greenSalad.pricingModel, "per_100g");
      assert.strictEqual(greenSalad.priceHalala, 1500);
      assertGroupRule(greenSalad, "leafy_greens", 2, 2);
      assertGroupRule(greenSalad, "vegetables_legumes", 0, 19);
      assertGroupRule(greenSalad, "sauces", 1, 1);

      const premiumSaladOptions = new Map(basicSaladProteins.options.map((option) => [option.nameI18n.ar, option]));
      ["ستيك لحم", "جمبري", "سالمون"].forEach((optionName) => {
        assert.strictEqual(premiumSaladOptions.get(optionName).extraPriceHalala, 1600, `basic_salad ${optionName} extra price`);
        assert.strictEqual(premiumSaladOptions.get(optionName).extraWeightUnitGrams, 50, `basic_salad ${optionName} extra unit`);
        assert.strictEqual(premiumSaladOptions.get(optionName).extraWeightPriceHalala, 1000, `basic_salad ${optionName} extra weight price`);
      });
      ["فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي"].forEach((optionName) => {
        assert.strictEqual(premiumSaladOptions.get(optionName).extraWeightPriceHalala, 500, `basic_salad ${optionName} chicken extra weight`);
      });
      ["كرات لحم", "لحم استرغانوف"].forEach((optionName) => {
        assert.strictEqual(premiumSaladOptions.get(optionName).extraPriceHalala, 300, `basic_salad ${optionName} extra price`);
        assert.strictEqual(premiumSaladOptions.get(optionName).extraWeightPriceHalala, 600, `basic_salad ${optionName} meat extra weight`);
      });

      const premiumMealOptions = new Map(basicMealProteins.options.map((option) => [option.nameI18n.ar, option]));
      ["ستيك لحم", "جمبري", "سالمون"].forEach((optionName) => {
        assert.strictEqual(premiumMealOptions.get(optionName).extraPriceHalala, 2000, `basic_meal ${optionName} extra price`);
        assert.strictEqual(premiumMealOptions.get(optionName).extraWeightUnitGrams, 50, `basic_meal ${optionName} extra unit`);
        assert.strictEqual(premiumMealOptions.get(optionName).extraWeightPriceHalala, 1000, `basic_meal ${optionName} extra weight price`);
      });
      ["فاهيتا", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي"].forEach((optionName) => {
        assert.strictEqual(premiumMealOptions.get(optionName).extraWeightPriceHalala, 500, `basic_meal ${optionName} chicken extra weight`);
      });
      ["كرات لحم", "لحم استرغانوف"].forEach((optionName) => {
        assert.strictEqual(premiumMealOptions.get(optionName).extraPriceHalala, 300, `basic_meal ${optionName} extra price`);
        assert.strictEqual(premiumMealOptions.get(optionName).extraWeightPriceHalala, 600, `basic_meal ${optionName} meat extra weight`);
      });

      seededProductRows
        .filter((product) => product.pricingModel === "fixed" && !product.groups)
        .forEach((product) => assertFixedDirectProduct(findProduct(menu, product.key), product.key, product.priceHalala));
      ["cold_boiled_egg", "sourdough_halloumi", "ice_cream_addon"].forEach((legacyKey) => {
        assert(!findProduct(menu, legacyKey), `${legacyKey} is not active in customer menu`);
      });
    });

    await test("subscription builderCatalog is derived from shared menu options and products", async () => {
      const proteinsGroup = await MenuOptionGroup.findOne({ key: "proteins" }).lean();
      assert(proteinsGroup, "proteins option group exists");
      const shrimp = await MenuOption.findOne({ groupId: proteinsGroup._id, "name.en": "Shrimp" });
      assert(shrimp, "shrimp menu option exists");
      shrimp.extraPriceHalala = 1600;
      shrimp.displayCategoryKey = "premium";
      shrimp.proteinFamilyKey = "fish";
      shrimp.premiumKey = "shrimp";
      shrimp.ruleTags = ["premium"];
      shrimp.selectionType = "premium_meal";
      await shrimp.save();

      const chicken = await MenuOption.findOne({ groupId: proteinsGroup._id, "name.en": "Grilled Chicken" });
      assert(chicken, "standard chicken menu option exists");
      chicken.extraPriceHalala = 0;
      chicken.displayCategoryKey = "chicken";
      chicken.proteinFamilyKey = "chicken";
      chicken.premiumKey = "grilled_chicken";
      chicken.selectionType = "standard_meal";
      await chicken.save();

      const catalog = await CatalogService.getSubscriptionBuilderCatalog({ lang: "en" });
      const premiumShrimp = catalog.premiumProteins.find((protein) => protein.premiumKey === "shrimp");
      const standardChicken = catalog.proteins.find((protein) => protein.id === String(chicken._id));
      const sandwich = catalog.sandwiches.find((item) => item.name === "Grilled Chicken");

      assert(premiumShrimp, "premium shrimp appears in premiumProteins");
      assert.strictEqual(premiumShrimp.extraFeeHalala, 1600);
      assert.strictEqual(premiumShrimp.selectionType, "premium_meal");
      assert(standardChicken, "standard chicken appears in proteins");
      assert.strictEqual(standardChicken.selectionType, "standard_meal");
      assert(sandwich, "menu sandwich product appears in builderCatalog.sandwiches");
      assert.strictEqual(sandwich.priceHalala, 1300, "builderCatalog sandwich uses canonical menu price");
      assert.strictEqual(sandwich.calories, 220, "builderCatalog sandwich includes compatibility calories");
      assert.strictEqual(sandwich.proteinFamilyKey, "chicken", "builderCatalog sandwich includes compatibility protein family");
      assert(catalog.premiumLargeSalad, "premiumLargeSalad is present");
      assert(catalog.premiumLargeSalad.carbId, "premiumLargeSalad keeps carbId field");
      assert((catalog.premiumLargeSalad.ingredients || []).some((item) => item.groupKey === "protein" && item.id === String(shrimp._id)), "premiumLargeSalad includes protein menu options");

      const res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
      expectStatus(res, 200, "subscription meal planner menu");
      const endpointCatalog = res.body.data && res.body.data.builderCatalog;
      const endpointCatalogV2 = res.body.data && res.body.data.builderCatalogV2;
      assert(endpointCatalog, "endpoint returns builderCatalog");
      assert(endpointCatalog.premiumProteins.some((protein) => protein.premiumKey === "shrimp"), "endpoint builderCatalog uses shared premium option");
      assert(endpointCatalogV2, "endpoint returns builderCatalogV2");
      assert.strictEqual(endpointCatalogV2.catalogVersion, "meal_planner_menu.v2");
      assert.strictEqual(endpointCatalogV2.currency, "SAR");
      assert(Array.isArray(endpointCatalogV2.sections), "builderCatalogV2.sections is an array");
      assert(endpointCatalogV2.rules && endpointCatalogV2.rules.beef, "builderCatalogV2 includes beef rules");
      assert(endpointCatalogV2.rules && endpointCatalogV2.rules.standardCarbs, "builderCatalogV2 includes standard carb rules");
      assert(endpointCatalogV2.rules && endpointCatalogV2.rules.premiumCarbs, "builderCatalogV2 includes premium carb rules");
      assert(endpointCatalogV2.rules && endpointCatalogV2.rules.premiumLargeSalad, "builderCatalogV2 includes premium large salad rules");

      const sectionsByKey = new Map(endpointCatalogV2.sections.map((section) => [section.key, section]));
      const standardSection = sectionsByKey.get("standard_meal");
      const premiumSection = sectionsByKey.get("premium_meal");
      const sandwichSection = sectionsByKey.get("sandwich");
      const saladSection = sectionsByKey.get("premium_large_salad");
      assert(standardSection, "builderCatalogV2 includes standard_meal section");
      assert(premiumSection, "builderCatalogV2 includes premium_meal section");
      assert(sandwichSection, "builderCatalogV2 includes sandwich section");
      assert(saladSection, "builderCatalogV2 includes premium_large_salad section");

      const standardProduct = standardSection.products && standardSection.products[0];
      assert.strictEqual(standardProduct.id, "virtual:standard_meal");
      assert.strictEqual(standardProduct.type, "virtual_builder_product");
      assert.strictEqual(standardProduct.isVirtual, true);
      assert.strictEqual(standardProduct.selectionType, "standard_meal");
      assert.strictEqual(standardProduct.ui.cardVariant, "standard");
      const standardGroupsByKey = new Map((standardProduct.optionGroups || []).map((group) => [group.key, group]));
      const standardProteinGroup = standardGroupsByKey.get("protein");
      const standardCarbGroup = standardGroupsByKey.get("carb");
      assert(standardProteinGroup, "standard meal includes protein group");
      assert(standardCarbGroup, "standard meal includes carb group");
      assert.strictEqual(standardProteinGroup.sourceKey, "proteins");
      assert.strictEqual(standardProteinGroup.minSelections, 1);
      assert.strictEqual(standardProteinGroup.maxSelections, 1);
      assert.strictEqual(standardProteinGroup.isRequired, true);
      assert(standardProteinGroup.ui && typeof standardProteinGroup.ui.displayStyle === "string", "standard protein group has sanitized ui");
      assert((standardProteinGroup.options || []).some((option) => option.id === String(chicken._id)), "standard protein options include chicken");
      assert(!(standardProteinGroup.options || []).some((option) => option.premiumKey === "shrimp"), "standard protein options exclude premium shrimp");
      assert((standardProteinGroup.options || []).every((option) => typeof option.key === "string" && option.key.trim()), "standard protein options include stable keys");
      assert.strictEqual(standardCarbGroup.sourceKey, "carbs");
      assert.strictEqual(standardCarbGroup.rules.maxTypes, endpointCatalogV2.rules.standardCarbs.maxTypes);
      assert(!(standardCarbGroup.options || []).some((option) => option.displayCategoryKey === "large_salad"), "standard carbs exclude large_salad");
      assert((standardCarbGroup.options || []).every((option) => typeof option.key === "string" && option.key.trim()), "standard carb options include stable keys");

      const premiumProduct = premiumSection.products && premiumSection.products[0];
      assert.strictEqual(premiumProduct.id, "virtual:premium_meal");
      assert.strictEqual(premiumProduct.type, "virtual_builder_product");
      assert.strictEqual(premiumProduct.isVirtual, true);
      assert.strictEqual(premiumProduct.selectionType, "premium_meal");
      const premiumGroupsByKey = new Map((premiumProduct.optionGroups || []).map((group) => [group.key, group]));
      const premiumProteinGroup = premiumGroupsByKey.get("protein");
      const premiumCarbGroup = premiumGroupsByKey.get("carb");
      assert(premiumProteinGroup, "premium meal includes protein group");
      assert(premiumCarbGroup, "premium meal includes carb group");
      const premiumShrimpOption = (premiumProteinGroup.options || []).find((option) => option.premiumKey === "shrimp");
      assert(premiumShrimpOption, "premium meal includes premium shrimp option");
      assert.strictEqual(premiumShrimpOption.extraFeeHalala, 1600);
      assert.strictEqual(premiumShrimpOption.selectionType, "premium_meal");
      assert.strictEqual(premiumCarbGroup.rules.maxTypes, endpointCatalogV2.rules.premiumCarbs.maxTypes);

      const v2Sandwich = (sandwichSection.products || []).find((product) => product.name === "Grilled Chicken");
      assert(v2Sandwich, "builderCatalogV2 includes published subscription sandwich product");
      assert.strictEqual(v2Sandwich.id, sandwich.id, "sandwich V2 product id remains write-compatible sandwichId");
      assert.strictEqual(v2Sandwich.selectionType, "sandwich");
      assert(v2Sandwich.key, "sandwich V2 product includes key");
      assert(v2Sandwich.ui && typeof v2Sandwich.ui.cardVariant === "string", "sandwich V2 product has sanitized ui");
      assert.strictEqual(v2Sandwich.priceHalala, 1300, "sandwich V2 product uses canonical menu price");
      assert.strictEqual(v2Sandwich.calories, 220, "sandwich V2 product includes compatibility calories");
      assert.strictEqual(v2Sandwich.proteinFamilyKey, "chicken", "sandwich V2 product includes compatibility protein family");

      const saladProduct = saladSection.products && saladSection.products[0];
      assert(saladProduct, "premium large salad V2 exposes product");
      assert.strictEqual(saladProduct.selectionType, "premium_large_salad");
      assert.strictEqual(saladProduct.premiumKey, "premium_large_salad");
      assert.strictEqual(saladProduct.priceHalala, endpointCatalog.premiumLargeSalad.priceHalala);
      assert.strictEqual(saladProduct.priceSource, endpointCatalog.premiumLargeSalad.priceSource);
      assert(Array.isArray(saladProduct.optionGroups), "premium large salad V2 exposes option groups");
      const saladGroupsByKey = new Map(saladProduct.optionGroups.map((group) => [group.key, group]));
      const expectedSaladGroupKeys = ["leafy_greens", "vegetables", "protein", "cheese_nuts", "fruits", "sauce"];
      assert.deepStrictEqual(
        Array.from(saladGroupsByKey.keys()).sort(),
        expectedSaladGroupKeys.slice().sort(),
        "premium large salad V2 exposes all canonical groups"
      );
      assert(saladGroupsByKey.has("protein"), "premium large salad V2 includes protein group");
      assert((saladGroupsByKey.get("protein").options || []).some((option) => option.premiumKey === "shrimp"), "premium large salad protein group includes shrimp");
      for (const group of saladProduct.optionGroups) {
        assert(!["vegetables_legumes", "sauces", "proteins"].includes(group.key), `salad group ${group.key} is canonical`);
        assert(group.ui && typeof group.ui.displayStyle === "string", "salad group has sanitized ui");
        assert(Array.isArray(group.options) && group.options.length > 0, `salad group ${group.key} has options`);
        assert(group.options.every((option) => typeof option.key === "string" && option.key.trim()), `salad group ${group.key} options include stable keys`);
      }
    });

    await resetDatabase();

    const user = await User.create({
      phone: `${TEST_TAG}-+966500000000`,
      name: `${TEST_TAG} User`,
      role: "client",
      isActive: true,
    });
    const ctx = await seedViaDashboard(api);

    await test("Dashboard menu generates immutable catalog keys and exposes ui metadata", async () => {
      let res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
        name: { en: "Spicy Bowls", ar: "أطباق حارة" },
        ui: { cardVariant: "addon_collection" },
        sortOrder: 7,
      });
      expectStatus(res, 201, "create generated-key category");
      const generatedCategory = res.body.data;
      assert.strictEqual(generatedCategory.key, "spicy_bowls");
      assert.strictEqual(generatedCategory.ui.cardVariant, "addon_collection");

      res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
        categoryId: generatedCategory.id,
        name: { en: "Spicy Chicken", ar: "دجاج حار" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1800,
        ui: { cardVariant: "premium", badge: "New", ctaLabel: "Customize", imageRatio: "wide" },
      });
      expectStatus(res, 201, "create generated-key product");
      const generatedProduct = res.body.data;
      assert.strictEqual(generatedProduct.key, "spicy_chicken");
      assert.deepStrictEqual(generatedProduct.ui, {
        cardVariant: "premium",
        badge: "New",
        ctaLabel: "Customize",
        imageRatio: "wide",
      });

      res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
        name: { en: "Sauce Flight", ar: "رحلة صوص" },
        ui: { displayStyle: "radio_cards" },
      });
      expectStatus(res, 201, "create generated-key option group");
      const generatedGroup = res.body.data;
      assert.strictEqual(generatedGroup.key, "sauce_flight");
      assert.deepStrictEqual(generatedGroup.ui, { displayStyle: "radio_cards" });

      res = await api.post(`/api/dashboard/menu/option-groups/${generatedGroup.id}/options`).set(adminHeaders).send({
        name: { en: "Lemon Sauce", ar: "صوص ليمون" },
        extraPriceHalala: 100,
      });
      expectStatus(res, 201, "create generated-key option");
      const generatedOption = res.body.data;
      assert.strictEqual(generatedOption.key, "lemon_sauce");

      res = await api.post(`/api/dashboard/menu/option-groups/${generatedGroup.id}/options`).set(adminHeaders).send({
        name: { en: "Lemon Sauce", ar: "صوص ليمون آخر" },
        extraPriceHalala: 150,
      });
      expectStatus(res, 201, "create duplicate-name generated option");
      assert(/^lemon_sauce(_2|_[a-f0-9]{4})$/.test(res.body.data.key), `unexpected duplicate option key ${res.body.data.key}`);

      res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
        name: { ar: "مجموعة عربية فقط" },
      });
      expectStatus(res, 201, "create arabic fallback option group key");
      assert(/^group_[a-f0-9]{6}$/.test(res.body.data.key), `unexpected fallback group key ${res.body.data.key}`);

      res = await api.post(`/api/dashboard/menu/option-groups/${generatedGroup.id}/options`).set(adminHeaders).send({
        name: { ar: "خيار عربي فقط" },
        extraPriceHalala: 0,
      });
      expectStatus(res, 201, "create arabic fallback option key");
      assert(/^option_[a-f0-9]{6}$/.test(res.body.data.key), `unexpected fallback option key ${res.body.data.key}`);

      res = await api.patch(`/api/dashboard/menu/option-groups/${generatedGroup.id}`).set(adminHeaders).send({
        name: { en: "Renamed Sauce Flight", ar: "رحلة صوص جديدة" },
      });
      expectStatus(res, 200, "rename generated option group");
      assert.strictEqual(res.body.data.key, "sauce_flight");

      res = await api.patch(`/api/dashboard/menu/options/${generatedOption.id}`).set(adminHeaders).send({
        name: { en: "Renamed Lemon Sauce", ar: "صوص ليمون جديد" },
      });
      expectStatus(res, 200, "rename generated option");
      assert.strictEqual(res.body.data.key, "lemon_sauce");

      res = await api.patch(`/api/dashboard/menu/option-groups/${generatedGroup.id}`).set(adminHeaders).send({
        key: "changed_group_key",
        name: { en: "Renamed Sauce Flight", ar: "رحلة صوص جديدة" },
      });
      expectStatus(res, 400, "changed option group key rejected");
      assert.strictEqual(res.body.error.code, "IMMUTABLE_KEY");

      res = await api.patch(`/api/dashboard/menu/options/${generatedOption.id}`).set(adminHeaders).send({
        key: "changed_option_key",
        name: { en: "Renamed Lemon Sauce", ar: "صوص ليمون جديد" },
      });
      expectStatus(res, 400, "changed option key rejected");
      assert.strictEqual(res.body.error.code, "IMMUTABLE_KEY");

      res = await api.patch(`/api/dashboard/menu/option-groups/${generatedGroup.id}`).set(adminHeaders).send({
        ui: { displayStyle: "spinner" },
      });
      expectStatus(res, 400, "invalid display style rejected");

      res = await api.patch(`/api/dashboard/menu/products/${generatedProduct.id}`).set(adminHeaders).send({
        ui: { cardVariant: "unknown" },
      });
      expectStatus(res, 400, "invalid product card variant rejected");

      res = await api.post(`/api/dashboard/menu/products/${generatedProduct.id}/option-groups`).set(adminHeaders).send({
        groupId: generatedGroup.id,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 1,
      });
      expectStatus(res, 201, "link generated group to generated product");

      res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
        name: { en: "Spicy Bowls", ar: "أطباق حارة" },
      });
      expectStatus(res, 201, "create duplicate-name generated category");
      assert(/^spicy_bowls(_2|_[a-f0-9]{4})$/.test(res.body.data.key), `unexpected duplicate key ${res.body.data.key}`);
      assert.strictEqual(res.body.data.ui.cardVariant, "addon_collection");

      res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
        name: { ar: "تصنيف عربي فقط" },
      });
      expectStatus(res, 201, "create arabic fallback category key");
      assert(/^category_[a-f0-9]{6}$/.test(res.body.data.key), `unexpected fallback key ${res.body.data.key}`);

      res = await api.patch(`/api/dashboard/menu/categories/${generatedCategory.id}`).set(adminHeaders).send({
        name: { en: "Renamed Bowls", ar: "أطباق جديدة" },
      });
      expectStatus(res, 200, "rename generated category");
      assert.strictEqual(res.body.data.key, "spicy_bowls");

      res = await api.patch(`/api/dashboard/menu/categories/${generatedCategory.id}`).set(adminHeaders).send({
        key: "changed_key",
        name: { en: "Renamed Bowls", ar: "أطباق جديدة" },
      });
      expectStatus(res, 400, "changed category key rejected");

      res = await api.patch(`/api/dashboard/menu/categories/${generatedCategory.id}`).set(adminHeaders).send({
        name: { en: "Renamed Bowls", ar: "أطباق جديدة" },
        ui: { cardVariant: "unknown" },
      });
      expectStatus(res, 400, "invalid card variant rejected");

      res = await api.patch(`/api/dashboard/menu/products/${generatedProduct.id}`).set(adminHeaders).send({
        name: { en: "Renamed Spicy Chicken", ar: "دجاج حار جديد" },
      });
      expectStatus(res, 200, "rename generated product");
      assert.strictEqual(res.body.data.key, "spicy_chicken");

      res = await api.patch(`/api/dashboard/menu/products/${generatedProduct.id}`).set(adminHeaders).send({
        key: "changed_product_key",
        name: { en: "Renamed Spicy Chicken", ar: "دجاج حار جديد" },
      });
      expectStatus(res, 400, "changed product key rejected");

      await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} generated keys` });
      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "public menu after generated keys");
      const publicCategory = (res.body.data.categories || []).find((category) => category.id === generatedCategory.id);
      assert(publicCategory, "generated category appears in public menu");
      assert.strictEqual(publicCategory.ui.cardVariant, "addon_collection");
      const publicProduct = publicCategory.products.find((product) => product.key === "spicy_chicken");
      assert(publicProduct, "generated product appears in public menu");
      assert.deepStrictEqual(publicProduct.ui, {
        cardVariant: "premium",
        badge: "New",
        ctaLabel: "Customize",
        imageRatio: "wide",
        behaviorHint: "open_builder",
        priceLabelMode: "final_depends_on_options",
      });
      const publicGroup = publicProduct.optionGroups.find((group) => group.key === "sauce_flight");
      assert(publicGroup, "generated option group appears in public menu");
      assert.deepStrictEqual(publicGroup.ui, { displayStyle: "radio_cards" });

      await Promise.all([
        MenuCategory.updateOne({ _id: ctx.category.id }, { $unset: { ui: 1 } }),
        MenuProduct.updateOne({ _id: ctx.fixedProduct.id }, { $unset: { ui: 1 } }),
        MenuOptionGroup.updateOne({ _id: ctx.group.id }, { $unset: { ui: 1 } }),
      ]);
      await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} missing ui fallback` });
      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "public menu after missing ui");
      const fallbackCategory = (res.body.data.categories || []).find((category) => category.id === ctx.category.id);
      assert(fallbackCategory, "seed category appears");
      assert.deepStrictEqual(fallbackCategory.ui, { cardVariant: "addon_collection" });
      const fallbackProduct = fallbackCategory.products.find((product) => product.id === ctx.fixedProduct.id);
      assert(fallbackProduct, "seed product appears");
      assert.deepStrictEqual(fallbackProduct.ui, {
        cardVariant: "standard",
        badge: "",
        ctaLabel: "customize",
        ctaLabelI18n: { ar: "اختر الإضافة", en: "Customize" },
        imageRatio: "square",
        behaviorHint: "open_builder",
        priceLabelMode: "final_depends_on_options",
      });
      const fallbackGroup = fallbackProduct.optionGroups.find((group) => group.id === ctx.group.id);
      assert(fallbackGroup, "seed option group appears");
      assert.deepStrictEqual(fallbackGroup.ui, { displayStyle: "chips" });
    });

    await test("GET /api/orders/menu exposes published pickup-only catalog without delivery", async () => {
      const res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu");
      assert.strictEqual(res.body.data.fulfillmentMethod, "pickup");
      assert.strictEqual(res.body.data.vatIncluded, true);
      assert.strictEqual(res.body.data.delivery, undefined);
      const product = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
      assert(product, "published product appears");
      assert.strictEqual(product.priceHalala, 1000);
      assert.strictEqual(product.requiresBuilder, true);
      assert.strictEqual(product.canAddDirectly, false);
      const directProduct = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.directProduct.id);
      assert(directProduct, "direct fixed product appears");
      assert.strictEqual(directProduct.requiresBuilder, false);
      assert.strictEqual(directProduct.canAddDirectly, true);
      const per100Product = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.per100Product.id);
      assert(per100Product, "per_100g product appears");
      assert.strictEqual(per100Product.requiresBuilder, true);
      assert.strictEqual(per100Product.canAddDirectly, false);
      const fruitSalad = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fruitSaladProduct.id);
      assert(fruitSalad, "fixed configurable fruit salad appears");
      assert.strictEqual(fruitSalad.itemType, "fruit_salad");
      assert.strictEqual(fruitSalad.pricingModel, "fixed");
      assert.strictEqual(fruitSalad.requiresBuilder, true);
      assert.strictEqual(fruitSalad.canAddDirectly, false);
      const greekYogurt = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.greekYogurtProduct.id);
      assert(greekYogurt, "fixed configurable greek yogurt appears");
      assert.strictEqual(greekYogurt.itemType, "greek_yogurt");
      assert.strictEqual(greekYogurt.pricingModel, "fixed");
      assert.strictEqual(greekYogurt.requiresBuilder, true);
      assert.strictEqual(greekYogurt.canAddDirectly, false);
      assert.strictEqual(greekYogurt.optionGroups[0].maxSelections, 3);
      assert(!res.body.data.categories.flatMap((category) => category.products).some((item) => item.id === ctx.inactiveProduct.id), "inactive product is hidden");
      assert(!product.optionGroups[0].options.some((item) => item.id === ctx.options[3].id), "inactive option is hidden");
    });

    await test("GET /api/orders/menu keeps default response stable and exposes opt-in publicMenuV2", async () => {
      let res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "default public menu");
      assert.strictEqual(res.body.data.publicMenuV2, undefined, "publicMenuV2 is opt-in only");

      res = await api.get("/api/orders/menu?lang=en&includePublicV2=true");
      expectStatus(res, 200, "public menu v2 opt-in");
      const menu = res.body.data;
      const contract = menu.publicMenuV2;
      assert(contract, "publicMenuV2 exists");
      assert.strictEqual(contract.contractVersion, "one_time_menu.v2");
      assert.strictEqual(contract.source, "one_time_order");
      assert.strictEqual(contract.fulfillmentMethod, "pickup");
      assert.strictEqual(contract.currency, "SAR");
      assert.strictEqual(contract.vatIncluded, true);
      assert(Array.isArray(contract.sections), "publicMenuV2.sections is array");
      assert.strictEqual(contract.sections.length, menu.categories.length, "V2 section count mirrors public categories");
      assert(contract.rules, "publicMenuV2 rules exist");
      assert.strictEqual(contract.rules.selectionLimitSemantics, "maxSelections_null_means_unlimited");
      assert.strictEqual(contract.rules.pricingUnit, "halala");

      const section = contract.sections.find((item) => item.key === ctx.category.key);
      assert(section, "fixture category section exists");
      assert.strictEqual(section.type, "product_collection");
      assert.deepStrictEqual(section.ui, menu.categories.find((item) => item.key === ctx.category.key).ui);

      const product = section.products.find((item) => item.id === ctx.fixedProduct.id);
      assert(product, "V2 product exists in its section");
      assert.strictEqual(product.categoryKey, ctx.category.key);
      assert.strictEqual(product.pricing.model, "fixed");
      assert.strictEqual(product.pricing.priceHalala, 1000);
      assert.strictEqual(product.pricing.currency, "SAR");
      assert.strictEqual(product.action.type, "open_builder");
      assert.strictEqual(product.action.requiresBuilder, true);
      assert.strictEqual(product.action.canAddDirectly, false);
      assert(Array.isArray(product.optionGroups), "V2 keeps product option groups");
      assert.strictEqual(contract.productIndex.byId[product.id].sectionKey, ctx.category.key);
      assert.strictEqual(contract.productIndex.byKey[product.key].productId, product.id);

      const directProduct = contract.sections
        .flatMap((item) => item.products)
        .find((item) => item.id === ctx.directProduct.id);
      assert(directProduct, "V2 direct product exists");
      assert.strictEqual(directProduct.action.type, "direct_add");
      assert.strictEqual(directProduct.action.canAddDirectly, true);
      assert.strictEqual(directProduct.action.requiresBuilder, false);
    });

    await test("Dashboard availableFor filters one-time products and options without changing public shape", async () => {
      try {
        let res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}`).set(adminHeaders).send({
          availableFor: ["subscription"],
        });
        expectStatus(res, 200, "set product subscription-only");
        assert.deepStrictEqual(res.body.data.availableFor, ["subscription"], "product detail includes availableFor");

        res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} product channel` });
        expectStatus(res, 200, "publish product channel");

        res = await api.get("/api/orders/menu?lang=en");
        expectStatus(res, 200, "menu after product channel");
        assert(!res.body.data.categories.flatMap((category) => category.products).some((item) => item.id === ctx.fixedProduct.id), "subscription-only product hidden from one-time menu");

        res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
          fulfillmentMethod: "pickup",
          items: [{ productId: ctx.fixedProduct.id, qty: 1, selectedOptions: [] }],
        });
        expectStatus(res, 409, "subscription-only product rejected by one-time quote");

        res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}`).set(adminHeaders).send({
          availableFor: ["one_time", "subscription"],
        });
        expectStatus(res, 200, "restore product channels");

        res = await api.patch(`/api/dashboard/menu/options/${ctx.options[1].id}`).set(adminHeaders).send({
          availableFor: ["subscription"],
        });
        expectStatus(res, 200, "set option subscription-only");
        assert.deepStrictEqual(res.body.data.availableFor, ["subscription"], "option detail includes availableFor");

        res = await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} option channel` });
        expectStatus(res, 200, "publish option channel");

        res = await api.get("/api/orders/menu?lang=en");
        expectStatus(res, 200, "menu after option channel");
        const fixedProduct = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
        assert(fixedProduct, "restored product appears");
        assert(!fixedProduct.optionGroups[0].options.some((item) => item.id === ctx.options[1].id), "subscription-only option hidden from one-time menu");

        res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
          fulfillmentMethod: "pickup",
          items: [{
            productId: ctx.fixedProduct.id,
            qty: 1,
            selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[1].id }],
          }],
        });
        expectStatus(res, 409, "subscription-only option rejected by one-time quote");
      } finally {
        await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}`).set(adminHeaders).send({
          availableFor: ["one_time", "subscription"],
        });
        await api.patch(`/api/dashboard/menu/options/${ctx.options[1].id}`).set(adminHeaders).send({
          availableFor: ["one_time", "subscription"],
        });
        await api.post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: `${TEST_TAG} restore channels` });
      }
    });

    await test("POST /api/orders/quote prices fixed item, option extra, and extra weight", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          priceHalala: 999999,
          unitPriceHalala: 999999,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[0].id, extraWeightGrams: 50 }],
        }],
      });
      expectStatus(res, 200, "fixed quote");
      assert.strictEqual(res.body.data.pricing.totalHalala, 1800);
      assert.strictEqual(res.body.data.pricing.vatIncluded, true);
      assert.strictEqual(res.body.data.pricing.vatHalala, 235);
    });

    await test("POST /api/orders/quote prices per_100g item in halala", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{ productId: ctx.per100Product.id, qty: 1, weightGrams: 150, selectedOptions: [] }],
      });
      expectStatus(res, 200, "per100 quote");
      assert.strictEqual(res.body.data.pricing.totalHalala, 3000);
    });

    await test("POST /api/orders/quote requires positive integer weightGrams for per_100g items", async () => {
      for (const weightGrams of [undefined, null, "", 0, -100, 100.5, "invalid"]) {
        const item = { productId: ctx.per100Product.id, qty: 1, selectedOptions: [] };
        if (weightGrams !== undefined) item.weightGrams = weightGrams;
        const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
          fulfillmentMethod: "pickup",
          items: [item],
        });
        expectStatus(res, 400, `per100 invalid weight ${String(weightGrams)}`);
        assert.strictEqual(res.body.error.code, "INVALID_WEIGHT_GRAMS");
      }
    });

    await test("POST /api/orders/quote ignores weightGrams for fixed-price items", async () => {
      for (const weightGrams of [undefined, null, 0]) {
        const item = { productId: ctx.directProduct.id, qty: 1, selectedOptions: [] };
        if (weightGrams !== undefined) item.weightGrams = weightGrams;
        const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
          fulfillmentMethod: "pickup",
          items: [item],
        });
        expectStatus(res, 200, `fixed quote weight ${String(weightGrams)}`);
      }
    });

    await test("POST /api/orders/quote validates pickup branch by ObjectId, stable key, and availability", async () => {
      const objectIdBranch = new mongoose.Types.ObjectId();
      await Setting.updateOne(
        { key: "pickup_windows" },
        { $set: { key: "pickup_windows", value: ["18:00-20:00"] } },
        { upsert: true }
      );

      await Setting.deleteOne({ key: "pickup_locations" });
      let res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "default main pickup branch without setting");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_BRANCH");

      await Setting.updateOne(
        { key: "pickup_locations" },
        {
          $set: {
            key: "pickup_locations",
            value: [
              {
                _id: objectIdBranch,
                key: "object-id-branch",
                name: { en: "ObjectId Branch", ar: "فرع" },
                isActive: true,
                pickupEnabled: true,
              },
              {
                id: "main-id",
                key: "main",
                code: "main",
                slug: "main",
                name: { en: "Main Branch", ar: "الفرع الرئيسي" },
                isActive: true,
                pickupEnabled: true,
              },
              {
                id: "inactive",
                key: "inactive",
                name: { en: "Inactive Branch", ar: "فرع غير نشط" },
                isActive: false,
                pickupEnabled: true,
              },
              {
                id: "pickup-off",
                key: "pickup-off",
                name: { en: "Pickup Off Branch", ar: "فرع" },
                isActive: true,
                pickupEnabled: false,
              },
            ],
          },
        },
        { upsert: true }
      );

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: String(objectIdBranch), pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "ObjectId pickup branch");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "stable key pickup branch");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "missing pickupWindow is ASAP");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_DELIVERY_WINDOW");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: {},
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "empty pickup defaults to main ASAP");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_DELIVERY_WINDOW");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 200, "missing pickup branch defaults to main");
      assert.notStrictEqual(res.body.error && res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "unknown_branch", pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "unknown pickup branch");
      assert.strictEqual(res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "inactive", pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "inactive pickup branch");
      assert.strictEqual(res.body.error.code, "INVALID_BRANCH");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "pickup-off", pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "pickup-unavailable branch");
      assert.strictEqual(res.body.error.code, "INVALID_BRANCH");

      await Setting.updateOne(
        { key: "pickup_locations" },
        {
          $set: {
            key: "pickup_locations",
            value: [{
              id: "main",
              key: "main",
              name: { en: "Main Branch", ar: "الفرع الرئيسي" },
              isActive: false,
              pickupEnabled: true,
            }],
          },
        },
        { upsert: true }
      );
      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { pickupWindow: "18:00-20:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "missing branch rejects inactive configured main");
      assert.strictEqual(res.body.error.code, "INVALID_BRANCH");

      await Setting.updateOne(
        { key: "pickup_locations" },
        {
          $set: {
            key: "pickup_locations",
            value: [{
              id: "main",
              key: "main",
              code: "main",
              slug: "main",
              name: { en: "Main Branch", ar: "الفرع الرئيسي" },
              isActive: true,
              pickupEnabled: true,
            }],
          },
        },
        { upsert: true }
      );
      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main", pickupWindow: "19:00-21:00" },
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "invalid pickup window after branch resolution");
      assert.strictEqual(res.body.error.code, "INVALID_DELIVERY_WINDOW");

      await Setting.updateOne(
        { key: "restaurant_is_open" },
        { $set: { key: "restaurant_is_open", value: false } },
        { upsert: true }
      );
      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        pickup: {},
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 409, "closed restaurant still blocks ASAP pickup");
      assert.strictEqual(res.body.error.code, "RESTAURANT_CLOSED");
      await Setting.updateOne(
        { key: "restaurant_is_open" },
        { $set: { key: "restaurant_is_open", value: true } },
        { upsert: true }
      );
    });

    await test("POST /api/orders/quote validates maxSelections and option-product relation", async () => {
      let res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [
            { groupId: ctx.group.id, optionId: ctx.options[0].id },
            { groupId: ctx.group.id, optionId: ctx.options[1].id },
          ],
        }],
      });
      expectStatus(res, 400, "max selections");
      assert.strictEqual(res.body.error.code, "MAX_SELECTIONS_EXCEEDED");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[2].id }],
        }],
      });
      expectStatus(res, 400, "not allowed option");
      assert.strictEqual(res.body.error.code, "OPTION_NOT_ALLOWED");
    });

    await test("POST /api/orders/quote validates minSelections", async () => {
      const res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.requiredProduct.id,
          qty: 1,
          selectedOptions: [],
        }],
      });
      expectStatus(res, 400, "min selections");
      assert.strictEqual(res.body.error.code, "MIN_SELECTIONS_NOT_MET");
    });

    await test("POST /api/orders rejects delivery and subscription fields", async () => {
      let res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "delivery",
        items: [{ productId: ctx.fixedProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "delivery rejected");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        mealSlots: [],
        items: [{ productId: ctx.fixedProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "subscription fields rejected");
      assert.strictEqual(res.body.error.code, "UNSUPPORTED_ONE_TIME_ORDER_FIELD");
    });

    await test("POST /api/orders stores immutable product and option snapshot", async () => {
      const createRes = await api.post("/api/orders")
        .set({ ...appAuth(user._id), "Idempotency-Key": `${TEST_TAG}-snapshot-order` })
        .send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[0].id }],
        }],
      });
      expectStatus(createRes, 201, "create order");
      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert.strictEqual(order.items[0].productSnapshot.name.en, `${TEST_TAG} Fixed Product`);
      assert.strictEqual(order.items[0].selectedOptions[0].name.en, `${TEST_TAG} Ranch`);

      await MenuProduct.updateOne({ _id: ctx.fixedProduct.id }, { $set: { name: { en: `${TEST_TAG} Changed`, ar: "تغيير" }, priceHalala: 9999 } });
      const unchanged = await Order.findById(order._id).lean();
      assert.strictEqual(unchanged.items[0].productSnapshot.name.en, `${TEST_TAG} Fixed Product`);
      assert.strictEqual(unchanged.items[0].unitPriceHalala, 1300);
    });

    await test("POST /api/orders creates dynamic catalog item orders without itemType enum regression", async () => {
      const createRes = await api.post("/api/orders")
        .set({ ...appAuth(user._id), "Idempotency-Key": `${TEST_TAG}-dynamic-order` })
        .send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.per100Product.id,
          qty: 1,
          weightGrams: 150,
          selectedOptions: [],
        }],
      });
      expectStatus(createRes, 201, "create dynamic catalog order");

      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert(order, "order was persisted");
      assert.strictEqual(order.status, "pending_payment");
      assert.strictEqual(order.items[0].itemType, "basic_salad");
      assert(order.items[0].productSnapshot, "productSnapshot is persisted");
      assert.strictEqual(order.items[0].productSnapshot.key, `${TEST_TAG}_per100`.replace(/-/g, "_"));
      assert(Array.isArray(order.items[0].selectedOptions), "selectedOptions snapshot array is persisted");
      assert(order.items[0].pricingSnapshot, "pricingSnapshot is persisted");
      assert(Object.prototype.hasOwnProperty.call(order.items[0], "menuVersionId"), "menuVersionId field is persisted when available");

      const payment = await Payment.findOne({ orderId: order._id, type: "one_time_order" }).lean();
      assert(payment, "one-time order payment was persisted");
      assert.strictEqual(payment.type, "one_time_order");
      assert.strictEqual(payment.status, "initiated");
    });

    await test("POST /api/orders creates ASAP pickup order when pickupWindow is omitted", async () => {
      const createRes = await api.post("/api/orders")
        .set({ ...appAuth(user._id), "Idempotency-Key": `${TEST_TAG}-asap-order` })
        .send({
        fulfillmentMethod: "pickup",
        pickup: {},
        items: [{
          productId: ctx.directProduct.id,
          qty: 1,
          selectedOptions: [],
        }],
      });
      expectStatus(createRes, 201, "create ASAP pickup order");
      const order = await Order.findById(createRes.body.data.orderId).lean();
      assert(order, "ASAP pickup order was persisted");
      assert.strictEqual(order.pickup.branchId, "main");
      assert.strictEqual(order.pickup.pickupWindow, "");
    });

    await test("POST /api/orders normalizes Flutter deep link redirects for Moyasar", async () => {
      const savedAppUrl = process.env.APP_URL;
      process.env.APP_URL = "https://api.example.test";
      const beforePayloads = moyasarInvoicePayloads.length;
      let createRes;
      try {
        createRes = await api.post("/api/orders")
          .set({ ...appAuth(user._id), "Idempotency-Key": `${TEST_TAG}-deeplink-order` })
          .send({
          fulfillmentMethod: "pickup",
          pickup: {
            branchId: "main",
            pickupWindow: "18:00-20:00",
          },
          items: [
            {
              productId: ctx.fixedProduct.id,
              qty: 1,
              weightGrams: 100,
              selectedOptions: [
                {
                  groupId: ctx.group.id,
                  optionId: ctx.options[0].id,
                  extraWeightGrams: null,
                },
              ],
            },
          ],
          successUrl: "basicdiet://orders/payment-success",
          backUrl: "basicdiet://orders/payment-cancel",
        });
      } finally {
        if (savedAppUrl !== undefined) process.env.APP_URL = savedAppUrl;
        else delete process.env.APP_URL;
      }

      expectStatus(createRes, 201, "flutter deep link order");
      assert.strictEqual(createRes.body.data.status, "pending_payment");
      const invoicePayload = moyasarInvoicePayloads[beforePayloads];
      assert(invoicePayload, "Moyasar invoice payload was captured");
      assert.strictEqual(invoicePayload.successUrl, "https://api.example.test/payment-success");
      assert.strictEqual(invoicePayload.backUrl, "https://api.example.test/payment-cancel");
      assert.strictEqual(invoicePayload.callbackUrl, "https://api.example.test/api/webhooks/moyasar");
      assert.strictEqual(invoicePayload.metadata.type, "one_time_order");
    });

    await test("Dashboard can edit relation selection rules and customer menu reflects them", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${ctx.greekYogurtProduct.id}/option-groups/${ctx.group.id}/selection-rules`)
        .set(adminHeaders)
        .send({ minSelections: 1, maxSelections: 2, isRequired: true });
      expectStatus(res, 200, "update selection rules");
      assert.strictEqual(res.body.data.minSelections, 1);
      assert.strictEqual(res.body.data.maxSelections, 2);
      assert.strictEqual(res.body.data.isRequired, true);

      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu after rule update");
      const greekYogurt = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.greekYogurtProduct.id);
      assert(greekYogurt, "greek yogurt remains visible");
      assert.strictEqual(greekYogurt.optionGroups[0].minSelections, 1);
      assert.strictEqual(greekYogurt.optionGroups[0].maxSelections, 2);
      assert.strictEqual(greekYogurt.optionGroups[0].isRequired, true);

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{ productId: ctx.greekYogurtProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 400, "updated min selections enforced");
      assert.strictEqual(res.body.error.code, "MIN_SELECTIONS_NOT_MET");
    });

    await test("Dashboard hide/unhide option filters menu and quote rejects stale hidden option", async () => {
      let res = await api.patch(`/api/dashboard/menu/options/${ctx.options[1].id}/visibility`)
        .set(adminHeaders)
        .send({ isVisible: false });
      expectStatus(res, 200, "hide option");
      assert.strictEqual(res.body.data.isVisible, false);

      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu after hide option");
      const fixedProduct = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
      assert(fixedProduct, "fixed product remains visible");
      assert(!fixedProduct.optionGroups[0].options.some((item) => item.id === ctx.options[1].id), "hidden option is absent");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[1].id }],
        }],
      });
      expectStatus(res, 409, "hidden option quote rejected");
      assert.strictEqual(res.body.error.code, "OPTION_NOT_AVAILABLE");

      res = await api.patch(`/api/dashboard/menu/options/${ctx.options[1].id}/visibility`)
        .set(adminHeaders)
        .send({ isVisible: true });
      expectStatus(res, 200, "unhide option");
      assert.strictEqual(res.body.data.isVisible, true);
    });

    await test("Dashboard relation availability is product-specific and stale quotes are rejected", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}/option-groups/${ctx.group.id}/options/${ctx.options[0].id}/availability`)
        .set(adminHeaders)
        .send({ isAvailable: false });
      expectStatus(res, 200, "mark relation option unavailable");
      assert.strictEqual(res.body.data.isAvailable, false);

      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu after relation option unavailable");
      const fixedProduct = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
      const greekYogurt = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.greekYogurtProduct.id);
      assert(!fixedProduct.optionGroups[0].options.some((item) => item.id === ctx.options[0].id), "option hidden only for fixed product");
      assert(greekYogurt.optionGroups[0].options.some((item) => item.id === ctx.options[0].id), "same global option remains available for greek yogurt");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[0].id }],
        }],
      });
      expectStatus(res, 409, "relation unavailable option quote rejected");
      assert.strictEqual(res.body.error.code, "OPTION_NOT_AVAILABLE");
    });

    await test("Product-specific option price updates are isolated by product, group, and option", async () => {
      let res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
        key: `${TEST_KEY_TAG}_duplicate_option_group`,
        name: { en: `${TEST_TAG} Duplicate Option Group`, ar: "مجموعة مكررة" },
      });
      expectStatus(res, 201, "create duplicate option group");
      const duplicateGroup = res.body.data;

      await ProductOptionGroup.create({
        productId: ctx.fixedProduct.id,
        groupId: duplicateGroup.id,
        minSelections: 0,
        maxSelections: 1,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 99,
      });
      await ProductGroupOption.create({
        productId: ctx.fixedProduct.id,
        groupId: duplicateGroup.id,
        optionId: ctx.options[0].id,
        extraPriceHalala: 111,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 99,
      });

      res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}/option-groups/${duplicateGroup.id}/options/${ctx.options[0].id}`)
        .set(adminHeaders)
        .send({ extraPriceHalala: 222 });
      expectStatus(res, 200, "update duplicate group relation");
      assert.strictEqual(res.body.data.groupId, duplicateGroup.id);
      assert.strictEqual(res.body.data.extraPriceHalala, 222);

      const originalRelation = await ProductGroupOption.findOne({
        productId: ctx.fixedProduct.id,
        groupId: ctx.group.id,
        optionId: ctx.options[0].id,
      }).lean();
      const duplicateRelation = await ProductGroupOption.findOne({
        productId: ctx.fixedProduct.id,
        groupId: duplicateGroup.id,
        optionId: ctx.options[0].id,
      }).lean();
      assert.strictEqual(originalRelation.extraPriceHalala, 300, "original group relation price is unchanged");
      assert.strictEqual(duplicateRelation.extraPriceHalala, 222, "selected group relation price is updated");

      res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}/option-groups/${duplicateGroup.id}/options/${ctx.options[1].id}`)
        .set(adminHeaders)
        .send({ extraPriceHalala: 333 });
      expectStatus(res, 404, "missing exact relation returns not found");
      assert.strictEqual(res.body.error.code, "MENU_ENTITY_NOT_FOUND");
    });

    await test("Dashboard product availability filters menu and quote/create reject stale product", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${ctx.directProduct.id}/availability`)
        .set(adminHeaders)
        .send({ isAvailable: false });
      expectStatus(res, 200, "mark product unavailable");
      assert.strictEqual(res.body.data.isAvailable, false);

      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu after product unavailable");
      assert(!res.body.data.categories.flatMap((category) => category.products).some((item) => item.id === ctx.directProduct.id), "unavailable product is absent");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 409, "unavailable product quote rejected");
      assert.strictEqual(res.body.error.code, "PRODUCT_NOT_AVAILABLE");

      res = await api.post("/api/orders")
        .set({ ...appAuth(user._id), "Idempotency-Key": `${TEST_TAG}-unavailable-order` })
        .send({
        fulfillmentMethod: "pickup",
        items: [{ productId: ctx.directProduct.id, qty: 1, selectedOptions: [] }],
      });
      expectStatus(res, 409, "unavailable product create rejected");
      assert.strictEqual(res.body.error.code, "PRODUCT_NOT_AVAILABLE");
    });

    await test("Hidden relation group updates canAddDirectly/requiresBuilder and rejects stale builder selections", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${ctx.fixedProduct.id}/option-groups/${ctx.group.id}/visibility`)
        .set(adminHeaders)
        .send({ isVisible: false });
      expectStatus(res, 200, "hide product group relation");
      assert.strictEqual(res.body.data.isVisible, false);

      res = await api.get("/api/orders/menu?lang=en");
      expectStatus(res, 200, "menu after relation group hidden");
      const fixedProduct = res.body.data.categories.flatMap((category) => category.products).find((item) => item.id === ctx.fixedProduct.id);
      assert(fixedProduct, "fixed product remains visible after group relation hidden");
      assert.strictEqual(fixedProduct.optionGroups.length, 0);
      assert.strictEqual(fixedProduct.requiresBuilder, false);
      assert.strictEqual(fixedProduct.canAddDirectly, true);

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: ctx.fixedProduct.id,
          qty: 1,
          selectedOptions: [{ groupId: ctx.group.id, optionId: ctx.options[1].id }],
        }],
      });
      expectStatus(res, 409, "hidden relation group quote rejected");
      assert.strictEqual(res.body.error.code, "OPTION_GROUP_NOT_AVAILABLE");
    });

    await test("Dashboard menu requires admin role", async () => {
      const res = await api.post("/api/dashboard/menu/categories").set(kitchenHeaders).send({
        key: `${TEST_TAG}_forbidden`.replace(/-/g, "_"),
        name: { en: "Forbidden" },
      });
      expectStatus(res, 403, "dashboard menu forbidden");
    });
  } catch (err) {
    results.failed += 1;
    console.error("❌ one-time menu catalog setup/run");
    console.error(err && err.stack ? err.stack : err);
  } finally {
    restoreMoyasar();
    await cleanup();
    await resetDatabase();
    await disconnect();
  }

  if (results.failed > 0) {
    console.error(`\n${results.failed} one-time menu catalog test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${results.passed} one-time menu catalog test(s) passed`);
})();
