"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");

const { startSafeSession } = require("../src/utils/mongoTransactionSupport");
const {
  runMongoTransactionWithRetry,
} = require("../src/services/mongoTransactionRetryService");
const {
  persistActivatedSubscription,
} = require("../src/services/subscription/subscriptionActivationService");
const {
  pickupItemConsumesBaseMealCredit,
} = require("../src/services/subscription/subscriptionPickupSlotService");
const {
  buildPickupAvailabilitySummary,
  buildPickupAvailabilityWallet,
} = require("../src/services/subscription/subscriptionPickupRequestClientService");
const {
  cleanupTerminalNonPaidDayPayment,
  releaseDayPaymentAllocations,
} = require("../src/services/subscription/subscriptionDayPaymentLifecycleService");

function createStandaloneActivationPersistence({ failPromotion = false } = {}) {
  let shouldFailPromotion = failPromotion;
  const records = new Map([
    ["old", {
      _id: "old",
      userId: "user-1",
      status: "active",
      replacementState: "",
      $locals: {},
    }],
  ]);
  const days = [];

  return {
    records,
    days,
    setFailPromotion(value) {
      shouldFailPromotion = Boolean(value);
    },
    persistence: {
      async createSubscription(payload) {
        if (records.has(String(payload._id))) {
          const err = new Error("duplicate _id");
          err.code = 11000;
          throw err;
        }
        const doc = { ...payload, $locals: {} };
        records.set(String(doc._id), doc);
        return doc;
      },
      async findSubscriptionById(subscriptionId) {
        return records.get(String(subscriptionId)) || null;
      },
      async countSubscriptionDays(subscriptionId) {
        return days.filter((day) => String(day.subscriptionId) === String(subscriptionId)).length;
      },
      async insertSubscriptionDays(entries) {
        days.push(...entries);
        return entries;
      },
      async upsertSubscriptionDays(entries) {
        for (const entry of entries) {
          const exists = days.some((day) => (
            String(day.subscriptionId) === String(entry.subscriptionId)
              && String(day.date) === String(entry.date)
          ));
          if (!exists) days.push(entry);
        }
        return entries;
      },
      async findPreviousActiveSubscriptions(userId, { excludeSubscriptionId } = {}) {
        return [...records.values()].filter((record) => (
          String(record.userId) === String(userId)
            && record.status === "active"
            && String(record._id) !== String(excludeSubscriptionId || "")
        ));
      },
      async findSuspendedSubscriptionsForReplacement(replacedBySubscriptionId) {
        return [...records.values()].filter((record) => (
          record.status === "pending_payment"
            && record.replacementState === "switching"
            && String(record.replacedBySubscriptionId || "") === String(replacedBySubscriptionId)
        ));
      },
      async suspendActiveSubscriptionForReplacement({ subscriptionId, replacedBySubscriptionId, replacedAt }) {
        const record = records.get(String(subscriptionId));
        if (!record || record.status !== "active") return null;
        record.status = "pending_payment";
        record.replacementState = "switching";
        record.replacedBySubscriptionId = replacedBySubscriptionId;
        record.replacedAt = replacedAt;
        return record;
      },
      async activateStagedSubscription({ subscriptionId }) {
        if (shouldFailPromotion) return null;
        const record = records.get(String(subscriptionId));
        if (!record || record.status !== "pending_payment") return null;
        const competingActive = [...records.values()].some((candidate) => (
          candidate.status === "active"
            && String(candidate.userId) === String(record.userId)
            && String(candidate._id) !== String(record._id)
        ));
        if (competingActive) {
          const err = new Error("duplicate userId active subscription");
          err.code = 11000;
          err.keyPattern = { userId: 1 };
          throw err;
        }
        record.status = "active";
        record.replacementState = "";
        return record;
      },
      async finalizeSuspendedSubscription({ subscriptionId, replacedBySubscriptionId, canceledAt }) {
        const record = records.get(String(subscriptionId));
        if (
          !record
          || record.status !== "pending_payment"
          || record.replacementState !== "switching"
          || String(record.replacedBySubscriptionId) !== String(replacedBySubscriptionId)
        ) return null;
        record.status = "canceled";
        record.replacementState = "completed";
        record.canceledAt = canceledAt;
        return record;
      },
      async restoreSuspendedSubscription({ subscriptionId, replacedBySubscriptionId }) {
        const record = records.get(String(subscriptionId));
        if (
          !record
          || record.status !== "pending_payment"
          || record.replacementState !== "switching"
          || String(record.replacedBySubscriptionId) !== String(replacedBySubscriptionId)
        ) return null;
        record.status = "active";
        record.replacementState = "";
        record.replacedBySubscriptionId = null;
        return record;
      },
      async cancelStagedSubscription({ subscriptionId, canceledAt }) {
        const record = records.get(String(subscriptionId));
        if (!record || record.status !== "pending_payment" || record.replacementState === "switching") return null;
        record.status = "canceled";
        record.canceledAt = canceledAt;
        record.cancellationReason = "activation_failed";
        return record;
      },
      async restageFailedSubscription({ subscriptionId }) {
        const record = records.get(String(subscriptionId));
        if (!record || record.status !== "canceled" || record.cancellationReason !== "activation_failed") return null;
        record.status = "pending_payment";
        record.replacementState = "staged";
        record.canceledAt = null;
        record.cancellationReason = "";
        return record;
      },
    },
  };
}

