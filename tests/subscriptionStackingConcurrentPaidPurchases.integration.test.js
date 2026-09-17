"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const {
  applyPaidDraftToSubscriptionStackTransactional,
} = require("../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService");

const BUSINESS_DATE = "2026-08-01";
const START_DATE = new Date("2026-08-01T00:00:00.000Z");
const INITIAL_MEALS = 7;

function addDays(date, days) {
  return new Date(date.getTime() + Number(days) * 86400000);
}

function activationPayloadForDraft(draft) {
  const daysCount = Number(draft.daysCount);
  const mealsPerDay = Number(draft.mealsPerDay);
  const startDate = new Date(draft.startDate || START_DATE);
  const endDate = addDays(startDate, daysCount - 1);
  return {
    subscriptionPayload: {
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: daysCount * mealsPerDay,
      selectedMealsPerDay: mealsPerDay,
      selectedGrams: Number(draft.grams),
      deliveryMode: "pickup",
      pickupLocationId: "race-test-branch",
      deliverySlot: {
        type: "pickup",
        window: "",
        slotId: "race-test-pickup",
        label: "Race test pickup",
      },
      premiumBalance: [],
      addonSubscriptions: [],
      addonBalance: [],
      checkoutCurrency: "SAR",
    },
  };
}

async function clearScenarioData() {
  await Promise.all([
    SubscriptionDay.deleteMany({}),
    SubscriptionEntitlementBatch.deleteMany({}),
    CheckoutDraft.deleteMany({}),
    Payment.deleteMany({}),
    Subscription.deleteMany({}),
  ]);
}

async function createContainer({ userId, planId }) {
  return Subscription.create({
    userId,
    planId,
    status: "active",
    startDate: START_DATE,
    endDate: addDays(START_DATE, INITIAL_MEALS - 1),
    validityEndDate: addDays(START_DATE, INITIAL_MEALS - 1),
    totalMeals: INITIAL_MEALS,
    remainingMeals: INITIAL_MEALS,
    selectedGrams: 150,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: "race-test-branch",
    deliverySlot: {
      type: "pickup",
      window: "",
      slotId: "race-test-pickup",
      label: "Race test pickup",
    },
  });
}

async function createPaidPurchase({
  userId,
  planId,
  parentSubscriptionId,
  label,
  daysCount,
  grams,
}) {
  const draft = await CheckoutDraft.create({
    userId,
    planId,
    idempotencyKey: `stacking-race-${label}-${new mongoose.Types.ObjectId()}`,
    requestHash: `stacking-race-hash-${label}-${new mongoose.Types.ObjectId()}`,
    status: "pending_payment",
    daysCount,
    grams,
    mealsPerDay: 1,
    startDate: START_DATE,
    delivery: {
      type: "pickup",
      pickupLocationId: "race-test-branch",
      slot: {
        type: "pickup",
        window: "",
        slotId: "race-test-pickup",
        label: "Race test pickup",
      },
    },
    premiumItems: [],
    addonSubscriptions: [],
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "additive_existing_parent",
      expectedParentSubscriptionId: parentSubscriptionId,
      decidedAt: new Date(),
    },
    breakdown: {
      basePlanPriceHalala: daysCount * 1000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      grossTotalHalala: daysCount * 1000,
      discountHalala: 0,
      subtotalHalala: daysCount * 1000,
      subtotalBeforeVatHalala: daysCount * 1000,
      vatPercentage: 0,
      vatHalala: 0,
      totalHalala: daysCount * 1000,
      currency: "SAR",
    },
  });

  const payment = await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: daysCount * 1000,
    currency: "SAR",
    userId,
    checkoutDraftId: draft._id,
    applied: false,
    paidAt: new Date(),
    method: "cash",
    source: "stacking_concurrency_regression",
  });

  draft.paymentId = payment._id;
  await draft.save();
  return { draft, payment, daysCount, grams };
}

async function applyPurchase({ purchase, containerId, runtime = {} }) {
  const draft = await CheckoutDraft.findById(purchase.draft._id);
  const payment = await Payment.findById(purchase.payment._id);
  return applyPaidDraftToSubscriptionStackTransactional({
    draft,
    payment,
    businessDate: BUSINESS_DATE,
    expectedParentSubscriptionId: containerId,
    session: null,
    runtime: {
      buildActivationPayload: ({ draft: currentDraft }) => activationPayloadForDraft(currentDraft),
      ...runtime,
    },
  });
}

function blockingPrepareRuntime({ onEntered, waitUntilReleased }) {
  return {
    async prepareStandalonePayment({ paymentId, containerId, draftId, session }) {
      const prepared = await Payment.findOneAndUpdate(
        { _id: paymentId, status: "paid" },
        {
          $set: {
            applied: false,
            subscriptionId: containerId,
            checkoutDraftId: draftId,
          },
        },
        { new: true, session }
      );
      onEntered();
      await waitUntilReleased;
      return prepared;
    },
  };
}

