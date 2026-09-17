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
const SubscriptionExtraEntitlementBucket = require("../src/models/SubscriptionExtraEntitlementBucket");
const SubscriptionExtraEntitlementAllocation = require("../src/models/SubscriptionExtraEntitlementAllocation");
const {
  applyPaymentSideEffects,
} = require("../src/services/paymentApplicationService");
const {
  activatePaidDraftIntoExistingContainerTransactional,
  activatePinnedExtrasPaidDraftIntoExistingContainerTransactional,
} = require("../src/services/subscription/subscriptionStackingActivationService");
const {
  applyPinnedExtrasPaidDraftToSubscriptionStackTransactional,
} = require("../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService");
const {
  buildPinnedExtraActivationSnapshot,
  normalizePinnedExtraActivationSnapshot,
} = require("../src/services/subscription/subscriptionStackingExtraActivationAuthorityService");
const {
  ensureExtraBucketsForBatch,
  projectExtraEntitlements,
} = require("../src/services/subscription/subscriptionExtraEntitlementBucketService");
const {
  runMongoTransactionWithRetry,
} = require("../src/services/mongoTransactionRetryService");

let replSet;
let sequence = 0;

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: "subscription_stacking_extra_activation_p2",
    autoIndex: false,
  });
  for (const model of [
    CheckoutDraft,
    Payment,
    Subscription,
    SubscriptionDay,
    SubscriptionEntitlementBatch,
    SubscriptionExtraEntitlementBucket,
    SubscriptionExtraEntitlementAllocation,
  ]) {
    await model.createCollection().catch((err) => {
      if (err.codeName !== "NamespaceExists") throw err;
    });
    await model.syncIndexes();
  }
}

async function disconnect() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function clearDatabase() {
  await Promise.all([
    CheckoutDraft.deleteMany({}),
    Payment.deleteMany({}),
    Subscription.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    SubscriptionEntitlementBatch.deleteMany({}),
    SubscriptionExtraEntitlementBucket.deleteMany({}),
    SubscriptionExtraEntitlementAllocation.deleteMany({}),
    mongoose.connection.collection("plans").deleteMany({}),
  ]);
}

function addonRow({ name, qty, category }) {
  const addonId = new mongoose.Types.ObjectId();
  return {
    addonId,
    addonPlanId: addonId,
    name,
    addonPlanName: name,
    category,
    allowanceCategory: category,
    displayKey: category,
    displayCategory: category,
    entitlementKey: `${category}:${addonId}`,
    quantityPerDay: 1,
    purchasedDailyQty: 1,
    includedTotalQty: qty,
    unitPlanPriceHalala: 125,
    unitPriceHalala: 125,
    totalHalala: qty * 125,
    currency: "SAR",
  };
}

