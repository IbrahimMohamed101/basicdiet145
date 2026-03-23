const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  getSubscriptionContractReadView,
  resolveSubscriptionFreezePolicy,
  getSubscriptionContractDiagnostics,
} = require("../src/services/subscriptionContractReadService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createCanonicalSubscription(overrides = {}) {
  return {
    _id: objectId(),
    planId: objectId(),
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    totalMeals: 15,
    basePlanPriceHalala: 10000,
    deliveryMode: "delivery",
    deliveryWindow: "8 AM - 11 AM",
    startDate: new Date("2026-03-19T21:00:00.000Z"),
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractSnapshot: {
      plan: {
        planId: null,
        planName: { ar: "الخطة الذهبية", en: "Gold Plan" },
        selectedGrams: 150,
        mealsPerDay: 3,
        totalMeals: 15,
      },
      start: { resolvedStartDate: "2026-03-19T21:00:00.000Z" },
      pricing: { basePlanPriceHalala: 10000 },
      delivery: {
        mode: "delivery",
        slot: { window: "8 AM - 11 AM" },
      },
      policySnapshot: {
        freezePolicy: { enabled: false, maxDays: 2, maxTimes: 1 },
      },
    },
    ...overrides,
  };
}

test("getSubscriptionContractReadView returns minimal client contract fields and snapshot-first plan name for canonical subscriptions", () => {
  const subscription = createCanonicalSubscription();
  subscription.contractSnapshot.plan.planId = String(subscription.planId);

  const view = getSubscriptionContractReadView(subscription, {
    audience: "client",
    lang: "en",
    livePlanName: "Legacy Plan Name",
    snapshotFirstReadsEnabled: true,
    compatLoggingEnabled: false,
  });

  assert.deepEqual(view.contract, {
    isCanonical: true,
    isGrandfathered: false,
    version: "subscription_contract.v1",
  });
  assert.equal(view.planName, "Gold Plan");
  assert.equal(view.contractMeta, undefined);
});

test("getSubscriptionContractReadView exposes richer admin contractMeta and labels legacy subscriptions as grandfathered", () => {
  const legacySubscription = {
    _id: objectId(),
    planId: objectId(),
  };

  const view = getSubscriptionContractReadView(legacySubscription, {
    audience: "admin",
    lang: "ar",
    livePlanName: "خطة قديمة",
    snapshotFirstReadsEnabled: true,
    compatLoggingEnabled: false,
  });

  assert.deepEqual(view.contract, {
    isCanonical: false,
    isGrandfathered: true,
    version: null,
  });
  assert.equal(view.planName, "خطة قديمة");
  assert.deepEqual(view.contractMeta, {
    version: null,
    mode: "legacy_grandfathered",
    completeness: "unavailable",
    source: null,
    isCanonical: false,
    isGrandfathered: true,
    snapshotAvailable: false,
    readMode: "legacy",
    diagnosticsAvailable: false,
  });
});

test("resolveSubscriptionFreezePolicy uses canonical snapshot freeze policy only when snapshot-first reads are enabled", () => {
  const subscription = createCanonicalSubscription();
  const livePlan = {
    freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 },
  };

  const snapshotPolicy = resolveSubscriptionFreezePolicy(subscription, livePlan, {
    snapshotFirstReadsEnabled: true,
    compatLoggingEnabled: false,
  });
  assert.deepEqual(snapshotPolicy, {
    enabled: false,
    maxDays: 2,
    maxTimes: 1,
  });

  const legacyPolicy = resolveSubscriptionFreezePolicy(subscription, livePlan, {
    snapshotFirstReadsEnabled: false,
    compatLoggingEnabled: false,
  });
  assert.deepEqual(legacyPolicy, {
    enabled: true,
    maxDays: 31,
    maxTimes: 1,
  });
});

test("getSubscriptionContractDiagnostics reports mismatches and fallbacks for canonical subscriptions", () => {
  const subscription = createCanonicalSubscription({
    selectedGrams: 200,
  });
  subscription.contractSnapshot.plan.planId = String(subscription.planId);

  const diagnostics = getSubscriptionContractDiagnostics(subscription, {
    lang: "en",
    livePlanName: "Legacy Plan Name",
    livePlan: { freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 } },
    snapshotFirstReadsEnabled: true,
  });

  assert.equal(diagnostics.canonical, true);
  assert.equal(diagnostics.readMode, "snapshot_first");
  assert.equal(diagnostics.mismatches.includes("selectedGrams"), true);
  assert.equal(diagnostics.mismatches.includes("freezePolicy"), true);
});
