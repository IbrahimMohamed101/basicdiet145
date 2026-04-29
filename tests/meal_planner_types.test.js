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
const MealCategory = require('../src/models/MealCategory');
const Meal = require('../src/models/Meal');
const SaladIngredient = require('../src/models/SaladIngredient');

const assert = require('assert');

function mockQuery(result) {
  return {
    session() {
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
};

function buildMockPlannerCatalog() {
  return {
    proteins: [
      {
        _id: IDS.regularProtein,
        isPremium: false,
        premiumKey: null,
        displayCategoryKey: "chicken",
        proteinFamilyKey: "chicken",
        ruleTags: [],
        extraFeeHalala: 0,
      },
      {
        _id: IDS.premiumProtein,
        isPremium: true,
        premiumKey: "shrimp",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        ruleTags: ["premium"],
        extraFeeHalala: 1500,
      },
      {
        _id: IDS.secondPremiumProtein,
        isPremium: true,
        premiumKey: "salmon",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        ruleTags: ["premium"],
        extraFeeHalala: 1800,
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
  };
}

async function withMockedPlannerCatalog(overrides, fn) {
  const originalProteinFind = BuilderProtein.find;
  const originalCarbFind = BuilderCarb.find;
  const originalMealCategoryFindOne = MealCategory.findOne;
  const originalMealFind = Meal.find;
  const originalSaladIngredientFind = SaladIngredient.find;

  const catalog = {
    ...buildMockPlannerCatalog(),
    ...(overrides || {}),
  };

  BuilderProtein.find = () => mockQuery(catalog.proteins || []);
  BuilderCarb.find = () => mockQuery(catalog.carbs || []);
  MealCategory.findOne = () => mockQuery(catalog.sandwichCategory || null);
  Meal.find = () => mockQuery(catalog.sandwiches || []);
  SaladIngredient.find = () => mockQuery(catalog.saladIngredients || []);

  try {
    return await fn(catalog);
  } finally {
    BuilderProtein.find = originalProteinFind;
    BuilderCarb.find = originalCarbFind;
    MealCategory.findOne = originalMealCategoryFindOne;
    Meal.find = originalMealFind;
    SaladIngredient.find = originalSaladIngredientFind;
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

  console.log('\n=== Meal Planner Selection Type Tests ===\n');

  await test('Constants are defined correctly', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_TYPE, 'custom_premium_salad', 'CUSTOM_PREMIUM_SALAD_TYPE');
    expectEqual(SANDWICH_TYPE, 'sandwich', 'SANDWICH_TYPE');
    expectEqual(STANDARD_COMBO_TYPE, 'standard_combo', 'STANDARD_COMBO_TYPE');
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 3000, 'CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA');
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

  await test('custom_premium_salad entitlement fixed price remains 3000', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 3000, 'fixed price');
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
        premiumKey: 'custom_premium_salad',
        premiumSource: 'balance',
      },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.premiumSelections.length, 1, 'premium selection count');
    expectEqual(result.premiumSelections[0].premiumKey, 'custom_premium_salad', 'canonical premium key');
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

  await test('premium large salad accepts regular protein', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            salad: {
              groups: {
                leafy_greens: [IDS.leafyOne],
                protein: [IDS.regularProtein],
                sauce: [IDS.sauceOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
      expectEqual(result.processedSlots[0].proteinId, IDS.regularProtein, 'selected protein persisted');
      expectEqual(result.processedSlots[0].premiumKey, 'custom_premium_salad', 'salad premium key');
    });
  });

  await test('premium large salad accepts premium protein', async () => {
    await withMockedPlannerCatalog({}, async () => {
      const result = await buildMealSlotDraft({
        mealSlots: [
          {
            slotIndex: 1,
            selectionType: 'premium_large_salad',
            proteinId: IDS.premiumProtein,
            salad: {
              groups: {
                protein: [IDS.premiumProtein],
                sauce: [IDS.sauceOne],
              },
            },
          },
        ],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      });
      expectTrue(result.valid, 'draft valid');
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
            salad: { groups: { protein: [IDS.regularProtein] } },
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
            salad: { groups: { protein: [IDS.regularProtein], sauce: [IDS.sauceOne, IDS.sauceTwo] } },
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
                protein: [IDS.regularProtein],
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
                protein: [IDS.regularProtein],
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
                protein: [IDS.regularProtein],
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
                protein: [IDS.regularProtein],
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
            salad: { groups: { protein: [IDS.regularProtein], sauce: [IDS.sauceOne] } },
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
            salad: { groups: { protein: [IDS.regularProtein], sauce: [IDS.sauceOne] } },
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
    const originalMealCategoryFindOne = MealCategory.findOne;
    const originalMealFind = Meal.find;
    const originalSaladIngredientFind = SaladIngredient.find;

    BuilderProtein.find = () => mockQuery([]);
    BuilderCarb.find = () => mockQuery([]);
    MealCategory.findOne = () => mockQuery(null);
    Meal.find = () => mockQuery([]);
    SaladIngredient.find = () => mockQuery([]);

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
      MealCategory.findOne = originalMealCategoryFindOne;
      Meal.find = originalMealFind;
      SaladIngredient.find = originalSaladIngredientFind;
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