async function createFixture({
  premiumQty = 0,
  addons = [],
  future = false,
  historicalParentExtras = false,
} = {}) {
  sequence += 1;
  const userId = new mongoose.Types.ObjectId();
  const oldPlanId = new mongoose.Types.ObjectId();
  const newPlanId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection("plans").insertOne({
    _id: newPlanId,
    mutablePremiumQuantity: premiumQty,
    mutableAddonQuantities: addons.map((row) => row.includedTotalQty),
  });
  const legacyAddonId = new mongoose.Types.ObjectId();
  const container = await Subscription.create({
    userId,
    planId: oldPlanId,
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
      slotId: "p2-slot",
      label: "13:00-15:00",
    },
    deliveryAddress: { city: "Riyadh", district: "Test", street: "P2" },
    premiumBalance: historicalParentExtras ? [{
      premiumKey: "historical-only",
      purchasedQty: 9,
      remainingQty: 9,
    }] : [],
    addonSubscriptions: historicalParentExtras ? [{
      addonId: legacyAddonId,
      addonPlanId: legacyAddonId,
      category: "historical-addon",
      includedTotalQty: 7,
      purchasedDailyQty: 1,
    }] : [],
    addonBalance: historicalParentExtras ? [{
      addonId: legacyAddonId,
      addonPlanId: legacyAddonId,
      category: "historical-addon",
      purchasedQty: 7,
      remainingQty: 7,
    }] : [],
  });

  const premiumItems = premiumQty > 0 ? [{
    premiumKey: "premium_shrimp",
    qty: premiumQty,
    unitExtraFeeHalala: 250,
    totalHalala: premiumQty * 250,
    currency: "SAR",
  }] : [];
  const extraEntitlements = buildPinnedExtraActivationSnapshot({
    premiumItems,
    addonSubscriptions: addons,
    daysCount: 26,
  });
  const startDate = future ? ksaDate("2026-09-10") : ksaDate("2026-08-06");
  const endDate = future ? ksaDate("2026-10-05") : ksaDate("2026-08-31");
  const draft = await CheckoutDraft.create({
    userId,
    planId: newPlanId,
    idempotencyKey: `p2-${sequence}`,
    requestHash: `p2-hash-${sequence}`,
    status: "pending_payment",
    daysCount: 26,
    grams: 150,
    mealsPerDay: 2,
    startDate,
    delivery: {
      type: "delivery",
      address: container.deliveryAddress,
      slot: { type: "delivery", window: "13:00-15:00", slotId: "p2-slot" },
    },
    premiumItems,
    addonSubscriptions: addons,
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: premiumQty * 250,
      addonsTotalHalala: addons.reduce((sum, row) => sum + row.totalHalala, 0),
      deliveryFeeHalala: 0,
      vatHalala: 0,
      totalHalala: 10000 + premiumQty * 250
        + addons.reduce((sum, row) => sum + row.totalHalala, 0),
      currency: "SAR",
    },
    contractHash: `p2-contract-${sequence}`,
    contractSnapshot: {
      plan: { planId: newPlanId, daysCount: 26, mealsPerDay: 2, selectedGrams: 150 },
      start: { resolvedStartDate: startDate },
      pricing: { premiumTotalHalala: premiumQty * 250, currency: "SAR" },
    },
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "additive_existing_parent",
      expectedParentSubscriptionId: container._id,
      decidedAt: new Date(),
      extraEntitlements,
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    applied: false,
    amount: draft.breakdown.totalHalala,
    currency: "SAR",
    userId,
    providerInvoiceId: `inv_p2_${sequence}`,
    metadata: { draftId: String(draft._id), userId: String(userId) },
  });
  const subscriptionPayload = {
    userId,
    planId: newPlanId,
    startDate,
    endDate,
    validityEndDate: endDate,
    totalMeals: 52,
    remainingMeals: 52,
    selectedMealsPerDay: 2,
    selectedGrams: 150,
    deliveryMode: "delivery",
    deliveryAddress: container.deliveryAddress,
    deliveryWindow: "13:00-15:00",
    deliverySlot: { type: "delivery", window: "13:00-15:00", slotId: "p2-slot" },
    premiumBalance: premiumItems.map((row) => ({
      ...row,
      purchasedQty: row.qty,
      remainingQty: row.qty,
    })),
    addonSubscriptions: addons,
    addonBalance: extraEntitlements.addons.balances,
    checkoutCurrency: "SAR",
  };
  return { container, draft, payment, subscriptionPayload, extraEntitlements };
}

async function applyFixture(fixture, {
  activationRuntime = null,
  mutateDraft = null,
  source = null,
  maxRetries = 12,
} = {}) {
  return runMongoTransactionWithRetry(async (session) => {
    const [draft, payment] = await Promise.all([
      CheckoutDraft.findById(fixture.draft._id).session(session),
      Payment.findById(fixture.payment._id).session(session),
    ]);
    if (mutateDraft) mutateDraft(draft);
    const serviceArgs = {
      draft,
      payment,
      businessDate: "2026-08-06",
      expectedParentSubscriptionId: fixture.container._id,
      session,
      runtime: {
        buildActivationPayload: async () => ({
          subscriptionPayload: fixture.subscriptionPayload,
        }),
        ...(activationRuntime ? {
          activateIntoContainer: (args) => (
            activatePinnedExtrasPaidDraftIntoExistingContainerTransactional({
              ...args,
              runtime: activationRuntime,
            })
          ),
        } : {}),
      },
    };
    if (!source) {
      return applyPinnedExtrasPaidDraftToSubscriptionStackTransactional(serviceArgs);
    }
    return applyPaymentSideEffects(
      { payment, session, source },
      {
        findDraftById: async () => draft,
        finalizeSubscriptionDraftPaymentFlow: () => (
          applyPinnedExtrasPaidDraftToSubscriptionStackTransactional(serviceArgs)
        ),
      }
    );
  }, {
    label: `p2_extra_activation_${source || "internal"}`,
    maxRetries,
    baseDelayMs: 1,
  });
}

