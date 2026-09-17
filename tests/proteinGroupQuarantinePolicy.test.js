"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "protein-quarantine-jwt-test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "protein-quarantine-dashboard-test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const {
  LEGITIMATE_PROTEIN_CONTEXTS,
  VERIFIED_FIXTURE_GROUPS,
  VERIFIED_FIXTURE_PRODUCT_IDS,
} = require("../src/services/orders/menuOptionGroupDashboardPolicy");

async function main() {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri(`protein_group_quarantine_${Date.now()}_test`);
  process.env.MONGO_URI_TEST = uri;
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "protein_quarantine_test_category",
      name: { ar: "اختبار", en: "Test" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    await MenuOptionGroup.insertMany([
      ...LEGITIMATE_PROTEIN_CONTEXTS.map((context, index) => ({
        _id: new mongoose.Types.ObjectId(context.id),
        key: context.key,
        name: { ar: `شرعي ${index}`, en: `Legitimate ${index}` },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: index,
      })),
      ...VERIFIED_FIXTURE_GROUPS.map((fixture, index) => ({
        _id: new mongoose.Types.ObjectId(fixture.id),
        key: fixture.key,
        name: { ar: "البروتين", en: "Protein" },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
        sortOrder: 20 + index,
      })),
    ]);

    await MenuProduct.create({
      _id: new mongoose.Types.ObjectId(VERIFIED_FIXTURE_PRODUCT_IDS[0]),
      categoryId: category._id,
      key: "pickup_slot_append_1785284024734_mixed_standard_meal",
      name: { ar: "منتج اختبار", en: "Fixture Product" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 0,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    const fixtureGroup = VERIFIED_FIXTURE_GROUPS[0];
    const fixtureOption = await MenuOption.create({
      groupId: new mongoose.Types.ObjectId(fixtureGroup.id),
      key: "pickup_slot_append_1785284024734_mixed_standard_option",
      name: { ar: "خيار اختبار", en: "Fixture Option" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });

    const historicalDayId = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection("subscriptiondays").insertOne({
      _id: historicalDayId,
      subscriptionId: new mongoose.Types.ObjectId(),
      date: "2026-07-29",
      status: "fulfilled",
      mealSlots: [{
        slotIndex: 1,
        productId: new mongoose.Types.ObjectId(VERIFIED_FIXTURE_PRODUCT_IDS[0]),
        selectedOptions: [{
          groupId: new mongoose.Types.ObjectId(fixtureGroup.id),
          optionId: fixtureOption._id,
        }],
      }],
    });

    const api = request(createApp());
    const { headers: adminHeaders } = await dashboardAuth("admin", "protein-quarantine-admin");
    const { headers: restaurantHeaders } = await dashboardAuth("restaurant", "protein-quarantine-restaurant");

    let response = await api.get("/api/dashboard/menu/option-groups").set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const normalGroups = response.body.data;
    assert.deepStrictEqual(
      normalGroups.map((group) => group.id).sort(),
      LEGITIMATE_PROTEIN_CONTEXTS.map((context) => context.id).sort(),
      "normal dashboard keeps four legitimate identities separate and excludes fixtures"
    );
    for (const context of LEGITIMATE_PROTEIN_CONTEXTS) {
      const group = normalGroups.find((row) => row.id === context.id);
      assert(group, `legitimate group ${context.key} is returned`);
      assert.strictEqual(group.key, context.key);
      assert.strictEqual(group.dashboardContext.contextKey, context.contextKey);
      assert.deepStrictEqual(group.dashboardLabel, context.label);
    }

    response = await api.get("/api/dashboard/menu/option-groups?includeQuarantined=true").set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const diagnosticFixture = response.body.data.find((group) => group.id === fixtureGroup.id);
    assert(diagnosticFixture, "admin diagnostic listing includes verified fixture group");
    assert.strictEqual(diagnosticFixture.dashboardContext.isQuarantined, true);

    response = await api.get("/api/dashboard/menu/option-groups?includeQuarantined=true").set(restaurantHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert(!response.body.data.some((group) => group.id === fixtureGroup.id), "restaurant cannot enable diagnostic fixtures");

    response = await api.get(`/api/dashboard/menu/option-groups/${fixtureGroup.id}`).set(restaurantHeaders);
    assert.strictEqual(response.status, 404, JSON.stringify(response.body));

    response = await api.get(`/api/dashboard/menu/option-groups/${fixtureGroup.id}?includeQuarantined=true`).set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.data.actions.canAddOptions, false);
    assert.strictEqual(response.body.data.actions.canReorderOptions, false);

    response = await api.get(`/api/dashboard/menu/option-groups/${fixtureGroup.id}/options`).set(restaurantHeaders);
    assert.strictEqual(response.status, 404, JSON.stringify(response.body));

    response = await api.get(`/api/dashboard/menu/option-groups/${fixtureGroup.id}/options?includeQuarantined=true`).set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert(response.body.data.some((option) => option.id === String(fixtureOption._id)));

    response = await api.get("/api/dashboard/menu/products").set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert(!response.body.data.some((product) => product.id === VERIFIED_FIXTURE_PRODUCT_IDS[0]));

    response = await api.get("/api/dashboard/meal-builder/catalog").set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert(!response.body.data.optionGroups.some((group) => group.id === fixtureGroup.id));
    assert(!response.body.data.options.some((option) => option.id === String(fixtureOption._id)));
    assert(!response.body.data.products.some((product) => product.id === VERIFIED_FIXTURE_PRODUCT_IDS[0]));

    response = await api.get("/api/dashboard/meal-builder/catalog?includeQuarantined=true").set(adminHeaders);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert(response.body.data.optionGroups.some((group) => group.id === fixtureGroup.id));

    response = await api.post(`/api/dashboard/menu/option-groups/${fixtureGroup.id}/options`)
      .set(adminHeaders)
      .send({ key: "must_be_rejected", name: { ar: "مرفوض", en: "Rejected" }, isActive: true });
    assert.strictEqual(response.status, 409, JSON.stringify(response.body));
    assert.strictEqual(response.body.error.code, "MENU_OPTION_GROUP_QUARANTINED");

    response = await api.patch(`/api/dashboard/menu/option-groups/${fixtureGroup.id}`)
      .set(adminHeaders)
      .send({ name: { ar: "يجب ألا يتغير", en: "Must not change" } });
    assert.strictEqual(response.status, 409, JSON.stringify(response.body));
    assert.strictEqual(response.body.error.code, "MENU_OPTION_GROUP_QUARANTINED");

    const historicalDay = await mongoose.connection.db.collection("subscriptiondays").findOne({ _id: historicalDayId });
    assert(historicalDay, "historical fixture day remains readable");
    assert.strictEqual(String(historicalDay.mealSlots[0].selectedOptions[0].groupId), fixtureGroup.id);
    assert.strictEqual(String(historicalDay.mealSlots[0].selectedOptions[0].optionId), String(fixtureOption._id));

    const persistedLegitimateGroups = await MenuOptionGroup.find({
      _id: { $in: LEGITIMATE_PROTEIN_CONTEXTS.map((context) => context.id) },
    }).lean();
    assert.deepStrictEqual(
      persistedLegitimateGroups.map((group) => [String(group._id), group.key]).sort(),
      LEGITIMATE_PROTEIN_CONTEXTS.map((context) => [context.id, context.key]).sort(),
      "legitimate IDs and keys are unchanged"
    );

    console.log("Protein group dashboard quarantine policy tests passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
