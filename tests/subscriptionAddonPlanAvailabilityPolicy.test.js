"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  createAddonPlanAvailabilityQuoteResolver,
  isNewSaleProductUsable,
  preparePlanOnlyAddonSelections,
} = require("../src/services/installSubscriptionAddonPlanAvailabilityPolicy");

const PLAN_WITH_LIVE_PRODUCT = "64b000000000000000000001";
const PLAN_WITHOUT_LIVE_PRODUCT = "64b000000000000000000002";
const LIVE_PRODUCT = "64b000000000000000000011";
const HIDDEN_PRODUCT = "64b000000000000000000012";
const DELETED_PRODUCT = "64b000000000000000000013";
const BASE_PLAN = "64b000000000000000000021";

function addonPlan(id, productIds) {
  return {
    _id: id,
    kind: "plan",
    isActive: true,
    isArchived: false,
    billingMode: "per_day",
    pricingMode: "base_plan_matrix",
    currency: "SAR",
    category: id === PLAN_WITH_LIVE_PRODUCT ? "juice" : "snack",
    displayKey: id === PLAN_WITH_LIVE_PRODUCT ? "juice" : "snack",
    name: { ar: "إضافة", en: "Addon" },
    menuProductIds: productIds,
    menuCategoryKeys: [],
    maxPerDay: 1,
  };
}

const plans = [
  addonPlan(PLAN_WITH_LIVE_PRODUCT, [LIVE_PRODUCT, HIDDEN_PRODUCT, DELETED_PRODUCT]),
  addonPlan(PLAN_WITHOUT_LIVE_PRODUCT, [HIDDEN_PRODUCT, DELETED_PRODUCT]),
];
const products = [
  {
    _id: LIVE_PRODUCT,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date("2026-07-24T00:00:00.000Z"),
    itemType: "product",
  },
  {
    _id: HIDDEN_PRODUCT,
    isActive: true,
    isVisible: false,
    isAvailable: true,
    publishedAt: new Date("2026-07-24T00:00:00.000Z"),
    itemType: "product",
  },
];

function runtime(overrides = {}) {
  return {
    async loadAddonPlans(ids) {
      return plans.filter((plan) => ids.includes(String(plan._id)));
    },
    async loadMenuProducts(ids) {
      return products.filter((product) => ids.includes(String(product._id)));
    },
    async loadAddonPlanPrices(ids, basePlanId) {
      assert.strictEqual(String(basePlanId), BASE_PLAN);
      return ids.map((id) => ({
        addonPlanId: id,
        basePlanId,
        priceHalala: id === PLAN_WITHOUT_LIVE_PRODUCT ? 500 : 700,
        currency: "SAR",
        isActive: true,
      }));
    },
    async applyPromoCode({ promoCode, quote }) {
      assert.strictEqual(promoCode, "SAVE10");
      return { quote: { ...quote, promoApplied: true } };
    },
    ...overrides,
  };
}