async function purchaseState(fixture) {
  const purchaseBatch = await SubscriptionEntitlementBatch.findOne({
    checkoutDraftId: fixture.draft._id,
  }).lean();
  const buckets = purchaseBatch
    ? await SubscriptionExtraEntitlementBucket.find({ entitlementBatchId: purchaseBatch._id })
      .sort({ kind: 1, walletKey: 1 }).lean()
    : [];
  return {
    purchaseBatch,
    buckets,
    parent: await Subscription.findById(fixture.container._id).lean(),
    draft: await CheckoutDraft.findById(fixture.draft._id).lean(),
    payment: await Payment.findById(fixture.payment._id).lean(),
    days: await SubscriptionDay.countDocuments({ subscriptionId: fixture.container._id }),
    batchCount: await SubscriptionEntitlementBatch.countDocuments({
      containerSubscriptionId: fixture.container._id,
    }),
    allocationCount: await SubscriptionExtraEntitlementAllocation.countDocuments({
      containerSubscriptionId: fixture.container._id,
    }),
  };
}

function assertConservation(bucket) {
  assert.strictEqual(
    bucket.remainingQty + bucket.reservedQty + bucket.consumedQty + bucket.forfeitedQty,
    bucket.purchasedQty
  );
}

async function testPremiumAddonMixedAndZeroRegression() {
  await clearDatabase();
  const premium = await createFixture({ premiumQty: 4 });
  await applyFixture(premium);
  const premiumState = await purchaseState(premium);
  assert.strictEqual(premiumState.buckets.length, 1);
  assert.strictEqual(premiumState.buckets[0].kind, "premium");
  assert.strictEqual(premiumState.buckets[0].purchasedQty, 4);
  assert.deepStrictEqual(
    [premiumState.buckets[0].remainingQty, premiumState.buckets[0].reservedQty,
      premiumState.buckets[0].consumedQty, premiumState.buckets[0].forfeitedQty],
    [4, 0, 0, 0]
  );
  assert.strictEqual(String(premiumState.buckets[0].entitlementBatchId), String(premiumState.purchaseBatch._id));
  assert.strictEqual(String(premiumState.buckets[0].paymentId), String(premium.payment._id));
  assert.strictEqual(String(premiumState.buckets[0].checkoutDraftId), String(premium.draft._id));
  assertConservation(premiumState.buckets[0]);

  const addon = await createFixture({ addons: [addonRow({ name: "Salad", qty: 10, category: "salad" })] });
  await applyFixture(addon);
  const addonState = await purchaseState(addon);
  assert.strictEqual(addonState.buckets.length, 1);
  assert.strictEqual(addonState.buckets[0].kind, "addon");
  assert.strictEqual(addonState.buckets[0].purchasedQty, 10);
  assert(addonState.buckets[0].addonPlanId);
  assert(addonState.buckets[0].addonId);
  assert.strictEqual(addonState.buckets[0].category, "salad");
  assert.strictEqual(
    String(addonState.buckets[0].balanceBucketId),
    String(addon.extraEntitlements.addons.balances[0].balanceBucketId)
  );
  assert.strictEqual(
    addonState.buckets[0].metadata.sourceBalanceBucketId,
    String(addon.extraEntitlements.addons.balances[0].balanceBucketId)
  );
  assertConservation(addonState.buckets[0]);

  const mixed = await createFixture({
    premiumQty: 4,
    addons: [
      addonRow({ name: "Salad", qty: 10, category: "salad" }),
      addonRow({ name: "Juice", qty: 6, category: "juice" }),
    ],
  });
  await applyFixture(mixed);
  const mixedState = await purchaseState(mixed);
  assert.strictEqual(mixedState.batchCount, 2);
  assert.strictEqual(mixedState.buckets.length, 3);
  assert.deepStrictEqual(mixedState.buckets.map((row) => row.purchasedQty).sort((a, b) => a - b), [4, 6, 10]);
  assert.strictEqual(new Set(mixedState.buckets.map((row) => row.walletKey)).size, 3);
  assert.strictEqual(mixedState.allocationCount, 0);

  const zero = await createFixture();
  const before = {
    totalMeals: zero.container.totalMeals,
    remainingMeals: zero.container.remainingMeals,
  };
  await applyFixture(zero);
  const zeroState = await purchaseState(zero);
  assert.strictEqual(zeroState.buckets.length, 0);
  assert.strictEqual(zeroState.allocationCount, 0);
  assert.strictEqual(zeroState.purchaseBatch.totalMeals, 52);
  assert.strictEqual(zeroState.purchaseBatch.remainingMeals, 52);
  assert.strictEqual(zeroState.parent.totalMeals, before.totalMeals + 52);
  assert.strictEqual(zeroState.parent.remainingMeals, before.remainingMeals + 52);
  assert.strictEqual(zeroState.days, 26);
  assert.strictEqual(zeroState.payment.applied, true);
  assert.strictEqual(zeroState.draft.status, "completed");
}

