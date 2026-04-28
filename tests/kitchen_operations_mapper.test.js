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
        userId: { _id: 'user1', name: 'Test User', phone: '123' },
        deliveryMode: 'delivery',
        deliveryWindow: '10:00 - 12:00',
      },
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