async function assertScenarioState({ containerId, purchases, expectedPurchaseMeals }) {
  const container = await Subscription.findById(containerId).lean();
  assert(container, "container subscription must still exist");
  assert.strictEqual(container.status, "active");
  assert.strictEqual(container.totalMeals, INITIAL_MEALS + expectedPurchaseMeals);
  assert.strictEqual(container.remainingMeals, INITIAL_MEALS + expectedPurchaseMeals);

  const batches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: containerId,
  }).lean();
  const purchaseBatches = batches.filter((batch) => batch.sourceType !== "legacy_seed");
  assert.strictEqual(batches.filter((batch) => batch.sourceType === "legacy_seed").length, 1);
  assert.strictEqual(purchaseBatches.length, purchases.length);
  assert.strictEqual(
    purchaseBatches.reduce((sum, batch) => sum + Number(batch.totalMeals || 0), 0),
    expectedPurchaseMeals
  );

  const expectedSourceKeys = purchases
    .map((purchase) => `payment:${String(purchase.payment._id)}`)
    .sort();
  const actualSourceKeys = purchaseBatches.map((batch) => batch.sourceKey).sort();
  assert.deepStrictEqual(actualSourceKeys, expectedSourceKeys);
  assert.strictEqual(new Set(actualSourceKeys).size, purchases.length);

  for (const purchase of purchases) {
    const payment = await Payment.findById(purchase.payment._id).lean();
    assert(payment, "paid payment must still exist");
    assert.strictEqual(payment.status, "paid");
    assert.strictEqual(payment.applied, true);
    assert.strictEqual(String(payment.subscriptionId), String(containerId));
    assert.strictEqual(String(payment.checkoutDraftId), String(purchase.draft._id));

    const draft = await CheckoutDraft.findById(purchase.draft._id).lean();
    assert(draft, "checkout draft must still exist");
    assert.strictEqual(draft.status, "completed");
    assert.strictEqual(String(draft.subscriptionId), String(containerId));
    assert.strictEqual(String(draft.activationSubscriptionId), String(containerId));
  }

  const days = await SubscriptionDay.find({ subscriptionId: containerId }).lean();
  const uniqueDates = new Set(days.map((day) => day.date));
  assert.strictEqual(uniqueDates.size, days.length, "materialized subscription days must not duplicate");
  assert.strictEqual(
    days.length,
    Math.max(...purchases.map((purchase) => purchase.daysCount)),
    "overlapping purchase windows should share day documents without losing entitlements"
  );
}

async function runLeaseCollisionScenario({ name, purchaseSpecs }) {
  await clearScenarioData();

  const userId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const container = await createContainer({ userId, planId });
  const purchases = [];
  for (let index = 0; index < purchaseSpecs.length; index += 1) {
    const spec = purchaseSpecs[index];
    purchases.push(await createPaidPurchase({
      userId,
      planId,
      parentSubscriptionId: container._id,
      label: `${name}-${index}`,
      daysCount: spec.daysCount,
      grams: spec.grams,
    }));
  }

  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  let releaseResolve;
  const released = new Promise((resolve) => { releaseResolve = resolve; });

  const firstPromise = applyPurchase({
    purchase: purchases[0],
    containerId: container._id,
    runtime: blockingPrepareRuntime({
      onEntered: enteredResolve,
      waitUntilReleased: released,
    }),
  });

  await entered;

  await assert.rejects(
    () => applyPurchase({
      purchase: purchases[1],
      containerId: container._id,
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_ACTIVATION_BUSY"
      && err.retryableStandalone === true
      && err.details
      && err.details.retryable === true
    ),
    "the competing paid purchase must fail retryably while the lease is held"
  );

  releaseResolve();
  const firstResult = await firstPromise;
  assert.strictEqual(firstResult.applied, true);
  assert.strictEqual(firstResult.standaloneSaga, true);

  const secondResult = await applyPurchase({
    purchase: purchases[1],
    containerId: container._id,
  });
  assert.strictEqual(secondResult.applied, true);
  assert.strictEqual(secondResult.standaloneSaga, true);

  const replayFirst = await applyPurchase({
    purchase: purchases[0],
    containerId: container._id,
  });
  assert.strictEqual(replayFirst.applied, true);
  assert.strictEqual(replayFirst.idempotent, true, "replaying the same paid purchase must be idempotent");

  const replaySecond = await applyPurchase({
    purchase: purchases[1],
    containerId: container._id,
  });
  assert.strictEqual(replaySecond.applied, true);
  assert.strictEqual(replaySecond.idempotent, true, "replaying the second paid purchase must be idempotent");

  await assertScenarioState({
    containerId: container._id,
    purchases,
    expectedPurchaseMeals: purchaseSpecs.reduce((sum, spec) => sum + spec.daysCount, 0),
  });
}

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URI_TEST;
  if (!uri) {
    throw new Error("MONGODB_URI, MONGO_URI, or MONGO_URI_TEST is required for stacking concurrency regression");
  }

  await mongoose.connect(uri, {
    dbName: `basicdiet_stacking_concurrency_${Date.now()}_${process.pid}`,
  });

  await Promise.all([
    Subscription.syncIndexes(),
    SubscriptionDay.syncIndexes(),
    SubscriptionEntitlementBatch.syncIndexes(),
    CheckoutDraft.syncIndexes(),
    Payment.syncIndexes(),
  ]);

  await runLeaseCollisionScenario({
    name: "different-packages",
    purchaseSpecs: [
      { daysCount: 30, grams: 200 },
      { daysCount: 14, grams: 150 },
    ],
  });

  await runLeaseCollisionScenario({
    name: "same-package-twice",
    purchaseSpecs: [
      { daysCount: 14, grams: 150 },
      { daysCount: 14, grams: 150 },
    ],
  });

  console.log("subscription stacking concurrent paid purchase regression tests passed");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
