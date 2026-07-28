"use strict";

process.env.NODE_ENV = "test";
process.env.CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED = "true";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  fulfillSubscriptionPickupRequest,
} = require("../src/services/fulfillmentService");
const {
  buildMealBalance,
} = require("../src/services/subscription/subscriptionClientSupportService");
const {
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  runWithTransientTransactionRetry,
} = require("../src/services/installSubscriptionPlanningTransientRetry");
const dateUtils = require("../src/utils/date");

const BUSINESS_DATE = dateUtils.getTodayKSADate();
const START_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -1);
const END_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 30);

let replSet;

function ksaDate(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`);
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "client_balance_concurrency" },
  });
  const uri = replSet.getUri("client_balance_concurrency");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function resetDatabase() {
  await mongoose.connection.db.dropDatabase();
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) await replSet.stop();
  replSet = null;
}

function baseAllocation({ dayId, allocationKey = "shared-slot" }) {
  return {
    allocationKey,
    dayId,
    date: BUSINESS_DATE,
    slotKey: "slot_1",
    quantity: 1,
    state: "reserved",
    reservedAt: new Date(),
    premiumFunding: {
      source: "none",
      state: "none",
      premiumKey: "",
    },
  };
}

async function seedSubscription({
  totalMeals = 1,
  remainingMeals = totalMeals,
  reservedMeals = 0,
  consumedMeals = 0,
  forfeitedMeals = 0,
  baseMealAllocations = [],
} = {}) {
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    contractMode: "canonical",
    status: "active",
    startDate: ksaDate(START_DATE),
    endDate: ksaDate(END_DATE),
    validityEndDate: ksaDate(END_DATE),
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    entitlementVersion: 2,
    baseMealAllocations,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    premiumBalance: [],
  });
}

async function createPickupRequest({
  subscription,
  dayId = new mongoose.Types.ObjectId(),
  slotKey = "slot_1",
  mealCount = 1,
}) {
  return SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: dayId,
    userId: subscription.userId,
    date: BUSINESS_DATE,
    mealCount,
    selectedMealSlotIds: Array.from(
      { length: mealCount },
      (_, index) => mealCount === 1 ? slotKey : `slot_${index + 1}`
    ),
    selectionMode: "slot_ids",
    status: "ready_for_pickup",
  });
}

function allocationCounts(subscription) {
  return (subscription.baseMealAllocations || []).reduce(
    (counts, allocation) => {
      counts[allocation.state] = (counts[allocation.state] || 0) + 1;
      return counts;
    },
    {}
  );
}

function assertLedgerInvariant(subscription, label) {
  const counters = [
    subscription.remainingMeals,
    subscription.reservedMeals,
    subscription.consumedMeals,
    subscription.forfeitedMeals,
  ];
  assert(counters.every(Number.isSafeInteger), `${label}: integer counters`);
  assert(counters.every((counter) => counter >= 0), `${label}: nonnegative counters`);
  assert.strictEqual(
    counters.reduce((sum, counter) => sum + counter, 0),
    subscription.totalMeals,
    `${label}: aggregate invariant`
  );

  const keys = (subscription.baseMealAllocations || [])
    .map((allocation) => allocation.allocationKey);
  assert.strictEqual(new Set(keys).size, keys.length, `${label}: unique allocations`);
  const counts = allocationCounts(subscription);
  assert.strictEqual(counts.reserved || 0, subscription.reservedMeals);
  assert((counts.consumed || 0) <= subscription.consumedMeals);
  assert((counts.forfeited || 0) <= subscription.forfeitedMeals);
}

function assertProjectedSnapshot(subscription, label) {
  assertLedgerInvariant(subscription, label);
  const balance = buildMealBalance(subscription, BUSINESS_DATE);
  assert.strictEqual(balance.balanceProjection?.applied, true, `${label}: projection`);
  assert.strictEqual(
    balance.remainingMeals,
    subscription.remainingMeals + subscription.reservedMeals,
    `${label}: display`
  );
  assert.strictEqual(balance.availableMeals, subscription.remainingMeals);
  assert(balance.maxConsumableMealsNow <= balance.availableMeals);
  return balance;
}

async function testTwoRequestsClaimingSameAllocation() {
  const dayId = new mongoose.Types.ObjectId();
  const allocation = baseAllocation({ dayId });
  const subscription = await seedSubscription({
    remainingMeals: 0,
    reservedMeals: 1,
    baseMealAllocations: [allocation],
  });
  const requestA = await createPickupRequest({ subscription, dayId });
  const requestB = await createPickupRequest({ subscription, dayId });

  const attempts = await Promise.allSettled([
    reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: requestA._id,
      mealCount: 1,
    }),
    reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: requestB._id,
      mealCount: 1,
    }),
  ]);

  assert.strictEqual(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1
  );
  assert.strictEqual(
    attempts.filter(
      (attempt) =>
        attempt.status === "rejected"
        && attempt.reason.code === "MEAL_SLOT_UNAVAILABLE"
    ).length,
    1
  );
  const persisted = await Subscription.findById(subscription._id).lean();
  assertProjectedSnapshot(persisted, "same-allocation race");
  assert.strictEqual(persisted.remainingMeals, 0);
  assert.strictEqual(persisted.reservedMeals, 1);
}

async function testReservationAndReleaseRace() {
  const subscription = await seedSubscription();
  const pickupRequest = await createPickupRequest({ subscription });
  const attempts = await Promise.allSettled([
    reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    }),
    releaseReservedPickupMeals({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
    }),
  ]);
  assert(attempts.some((attempt) => attempt.status === "fulfilled"));

  let persisted = await Subscription.findById(subscription._id).lean();
  assertProjectedSnapshot(persisted, "reserve-release race");
  if (persisted.reservedMeals === 1) {
    await releaseReservedPickupMeals({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
    });
    persisted = await Subscription.findById(subscription._id).lean();
  }
  assertProjectedSnapshot(persisted, "reserve-release terminal retry");
  assert.strictEqual(persisted.remainingMeals, 1);
  assert.strictEqual(persisted.reservedMeals, 0);
}

async function reserveOnePickup() {
  const subscription = await seedSubscription();
  const pickupRequest = await createPickupRequest({ subscription });
  await reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: pickupRequest._id,
    mealCount: 1,
  });
  return { subscription, pickupRequest };
}

async function testParallelFulfillment() {
  const { subscription, pickupRequest } = await reserveOnePickup();
  const results = await Promise.all(
    Array.from(
      { length: 5 },
      () => fulfillSubscriptionPickupRequest({ requestId: pickupRequest._id })
    )
  );
  assert(results.every((result) => result.ok));

  const persisted = await Subscription.findById(subscription._id).lean();
  assertProjectedSnapshot(persisted, "parallel fulfillment");
  assert.strictEqual(persisted.remainingMeals, 0);
  assert.strictEqual(persisted.reservedMeals, 0);
  assert.strictEqual(persisted.consumedMeals, 1);
  assert.strictEqual(allocationCounts(persisted).consumed, 1);
}

async function testFulfillmentAndCancelRace() {
  const { subscription, pickupRequest } = await reserveOnePickup();
  await Promise.allSettled([
    fulfillSubscriptionPickupRequest({ requestId: pickupRequest._id }),
    releaseReservedPickupMeals({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
    }),
  ]);

  const [persisted, savedRequest] = await Promise.all([
    Subscription.findById(subscription._id).lean(),
    SubscriptionPickupRequest.findById(pickupRequest._id).lean(),
  ]);
  assertProjectedSnapshot(persisted, "fulfill-cancel race");
  assert.strictEqual(persisted.reservedMeals, 0);
  assert(
    (persisted.consumedMeals === 1 && persisted.remainingMeals === 0)
      || (persisted.consumedMeals === 0 && persisted.remainingMeals === 1)
  );
  assert.notStrictEqual(
    Boolean(savedRequest.creditsConsumedAt)
      && Boolean(savedRequest.creditsReleasedAt),
    true,
    "pickup request cannot be both consumed and released"
  );
}

async function testReadsDuringReservationAndFulfillment() {
  const subscription = await seedSubscription({
    totalMeals: 5,
    remainingMeals: 5,
  });
  const pickupRequest = await createPickupRequest({
    subscription,
    mealCount: 2,
  });
  const observedBalances = [];

  const reads = Array.from({ length: 50 }, async () => {
    const snapshot = await Subscription.findById(subscription._id).lean();
    observedBalances.push(assertProjectedSnapshot(snapshot, "concurrent read"));
  });
  const writes = (async () => {
    await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 2,
    });
    await fulfillSubscriptionPickupRequest({ requestId: pickupRequest._id });
  })();
  await Promise.all([writes, ...reads]);

  const persisted = await Subscription.findById(subscription._id).lean();
  const finalBalance = assertProjectedSnapshot(persisted, "read-write terminal");
  assert.strictEqual(finalBalance.remainingMeals, 3);
  assert(observedBalances.every((balance) => balance.remainingMeals <= 5));
}

function transientError(label) {
  const error = new Error(label);
  error.errorLabels = [label];
  return error;
}

async function testTransientTransactionRetry() {
  const subscription = await seedSubscription();
  const pickupRequest = await createPickupRequest({ subscription });
  let attempts = 0;

  await runWithTransientTransactionRetry(async () => {
    attempts += 1;
    const session = await mongoose.connection.startSession();
    session.startTransaction();
    try {
      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 1,
        session,
      });
      if (attempts === 1) {
        throw transientError("TransientTransactionError");
      }
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction().catch(() => {});
      throw error;
    } finally {
      await session.endSession();
    }
  }, {
    operationName: "client_balance_reservation",
    maxAttempts: 2,
    sleep: async () => {},
  });

  assert.strictEqual(attempts, 2);
  const persisted = await Subscription.findById(subscription._id).lean();
  assertProjectedSnapshot(persisted, "transient retry");
  assert.strictEqual(persisted.remainingMeals, 0);
  assert.strictEqual(persisted.reservedMeals, 1);
}

async function testUnknownCommitResultRetry() {
  const subscription = await seedSubscription();
  const pickupRequest = await createPickupRequest({ subscription });
  let attempts = 0;

  await runWithTransientTransactionRetry(async () => {
    attempts += 1;
    const reservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    if (attempts === 1) {
      throw transientError("UnknownTransactionCommitResult");
    }
    assert.strictEqual(reservation.alreadyReserved, true);
  }, {
    operationName: "client_balance_unknown_commit",
    maxAttempts: 2,
    sleep: async () => {},
  });

  assert.strictEqual(attempts, 2);
  const persisted = await Subscription.findById(subscription._id).lean();
  assertProjectedSnapshot(persisted, "unknown-result retry");
  assert.strictEqual(persisted.baseMealAllocations.length, 1);
  assert.strictEqual(persisted.remainingMeals, 0);
  assert.strictEqual(persisted.reservedMeals, 1);
}

async function runCase(name, testCase) {
  await resetDatabase();
  await testCase();
  console.log(`✅ ${name}`);
}

async function run() {
  await connect();
  try {
    await runCase(
      "two pickup requests cannot claim the same meal allocation",
      testTwoRequestsClaimingSameAllocation
    );
    await runCase(
      "reservation and release race preserves the ledger",
      testReservationAndReleaseRace
    );
    await runCase(
      "parallel fulfillment consumes each allocation once",
      testParallelFulfillment
    );
    await runCase(
      "fulfillment and cancel race reaches one terminal state",
      testFulfillmentAndCancelRace
    );
    await runCase(
      "reads during writes never manufacture credit",
      testReadsDuringReservationAndFulfillment
    );
    await runCase(
      "transient transaction retry rolls back then applies once",
      testTransientTransactionRetry
    );
    await runCase(
      "unknown commit result retry reuses the successful reservation",
      testUnknownCommitResultRetry
    );
    console.log(
      "subscriptionClientMealBalanceConcurrency.integration.test.js passed"
    );
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
