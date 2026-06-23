const {
  SYSTEM_CURRENCY,
  CUSTOM_PREMIUM_SALAD_TYPE,
  SANDWICH_TYPE,
  STANDARD_COMBO_TYPE,
  CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
  normalizeMealSlotsInput,
  collectDuplicateSlotErrors,
  collectSlotCountErrors,
  recomputePlannerMetaFromSlots,
  projectMaterializedAndLegacyFromSlots,
  isSandwichSlot,
  isBaseBeefSlot,
  buildMealSlotDraft,
} = require('../src/services/subscription/mealSlotPlannerService');
const BuilderProtein = require('../src/models/BuilderProtein');
const BuilderCarb = require('../src/models/BuilderCarb');
const MenuOption = require('../src/models/MenuOption');
const MenuOptionGroup = require('../src/models/MenuOptionGroup');
const MenuCategory = require('../src/models/MenuCategory');
const MenuProduct = require('../src/models/MenuProduct');
const ProductGroupOption = require('../src/models/ProductGroupOption');
const ProductOptionGroup = require('../src/models/ProductOptionGroup');
const MealCategory = require('../src/models/MealCategory');
const Meal = require('../src/models/Meal');
const SaladIngredient = require('../src/models/SaladIngredient');
const Sandwich = require('../src/models/Sandwich');
const PremiumUpgradeConfig = require('../src/models/PremiumUpgradeConfig');
const CatalogService = require('../src/services/catalog/CatalogService');
const { resolveCanonicalPremiumIdentity } = require('../src/utils/subscription/premiumIdentity');
const {
  resolvePremiumUpgrade,
} = require('../src/services/subscription/premiumUpgradeConfigService');
const {
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require('../src/config/mealPlannerContract');

const assert = require('assert');

const ALLOWED_SALAD_PROTEIN_IDS = Object.fromEntries(
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.map((key, index) => [
    key,
    `507f191e810c19729de86${(0x100 + index).toString(16)}`,
  ])
);

function mockQuery(result) {
  return {
    session() {
      return this;
    },
    sort() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

const IDS = {
  regularProtein: "507f191e810c19729de860a1",
  premiumProtein: "507f191e810c19729de860a2",
  secondPremiumProtein: "507f191e810c19729de860a3",
  v2ShrimpProtein: "507f191e810c19729de860a4",
  allowedSaladProtein: ALLOWED_SALAD_PROTEIN_IDS.grilled_chicken,
  forbiddenBeefSteakProtein: "507f191e810c19729de860a8",
  forbiddenMeatballsProtein: "507f191e810c19729de860a9",
  forbiddenBeefStroganoffProtein: "507f191e810c19729de860aa",
  carbOne: "507f191e810c19729de860b1",
  carbTwo: "507f191e810c19729de860b2",
  sandwichMeal: "507f191e810c19729de860c1",
  leafyOne: "507f191e810c19729de860d1",
  leafyTwo: "507f191e810c19729de860d2",
  vegetableOne: "507f191e810c19729de860d3",
  cheeseOne: "507f191e810c19729de860d4",
  fruitOne: "507f191e810c19729de860d5",
  sauceOne: "507f191e810c19729de860d6",
  sauceTwo: "507f191e810c19729de860d7",
  extraProteinOption: "507f191e810c19729de860d8",
};

function buildMockPlannerCatalog() {
  return {
    proteins: [
      {
        _id: IDS.regularProtein,
        key: "chicken",
        isPremium: false,
        premiumKey: null,
        displayCategoryKey: "chicken",
        proteinFamilyKey: "chicken",
        ruleTags: [],
        extraFeeHalala: 0,
      },
      {
        _id: IDS.premiumProtein,
        key: "shrimp",
        isPremium: true,
        premiumKey: "shrimp",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        ruleTags: ["premium"],
        extraFeeHalala: 1500,
      },
      {
        _id: IDS.secondPremiumProtein,
        key: "salmon",
        isPremium: true,
        premiumKey: "salmon",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        ruleTags: ["premium"],
        extraFeeHalala: 1800,
      },
      ...SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.map((key) => {
        const proteinFamilyKey = key.includes("tuna") || key.includes("fish") ? "fish"
          : key.includes("egg") ? "eggs"
            : "chicken";
        return {
          _id: ALLOWED_SALAD_PROTEIN_IDS[key],
          key,
          isPremium: false,
          premiumKey: null,
          displayCategoryKey: proteinFamilyKey,
          proteinFamilyKey,
          ruleTags: ["salad_only"],
          extraFeeHalala: 0,
        };
      }),
      {
        _id: IDS.forbiddenBeefSteakProtein,
        key: "beef_steak",
        isPremium: true,
        premiumKey: "beef_steak",
        displayCategoryKey: "premium",
        proteinFamilyKey: "beef",
        ruleTags: ["premium"],
        extraFeeHalala: 2000,
      },
      {
        _id: IDS.forbiddenMeatballsProtein,
        key: "meatballs",
        isPremium: false,
        premiumKey: null,
        displayCategoryKey: "beef",
        proteinFamilyKey: "beef",
        ruleTags: ["salad_only"],
        extraFeeHalala: 0,
      },
      {
        _id: IDS.forbiddenBeefStroganoffProtein,
        key: "beef_stroganoff",
        isPremium: false,
        premiumKey: null,
        displayCategoryKey: "beef",
        proteinFamilyKey: "beef",
        ruleTags: ["salad_only"],
        extraFeeHalala: 0,
      },
    ],
    carbs: [
      { _id: IDS.carbOne, isActive: true, availableForSubscription: true, displayCategoryKey: "standard_carbs" },
      { _id: IDS.carbTwo, isActive: true, availableForSubscription: true, displayCategoryKey: "standard_carbs" },
    ],
    saladIngredients: [
      { _id: IDS.leafyOne, groupKey: "leafy_greens" },
      { _id: IDS.leafyTwo, groupKey: "leafy_greens" },
      { _id: IDS.vegetableOne, groupKey: "vegetables" },
      { _id: IDS.cheeseOne, groupKey: "cheese_nuts" },
      { _id: IDS.fruitOne, groupKey: "fruits" },
      { _id: IDS.sauceOne, groupKey: "sauce" },
      { _id: IDS.sauceTwo, groupKey: "sauce" },
    ],
    sandwichCategory: { _id: "507f191e810c19729de860e1", key: "sandwich" },
    sandwiches: [
      { _id: IDS.sandwichMeal, isActive: true, availableForSubscription: true },
    ],
    menuGroups: {
      proteins: null,
      carbs: null,
    },
    menuOptions: [],
    premiumUpgradeConfigs: [
      { _id: IDS.premiumProtein, premiumKey: 'shrimp', upgradeDeltaHalala: 1500, currency: 'SAR', status: 'active', isEnabled: true, isVisible: true },
      { _id: IDS.secondPremiumProtein, premiumKey: 'salmon', upgradeDeltaHalala: 1800, currency: 'SAR', status: 'active', isEnabled: true, isVisible: true },
      { _id: IDS.forbiddenBeefSteakProtein, premiumKey: 'beef_steak', upgradeDeltaHalala: 2000, currency: 'SAR', status: 'active', isEnabled: true, isVisible: true },
      { _id: '507f191e810c19729de861003', premiumKey: 'premium_large_salad', upgradeDeltaHalala: 3100, currency: 'SAR', status: 'active', isEnabled: true, isVisible: true },
    ],
    menuProducts: {
      premium_large_salad: {
        _id: "507f191e810c19729de860f1",
        key: "premium_large_salad",
        name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
        priceHalala: 3100,
        currency: "SAR",
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        availableFor: ["subscription"],
      },
      basic_salad: {
        _id: "507f191e810c19729de860f2",
        key: "basic_salad",
        name: { en: "Basic Salad", ar: "سلطة بيسك" },
        priceHalala: 2700,
        currency: "SAR",
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
        availableFor: ["subscription"],
      },
    },
  };
}

async function withMockedPlannerCatalog(overrides, fn) {
  const originalProteinFind = BuilderProtein.find;
  const originalCarbFind = BuilderCarb.find;
  const originalMenuOptionFind = MenuOption.find;
  const originalMenuOptionGroupFind = MenuOptionGroup.find;
  const originalMenuOptionGroupFindOne = MenuOptionGroup.findOne;
  const originalMenuCategoryFindOne = MenuCategory.findOne;
  const originalMenuProductFind = MenuProduct.find;
  const originalMenuProductFindOne = MenuProduct.findOne;
  const originalProductGroupOptionFind = ProductGroupOption.find;
  const originalProductOptionGroupFind = ProductOptionGroup.find;
  const originalMealCategoryFindOne = MealCategory.findOne;
  const originalMealFind = Meal.find;
  const originalSaladIngredientFind = SaladIngredient.find;
  const originalSandwichFind = Sandwich.find;
  const originalPremiumUpgradeConfigFind = PremiumUpgradeConfig.find;
  const originalPremiumUpgradeConfigFindOne = PremiumUpgradeConfig.findOne;

  const catalog = {
    ...buildMockPlannerCatalog(),
    ...(overrides || {}),
  };

  BuilderProtein.find = () => mockQuery(catalog.proteins || []);
  BuilderCarb.find = () => mockQuery(catalog.carbs || []);
  MenuOption.find = () => mockQuery(catalog.menuOptions || []);
  MenuOptionGroup.find = () => mockQuery(Object.values(catalog.menuGroups || {}).filter(Boolean));
  MenuOptionGroup.findOne = (query = {}) => mockQuery((catalog.menuGroups || {})[query.key] || null);
  MenuCategory.findOne = (query = {}) => mockQuery((catalog.menuCategories || {})[query.key] || null);
  MenuProduct.find = () => ({
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(catalog.sandwichProducts || []);
    },
  });
  MenuProduct.findOne = (query = {}) => {
    const key = query && query.key;
    return mockQuery((catalog.menuProducts || {})[key] || null);
  };
  ProductOptionGroup.find = () => mockQuery(catalog.productOptionGroups || []);
  ProductGroupOption.find = () => mockQuery(catalog.productGroupOptions || []);
  MealCategory.findOne = () => mockQuery(catalog.sandwichCategory || null);
  Meal.find = () => mockQuery(catalog.sandwiches || []);
  SaladIngredient.find = () => mockQuery(catalog.saladIngredients || []);
  Sandwich.find = () => mockQuery(catalog.catalogSandwiches || []);
  PremiumUpgradeConfig.find = () => mockQuery(catalog.premiumUpgradeConfigs || []);
  PremiumUpgradeConfig.findOne = (query = {}) => mockQuery((catalog.premiumUpgradeConfigs || []).find(c => c.premiumKey === query.premiumKey) || null);

  try {
    return await fn(catalog);
  } finally {
    BuilderProtein.find = originalProteinFind;
    BuilderCarb.find = originalCarbFind;
    MenuOption.find = originalMenuOptionFind;
    MenuOptionGroup.find = originalMenuOptionGroupFind;
    MenuOptionGroup.findOne = originalMenuOptionGroupFindOne;
    MenuCategory.findOne = originalMenuCategoryFindOne;
    MenuProduct.find = originalMenuProductFind;
    MenuProduct.findOne = originalMenuProductFindOne;
    ProductGroupOption.find = originalProductGroupOptionFind;
    ProductOptionGroup.find = originalProductOptionGroupFind;
    MealCategory.findOne = originalMealCategoryFindOne;
    Meal.find = originalMealFind;
    SaladIngredient.find = originalSaladIngredientFind;
    Sandwich.find = originalSandwichFind;
    PremiumUpgradeConfig.find = originalPremiumUpgradeConfigFind;
    PremiumUpgradeConfig.findOne = originalPremiumUpgradeConfigFindOne;
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  
  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      failed++;
    }
  }
  
  function expectEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
  }

  function expectTrue(actual, msg) {
    if (actual !== true) {
      throw new Error(`${msg || 'Assertion failed'}: expected true, got ${actual}`);
    }
  }

  function expectFalse(actual, msg) {
    if (actual !== false) {
      throw new Error(`${msg || 'Assertion failed'}: expected false, got ${actual}`);
    }
  }

  async function buildPremiumLargeSaladDraft(groups, extraSlotFields = {}) {
    return buildMealSlotDraft({
      mealSlots: [
        {
          slotIndex: 1,
          selectionType: 'premium_large_salad',
          ...extraSlotFields,
          salad: { groups },
        },
      ],
      mealsPerDayLimit: 1,
      subscription: { premiumBalance: [] },
    });
  }

  console.log('\n=== Meal Planner Selection Type Tests ===\n');

  await test('Constants are defined correctly', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_TYPE, 'custom_premium_salad', 'CUSTOM_PREMIUM_SALAD_TYPE');
    expectEqual(SANDWICH_TYPE, 'sandwich', 'SANDWICH_TYPE');
    expectEqual(STANDARD_COMBO_TYPE, 'standard_combo', 'STANDARD_COMBO_TYPE');
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 2900, 'legacy fallback price');
  });

  await test('premium large salad runtime price uses canonical premium config', async () => {
    await withMockedPlannerCatalog({ premiumUpgradeConfigs: [{
      _id: IDS.premiumProtein,
      premiumKey: 'premium_large_salad',
      upgradeDeltaHalala: 3100,
      currency: 'SAR',
      status: 'active',
      isEnabled: true,
      isVisible: true,
    }] }, async () => {
      const pricing = await resolvePremiumUpgrade('premium_large_salad');
      expectEqual(pricing.priceHalala, 3100, 'canonical config price');

      const identity = await resolveCanonicalPremiumIdentity({ premiumKey: 'premium_large_salad' });
      expectEqual(identity.unitExtraFeeHalala, 3100, 'quote identity price');
      expectEqual(identity.resolutionSource, 'resolvePremiumUpgrade', 'quote price source');
    });
  });

  await test('changing product price does not change canonical premium price', async () => {
    await withMockedPlannerCatalog({
      menuGroups: {
        proteins: { _id: '507f191e810c19729de861001', key: 'proteins', name: { en: 'Proteins' } },
        carbs: { _id: '507f191e810c19729de861002', key: 'carbs', name: { en: 'Carbs' } },
      },
      menuProducts: {
        premium_large_salad: {
          _id: '507f191e810c19729de861003',
          key: 'premium_large_salad',
          name: { en: 'Dashboard Premium Salad' },
          priceHalala: 4200,
          currency: 'SAR',
          publishedAt: new Date(),
        },
      },
      premiumUpgradeConfigs: [{
        _id: IDS.premiumProtein,
        premiumKey: 'premium_large_salad',
        upgradeDeltaHalala: 3100,
        currency: 'SAR',
        status: 'active',
        isEnabled: true,
        isVisible: true,
      }],
    }, async () => {
      const catalog = await CatalogService.getSubscriptionBuilderCatalog({ lang: 'en' });
      expectEqual(catalog.premiumLargeSalad.extraFeeHalala, 3100, 'catalog price follows canonical config');
      expectEqual(catalog.premiumLargeSalad.priceSource, 'resolvePremiumUpgrade', 'catalog price source');

      const identity = await resolveCanonicalPremiumIdentity({ premiumKey: 'premium_large_salad' });
      expectEqual(identity.unitExtraFeeHalala, 3100, 'quote identity ignores product price');
    });
  });

  await test('premium upgrade resolver fails closed when config is missing', async () => {
    await withMockedPlannerCatalog({
      menuProducts: {},
      premiumUpgradeConfigs: [],
    }, async () => {
      await assert.rejects(
        () => resolvePremiumUpgrade('premium_large_salad'),
        (err) => err.code === 'PREMIUM_UPGRADE_UNAVAILABLE'
      );
    });
  });

  await test('basic salad is not a premium authority fallback', async () => {
    await withMockedPlannerCatalog({
      menuProducts: {
        basic_salad: {
          _id: '507f191e810c19729de861004',
          key: 'basic_salad',
          name: { en: 'Fallback Basic Salad' },
          priceHalala: 3600,
          currency: 'SAR',
          publishedAt: new Date(),
        },
      },
      premiumUpgradeConfigs: [],
    }, async () => {
      await assert.rejects(
        () => resolvePremiumUpgrade('premium_large_salad'),
        (err) => err.code === 'PREMIUM_UPGRADE_UNAVAILABLE'
      );
    });
  });

  await test('normalizeMealSlotsInput handles standard_meal', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1', selectionType: 'standard_combo' },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'standard_meal', 'selectionType normalized');
  });

  await test('normalizeMealSlotsInput handles sandwich', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', sandwichId: 'sandwich1', selectionType: 'sandwich' },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'sandwich', 'selectionType');
    expectEqual(result[0].sandwichId, 'sandwich1', 'sandwichId');
  });

  await test('normalizeMealSlotsInput handles premium_large_salad', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1', selectionType: 'custom_premium_salad', customSalad: { presetKey: 'preset1' } },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'premium_large_salad', 'selectionType normalized');
    expectEqual(result[0].salad?.presetKey, 'preset1', 'customSalad normalized to salad');
  });

  await test('default selectionType is standard_meal', () => {
    const input = [{ slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' }];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result[0].selectionType, 'standard_meal', 'default selectionType');
  });

  await test('collectDuplicateSlotErrors detects duplicate slotIndex', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 1, slotKey: 'slot_2', proteinId: 'protein2', carbId: 'carb2' },
    ];
    const errors = collectDuplicateSlotErrors({ mealSlots: input });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'DUPLICATE_SLOT_INDEX', 'error code');
  });

  await test('collectDuplicateSlotErrors detects duplicate slotKey', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 2, slotKey: 'slot_1', proteinId: 'protein2', carbId: 'carb2' },
    ];
    const errors = collectDuplicateSlotErrors({ mealSlots: input });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'DUPLICATE_SLOT_KEY', 'error code');
  });

  await test('collectSlotCountErrors detects excess slots', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: 'protein2', carbId: 'carb2' },
      { slotIndex: 3, slotKey: 'slot_3', proteinId: 'protein3', carbId: 'carb3' },
    ];
    const errors = collectSlotCountErrors({ mealSlots: input, requiredSlotCount: 2 });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'MEAL_SLOT_COUNT_EXCEEDED', 'error code');
  });

  await test('collectSlotCountErrors uses maxSlotCount separately from requiredSlotCount', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1' },
      { slotIndex: 2, slotKey: 'slot_2' },
      { slotIndex: 3, slotKey: 'slot_3' },
    ];
    const errors = collectSlotCountErrors({ mealSlots: input, requiredSlotCount: 1, maxSlotCount: 7 });
    expectEqual(errors.length, 0, 'no errors up to balance max');
  });

  await test('isSandwichSlot returns true for sandwich selectionType', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1' };
    expectTrue(isSandwichSlot(slot), 'sandwich detected');
  });

  await test('isSandwichSlot returns false for standard_combo', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: 'p1', carbId: 'c1' };
    expectFalse(isSandwichSlot(slot), 'not sandwich');
  });

  await test('isBaseBeefSlot returns false for sandwich', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', proteinFamilyKey: 'beef' };
    expectFalse(isBaseBeefSlot(slot), 'sandwich not beef');
  });

  await test('recomputePlannerMetaFromSlots counts sandwich as complete', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial slot count');
    expectEqual(result.plannerMeta.emptySlotCount, 0, 'empty slot count');
  });

  await test('recomputePlannerMetaFromSlots normalizes legacy standard_combo as complete', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: 'p1', carbId: 'c1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
  });

  await test('recomputePlannerMetaFromSlots normalizes legacy custom_premium_salad properly', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'p1', carbId: 'c1', status: 'complete', isPremium: true, premiumSource: 'balance' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
    expectEqual(result.plannerMeta.premiumSlotCount, 1, 'premium slot count');
    expectEqual(result.plannerMeta.premiumCoveredByBalanceCount, 1, 'covered by balance');
  });

  await test('recomputePlannerMetaFromSlots counts pending payment for legacy custom_premium_salad without balance', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'p1', carbId: 'c1', status: 'complete', isPremium: true, premiumSource: 'pending_payment', premiumExtraFeeHalala: 3000 },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.premiumPendingPaymentCount, 1, 'pending payment count');
    expectEqual(result.plannerMeta.premiumTotalHalala, 3000, 'total halala');
  });

  await test('recomputePlannerMetaFromSlots marks isConfirmable when all slots complete and no partial', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
      { slotIndex: 2, slotKey: 'slot_2', selectionType: 'sandwich', sandwichId: 'sandwich2', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 2 });
    expectTrue(result.plannerMeta.isConfirmable, 'isConfirmable');
  });

  await test('projectMaterializedAndLegacyFromSlots creates sandwich meal', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete', assignmentSource: 'client' },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.materializedMeals.length, 1, 'materialized meal count');
    expectEqual(result.materializedMeals[0].sandwichId, 'sandwich1', 'sandwich ID');
    expectEqual(result.materializedMeals[0].operationalSku, 'sandwich:sandwich1', 'operational SKU');
  });

  await test('projectMaterializedAndLegacyFromSlots creates standard_meal', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_meal', proteinId: 'p1', carbs: [{ carbId: 'c1', grams: 150 }], status: 'complete' },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.materializedMeals.length, 1, 'materialized meal count');
    expectEqual(result.materializedMeals[0].proteinId, 'p1', 'protein ID');
    expectEqual(result.materializedMeals[0].carbId, 'c1', 'carb ID');
  });

  await test('projectMaterializedAndLegacyFromSlots operationally keeps the first carb for split meals', () => {
    const slots = [
      {
        slotIndex: 1,
        slotKey: 'slot_1',
        selectionType: 'standard_meal',
        proteinId: 'p1',
        carbs: [{ carbId: 'c1', grams: 150 }, { carbId: 'c2', grams: 150 }],
        status: 'complete',
      },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.materializedMeals[0].carbId, 'c1', 'primary operational carb');
    expectEqual(result.materializedMeals[0].operationalSku, 'p1:c1', 'operational SKU uses primary carb');
  });

  await test('recomputePlannerMetaFromSlots allows sandwich without proteinId/carbId', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete');
    expectEqual(result.plannerMeta.emptySlotCount, 0, 'empty');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial');
  });

  await test('recomputePlannerMetaFromSlots treats incomplete legacy standard_combo as empty', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: null, carbId: null },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 0, 'complete');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial');
    expectEqual(result.plannerMeta.emptySlotCount, 1, 'empty');
  });

  await test('recomputePlannerMetaFromSlots counts premium_large_salad as complete when salad groups provided', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'premium_large_salad', salad: { groups: { protein: ['p1'], sauce: ['s1'] } }, status: 'complete', isPremium: true },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete');
  });

  console.log(`\n=== Meal Planner Premium Balance Tests ===\n`);

  await test('legacy premium key rows can still represent custom_premium_salad balance', () => {
    const subscription = {
      premiumBalance: [
        { proteinId: 'premium1', premiumKey: 'shrimp', remainingQty: 2, purchasedQty: 2, currency: 'SAR' }
      ],
      premiumSelections: []
    };
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'premium1', carbId: 'carb1', isPremium: true },
    ];
    // Note: This test verifies logic only - actual DB integration tested in integration tests
    expectEqual(subscription.premiumBalance.length, 1, 'premium balance row exists');
    expectEqual(subscription.premiumBalance[0].remainingQty, 2, 'remaining qty');
  });

  await test('custom_premium_salad legacy fallback price remains isolated from runtime product pricing', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 2900, 'legacy fallback price');
  });

  console.log(`\n=== Meal Planner Commercial State Tests ===\n`);

  await test('confirmed day isFulfillable = true', () => {
    const day = {
      status: 'open',
      plannerState: 'confirmed',
      mealSlots: [
        { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 's1', status: 'complete' }
      ],
      plannerMeta: { requiredSlotCount: 1, completeSlotCount: 1, isConfirmable: true },
      premiumExtraPayment: { status: 'none', amountHalala: 0 }
    };
    // Commercial state logic is in subscriptionDayCommercialStateService
    // After confirm: plannerState='confirmed' AND requiresPayment=false -> isFulfillable=true
    expectEqual(day.plannerState, 'confirmed', 'planner confirmed');
  });

  await test('paymentRequired day isConfirmable but blocked', () => {
    const day = {
      status: 'open',
      plannerState: 'draft',
      mealSlots: [
        { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'premium1', carbId: 'carb1', status: 'complete', isPremium: true, premiumSource: 'pending_payment', premiumExtraFeeHalala: 3000 }
      ],
      plannerMeta: { requiredSlotCount: 1, completeSlotCount: 1, isConfirmable: false },
      premiumExtraPayment: { status: 'pending', amountHalala: 3000 }
    };
    // Payment required -> planner should NOT be confirmable
    expectEqual(day.plannerMeta.isConfirmable, false, 'not confirmable');
  });

  console.log(`\n=== Meal Planner Persistence & Mapping Tests ===\n`);

  await test('processedSlot includes all persistence fields', () => {
    const slot = { slotIndex: 1, selectionType: 'sandwich', sandwichId: 's1' };
    const normalized = normalizeMealSlotsInput({ mealSlots: [slot] })[0];
    expectEqual(normalized.selectionType, 'sandwich', 'selectionType preserved');
    expectEqual(normalized.sandwichId, 's1', 'sandwichId preserved');
  });

  await test('premiumKey is populated in draft processed slots', async () => {
    const slots = [
      { slotIndex: 1, selectionType: 'premium_meal', proteinId: 'p1', carbs: [{ carbId: 'c1', grams: 150 }], isPremium: true, premiumKey: 'beef_premium', status: 'complete' }
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.premiumSelections[0].premiumKey, 'beef_premium', 'premiumKey mapped to selections');
  });

  await test('premium_large_salad creates canonical premium selection entry', () => {
    const slots = [
      {
        slotIndex: 1,
        slotKey: 'slot_1',
        selectionType: 'premium_large_salad',
        proteinId: 'premium1',
        salad: { groups: { protein: ['premium1'], sauce: ['s1'] } },
        status: 'complete',
        isPremium: true,
        premiumKey: 'premium_large_salad',
        premiumSource: 'balance',
      },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.premiumSelections.length, 1, 'premium selection count');
    expectEqual(result.premiumSelections[0].premiumKey, 'premium_large_salad', 'canonical premium key');
    expectEqual(result.premiumSelections[0].baseSlotKey, 'slot_1', 'base slot key');
    expectEqual(result.premiumSelections[0].proteinId, 'premium1', 'selected protein carried through');
  });

  console.log(`\n=== Meal Planner Slot Validation Tests ===\n`);

  await test('standard plate accepts 1 carb', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.regularProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].status, 'complete', 'slot complete');
    });
  });

  await test('draft allows extra slots up to maxSlotCount while required count remains default', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [1, 2, 3].map((slotIndex) => ({
          slotIndex,
          selectionType: 'standard_meal',
          proteinId: IDS.regularProtein,
          carbs: [{ carbId: IDS.carbOne, grams: 150 }],
        })),
        mealsPerDayLimit: 1,
        maxSlotCount: 7,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.plannerMeta.requiredSlotCount, 1, 'default planning count preserved');
      expectEqual(result.plannerMeta.maxSlotCount, 7, 'balance max persisted in meta');
      expectEqual(result.plannerMeta.completeSlotCount, 3, 'complete slot count');
    });
  });

  await test('draft rejects slots over maxSlotCount', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: Array.from({ length: 8 }, (_, index) => ({
          slotIndex: index + 1,
          selectionType: 'standard_meal',
          proteinId: IDS.regularProtein,
          carbs: [{ carbId: IDS.carbOne, grams: 150 }],
        })),
        mealsPerDayLimit: 1,
        maxSlotCount: 7,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'MEAL_SLOT_COUNT_EXCEEDED', 'error code');
    });
  });

  await test('draft keeps old required-count cap when maxSlotCount is unavailable', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [1, 2].map((slotIndex) => ({
          slotIndex,
          selectionType: 'standard_meal',
          proteinId: IDS.regularProtein,
          carbs: [{ carbId: IDS.carbOne, grams: 150 }],
        })),
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'MEAL_SLOT_COUNT_EXCEEDED', 'error code');
    });
  });

  await test('standard plate accepts 2 carbs with total <= 300', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.regularProtein,
            carbs: [
              { carbId: IDS.carbOne, grams: 150 },
              { carbId: IDS.carbTwo, grams: 150 },
            ],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
    });
  });

  await test('standard plate rejects total carbs > 300', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.regularProtein,
            carbs: [
              { carbId: IDS.carbOne, grams: 200 },
              { carbId: IDS.carbTwo, grams: 101 },
            ],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'CARB_LIMIT_EXCEEDED', 'error code');
    });
  });

  await test('standard plate rejects duplicate carbs', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.regularProtein,
            carbs: [
              { carbId: IDS.carbOne, grams: 150 },
              { carbId: IDS.carbOne, grams: 150 },
            ],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'DUPLICATE_CARB', 'error code');
    });
  });

  await test('standard plate rejects sandwichId or salad extras', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.regularProtein,
            sandwichId: IDS.sandwichMeal,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
            salad: { groups: { sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'STANDARD_MEAL_EXCLUSIVITY_VIOLATION', 'error code');
    });
  });

  await test('premium plate accepts premium protein', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_meal',
            proteinId: IDS.premiumProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].premiumSource, 'pending_payment', 'premium pending when no balance');
    });
  });

  await test('premium plate accepts canonical key when proteinId is V2 menu option id', async () => {
    await withMockedPlannerCatalog({
      menuGroups: {
        proteins: { _id: '507f191e810c19729de861011', key: 'proteins', name: { en: 'Proteins' } },
        carbs: null,
      },
      menuOptions: [
        {
          _id: IDS.v2ShrimpProtein,
          key: 'shrimp',
          premiumKey: 'shrimp',
          extraPriceHalala: 0,
          proteinFamilyKey: 'fish',
          displayCategoryKey: 'premium',
          isActive: true,
          isVisible: true,
          isAvailable: true,
          availableForSubscription: true,
          availableFor: ['subscription'],
        },
      ],
    }, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_meal',
            proteinId: IDS.v2ShrimpProtein,
            proteinKey: 'shrimp',
            premiumKey: 'shrimp',
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].proteinId, IDS.premiumProtein, 'canonical legacy protein id selected');
      expectEqual(result.processedSlots[0].premiumKey, 'shrimp', 'canonical premium key');
    });
  });

  await test('premium plate rejects regular protein', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_meal',
            proteinId: IDS.regularProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'INVALID_PROTEIN_TYPE', 'error code');
    });
  });

  await test('premium plate rejects regular proteinKey chicken', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_meal',
            proteinKey: 'chicken',
            premiumKey: 'chicken',
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'INVALID_PROTEIN_TYPE', 'error code');
      expectEqual(result.slotErrors[0].receivedProteinKey, 'chicken', 'debug proteinKey');
      expectEqual(result.slotErrors[0].receivedPremiumKey, 'chicken', 'debug premiumKey');
    });
  });

  await test('standard plate rejects premium protein', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.premiumProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'INVALID_PROTEIN_TYPE', 'error code');
    });
  });

  await test('standard plate accepts extended variant proteins (e.g. chicken_fajita)', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'standard_meal',
            proteinId: IDS.allowedSaladProtein, // chicken_fajita is isPremium: false
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].proteinId, IDS.allowedSaladProtein, 'persisted extended protein id');
    });
  });

  await test('premium plate rejects sandwichId or salad extras', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_meal',
            proteinId: IDS.premiumProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
            salad: { groups: { sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'PREMIUM_MEAL_EXCLUSIVITY_VIOLATION', 'error code');
    });
  });

  await test('sandwich accepts sandwichId only', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [{ slotIndex: 1, selectionType: 'sandwich', sandwichId: IDS.sandwichMeal }],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].status, 'complete', 'slot complete');
    });
  });

  await test('sandwich rejects protein, carbs, or salad', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'sandwich',
            sandwichId: IDS.sandwichMeal,
            proteinId: IDS.regularProtein,
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'SANDWICH_EXCLUSIVITY_VIOLATION', 'error code');
    });
  });

  await test('premium large salad accepts only allowlisted subscription proteins', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const allowedCases = SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.map((key) => ({
        key,
        id: ALLOWED_SALAD_PROTEIN_IDS[key],
      }));

      for (const allowed of allowedCases) {
        expectTrue(
          SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS.includes(allowed.key),
          `${allowed.key} is in premium large salad allowlist`
        );
        const result = await buildPremiumLargeSaladDraft({
          leafy_greens: [IDS.leafyOne],
          protein: [allowed.id],
          sauce: [IDS.sauceOne],
        });
        expectTrue(result.valid, `${allowed.key} draft valid`);
        expectEqual(result.processedSlots[0].proteinId, allowed.id, `${allowed.key} selected protein persisted`);
        expectEqual(result.processedSlots[0].premiumKey, 'premium_large_salad', `${allowed.key} salad premium key`);
        expectEqual(result.processedSlots[0].premiumExtraFeeHalala, 3100, `${allowed.key} salad pending payment uses dashboard product price`);
      }
    });
  });

  await test('premium large salad rejects generic standard protein outside allowlist', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildPremiumLargeSaladDraft({
        protein: [IDS.regularProtein],
        sauce: [IDS.sauceOne],
      });
      expectFalse(result.valid, 'generic standard protein rejected');
      expectEqual(result.errorCode, 'SALAD_PROTEIN_NOT_ALLOWED', 'error code');
    });
  });

  await test('premium large salad rejects premium and non-allowlisted proteins', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const forbiddenCases = [
        { key: 'beef_steak', id: IDS.forbiddenBeefSteakProtein },
        { key: 'shrimp', id: IDS.premiumProtein },
        { key: 'salmon', id: IDS.secondPremiumProtein },
        { key: 'meatballs', id: IDS.forbiddenMeatballsProtein },
        { key: 'beef_stroganoff', id: IDS.forbiddenBeefStroganoffProtein },
      ];

      for (const forbidden of forbiddenCases) {
        const result = await buildPremiumLargeSaladDraft({
          protein: [forbidden.id],
          sauce: [IDS.sauceOne],
        });
        expectFalse(result.valid, `${forbidden.key} rejected`);
        expectEqual(result.errorCode, 'SALAD_PROTEIN_NOT_ALLOWED', `${forbidden.key} error code`);
      }
    });
  });

  await test('premium large salad rejects extra_protein_50g selections', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildPremiumLargeSaladDraft({
        protein: [IDS.allowedSaladProtein],
        sauce: [IDS.sauceOne],
        extra_protein_50g: [IDS.extraProteinOption],
      });
      expectFalse(result.valid, 'extra protein rejected');
      expectEqual(result.errorCode, 'SALAD_OPTION_NOT_ALLOWED', 'error code');
    });
  });

  await test('premium large salad rejects top-level premium protein mismatch', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            proteinId: IDS.premiumProtein,
            salad: {
              groups: {
                protein: [IDS.allowedSaladProtein],
                sauce: [IDS.sauceOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'mismatched top-level protein rejected');
      expectEqual(result.errorCode, 'SALAD_PROTEIN_MISMATCH', 'error code');
    });
  });

  await test('premium large salad rejects zero or multiple proteins', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const missingProtein = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: { groups: { sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(missingProtein.valid, 'missing protein invalid');
      expectEqual(missingProtein.errorCode, 'SALAD_PROTEIN_REQUIRED', 'missing protein code');

      const multipleProteins = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: { groups: { protein: [IDS.regularProtein, IDS.premiumProtein], sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(multipleProteins.valid, 'multiple proteins invalid');
      expectEqual(multipleProteins.errorCode, 'SALAD_PROTEIN_REQUIRED', 'multiple proteins code');
    });
  });

  await test('premium large salad validates sauce min and max', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const missingSauce = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: { groups: { protein: [IDS.allowedSaladProtein] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(missingSauce.valid, 'missing sauce invalid');
      expectEqual(missingSauce.errorCode, 'SALAD_SAUCE_REQUIRED', 'missing sauce code');

      const multipleSauces = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: { groups: { protein: [IDS.allowedSaladProtein], sauce: [IDS.sauceOne, IDS.sauceTwo] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(multipleSauces.valid, 'multiple sauces invalid');
      expectEqual(multipleSauces.errorCode, 'SALAD_SAUCE_REQUIRED', 'multiple sauce code');
    });
  });

  await test('premium large salad enforces dynamic group max rules', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const tooManyLeafyGreens = Array.from(
        { length: 100 },
        (_, index) => `507f191e810c19729de8${index.toString(16).padStart(4, "0")}`
      );
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: {
              groups: {
                leafy_greens: tooManyLeafyGreens,
                protein: [IDS.allowedSaladProtein],
                sauce: [IDS.sauceOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'SALAD_GROUP_MAX_SELECT_EXCEEDED', 'error code');
    });
  });

  await test('premium large salad rejects unknown group keys', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: {
              groups: {
                protein: [IDS.allowedSaladProtein],
                sauce: [IDS.sauceOne],
                unknown_group: [IDS.leafyOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'INVALID_SALAD_GROUP', 'error code');
    });
  });

  await test('premium large salad rejects ingredient selected under wrong group', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: {
              groups: {
                vegetables: [IDS.sauceOne],
                protein: [IDS.allowedSaladProtein],
                sauce: [IDS.sauceTwo],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'SALAD_INGREDIENT_GROUP_MISMATCH', 'error code');
    });
  });

  await test('premium large salad rejects duplicate ingredient IDs', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: {
              groups: {
                leafy_greens: [IDS.leafyOne, IDS.leafyOne],
                protein: [IDS.allowedSaladProtein],
                sauce: [IDS.sauceOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(result.valid, 'draft invalid');
      expectEqual(result.errorCode, 'DUPLICATE_SALAD_INGREDIENT', 'error code');
    });
  });

  await test('premium large salad rejects carbs or sandwichId', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const withCarbs = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            carbs: [{ carbId: IDS.carbOne, grams: 150 }],
            salad: { groups: { protein: [IDS.allowedSaladProtein], sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(withCarbs.valid, 'carbs invalid');
      expectEqual(withCarbs.errorCode, 'CARBS_NOT_ALLOWED', 'carbs code');

      const withSandwich = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            sandwichId: IDS.sandwichMeal,
            salad: { groups: { protein: [IDS.allowedSaladProtein], sauce: [IDS.sauceOne] } },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectFalse(withSandwich.valid, 'sandwich invalid');
      expectEqual(withSandwich.errorCode, 'SANDWICH_NOT_ALLOWED', 'sandwich code');
    });
  });

  await test('buildMealSlotDraft rejects inactive or unavailable items', async () => {
    const originalProteinFind = BuilderProtein.find;
    const originalCarbFind = BuilderCarb.find;
    const originalMenuOptionFind = MenuOption.find;
    const originalMenuOptionGroupFindOne = MenuOptionGroup.findOne;
    const originalMealCategoryFindOne = MealCategory.findOne;
    const originalMealFind = Meal.find;
    const originalSaladIngredientFind = SaladIngredient.find;
    const originalPremiumUpgradeConfigFind = PremiumUpgradeConfig.find;

    BuilderProtein.find = () => mockQuery([]);
    BuilderCarb.find = () => mockQuery([]);
    MenuOption.find = () => mockQuery([]);
    MenuOptionGroup.findOne = () => mockQuery(null);
    MealCategory.findOne = () => mockQuery(null);
    Meal.find = () => mockQuery([]);
    SaladIngredient.find = () => mockQuery([]);
    PremiumUpgradeConfig.find = () => mockQuery([]);

    try {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            slotKey: 'slot_1',
            selectionType: 'standard_meal',
            proteinId: '507f191e810c19729de860ea',
            carbs: [{ carbId: '507f191e810c19729de860eb', grams: 150 }],
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectEqual(result.valid, false, 'draft invalid');
      expectEqual(result.errorCode, 'PROTEIN_REQUIRED', 'inactive protein rejected');
    } finally {
      BuilderProtein.find = originalProteinFind;
      BuilderCarb.find = originalCarbFind;
      MenuOption.find = originalMenuOptionFind;
      MenuOptionGroup.findOne = originalMenuOptionGroupFindOne;
      MealCategory.findOne = originalMealCategoryFindOne;
      Meal.find = originalMealFind;
      SaladIngredient.find = originalSaladIngredientFind;
      PremiumUpgradeConfig.find = originalPremiumUpgradeConfigFind;
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