async function testReplayAndFirstCommitConcurrency() {
  await clearDatabase();
  const replay = await createFixture({
    premiumQty: 4,
    addons: [addonRow({ name: "Salad", qty: 10, category: "salad" })],
  });
  await applyFixture(replay);
  const premiumBucket = await SubscriptionExtraEntitlementBucket.findOne({ kind: "premium" });
  premiumBucket.remainingQty = 3;
  premiumBucket.consumedQty = 1;
  await premiumBucket.save();
  for (let index = 0; index < 9; index += 1) await applyFixture(replay);
  const replayState = await purchaseState(replay);
  assert.strictEqual(replayState.batchCount, 2);
  assert.strictEqual(replayState.buckets.length, 2);
  const replayPremium = replayState.buckets.find((row) => row.kind === "premium");
  assert.deepStrictEqual(
    [replayPremium.purchasedQty, replayPremium.remainingQty, replayPremium.consumedQty],
    [4, 3, 1]
  );
  assert.strictEqual(replayState.days, 26);

  await clearDatabase();
  const concurrent = await createFixture({
    premiumQty: 4,
    addons: [
      addonRow({ name: "Salad", qty: 10, category: "salad" }),
      addonRow({ name: "Juice", qty: 6, category: "juice" }),
    ],
  });
  await Promise.all(Array.from({ length: 20 }, () => applyFixture(concurrent, { maxRetries: 30 })));
  const concurrentState = await purchaseState(concurrent);
  assert.strictEqual(concurrentState.batchCount, 2);
  assert.strictEqual(concurrentState.buckets.length, 3);
  assert.strictEqual(concurrentState.days, 26);
  assert.strictEqual(concurrentState.payment.applied, true);
  assert.strictEqual(await Subscription.countDocuments({ userId: concurrent.container.userId, status: "active" }), 1);
}

async function testWebhookVerifySharedRace() {
  await clearDatabase();
  const fixture = await createFixture({
    premiumQty: 4,
    addons: [addonRow({ name: "Salad", qty: 10, category: "salad" })],
  });
  await Promise.all(Array.from({ length: 20 }, (_, index) => (
    applyFixture(fixture, {
      source: index % 2 === 0 ? "webhook" : "api_verify",
      maxRetries: 30,
    })
  )));
  const state = await purchaseState(fixture);
  assert.strictEqual(state.batchCount, 2);
  assert.strictEqual(state.buckets.length, 2);
  assert.strictEqual(state.days, 26);
  assert.strictEqual(state.payment.applied, true);
}