async function testStandaloneSessionCapability() {
  let transactionMethodCalls = 0;
  const rawSession = {
    startTransaction() { transactionMethodCalls += 1; },
    async commitTransaction() { transactionMethodCalls += 1; },
    async abortTransaction() { transactionMethodCalls += 1; },
    async withTransaction(work) {
      transactionMethodCalls += 1;
      return work(this);
    },
  };
  const fakeConnection = {
    db: { admin: () => ({ command: async () => ({ isWritablePrimary: true }) }) },
    startSession: async () => rawSession,
  };

  const session = await startSafeSession(fakeConnection);
  assert.equal(session.supportsTransactions, false);
  let workCount = 0;
  session.startTransaction();
  await session.withTransaction(async () => { workCount += 1; });
  await session.commitTransaction();
  await session.abortTransaction();
  assert.equal(workCount, 1);
  assert.equal(transactionMethodCalls, 0, "standalone mode must not invoke real transaction methods");
}

async function testStandaloneWorkflowIsNeverRetried() {
  let sessionCount = 0;
  let workCount = 0;
  await assert.rejects(
    () => runMongoTransactionWithRetry(async (_session, context) => {
      workCount += 1;
      assert.equal(context.transactional, false);
      const err = new Error("simulated standalone write conflict after a partial write");
      err.code = 112;
      throw err;
    }, {
      maxRetries: 3,
      startSession: async () => {
        sessionCount += 1;
        return {
          supportsTransactions: false,
          endSession() {},
        };
      },
      sleepFn: async () => {},
    }),
    (err) => err && err.code === 112
  );
  assert.equal(workCount, 1, "a standalone partial workflow must not be executed twice");
  assert.equal(sessionCount, 1);
}

async function testStandaloneActivationSwitch() {
  const fixture = createStandaloneActivationPersistence();
  const activated = await persistActivatedSubscription({
    subscriptionPayload: {
      _id: "new",
      userId: "user-1",
      status: "active",
    },
    dayEntries: [{ date: "2026-07-22", status: "open" }],
    session: { supportsTransactions: false },
    persistence: fixture.persistence,
  });

  assert.equal(activated.status, "active");
  assert.equal(fixture.records.get("old").status, "canceled");
  assert.equal(String(fixture.records.get("old").replacedBySubscriptionId), "new");
  assert.equal(fixture.records.get("new").status, "active");
  assert.equal([...fixture.records.values()].filter((record) => record.status === "active").length, 1);
  assert.equal(fixture.days.length, 1);

  const replayed = await persistActivatedSubscription({
    subscriptionPayload: {
      _id: "new",
      userId: "user-1",
      status: "active",
    },
    dayEntries: [{ date: "2026-07-22", status: "open" }],
    session: { supportsTransactions: false },
    persistence: fixture.persistence,
  });
  assert.equal(replayed.status, "active");
  assert.equal(fixture.days.length, 1, "activation retry must reuse the same staged subscription and days");
}

