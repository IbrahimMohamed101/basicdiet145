const assert = require("assert");

const {
  buildAddonChoicesCatalog,
  buildAddonChoicePricingPreview,
  resolveAddonChoiceProductById,
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  resolvePublicAddonFilters,
} = require("../src/controllers/addonController");

function queryResult(result) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

function buildModels() {
  const ids = {
    juicesCategory: "507f191e810c19729de86001",
    drinksCategory: "507f191e810c19729de86002",
    dessertsCategory: "507f191e810c19729de86003",
    lightCategory: "507f191e810c19729de86004",
    mealsCategory: "507f191e810c19729de86005",
    planAddon: "507f191e810c19729de86100",
    mealPlanAddon: "507f191e810c19729de86109",
    berry: "507f191e810c19729de86101",
    water: "507f191e810c19729de86102",
    brownie: "507f191e810c19729de86103",
    greenSalad: "507f191e810c19729de86104",
    yogurt: "507f191e810c19729de86105",
    chickenMeal: "507f191e810c19729de86106",
    beefMeal: "507f191e810c19729de86107",
    unrelatedMeal: "507f191e810c19729de86108",
    subscriptionOwner: "507f191e810c19729de86201",
    otherOwner: "507f191e810c19729de86202",
  };
  const categories = [
    { _id: ids.juicesCategory, key: "juices", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.drinksCategory, key: "drinks", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.dessertsCategory, key: "desserts", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.lightCategory, key: "light_options", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.mealsCategory, key: "meals", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
  ];
  const products = [
    {
      _id: ids.planAddon,
      key: "juice_subscription_plan_row",
      categoryId: ids.juicesCategory,
      name: { en: "Juice Subscription Plan Row", ar: "اشتراك عصير" },
      description: { en: "", ar: "" },
      priceHalala: 999999,
      currency: "SAR",
      itemType: "subscription",
      kind: "plan",
      billingMode: "per_day",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "addon" },
    },
    {
      _id: ids.berry,
      key: "berry_blast",
      categoryId: ids.juicesCategory,
      name: { en: "Berry Blast", ar: "بيري بلاست" },
      description: { en: "", ar: "" },
      priceHalala: 1100,
      currency: "SAR",
      itemType: "juice",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "addon" },
    },
    {
      _id: ids.water,
      key: "water",
      categoryId: ids.drinksCategory,
      name: { en: "Water", ar: "مياه عادية" },
      description: { en: "", ar: "" },
      priceHalala: 200,
      currency: "SAR",
      itemType: "drink",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "addon" },
    },
    {
      _id: ids.brownie,
      key: "dark_brownies",
      categoryId: ids.dessertsCategory,
      name: { en: "Dark Brownies", ar: "براونيز داكن" },
      description: { en: "", ar: "" },
      priceHalala: 1300,
      currency: "SAR",
      itemType: "dessert",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "addon" },
    },
    {
      _id: ids.greenSalad,
      key: "green_salad",
      categoryId: ids.lightCategory,
      name: { en: "Green Salad", ar: "سلطة خضراء" },
      description: { en: "", ar: "" },
      priceHalala: 1500,
      currency: "SAR",
      itemType: "green_salad",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "standard" },
    },
    {
      _id: ids.yogurt,
      key: "greek_yogurt",
      categoryId: ids.lightCategory,
      name: { en: "Greek Yogurt", ar: "زبادي يوناني" },
      description: { en: "", ar: "" },
      priceHalala: 1700,
      currency: "SAR",
      itemType: "greek_yogurt",
      isActive: true,
      isAvailable: true,
      ui: { cardVariant: "standard" },
    },
    {
      _id: ids.chickenMeal,
      key: "grilled_chicken_meal",
      categoryId: ids.mealsCategory,
      name: { en: "Grilled Chicken Meal", ar: "وجبة دجاج" },
      description: { en: "", ar: "" },
      priceHalala: 2500,
      currency: "SAR",
      itemType: "meal",
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      ui: { cardVariant: "standard" },
    },
    {
      _id: ids.beefMeal,
      key: "beef_meal",
      categoryId: ids.mealsCategory,
      name: { en: "Beef Meal", ar: "وجبة لحم" },
      description: { en: "", ar: "" },
      priceHalala: 2700,
      currency: "SAR",
      itemType: "meal",
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      ui: { cardVariant: "standard" },
    },
    {
      _id: ids.unrelatedMeal,
      key: "unrelated_meal",
      categoryId: ids.mealsCategory,
      name: { en: "Unrelated Meal", ar: "وجبة أخرى" },
      description: { en: "", ar: "" },
      priceHalala: 2800,
      currency: "SAR",
      itemType: "meal",
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      ui: { cardVariant: "standard" },
    },
  ];
  function subscriptionDoc() {
    return {
      _id: "507f191e810c19729de86999",
      userId: ids.subscriptionOwner,
      status: "active",
      startDate: "2020-01-01",
      endDate: "2099-12-31",
      addonSubscriptions: [
        {
          addonPlanId: ids.planAddon,
          addonPlanName: "Juice Plan",
          category: "juice",
          maxPerDay: 2,
          includedTotalQty: 5,
          menuProductIds: [ids.berry],
        },
        {
          addonPlanId: ids.mealPlanAddon,
          addonPlanName: "Meal Plan",
          category: "meal",
          maxPerDay: 3,
          includedTotalQty: 7,
          menuProductIds: [ids.beefMeal, ids.berry, ids.chickenMeal],
        },
      ],
      addonBalance: [
        { addonPlanId: ids.planAddon, category: "juice", includedTotalQty: 5, remainingQty: 2 },
        { addonPlanId: ids.mealPlanAddon, category: "meal", includedTotalQty: 7, remainingQty: 4 },
      ],
    };
  }
  function matchesActiveQuery(row, query) {
    if (query.isActive === true && row.isActive === false) return false;
    if (query.isVisible && query.isVisible.$ne === false && row.isVisible === false) return false;
    if (query.isAvailable && query.isAvailable.$ne === false && row.isAvailable === false) return false;
    if (query.publishedAt && query.publishedAt.$ne === null && row.publishedAt === null) return false;
    if (query.$or && !query.$or.some((entry) => {
      if (entry.availableFor && entry.availableFor.$exists === false) return row.availableFor === undefined;
      if (Array.isArray(entry.availableFor)) return Array.isArray(row.availableFor) && row.availableFor.length === 0;
      if (entry.availableFor) return Array.isArray(row.availableFor) && row.availableFor.includes(entry.availableFor);
      return false;
    })) return false;
    return true;
  }

  return {
    ids,
    SubscriptionModel: {
      findById() {
        return {
          lean: () => Promise.resolve(subscriptionDoc()),
        };
      },
      findOne(query) {
        const doc = String(query.userId || "") === ids.subscriptionOwner
          ? subscriptionDoc()
          : null;
        return {
          lean: () => Promise.resolve(doc),
        };
      },
      find(query) {
        const doc = String(query.userId || "") === ids.subscriptionOwner && query.status === "active"
          ? subscriptionDoc()
          : null;
        return queryResult(doc ? [doc] : []);
      },
    },
    MenuCategoryModel: {
      find(query) {
        if (query._id && query._id.$in) {
          const categoryIds = query._id.$in.map(String);
          return queryResult(categories.filter((category) => categoryIds.includes(String(category._id))));
        }
        const keys = query.key && query.key.$in ? query.key.$in : [];
        return queryResult(categories.filter((category) => keys.includes(category.key)));
      },
      findOne(query) {
        const row = query._id
          ? categories.find((category) => category._id === query._id)
          : categories.find((category) => category.key === query.key);
        return { lean: () => Promise.resolve(row || null) };
      },
    },
    MenuProductModel: {
      find(query) {
        if (query._id && query._id.$in) {
          const productIds = query._id.$in.map(String);
          return queryResult(products.filter((product) => (
            productIds.includes(String(product._id))
            && matchesActiveQuery(product, query)
          )));
        }
        const categoryIds = query.categoryId && query.categoryId.$in ? query.categoryId.$in : [];
        const keys = query.key && query.key.$in ? query.key.$in : null;
        return queryResult(products.filter((product) => {
          if (!categoryIds.includes(product.categoryId)) return false;
          if (!matchesActiveQuery(product, query)) return false;
          return !keys || keys.includes(product.key);
        }));
      },
      findOne(query) {
        const row = products.find((product) => product._id === query._id);
        return { lean: () => Promise.resolve(row || null) };
      },
    },
  };
}

