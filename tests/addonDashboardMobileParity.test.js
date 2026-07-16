process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const {
  issueAppAccessToken,
} = require("../src/services/appTokenService");
const menuCatalogService = require("../src/services/orders/menuCatalogService");
const {
  buildAddonChoicesCatalog,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  createDashboardAddonPlan,
  deleteDashboardAddonPlan,
  listDashboardAddonPlans,
  updateAddonPlan,
} = require("../src/controllers/addonController");
const {
  getSubscriptionAddonChoices,
} = require("../src/controllers/subscriptionController");
const {
  resolveCheckoutQuoteOrThrow,
} = require("../src/services/subscription/subscriptionQuoteService");

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

async function invoke(handler, { body = {}, params = {}, query = {}, headers = {}, userId = null } = {}) {
  const res = response();
  await handler({ body, params, query, headers, userId }, res);
  return res;
}

function ids(rows) {
  return rows.map((row) => String(row.id || row._id));
}

function assertFlutterChoiceFields(choice) {
  for (const field of [
    "id",
    "key",
    "name",
    "nameAr",
    "nameI18n",
    "description",
    "descriptionI18n",
    "imageUrl",
    "categoryKey",
    "itemType",
    "type",
    "available",
    "active",
    "ui",
    "isEligibleForAllowance",
  ]) {
    assert(Object.prototype.hasOwnProperty.call(choice, field), `choice keeps Flutter field ${field}`);
  }
}