async function testStandaloneActivationCompensation() {
  const fixture = createStandaloneActivationPersistence({ failPromotion: true });
  await assert.rejects(
    () => persistActivatedSubscription({
      subscriptionPayload: {
        _id: "new",
        userId: "user-1",
        status: "active",
      },
      dayEntries: [{ date: "2026-07-22", status: "open" }],
      session: { supportsTransactions: false },
      persistence: fixture.persistence,
    }),
    (err) => err && err.code === "ACTIVE_SUBSCRIPTION_CONFLICT"
  );
  assert.equal(fixture.records.get("old").status, "active", "failed promotion restores the previous active subscription");
  assert.equal(fixture.records.get("new").status, "canceled", "failed staged activation stays hidden");

  fixture.setFailPromotion(false);
  const recovered = await persistActivatedSubscription({
    subscriptionPayload: {
      _id: "new",
      userId: "user-1",
      status: "active",
    },
    dayEntries: [{ date: "2026-07-22", status: "open" }],
    session: { supportsTransactions: false },
    persistence: fixture.persistence,
  });
  assert.equal(recovered.status, "active", "a paid activation retry recovers its failed staged subscription");
  assert.equal(fixture.records.get("old").status, "canceled");
}

function testPickupMealCreditTypesAndWallet() {
  for (const itemType of ["meal", "premium_meal", "large_salad", "sandwich"]) {
    assert.equal(
      pickupItemConsumesBaseMealCredit({ itemType, slotId: `slot-${itemType}` }),
      true,
      `${itemType} must consume one base meal credit`
    );
  }
  assert.equal(pickupItemConsumesBaseMealCredit({ itemType: "addon", slotId: "addon-1" }), false);

  const pickupItems = ["meal", "premium_meal", "large_salad", "sandwich", "addon"].map((itemType) => ({
    itemType,
    selectionMode: "independent",
    availability: { state: "available", available: true, canSelect: true },
  }));
  const availability = {
    subscriptionDayId: "day-1",
    slots: [],
    pickupItems,
    hiddenUnavailableCount: 0,
  };
  const subscription = {
    remainingMeals: 0,
    totalMeals: 1,
    baseMealAllocations: [{
      dayId: "day-1",
      slotKey: "slot_1",
      state: "reserved",
      pickupRequestId: null,
    }],
  };

  const wallet = buildPickupAvailabilityWallet(subscription, availability);
  assert.equal(wallet.remainingMeals, 0);
  assert.equal(wallet.availableMeals, 1, "the last confirmed reservation remains available for pickup");

  const summary = buildPickupAvailabilitySummary({ subscription, availability });
  assert.equal(summary.availableMealSlotCount, 4);
  assert.equal(summary.availableAddonCount, 1);
  assert.equal(summary.canCreatePickupRequest, true);
}

async function testTerminalUnpaidPaymentReleasesReservationOnce() {
  const payment = {
    _id: "payment-1",
    type: "day_planning_payment",
    subscriptionId: "subscription-1",
    metadata: {
      dayId: "day-1",
      revisionHash: "revision-1",
      baseAllocationKeys: ["allocation-1"],
    },
  };
  let transitionCount = 0;
  let dayUpdate = null;
  const releaseAllocationsFn = (args) => releaseDayPaymentAllocations({
    ...args,
    transitionAllocationFn: async ({ allocationKey, toState }) => {
      transitionCount += 1;
      assert.equal(allocationKey, "allocation-1");
      assert.equal(toState, "released");
      return { changed: true };
    },
    savePaymentMetadataFn: async (target, metadata) => {
      target.metadata = metadata;
    },
  });
  const updateDayFn = async (filter, update) => {
    dayUpdate = { filter, update };
    return { matchedCount: 1, modifiedCount: 1 };
  };

  const first = await cleanupTerminalNonPaidDayPayment({
    payment,
    status: "canceled",
    releaseAllocationsFn,
    updateDayFn,
  });
  const second = await cleanupTerminalNonPaidDayPayment({
    payment,
    status: "canceled",
    releaseAllocationsFn,
    updateDayFn,
  });

  assert.equal(first.applied, true);
  assert.equal(second.alreadyReleased, true);
  assert.equal(transitionCount, 1, "terminal callback replay must not refund the meal twice");
  assert.equal(dayUpdate.filter["premiumExtraPayment.paymentId"], "payment-1");
  assert.equal(dayUpdate.update.$set["premiumExtraPayment.status"], "failed");
}

async function main() {
  await testStandaloneSessionCapability();
  await testStandaloneWorkflowIsNeverRetried();
  await testStandaloneActivationSwitch();
  await testStandaloneActivationCompensation();
  await testTerminalUnpaidPaymentReleasesReservationOnce();
  testPickupMealCreditTypesAndWallet();
  console.log("standaloneMongoMealLifecycle.test.js passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
