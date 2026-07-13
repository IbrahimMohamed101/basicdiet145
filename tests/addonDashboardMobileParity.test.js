process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const menuCatalogService = require("../src/services/orders/menuCatalogService");
const {
  buildAddonChoicesCatalog,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  createDashboardAddonPlan,
  listDashboardAddonPlans,
  updateAddonPlan,
} = require("../src/controllers/addonController");
const {
  getSubscriptionAddonChoices,
} = require("../src/controllers/subscriptionController");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(handler, { body = {}, params = {}, query = {}, headers = {} } = {}) {
  const res = response();
  await handler({ body, params, query, headers }, res);
  return res;
}

function ids(rows) {
  return rows.map((row) => String(row.id || row._id));
}

async function main() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(`addon_dashboard_mobile_parity_${Date.now()}`));

  try {
    const category = await MenuCategory.create({
      key: "juices",
      name: { ar: "العصائر", en: "Juices" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      sortOrder: 1,
    });

    const eligibleProducts = await MenuProduct.create(
      Array.from({ length: 5 }, (_, index) => ({
        categoryId: category._id,
        key: `addon_parity_juice_${index + 1}`,
        name: { ar: `عصير ${index + 1}`, en: `Juice ${index + 1}` },
        description: { ar: "", en: "" },
        priceHalala: 900 + (index * 100),
        currency: "SAR",
        itemType: "juice",
        availableFor: index % 2 === 0 ? ["one_time"] : ["one_time", "subscription"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: index + 1,
      }))
    );

    await MenuProduct.create([
      {
        categoryId: category._id,
        key: "addon_parity_hidden",
        name: { ar: "مخفي", en: "Hidden" },
        priceHalala: 1500,
        itemType: "juice",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: false,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: category._id,
        key: "addon_parity_unavailable",
        name: { ar: "غير متاح", en: "Unavailable" },
        priceHalala: 1600,
        itemType: "juice",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: false,
        publishedAt: new Date(),
      },
      {
        categoryId: category._id,
        key: "addon_parity_archived",
        name: { ar: "مؤرشف", en: "Archived" },
        priceHalala: 1700,
        itemType: "juice",
        availableFor: ["one_time"],
        isActive: false,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        archivedAt: new Date(),
      },
    ]);

    const pickerQuery = {
      view: "picker",
      context: "addon_plan",
      linkableFor: "addon_plan",
      isVisible: "true",
      isAvailable: "true",
    };
    const pickerProducts = await menuCatalogService.listProducts(pickerQuery);
    assert.deepStrictEqual(ids(pickerProducts), ids(eligibleProducts));
    assert.strictEqual(pickerProducts.length, 5, "picker must not have an implicit three-product cap");

    const pickerCategories = await menuCatalogService.listCategories(pickerQuery);
    assert.strictEqual(pickerCategories.length, 1);
    assert.strictEqual(pickerCategories[0].productsCount, pickerProducts.length);

    const basePlan = await Plan.create({
      name: { ar: "سبعة أيام", en: "Seven Days" },
      daysCount: 7,
      durationDays: 7,
      active: true,
      available: true,
      isAvailable: true,
      isActive: true,
      currency: "SAR",
    });
    const configuredIds = [
      eligibleProducts[2],
      eligibleProducts[0],
      eligibleProducts[4],
      eligibleProducts[1],
      eligibleProducts[3],
    ].map((product) => String(product._id));
    const createBody = {
      name: { ar: "خطة عصائر", en: "Juice Plan" },
      category: "juice",
      maxPerDay: 8,
      isActive: true,
      menuProductIds: configuredIds,
      planPrices: [{
        basePlanId: String(basePlan._id),
        priceHalala: 7000,
        isActive: true,
      }],
    };
    const created = await invoke(createDashboardAddonPlan, { body: createBody });
    assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
    assert.deepStrictEqual(created.body.data.menuProductIds, configuredIds);
    assert.deepStrictEqual(created.body.data.resolvedMenuProductIds, configuredIds);
    assert.strictEqual(created.body.data.resolvedMenuProductsCount, 5);
    assert.deepStrictEqual(ids(created.body.data.menuProducts), configuredIds);

    const updatedIds = [
      configuredIds[4],
      configuredIds[1],
      configuredIds[3],
      configuredIds[0],
    ];
    const updated = await invoke(updateAddonPlan, {
      params: { id: created.body.data.id },
      body: {
        ...createBody,
        name: { ar: "خطة عصائر محدثة", en: "Updated Juice Plan" },
        menuProductIds: updatedIds,
      },
    });
    assert.strictEqual(updated.statusCode, 200, JSON.stringify(updated.body));
    assert.deepStrictEqual(updated.body.data.menuProductIds, updatedIds);
    assert.deepStrictEqual(updated.body.data.resolvedMenuProductIds, updatedIds);
    assert.deepStrictEqual(ids(updated.body.data.menuProducts), updatedIds);

    const staleId = new mongoose.Types.ObjectId();
    await Addon.updateOne(
      { _id: created.body.data.id },
      { $push: { menuProductIds: staleId } }
    );
    const listed = await invoke(listDashboardAddonPlans);
    const listedPlan = listed.body.data.plans.find((plan) => plan.id === created.body.data.id);
    assert.deepStrictEqual(
      listedPlan.menuProductIds,
      [...updatedIds, String(staleId)],
      "historical IDs must remain stored for diagnosis"
    );
    assert.deepStrictEqual(listedPlan.resolvedMenuProductIds, updatedIds);
    assert.strictEqual(listedPlan.resolvedMenuProductsCount, updatedIds.length);

    const subscription = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      clientId: new mongoose.Types.ObjectId(),
      planId: basePlan._id,
      status: "active",
      totalMeals: 7,
      remainingMeals: 7,
      duration: 7,
      addonSubscriptions: [{
        addonId: created.body.data.id,
        addonPlanId: created.body.data.id,
        category: "juice",
        menuProductIds: configuredIds.slice(0, 3),
      }],
    });

    const choices = await buildAddonChoicesCatalog({
      lang: "en",
      category: "juice",
      subscriptionId: String(subscription._id),
    });
    assert.deepStrictEqual(ids(choices.juice.choices), ids(eligibleProducts));
    assert(choices.juice.choices.every((choice) => choice.isEligibleForAllowance === true));

    const choicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { category: "juice", subscriptionId: String(subscription._id) },
      headers: { "accept-language": "en" },
    });
    assert.strictEqual(choicesResponse.statusCode, 200);
    assert.deepStrictEqual(ids(choicesResponse.body.data.juice.choices), ids(eligibleProducts));

    await MenuProduct.updateOne(
      { _id: eligibleProducts[4]._id },
      { $set: { isVisible: false } }
    );
    const afterVisibilityProducts = await menuCatalogService.listProducts(pickerQuery);
    const afterVisibilityCategories = await menuCatalogService.listCategories(pickerQuery);
    const afterVisibilityChoices = await buildAddonChoicesCatalog({
      lang: "en",
      category: "juice",
      subscriptionId: String(subscription._id),
    });
    assert.strictEqual(afterVisibilityProducts.length, 4);
    assert.strictEqual(afterVisibilityCategories[0].productsCount, 4);
    assert.strictEqual(afterVisibilityChoices.juice.choices.length, 4);
    assert.deepStrictEqual(listedPlan.menuProductIds, [...updatedIds, String(staleId)]);

    console.log("Add-on dashboard and mobile parity test passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
