"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
// Intentionally load this consumer before the router installer. This protects
// webhook/verify from regressing to a startup-cached legacy finalizer.
const {
  applyPaymentSideEffects,
} = require("../src/services/paymentApplicationService");
require("../src/services/installSubscriptionStackingWriteRouter");
const {
  activatePaidDraftIntoExistingContainerTransactional,
} = require("../src/services/subscription/subscriptionStackingActivationService");

let replSet;

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: "subscription_stacking_concurrent_purchases",
    autoIndex: false,
  });
  for (const model of [
    Subscription,
    CheckoutDraft,
    Payment,
    SubscriptionDay,
    SubscriptionEntitlementBatch,
  ]) {
    await model.createCollection();
    await model.syncIndexes();
  }
}

async function disconnect() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function createContainer() {
  const addonId = new mongoose.Types.ObjectId();
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-26"),
    validityEndDate: ksaDate("2026-08-26"),
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliverySlot: {
      type: "delivery",
      window: "13:00-15:00",
      slotId: "stacking-concurrency-slot",
      label: "13:00-15:00",
    },
    deliveryAddress: {
      city: "Riyadh",
      district: "Olaya",
      street: "Concurrency Test",
    },
    pickupLocationId: "legacy-pickup-location",
    skippedCount: 2,
    skipDaysUsed: 1,
    premiumBalance: [{
      premiumKey: "legacy-premium",
      purchasedQty: 4,
      consumedQty: 1,
      remainingQty: 3,
    }],
    addonSubscriptions: [{
      addonId,
      addonPlanId: addonId,
      category: "legacy-snack",
      includedTotalQty: 10,
      purchasedDailyQty: 1,
    }],
    addonBalance: [{
      addonId,
      addonPlanId: addonId,
      category: "legacy-snack",
      purchasedQty: 10,
      consumedQty: 2,
      remainingQty: 8,
    }],
  });
}

function operationalParentSnapshot(parent) {
  return {
    planId: String(parent.planId),
    startDate: parent.startDate.toISOString(),
    status: parent.status,
    selectedGrams: parent.selectedGrams,
    deliveryMode: parent.deliveryMode,
    deliveryWindow: parent.deliveryWindow,
    deliverySlot: parent.deliverySlot,
    deliveryAddress: parent.deliveryAddress,
    pickupLocationId: parent.pickupLocationId,
    skippedCount: parent.skippedCount,
    skipDaysUsed: parent.skipDaysUsed,
    premiumBalance: parent.premiumBalance,
    addonSubscriptions: parent.addonSubscriptions,
    addonBalance: parent.addonBalance,
  };
}

async function seedOperationalDays(container) {
  const mealId = new mongoose.Types.ObjectId();
  const addonId = container.addonBalance[0].addonId;
  return SubscriptionDay.create([
    {
      subscriptionId: container._id,
      date: "2026-08-04",
      status: "fulfilled",
      selections: [mealId],
      lockedSnapshot: { kitchenTicket: "legacy-ticket-4" },
      fulfilledSnapshot: { courierProof: "legacy-proof-4" },
      fulfilledAt: new Date("2026-08-04T18:00:00+03:00"),
      deliveryWindowOverride: "17:00-19:00",
      operationAuditLog: [{ action: "fulfilled", by: "legacy-ops" }],
    },
    {
      subscriptionId: container._id,
      date: "2026-08-08",
      status: "open",
      selections: [new mongoose.Types.ObjectId()],
      addonSelections: [{
        addonId,
        category: "legacy-snack",
        source: "subscription",
        qty: 1,
      }],
      premiumUpgradeSelections: [{
        baseSlotKey: "slot_1",
        premiumKey: "legacy-premium",
        source: "subscription",
        premiumSource: "balance",
      }],
      fulfillmentModeOverride: "pickup",
      pickupLocationIdOverride: "legacy-pickup-location",
      pickupRequested: true,
      pickupCode: "LEGACY08",
    },
  ]);
}

