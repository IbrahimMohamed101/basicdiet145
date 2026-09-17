"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "timeline-extra-days-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  buildCanonicalContractActivationPayload,
} = require("../src/services/subscription/subscriptionActivationService");
const {
  buildPhase1SubscriptionContract,
} = require("../src/services/subscription/subscriptionContractService");
const {
  resolvePlanTimelineExtraDays,
} = require("../src/services/subscription/subscriptionTimelineDurationService");

function buildResolvedQuote(plan) {
  return {
    plan,
    grams: 150,
    mealsPerDay: 2,
    startDate: "2026-08-01",
    breakdown: {
      basePlanPriceHalala: 100000,
      basePlanGrossHalala: 100000,
      basePlanNetHalala: 86957,
      subtotalHalala: 100000,
      subtotalBeforeVatHalala: 86957,
      vatPercentage: 15,
      vatHalala: 13043,
      totalPriceHalala: 100000,
      totalHalala: 100000,
      currency: "SAR",
    },
    delivery: {
      type: "pickup",
      pickupLocationId: "main",
      slot: { type: "pickup", window: "" },
    },
    premiumItems: [],
    addonSubscriptions: [],
  };
}

function buildContract(plan) {
  return buildPhase1SubscriptionContract({
    payload: { startDate: "2026-08-01" },
    resolvedQuote: buildResolvedQuote(plan),
    actorContext: { actorRole: "admin" },
    source: "admin_create",
    now: new Date("2026-07-29T12:00:00.000Z"),
    currentBusinessDate: "2026-07-29",
  });
}

const planId = new mongoose.Types.ObjectId();
const configuredPlan = {
  _id: planId,
  key: "custom_30_days",
  name: { ar: "30 يوم", en: "30 days" },
  daysCount: 30,
  timelineExtraDays: 5,
  currency: "SAR",
};

const contract = buildContract(configuredPlan);
const activation = buildCanonicalContractActivationPayload({
  userId: new mongoose.Types.ObjectId(),
  planId,
  contract,
});

assert.strictEqual(contract.contractSnapshot.plan.daysCount, 30);
assert.strictEqual(contract.contractSnapshot.plan.timelineExtraDays, 5);
assert.strictEqual(contract.contractSnapshot.plan.totalMeals, 60);
assert.strictEqual(activation.subscriptionPayload.totalMeals, 60);
assert.strictEqual(activation.subscriptionPayload.remainingMeals, 60);
assert.strictEqual(activation.subscriptionPayload.timelineExtraDays, 5);
assert.strictEqual(
  activation.subscriptionPayload.endDate.toISOString(),
  "2026-08-29T21:00:00.000Z",
  "base end date remains based on the 30 meal days"
);
assert.strictEqual(
  activation.subscriptionPayload.validityEndDate.toISOString(),
  "2026-09-03T21:00:00.000Z",
  "timeline is visible for 35 inclusive days"
);
assert.strictEqual(
  activation.dayEntries.length,
  30,
  "extra timeline days must not mint scheduled meal-day entitlements"
);

assert.strictEqual(
  resolvePlanTimelineExtraDays({ key: "subscription_7_days" }),
  1
);
assert.strictEqual(
  resolvePlanTimelineExtraDays({ key: "subscription_26_days" }),
  4
);
assert.strictEqual(
  resolvePlanTimelineExtraDays({ key: "subscription_30_days" }),
  5
);
assert.strictEqual(
  resolvePlanTimelineExtraDays({
    key: "subscription_30_days",
    timelineExtraDays: 9,
  }),
  9,
  "an explicit dashboard value overrides the compatibility default"
);

console.log("subscription timeline extra days contract tests passed");
