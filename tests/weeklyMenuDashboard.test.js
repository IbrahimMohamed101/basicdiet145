require("dotenv").config();
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Setting = require("../src/models/Setting");
const User = require("../src/models/User");
const Order = require("../src/models/Order");
const { connectDB, disconnectDB, resetDB } = require("./helpers/dbHelper");
const { dashboardAuth: createDashboardAuth, cleanupDashboardUsers } = require("./helpers/dashboardAuthHelper");
const moyasarService = require("../src/services/moyasarService");

const TEST_TAG = `weekly-menu-${Date.now()}`;
const results = { passed: 0, failed: 0 };
let mongoServer;

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

let adminToken, adminHeader;

function dashboardAuth() {
  return adminHeader;
}

function installMoyasarMock() {
  const originalCreateInvoice = moyasarService.createInvoice;
  moyasarService.createInvoice = async (payload) => ({
    id: `inv_${TEST_TAG}`,
    url: `https://payments.example.test/${TEST_TAG}`,
    amount: payload.amount,
    currency: payload.currency || "SAR",
    status: "initiated",
    metadata: payload.metadata,
  });
  return () => {
    moyasarService.createInvoice = originalCreateInvoice;
  };
}

async function setup() {
  await connectDB();
  await resetDB();
  const auth = await createDashboardAuth("admin");
  adminHeader = auth.headers;
}

