"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  manualDeductionDetails,
  reasonLabel,
} = require("../src/services/subscription/subscriptionMealMovementProvenanceEnrichmentService");

assert.equal(reasonLabel("cashier_walk_in"), "صرف مباشر للعميل من الفرع");
assert.equal(reasonLabel("balance_correction"), "تصحيح رصيد الاشتراك");

const details = manualDeductionDetails({
  meta: {
    deductedRegularMeals: 3,
    deductedPremiumMeals: 1,
    deductedTotalMeals: 4,
    deductedAddons: [{
      addonId: "addon-1",
      qty: 2,
      remainingBefore: 5,
      remainingAfter: 3,
    }],
    before: {
      remainingRegularMeals: 87,
      remainingPremiumMeals: 3,
      remainingMeals: 90,
    },
    after: {
      remainingRegularMeals: 84,
      remainingPremiumMeals: 2,
      remainingMeals: 86,
    },
    reason: "cashier_walk_in",
    notes: "walk-in customer",
    fulfillmentMethod: "pickup",
    businessDate: "2026-07-31",
  },
});

assert.deepEqual(details, {
  regularMeals: 3,
  premiumMeals: 1,
  totalMeals: 4,
  addons: [{
    addonId: "addon-1",
    qty: 2,
    remainingBefore: 5,
    remainingAfter: 3,
  }],
  before: {
    remainingRegularMeals: 87,
    remainingPremiumMeals: 3,
    remainingMeals: 90,
  },
  after: {
    remainingRegularMeals: 84,
    remainingPremiumMeals: 2,
    remainingMeals: 86,
  },
  reasonCode: "cashier_walk_in",
  reasonLabel: "صرف مباشر للعميل من الفرع",
  notes: "walk-in customer",
  businessDate: "2026-07-31",
  fulfillmentContext: {
    code: "pickup",
    label: "تم تسجيل الخصم أثناء صرف مباشر من الفرع",
  },
});

console.log("dashboard subscription manual deduction detail tests passed");
