"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  activatePaidDraftIntoExistingContainerTransactional,
  buildContainerMirror,
  hasPaidPurchaseExtras,
} = require("../src/services/subscription/subscriptionStackingActivationService");

function transactionalSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function buildContainer(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryZoneId: "zone-a",
    deliveryWindow: "13:00-15:00",
    deliverySlot: {
      type: "delivery",
      slotId: "slot-a",
      window: "13:00-15:00",
      label: "13:00-15:00",
    },
    deliveryAddress: {
      city: "Riyadh",
      district: "Olaya",
      street: "A",
      building: "1",
      apartment: "2",
    },
    premiumBalance: [],
    addonSubscriptions: [],
    addonBalance: [],
    ...overrides,
  };
}

function buildPaidPurchase(container, overrides = {}) {
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    userId: container.userId,
    planId: new mongoose.Types.ObjectId(),
    status: "pending_payment",
    daysCount: 26,
    mealsPerDay: 2,
    startDate: new Date("2026-08-06T00:00:00+03:00"),
    premiumItems: [],
    addonSubscriptions: [],
    ...overrides.draft,
  };
  const payment = {
    _id: new mongoose.Types.ObjectId(),
    userId: container.userId,
    status: "paid",
    ...overrides.payment,
  };
  const subscriptionPayload = {
    userId: container.userId,
    planId: draft.planId,
    startDate: draft.startDate,
    endDate: new Date("2026-08-31T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-31T00:00:00+03:00"),
    totalMeals: 52,
    remainingMeals: 52,
    selectedMealsPerDay: 2,
    selectedGrams: 150,
    deliveryMode: "delivery",
    deliveryZoneId: "zone-a",
    deliveryZoneName: "Zone A",
    deliveryWindow: "13:00-15:00",
    deliverySlot: {
      type: "delivery",
      slotId: "slot-a",
      window: "13:00-15:00",
      label: "13:00-15:00",
    },
    deliveryAddress: { ...container.deliveryAddress },
    premiumBalance: [],
    addonSubscriptions: [],
    addonBalance: [],
    checkoutCurrency: "SAR",
    ...overrides.subscriptionPayload,
  };
  return { draft, payment, subscriptionPayload };
}

function createRuntime({ container, requestedStartDay = null } = {}) {
  const batches = [];
  const calls = {
    requestedDates: [],
    containerUpdates: [],
    completedDrafts: [],
    linkedPayments: [],
    promo: [],
  };

  function asPlain(batch) {
    return batch && typeof batch.toObject === "function" ? batch.toObject() : batch;
  }

  const runtime = {
    findActiveContainer: async () => container || null,
    findBatches: async () => batches.map((batch) => ({ ...batch })),
    findStartDay: async ({ date }) => {
      calls.requestedDates.push(date);
      return requestedStartDay;
    },
    ensureBatchByPayload: async ({ payload }) => {
      const existing = batches.find((batch) => batch.sourceKey === payload.sourceKey);
      if (existing) {
        return { batch: existing, created: false, idempotent: true };
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        ...payload,
      };
      batches.push(created);
      return { batch: created, created: true, idempotent: false };
    },
    updateContainer: async ({ update }) => {
      calls.containerUpdates.push(update);
      return { ...container, ...update };
    },
    updateDraftCompleted: async ({ draftId, containerId }) => {
      calls.completedDrafts.push({ draftId, containerId });
      return { _id: draftId, status: "completed", subscriptionId: containerId };
    },
    linkPayment: async ({ paymentId, containerId, draftId }) => {
      calls.linkedPayments.push({ paymentId, containerId, draftId });
      return { _id: paymentId, status: "paid", subscriptionId: containerId };
    },
    consumePromoReservation: async (...args) => {
      calls.promo.push(args);
      return { consumed: true };
    },
  };

  return { runtime, batches, calls, asPlain };
}

