"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const {
  checkEntitlementInvariants,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  supersedeInitiatedDayPlanningPaymentsForRevisionChange,
} = require("../src/services/subscription/subscriptionDayPaymentLifecycleService");

const DB_PREFIX = "codex_subscription_entitlement_audit_";
const DB_NAME = `${DB_PREFIX}${Date.now()}`;
const DATE = "2026-07-20";

let mongoServer;

function allocation({ allocationKey, dayId, revisionHash }) {
  return {
    allocationKey,
    dayId,
    date: DATE,
    slotKey: "slot_1",
    plannerRevisionHash: revisionHash,
    quantity: 1,
    state: "reserved",
    reservedAt: new Date(),
    premiumFunding: {
      source: "pending_payment",
      state: "reserved",
      premiumKey: "salmon",
    },
  };
}

async function seedReservedPayment({
  allocationKey,
  revisionHash = "old-revision",
  metadataOverrides = {},
} = {}) {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();

  const subscription = await Subscription.create({
    _id: subscriptionId,
    userId,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 1,
    remainingMeals: 0,
    entitlementVersion: 2,
    reservedMeals: 1,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [allocation({ allocationKey, dayId, revisionHash })],
    deliveryMode: "delivery",
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "day_planning_payment",
    status: "initiated",
    amount: 1800,
    currency: "SAR",
    userId,
    subscriptionId,
    applied: false,
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: DATE,
      revisionHash,
      baseAllocationKeys: [allocationKey],
      ...metadataOverrides,
    },
  });

  return { subscription, payment, subscriptionId, userId, dayId };
}

async function assertReleased(subscriptionId, allocationKey) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  const storedAllocation = subscription.baseMealAllocations.find(
    (entry) => entry.allocationKey === allocationKey
  );

  assert(storedAllocation, "allocation must remain auditable after release");
  assert.strictEqual(storedAllocation.state, "released");
  assert(storedAllocation.releasedAt, "release timestamp must be persisted");
  assert.strictEqual(subscription.remainingMeals, 1);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.consumedMeals, 0);
  assert.strictEqual(subscription.forfeitedMeals, 0);
  assert.strictEqual(checkEntitlementInvariants(subscription).valid, true);

  return subscription;
}

async function run() {
  assert(DB_NAME.startsWith(DB_PREFIX));
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
  await mongoose.connect(mongoServer.getUri(DB_NAME), { serverSelectionTimeoutMS: 10000 });

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.strictEqual(Boolean(hello.setName || hello.msg === "isdbgrid"), false);

  const firstKey = "superseded-payment-reservation";
  const first = await seedReservedPayment({ allocationKey: firstKey });

  const firstResult = await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
    subscriptionId: first.subscriptionId,
    dayId: first.dayId,
    date: DATE,
    nextRevisionHash: "new-revision",
    reason: "planner_selection_changed",
  });

  assert.strictEqual(firstResult.matchedCount, 1);
  assert.strictEqual(firstResult.supersededCount, 1);
  assert.strictEqual(firstResult.releasedAllocationCount, 1);
  await assertReleased(first.subscriptionId, firstKey);

  const storedPayment = await Payment.findById(first.payment._id).lean();
  assert.strictEqual(storedPayment.metadata.isSuperseded, true);
  assert.strictEqual(storedPayment.metadata.supersededByRevisionHash, "new-revision");
  assert.strictEqual(storedPayment.metadata.entitlementReleasePending, false);
  assert(storedPayment.metadata.entitlementAllocationsReleasedAt);

  const replayResult = await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
    subscriptionId: first.subscriptionId,
    dayId: first.dayId,
    date: DATE,
    nextRevisionHash: "new-revision",
    reason: "planner_selection_changed",
  });
  assert.strictEqual(replayResult.supersededCount, 0);
  assert.strictEqual(replayResult.releasedAllocationCount, 0);
  await assertReleased(first.subscriptionId, firstKey);

  // Simulate a standalone crash after the payment was marked superseded but
  // before the Subscription allocation was released. A retry must finish it.
  const recoveryKey = "superseded-payment-crash-recovery";
  const recovery = await seedReservedPayment({
    allocationKey: recoveryKey,
    metadataOverrides: {
      isSuperseded: true,
      supersededAt: new Date(),
      supersededByRevisionHash: "newer-revision",
      supersededPreviousRevisionHash: "old-revision",
      supersededReason: "planner_selection_changed",
      entitlementReleasePending: true,
    },
  });

  const recoveryResult = await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
    subscriptionId: recovery.subscriptionId,
    dayId: recovery.dayId,
    date: DATE,
    nextRevisionHash: "newer-revision",
    reason: "planner_selection_changed",
  });

  assert.strictEqual(recoveryResult.supersededCount, 0);
  assert.strictEqual(recoveryResult.releasedAllocationCount, 1);
  await assertReleased(recovery.subscriptionId, recoveryKey);

  const recoveredPayment = await Payment.findById(recovery.payment._id).lean();
  assert.strictEqual(recoveredPayment.metadata.entitlementReleasePending, false);
  assert(recoveredPayment.metadata.entitlementAllocationsReleasedAt);

  console.log("subscriptionEntitlementReservationRecovery.test.js passed");
}

run()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      assert(mongoose.connection.name.startsWith(DB_PREFIX));
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  });
