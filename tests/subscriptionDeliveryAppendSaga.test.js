"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");
require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDayAppendOperation = require("../src/models/SubscriptionDayAppendOperation");
const SubscriptionDayMutationLock = require("../src/models/SubscriptionDayMutationLock");
const pickupAuthority = require("../src/services/subscription/subscriptionPickupCycleAuthorityService");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const lockService = require("../src/services/subscription/subscriptionDayMutationLockService");
const {
  createDeliveryAppendSagaService,
  hashAppendRequest,
  normalizeRequestPayload,
} = require("../src/services/subscription/subscriptionDeliveryAppendSagaService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function slot(index, productKey = `meal_${index}`) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "standard_meal",
    productId: oid(),
    productKey,
    selectedOptions: [],
  };
}

async function buildCase({ key = "delivery-append-key", paymentPending = false } = {}) {
  const userId = oid();
  const subscription = await Subscription.create({
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2099-12-31T00:00:00.000Z"),
    validityEndDate: new Date("2099-12-31T00:00:00.000Z"),
    totalMeals: 10,
    remainingMeals: 8,
    entitlementVersion: 2,
    reservedMeals: 2,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    deliveryMode: "delivery",
    deliveryWindow: "18:00-20:00",
    addonBalance: [],
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2099-01-02",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "revision-two-meals",
    plannerMeta: {
      requiredSlotCount: 2,
      emptySlotCount: 0,
      partialSlotCount: 0,
      completeSlotCount: 2,
      isDraftValid: true,
      isConfirmable: true,
      confirmedAt: new Date(),
      confirmedByRole: "client",
    },
    mealSlots: [slot(1), slot(2)],
    addonSelections: [],
    premiumExtraPayment: paymentPending
      ? { status: "pending", amountHalala: 500, currency: "SAR" }
      : { status: "none", amountHalala: 0, currency: "SAR" },
  });
  const args = {
    subscriptionId: subscription._id,
    date: day.date,
    userId,
    lang: "ar",
    runtime: null,
    body: {
      idempotencyKey: key,
      contractVersion: "v3",
      mealSlots: [slot(99, "third_meal")],
    },
  };
  return { subscription, day, args };
}

function createUpdateStub({ paymentPending = false, counters }) {
  return async function updateSelection(args = {}) {
    counters.updateCalls += 1;
    assert(args.body.__dayMutationToken, "saga must pass its internal mutation token");
    const mealSlots = args.body.mealSlots || [];
    const revision = mealSlots.length === 2 ? "revision-compensated-two" : "revision-three-meals";
    const pending = paymentPending && mealSlots.length === 3;
    const day = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: args.subscriptionId, date: args.date },
      {
        $set: {
          mealSlots,
          plannerRevisionHash: revision,
          plannerState: "draft",
          planningState: "draft",
          plannerMeta: {
            requiredSlotCount: mealSlots.length,
            emptySlotCount: 0,
            partialSlotCount: 0,
            completeSlotCount: mealSlots.length,
            isDraftValid: true,
            isConfirmable: !pending,
          },
          premiumExtraPayment: pending
            ? { status: "pending", amountHalala: 500, currency: "SAR" }
            : { status: "none", amountHalala: 0, currency: "SAR" },
        },
      },
      { new: true }
    );
    return {
      ok: true,
      status: pending ? 402 : 200,
      data: {
        paymentRequirement: { requiresPayment: pending },
        plannerRevisionHash: revision,
      },
      day,
    };
  };
}

function installAuthorityStubs(counters) {
  const originals = {
    reserveMissingDaySlotAllocations: pickupAuthority.reserveMissingDaySlotAllocations,
    readWallet: pickupAuthority.readWallet,
    ensureDailyAddonDefaultsForDay: dailyAddonService.ensureDailyAddonDefaultsForDay,
  };
  pickupAuthority.reserveMissingDaySlotAllocations = async ({ slotKeys }) => {
    counters.reserveCalls += 1;
    return {
      reservedDelta: slotKeys.length,
      allocationKeys: slotKeys.map((key) => `allocation:${key}`),
      newlyChangedAllocationKeys: slotKeys.map((key) => `allocation:${key}`),
      wallet: {
        sourceOfTruth: "subscription.baseMealAllocations",
        totalMeals: 10,
        remainingMeals: 7,
        reservedMeals: 3,
        consumedMeals: 0,
        forfeitedMeals: 0,
      },
    };
  };
  pickupAuthority.readWallet = async () => ({
    sourceOfTruth: "subscription.baseMealAllocations",
    totalMeals: 10,
    remainingMeals: 7,
    reservedMeals: 3,
    consumedMeals: 0,
    forfeitedMeals: 0,
  });
  dailyAddonService.ensureDailyAddonDefaultsForDay = async () => {
    counters.addonCalls += 1;
    return { appliedCount: 0 };
  };
  return () => {
    pickupAuthority.reserveMissingDaySlotAllocations = originals.reserveMissingDaySlotAllocations;
    pickupAuthority.readWallet = originals.readWallet;
    dailyAddonService.ensureDailyAddonDefaultsForDay = originals.ensureDailyAddonDefaultsForDay;
  };
}

