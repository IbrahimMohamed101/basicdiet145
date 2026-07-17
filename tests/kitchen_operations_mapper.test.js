const assert = require('assert');

const BuilderProtein = require('../src/models/BuilderProtein');
const BuilderCarb = require('../src/models/BuilderCarb');
const Meal = require('../src/models/Meal');
const {
  fetchMealNameMap,
  collectSubscriptionDayMealIds,
} = require('../src/services/kitchenOperations/KitchenOperationsDataService');
const {
  mapSubscriptionDayToRow,
  sanitizeRow,
} = require('../src/services/kitchenOperations/KitchenOperationsMapper');

function mockQuery(result) {
  return {
    select() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

async function run() {
  const originalProteinFind = BuilderProtein.find;
  const originalCarbFind = BuilderCarb.find;
  const originalMealFind = Meal.find;

  BuilderProtein.find = () => mockQuery([{ _id: 'protein1', name: { en: 'Chicken', ar: 'دجاج' } }]);
  BuilderCarb.find = () => mockQuery([{ _id: 'carb1', name: { en: 'Rice', ar: 'أرز' } }]);
  Meal.find = () => mockQuery([{ _id: 'meal1', name: { en: 'Club Sandwich', ar: 'ساندويتش كلوب' } }]);

  try {
    const mealKeys = ['protein1:carb1', 'sandwich:meal1', 'salad:custom_premium_salad'];
    const mealNameById = await fetchMealNameMap(mealKeys);

    assert.strictEqual(mealNameById.get('protein1:carb1'), 'دجاج / أرز');
    assert.strictEqual(mealNameById.get('sandwich:meal1'), 'ساندويتش كلوب');
    assert.strictEqual(mealNameById.get('salad:custom_premium_salad'), 'Premium Large Salad');

    const day = {
      _id: 'day1',
      date: '2026-05-01',
      status: 'open',
      subscriptionId: {
        _id: 'sub1',
        planId: { _id: 'plan1', key: 'plan_28', name: { en: '28 Day Plan', ar: 'خطة ٢٨ يوم' }, daysCount: 28, durationDays: 28 },
        userId: { _id: 'user1', name: 'Test User', phone: '123' },
        selectedGrams: 200,
        selectedMealsPerDay: 1,
        totalMeals: 28,
        remainingMeals: 20,
        deliveryMode: 'delivery',
        deliveryWindow: '10:00 - 12:00',
      },
      deliveryRecord: { _id: 'delivery1', date: '2026-05-01', status: 'scheduled' },
      mealSlots: [{
        slotIndex: 1,
        slotKey: 'slot_1',
        status: 'complete',
        selectionType: 'premium_meal',
        proteinId: 'protein1',
        carbs: [{ carbId: 'carb1', grams: 150 }],
        confirmationSnapshot: {
          product: { id: 'product1', key: 'basic_meal', name: { en: 'Basic Meal', ar: 'وجبة' } },
          protein: { name: { en: 'Chicken', ar: 'دجاج' } },
        },
        isPremium: true,
        premiumKey: 'premium_chicken',
        premiumSource: 'paid',
      }],
      addonSelections: [{ addonId: 'addon1', name: { en: 'Soup', ar: 'شوربة' }, qty: 1, priceHalala: 500 }],
      materializedMeals: [
        { selectionType: 'standard_meal', operationalSku: 'protein1:carb1' },
        { selectionType: 'sandwich', sandwichId: 'meal1', operationalSku: 'sandwich:meal1' },
        { selectionType: 'premium_large_salad', operationalSku: 'salad:custom_premium_salad' },
      ],
      createdAt: new Date('2026-05-01T09:00:00.000Z'),
    };

    const collectedKeys = collectSubscriptionDayMealIds([day]);
    assert.deepStrictEqual(collectedKeys, ['protein1:carb1', 'sandwich:meal1', 'salad:custom_premium_salad']);

    const row = mapSubscriptionDayToRow(day, { mealNameById, addonNameById: new Map() });
    assert.strictEqual(row.items[0].name, 'دجاج / أرز');
    assert.strictEqual(row.items[1].name, 'ساندويتش كلوب');
    assert.strictEqual(row.items[2].name, 'Premium Large Salad');
    assert.strictEqual(row.plan.proteinGrams, 200);
    assert.strictEqual(row.plan.portionSize, '200g');
    assert.strictEqual(row.kitchenDetails.mealSlots[0].proteinGrams, 200);
    assert.strictEqual(row.kitchenDetails.mealSlots[0].isPremium, true);
    assert.strictEqual(row.kitchenDetails.mealSlots[0].premiumKey, 'premium_chicken');
    assert.strictEqual(row.kitchenDetails.addons[0].id, 'addon1');
    assert.strictEqual(row.delivery.deliveryId, 'delivery1');
    assert(row.paymentValidity, 'payment validity is exposed');

    const sanitized = sanitizeRow(row);
    assert.strictEqual(sanitized.kitchen.version, 'v2');
    assert.strictEqual(sanitized.kitchen.cards.length, 1);
    assert.strictEqual(sanitized.kitchenDetails, undefined);
    assert.strictEqual(sanitized.kitchenCards, undefined);
    assert.strictEqual(sanitized.fulfillment.mode, 'delivery');

    const legacySanitized = sanitizeRow(row, { includeLegacy: true });
    assert.strictEqual(legacySanitized.kitchenDetails.mealSlots.length, 1);
    assert.strictEqual(legacySanitized.kitchenProjectionVersion, 'v1');

    console.log('✅ kitchen operations mapper uses operationalSku-based meal identities');
  } finally {
    BuilderProtein.find = originalProteinFind;
    BuilderCarb.find = originalCarbFind;
    Meal.find = originalMealFind;
  }
}

run().catch((err) => {
  console.error(`❌ kitchen operations mapper test failed: ${err.message}`);
  process.exit(1);
});
