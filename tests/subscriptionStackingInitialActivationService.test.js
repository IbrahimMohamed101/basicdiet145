"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  seedInitialPaidPurchaseEntitlementsTransactional,
} = require("../src/services/subscription/subscriptionStackingInitialActivationService");

function transactionalSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function fixture() {
  const userId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    planId,
    daysCount: 7,
    startDate: new Date("2026-08-22T00:00:00+03:00"),
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "standard_initial",
      expectedParentSubscriptionId: null,
    },
  };
  const payment = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    status: "paid",
  };
  const subscriptionPayload = {
    userId,
    planId,
    startDate: draft.startDate,
    endDate: new Date("2026-08-28T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-28T00:00:00+03:00"),
    totalMeals: 7,
    remainingMeals: 7,
    selectedMealsPerDay: 1,
    selectedGrams: 100,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    premiumBalance: [],
    addonSubscriptions: [],
    addonBalance: [],
    checkoutCurrency: "SAR",
  };
  return { draft, payment, subscriptionPayload, containerSubscriptionId };
}

async function testInitialPurchaseCreatesAppliedBatchAndSeedsExtrasAtomically() {
  const input = fixture();
  const now = new Date("2026-08-22T12:00:00+03:00");
  let persistedPayload;
  let seededBatch;
  const result = await seedInitialPaidPurchaseEntitlementsTransactional({
    ...input,
    businessDate: "2026-08-22",
    session: transactionalSession(),
    now,
    runtime: {
      ensureBatch: async ({ payload, session }) => {
        assert.strictEqual(session.inTransaction(), true);
        persistedPayload = payload;
        return {
          batch: { _id: new mongoose.Types.ObjectId(), ...payload },
          created: true,
          idempotent: false,
        };
      },
      seedExtraBuckets: async ({ batch, session }) => {
        assert.strictEqual(session.inTransaction(), true);
        seededBatch = batch;
        return { buckets: [], idempotent: true };
      },
    },
  });

  assert.strictEqual(persistedPayload.sourceType, "checkout");
  assert.strictEqual(persistedPayload.sourceKey, `payment:${input.payment._id}`);
  assert.strictEqual(String(persistedPayload.containerSubscriptionId), String(input.containerSubscriptionId));
  assert.strictEqual(persistedPayload.applicationState, "applied");
  assert.strictEqual(persistedPayload.status, "active");
  assert.strictEqual(persistedPayload.appliedAt, now);
  assert.strictEqual(persistedPayload.activatedAt, now);
  assert.strictEqual(seededBatch, result.batch);
  assert.strictEqual(result.idempotent, false);
}

async function testInitialPurchaseRequiresTransaction() {
  await assert.rejects(
    () => seedInitialPaidPurchaseEntitlementsTransactional({
      ...fixture(),
      businessDate: "2026-08-22",
      session: null,
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

async function run() {
  await testInitialPurchaseCreatesAppliedBatchAndSeedsExtrasAtomically();
  await testInitialPurchaseRequiresTransaction();
  console.log("subscription stacking initial activation service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