(async function run() {
  assert.strictEqual(isNewSaleProductUsable(products[0]), true);
  assert.strictEqual(isNewSaleProductUsable(products[1]), false);
  assert.strictEqual(isNewSaleProductUsable(null), false);

  const payload = {
    planId: BASE_PLAN,
    promoCode: "SAVE10",
    addons: [
      { addonPlanId: PLAN_WITH_LIVE_PRODUCT, quantityPerDay: 1 },
      { addonPlanId: PLAN_WITHOUT_LIVE_PRODUCT, quantityPerDay: 2 },
    ],
  };
  const prepared = await preparePlanOnlyAddonSelections(payload, runtime());
  assert.strictEqual(prepared.payload.addons.length, 1);
  assert.deepStrictEqual(
    prepared.payload.addons[0].menuProductIds,
    [LIVE_PRODUCT],
    "stale, hidden, and deleted products must be filtered from plan-only checkout"
  );
  assert.strictEqual(prepared.deferredSelections.length, 1);
  assert.strictEqual(
    prepared.deferredSelections[0].addonPlanId,
    PLAN_WITHOUT_LIVE_PRODUCT
  );
  assert.strictEqual(prepared.deferredSelections[0].quantityPerDay, 2);

  let capturedPayload = null;
  const resolver = createAddonPlanAvailabilityQuoteResolver({
    original: async (normalizedPayload) => {
      capturedPayload = normalizedPayload;
      return {
        plan: { _id: BASE_PLAN, daysCount: 7 },
        mealsPerDay: 3,
        addonItems: [
          {
            addon: plans[0],
            addonPlanId: PLAN_WITH_LIVE_PRODUCT,
            quantityPerDay: 1,
            qty: 1,
            includedTotalQty: 7,
            unitPlanPriceHalala: 700,
            unitPriceHalala: 700,
            totalHalala: 700,
            currency: "SAR",
            menuProductIds: [LIVE_PRODUCT],
          },
        ],
        addonSubscriptions: [],
        breakdown: {
          basePlanPriceHalala: 10000,
          basePlanGrossHalala: 10000,
          basePlanNetHalala: 8696,
          premiumTotalHalala: 0,
          addonsTotalHalala: 700,
          deliveryFeeHalala: 0,
          grossTotalHalala: 10700,
          subtotalHalala: 9304,
          subtotalBeforeVatHalala: 9304,
          vatPercentage: 15,
          vatHalala: 1396,
          totalHalala: 10700,
          currency: "SAR",
        },
      };
    },
    runtime: runtime(),
  });

  const quote = await resolver(payload, { lang: "ar", userId: "user-1" });
  assert.strictEqual(capturedPayload.promoCode, undefined);
  assert.deepStrictEqual(capturedPayload.addons[0].menuProductIds, [LIVE_PRODUCT]);
  assert.strictEqual(quote.addonItems.length, 2);
  assert.strictEqual(quote.addonSubscriptions.length, 1);
  assert.deepStrictEqual(quote.addonSubscriptions[0].menuProductIds, []);
  assert.strictEqual(quote.addonItems[1].quantityPerDay, 2);
  assert.strictEqual(quote.addonItems[1].includedTotalQty, 14);
  assert.strictEqual(quote.addonItems[1].totalHalala, 1000);
  assert.strictEqual(quote.breakdown.addonsTotalHalala, 1700);
  assert.strictEqual(quote.breakdown.totalHalala, 11700);
  assert.strictEqual(quote.promoApplied, true);
  assert.strictEqual(quote.addonBalance.length, 2);

  const explicitSelection = await preparePlanOnlyAddonSelections(
    {
      addons: [{
        addonPlanId: PLAN_WITH_LIVE_PRODUCT,
        productId: HIDDEN_PRODUCT,
        quantityPerDay: 1,
      }],
    },
    runtime()
  );
  assert.strictEqual(explicitSelection.changed, false);
  assert.strictEqual(
    explicitSelection.payload.addons[0].productId,
    HIDDEN_PRODUCT,
    "explicit product selections must remain strict and must not be silently changed"
  );

  const projectRoot = path.join(__dirname, "..");
  execFileSync(
    process.execPath,
    [
      "-e",
      [
        'require("./src/routes/index")',
        'const controller = require("./src/controllers/subscriptionController")',
        'if (!controller.resolveCheckoutQuoteOrThrow.__subscriptionAddonPlanAvailabilityPolicy) {',
        '  throw new Error("subscriptionController captured the pre-policy quote function")',
        '}',
        'if (!controller.resolveCheckoutQuoteOrThrow.__dashboardDeliverySlotCompatible) {',
        '  throw new Error("add-on policy did not preserve delivery-slot composition metadata")',
        '}',
      ].join(";"),
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        JWT_SECRET: process.env.JWT_SECRET || "addon-plan-policy-test-secret",
        DASHBOARD_JWT_SECRET:
          process.env.DASHBOARD_JWT_SECRET || "addon-plan-policy-dashboard-secret",
      },
      stdio: "pipe",
    }
  );

  console.log("subscriptionAddonPlanAvailabilityPolicy.test.js passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
