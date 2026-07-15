const assert = require("assert");

const {
  buildAddonEntitlementEligibility,
  findAddonBalanceBucket,
  isAddonChoiceEligibleForAllowance,
  isAddonEntitlementEligibleForProduct,
  normalizeSubscriptionAddonCategory,
  resolveAddonCategoryForMenuProduct,
} = require("../src/services/subscription/subscriptionAddonPolicyService");

function objectId(index) {
  return Number(index).toString(16).padStart(24, "0");
}

const MEAL_PLAN_ID = objectId(700);
const SNACK_PLAN_ID = objectId(701);
const JUICE_PLAN_ID = objectId(702);
const MEAL_PRODUCT_ID = objectId(710);
const SNACK_PRODUCT_ID = objectId(711);
const JUICE_PRODUCT_ID = objectId(712);

function subscriptionFixture() {
  return {
    _id: objectId(1),
    userId: objectId(2),
    status: "active",
    addonSubscriptions: [
      {
        addonId: MEAL_PLAN_ID,
        addonPlanId: MEAL_PLAN_ID,
        addonPlanName: "Owned meal plan",
        category: "meal",
        menuProductIds: [MEAL_PRODUCT_ID],
      },
      {
        addonId: SNACK_PLAN_ID,
        addonPlanId: SNACK_PLAN_ID,
        addonPlanName: "Owned snack plan",
        category: "snack",
        menuProductIds: [SNACK_PRODUCT_ID],
      },
      {
        addonId: JUICE_PLAN_ID,
        addonPlanId: JUICE_PLAN_ID,
        addonPlanName: "Owned juice plan",
        category: "juice",
        menuProductIds: [JUICE_PRODUCT_ID],
      },
    ],
    addonBalance: [
      {
        _id: objectId(800),
        addonId: MEAL_PLAN_ID,
        addonPlanId: MEAL_PLAN_ID,
        category: "meal",
        includedTotalQty: 3,
        remainingQty: 3,
        consumedQty: 0,
      },
      {
        _id: objectId(801),
        addonId: SNACK_PLAN_ID,
        addonPlanId: SNACK_PLAN_ID,
        category: "snack",
        includedTotalQty: 2,
        remainingQty: 2,
        consumedQty: 0,
      },
      {
        _id: objectId(802),
        addonId: JUICE_PLAN_ID,
        addonPlanId: JUICE_PLAN_ID,
        category: "juice",
        includedTotalQty: 4,
        remainingQty: 4,
        consumedQty: 0,
      },
    ],
  };
}

function run() {
  const subscription = subscriptionFixture();

  assert.strictEqual(normalizeSubscriptionAddonCategory("meal"), "meal");
  assert.strictEqual(resolveAddonCategoryForMenuProduct({ itemType: "meal" }, "desserts"), "meal");
  assert.strictEqual(resolveAddonCategoryForMenuProduct({ itemType: "snack" }, "snacks"), "snack");
  assert.strictEqual(resolveAddonCategoryForMenuProduct({}, "desserts"), "dessert");

  const eligibility = buildAddonEntitlementEligibility(subscription);
  assert.strictEqual(isAddonChoiceEligibleForAllowance(eligibility, "meal", MEAL_PRODUCT_ID), true);
  assert.strictEqual(isAddonChoiceEligibleForAllowance(eligibility, "snack", MEAL_PRODUCT_ID), false);
  assert.strictEqual(isAddonChoiceEligibleForAllowance(eligibility, "snack", SNACK_PRODUCT_ID), true);
  assert.strictEqual(isAddonChoiceEligibleForAllowance(eligibility, "juice", JUICE_PRODUCT_ID), true);

  assert.strictEqual(isAddonEntitlementEligibleForProduct(
    subscription.addonSubscriptions[0],
    { productId: MEAL_PRODUCT_ID, category: "meal", addonPlanId: MEAL_PLAN_ID }
  ), true);

  assert.strictEqual(isAddonEntitlementEligibleForProduct(
    subscription.addonSubscriptions[0],
    { productId: MEAL_PRODUCT_ID, category: "snack", addonPlanId: MEAL_PLAN_ID }
  ), false);

  assert.strictEqual(findAddonBalanceBucket(subscription, {
    addonPlanId: MEAL_PLAN_ID,
    addonId: MEAL_PLAN_ID,
    category: "meal",
  }).category, "meal");

  assert.strictEqual(findAddonBalanceBucket(subscription, {
    addonPlanId: MEAL_PLAN_ID,
    addonId: MEAL_PLAN_ID,
    category: "snack",
  }), null);

  assert.strictEqual(findAddonBalanceBucket(subscription, {
    addonPlanId: SNACK_PLAN_ID,
    category: "snack",
  }).category, "snack");

  assert.strictEqual(findAddonBalanceBucket(subscription, {
    addonPlanId: JUICE_PLAN_ID,
    category: "juice",
  }).category, "juice");

  const before = JSON.stringify(subscription.addonBalance);
  findAddonBalanceBucket(subscription, {
    addonPlanId: MEAL_PLAN_ID,
    category: "meal",
    requirePositiveRemaining: true,
  });
  findAddonBalanceBucket(subscription, {
    addonPlanId: MEAL_PLAN_ID,
    category: "meal",
    requirePositiveRemaining: true,
  });
  assert.strictEqual(JSON.stringify(subscription.addonBalance), before);

  console.log("owned add-on entitlement snapshot tests passed");
}

run();