async function run() {
  const fixtureModels = buildModels();
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.juice.sourceCategories, ["juice", "juices", "drinks"]);
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.snack.sourceCategories, ["desserts"]);
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.small_salad.sourceCategories, ["light_options"]);

  const data = await buildAddonChoicesCatalog({ lang: "en", models: fixtureModels });
  assert.deepStrictEqual(Object.keys(data), ["juice", "snack", "small_salad"]);

  const juiceCategoryKeys = data.juice.choices.map((choice) => choice.categoryKey).sort();
  assert.deepStrictEqual(juiceCategoryKeys, ["juices"]);
  assert(data.juice.choices.every((choice) => choice.type === "menu_product"));
  assert(!data.juice.choices.some((choice) => choice.kind === "plan" || choice.type === "subscription"));
  assert(!data.juice.choices.some((choice) => choice.id === fixtureModels.ids.planAddon));

  const entitledData = await buildAddonChoicesCatalog({
    lang: "en",
    subscriptionId: "507f191e810c19729de86999",
    models: fixtureModels,
  });
  assert.deepStrictEqual(Object.keys(entitledData), ["juice", "meal"]);
  assert.strictEqual(entitledData.juice.catalogType, "subscription_entitlements");
  assert.deepStrictEqual(entitledData.juice.choices.map((choice) => choice.id), [fixtureModels.ids.berry]);
  assert.strictEqual(entitledData.juice.choices[0].priceHalala, 1100);
  assert.strictEqual(entitledData.juice.choices[0].priceSar, 11);
  assert(!entitledData.juice.choices.some((choice) => choice.id === fixtureModels.ids.water),
    "subscription-specific choices must not include globally mapped products from another plan");
  assert.deepStrictEqual(
    entitledData.meal.choices.map((choice) => choice.id),
    [fixtureModels.ids.beefMeal, fixtureModels.ids.chickenMeal],
    "meal group contains only products whose source category resolves to meal"
  );
  assert(!entitledData.meal.choices.some((choice) => choice.id === fixtureModels.ids.berry),
    "juice products linked by a meal entitlement must stay out of the meal group");
  assert(!entitledData.meal.choices.some((choice) => choice.id === fixtureModels.ids.unrelatedMeal));
  assert.strictEqual(entitledData.meal.choices[0].addonPlanId, fixtureModels.ids.mealPlanAddon);
  assert.strictEqual(entitledData.meal.choices[0].addonPlanName, "Meal Plan");
  assert.strictEqual(entitledData.meal.choices[0].category, "meal");
  assert.strictEqual(entitledData.meal.choices[0].maxPerDay, 3);
  assert.strictEqual(entitledData.meal.choices[0].remainingQty, 4);
  assert.strictEqual(entitledData.meal.choices[0].includedTotalQty, 7);
  assert.strictEqual(entitledData.meal.choices[0].isEligibleForAllowance, true);
  assert.strictEqual(
    entitledData.juice.choices.filter((choice) => choice.id === fixtureModels.ids.berry).length,
    1,
    "duplicate products across plans are returned once in their correct display group"
  );
  assert.strictEqual(entitledData.meal.choices[0].coveredQty, 1);
  assert.strictEqual(entitledData.meal.choices[0].paidQty, 0);
  assert.strictEqual(entitledData.meal.choices[0].payableTotalHalala, 0);
  assert.strictEqual(entitledData.meal.choices[0].pricingMode, "allowance_covered");

  const currentSubscriptionData = await buildAddonChoicesCatalog({
    lang: "en",
    userId: fixtureModels.ids.subscriptionOwner,
    models: fixtureModels,
  });
  assert.deepStrictEqual(Object.keys(currentSubscriptionData), ["juice", "small_salad", "meal"]);
  assert.deepStrictEqual(
    currentSubscriptionData.meal.choices.map((choice) => choice.id),
    [fixtureModels.ids.chickenMeal, fixtureModels.ids.beefMeal, fixtureModels.ids.unrelatedMeal],
    "authenticated requests without subscriptionId merge generic meal products with entitlement metadata"
  );
  assert(currentSubscriptionData.juice, "merged catalog keeps generic juice category");
  assert(currentSubscriptionData.small_salad, "merged catalog keeps generic small_salad category");
  assert.strictEqual(
    currentSubscriptionData.meal.choices.find((choice) => choice.id === fixtureModels.ids.beefMeal).isEligibleForAllowance,
    true,
    "linked meal product is marked allowance eligible"
  );
  assert.strictEqual(
    currentSubscriptionData.meal.choices.find((choice) => choice.id === fixtureModels.ids.unrelatedMeal).isEligibleForAllowance,
    false,
    "unrelated generic meal product remains visible but is not allowance eligible"
  );

  const mealOnlyData = await buildAddonChoicesCatalog({
    lang: "en",
    category: "meal",
    subscriptionId: "507f191e810c19729de86999",
    models: fixtureModels,
  });
  assert.deepStrictEqual(Object.keys(mealOnlyData), ["meal"]);
  assert.deepStrictEqual(
    mealOnlyData.meal.choices.map((choice) => choice.id),
    [fixtureModels.ids.beefMeal, fixtureModels.ids.chickenMeal]
  );

  const mismatchedModels = buildModels();
  mismatchedModels.SubscriptionModel = {
    find(query) {
      const doc = String(query.userId || "") === mismatchedModels.ids.subscriptionOwner && query.status === "active"
        ? {
          _id: "507f191e810c19729de86997",
          userId: mismatchedModels.ids.subscriptionOwner,
          status: "active",
          startDate: "2020-01-01",
          endDate: "2099-12-31",
          addonSubscriptions: [{
            addonPlanId: mismatchedModels.ids.mealPlanAddon,
            addonPlanName: "اشتراك وجبات",
            category: "snack",
            maxPerDay: 3,
            includedTotalQty: 3,
            menuProductIds: [
              mismatchedModels.ids.beefMeal,
              mismatchedModels.ids.brownie,
              mismatchedModels.ids.chickenMeal,
            ],
          }],
          addonBalance: [{
            addonPlanId: mismatchedModels.ids.mealPlanAddon,
            category: "snack",
            includedTotalQty: 3,
            remainingQty: 2,
          }],
        }
        : null;
      return queryResult(doc ? [doc] : []);
    },
  };
  const mismatchedData = await buildAddonChoicesCatalog({
    lang: "en",
    userId: mismatchedModels.ids.subscriptionOwner,
    models: mismatchedModels,
  });
  assert(mismatchedData.juice, "mismatched entitlement merge keeps generic juice");
  assert(!mismatchedData.snack, "empty legacy snack group is removed after exact entitlement overlay");
  assert(mismatchedData.small_salad, "mismatched entitlement merge keeps generic small_salad");
  assert(mismatchedData.meal, "mismatched entitlement merge adds meal category");
  assert.deepStrictEqual(
    mismatchedData.meal.choices.map((choice) => choice.id),
    [mismatchedModels.ids.chickenMeal, mismatchedModels.ids.beefMeal, mismatchedModels.ids.unrelatedMeal],
    "meal products from a snack-stored entitlement are grouped under meal while generic meal products remain visible"
  );
  assert.strictEqual(
    mismatchedData.meal.choices.find((choice) => choice.id === mismatchedModels.ids.beefMeal).entitlementCategory,
    "snack",
    "original stored category is preserved as metadata"
  );
  assert.strictEqual(
    mismatchedData.meal.choices.find((choice) => choice.id === mismatchedModels.ids.beefMeal).isEligibleForAllowance,
    true
  );
  assert.strictEqual(
    mismatchedData.meal.choices.find((choice) => choice.id === mismatchedModels.ids.unrelatedMeal).isEligibleForAllowance,
    false
  );
  assert(
    mismatchedData.dessert.choices.some((choice) => choice.id === mismatchedModels.ids.brownie && choice.isEligibleForAllowance === true),
    "legacy product category remains metadata-driven in the deprecated catalog builder"
  );
  const mismatchedMealOnly = await buildAddonChoicesCatalog({
    lang: "en",
    category: "meal",
    userId: mismatchedModels.ids.subscriptionOwner,
    models: mismatchedModels,
  });
  assert.deepStrictEqual(Object.keys(mismatchedMealOnly), ["meal"]);
  assert.deepStrictEqual(
    mismatchedMealOnly.meal.choices.map((choice) => choice.id),
    [mismatchedModels.ids.chickenMeal, mismatchedModels.ids.beefMeal, mismatchedModels.ids.unrelatedMeal],
    "dynamic category filtering returns the merged meal category"
  );

  const partialPreview = buildAddonChoicePricingPreview({
    subscription: {
      addonSubscriptions: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        maxPerDay: 3,
        menuProductIds: [fixtureModels.ids.beefMeal],
      }],
      addonBalance: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        includedTotalQty: 5,
        remainingQty: 2,
      }],
    },
    entitlement: {
      addonPlanId: fixtureModels.ids.mealPlanAddon,
      category: "meal",
      maxPerDay: 3,
      menuProductIds: [fixtureModels.ids.beefMeal],
    },
    product: {
      _id: fixtureModels.ids.beefMeal,
      priceHalala: 2700,
      currency: "SAR",
    },
    category: "meal",
    quantity: 3,
  });
  assert.strictEqual(partialPreview.coveredQty, 2);
  assert.strictEqual(partialPreview.paidQty, 1);
  assert.strictEqual(partialPreview.payableTotalHalala, 2700);
  assert.strictEqual(partialPreview.pricingMode, "allowance_partial");

  const coveredInvalidPricePreview = buildAddonChoicePricingPreview({
    subscription: {
      addonSubscriptions: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        maxPerDay: 1,
        menuProductIds: [fixtureModels.ids.beefMeal],
      }],
      addonBalance: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        includedTotalQty: 1,
        remainingQty: 1,
      }],
    },
    entitlement: {
      addonPlanId: fixtureModels.ids.mealPlanAddon,
      category: "meal",
      maxPerDay: 1,
      menuProductIds: [fixtureModels.ids.beefMeal],
    },
    product: {
      _id: fixtureModels.ids.beefMeal,
      priceHalala: Number.NaN,
      currency: "SAR",
    },
    category: "meal",
    quantity: 1,
  });
  assert.strictEqual(coveredInvalidPricePreview.paidQty, 0);
  assert.strictEqual(coveredInvalidPricePreview.payableTotalHalala, 0);

  assert.throws(
    () => buildAddonChoicePricingPreview({
      subscription: {
        addonSubscriptions: [{
          addonPlanId: fixtureModels.ids.mealPlanAddon,
          category: "meal",
          maxPerDay: 3,
          menuProductIds: [fixtureModels.ids.beefMeal],
        }],
        addonBalance: [{
          addonPlanId: fixtureModels.ids.mealPlanAddon,
          category: "meal",
          includedTotalQty: 1,
          remainingQty: 1,
        }],
      },
      entitlement: {
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        maxPerDay: 3,
        menuProductIds: [fixtureModels.ids.beefMeal],
      },
      product: {
        _id: fixtureModels.ids.beefMeal,
        priceHalala: 2700.5,
        currency: "SAR",
      },
      category: "meal",
      quantity: 2,
    }),
    (err) => err.status === 422 && err.code === "INVALID_ADDON_PRICE"
  );

  const exhaustedPreview = buildAddonChoicePricingPreview({
    subscription: {
      addonSubscriptions: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        maxPerDay: 3,
        menuProductIds: [fixtureModels.ids.beefMeal],
      }],
      addonBalance: [{
        addonPlanId: fixtureModels.ids.mealPlanAddon,
        category: "meal",
        includedTotalQty: 5,
        remainingQty: 0,
      }],
    },
    entitlement: {
      addonPlanId: fixtureModels.ids.mealPlanAddon,
      category: "meal",
      maxPerDay: 3,
      menuProductIds: [fixtureModels.ids.beefMeal],
    },
    product: {
      _id: fixtureModels.ids.beefMeal,
      priceHalala: 2700,
      currency: "SAR",
    },
    category: "meal",
    quantity: 2,
  });
  assert.strictEqual(exhaustedPreview.coveredQty, 0);
  assert.strictEqual(exhaustedPreview.paidQty, 2);
  assert.strictEqual(exhaustedPreview.payableTotalHalala, 5400);
  assert.strictEqual(exhaustedPreview.pricingMode, "paid_overage");

  const legacyModels = buildModels();
  legacyModels.SubscriptionModel = {
    findById() {
      return {
        lean: () => Promise.resolve({
          _id: "507f191e810c19729de86998",
          userId: legacyModels.ids.subscriptionOwner,
          addonSubscriptions: [{
            addonPlanId: legacyModels.ids.planAddon,
            addonPlanName: "Legacy Juice Plan",
            category: "juice",
            maxPerDay: 1,
          }],
        }),
      };
    },
  };
  const legacyEntitledData = await buildAddonChoicesCatalog({
    lang: "en",
    subscriptionId: "507f191e810c19729de86998",
    models: legacyModels,
  });
  assert.deepStrictEqual(legacyEntitledData, {}, "deprecated catalog builder does not synthesize plan groups without product identity");

  const snackCategoryKeys = data.snack.choices.map((choice) => choice.categoryKey);
  assert.deepStrictEqual(snackCategoryKeys, []);
  assert(data.snack.choices.every((choice) => choice.type === "menu_product"));
  assert(data.snack.choices.every((choice) => choice.itemType === "dessert"));

  assert.deepStrictEqual(data.small_salad.sourceCategories, ["light_options"]);
  assert.deepStrictEqual(data.small_salad.choices.map((choice) => choice.key), ["green_salad", "greek_yogurt"]);
  assert(data.small_salad.choices.every((choice) => choice.type === "menu_product"));

  const emptySmallSalad = await buildAddonChoicesCatalog({
    lang: "en",
    category: "small_salad",
    models: {
      ...buildModels(),
      MenuProductModel: {
        find() {
          return queryResult([]);
        },
      },
    },
  });
  assert.deepStrictEqual(emptySmallSalad.small_salad.choices, []);

  const models = buildModels();
  const resolved = await resolveAddonChoiceProductById(models.ids.water, { models });
  assert.strictEqual(resolved.addonCategory, "drink");
  assert.strictEqual(resolved.category.key, "drinks");

  const rejectedLightOption = await resolveAddonChoiceProductById(models.ids.yogurt, { models });
  assert.strictEqual(rejectedLightOption.addonCategory, "small_salad");

  const subscriptionPlanFilters = resolvePublicAddonFilters({ type: "subscription" });
  assert.strictEqual(subscriptionPlanFilters.isActive, true);
  assert(subscriptionPlanFilters.$or.some((entry) => entry.kind === "plan"));
  assert(!subscriptionPlanFilters.$or.some((entry) => entry.kind === "item"));

  const oneTimeFilters = resolvePublicAddonFilters({ type: "one_time" });
  assert(oneTimeFilters.$or.some((entry) => entry.kind === "item"));
  assert(!oneTimeFilters.$or.some((entry) => entry.kind === "plan"));

  await assert.rejects(
    () => buildAddonChoicesCatalog({
      subscriptionId: "507f191e810c19729de86999",
      userId: fixtureModels.ids.otherOwner,
      models: fixtureModels,
    }),
    (err) => err.status === 403 && err.code === "FORBIDDEN"
  );

  await assert.rejects(
    () => buildAddonChoicesCatalog({
      subscriptionId: "not-an-id",
      userId: fixtureModels.ids.subscriptionOwner,
      models: fixtureModels,
    }),
    (err) => err.status === 400 && err.code === "INVALID_ID"
  );

  const missingModels = buildModels();
  missingModels.SubscriptionModel = {
    findById() {
      return { lean: () => Promise.resolve(null) };
    },
  };
  await assert.rejects(
    () => buildAddonChoicesCatalog({
      subscriptionId: "507f191e810c19729de86990",
      userId: fixtureModels.ids.subscriptionOwner,
      models: missingModels,
    }),
    (err) => err.status === 404 && err.code === "NOT_FOUND"
  );
}

run()
  .then(() => {
    console.log("subscription_addon_choices tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