async function operationFor(caseData) {
  return SubscriptionDayAppendOperation.findOne({
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
    idempotencyKey: caseData.args.body.idempotencyKey,
  }).lean();
}

async function testStableHashIgnoresCurrentSlotCount() {
  const caseData = await buildCase();
  const firstPayload = normalizeRequestPayload(caseData.args);
  const firstHash = hashAppendRequest({
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
    requestPayload: firstPayload,
  });
  await SubscriptionDay.updateOne(
    { _id: caseData.day._id },
    { $push: { mealSlots: slot(3, "unrelated_current_projection") } }
  );
  const secondHash = hashAppendRequest({
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
    requestPayload: normalizeRequestPayload(caseData.args),
  });
  assert.strictEqual(firstHash, secondHash);
}

async function testSuccessfulReplayAndConflict() {
  const caseData = await buildCase();
  const counters = { updateCalls: 0, reserveCalls: 0, addonCalls: 0 };
  const restore = installAuthorityStubs(counters);
  try {
    const service = createDeliveryAppendSagaService();
    const updateSelectionFn = createUpdateStub({ counters });
    const first = await service.appendDeliveryMeals({ args: caseData.args, updateSelectionFn });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(counters.updateCalls, 1);
    assert.strictEqual(counters.reserveCalls, 1);
    assert.strictEqual(counters.addonCalls, 1);

    let day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.mealSlots.length, 3);
    assert.strictEqual(day.mealSlots[2].slotKey, "slot_3");
    assert.strictEqual(day.plannerState, "confirmed");
    assert.strictEqual(day.plannerMeta.completeSlotCount, 3, "confirmed projection must keep the new planner counts");

    let operation = await operationFor(caseData);
    assert.strictEqual(operation.status, "completed");
    assert.strictEqual(operation.active, false);
    assert.strictEqual(operation.allocationKeys.length, 1);

    const replay = await service.appendDeliveryMeals({ args: caseData.args, updateSelectionFn });
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(counters.updateCalls, 1, "idempotent replay must not save another slot");
    assert.strictEqual(counters.reserveCalls, 1);

    const conflictArgs = {
      ...caseData.args,
      body: {
        ...caseData.args.body,
        mealSlots: [slot(100, "different_meal")],
      },
    };
    const conflict = await service.appendDeliveryMeals({ args: conflictArgs, updateSelectionFn });
    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.code, "IDEMPOTENCY_CONFLICT");

    day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.mealSlots.length, 3);
  } finally {
    restore();
  }
}