async function main() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(`addon_dashboard_mobile_parity_${Date.now()}`));
  await AddonPlanPrice.init();

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
      gramsOptions: [{
        grams: 150,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 2, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
      }],
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

    const mealCategory = await MenuCategory.create({
      key: "meals",
      name: { ar: "الوجبات", en: "Meals" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      sortOrder: 2,
    });
    const dessertCategory = await MenuCategory.create({
      key: "desserts",
      name: { ar: "الحلى", en: "Desserts" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      sortOrder: 3,
    });
    const mealProducts = await MenuProduct.create([
      {
        categoryId: mealCategory._id,
        key: "addon_parity_chicken_meal",
        name: { ar: "وجبة دجاج", en: "Chicken Meal" },
        description: { ar: "", en: "" },
        priceHalala: 3200,
        currency: "SAR",
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 1,
      },
      {
        categoryId: mealCategory._id,
        key: "addon_parity_beef_meal",
        name: { ar: "وجبة لحم", en: "Beef Meal" },
        description: { ar: "", en: "" },
        priceHalala: 3500,
        currency: "SAR",
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 2,
      },
      {
        categoryId: mealCategory._id,
        key: "addon_parity_unrelated_meal",
        name: { ar: "وجبة خارج الخطة", en: "Unrelated Meal" },
        description: { ar: "", en: "" },
        priceHalala: 3600,
        currency: "SAR",
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 3,
      },
    ]);
    const dessertProducts = await MenuProduct.create([
      {
        categoryId: dessertCategory._id,
        key: "addon_parity_cheesecake",
        name: { ar: "تشيز كيك", en: "Cheesecake" },
        description: { ar: "", en: "" },
        priceHalala: 1800,
        currency: "SAR",
        itemType: "dessert",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 1,
      },
      {
        categoryId: dessertCategory._id,
        key: "addon_parity_unrelated_dessert",
        name: { ar: "حلى خارج الخطة", en: "Unrelated Dessert" },
        description: { ar: "", en: "" },
        priceHalala: 1900,
        currency: "SAR",
        itemType: "dessert",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 2,
      },
      {
        categoryId: dessertCategory._id,
        key: "addon_parity_snack_bites",
        name: { ar: "سناك", en: "Snack Bites" },
        description: { ar: "", en: "" },
        priceHalala: 1200,
        currency: "SAR",
        itemType: "snack",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        sortOrder: 3,
      },
    ]);

    const invalidSnackMealPlan = await invoke(createDashboardAddonPlan, {
      body: {
        name: { ar: "اشتراك وجبات", en: "Meal Plan Stored As Snack" },
        category: "snack",
        maxPerDay: 2,
        isActive: true,
        menuProductIds: [String(mealProducts[0]._id), String(mealProducts[1]._id)],
        planPrices: [{
          basePlanId: String(basePlan._id),
          priceHalala: 5000,
          isActive: true,
        }],
      },
    });
    assert.strictEqual(invalidSnackMealPlan.statusCode, 400);
    assert.strictEqual(invalidSnackMealPlan.body.error.code, "ADDON_PLAN_CATEGORY_PRODUCT_MISMATCH");

    const clientUser = await User.create({
      phone: `+155501${Date.now()}`,
      name: "Addon Parity Client",
      role: "client",
      isActive: true,
    });
    const mealAddonPlanId = new mongoose.Types.ObjectId();
    const dessertAddonPlanId = new mongoose.Types.ObjectId();
    const subscription = await Subscription.create({
      userId: clientUser._id,
      clientId: new mongoose.Types.ObjectId(),
      planId: basePlan._id,
      status: "active",
      totalMeals: 7,
      remainingMeals: 7,
      duration: 7,
      deliveryMode: "pickup",
      addonSubscriptions: [{
        addonId: created.body.data.id,
        addonPlanId: created.body.data.id,
        addonPlanName: "Juice Plan",
        category: "juice",
        maxPerDay: 8,
        menuProductIds: configuredIds.slice(0, 3),
      }, {
        addonId: mealAddonPlanId,
        addonPlanId: mealAddonPlanId,
        addonPlanName: "Meal Add-on Plan",
        category: "meal",
        maxPerDay: 2,
        menuProductIds: [mealProducts[1]._id, mealProducts[0]._id],
      }, {
        addonId: dessertAddonPlanId,
        addonPlanId: dessertAddonPlanId,
        addonPlanName: "Dessert Add-on Plan",
        category: "dessert",
        maxPerDay: 1,
        menuProductIds: [dessertProducts[0]._id],
      }],
      addonBalance: [{
        addonId: created.body.data.id,
        addonPlanId: created.body.data.id,
        category: "juice",
        includedTotalQty: 3,
        remainingQty: 2,
        unitPriceHalala: 1000,
      }, {
        addonId: mealAddonPlanId,
        addonPlanId: mealAddonPlanId,
        category: "meal",
        includedTotalQty: 2,
        remainingQty: 0,
        unitPriceHalala: 3500,
      }, {
        addonId: dessertAddonPlanId,
        addonPlanId: dessertAddonPlanId,
        category: "dessert",
        includedTotalQty: 1,
        remainingQty: 1,
        unitPriceHalala: 1800,
      }],
    });

    const choices = await buildAddonChoicesCatalog({
      lang: "en",
      category: "juice",
      subscriptionId: String(subscription._id),
    });
    assert.deepStrictEqual(ids(choices.juice.choices), configuredIds.slice(0, 3));
    assert(choices.juice.choices.every((choice) => choice.isEligibleForAllowance === true));
    assert.strictEqual(choices.juice.choices[0].addonPlanId, created.body.data.id);
    assert.strictEqual(choices.juice.choices[0].addonPlanName, "Juice Plan");
    assert.strictEqual(choices.juice.choices[0].maxPerDay, 8);

    const choicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { category: "juice", subscriptionId: String(subscription._id) },
      headers: { "accept-language": "en" },
      userId: String(subscription.userId),
    });
    assert.strictEqual(choicesResponse.statusCode, 200);
    const dynamicJuiceIds = [...new Set([...updatedIds, ...configuredIds.slice(0, 3)])];
    assert.deepStrictEqual(ids(choicesResponse.body.data.juice.choices), dynamicJuiceIds);
    assert.strictEqual(choicesResponse.body.addonChoiceGroups.length, 1);

    const api = request(createApp());
    const appHeaders = {
      Authorization: `Bearer ${issueAppAccessToken(clientUser)}`,
      "Accept-Language": "en",
    };
    const mobileChoicesResponse = await api
      .get("/api/subscriptions/addon-choices")
      .set(appHeaders);
    assert.strictEqual(mobileChoicesResponse.status, 200, JSON.stringify(mobileChoicesResponse.body));
    assert.strictEqual(mobileChoicesResponse.body.status, true);
    assert.deepStrictEqual(
      Object.keys(mobileChoicesResponse.body.data).sort(),
      ["dessert", "juice", "meal"],
      "compatibility map contains one entry per active or purchased dashboard plan"
    );
    assert.strictEqual(mobileChoicesResponse.body.addonChoiceGroups.length, 3);
    for (const categoryKey of ["juice", "meal", "dessert"]) {
      assert.strictEqual(mobileChoicesResponse.body.data[categoryKey].category, categoryKey);
      assert(Array.isArray(mobileChoicesResponse.body.data[categoryKey].choices), `${categoryKey} keeps choices array`);
      mobileChoicesResponse.body.data[categoryKey].choices.forEach(assertFlutterChoiceFields);
    }
    assert.deepStrictEqual(ids(mobileChoicesResponse.body.data.juice.choices), dynamicJuiceIds);
    assert.deepStrictEqual(ids(mobileChoicesResponse.body.data.meal.choices), [
      String(mealProducts[1]._id),
      String(mealProducts[0]._id),
    ]);
    assert.deepStrictEqual(ids(mobileChoicesResponse.body.data.dessert.choices), [
      String(dessertProducts[0]._id),
    ]);
    assert.strictEqual(
      mobileChoicesResponse.body.data.juice.choices.find((choice) => String(choice.id) === configuredIds[0]).isEligibleForAllowance,
      true
    );
    assert.strictEqual(
      mobileChoicesResponse.body.data.juice.choices.find((choice) => String(choice.id) === configuredIds[3]).isEligibleForAllowance,
      false
    );
    assert.deepStrictEqual(
      mobileChoicesResponse.body.data.meal.choices
        .filter((choice) => choice.isEligibleForAllowance)
        .map((choice) => String(choice.id)),
      [
        String(mealProducts[1]._id),
        String(mealProducts[0]._id),
      ]
    );
    assert(!mobileChoicesResponse.body.data.meal.choices.some((choice) => String(choice.id) === String(mealProducts[2]._id)));
    const coveredJuiceChoice = mobileChoicesResponse.body.data.juice.choices
      .find((choice) => String(choice.id) === configuredIds[0]);
    assert.strictEqual(coveredJuiceChoice.payableTotalHalala, 0);
    assert.strictEqual(coveredJuiceChoice.coveredQty, 1);
    const paidMealChoice = mobileChoicesResponse.body.data.meal.choices.find((choice) => String(choice.id) === String(mealProducts[1]._id));
    assert.strictEqual(paidMealChoice.coveredQty, 0);
    assert.strictEqual(paidMealChoice.paidQty, 1);
    assert.strictEqual(paidMealChoice.payableTotalHalala, 3500);

    const mobileMealOnlyResponse = await api
      .get("/api/subscriptions/addon-choices?category=meal")
      .set(appHeaders);
    assert.strictEqual(mobileMealOnlyResponse.status, 200, JSON.stringify(mobileMealOnlyResponse.body));
    assert.deepStrictEqual(Object.keys(mobileMealOnlyResponse.body.data), ["meal"]);
    assert.deepStrictEqual(ids(mobileMealOnlyResponse.body.data.meal.choices), [
      String(mealProducts[1]._id),
      String(mealProducts[0]._id),
    ]);
    assert.deepStrictEqual(
      mobileMealOnlyResponse.body.data.meal.choices
        .filter((choice) => choice.isEligibleForAllowance)
        .map((choice) => String(choice.id)),
      [
        String(mealProducts[1]._id),
        String(mealProducts[0]._id),
      ]
    );

    const unauthenticatedChoicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { category: "juice", subscriptionId: String(subscription._id) },
    });
    assert.strictEqual(unauthenticatedChoicesResponse.statusCode, 401);

    const forbiddenChoicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { category: "juice", subscriptionId: String(subscription._id) },
      userId: String(new mongoose.Types.ObjectId()),
    });
    assert.strictEqual(forbiddenChoicesResponse.statusCode, 403);

    const invalidChoicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { subscriptionId: "not-an-id" },
      userId: String(subscription.userId),
    });
    assert.strictEqual(invalidChoicesResponse.statusCode, 400);

    const missingChoicesResponse = await invoke(getSubscriptionAddonChoices, {
      query: { subscriptionId: String(new mongoose.Types.ObjectId()) },
      userId: String(subscription.userId),
    });
    assert.strictEqual(missingChoicesResponse.statusCode, 404);

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
    assert.strictEqual(
      afterVisibilityProducts.filter((product) => String(product.key || "").startsWith("addon_parity_juice_")).length,
      4
    );
    const afterVisibilityJuiceCategory = afterVisibilityCategories.find((row) => row.key === "juices");
    assert.strictEqual(afterVisibilityJuiceCategory.productsCount, 4);
    assert.strictEqual(afterVisibilityChoices.juice.choices.length, 3);
    assert.deepStrictEqual(listedPlan.menuProductIds, [...updatedIds, String(staleId)]);

    const archived = await invoke(deleteDashboardAddonPlan, { params: { id: created.body.data.id } });
    assert.strictEqual(archived.statusCode, 200);
    const afterArchiveChoices = await buildAddonChoicesCatalog({
      lang: "en",
      category: "juice",
      subscriptionId: String(subscription._id),
    });
    assert.deepStrictEqual(
      ids(afterArchiveChoices.juice.choices),
      configuredIds.slice(0, 3),
      "archiving the live plan must not replace the subscription snapshot"
    );

    await assert.rejects(
      () => resolveCheckoutQuoteOrThrow({
        planId: String(basePlan._id),
        grams: 150,
        mealsPerDay: 2,
        delivery: { type: "pickup", pickupLocationId: "main" },
        addons: [{ id: created.body.data.id }],
      }, { lang: "en", allowMissingDeliveryAddress: true }),
      (err) => err.code === "ADDON_PLAN_NOT_FOUND"
    );

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
