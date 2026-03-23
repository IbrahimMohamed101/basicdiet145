const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");
const Payment = require("../src/models/Payment");
const { PHASE1_CONTRACT_VERSION } = require("../src/constants/phase1Contract");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("legacy-safe checkout draft still validates without Phase 1 fields", () => {
  const draft = new CheckoutDraft({
    userId: objectId(),
    planId: objectId(),
    daysCount: 10,
    grams: 150,
    mealsPerDay: 3,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", window: "8-11", slotId: "slot-1" },
    },
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      vatHalala: 1500,
      totalHalala: 11500,
      currency: "SAR",
    },
  });

  assert.equal(draft.validateSync(), undefined);
});

test("Phase 1 contract fields validate on checkout draft and subscription", () => {
  const subscriptionId = objectId();
  const contractSnapshot = {
    meta: {
      version: PHASE1_CONTRACT_VERSION,
      capturedAt: new Date("2026-03-17T10:00:00.000Z").toISOString(),
      source: "customer_checkout",
      mode: "canonical",
      completeness: "authoritative",
    },
  };

  const draft = new CheckoutDraft({
    userId: objectId(),
    planId: objectId(),
    daysCount: 5,
    grams: 200,
    mealsPerDay: 2,
    delivery: {
      type: "pickup",
      slot: { type: "pickup", window: "12-3", slotId: "pick-1" },
    },
    breakdown: {
      basePlanPriceHalala: 5000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      vatHalala: 750,
      totalHalala: 5750,
      currency: "SAR",
    },
    contractVersion: PHASE1_CONTRACT_VERSION,
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractHash: "hash-1",
    contractSnapshot,
    renewedFromSubscriptionId: subscriptionId,
    premiumWalletMode: "generic_v1",
    premiumCount: 3,
    premiumUnitPriceHalala: 500,
  });

  const subscription = new Subscription({
    userId: objectId(),
    planId: objectId(),
    status: "active",
    totalMeals: 10,
    remainingMeals: 10,
    deliveryMode: "pickup",
    contractVersion: PHASE1_CONTRACT_VERSION,
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "renewal",
    contractHash: "hash-2",
    contractSnapshot,
    renewedFromSubscriptionId: subscriptionId,
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{
      purchasedQty: 3,
      remainingQty: 3,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      source: "subscription_purchase",
    }],
  });

  assert.equal(draft.validateSync(), undefined);
  assert.equal(subscription.validateSync(), undefined);
});

test("Phase 1 idempotency fields validate on payment while remaining optional", () => {
  const legacyPayment = new Payment({
    provider: "moyasar",
    type: "subscription_activation",
    amount: 1000,
    currency: "SAR",
  });

  const payment = new Payment({
    provider: "moyasar",
    type: "premium_topup",
    amount: 2500,
    currency: "SAR",
    operationScope: "premium_topup",
    operationIdempotencyKey: "premium-123",
    operationRequestHash: "hash-123",
  });

  assert.equal(legacyPayment.validateSync(), undefined);
  assert.equal(payment.validateSync(), undefined);
});