async function testImmediateMixedGramPurchaseStacksWithoutCancelingContainer() {
  const container = buildContainer();
  const { draft, payment, subscriptionPayload } = buildPaidPurchase(container);
  const { runtime, batches, calls } = createRuntime({ container });

  const result = await activatePaidDraftIntoExistingContainerTransactional({
    draft,
    payment,
    subscriptionPayload,
    businessDate: "2026-08-06",
    session: transactionalSession(),
    runtime,
  });

  assert.strictEqual(result.outcome, "stacked_into_existing_container");
  assert.strictEqual(String(result.container._id), String(container._id));
  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0].sourceKey, `legacy:${container._id}`);
  assert.strictEqual(batches[0].remainingMeals, 20);
  assert.strictEqual(batches[0].proteinGrams, 200);
  assert.strictEqual(batches[1].sourceKey, `payment:${payment._id}`);
  assert.strictEqual(batches[1].remainingMeals, 52);
  assert.strictEqual(batches[1].proteinGrams, 150);
  assert.strictEqual(batches[1].status, "active");
  assert.strictEqual(result.schedule.mixedProteinGrams, true);
  assert.strictEqual(result.schedule.effectiveStartDate, "2026-08-06");
  assert.deepStrictEqual(calls.requestedDates, ["2026-08-06"]);

  assert.strictEqual(calls.containerUpdates.length, 1);
  const mirror = calls.containerUpdates[0];
  assert.strictEqual(mirror.totalMeals, 130);
  assert.strictEqual(mirror.remainingMeals, 72);
  assert.strictEqual(mirror.consumedMeals, 58);
  assert.strictEqual(mirror.selectedMealsPerDay, 5);
  assert.strictEqual(mirror.validityEndDate.toISOString().slice(0, 10), "2026-08-30");
  assert.strictEqual(calls.completedDrafts.length, 1);
  assert.strictEqual(String(calls.completedDrafts[0].containerId), String(container._id));
  assert.strictEqual(calls.linkedPayments.length, 1);
  assert.strictEqual(String(calls.linkedPayments[0].containerId), String(container._id));
  assert.strictEqual(result.fulfillmentOverrides.fulfillmentModeOverride, null);
}

async function testFuturePurchaseExtendsHorizonButDoesNotExposeBalanceEarly() {
  const container = buildContainer({
    endDate: new Date("2026-08-09T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-09T00:00:00+03:00"),
    totalMeals: 27,
    remainingMeals: 20,
  });
  const { draft, payment, subscriptionPayload } = buildPaidPurchase(container, {
    draft: {
      startDate: new Date("2026-08-10T00:00:00+03:00"),
    },
    subscriptionPayload: {
      startDate: new Date("2026-08-10T00:00:00+03:00"),
      endDate: new Date("2026-09-04T00:00:00+03:00"),
      validityEndDate: new Date("2026-09-04T00:00:00+03:00"),
    },
  });
  const { runtime, batches, calls } = createRuntime({ container });

  const result = await activatePaidDraftIntoExistingContainerTransactional({
    draft,
    payment,
    subscriptionPayload,
    businessDate: "2026-08-06",
    session: transactionalSession(),
    runtime,
  });

  assert.strictEqual(result.schedule.shouldExposeBalanceNow, false);
  assert.strictEqual(result.purchaseBatch.status, "paid_scheduled");
  assert.strictEqual(batches.length, 2);
  const mirror = calls.containerUpdates[0];
  assert.strictEqual(mirror.totalMeals, 27);
  assert.strictEqual(mirror.remainingMeals, 20);
  assert.strictEqual(mirror.selectedMealsPerDay, 3);
  assert.strictEqual(mirror.validityEndDate.toISOString().slice(0, 10), "2026-09-03");
}