async function createPaidPurchase(container, suffix) {
  const planId = new mongoose.Types.ObjectId();
  const draft = await CheckoutDraft.create({
    userId: container.userId,
    planId,
    idempotencyKey: `stacking-concurrent-${suffix}`,
    requestHash: `stacking-concurrent-hash-${suffix}`,
    status: "pending_payment",
    daysCount: 26,
    grams: 150,
    mealsPerDay: 2,
    startDate: ksaDate("2026-08-06"),
    delivery: {
      type: "delivery",
      address: container.deliveryAddress,
      pickupLocationId: container.pickupLocationId,
      slot: { type: "delivery", window: "13:00-15:00", slotId: "", label: "" },
    },
    breakdown: {
      basePlanPriceHalala: 10000,
      basePlanGrossHalala: 10000,
      basePlanNetHalala: 8621,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      grossTotalHalala: 10000,
      discountHalala: 0,
      subtotalHalala: 8621,
      subtotalBeforeVatHalala: 8621,
      vatPercentage: 16,
      vatHalala: 1379,
      totalHalala: 10000,
      currency: "SAR",
    },
    contractSnapshot: {
      plan: {
        planId,
        daysCount: 26,
        mealsPerDay: 2,
        selectedGrams: 150,
        timelineExtraDays: 0,
      },
      start: { resolvedStartDate: ksaDate("2026-08-06") },
      pricing: {
        basePlanPriceHalala: 10000,
        basePlanGrossHalala: 10000,
        basePlanNetHalala: 8621,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        discountHalala: 0,
        subtotalHalala: 8621,
        subtotalBeforeVatHalala: 8621,
        vatPercentage: 16,
        vatHalala: 1379,
        totalPriceHalala: 10000,
        totalHalala: 10000,
        currency: "SAR",
      },
      delivery: {
        mode: "delivery",
        address: container.deliveryAddress,
        pickupLocationId: container.pickupLocationId,
        slot: {
          type: "delivery",
          window: "13:00-15:00",
          slotId: "stacking-concurrency-slot",
          label: "13:00-15:00",
        },
      },
    },
    contractHash: `stacking-concurrent-contract-${suffix}`,
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "additive_existing_parent",
      expectedParentSubscriptionId: container._id,
      decidedAt: new Date(),
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    amount: 10000,
    currency: "SAR",
    userId: container.userId,
    providerInvoiceId: `inv_stacking_concurrent_${suffix}`,
    metadata: {
      draftId: String(draft._id),
      userId: String(container.userId),
      paymentType: "subscription_activation",
    },
  });
  return {
    draft,
    payment,
    subscriptionPayload: {
      userId: container.userId,
      planId,
      status: "active",
      startDate: ksaDate("2026-08-06"),
      endDate: ksaDate("2026-08-31"),
      validityEndDate: ksaDate("2026-08-31"),
      totalMeals: 52,
      remainingMeals: 52,
      selectedMealsPerDay: 2,
      selectedGrams: 150,
      premiumBalance: [],
      addonSubscriptions: [],
      addonBalance: [],
      deliveryMode: "delivery",
      pickupLocationId: container.pickupLocationId,
      deliveryAddress: container.deliveryAddress,
      deliveryWindow: "13:00-15:00",
      deliverySlot: {
        type: "delivery",
        window: "13:00-15:00",
        slotId: "stacking-concurrency-slot",
        label: "13:00-15:00",
      },
      basePlanPriceHalala: 10000,
      discountHalala: 0,
      subtotalHalala: 8621,
      vatHalala: 1379,
      totalPriceHalala: 10000,
      checkoutCurrency: "SAR",
    },
  };
}

