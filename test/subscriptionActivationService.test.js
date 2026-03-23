const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  isCanonicalCheckoutDraft,
  buildCanonicalSubscriptionActivationPayload,
  activateSubscriptionFromCanonicalDraft,
} = require("../src/services/subscriptionActivationService");
const { PHASE1_CONTRACT_VERSION } = require("../src/constants/phase1Contract");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createCanonicalDraft() {
  const subscriptionId = objectId();
  const draft = {
    _id: objectId(),
    userId: objectId(),
    planId: objectId(),
    contractVersion: PHASE1_CONTRACT_VERSION,
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractHash: "contract-hash-1",
    contractSnapshot: {
      meta: {
        version: PHASE1_CONTRACT_VERSION,
        capturedAt: "2026-03-17T07:00:00.000Z",
        source: "customer_checkout",
        mode: "canonical",
        completeness: "authoritative",
      },
      origin: {
        actorRole: "client",
        actorUserId: "user-1",
        renewedFromSubscriptionId: String(subscriptionId),
        adminOverrideMeta: null,
        deliveryPreferenceSeeded: false,
      },
      plan: {
        planId: String(objectId()),
        planName: { ar: "الخطة", en: "Plan" },
        daysCount: 4,
        selectedGrams: 150,
        mealsPerDay: 3,
        totalMeals: 12,
        currency: "SAR",
      },
      start: {
        requestedStartDate: null,
        resolvedStartDate: "2026-03-18T21:00:00.000Z",
        defaultedToTomorrow: true,
        timezone: "Asia/Riyadh",
      },
      pricing: {
        basePlanPriceHalala: 10000,
        deliveryFeeHalala: 1500,
        vatPercentage: 15,
        vatHalala: 1725,
        totalHalala: 13225,
        currency: "SAR",
      },
      delivery: {
        mode: "delivery",
        pricingMode: "flat_legacy",
        seedOnlyFromPreviousPreference: false,
        slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
        address: { city: "Riyadh", district: "Olaya" },
        pickupLocationId: null,
      },
      policySnapshot: {
        freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 },
        skipPolicyMode: "legacy_current",
        fallbackMode: "legacy_current",
        premiumAutoConsume: false,
        oneTimeAddonRequiresPaymentBeforeConfirmation: false,
      },
      compatibility: {
        usesLegacyPremiumRuntime: true,
        usesLegacyAddonRuntime: true,
        usesLegacyDeliveryRuntime: true,
        usesLegacySkipRuntime: true,
      },
    },
    premiumItems: [
      { premiumMealId: objectId(), qty: 2, unitExtraFeeHalala: 500, currency: "SAR" },
    ],
    addonItems: [
      { addonId: objectId(), qty: 1, unitPriceHalala: 300, currency: "SAR" },
    ],
    addonSubscriptions: [{ addonId: objectId(), name: "Salad", price: 3, type: "subscription" }],
    providerInvoiceId: "invoice-1",
    saveCalls: [],
    async save() {
      this.saveCalls.push({
        status: this.status,
        subscriptionId: this.subscriptionId ? String(this.subscriptionId) : null,
      });
      return this;
    },
  };

  draft.renewedFromSubscriptionId = subscriptionId;
  return draft;
}

function createPayment() {
  return {
    _id: objectId(),
    providerInvoiceId: "invoice-1",
    saveCalls: [],
    async save() {
      this.saveCalls.push({
        subscriptionId: this.subscriptionId ? String(this.subscriptionId) : null,
      });
      return this;
    },
  };
}

test("isCanonicalCheckoutDraft identifies authoritative canonical drafts", () => {
  assert.equal(isCanonicalCheckoutDraft(createCanonicalDraft()), true);
  assert.equal(isCanonicalCheckoutDraft({ contractVersion: PHASE1_CONTRACT_VERSION, contractMode: "canonical" }), false);
});

test("buildCanonicalSubscriptionActivationPayload copies canonical contract metadata and legacy runtime fields", () => {
  const draft = createCanonicalDraft();
  const result = buildCanonicalSubscriptionActivationPayload({ draft });

  assert.equal(result.subscriptionPayload.contractVersion, PHASE1_CONTRACT_VERSION);
  assert.equal(result.subscriptionPayload.contractHash, draft.contractHash);
  assert.equal(result.subscriptionPayload.contractSnapshot, draft.contractSnapshot);
  assert.equal(result.subscriptionPayload.totalMeals, 12);
  assert.equal(result.subscriptionPayload.remainingMeals, 12);
  assert.equal(result.subscriptionPayload.selectedMealsPerDay, 3);
  assert.equal(result.subscriptionPayload.basePlanPriceHalala, 10000);
  assert.equal(result.subscriptionPayload.deliveryMode, "delivery");
  assert.equal(result.subscriptionPayload.addonSubscriptions.length, 1);
  assert.equal(result.subscriptionPayload.addonSubscriptions[0].entitlementMode, "daily_recurring");
  assert.equal(result.subscriptionPayload.addonSubscriptions[0].maxPerDay, 1);
  assert.equal(typeof result.subscriptionPayload.addonSubscriptions[0].category, "string");
  assert.equal(result.dayEntries.length, 4);
  assert.equal(result.dayEntries[0].date, "2026-03-19");
  assert.equal(result.dayEntries[0].recurringAddons.length, 1);
  assert.equal(result.dayEntries[0].recurringAddons[0].entitlementMode, "daily_recurring");
});

test("activateSubscriptionFromCanonicalDraft persists subscription, days, and completion state", async () => {
  const draft = createCanonicalDraft();
  const payment = createPayment();
  const createdSubscriptionId = objectId();
  const calls = {
    createSubscription: [],
    countSubscriptionDays: [],
    insertSubscriptionDays: [],
  };

  const result = await activateSubscriptionFromCanonicalDraft({
    draft,
    payment,
    session: { id: "session-1" },
    persistence: {
      async createSubscription(payload) {
        calls.createSubscription.push(payload);
        return { _id: createdSubscriptionId, ...payload };
      },
      async countSubscriptionDays(subscriptionId) {
        calls.countSubscriptionDays.push(String(subscriptionId));
        return 0;
      },
      async insertSubscriptionDays(entries) {
        calls.insertSubscriptionDays.push(entries);
        return entries;
      },
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.subscriptionId, String(createdSubscriptionId));
  assert.equal(calls.createSubscription.length, 1);
  assert.equal(calls.insertSubscriptionDays.length, 1);
  assert.equal(calls.insertSubscriptionDays[0].length, 4);
  assert.equal(String(draft.subscriptionId), String(createdSubscriptionId));
  assert.equal(String(payment.subscriptionId), String(createdSubscriptionId));
  assert.equal(draft.status, "completed");
  assert.equal(draft.saveCalls.length, 1);
  assert.equal(payment.saveCalls.length, 1);
});

test("buildCanonicalSubscriptionActivationPayload supports generic premium wallet drafts", () => {
  const draft = createCanonicalDraft();
  draft.premiumItems = [];
  draft.premiumWalletMode = "generic_v1";
  draft.premiumCount = 3;
  draft.premiumUnitPriceHalala = 500;

  const result = buildCanonicalSubscriptionActivationPayload({ draft });

  assert.equal(result.subscriptionPayload.premiumWalletMode, "generic_v1");
  assert.equal(result.subscriptionPayload.premiumBalance.length, 0);
  assert.equal(result.subscriptionPayload.genericPremiumBalance.length, 1);
  assert.equal(result.subscriptionPayload.premiumRemaining, 3);
  assert.equal(result.subscriptionPayload.premiumPrice, 5);
});