function appAuth(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

(async function run() {
  const restoreMoyasar = installMoyasarMock();
  try {
    await setup();
    const app = createApp();
    const api = request(app);

    const user = await User.create({
      phone: "+966500000000",
      name: "Test User",
      role: "client",
      isActive: true,
    });

    await Setting.create({ key: "vat_percentage", value: 15 });

    let category, product, group, option;

    await test("Setup: Create initial menu structure", async () => {
      let res = await api.post("/api/dashboard/menu/categories").set(dashboardAuth()).send({
        key: "salads",
        name: { en: "Salads", ar: "سلطات" },
      });
      category = res.body.data;

      res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
        categoryId: category.id,
        key: "basic_salad",
        name: { en: "Basic Salad", ar: "سلطة بيسك" },
        itemType: "basic_salad",
        pricingModel: "per_100g",
        priceHalala: 2900,
        baseUnitGrams: 100,
      });
      product = res.body.data;

      // Create dummy ones for validation to pass later
      await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
        categoryId: category.id,
        key: "basic_meal",
        name: { en: "Basic Meal", ar: "وجبة بيسك" },
        itemType: "basic_meal",
        pricingModel: "per_100g",
        priceHalala: 1900,
        baseUnitGrams: 100,
      });
      await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
        categoryId: category.id,
        key: "fruit_salad",
        name: { en: "Fruit Salad", ar: "سلطة فواكه" },
        itemType: "fruit_salad",
        pricingModel: "fixed",
        priceHalala: 1700,
      });
      await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
        categoryId: category.id,
        key: "greek_yogurt",
        name: { en: "Greek Yogurt", ar: "زبادي يوناني" },
        itemType: "greek_yogurt",
        pricingModel: "fixed",
        priceHalala: 1700,
      });

      res = await api.post("/api/dashboard/menu/option-groups").set(dashboardAuth()).send({
        key: "proteins",
        name: { en: "Proteins", ar: "بروتينات" },
      });
      group = res.body.data;

      res = await api.post("/api/dashboard/menu/options").set(dashboardAuth()).send({
        groupId: group.id,
        key: "chicken",
        name: { en: "Chicken", ar: "دجاج" },
        extraWeightUnitGrams: 50,
        extraWeightPriceHalala: 500,
      });
      option = res.body.data;

      await api.post(`/api/dashboard/menu/products/${product.id}/option-groups`).set(dashboardAuth()).send({
        groupId: group.id,
        minSelections: 1,
        maxSelections: 1,
      });

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Initial publish" });
    });

    await test("Dashboard product composer hydrates product, group relations, option overrides, and validation", async () => {
      const res = await api.get(`/api/dashboard/menu/products/${product.id}/composer`).set(dashboardAuth());
      expectStatus(res, 200, "product composer");
      assert.strictEqual(res.body.status, true);

      const data = res.body.data;
      assert.strictEqual(data.contractVersion, "dashboard_product_composer.v3");
      assert.strictEqual(data.product.id, product.id);
      assert.strictEqual(data.product.key, "basic_salad");
      assert.strictEqual(data.category.id, category.id);
      assert.strictEqual(data.customization.isCustomizable, true);
      assert(Array.isArray(data.customization.linkedGroups), "composer linkedGroups is array");
      assert(!Object.prototype.hasOwnProperty.call(data, "linkedOptionGroups"), "composer omits legacy linkedOptionGroups root alias");
      assert(!Object.prototype.hasOwnProperty.call(data.product, "optionGroups"), "composer omits product optionGroups alias");
      assert(!Object.prototype.hasOwnProperty.call(data.product, "groups"), "composer omits product groups alias");

      const linkedGroup = data.customization.linkedGroups.find((item) => item.groupId === group.id);
      assert(linkedGroup, "composer includes linked group");
      assert.strictEqual(linkedGroup.key, "proteins");
      assert.strictEqual(linkedGroup.rules.minSelections, 1);
      assert.strictEqual(linkedGroup.rules.maxSelections, 1);
      assert.strictEqual(linkedGroup.rules.isRequired, true);
      assert(Array.isArray(linkedGroup.options), "composer linked group options is array");

      const linkedOption = linkedGroup.options.find((item) => item.optionId === option.id);
      assert(linkedOption, "composer includes linked option");
      assert.strictEqual(linkedOption.key, "chicken");
      assert.strictEqual(linkedOption.overridePricing.extraPriceHalala, null);
      assert.strictEqual(linkedOption.effectivePricing.extraWeightUnitGrams, 50);
      assert.strictEqual(linkedOption.effectivePricing.extraWeightPriceHalala, 500);
      assert.strictEqual(data.validation.ok, true);
      assert(Array.isArray(data.validation.errors), "composer validation errors array");
      assert(Array.isArray(data.validation.warnings), "composer validation warnings array");
    });

    await test("A) extraWeightUnitGrams override", async () => {
      // Current menu shows 50 (from option)
      let res = await api.get("/api/orders/menu?lang=en");
      let p = res.body.data.categories[0].products.find(x => x.key === "basic_salad");
      let opt = p.optionGroups[0].options[0];
      assert.strictEqual(opt.extraWeightUnitGrams, 50, "Default weight unit");

      // Override via dashboard
      res = await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${option.id}`)
        .set(dashboardAuth())
        .send({ extraWeightUnitGrams: 100 });
      expectStatus(res, 200, "Update override");

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Update override" });

      res = await api.get("/api/orders/menu?lang=en");
      p = res.body.data.categories[0].products.find(x => x.key === "basic_salad");
      opt = p.optionGroups[0].options[0];
      assert.strictEqual(opt.extraWeightUnitGrams, 100, "Overridden weight unit");

      // Verify quote usage (pricing)
      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: product.id,
          qty: 1,
          weightGrams: 100,
          selectedOptions: [{ groupId: group.id, optionId: option.id, extraWeightGrams: 100, qty: 1 }]
        }]
      });
      expectStatus(res, 200, "Quote with extra weight");
      assert.strictEqual(res.body.data.pricing.totalHalala, 3400, "Correct price with overridden weight unit");
    });

    await test("B) Disable option override availability", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${option.id}/availability`)
        .set(dashboardAuth())
        .send({ isAvailable: false });
      expectStatus(res, 200, "Disable option availability");

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Disable option" });

      res = await api.get("/api/orders/menu?lang=en");
      let p = res.body.data.categories[0].products.find(x => x.key === "basic_salad");
      assert.strictEqual(p.optionGroups[0].options.length, 0, "Option should be hidden from mobile menu when unavailable");

      res = await api.get(`/api/dashboard/menu/products/${product.id}/composer`).set(dashboardAuth());
      expectStatus(res, 200, "Composer reflects disabled option");
      const disabledComposerGroup = res.body.data.customization.linkedGroups.find((item) => item.groupId === group.id);
      const disabledComposerOption = disabledComposerGroup.options.find((item) => item.optionId === option.id);
      assert.strictEqual(disabledComposerOption.status.isAvailable, false, "Composer reflects option availability edit");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: product.id,
          qty: 1,
          weightGrams: 100,
          selectedOptions: [{ groupId: group.id, optionId: option.id, qty: 1 }]
        }]
      });
      expectStatus(res, 409, "Quote rejected for unavailable option");
      assert.strictEqual(res.body.error.code, "OPTION_NOT_AVAILABLE");

      // Re-enable
      await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${option.id}/availability`)
        .set(dashboardAuth())
        .send({ isAvailable: true });
      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Enable option" });
    });

    await test("C) Add new option to Basic Salad", async () => {
      let res = await api.post("/api/dashboard/menu/options").set(dashboardAuth()).send({
        groupId: group.id,
        key: "beef",
        name: { en: "Beef", ar: "لحم" },
        extraPriceHalala: 1000,
      });
      const beefOption = res.body.data;

      // Link it
      await api.post(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options`)
        .set(dashboardAuth())
        .send({ optionId: beefOption.id });

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Add beef" });

      res = await api.get("/api/orders/menu?lang=en");
      let p = res.body.data.categories[0].products.find(x => x.key === "basic_salad");
      assert.strictEqual(p.optionGroups[0].options.length, 2, "Chicken and beef linked");
    });

    await test("D) Update maxSelections", async () => {
      let res = await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/selection-rules`)
        .set(dashboardAuth())
        .send({ minSelections: 1, maxSelections: 2 });
      expectStatus(res, 200, "Update rules");

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Update rules" });

      res = await api.get("/api/orders/menu?lang=en");
      let p = res.body.data.categories[0].products.find(x => x.key === "basic_salad");
      assert.strictEqual(p.optionGroups[0].maxSelections, 2, "Menu reflects new maxSelections");

      res = await api.get(`/api/dashboard/menu/products/${product.id}/composer`).set(dashboardAuth());
      expectStatus(res, 200, "Composer reflects updated rules");
      const composerGroup = res.body.data.customization.linkedGroups.find((item) => item.groupId === group.id);
      assert(composerGroup, "Composer includes updated linked group");
      assert.strictEqual(composerGroup.rules.minSelections, 1, "Composer reflects minSelections edit");
      assert.strictEqual(composerGroup.rules.maxSelections, 2, "Composer reflects maxSelections edit");
      assert.strictEqual(res.body.data.validation.ok, true, "Composer validation remains ok after rule edit");

      // Verify quote enforcement
      const beefOption = p.optionGroups[0].options.find(o => o.key === "beef");
      const chickenOption = p.optionGroups[0].options.find(o => o.key === "chicken");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: product.id,
          qty: 1,
          weightGrams: 100, // required for per_100g
          selectedOptions: [
            { groupId: group.id, optionId: chickenOption.id, qty: 1 },
            { groupId: group.id, optionId: beefOption.id, qty: 1 },
            { groupId: group.id, optionId: chickenOption.id, qty: 1 }, // 3 selections
          ]
        }]
      });
      expectStatus(res, 400, "Quote rejected for exceeding maxSelections");
      assert.strictEqual(res.body.error.code, "MAX_SELECTIONS_EXCEEDED");
    });

    await test("E) Update extraPriceHalala", async () => {
      const allOptRelations = await ProductGroupOption.find({ productId: product.id }).lean();
      const beefRelation = allOptRelations.find(r => String(r.optionId) !== String(option.id));
      const beefOptionId = String(beefRelation.optionId);
      
      let res = await api.patch(`/api/dashboard/menu/products/${product.id}/option-groups/${group.id}/options/${beefOptionId}`)
        .set(dashboardAuth())
        .send({ extraPriceHalala: 1500 });
      expectStatus(res, 200, "Update beef price override");

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Update beef price" });

      res = await api.get(`/api/dashboard/menu/products/${product.id}/composer`).set(dashboardAuth());
      expectStatus(res, 200, "Composer reflects option override");
      const overrideComposerGroup = res.body.data.customization.linkedGroups.find((item) => item.groupId === group.id);
      const overrideComposerOption = overrideComposerGroup.options.find((item) => item.optionId === beefOptionId);
      assert.strictEqual(overrideComposerOption.overridePricing.extraPriceHalala, 1500, "Composer exposes override price");
      assert.strictEqual(overrideComposerOption.effectivePricing.extraPriceHalala, 1500, "Composer exposes effective override price");

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{
          productId: product.id,
          qty: 1,
          weightGrams: 100,
          selectedOptions: [{ groupId: group.id, optionId: beefOptionId, qty: 1 }]
        }]
      });
      assert.strictEqual(res.body.data.pricing.totalHalala, 4400, "Quote uses updated extraPriceHalala override");
    });

    await test("F) Fixed product price update", async () => {
      let res = await api.post("/api/dashboard/menu/products").set(dashboardAuth()).send({
        categoryId: category.id,
        key: "water",
        name: { en: "Water", ar: "مياه" },
        pricingModel: "fixed",
        priceHalala: 200,
      });
      const water = res.body.data;

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Add water" });

      res = await api.patch(`/api/dashboard/menu/products/${water.id}`).set(dashboardAuth()).send({ priceHalala: 300 });
      expectStatus(res, 200, "Update water price");

      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Update water price" });

      res = await api.post("/api/orders/quote").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        items: [{ productId: water.id, qty: 1, selectedOptions: [] }]
      });
      assert.strictEqual(res.body.data.pricing.totalHalala, 300, "Quote uses updated fixed price");
    });

    await test("G) Snapshot immutability", async () => {
      const water = await MenuProduct.findOne({ key: "water" });
      
      const createRes = await api.post("/api/orders").set(appAuth(user._id)).send({
        fulfillmentMethod: "pickup",
        idempotencyKey: "weekly-menu-dashboard-water-snapshot",
        items: [{ productId: String(water._id), qty: 1, selectedOptions: [] }]
      });
      expectStatus(createRes, 201, "Create water order");
      const orderId = createRes.body.data.orderId;

      await api.patch(`/api/dashboard/menu/products/${water._id}`).set(dashboardAuth()).send({ priceHalala: 500 });
      await api.post("/api/dashboard/menu/publish").set(dashboardAuth()).send({ notes: "Change water price" });

      const res = await api.get(`/api/orders/${orderId}`).set(appAuth(user._id));
      assert.strictEqual(res.body.data.pricing.totalHalala, 300, "Old order price unchanged (as expected)");
      assert(res.body.data.items[0], "Order item exists");
      // Snapshot should be in the DB even if not in response, but I updated serialization to include it
      assert(res.body.data.items[0].productSnapshot, "Product snapshot exists in response");
      assert.strictEqual(res.body.data.items[0].productSnapshot.priceHalala, 300, "Snapshot preserved");
    });

    await test("H) Validation endpoint", async () => {
      let res = await api.post("/api/dashboard/menu/validate").set(dashboardAuth());
      expectStatus(res, 200, "Validate valid menu");
      assert.strictEqual(res.body.data.ok, true, "Menu should be valid initially");

      // Break it: Inactive required custom product
      await MenuProduct.updateOne({ key: "greek_yogurt" }, { $set: { isActive: false } });

      res = await api.post("/api/dashboard/menu/validate").set(dashboardAuth());
      assert.strictEqual(res.body.data.ok, false, "Menu invalid due to inactive required product");
      assert(res.body.data.errors.some(e => e.includes("Missing required custom product: greek_yogurt")), "Error message correct");

      // Fix it
      await MenuProduct.updateOne({ key: "greek_yogurt" }, { $set: { isActive: true } });

      // Break it: minSelections > options
      await ProductOptionGroup.updateOne({ productId: product.id }, { $set: { minSelections: 10 } });
      res = await api.post("/api/dashboard/menu/validate").set(dashboardAuth());
      assert.strictEqual(res.body.data.ok, false, "Menu invalid due to impossible selection rule");
      assert(res.body.data.errors.some(e => e.includes("minSelections is 10")), "Error message correct");
    });

  } finally {
    restoreMoyasar();
    await cleanupDashboardUsers();
    await disconnectDB();
  }

  console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exitCode = 1;
})();