async function activateInTransaction(purchase) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const [draft, payment] = await Promise.all([
        CheckoutDraft.findById(purchase.draft._id).session(session),
        Payment.findById(purchase.payment._id).session(session),
      ]);
      result = await activatePaidDraftIntoExistingContainerTransactional({
        draft,
        payment,
        subscriptionPayload: purchase.subscriptionPayload,
        businessDate: "2026-08-06",
        expectedParentSubscriptionId: purchase.draft.stackingFinalization
          .expectedParentSubscriptionId,
        session,
      });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function applyPaidPurchaseThroughSharedDispatcher(purchase, source) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(purchase.payment._id).session(session);
      result = await applyPaymentSideEffects({ payment, session, source });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function testConcurrentDistinctPurchasesPreserveAggregateAndParent() {
  const container = await createContainer();
  const parentIdBefore = String(container._id);
  const parentOperationalBefore = operationalParentSnapshot(container.toObject());
  const seededDays = await seedOperationalDays(container);
  const dayIds = seededDays.map((day) => day._id);
  const daysBefore = await SubscriptionDay.find({ _id: { $in: dayIds } })
    .sort({ date: 1 })
    .lean();
  const [first, second] = await Promise.all([
    createPaidPurchase(container, `distinct-a-${container._id}`),
    createPaidPurchase(container, `distinct-b-${container._id}`),
  ]);

  const results = await Promise.all([
    activateInTransaction(first),
    activateInTransaction(second),
  ]);

  assert(results.every((result) => result.outcome === "stacked_into_existing_container"));
  assert(results.every((result) => String(result.container._id) === parentIdBefore));

  const [parent, batches, drafts, payments, activeCount, daysAfter] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.find({ containerSubscriptionId: container._id }).lean(),
    CheckoutDraft.find({ _id: { $in: [first.draft._id, second.draft._id] } }).lean(),
    Payment.find({ _id: { $in: [first.payment._id, second.payment._id] } }).lean(),
    Subscription.countDocuments({ userId: container.userId, status: "active" }),
    SubscriptionDay.find({ _id: { $in: dayIds } }).sort({ date: 1 }).lean(),
  ]);

  assert.strictEqual(String(parent._id), parentIdBefore);
  assert.deepStrictEqual(
    operationalParentSnapshot(parent),
    parentOperationalBefore,
    "stacking must not rewrite legacy operational subscription fields"
  );
  assert.deepStrictEqual(
    daysAfter,
    daysBefore,
    "stacking activation must preserve historical and future day operations"
  );
  assert.strictEqual(activeCount, 1);
  assert.strictEqual(batches.length, 3);
  assert.strictEqual(batches.filter((batch) => batch.sourceType === "legacy_seed").length, 1);
  assert.strictEqual(batches.filter((batch) => batch.sourceType === "checkout").length, 2);
  assert(batches.every((batch) => batch.applicationState === "applied"));
  assert(batches.every((batch) => batch.appliedAt instanceof Date));
  assert.strictEqual(parent.totalMeals, 182, JSON.stringify({
    resultMirrors: results.map((result) => ({
      totalMeals: result.container && result.container.totalMeals,
      remainingMeals: result.container && result.container.remainingMeals,
      selectedMealsPerDay: result.container && result.container.selectedMealsPerDay,
      purchaseSourceKey: result.purchaseBatch && result.purchaseBatch.sourceKey,
      idempotent: result.idempotent,
    })),
    parent: {
      totalMeals: parent.totalMeals,
      remainingMeals: parent.remainingMeals,
      selectedMealsPerDay: parent.selectedMealsPerDay,
    },
    batches: batches.map((batch) => ({
      sourceKey: batch.sourceKey,
      status: batch.status,
      totalMeals: batch.totalMeals,
      remainingMeals: batch.remainingMeals,
      applicationState: batch.applicationState,
    })),
  }));
  assert.strictEqual(parent.remainingMeals, 124);
  assert.strictEqual(parent.selectedMealsPerDay, 7);
  assert(drafts.every((draft) => String(draft.subscriptionId) === parentIdBefore));
  assert(payments.every((payment) => String(payment.subscriptionId) === parentIdBefore));
  assert(payments.every((payment) => payment.applied === true));
}

async function testConcurrentDuplicateFinalizationIsExactlyOnce() {
  const container = await createContainer();
  const purchase = await createPaidPurchase(container, `duplicate-${container._id}`);
  const results = await Promise.all([
    ...Array.from({ length: 10 }, () => activateInTransaction(purchase)),
  ]);

  assert(results.every((result) => result.outcome === "stacked_into_existing_container"));
  const [parent, batches, draft, payment] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.find({ containerSubscriptionId: container._id }).lean(),
    CheckoutDraft.findById(purchase.draft._id).lean(),
    Payment.findById(purchase.payment._id).lean(),
  ]);

  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches.filter((batch) => batch.sourceType === "checkout").length, 1);
  assert(batches.every((batch) => batch.applicationState === "applied"));
  assert.strictEqual(parent.totalMeals, 130);
  assert.strictEqual(parent.remainingMeals, 72);
  assert.strictEqual(parent.selectedMealsPerDay, 5);
  assert.strictEqual(String(draft.subscriptionId), String(container._id));
  assert.strictEqual(String(payment.subscriptionId), String(container._id));
  assert.strictEqual(payment.applied, true);
}

async function testReplayCountsRemainExactlyOnce() {
  for (const replayCount of [1, 2, 10]) {
    const container = await createContainer();
    const purchase = await createPaidPurchase(
      container,
      `replay-${replayCount}-${container._id}`
    );
    const results = await Promise.all(
      Array.from({ length: replayCount }, () => activateInTransaction(purchase))
    );
    assert.strictEqual(results.length, replayCount);
    assert(results.every((result) =>
      result.outcome === "stacked_into_existing_container"));

    const [parent, checkoutBatchCount] = await Promise.all([
      Subscription.findById(container._id).lean(),
      SubscriptionEntitlementBatch.countDocuments({
        containerSubscriptionId: container._id,
        sourceType: "checkout",
      }),
    ]);
    assert.strictEqual(checkoutBatchCount, 1);
    assert.strictEqual(parent.totalMeals, 130);
    assert.strictEqual(parent.remainingMeals, 72);
  }
}

