"use strict";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  buildPremiumAllocation,
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPolicy");
const {
  buildDeductionAtomicMutation,
} = require("../src/services/dashboard/manualDeduction/manualDeductionRepository");

const ADDON_ID = new mongoose.Types.ObjectId();

function subscriptionFixture() {
  return {
    totalMeals: 14,
    remainingMeals: 14,
    premiumBalance: [
      {
        _id: new mongoose.Types.ObjectId(),
        premiumKey: "shrimp",
        purchasedQty: 2,
        remainingQty: 2,
        consumedQty: 0,
        purchasedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        premiumKey: "beef_steak",
        purchasedQty: 2,
        remainingQty: 2,
        consumedQty: 0,
        purchasedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
    addonSubscriptions: [
      { addonId: ADDON_ID, name: "Daily juice", category: "juice" },
    ],
    addonBalance: [
      {
        addonId: ADDON_ID,
        addonPlanId: ADDON_ID,
        purchasedQty: 7,
        includedTotalQty: 7,
        remainingQty: 7,
        consumedQty: 0,
      },
    ],
  };
}

function consume(subscription, payload) {
  const counts = validateCounts(payload);
  validateBalances(subscription, counts);

  subscription.remainingMeals -= counts.total;

  for (const allocation of buildPremiumAllocation(subscription, counts.premiumMeals)) {
    const row = subscription.premiumBalance.find(
      (candidate) => String(candidate._id) === String(allocation.rowId)
    );
    row.remainingQty -= allocation.qty;
    row.consumedQty += allocation.qty;
  }

  for (const addon of counts.addons) {
    const row = subscription.addonBalance.find(
      (candidate) => String(candidate.addonId) === String(addon.addonId)
    );
    row.remainingQty -= addon.qty;
    row.consumedQty += addon.qty;
  }

  return {
    meals: resolveBalances(subscription),
    addons: resolveAddonBalances(subscription),
  };
}

function assertBalances(subscription, expected) {
  const meals = resolveBalances(subscription);
  const addons = resolveAddonBalances(subscription);
  assert.deepStrictEqual(
    {
      total: meals.remainingMeals,
      regular: meals.remainingRegularMeals,
      premium: meals.remainingPremiumMeals,
      addon: addons[0].remainingQty,
      addonConsumed: addons[0].consumedQty,
    },
    expected
  );
  assert.strictEqual(meals.remainingMeals, meals.remainingRegularMeals + meals.remainingPremiumMeals);
  assert.strictEqual(addons[0].purchasedQty, addons[0].remainingQty + addons[0].consumedQty);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code, code);
}

function deterministicShuffle(rows, seed) {
  const copy = [...rows];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function run() {
  const initial = subscriptionFixture();
  assertBalances(initial, { total: 14, regular: 10, premium: 4, addon: 7, addonConsumed: 0 });

  const premiumFirst = subscriptionFixture();
  consume(premiumFirst, { regularMeals: 0, premiumMeals: 4 });
  assertBalances(premiumFirst, { total: 10, regular: 10, premium: 0, addon: 7, addonConsumed: 0 });
  consume(premiumFirst, { regularMeals: 10, premiumMeals: 0 });
  assertBalances(premiumFirst, { total: 0, regular: 0, premium: 0, addon: 7, addonConsumed: 0 });
  consume(premiumFirst, { regularMeals: 0, premiumMeals: 0, addons: [{ addonId: ADDON_ID, qty: 7 }] });
  assertBalances(premiumFirst, { total: 0, regular: 0, premium: 0, addon: 0, addonConsumed: 7 });

  const spreadAcrossWeek = subscriptionFixture();
  for (let day = 1; day <= 7; day += 1) {
    consume(spreadAcrossWeek, {
      regularMeals: day <= 5 ? 2 : 0,
      premiumMeals: day > 5 ? 2 : 0,
      addons: [{ addonId: ADDON_ID, qty: 1 }],
    });
  }
  assertBalances(spreadAcrossWeek, { total: 0, regular: 0, premium: 0, addon: 0, addonConsumed: 7 });

  const duplicateAddonRows = validateCounts({
    regularMeals: 0,
    premiumMeals: 0,
    addons: [
      { addonId: ADDON_ID, qty: 2 },
      { addonId: ADDON_ID, qty: 3 },
    ],
  });
  assert.deepStrictEqual(duplicateAddonRows.addons, [{ addonId: String(ADDON_ID), qty: 5 }]);

  const insufficient = subscriptionFixture();
  expectCode(
    () => validateBalances(insufficient, validateCounts({ regularMeals: 11, premiumMeals: 0 })),
    "INSUFFICIENT_REGULAR_MEALS"
  );
  expectCode(
    () => validateBalances(insufficient, validateCounts({ regularMeals: 0, premiumMeals: 5 })),
    "INSUFFICIENT_PREMIUM_MEALS"
  );
  expectCode(
    () => validateBalances(insufficient, validateCounts({ regularMeals: 0, premiumMeals: 0, addons: [{ addonId: ADDON_ID, qty: 8 }] })),
    "INSUFFICIENT_ADDON_BALANCE"
  );
  expectCode(
    () => validateCounts({ regularMeals: Number.MAX_SAFE_INTEGER + 1, premiumMeals: 0 }),
    "INVALID_MEAL_COUNT"
  );
  expectCode(
    () => validateCounts({ regularMeals: 1, premiumMeals: 0, addons: { addonId: ADDON_ID, qty: 1 } }),
    "INVALID_ADDON_COUNT"
  );
  expectCode(
    () => validateSubscriptionCanDeduct({
      status: "active",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      validityEndDate: new Date("2026-08-07T00:00:00.000Z"),
    }, "2026-07-22"),
    "SUBSCRIPTION_OUTSIDE_VALIDITY"
  );
  expectCode(
    () => validateCounts({
      regularMeals: 1,
      premiumMeals: 0,
      addons: Array.from({ length: 51 }, (_, index) => ({ addonId: new mongoose.Types.ObjectId(), qty: index + 1 })),
    }),
    "INVALID_ADDON_COUNT"
  );

  const operations = [
    ...Array.from({ length: 10 }, () => ({ regularMeals: 1, premiumMeals: 0 })),
    ...Array.from({ length: 4 }, () => ({ regularMeals: 0, premiumMeals: 1 })),
    ...Array.from({ length: 7 }, () => ({ regularMeals: 0, premiumMeals: 0, addons: [{ addonId: ADDON_ID, qty: 1 }] })),
  ];
  for (let seed = 1; seed <= 50; seed += 1) {
    const randomized = subscriptionFixture();
    for (const operation of deterministicShuffle(operations, seed)) consume(randomized, operation);
    assertBalances(randomized, { total: 0, regular: 0, premium: 0, addon: 0, addonConsumed: 7 });
  }

  const ledgerSubscription = {
    ...subscriptionFixture(),
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
  };
  const ledgerCounts = validateCounts({
    regularMeals: 1,
    premiumMeals: 2,
    addons: [{ addonId: ADDON_ID, qty: 2 }],
  });
  const ledgerMutation = buildDeductionAtomicMutation({
    subscription: ledgerSubscription,
    counts: ledgerCounts,
  });
  assert.strictEqual(ledgerMutation.filter.entitlementVersion, 2);
  assert.strictEqual(ledgerMutation.update.$inc.remainingMeals, -3);
  assert.strictEqual(ledgerMutation.update.$inc.consumedMeals, 3);
  assert.strictEqual(
    ledgerMutation.update.$inc["addonBalance.$[a0].remainingQty"],
    -2
  );
  assert.strictEqual(
    Object.entries(ledgerMutation.update.$inc)
      .filter(([key, value]) => key.includes("premiumBalance") && value < 0)
      .reduce((sum, [, value]) => sum + Math.abs(value), 0),
    2
  );

  const legacyMutation = buildDeductionAtomicMutation({
    subscription: subscriptionFixture(),
    counts: validateCounts({ regularMeals: 1, premiumMeals: 0 }),
  });
  assert.strictEqual(legacyMutation.update.$inc.consumedMeals, undefined);
  assert(legacyMutation.filter.$and.some((clause) => Array.isArray(clause.$or)));

  console.log("✅ manual deduction balance policy matrix passed (50 mixed orderings)");
}

run();