async function assertRolledBack(fixture) {
  const state = await purchaseState(fixture);
  assert.strictEqual(state.purchaseBatch, null);
  assert.strictEqual(state.buckets.length, 0);
  assert.strictEqual(state.batchCount, 0);
  assert.strictEqual(state.days, 0);
  assert.strictEqual(state.payment.applied, false);
  assert.strictEqual(state.draft.status, "pending_payment");
  assert.strictEqual(state.parent.totalMeals, 78);
  assert.strictEqual(state.parent.remainingMeals, 20);
}

async function testFailureRollbackAndRetry() {
  for (const point of ["before_seed", "during_seed", "after_seed"]) {
    await clearDatabase();
    const fixture = await createFixture({
      premiumQty: 4,
      addons: [addonRow({ name: "Salad", qty: 10, category: "salad" })],
    });
    let upserts = 0;
    const activationRuntime = point === "before_seed"
      ? {
        seedExtraBuckets: async () => {
          const err = new Error("injected before seed");
          err.code = "P2_INJECT_BEFORE_SEED";
          throw err;
        },
      }
      : point === "during_seed"
        ? {
          seedExtraBuckets: (args) => ensureExtraBucketsForBatch({
            ...args,
            runtime: {
              upsertBucket: async (payload, { session }) => {
                upserts += 1;
                if (upserts === 2) {
                  const err = new Error("injected during seed");
                  err.code = "P2_INJECT_DURING_SEED";
                  throw err;
                }
                return SubscriptionExtraEntitlementBucket.updateOne(
                  {
                    entitlementBatchId: payload.entitlementBatchId,
                    kind: payload.kind,
                    walletKey: payload.walletKey,
                  },
                  { $setOnInsert: payload },
                  { upsert: true, session }
                );
              },
              findBuckets: (batchId, { session }) => (
                SubscriptionExtraEntitlementBucket.find({ entitlementBatchId: batchId })
                  .sort({ kind: 1, walletKey: 1 }).session(session).lean()
              ),
            },
          }),
        }
        : {
          updateContainer: async ({ containerId, update, session }) => {
            await Subscription.updateOne({ _id: containerId }, { $set: update }, { session });
            const err = new Error("injected after seed");
            err.code = "P2_INJECT_AFTER_SEED";
            throw err;
          },
        };
    await assert.rejects(
      () => applyFixture(fixture, { activationRuntime, maxRetries: 0 }),
      (err) => Boolean(err && String(err.code || "").startsWith("P2_INJECT_"))
    );
    await assertRolledBack(fixture);
    await applyFixture(fixture);
    const retried = await purchaseState(fixture);
    assert.strictEqual(retried.buckets.length, 2);
    assert.strictEqual(retried.batchCount, 2);
    assert.strictEqual(retried.payment.applied, true);
    assert.strictEqual(retried.draft.status, "completed");
  }
}