async function testFiveConcurrentDistinctPurchasesAreAllPreserved() {
  const container = await createContainer();
  const purchases = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      createPaidPurchase(container, `five-${index}-${container._id}`))
  );
  const results = await Promise.all(
    purchases.map((purchase) => activateInTransaction(purchase))
  );
  assert(results.every((result) =>
    result.outcome === "stacked_into_existing_container"));

  const [parent, batches, activeCount] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.find({
      containerSubscriptionId: container._id,
    }).lean(),
    Subscription.countDocuments({ userId: container.userId, status: "active" }),
  ]);
  assert.strictEqual(activeCount, 1);
  assert.strictEqual(batches.length, 6);
  assert.strictEqual(
    batches.filter((batch) => batch.sourceType === "checkout").length,
    5
  );
  assert.strictEqual(parent.totalMeals, 338);
  assert.strictEqual(parent.remainingMeals, 280);
  assert.strictEqual(parent.selectedMealsPerDay, 13);
}

async function testWebhookReplayAndVerifyRaceApplyExactlyOnce() {
  const container = await createContainer();
  const purchase = await createPaidPurchase(
    container,
    `webhook-verify-race-${container._id}`
  );
  process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
  process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
  process.env.SUBSCRIPTION_STACKING_USER_IDS = String(container.userId);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      applyPaidPurchaseThroughSharedDispatcher(
        purchase,
        index % 2 === 0 ? "webhook" : "verify"
      ))
  );
  assert(results.every((result) => result && result.applied === true));

  const [parent, checkoutBatchCount, draft, payment] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.countDocuments({
      containerSubscriptionId: container._id,
      sourceType: "checkout",
    }),
    CheckoutDraft.findById(purchase.draft._id).lean(),
    Payment.findById(purchase.payment._id).lean(),
  ]);
  assert.strictEqual(checkoutBatchCount, 1);
  assert.strictEqual(parent.totalMeals, 130);
  assert.strictEqual(parent.remainingMeals, 72);
  assert.strictEqual(String(draft.subscriptionId), String(container._id));
  assert.strictEqual(String(payment.subscriptionId), String(container._id));
  assert.strictEqual(payment.applied, true);
}

async function testTransientFailureRollsBackAndRetryAppliesOnce() {
  const container = await createContainer();
  const purchase = await createPaidPurchase(
    container,
    `transient-retry-${container._id}`
  );
  const session = await mongoose.startSession();
  try {
    await assert.rejects(
      () => session.withTransaction(async () => {
        const [draft, payment] = await Promise.all([
          CheckoutDraft.findById(purchase.draft._id).session(session),
          Payment.findById(purchase.payment._id).session(session),
        ]);
        await activatePaidDraftIntoExistingContainerTransactional({
          draft,
          payment,
          subscriptionPayload: purchase.subscriptionPayload,
          businessDate: "2026-08-06",
          expectedParentSubscriptionId: container._id,
          session,
        });
        const error = new Error("simulated transient failure before commit");
        error.code = "SIMULATED_TRANSIENT_FAILURE";
        throw error;
      }),
      (err) => Boolean(err && err.code === "SIMULATED_TRANSIENT_FAILURE")
    );
  } finally {
    await session.endSession();
  }

  const [afterFailureParent, failedBatchCount, failedDraft, failedPayment] =
    await Promise.all([
      Subscription.findById(container._id).lean(),
      SubscriptionEntitlementBatch.countDocuments({
        containerSubscriptionId: container._id,
      }),
      CheckoutDraft.findById(purchase.draft._id).lean(),
      Payment.findById(purchase.payment._id).lean(),
    ]);
  assert.strictEqual(failedBatchCount, 0);
  assert.strictEqual(afterFailureParent.totalMeals, 78);
  assert.strictEqual(afterFailureParent.remainingMeals, 20);
  assert.strictEqual(failedDraft.status, "pending_payment");
  assert.strictEqual(failedDraft.subscriptionId, undefined);
  assert.strictEqual(failedPayment.applied, false);
  assert.strictEqual(failedPayment.subscriptionId, undefined);

  const retry = await activateInTransaction(purchase);
  assert.strictEqual(retry.outcome, "stacked_into_existing_container");
  const [afterRetryParent, retryCheckoutBatchCount] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.countDocuments({
      containerSubscriptionId: container._id,
      sourceType: "checkout",
    }),
  ]);
  assert.strictEqual(afterRetryParent.totalMeals, 130);
  assert.strictEqual(afterRetryParent.remainingMeals, 72);
  assert.strictEqual(retryCheckoutBatchCount, 1);
}

async function run() {
  await connect();
  try {
    await testConcurrentDistinctPurchasesPreserveAggregateAndParent();
    await testConcurrentDuplicateFinalizationIsExactlyOnce();
    await testReplayCountsRemainExactlyOnce();
    await testFiveConcurrentDistinctPurchasesAreAllPreserved();
    await testWebhookReplayAndVerifyRaceApplyExactlyOnce();
    await testTransientFailureRollsBackAndRetryAppliesOnce();
    console.log("subscription stacking concurrent purchase integration tests passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    await disconnect();
  } catch (_) {
    // Best-effort cleanup only.
  }
  process.exitCode = 1;
});