async function testCommittedTodayShiftsPurchaseUsingKsaDate() {
  const container = buildContainer();
  const { draft, payment, subscriptionPayload } = buildPaidPurchase(container);
  const { runtime, calls } = createRuntime({
    container,
    requestedStartDay: { status: "in_preparation" },
  });

  const result = await activatePaidDraftIntoExistingContainerTransactional({
    draft,
    payment,
    subscriptionPayload,
    businessDate: "2026-08-06",
    session: transactionalSession(),
    runtime,
  });

  assert.deepStrictEqual(calls.requestedDates, ["2026-08-06"]);
  assert.strictEqual(result.schedule.adjusted, true);
  assert.strictEqual(result.schedule.effectiveStartDate, "2026-08-07");
  assert.strictEqual(result.purchaseBatch.status, "paid_scheduled");
  assert.strictEqual(result.schedule.adjustments[0].reason, "REQUESTED_START_DAY_COMMITTED");
}

async function testNoActiveContainerDelegatesToStandardActivation() {
  const fakeContainer = buildContainer();
  const { draft, payment, subscriptionPayload } = buildPaidPurchase(fakeContainer);
  const { runtime, calls } = createRuntime({ container: null });

  const result = await activatePaidDraftIntoExistingContainerTransactional({
    draft,
    payment,
    subscriptionPayload,
    businessDate: "2026-08-06",
    session: transactionalSession(),
    runtime,
  });

  assert.strictEqual(result.outcome, "delegate_to_standard_activation");
  assert.strictEqual(calls.containerUpdates.length, 0);
  assert.strictEqual(calls.completedDrafts.length, 0);
  assert.strictEqual(calls.linkedPayments.length, 0);
}

async function testExtrasAreHardBlockedUntilTheirLedgerIsIntegrated() {
  const container = buildContainer();
  const purchase = buildPaidPurchase(container, {
    subscriptionPayload: {
      premiumBalance: [{ premiumKey: "shrimp", remainingQty: 2 }],
    },
  });
  const { runtime } = createRuntime({ container });

  await assert.rejects(
    () => activatePaidDraftIntoExistingContainerTransactional({
      ...purchase,
      businessDate: "2026-08-06",
      session: transactionalSession(),
      runtime,
    }),
    (err) => Boolean(err && err.code === "STACKING_PREMIUM_ADDON_WRITE_NOT_READY")
  );
}

async function testTransactionIsMandatory() {
  const container = buildContainer();
  const purchase = buildPaidPurchase(container);
  const { runtime } = createRuntime({ container });

  await assert.rejects(
    () => activatePaidDraftIntoExistingContainerTransactional({
      ...purchase,
      businessDate: "2026-08-06",
      session: null,
      runtime,
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

function testMirrorProjectionAndExtrasDetection() {
  const container = buildContainer();
  const mirror = buildContainerMirror({
    container,
    businessDate: "2026-08-06",
    batches: [
      {
        _id: new mongoose.Types.ObjectId(),
        status: "active",
        effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
        endDate: new Date("2026-08-26T00:00:00+03:00"),
        validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
        totalMeals: 78,
        remainingMeals: 20,
        reservedMeals: 0,
        consumedMeals: 58,
        forfeitedMeals: 0,
        mealsPerDay: 3,
        proteinGrams: 200,
        deliverySnapshot: {},
      },
    ],
  });
  assert.strictEqual(mirror.remainingMeals, 20);
  assert.strictEqual(mirror.selectedMealsPerDay, 3);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mirror, "stackingMirror"), false);
  assert.strictEqual(hasPaidPurchaseExtras({}), false);
  assert.strictEqual(hasPaidPurchaseExtras({ addonSubscriptions: [{}] }), true);
}

async function run() {
  await testImmediateMixedGramPurchaseStacksWithoutCancelingContainer();
  await testFuturePurchaseExtendsHorizonButDoesNotExposeBalanceEarly();
  await testCommittedTodayShiftsPurchaseUsingKsaDate();
  await testNoActiveContainerDelegatesToStandardActivation();
  await testExtrasAreHardBlockedUntilTheirLedgerIsIntegrated();
  await testTransactionIsMandatory();
  testMirrorProjectionAndExtrasDetection();

  console.log("subscription stacking activation service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
