"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
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
  });
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
    contractHash: `stacking-concurrent-contract-${suffix}`,
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
        session,
      });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function testConcurrentDistinctPurchasesPreserveAggregateAndParent() {
  const container = await createContainer();
  const parentIdBefore = String(container._id);
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

  const [parent, batches, drafts, payments, activeCount] = await Promise.all([
    Subscription.findById(container._id).lean(),
    SubscriptionEntitlementBatch.find({ containerSubscriptionId: container._id }).lean(),
    CheckoutDraft.find({ _id: { $in: [first.draft._id, second.draft._id] } }).lean(),
    Payment.find({ _id: { $in: [first.payment._id, second.payment._id] } }).lean(),
    Subscription.countDocuments({ userId: container.userId, status: "active" }),
  ]);

  assert.strictEqual(String(parent._id), parentIdBefore);
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
    activateInTransaction(purchase),
    activateInTransaction(purchase),
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

async function run() {
  await connect();
  try {
    await testConcurrentDistinctPurchasesPreserveAggregateAndParent();
    await testConcurrentDuplicateFinalizationIsExactlyOnce();
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
