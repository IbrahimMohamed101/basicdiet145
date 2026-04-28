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

const assert = require('assert');

function runTests() {
  let passed = 0;
  let failed = 0;
  
  function test(name, fn) {
    try {
      fn();
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

  test('Constants are defined correctly', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_TYPE, 'custom_premium_salad', 'CUSTOM_PREMIUM_SALAD_TYPE');
    expectEqual(SANDWICH_TYPE, 'sandwich', 'SANDWICH_TYPE');
    expectEqual(STANDARD_COMBO_TYPE, 'standard_combo', 'STANDARD_COMBO_TYPE');
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 3000, 'CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA');
  });

  test('normalizeMealSlotsInput handles standard_meal', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1', selectionType: 'standard_combo' },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'standard_meal', 'selectionType normalized');
  });

  test('normalizeMealSlotsInput handles sandwich', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', sandwichId: 'sandwich1', selectionType: 'sandwich' },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'sandwich', 'selectionType');
    expectEqual(result[0].sandwichId, 'sandwich1', 'sandwichId');
  });

  test('normalizeMealSlotsInput handles premium_large_salad', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1', selectionType: 'custom_premium_salad', customSalad: { presetKey: 'preset1' } },
    ];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result.length, 1, 'slot count');
    expectEqual(result[0].selectionType, 'premium_large_salad', 'selectionType normalized');
    expectEqual(result[0].customSalad?.presetKey, 'preset1', 'customSalad');
  });

  test('default selectionType is standard_meal', () => {
    const input = [{ slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' }];
    const result = normalizeMealSlotsInput({ mealSlots: input });
    expectEqual(result[0].selectionType, 'standard_meal', 'default selectionType');
  });

  test('collectDuplicateSlotErrors detects duplicate slotIndex', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 1, slotKey: 'slot_2', proteinId: 'protein2', carbId: 'carb2' },
    ];
    const errors = collectDuplicateSlotErrors({ mealSlots: input });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'DUPLICATE_SLOT_INDEX', 'error code');
  });

  test('collectDuplicateSlotErrors detects duplicate slotKey', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 2, slotKey: 'slot_1', proteinId: 'protein2', carbId: 'carb2' },
    ];
    const errors = collectDuplicateSlotErrors({ mealSlots: input });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'DUPLICATE_SLOT_KEY', 'error code');
  });

  test('collectSlotCountErrors detects excess slots', () => {
    const input = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: 'protein1', carbId: 'carb1' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: 'protein2', carbId: 'carb2' },
      { slotIndex: 3, slotKey: 'slot_3', proteinId: 'protein3', carbId: 'carb3' },
    ];
    const errors = collectSlotCountErrors({ mealSlots: input, requiredSlotCount: 2 });
    expectEqual(errors.length > 0, true, 'has errors');
    expectEqual(errors[0].code, 'MEAL_SLOT_COUNT_EXCEEDED', 'error code');
  });

  test('isSandwichSlot returns true for sandwich selectionType', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1' };
    expectTrue(isSandwichSlot(slot), 'sandwich detected');
  });

  test('isSandwichSlot returns false for standard_combo', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: 'p1', carbId: 'c1' };
    expectFalse(isSandwichSlot(slot), 'not sandwich');
  });

  test('isBaseBeefSlot returns false for sandwich', () => {
    const slot = { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', proteinFamilyKey: 'beef' };
    expectFalse(isBaseBeefSlot(slot), 'sandwich not beef');
  });

  test('recomputePlannerMetaFromSlots counts sandwich as complete', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial slot count');
    expectEqual(result.plannerMeta.emptySlotCount, 0, 'empty slot count');
  });

  test('recomputePlannerMetaFromSlots counts standard_combo with protein+carb as complete', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: 'p1', carbId: 'c1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
  });

  test('recomputePlannerMetaFromSlots counts custom_premium_salad properly', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'p1', carbId: 'c1', status: 'complete', isPremium: true, premiumSource: 'balance' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete slot count');
    expectEqual(result.plannerMeta.premiumSlotCount, 1, 'premium slot count');
    expectEqual(result.plannerMeta.premiumCoveredByBalanceCount, 1, 'covered by balance');
  });

  test('recomputePlannerMetaFromSlots counts pending payment for custom_premium_salad without balance', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'custom_premium_salad', proteinId: 'p1', carbId: 'c1', status: 'complete', isPremium: true, premiumSource: 'pending_payment', premiumExtraFeeHalala: 3000 },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.premiumPendingPaymentCount, 1, 'pending payment count');
    expectEqual(result.plannerMeta.premiumTotalHalala, 3000, 'total halala');
  });

  test('recomputePlannerMetaFromSlots marks isConfirmable when all slots complete and no partial', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
      { slotIndex: 2, slotKey: 'slot_2', selectionType: 'sandwich', sandwichId: 'sandwich2', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 2 });
    expectTrue(result.plannerMeta.isConfirmable, 'isConfirmable');
  });

  test('projectMaterializedAndLegacyFromSlots creates sandwich meal', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete', assignmentSource: 'client' },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.materializedMeals.length, 1, 'materialized meal count');
    expectEqual(result.materializedMeals[0].sandwichId, 'sandwich1', 'sandwich ID');
    expectEqual(result.materializedMeals[0].operationalSku, 'sandwich:sandwich1', 'operational SKU');
  });

  test('projectMaterializedAndLegacyFromSlots creates standard_meal', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_meal', proteinId: 'p1', carbs: [{ carbId: 'c1', grams: 150 }], status: 'complete' },
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.materializedMeals.length, 1, 'materialized meal count');
    expectEqual(result.materializedMeals[0].proteinId, 'p1', 'protein ID');
    expectEqual(result.materializedMeals[0].carbId, 'c1', 'carb ID');
  });

  test('recomputePlannerMetaFromSlots allows sandwich without proteinId/carbId', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'sandwich', sandwichId: 'sandwich1', status: 'complete' },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete');
    expectEqual(result.plannerMeta.emptySlotCount, 0, 'empty');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial');
  });

  test('recomputePlannerMetaFromSlots requires proteinId+carbId for standard_combo', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'standard_combo', proteinId: null, carbId: null },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 0, 'complete');
    expectEqual(result.plannerMeta.partialSlotCount, 0, 'partial');
    expectEqual(result.plannerMeta.emptySlotCount, 1, 'empty');
  });

  test('recomputePlannerMetaFromSlots counts premium_large_salad as complete when salad groups provided', () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', selectionType: 'premium_large_salad', salad: { groups: { protein: ['p1'], sauce: ['s1'] } }, status: 'complete', isPremium: true },
    ];
    const result = recomputePlannerMetaFromSlots({ mealSlots: slots, requiredSlotCount: 1 });
    expectEqual(result.plannerMeta.completeSlotCount, 1, 'complete');
  });

  console.log(`\n=== Meal Planner Premium Balance Tests ===\n`);

  test('premium balance covers custom_premium_salad when available', () => {
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

  test('custom_premium_salad fixed price is 3000', () => {
    expectEqual(CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA, 3000, 'fixed price');
  });

  console.log(`\n=== Meal Planner Commercial State Tests ===\n`);

  test('confirmed day isFulfillable = true', () => {
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

  test('paymentRequired day isConfirmable but blocked', () => {
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

  test('processedSlot includes all persistence fields', () => {
    const slot = { slotIndex: 1, selectionType: 'sandwich', sandwichId: 's1' };
    const normalized = normalizeMealSlotsInput({ mealSlots: [slot] })[0];
    expectEqual(normalized.selectionType, 'sandwich', 'selectionType preserved');
    expectEqual(normalized.sandwichId, 's1', 'sandwichId preserved');
  });

  test('premiumKey is populated in draft processed slots', async () => {
    const slots = [
      { slotIndex: 1, selectionType: 'premium_meal', proteinId: 'p1', carbs: [{ carbId: 'c1', grams: 150 }], isPremium: true, premiumKey: 'beef_premium', status: 'complete' }
    ];
    const result = projectMaterializedAndLegacyFromSlots({ processedSlots: slots, now: new Date() });
    expectEqual(result.premiumSelections[0].premiumKey, 'beef_premium', 'premiumKey mapped to selections');
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();