async function testFailureAfterDaySaveCompensates() {
  const caseData = await buildCase({ key: "fail-after-day-save" });
  const counters = { updateCalls: 0, reserveCalls: 0, addonCalls: 0 };
  const restore = installAuthorityStubs(counters);
  try {
    const service = createDeliveryAppendSagaService({
      faultInjector: async (step) => {
        if (step === "after_day_saved") {
          const err = new Error("simulated crash after day save");
          err.code = "SIMULATED_CRASH";
          throw err;
        }
      },
    });
    const result = await service.appendDeliveryMeals({
      args: caseData.args,
      updateSelectionFn: createUpdateStub({ counters }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SIMULATED_CRASH");
    assert.strictEqual(counters.reserveCalls, 0);
    assert.strictEqual(counters.updateCalls, 2, "compensation must issue a reverse selection command");

    const day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.mealSlots.length, 2);
    assert.strictEqual(day.plannerState, "confirmed");
    assert.strictEqual(day.plannerMeta.completeSlotCount, 2);

    const operation = await operationFor(caseData);
    assert.strictEqual(operation.status, "compensated");
    assert.strictEqual(operation.active, false);
  } finally {
    restore();
  }
}

async function testFailureAfterCreditsDoesNotCompleteEarly() {
  const caseData = await buildCase({ key: "fail-after-credits" });
  const counters = { updateCalls: 0, reserveCalls: 0, addonCalls: 0 };
  const restore = installAuthorityStubs(counters);
  try {
    const service = createDeliveryAppendSagaService({
      faultInjector: async (step) => {
        if (step === "after_credits_reserved") {
          const err = new Error("simulated crash after credits");
          err.code = "SIMULATED_CREDIT_CRASH";
          throw err;
        }
      },
    });
    const result = await service.appendDeliveryMeals({
      args: caseData.args,
      updateSelectionFn: createUpdateStub({ counters }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "SIMULATED_CREDIT_CRASH");
    assert.strictEqual(counters.reserveCalls, 1);
    assert.strictEqual(counters.addonCalls, 0);

    const operation = await operationFor(caseData);
    assert.notStrictEqual(operation.status, "completed");
    assert.strictEqual(operation.status, "compensated");

    const day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.mealSlots.length, 2);
  } finally {
    restore();
  }
}

async function testConcurrentRevisionIsNeverOverwritten() {
  const caseData = await buildCase({ key: "revision-conflict" });
  const counters = { updateCalls: 0, reserveCalls: 0, addonCalls: 0 };
  const restore = installAuthorityStubs(counters);
  try {
    const service = createDeliveryAppendSagaService({
      faultInjector: async (step, context) => {
        if (step === "after_day_saved") {
          await SubscriptionDay.updateOne(
            { _id: context.day._id },
            {
              $set: { plannerRevisionHash: "concurrent-revision" },
              $push: { mealSlots: slot(4, "concurrent_fourth") },
            }
          );
          const err = new Error("simulated failure after concurrent edit");
          err.code = "SIMULATED_CONCURRENT_FAILURE";
          throw err;
        }
      },
    });
    const result = await service.appendDeliveryMeals({
      args: caseData.args,
      updateSelectionFn: createUpdateStub({ counters }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.details.appendRecoveryRequired, true);
    assert.strictEqual(counters.updateCalls, 1, "stale compensation must not issue a reverse write");

    const day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.plannerRevisionHash, "concurrent-revision");
    assert.strictEqual(day.mealSlots.length, 4, "concurrent projection must not be overwritten by the old snapshot");

    const operation = await operationFor(caseData);
    assert.strictEqual(operation.status, "recovery_required");
    assert.strictEqual(operation.active, true);
  } finally {
    restore();
  }
}

async function testPaymentPendingNeverReservesOrConfirms() {
  const caseData = await buildCase({ key: "premium-payment", paymentPending: true });
  const counters = { updateCalls: 0, reserveCalls: 0, addonCalls: 0 };
  const restore = installAuthorityStubs(counters);
  try {
    const service = createDeliveryAppendSagaService();
    const result = await service.appendDeliveryMeals({
      args: caseData.args,
      updateSelectionFn: createUpdateStub({ paymentPending: true, counters }),
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 402);
    assert.strictEqual(counters.reserveCalls, 0);
    assert.strictEqual(counters.addonCalls, 0);

    const day = await SubscriptionDay.findById(caseData.day._id).lean();
    assert.strictEqual(day.mealSlots.length, 3);
    assert.strictEqual(day.plannerState, "draft");

    const operation = await operationFor(caseData);
    assert.strictEqual(operation.status, "payment_pending");
    assert.strictEqual(operation.active, true);
  } finally {
    restore();
  }
}

async function testMutationLockBlocksUnrelatedWrites() {
  const caseData = await buildCase({ key: "mutation-lock" });
  const operation = await SubscriptionDayAppendOperation.create({
    subscriptionId: caseData.subscription._id,
    subscriptionDayId: caseData.day._id,
    userId: caseData.subscription.userId,
    date: caseData.day.date,
    idempotencyKey: caseData.args.body.idempotencyKey,
    requestHash: "lock-test",
    requestPayload: normalizeRequestPayload(caseData.args),
    status: "started",
    active: true,
    leaseToken: "secret-lock-token",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    previousPlannerRevisionHash: caseData.day.plannerRevisionHash,
  });
  await lockService.acquireDayMutationLock({
    subscriptionDayId: caseData.day._id,
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
    ownerOperationId: operation._id,
    token: operation.leaseToken,
    expectedPlannerRevisionHash: caseData.day.plannerRevisionHash,
  });

  await assert.rejects(
    () => lockService.assertDayMutationAllowed({
      subscriptionId: caseData.subscription._id,
      date: caseData.day.date,
    }),
    (err) => err && err.code === "DAY_MUTATION_IN_PROGRESS"
  );
  const allowed = await lockService.assertDayMutationAllowed({
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
    token: operation.leaseToken,
  });
  assert.strictEqual(allowed.allowed, true);
  await lockService.releaseDayMutationLock({
    subscriptionDayId: caseData.day._id,
    token: operation.leaseToken,
  });
  const unlocked = await lockService.assertDayMutationAllowed({
    subscriptionId: caseData.subscription._id,
    date: caseData.day.date,
  });
  assert.strictEqual(unlocked.allowed, true);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `delivery-append-saga-${Date.now()}` });
    await testStableHashIgnoresCurrentSlotCount();
    await mongoose.connection.dropDatabase();
    await testSuccessfulReplayAndConflict();
    await mongoose.connection.dropDatabase();
    await testFailureAfterDaySaveCompensates();
    await mongoose.connection.dropDatabase();
    await testFailureAfterCreditsDoesNotCompleteEarly();
    await mongoose.connection.dropDatabase();
    await testConcurrentRevisionIsNeverOverwritten();
    await mongoose.connection.dropDatabase();
    await testPaymentPendingNeverReservesOrConfirms();
    await mongoose.connection.dropDatabase();
    await testMutationLockBlocksUnrelatedWrites();
    console.log("subscription delivery append saga checks passed");
  } finally {
    await SubscriptionDayMutationLock.deleteMany({}).catch(() => {});
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
