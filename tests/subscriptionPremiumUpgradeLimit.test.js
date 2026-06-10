const assert = require("assert");

const {
  assertPremiumUpgradeLimit,
  countPremiumUpgradeSelections,
  resolveTotalSubscriptionMealsFromQuote,
} = require("../src/services/subscription/premiumUpgradeLimitService");
const {
  buildCanonicalSubscriptionCheckoutBreakdown,
} = require("../src/services/subscription/subscriptionCheckoutService");

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

function assertLimitPass(totalSubscriptionMeals, premiumUpgradeCount, expectedRemaining) {
  const result = assertPremiumUpgradeLimit({ totalSubscriptionMeals, premiumUpgradeCount });
  assert.strictEqual(result.maxPremiumUpgrades, totalSubscriptionMeals);
  assert.strictEqual(result.selectedPremiumUpgrades, premiumUpgradeCount);
  assert.strictEqual(result.remainingPremiumUpgrades, expectedRemaining);
}

function assertLimitReject(totalSubscriptionMeals, premiumUpgradeCount) {
  assert.throws(
    () => assertPremiumUpgradeLimit({ totalSubscriptionMeals, premiumUpgradeCount }),
    (err) => {
      assert.strictEqual(err.code, "PREMIUM_UPGRADE_LIMIT_EXCEEDED");
      assert.strictEqual(err.status, 422);
      assert.strictEqual(err.message, "Premium meal upgrades cannot exceed total subscription meals.");
      assert.deepStrictEqual(err.details, {
        premiumUpgradeCount,
        totalSubscriptionMeals,
        maxPremiumUpgrades: totalSubscriptionMeals,
      });
      return true;
    }
  );
}

(async () => {
  await test("Case A: 10 total meals, 0 premium upgrades passes", () => {
    assertLimitPass(10, 0, 10);
  });

  await test("Case B: 10 total meals, 10 premium upgrades passes", () => {
    assertLimitPass(10, 10, 0);
  });

  await test("Case C: 10 total meals, 11 premium upgrades rejects", () => {
    assertLimitReject(10, 11);
  });

  await test("Case D: 30 total meals, 30 premium upgrades passes", () => {
    assertLimitPass(30, 30, 0);
  });

  await test("Case E: 30 total meals, 31 premium upgrades rejects", () => {
    assertLimitReject(30, 31);
  });

  await test("Case F: 14 meals and 4 upgrades prices only the 4 upgrade differences", () => {
    const quote = {
      breakdown: {
        basePlanPriceHalala: 14000,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        discountHalala: 0,
      },
    };
    const normalizedPremiumItems = [
      { premiumKey: "shrimp", qty: 4, unitExtraFeeHalala: 1500, currency: "SAR" },
    ];
    const result = buildCanonicalSubscriptionCheckoutBreakdown(quote, normalizedPremiumItems);

    assertLimitPass(14, 4, 10);
    assert.strictEqual(result.breakdown.basePlanPriceHalala, 14000);
    assert.strictEqual(result.breakdown.premiumTotalHalala, 6000);
    assert.strictEqual(result.breakdown.grossTotalHalala, 20000);
    assert.strictEqual(result.breakdown.totalHalala, 20000);
  });

  await test("Case G: premium_large_salad counts toward the premium upgrade limit", () => {
    const count = countPremiumUpgradeSelections([
      { selectionType: "premium_large_salad" },
      { selectionType: "standard_meal" },
    ]);
    assert.strictEqual(count, 1);
    assertLimitPass(1, count, 0);
  });

  await test("Case H: premium_meal and premium_large_salad count together", () => {
    const selections = [
      ...Array.from({ length: 7 }, () => ({ selectionType: "premium_meal" })),
      ...Array.from({ length: 4 }, () => ({ selectionType: "premium_large_salad" })),
    ];
    const premiumUpgradeCount = countPremiumUpgradeSelections(selections);
    assert.strictEqual(premiumUpgradeCount, 11);
    assertLimitReject(10, premiumUpgradeCount);
  });

  await test("Case I: fake client totalSubscriptionMeals is ignored in favor of quote entitlement", () => {
    const clientPayload = { totalSubscriptionMeals: 100 };
    const quote = {
      plan: { daysCount: 5 },
      mealsPerDay: 2,
    };
    const backendTotal = resolveTotalSubscriptionMealsFromQuote(quote);

    assert.strictEqual(clientPayload.totalSubscriptionMeals, 100);
    assert.strictEqual(backendTotal, 10);
    assertLimitReject(backendTotal, 11);
  });
})();
