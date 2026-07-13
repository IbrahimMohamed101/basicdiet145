const assert = require("assert");

const {
  buildAddonChoicesCatalog,
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
    planAddon: "507f191e810c19729de86100",
    berry: "507f191e810c19729de86101",
    water: "507f191e810c19729de86102",
    brownie: "507f191e810c19729de86103",
    greenSalad: "507f191e810c19729de86104",
    yogurt: "507f191e810c19729de86105",
  };
  const categories = [
    { _id: ids.juicesCategory, key: "juices", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.drinksCategory, key: "drinks", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.dessertsCategory, key: "desserts", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
    { _id: ids.lightCategory, key: "light_options", isActive: true, isVisible: true, isAvailable: true, publishedAt: new Date() },
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
  ];

  return {
    ids,
    SubscriptionModel: {
      findById() {
        return {
          lean: () => Promise.resolve({
            addonSubscriptions: [{
              addonPlanId: ids.planAddon,
              category: "juice",
              menuProductIds: [ids.berry],
            }],
          }),
        };
      },
    },
    MenuCategoryModel: {
      find(query) {
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
        const categoryIds = query.categoryId && query.categoryId.$in ? query.categoryId.$in : [];
        const keys = query.key && query.key.$in ? query.key.$in : null;
        return queryResult(products.filter((product) => {
          if (!categoryIds.includes(product.categoryId)) return false;
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
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.juice.sourceCategories, ["juices", "drinks"]);
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.snack.sourceCategories, ["desserts"]);
  assert.deepStrictEqual(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.small_salad.sourceCategories, ["light_options"]);

  const data = await buildAddonChoicesCatalog({ lang: "en", models: fixtureModels });
  assert.deepStrictEqual(Object.keys(data), ["juice", "snack", "small_salad"]);

  const juiceCategoryKeys = data.juice.choices.map((choice) => choice.categoryKey).sort();
  assert.deepStrictEqual(juiceCategoryKeys, ["drinks", "juices"]);
  assert(data.juice.choices.every((choice) => choice.type === "menu_product"));
  assert(!data.juice.choices.some((choice) => choice.kind === "plan" || choice.type === "subscription"));
  assert(!data.juice.choices.some((choice) => choice.id === fixtureModels.ids.planAddon));

  const entitledData = await buildAddonChoicesCatalog({
    lang: "en",
    subscriptionId: "507f191e810c19729de86999",
    models: fixtureModels,
  });
  assert(entitledData.juice.choices.every((choice) => choice.isEligibleForAllowance === true),
    "all mapped juice products are eligible for the purchased juice category balance");
  assert(entitledData.snack.choices.every((choice) => choice.isEligibleForAllowance === false));

  const legacyModels = buildModels();
  legacyModels.SubscriptionModel = {
    findById() {
      return {
        lean: () => Promise.resolve({
          addonSubscriptions: [{ menuProductIds: [legacyModels.ids.berry] }],
        }),
      };
    },
  };
  const legacyEntitledData = await buildAddonChoicesCatalog({
    lang: "en",
    subscriptionId: "507f191e810c19729de86998",
    models: legacyModels,
  });
  assert.strictEqual(
    legacyEntitledData.juice.choices.find((choice) => choice.id === legacyModels.ids.berry).isEligibleForAllowance,
    true
  );
  assert.strictEqual(
    legacyEntitledData.juice.choices.find((choice) => choice.id === legacyModels.ids.water).isEligibleForAllowance,
    false
  );

  const snackCategoryKeys = data.snack.choices.map((choice) => choice.categoryKey);
  assert.deepStrictEqual(snackCategoryKeys, ["desserts"]);
  assert(data.snack.choices.every((choice) => choice.type === "menu_product"));
  assert(data.snack.choices.every((choice) => choice.itemType === "dessert"));

  assert.deepStrictEqual(data.small_salad.sourceCategories, ["light_options"]);
  assert.deepStrictEqual(data.small_salad.choices.map((choice) => choice.key), ["green_salad"]);
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
  assert.strictEqual(resolved.addonCategory, "juice");
  assert.strictEqual(resolved.category.key, "drinks");

  const rejectedLightOption = await resolveAddonChoiceProductById(models.ids.yogurt, { models });
  assert.strictEqual(rejectedLightOption, null);

  const subscriptionPlanFilters = resolvePublicAddonFilters({ type: "subscription" });
  assert.strictEqual(subscriptionPlanFilters.isActive, true);
  assert(subscriptionPlanFilters.$or.some((entry) => entry.kind === "plan"));
  assert(!subscriptionPlanFilters.$or.some((entry) => entry.kind === "item"));

  const oneTimeFilters = resolvePublicAddonFilters({ type: "one_time" });
  assert(oneTimeFilters.$or.some((entry) => entry.kind === "item"));
  assert(!oneTimeFilters.$or.some((entry) => entry.kind === "plan"));
}

run()
  .then(() => {
    console.log("subscription_addon_choices tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
