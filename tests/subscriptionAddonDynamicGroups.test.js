const assert = require("assert");
const {
  buildAddonChoiceGroups,
  buildAddonChoicesCompatibilityMap,
} = require("../src/services/subscription/subscriptionAddonChoicesService");

function queryResult(rows) {
  return {
    sort() { return this; },
    lean() { return Promise.resolve(rows); },
  };
}

function fixture(planCount, { purchased = false, collision = false } = {}) {
  const base = 0x100;
  const categories = [];
  const products = [];
  const plans = [];
  const entitlements = [];
  const balances = [];

  for (let index = 0; index < planCount; index++) {
    const suffix = (base + index).toString(16).padStart(3, "0");
    const categoryId = `507f191e810c19729de86${suffix}`;
    const productId = `507f191e810c19729de87${suffix}`;
    const planId = `507f191e810c19729de88${suffix}`;
    const displayKey = collision && index < 2 ? "same_key" : `dashboard_group_${index + 1}`;
    categories.push({
      _id: categoryId,
      key: `source_${index + 1}`,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    products.push({
      _id: productId,
      categoryId,
      key: `product_${index + 1}`,
      name: { ar: `منتج ${index + 1}`, en: `Product ${index + 1}` },
      description: { ar: "", en: "" },
      itemType: `internal_type_${index + 1}`,
      priceHalala: 1000 + index,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    plans.push({
      _id: planId,
      kind: "plan",
      type: "subscription",
      billingMode: "per_day",
      category: displayKey,
      name: { ar: `خطة ${index + 1}`, en: `Plan ${index + 1}` },
      sortOrder: planCount - index,
      menuProductIds: [productId],
      isActive: true,
      isArchived: false,
    });
    if (purchased) {
      const allowanceCategory = index === 2 || index === 3 ? "shared_internal_bucket" : `bucket_${index + 1}`;
      entitlements.push({
        addonPlanId: planId,
        addonId: planId,
        addonPlanName: `Plan ${index + 1}`,
        addonPlanNameI18n: plans[index].name,
        displayKey,
        displayCategory: displayKey,
        sortOrder: plans[index].sortOrder,
        category: allowanceCategory,
        includedTotalQty: 7,
        maxPerDay: 1,
        unitPriceHalala: products[index].priceHalala,
        currency: "SAR",
        menuProductIds: [productId],
        menuProductsSnapshot: [{
          id: productId,
          key: products[index].key,
          name: products[index].name,
          nameI18n: products[index].name,
          category: displayKey,
          categoryKey: displayKey,
          itemType: products[index].itemType,
          priceHalala: products[index].priceHalala,
          currency: "SAR",
        }],
      });
      balances.push({
        _id: `507f191e810c19729de89${suffix}`,
        addonPlanId: planId,
        addonId: planId,
        category: allowanceCategory,
        includedTotalQty: 7,
        purchasedQty: 7,
        consumedQty: 0,
        remainingQty: 7,
        currency: "SAR",
      });
    }
  }

  const subscription = purchased ? {
    _id: "507f191e810c19729de89999",
    userId: "507f191e810c19729de89998",
    status: "active",
    addonSubscriptions: entitlements,
    addonBalance: balances,
  } : null;

  function matchesIds(rows, query) {
    if (!query || !query._id || !query._id.$in) return rows;
    const ids = new Set(query._id.$in.map(String));
    return rows.filter((row) => ids.has(String(row._id)));
  }

  return {
    subscription,
    plans,
    products,
    models: {
      AddonModel: {
        find(query) {
          let rows = matchesIds(plans, query);
          if (query.kind) rows = rows.filter((row) => row.kind === query.kind);
          if (query.isActive === true) rows = rows.filter((row) => row.isActive === true);
          if (query.isArchived && query.isArchived.$ne === true) rows = rows.filter((row) => row.isArchived !== true);
          return queryResult(rows);
        },
      },
      MenuProductModel: {
        find(query) { return queryResult(matchesIds(products, query)); },
      },
      MenuCategoryModel: {
        find(query) { return queryResult(matchesIds(categories, query)); },
      },
      SubscriptionModel: {
        findById() { return { lean: () => Promise.resolve(subscription) }; },
        find() { return queryResult(subscription ? [subscription] : []); },
      },
    },
  };
}

async function run() {
  for (const count of [2, 10]) {
    const current = fixture(count);
    const groups = await buildAddonChoiceGroups({ lang: "ar", models: current.models });
    assert.strictEqual(groups.length, count, `dashboard ${count}-plan fixture returns ${count} groups`);
    assert.deepStrictEqual(
      groups.map((group) => group.addonPlanId),
      [...current.plans].sort((left, right) => left.sortOrder - right.sortOrder).map((plan) => String(plan._id)),
      "groups follow dashboard sortOrder"
    );
    assert(groups.every((group) => group.label.startsWith("خطة ")), "Arabic labels come from dashboard plan names");
    assert(groups.every((group) => !group.label.startsWith("dashboard_group_")), "raw display keys are not Arabic labels");
    assert(groups.every((group) => group.choices[0].pricingMode === "paid_no_entitlement"));
  }

  const purchased = fixture(4, { purchased: true });
  const purchasedGroups = await buildAddonChoiceGroups({
    lang: "ar",
    subscription: purchased.subscription,
    userId: purchased.subscription.userId,
    models: purchased.models,
  });
  assert.strictEqual(purchasedGroups.length, 4);
  assert(purchasedGroups.every((group) => group.isPurchased === true));
  assert(purchasedGroups.every((group) => group.source === "subscription"));
  assert(purchasedGroups.every((group) => group.choices[0].pricingMode === "allowance_covered"));
  assert(purchasedGroups.every((group) => group.choices[0].coveredQty === 1));
  assert(purchasedGroups.every((group) => group.choices[0].paidQty === 0));
  assert(purchasedGroups.every((group) => group.choices[0].availableForNewSale === false));
  const sharedBucketGroups = purchasedGroups.filter((group) => group.allowanceCategory === "shared_internal_bucket");
  assert.strictEqual(sharedBucketGroups.length, 2);
  assert.notStrictEqual(sharedBucketGroups[0].addonPlanId, sharedBucketGroups[1].addonPlanId);
  assert.notStrictEqual(sharedBucketGroups[0].displayKey, sharedBucketGroups[1].displayKey);
  assert.notStrictEqual(sharedBucketGroups[0].choices[0].productId, sharedBucketGroups[1].choices[0].productId);

  const collision = fixture(2, { collision: true });
  const collisionGroups = await buildAddonChoiceGroups({ lang: "en", models: collision.models });
  const compatibility = buildAddonChoicesCompatibilityMap(collisionGroups);
  assert.strictEqual(collisionGroups.length, 2);
  assert.strictEqual(Object.keys(compatibility).length, 2, "legacy map does not overwrite colliding display keys");
  assert(Object.keys(compatibility).some((key) => key === "same_key"));
  assert(Object.keys(compatibility).some((key) => key.startsWith("same_key:")));

  const dashboardDessert = fixture(2);
  dashboardDessert.plans[0].category = "snack";
  dashboardDessert.plans[0].name = { ar: "سناك", en: "Snack" };
  dashboardDessert.plans[1].category = "dessert";
  dashboardDessert.plans[1].name = { ar: "حلويات", en: "Dessert" };
  const dashboardDessertGroups = await buildAddonChoiceGroups({
    lang: "ar",
    models: dashboardDessert.models,
  });
  assert(dashboardDessertGroups.some((group) => group.displayKey === "dessert" && group.label === "حلويات"));
  const noDessert = fixture(2);
  const noDessertGroups = await buildAddonChoiceGroups({ lang: "ar", models: noDessert.models });
  assert(!noDessertGroups.some((group) => group.displayKey === "dessert"), "no hardcoded Dessert group is created");

  console.log("subscriptionAddonDynamicGroups tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
