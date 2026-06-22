process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const Subscription = require("../src/models/Subscription");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const {
  createDashboardAddonPlan,
  deleteDashboardAddonPlan,
  listDashboardAddonPlans,
  toggleAddonPlanActive,
  updateAddonPlan,
} = require("../src/controllers/addonController");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, { body = {}, params = {}, query = {} } = {}) {
  const res = response();
  await handler({ body, params, query }, res);
  return res;
}

const planKeys = ["archivedAt", "category", "id", "isActive", "isArchived", "kind", "maxPerDay", "menuProductIds", "menuProducts", "name", "planPrices", "type"];
const productKeys = ["category", "id", "image", "isActive", "key", "name"];
const priceKeys = ["basePlanId", "basePlanName", "daysCount", "isActive", "mealsCount", "priceHalala", "priceLabel", "priceSar"];

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(`dashboard_addon_plan_crud_${Date.now()}`));

  try {
    const category = await MenuCategory.create({
      key: "snacks",
      name: { ar: "وجبات خفيفة", en: "Snacks" },
      isActive: true,
    });
    const product = await MenuProduct.create({
      categoryId: category._id,
      key: "yogurt_cup_contract",
      name: { ar: "كوب زبادي", en: "Yogurt Cup" },
      priceHalala: 900,
      availableFor: ["subscription"],
      isActive: true,
    });
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

    const createBody = {
      name: { ar: "اشتراك الزبادي", en: "Yogurt Subscription" },
      category: "snack",
      maxPerDay: 1,
      isActive: true,
      menuProductIds: [String(product._id)],
      planPrices: [{ basePlanId: String(basePlan._id), priceHalala: 7000, isActive: true }],
    };
    const created = await invoke(createDashboardAddonPlan, { body: createBody });
    assert.strictEqual(created.statusCode, 201);
    assert.deepStrictEqual(Object.keys(created.body.data).sort(), planKeys);
    assert.deepStrictEqual(Object.keys(created.body.data.menuProducts[0]).sort(), productKeys);
    assert.deepStrictEqual(Object.keys(created.body.data.planPrices[0]).sort(), priceKeys);
    assert.strictEqual(created.body.data.menuProducts[0].id, String(product._id));
    assert.strictEqual(created.body.data.planPrices[0].basePlanId, String(basePlan._id));
    assert.strictEqual(created.body.data.planPrices[0].priceHalala, 7000);
    const addonId = created.body.data.id;

    assert.strictEqual(await MenuProduct.countDocuments(), 1, "POST links products; it must not create them");
    assert.strictEqual(await AddonPlanPrice.countDocuments({ addonPlanId: addonId, basePlanId: basePlan._id }), 1);
    const stored = await Addon.findById(addonId).lean();
    assert.strictEqual(stored.kind, "plan");
    assert.strictEqual(stored.type, "subscription");
    assert.strictEqual(stored.pricingModel, "subscription");

    await Addon.create({
      name: { ar: "حلوى صحية", en: "Healthy Dessert" },
      kind: "item",
      category: "snack",
      priceHalala: 1000,
      billingMode: "flat_once",
      isActive: true,
    });
    const decoyPlan = await Addon.create({
      name: { ar: "صندوق سناك", en: "Snack Box" },
      kind: "plan",
      category: "snack",
      priceHalala: 0,
      billingMode: "per_day",
      isActive: true,
    });

    const listed = await invoke(listDashboardAddonPlans, { query: { view: "full", kind: "item" } });
    assert.strictEqual(listed.statusCode, 200);
    assert.deepStrictEqual(listed.body.data.items, []);
    assert.strictEqual(listed.body.data.plans.length, 2);
    assert.ok(listed.body.data.plans.some((plan) => plan.id === addonId));
    assert.ok(listed.body.data.plans.some((plan) => plan.id === String(decoyPlan._id)));
    assert.strictEqual(listed.body.data.summary.plansCount, 2);
    assert.strictEqual(listed.body.data.summary.matrixRowsCount, 1);

    const updated = await invoke(updateAddonPlan, {
      params: { id: addonId },
      body: {
        name: { ar: "اشتراك الزبادي المطور", en: "Updated Yogurt Subscription" },
        category: "snack",
        maxPerDay: 0,
        menuProductIds: [String(product._id)],
        planPrices: [{ basePlanId: String(basePlan._id), priceHalala: 7500, isActive: true }],
      },
    });
    assert.strictEqual(updated.statusCode, 200);
    assert.deepStrictEqual(Object.keys(updated.body.data).sort(), planKeys);
    assert.strictEqual(updated.body.data.maxPerDay, 0);
    assert.strictEqual(updated.body.data.planPrices[0].priceHalala, 7500);

    const invalidCases = [
      [{ ...createBody, name: { ar: "", en: "Missing Arabic" } }, "name.ar"],
      [{ ...createBody, isActive: "true" }, "isActive"],
      [{ ...createBody, menuProductIds: [] }, "menuProductIds"],
      [{ ...createBody, planPrices: [] }, "planPrices"],
      [{ ...createBody, menuProductIds: [String(new mongoose.Types.ObjectId())] }, "menuProductIds"],
      [{ ...createBody, planPrices: [{ basePlanId: String(new mongoose.Types.ObjectId()), priceHalala: 1 }] }, "basePlanIds"],
      [{ ...createBody, planPrices: [{ basePlanId: String(basePlan._id), priceHalala: -1 }] }, "priceHalala"],
    ];
    for (const [body, messageFragment] of invalidCases) {
      const invalid = await invoke(createDashboardAddonPlan, { body });
      assert.strictEqual(invalid.statusCode, 400);
      assert.ok(invalid.body.error.message.includes(messageFragment), invalid.body.error.message);
    }
    assert.strictEqual(await MenuProduct.countDocuments(), 1);

    const subscriptionId = new mongoose.Types.ObjectId();
    await Subscription.collection.insertOne({
      _id: subscriptionId,
      addonSubscriptions: [{ addonId: new mongoose.Types.ObjectId(addonId), category: "snack" }],
      addonSelections: [{ addonId: new mongoose.Types.ObjectId(addonId), qty: 1 }],
    });

    const toggled = await invoke(toggleAddonPlanActive, { params: { id: addonId } });
    assert.strictEqual(toggled.statusCode, 200);
    assert.strictEqual(toggled.body.data.isActive, false);
    assert.strictEqual(await AddonPlanPrice.countDocuments({ addonPlanId: addonId }), 1, "toggle must retain matrix rows");

    const inactive = await invoke(listDashboardAddonPlans, { query: { status: "inactive" } });
    const inactivePlan = inactive.body.data.plans.find((plan) => plan.id === addonId);
    assert.ok(inactivePlan, "inactive plan must remain manageable");
    assert.strictEqual(inactivePlan.isActive, false);

    const allAfterToggle = await invoke(listDashboardAddonPlans, { query: { status: "all" } });
    assert.ok(allAfterToggle.body.data.plans.some((plan) => plan.id === addonId));

    const archived = await invoke(deleteDashboardAddonPlan, { params: { id: addonId } });
    assert.strictEqual(archived.statusCode, 200);
    assert.strictEqual(archived.body.data.id, addonId);
    assert.strictEqual(archived.body.data.archived, true);
    assert.strictEqual(archived.body.data.isActive, false);
    assert.strictEqual(archived.body.data.isArchived, true);
    assert.ok(archived.body.data.archivedAt);
    const storedAfterArchive = await Addon.findById(addonId);
    assert.ok(storedAfterArchive, "archive must retain the plan for historical references");
    assert.strictEqual(storedAfterArchive.isArchived, true);
    assert.ok(storedAfterArchive.archivedAt);
    assert.strictEqual(await AddonPlanPrice.countDocuments({ addonPlanId: addonId }), 1, "archive must retain matrix history");
    const storedSubscription = await Subscription.collection.findOne({ _id: subscriptionId });
    assert.strictEqual(storedSubscription.addonSubscriptions.length, 1, "archive must retain subscription entitlements");
    assert.strictEqual(storedSubscription.addonSelections.length, 1, "archive must retain addon selections");

    const afterArchive = await invoke(listDashboardAddonPlans);
    const archivedInDefault = afterArchive.body.data.plans.find((plan) => plan.id === addonId);
    assert.ok(archivedInDefault, "default dashboard list must be management-safe and include archived plans");
    assert.strictEqual(archivedInDefault.isArchived, true);
    assert.ok(archivedInDefault.archivedAt);

    const archivedOnly = await invoke(listDashboardAddonPlans, { query: { status: "archived" } });
    assert.deepStrictEqual(archivedOnly.body.data.plans.map((plan) => plan.id), [addonId]);
    console.log("Dashboard add-on subscription plan CRUD contract passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
