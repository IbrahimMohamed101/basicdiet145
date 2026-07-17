"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  enrichDashboardSubscriptionPayload,
} = require("../src/controllers/dashboard/subscriptionCreationController");

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function sectionByKey(sections, key) {
  return (sections || []).find((section) => section && section.key === key);
}

(async function run() {
  await test("dashboard subscription routes expose quote and create endpoints", async () => {
    const source = read("src/routes/dashboardSubscriptions.js");
    assert.ok(source.includes('require("../controllers/dashboard/subscriptionCreationController")'));
    assert.ok(source.includes('router.post(\n  "/quote"'));
    assert.ok(source.includes('subscriptionCreationController.quoteSubscriptionAdmin'));
    assert.ok(source.includes('router.post(\n  "/"'));
    assert.ok(source.includes('subscriptionCreationController.createSubscriptionAdmin'));
  });

  await test("quote response exposes base subscription price, premium items, add-ons, and checkout summary", async () => {
    const payload = enrichDashboardSubscriptionPayload({
      status: true,
      data: {
        plan: {
          id: "plan_1",
          name: "Monthly Plan",
          daysCount: 28,
          currency: "SAR",
        },
        selectedOptions: {
          grams: 150,
          mealsPerDay: 2,
          startDate: "2026-07-20",
        },
        breakdown: {
          basePlanPriceHalala: 10000,
          premiumTotalHalala: 2500,
          addonsTotalHalala: 7000,
          deliveryFeeHalala: 0,
          discountHalala: 500,
          grossTotalHalala: 19500,
          vatPercentage: 15,
          vatHalala: 2478,
          totalHalala: 19000,
          currency: "SAR",
        },
        premiumItems: [{
          premiumKey: "shrimp",
          name: "Shrimp",
          qty: 1,
          unitExtraFeeHalala: 2500,
          totalHalala: 2500,
          currency: "SAR",
        }],
        addonPlans: [{
          addonPlanId: "addon_1",
          name: "Juice Subscription",
          qty: 1,
          unitPriceHalala: 1000,
          totalHalala: 7000,
          currency: "SAR",
        }],
      },
    }, { lang: "en" });

    const data = payload.data;
    assert.strictEqual(data.subscriptionPrice.amountHalala, 10000);
    assert.strictEqual(data.subscriptionPriceHalala, 10000);
    assert.strictEqual(data.plan.priceHalala, 10000);
    assert.strictEqual(data.plan.subscriptionPriceHalala, 10000);
    assert.strictEqual(data.pricing.subscriptionPriceHalala, 10000);
    assert.strictEqual(data.pricing.premiumTotalHalala, 2500);
    assert.strictEqual(data.pricing.addonsTotalHalala, 7000);
    assert.strictEqual(data.pricing.totalHalala, 19000);
    assert.strictEqual(data.pricing.vatPercentage, 15);
    assert.ok(data.lineItems.some((item) => item.kind === "plan" && item.amountHalala === 10000));
    assert.ok(data.lineItems.some((item) => item.kind === "premium" && item.amountHalala === 2500));
    assert.ok(data.lineItems.some((item) => item.kind === "addons" && item.amountHalala === 7000));
    assert.ok(data.lineItems.some((item) => item.kind === "total" && item.amountHalala === 19000));
    assert.strictEqual(data.premiumItems[0].ui.selectionStyle, "stepper");
    assert.strictEqual(data.premiumItems[0].priceHalala, 2500);
    assert.strictEqual(data.addonPlans[0].ui.selectionStyle, "stepper");
    assert.strictEqual(data.addonPlans[0].pricingModel, "daily_recurring");
    assert.strictEqual(data.addons[0].totalHalala, 7000);
    assert.strictEqual(data.checkoutSummary.subscriptionPrice.amountHalala, 10000);

    assert.ok(Array.isArray(data.selectionSections), "selectionSections array exists");
    assert.strictEqual(data.selectionSections.length, 3, "three dashboard sections returned");
    assert.deepStrictEqual(
      data.selectionSections.map((section) => section.key),
      ["subscription_meals", "premium_meals", "addon_subscriptions"]
    );

    const subscriptionMeals = sectionByKey(data.selectionSections, "subscription_meals");
    const premiumMeals = sectionByKey(data.selectionSections, "premium_meals");
    const addonSubscriptions = sectionByKey(data.selectionSections, "addon_subscriptions");

    assert.strictEqual(subscriptionMeals.totalHalala, 10000);
    assert.strictEqual(subscriptionMeals.items[0].selectedOptions.grams, 150);
    assert.strictEqual(subscriptionMeals.items[0].selectedOptions.mealsPerDay, 2);
    assert.strictEqual(premiumMeals.totalHalala, 2500);
    assert.strictEqual(premiumMeals.totalQuantity, 1);
    assert.strictEqual(addonSubscriptions.totalHalala, 7000);
    assert.strictEqual(addonSubscriptions.totalQuantity, 1);
    assert.strictEqual(data.selectionGroups.subscriptionMeals.key, "subscription_meals");
    assert.strictEqual(data.selectionGroups.premiumMeals.key, "premium_meals");
    assert.strictEqual(data.selectionGroups.addonSubscriptions.key, "addon_subscriptions");
    assert.deepStrictEqual(data.checkoutSummary.selectionSections.map((section) => section.key), data.selectionSections.map((section) => section.key));
  });

  await test("create response also exposes subscription price and separated dashboard sections from persisted subscription pricing", async () => {
    const payload = enrichDashboardSubscriptionPayload({
      status: true,
      data: {
        id: "sub_1",
        plan: {
          id: "plan_1",
          name: "Monthly Plan",
          daysCount: 28,
        },
        basePlanPriceHalala: 12000,
        basePlanGrossHalala: 12000,
        premiumItems: [{ premiumKey: "salmon", qty: 2, unitExtraFeeHalala: 2000, totalHalala: 4000 }],
        addonPlans: [{ addonPlanId: "addon_2", qty: 1, unitPriceHalala: 500, totalHalala: 14000 }],
        pricingSummary: {
          basePlanPriceHalala: 12000,
          totalPriceHalala: 30000,
          vatPercentage: 15,
          vatHalala: 3913,
          currency: "SAR",
        },
      },
    }, { lang: "en" });

    const data = payload.data;
    assert.strictEqual(data.subscriptionPrice.amountHalala, 12000);
    assert.strictEqual(data.subscriptionPriceHalala, 12000);
    assert.strictEqual(data.pricing.subscriptionPriceHalala, 12000);
    assert.strictEqual(data.pricing.totalHalala, 30000);
    assert.ok(data.lineItems.some((item) => item.kind === "plan" && item.amountHalala === 12000));
    assert.strictEqual(data.selectionGroups.subscriptionMeals.totalHalala, 12000);
    assert.strictEqual(data.selectionGroups.premiumMeals.totalQuantity, 2);
    assert.strictEqual(data.selectionGroups.addonSubscriptions.totalHalala, 14000);
  });

  if (results.failed > 0) process.exitCode = 1;
  console.log(`\nDashboard subscription creation contract: ${results.passed} passed, ${results.failed} failed`);
})();
