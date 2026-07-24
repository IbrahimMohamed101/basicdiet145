"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  validateSubscriptionDay,
} = require("../src/contracts/flutterMobileResponseContract");
const {
  normalizeCurrentSubscriptionOverviewResponse,
} = require("../src/services/installCurrentSubscriptionOverviewFlutterCompatibility");

function payloadWithSlot(overrides = {}) {
  return {
    ok: true,
    status: 200,
    data: {
      date: "2026-07-22",
      status: "open",
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        carbs: [],
        isPremium: false,
        premiumSource: "none",
        premiumExtraFeeHalala: 0,
        ...overrides,
      }],
      addonSelections: [],
      addonBalance: [],
      addonSubscriptionAllowances: [],
      paymentRequirement: {},
    },
  };
}

const valid = payloadWithSlot();
assert.strictEqual(validateSubscriptionDay(valid), valid);

const omittedDefaults = payloadWithSlot();
delete omittedDefaults.data.mealSlots[0].status;
delete omittedDefaults.data.mealSlots[0].carbs;
delete omittedDefaults.data.mealSlots[0].isPremium;
delete omittedDefaults.data.mealSlots[0].premiumSource;
delete omittedDefaults.data.mealSlots[0].premiumExtraFeeHalala;
assert.strictEqual(
  validateSubscriptionDay(omittedDefaults),
  omittedDefaults,
  "missing nullable/defaulted fields must remain compatible with Dart defaults"
);

for (const [field, value, expectedPath] of [
  ["isPremium", "false", "isPremium"],
  ["premiumExtraFeeHalala", "500", "premiumExtraFeeHalala"],
  ["carbs", false, "carbs"],
  ["status", false, "status"],
]) {
  assert.throws(
    () => validateSubscriptionDay(payloadWithSlot({ [field]: value })),
    (error) => error
      && error.code === "FLUTTER_RESPONSE_CONTRACT_MISMATCH"
      && error.path.includes(expectedPath),
    `${field} must reject a Flutter-incompatible value instead of coercing it`
  );
}

const wrongAddonSelections = payloadWithSlot();
wrongAddonSelections.data.addonSelections = false;
assert.throws(
  () => validateSubscriptionDay(wrongAddonSelections),
  (error) => error
    && error.code === "FLUTTER_RESPONSE_CONTRACT_MISMATCH"
    && error.path.includes("addonSelections")
);

const objectIdLike = (value) => ({ toHexString: () => value });
const currentOverview = {
  status: true,
  data: {
    _id: objectIdLike("6a63de40f5f079ba4f1921e6"),
    businessDate: "2026-07-25",
    status: "active",
    totalMeals: "52",
    remainingMeals: "48",
    selectedMealsPerDay: "2",
    addonsSummary: [{
      addonId: objectIdLike("6a6219a0f4f8d0974cebc49d"),
      name: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
      purchasedQtyTotal: "26",
      remainingQtyTotal: "25",
      consumedQtyTotal: "1",
    }],
    addonBalances: [{
      addonPlanId: objectIdLike("6a6219a0f4f8d0974cebc49d"),
      addonId: objectIdLike("6a6219a0f4f8d0974cebc49d"),
      name: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
      includedTotalQty: "26",
      consumedQty: "1",
      reservedQty: "0",
      remainingQty: "25",
      currency: "SAR",
    }],
    pickupLocation: {
      id: "main",
      name: { ar: "الفرع الرئيسي", en: "Main Branch" },
      address: "جدة",
      latitude: "21.543333",
      longitude: "39.172779",
    },
    fulfillmentSummary: {
      mode: "pickup",
      title: { ar: "استلام من الفرع", en: "Branch pickup" },
      status: "active",
      statusLabel: "نشط",
      message: "جاهز للتخطيط",
      nextAction: "",
      isEditable: "true",
      isFulfillable: "false",
      planningReady: 1,
      fulfillmentReady: 0,
      lockedReason: null,
      lockedMessage: null,
    },
    mealBalance: {
      totalMeals: "52",
      remainingMeals: "48",
      consumedMeals: "4",
      canConsumeNow: "true",
      maxConsumableMealsNow: "2",
      mealBalancePolicy: "pooled",
      dailyMealLimitEnforced: "false",
      dailyMealsDefault: "2",
    },
  },
};

const currentOverviewDataKeys = Object.keys(currentOverview.data).sort();
const addonSummaryKeys = Object.keys(currentOverview.data.addonsSummary[0]).sort();
const normalizedOverview = normalizeCurrentSubscriptionOverviewResponse(currentOverview, "ar");

assert.deepStrictEqual(
  Object.keys(normalizedOverview.data).sort(),
  currentOverviewDataKeys,
  "current overview normalization must not add or remove response fields"
);
assert.deepStrictEqual(
  Object.keys(normalizedOverview.data.addonsSummary[0]).sort(),
  addonSummaryKeys,
  "add-on summary normalization must preserve its response shape"
);
assert.strictEqual(normalizedOverview.data._id, "6a63de40f5f079ba4f1921e6");
assert.strictEqual(normalizedOverview.data.totalMeals, 52);
assert.strictEqual(normalizedOverview.data.remainingMeals, 48);
assert.strictEqual(normalizedOverview.data.addonsSummary[0].addonId, "6a6219a0f4f8d0974cebc49d");
assert.strictEqual(normalizedOverview.data.addonsSummary[0].name, "اشتراك العصير والمشروبات");
assert.strictEqual(normalizedOverview.data.addonsSummary[0].purchasedQtyTotal, 26);
assert.strictEqual(normalizedOverview.data.addonBalances[0].name, "اشتراك العصير والمشروبات");
assert.strictEqual(normalizedOverview.data.pickupLocation.name, "الفرع الرئيسي");
assert.strictEqual(normalizedOverview.data.pickupLocation.latitude, 21.543333);
assert.strictEqual(normalizedOverview.data.pickupLocation.longitude, 39.172779);
assert.strictEqual(normalizedOverview.data.fulfillmentSummary.title, "استلام من الفرع");
assert.strictEqual(normalizedOverview.data.fulfillmentSummary.isEditable, true);
assert.strictEqual(normalizedOverview.data.fulfillmentSummary.isFulfillable, false);
assert.strictEqual(normalizedOverview.data.fulfillmentSummary.planningReady, true);
assert.strictEqual(normalizedOverview.data.mealBalance.totalMeals, 52);
assert.strictEqual(normalizedOverview.data.mealBalance.canConsumeNow, true);
assert.strictEqual(normalizedOverview.data.mealBalance.dailyMealLimitEnforced, false);

console.log("Flutter strict scalar contract checks passed");