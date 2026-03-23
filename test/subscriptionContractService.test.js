const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  resolvePhase1StartDate,
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
} = require("../src/services/subscriptionContractService");
const { PHASE1_CONTRACT_VERSION } = require("../src/constants/phase1Contract");

function createResolvedQuote() {
  return {
    plan: {
      _id: new mongoose.Types.ObjectId(),
      name: { ar: "الخطة الذهبية", en: "Gold Plan" },
      daysCount: 10,
      currency: "SAR",
      freezePolicy: {
        enabled: true,
        maxDays: 14,
        maxTimes: 2,
      },
    },
    grams: 150,
    mealsPerDay: 3,
    startDate: null,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh", district: "Olaya" },
      slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    },
    breakdown: {
      basePlanPriceHalala: 10000,
      deliveryFeeHalala: 2000,
      vatPercentage: 15,
      vatHalala: 1800,
      totalHalala: 13800,
      currency: "SAR",
    },
  };
}

test("resolvePhase1StartDate defaults omitted startDate to tomorrow in KSA", () => {
  const result = resolvePhase1StartDate({
    requestedStartDate: null,
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  assert.equal(result.defaultedToTomorrow, true);
  assert.equal(result.resolvedStartDateKSA, "2026-03-18");
  assert.equal(result.requestedStartDate, null);
});

test("resolvePhase1StartDate preserves explicit future date", () => {
  const result = resolvePhase1StartDate({
    requestedStartDate: "2026-03-20",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  assert.equal(result.defaultedToTomorrow, false);
  assert.equal(result.resolvedStartDateKSA, "2026-03-20");
  assert.equal(result.requestedStartDate, "2026-03-20");
});

test("resolvePhase1StartDate handles omitted startDate just before KSA midnight", () => {
  const result = resolvePhase1StartDate({
    requestedStartDate: null,
    now: new Date("2026-03-17T20:59:59.000Z"),
  });

  assert.equal(result.defaultedToTomorrow, true);
  assert.equal(result.resolvedStartDateKSA, "2026-03-18");
});

test("resolvePhase1StartDate handles omitted startDate just after KSA midnight", () => {
  const result = resolvePhase1StartDate({
    requestedStartDate: null,
    now: new Date("2026-03-17T21:00:01.000Z"),
  });

  assert.equal(result.defaultedToTomorrow, true);
  assert.equal(result.resolvedStartDateKSA, "2026-03-19");
});

test("resolvePhase1StartDate normalizes non-KSA timestamp inputs that cross KSA date boundaries", () => {
  const result = resolvePhase1StartDate({
    requestedStartDate: "2026-03-17T22:30:00.000Z",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  assert.equal(result.defaultedToTomorrow, false);
  assert.equal(result.resolvedStartDateKSA, "2026-03-18");
  assert.equal(result.resolvedStartDate.toISOString(), "2026-03-17T21:00:00.000Z");
});

test("resolvePhase1StartDate rejects non-future dates", () => {
  assert.throws(
    () =>
      resolvePhase1StartDate({
        requestedStartDate: "2026-03-17",
        now: new Date("2026-03-17T10:00:00+03:00"),
      }),
    (error) => error && error.code === "VALIDATION_ERROR"
  );
});

test("buildPhase1SubscriptionContract produces authoritative canonical snapshot", () => {
  const resolvedQuote = createResolvedQuote();
  resolvedQuote.addonItems = [
    {
      addon: {
        _id: new mongoose.Types.ObjectId(),
        name: { ar: "شوربة", en: "Soup" },
        type: "subscription",
        category: "starter",
      },
      qty: 1,
      unitPriceHalala: 300,
      currency: "SAR",
    },
  ];

  const contract = buildPhase1SubscriptionContract({
    payload: {},
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "customer_checkout",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  assert.equal(contract.contractVersion, PHASE1_CONTRACT_VERSION);
  assert.equal(contract.contractMode, "canonical");
  assert.equal(contract.contractCompleteness, "authoritative");
  assert.equal(contract.contractSource, "customer_checkout");
  assert.equal(contract.contractSnapshot.plan.totalMeals, 30);
  assert.equal(contract.contractSnapshot.start.defaultedToTomorrow, true);
  assert.equal(contract.contractSnapshot.delivery.pricingMode, "zone_snapshot");
  assert.equal(contract.contractSnapshot.policySnapshot.premiumAutoConsume, false);
  assert.equal(contract.contractSnapshot.entitlementContract.recurringAddons.length, 1);
  assert.equal(contract.contractSnapshot.entitlementContract.recurringAddons[0].category, "starter");
  assert.equal(contract.contractSnapshot.entitlementContract.recurringAddons[0].entitlementMode, "daily_recurring");
  assert.equal(contract.contractSnapshot.entitlementContract.recurringAddons[0].maxPerDay, 1);
  assert.equal(contract.contractSnapshot.compatibility.usesLegacyPremiumRuntime, true);
  assert.ok(contract.contractHash);
});

test("buildPhase1SubscriptionContract uses pricing values from resolved quote only", () => {
  const resolvedQuote = createResolvedQuote();

  const contract = buildPhase1SubscriptionContract({
    payload: { vatPercentage: 99 },
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "customer_checkout",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  assert.equal(contract.contractSnapshot.pricing.vatPercentage, 15);
  assert.equal(contract.contractSnapshot.pricing.vatHalala, 1800);
  assert.equal(contract.contractSnapshot.pricing.totalHalala, 13800);
});

test("buildCanonicalDraftPersistenceFields keeps top-level draft startDate aligned with canonical contract", () => {
  const resolvedQuote = createResolvedQuote();
  const contract = buildPhase1SubscriptionContract({
    payload: {},
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "customer_checkout",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  const fields = buildCanonicalDraftPersistenceFields({ contract });

  assert.equal(fields.startDate.toISOString(), contract.resolvedStart.resolvedStartDate.toISOString());
  assert.equal(fields.contractVersion, contract.contractVersion);
  assert.equal(fields.contractHash, contract.contractHash);
  assert.equal(fields.contractSource, "customer_checkout");
});

test("contract hash is stable across source and actor metadata changes", () => {
  const resolvedQuote = createResolvedQuote();
  const now = new Date("2026-03-17T10:00:00+03:00");

  const customerContract = buildPhase1SubscriptionContract({
    payload: {},
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "customer_checkout",
    now,
  });

  const adminContract = buildPhase1SubscriptionContract({
    payload: {},
    resolvedQuote,
    actorContext: { actorRole: "admin", actorUserId: "admin-1", adminOverrideMeta: { note: "manual assist" } },
    source: "admin_create",
    now,
  });

  assert.equal(customerContract.contractHash, adminContract.contractHash);
});

test("renewal delivery preference is recorded as seed-only metadata", () => {
  const resolvedQuote = createResolvedQuote();

  const contract = buildPhase1SubscriptionContract({
    payload: { startDate: "2026-03-21" },
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "renewal",
    now: new Date("2026-03-17T10:00:00+03:00"),
    renewalSeed: {
      subscriptionId: new mongoose.Types.ObjectId(),
      deliveryPreference: { mode: "delivery", address: { city: "Riyadh" } },
    },
  });

  assert.equal(contract.contractSnapshot.origin.deliveryPreferenceSeeded, true);
  assert.equal(contract.contractSnapshot.delivery.seedOnlyFromPreviousPreference, true);
});

test("buildPhase1SubscriptionContract captures generic premium entitlement details for canonical premium wallet mode", () => {
  const resolvedQuote = {
    ...createResolvedQuote(),
    premiumWalletMode: "generic_v1",
    premiumCount: 4,
    premiumUnitPriceHalala: 500,
  };

  const contract = buildPhase1SubscriptionContract({
    payload: { premiumCount: 4 },
    resolvedQuote,
    actorContext: { actorRole: "client", actorUserId: "user-1" },
    source: "customer_checkout",
    now: new Date("2026-03-17T10:00:00+03:00"),
  });

  const fields = buildCanonicalDraftPersistenceFields({ contract });

  assert.equal(contract.contractSnapshot.entitlementContract.premiumWalletMode, "generic_v1");
  assert.equal(contract.contractSnapshot.entitlementContract.premiumCount, 4);
  assert.equal(contract.contractSnapshot.entitlementContract.premiumUnitPriceHalala, 500);
  assert.equal(contract.contractSnapshot.compatibility.usesLegacyPremiumRuntime, false);
  assert.equal(fields.premiumWalletMode, "generic_v1");
  assert.equal(fields.premiumCount, 4);
  assert.equal(fields.premiumUnitPriceHalala, 500);
});