async function testFutureImmutabilityHistoricalAndMalformed() {
  await clearDatabase();
  const future = await createFixture({ premiumQty: 4, future: true });
  await applyFixture(future);
  const futureState = await purchaseState(future);
  assert.strictEqual(futureState.purchaseBatch.status, "paid_scheduled");
  assert.strictEqual(
    futureState.buckets[0].effectiveStartDate.getTime(),
    futureState.purchaseBatch.effectiveStartDate.getTime()
  );
  assert.strictEqual(
    futureState.buckets[0].validityEndDate.getTime(),
    futureState.purchaseBatch.validityEndDate.getTime()
  );
  assert.strictEqual(projectExtraEntitlements({ buckets: futureState.buckets, businessDate: "2026-09-09" }).premiumTotals.remainingQty, 0);
  assert.strictEqual(projectExtraEntitlements({ buckets: futureState.buckets, businessDate: "2026-09-10" }).premiumTotals.remainingQty, 4);
  assert.strictEqual(projectExtraEntitlements({ buckets: futureState.buckets, businessDate: "2026-10-06" }).premiumTotals.remainingQty, 0);

  await clearDatabase();
  const immutable = await createFixture({
    premiumQty: 4,
    addons: [addonRow({ name: "Salad", qty: 10, category: "salad" })],
  });
  await mongoose.connection.collection("plans").updateOne(
    { _id: immutable.draft.planId },
    { $set: { mutablePremiumQuantity: 99, mutableAddonQuantities: [77] } }
  );
  immutable.subscriptionPayload.premiumBalance[0].purchasedQty = 99;
  immutable.subscriptionPayload.premiumBalance[0].remainingQty = 99;
  immutable.subscriptionPayload.addonBalance[0].purchasedQty = 77;
  immutable.subscriptionPayload.addonBalance[0].remainingQty = 77;
  await applyFixture(immutable);
  const immutableState = await purchaseState(immutable);
  assert.deepStrictEqual(
    immutableState.buckets.map((row) => row.purchasedQty).sort((a, b) => a - b),
    [4, 10]
  );

  await clearDatabase();
  const historical = await createFixture({ historicalParentExtras: true });
  await applyFixture(historical);
  const historicalState = await purchaseState(historical);
  assert.strictEqual(historicalState.buckets.length, 0);

  const valid = buildPinnedExtraActivationSnapshot({
    premiumItems: [{ premiumKey: "premium_shrimp", qty: 4, unitExtraFeeHalala: 250 }],
    addonSubscriptions: [addonRow({ name: "Salad", qty: 10, category: "salad" })],
    daysCount: 26,
  });
  const malformed = [
    { mutate: (copy) => { copy.premium[0].purchasedQty = -1; } },
    { mutate: (copy) => { copy.premium[0].purchasedQty = Number.NaN; } },
    { mutate: (copy) => { copy.premium.push({ ...copy.premium[0], purchasedQty: 5, remainingQty: 5 }); } },
    { mutate: (copy) => { delete copy.addons.balances[0].addonId; delete copy.addons.balances[0].addonPlanId; } },
    { mutate: (copy) => { copy.premium[0].premiumKey = "bad key!"; } },
  ];
  for (const scenario of malformed) {
    const copy = structuredClone(valid);
    scenario.mutate(copy);
    assert.throws(() => normalizePinnedExtraActivationSnapshot(copy));
  }

  await clearDatabase();
  const malformedTransaction = await createFixture({ premiumQty: 4 });
  await assert.rejects(
    () => applyFixture(malformedTransaction, {
      mutateDraft: (draft) => {
        draft.stackingFinalization.extraEntitlements.premium[0].purchasedQty = -1;
      },
      maxRetries: 0,
    }),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_ACTIVATION_QUANTITY_INVALID")
  );
  await assertRolledBack(malformedTransaction);
}

async function testRuntimeEntryRemainsClosed() {
  await clearDatabase();
  const fixture = await createFixture({ premiumQty: 4 });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [draft, payment] = await Promise.all([
        CheckoutDraft.findById(fixture.draft._id).session(session),
        Payment.findById(fixture.payment._id).session(session),
      ]);
      await assert.rejects(
        () => activatePaidDraftIntoExistingContainerTransactional({
          draft,
          payment,
          subscriptionPayload: fixture.subscriptionPayload,
          businessDate: "2026-08-06",
          expectedParentSubscriptionId: fixture.container._id,
          session,
        }),
        (err) => Boolean(err && err.code === "STACKING_PREMIUM_ADDON_WRITE_NOT_READY")
      );
    });
  } finally {
    await session.endSession();
  }
  await assertRolledBack(fixture);
}

async function run() {
  await connect();
  try {
    await testPremiumAddonMixedAndZeroRegression();
    await testReplayAndFirstCommitConcurrency();
    await testWebhookVerifySharedRace();
    await testFailureRollbackAndRetry();
    await testFutureImmutabilityHistoricalAndMalformed();
    await testRuntimeEntryRemainsClosed();
    console.log("subscription stacking extra activation P2 integration passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (err) => {
  console.error(err);
  try {
    await disconnect();
  } catch (_) {
    // best effort cleanup
  }
  process.exitCode = 1;
});