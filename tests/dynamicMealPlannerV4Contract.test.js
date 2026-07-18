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
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dynamic_meal_planner_v4_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(
    res.status,
    status,
    `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`
  );
}

async function seedMenu() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "meals",
    name: { ar: "الوجبات", en: "Meals" },
    publishedAt: now,
  });
  const products = await MenuProduct.insertMany(
    Array.from({ length: 125 }, (_, index) => ({
      categoryId: category._id,
      key: `meal_${String(index + 1).padStart(3, "0")}`,
      name: { ar: `وجبة ${index + 1}`, en: `Meal ${index + 1}` },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 1000 + index,
      availableFor: ["one_time", "subscription"],
      publishedAt: now,
      sortOrder: index + 1,
    }))
  );
  const premiumProduct = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_dynamic_product",
    name: { ar: "وجبة مميزة ديناميكية", en: "Dynamic Premium Meal" },
    itemType: "full_meal_product",
    pricingModel: "fixed",
    priceHalala: 2500,
    availableFor: ["subscription"],
    publishedAt: now,
    sortOrder: 500,
  });
  await PremiumUpgradeConfig.create({
    sourceType: "menu_product",
    sourceId: premiumProduct._id,
    selectionType: "premium_large_salad",
    premiumKey: "premium_dynamic_product",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 700,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 1,
    sourceSnapshot: {
      key: premiumProduct.key,
      name: premiumProduct.name,
      context: {},
    },
  });
  return { products, premiumProduct };
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const auth = await dashboardAuth("admin", "meal-planner-v4");
    const { products, premiumProduct } = await seedMenu();

    const picker = await request(app)
      .get("/api/dashboard/meal-builder/pickers/new_dynamic_section?limit=500")
      .set(auth.headers);
    expectStatus(picker, 200, "product picker");
    assert.strictEqual(picker.body.data.contractVersion, "meal_planner_menu.v4");
    assert.strictEqual(picker.body.data.candidateType, "product");
    assert.strictEqual(picker.body.data.meta.total, 126);
    assert.strictEqual(picker.body.data.candidates.length, 126);

    const createDraft = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({
        sections: [{
          key: "premium",
          sectionType: "product_list",
          sourceKind: "premium_visual",
          titleOverride: { ar: "الوجبات المميزة", en: "Premium Meals" },
          selectedProductIds: [],
          includeMode: "selected",
          selectionType: "premium",
          sortOrder: 10,
          metadata: { premiumDynamic: true },
        }],
      });
    expectStatus(createDraft, 201, "create draft");
    const firstHash = createDraft.body.data.draftHash;
    assert.ok(firstHash);

    const createSection = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "chef_choices",
        titleOverride: { ar: "اختيارات الشيف", en: "Chef Choices" },
        sectionType: "product_list",
        sourceKind: "product_list",
        sortOrder: 20,
        expectedDraftHash: firstHash,
      });
    expectStatus(createSection, 201, "create dynamic section");
    const secondHash = createSection.body.data.draft.draftHash;
    assert.notStrictEqual(secondHash, firstHash);

    const addProducts = await request(app)
      .post("/api/dashboard/meal-builder/sections/chef_choices/products")
      .set(auth.headers)
      .send({
        productIds: [String(products[0]._id), String(products[124]._id)],
        expectedDraftHash: secondHash,
      });
    expectStatus(addProducts, 200, "add products");
    const thirdHash = addProducts.body.data.draft.draftHash;

    const staleRemove = await request(app)
      .delete(`/api/dashboard/meal-builder/sections/chef_choices/products/${products[0]._id}`)
      .set(auth.headers)
      .send({ expectedDraftHash: secondHash });
    expectStatus(staleRemove, 409, "stale hash protection");
    assert.strictEqual(staleRemove.body.error.code, "MEAL_PLANNER_DRAFT_CONFLICT");

    const removeProduct = await request(app)
      .delete(`/api/dashboard/meal-builder/sections/chef_choices/products/${products[0]._id}`)
      .set(auth.headers)
      .send({ expectedDraftHash: thirdHash });
    expectStatus(removeProduct, 200, "remove product");
    const fourthHash = removeProduct.body.data.draft.draftHash;

    const hydrated = await request(app)
      .get("/api/dashboard/meal-builder/draft/hydrated")
      .set(auth.headers);
    expectStatus(hydrated, 200, "hydrated draft");
    const chefDraftSection = hydrated.body.data.sections.find((section) => section.key === "chef_choices");
    assert.ok(chefDraftSection);
    assert.strictEqual(chefDraftSection.products.length, 1);
    assert.strictEqual(chefDraftSection.products[0].id, String(products[124]._id));

    const publish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ expectedDraftHash: fourthHash });
    expectStatus(publish, 200, "publish planner");
    assert.strictEqual(publish.body.data.contract.contractVersion, "meal_planner_menu.v4");

    const publicOne = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicOne, 200, "public planner first read");
    assert.strictEqual(publicOne.body.data.contractVersion, "meal_planner_menu.v4");
    assert.ok(publicOne.body.data.catalogHash);
    assert.strictEqual(publicOne.body.data.builderCatalog, undefined);
    assert.strictEqual(publicOne.body.data.builderCatalogV2, undefined);
    assert.strictEqual(publicOne.body.data.plannerCatalog, undefined);
    assert.match(publicOne.headers["cache-control"], /no-store/);

    const chefSection = publicOne.body.data.sections.find((section) => section.key === "chef_choices");
    assert.ok(chefSection);
    assert.strictEqual(chefSection.products.length, 1);
    assert.strictEqual(chefSection.products[0].id, String(products[124]._id));

    const premiumSection = publicOne.body.data.sections.find((section) => section.key === "premium");
    assert.ok(premiumSection);
    assert.strictEqual(premiumSection.managedBy, "premium_upgrades");
    assert.ok(premiumSection.products.some((product) => product.id === String(premiumProduct._id)));

    const publicTwo = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicTwo, 200, "public planner second read");
    assert.strictEqual(publicTwo.body.data.catalogHash, publicOne.body.data.catalogHash);

    await MenuProduct.updateOne({ _id: products[124]._id }, { $set: { priceHalala: 9999 } });
    const publicThree = await request(app).get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(publicThree, 200, "public planner after catalog update");
    assert.notStrictEqual(publicThree.body.data.catalogHash, publicOne.body.data.catalogHash);
    const updatedChef = publicThree.body.data.sections.find((section) => section.key === "chef_choices");
    assert.strictEqual(updatedChef.products[0].pricing.priceHalala, 9999);

    console.log("dynamicMealPlannerV4Contract.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
