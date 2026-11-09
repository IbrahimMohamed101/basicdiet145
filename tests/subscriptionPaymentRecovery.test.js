"use strict";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Payment = require("../src/models/Payment");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const { logger } = require("../src/utils/logger");
const { processPaidSubscriptionPaymentRecoveries } = require(
  "../src/services/subscription/subscriptionPaymentRecoveryService"
);

const oid = () => new mongoose.Types.ObjectId();
const conflict = "STACKING_DRAFT_COMPLETION_CONFLICT";
const reviewMessage = "Paid subscription payment needs review";
const failedAt = new Date("2025-01-01T00:00:00Z");
let mongo;

before(async () => {
  // Force the same two-document write ordering as the standalone deployment.
  mongo = await MongoMemoryServer.create({ instance: { dbName: "payment_recovery_test" } });
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function fixture({ batchOverrides = {}, standalone = false } = {}) {
  await Promise.all([Payment, CheckoutDraft, Subscription, Batch].map((m) => m.deleteMany({})));
  const userId = oid();
  const planId = oid();
  const paymentId = oid();
  const draftId = oid();
  const subscriptionId = oid();
  const batchId = oid();
  const amount = 123456;
  await Subscription.collection.insertOne({
    _id: subscriptionId, userId, planId: standalone ? planId : oid(), status: "active",
    totalMeals: 60, remainingMeals: 41, selectedMealsPerDay: 2, selectedGrams: 150,
    totalPriceHalala: amount, checkoutCurrency: "SAR",
    stacking: { aggregateBalance: { totalMeals: 60, consumedMeals: 19, remainingMeals: 41 } },
  });
  await Payment.collection.insertOne({
    _id: paymentId, userId, status: "paid", type: "subscription_activation", provider: "moyasar",
    amount, currency: "SAR", applied: false, paidAt: new Date(), subscriptionId,
    checkoutDraftId: draftId, updatedAt: failedAt,
    metadata: { draftId: String(draftId), unappliedReason: conflict, subscriptionRecoveryNextAt: failedAt },
  });
  await CheckoutDraft.collection.insertOne({
    _id: draftId, userId, planId, paymentId, status: "failed", failureReason: "payment_failed",
    failedAt, updatedAt: failedAt, daysCount: 30, grams: 150, mealsPerDay: 2,
    breakdown: { totalHalala: amount, currency: "SAR" },
    ...(standalone
      ? { activationSubscriptionId: subscriptionId }
      : { stackingFinalization: { mode: "additive_existing_parent", expectedParentSubscriptionId: subscriptionId } }),
  });
  if (!standalone) {
    await Batch.collection.insertOne({
      _id: batchId, userId, planId, paymentId, checkoutDraftId: draftId,
      containerSubscriptionId: subscriptionId, status: "paid_scheduled", applicationState: "applied",
      daysCount: 30, proteinGrams: 150, mealsPerDay: 2,
      totalMeals: 60, consumedMeals: 19, remainingMeals: 41,
      pricingSnapshot: { totalPriceHalala: amount, currency: "SAR" },
      ...batchOverrides,
    });
  }
  return { paymentId, draftId, subscriptionId, batchId };
}

async function entitlementSnapshot({ batchId, subscriptionId }) {
  return Promise.all([
    Batch.collection.findOne({ _id: batchId }),
    Subscription.collection.findOne({ _id: subscriptionId }),
  ]);
}

test("the recovery job reconciles an applied stacked purchase and preserves all meal balances", async () => {
  const ids = await fixture();
  const balances = await entitlementSnapshot(ids);

  assert.deepEqual(await processPaidSubscriptionPaymentRecoveries(), { scanned: 1, recovered: 1, failed: 0 });
  assert.deepEqual(await entitlementSnapshot(ids), balances);
  const draft = await CheckoutDraft.findById(ids.draftId).lean();
  assert.equal(draft.status, "completed");
  assert.equal(String(draft.subscriptionId), String(ids.subscriptionId));
  assert.equal(String(draft.activationSubscriptionId), String(ids.subscriptionId));
  assert.equal(String(draft.paymentRecoveryAudit.paymentId), String(ids.paymentId));
  assert.equal(String(draft.paymentRecoveryAudit.batchId), String(ids.batchId));
  assert.deepEqual(draft.paymentRecoveryAudit.previousFailedAt, failedAt);
  assert.equal(draft.paymentRecoveryAudit.reason, "paid_after_payment_failed");
  const payment = await Payment.findById(ids.paymentId).lean();
  assert.equal(payment.applied, true);
  assert.equal(payment.metadata.unappliedReason, undefined);
  assert.equal(payment.metadata.subscriptionRecoveryNextAt, undefined);
  assert.deepEqual(await processPaidSubscriptionPaymentRecoveries(), { scanned: 0, recovered: 0, failed: 0 });
});

test("a payment-linked standalone activation can be reconciled without an entitlement batch", async () => {
  const ids = await fixture({ standalone: true });
  const balances = await entitlementSnapshot(ids);
  assert.equal((await processPaidSubscriptionPaymentRecoveries()).recovered, 1);
  assert.equal((await Payment.findById(ids.paymentId).lean()).applied, true);
  assert.equal((await CheckoutDraft.findById(ids.draftId).lean()).status, "completed");
  assert.deepEqual(await entitlementSnapshot(ids), balances);
});

test("a mismatch is flagged once and subsequent job ticks skip the payment", async (t) => {
  for (const batchOverrides of [
    { userId: oid() },
    { pricingSnapshot: { totalPriceHalala: 1, currency: "SAR" } },
    { planId: oid() },
  ]) {
    const ids = await fixture({ batchOverrides });
    const balances = await entitlementSnapshot(ids);
    const warning = t.mock.method(logger, "warn", () => {});
    try {
      await Promise.all([processPaidSubscriptionPaymentRecoveries(), processPaidSubscriptionPaymentRecoveries()]);
      const payment = await Payment.findById(ids.paymentId).lean();
      assert.equal(payment.applied, false);
      assert.equal(payment.subscriptionRecoveryReview.status, "needs_review");
      assert.equal(payment.subscriptionRecoveryReview.reason, "entitlement_batch_mismatch");
      assert.equal(payment.metadata.subscriptionRecoveryNextAt, undefined);
      assert.equal((await CheckoutDraft.findById(ids.draftId).lean()).status, "failed");
      assert.deepEqual(await entitlementSnapshot(ids), balances);
      assert.deepEqual(await processPaidSubscriptionPaymentRecoveries(), { scanned: 0, recovered: 0, failed: 0 });
      const alerts = warning.mock.calls.filter((call) => call.arguments[0] === reviewMessage);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].arguments[1].paymentId, String(ids.paymentId));
    } finally {
      warning.mock.restore();
    }
  }
});

test("standalone retry resumes a draft already reconciled before an interrupted payment write", async (t) => {
  const ids = await fixture();
  const balances = await entitlementSnapshot(ids);
  const original = Payment.updateOne.bind(Payment);
  const interrupted = t.mock.method(Payment, "updateOne", (filter, update, options) => {
    if (update?.$set?.applied === true) throw new Error("synthetic interruption");
    return original(filter, update, options);
  });
  const errors = t.mock.method(logger, "error", () => {});
  try {
    assert.equal((await processPaidSubscriptionPaymentRecoveries()).failed, 1);
  } finally {
    interrupted.mock.restore();
    errors.mock.restore();
  }
  const draft = await CheckoutDraft.findById(ids.draftId).lean();
  assert.equal(draft.status, "completed");
  assert.equal((await Payment.findById(ids.paymentId).lean()).applied, false);
  assert.equal((await processPaidSubscriptionPaymentRecoveries()).recovered, 1);
  assert.equal((await Payment.findById(ids.paymentId).lean()).applied, true);
  assert.deepEqual((await CheckoutDraft.findById(ids.draftId).lean()).paymentRecoveryAudit, draft.paymentRecoveryAudit);
  assert.deepEqual(await entitlementSnapshot(ids), balances);
});
