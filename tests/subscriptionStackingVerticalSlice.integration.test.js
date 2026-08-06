"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require("../src/models/SubscriptionEntitlementDayBlueprint");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementCompensation = require("../src/models/SubscriptionEntitlementCompensation");
const {
  projectSubscriptionEntitlements,
} = require("../src/services/subscription/subscriptionEntitlementProjectionService");
const {
  materializeEntitlementDayBlueprint,
  reserveBlueprintAllocationsTransactional,
} = require("../src/services/subscription/subscriptionEntitlementLedgerService");
const {
  transitionStackingDayEntitlementsTransactional,
} = require("../src/services/subscription/subscriptionStackingFulfillmentLedgerService");
const {
  applyStackingCompensationTransactional,
  revokeStackingCompensationTransactional,
} = require("../src/services/subscription/subscriptionStackingCompensationService");

let replSet;

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: "subscription_stacking_vertical_slice",
  });
  await Promise.all([
    Subscription.syncIndexes(),
    SubscriptionDay.syncIndexes(),
    SubscriptionEntitlementBatch.syncIndexes(),
    SubscriptionEntitlementDayBlueprint.syncIndexes(),
    SubscriptionEntitlementAllocation.syncIndexes(),
    SubscriptionEntitlementCompensation.syncIndexes(),
  ]);
}

async function disconnect() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function seedStack() {
  const userId = new mongoose.Types.ObjectId();
  const oldPlanId = new mongoose.Types.ObjectId();
  const newPlanId = new mongoose.Types.ObjectId();
  const container = await Subscription.create({
    userId,
    planId: oldPlanId,
    status: "active",
    startDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-31"),
    validityEndDate: ksaDate("2026-08-31"),
    totalMeals: 130,
    remainingMeals: 72,
    selectedMealsPerDay: 5,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliveryAddress: {
      city: "Riyadh",
      district: "Olaya",
      street: "Test",
    },
    skipDaysUsed: 0,
  });

  const [oldBatch, newBatch] = await SubscriptionEntitlementBatch.create([
    {
      userId,
      containerSubscriptionId: container._id,
      planId: oldPlanId,
      sourceKey: `legacy:${container._id}`,
      sourceType: "legacy_seed",
      requestedStartDate: ksaDate("2026-08-01"),
      effectiveStartDate: ksaDate("2026-08-01"),
      endDate: ksaDate("2026-08-26"),
      validityEndDate: ksaDate("2026-08-26"),
      baseValidityEndDate: ksaDate("2026-08-26"),
      daysCount: 26,
      mealsPerDay: 3,
      proteinGrams: 200,
      totalMeals: 78,
      remainingMeals: 20,
      reservedMeals: 0,
      consumedMeals: 58,
      forfeitedMeals: 0,
      deliverySnapshot: {
        mode: "delivery",
        address: container.deliveryAddress,
        slot: { type: "delivery", window: "13:00-15:00" },
      },
      status: "active",
      applicationState: "applied",
      appliedAt: new Date(),
      activatedAt: new Date(),
    },
    {
      userId,
      containerSubscriptionId: container._id,
      planId: newPlanId,
      paymentId: new mongoose.Types.ObjectId(),
      checkoutDraftId: new mongoose.Types.ObjectId(),
      sourceKey: `payment:${new mongoose.Types.ObjectId()}`,
      sourceType: "checkout",
      requestedStartDate: ksaDate("2026-08-06"),
      effectiveStartDate: ksaDate("2026-08-06"),
      endDate: ksaDate("2026-08-31"),
      validityEndDate: ksaDate("2026-08-31"),
      baseValidityEndDate: ksaDate("2026-08-31"),
      daysCount: 26,
      mealsPerDay: 2,
      proteinGrams: 150,
      totalMeals: 52,
      remainingMeals: 52,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      deliverySnapshot: {
        mode: "delivery",
        address: container.deliveryAddress,
        slot: { type: "delivery", window: "13:00-15:00" },
      },
      status: "active",
      applicationState: "applied",
      appliedAt: new Date(),
      activatedAt: new Date(),
    },
  ]);

  const day = await SubscriptionDay.create({
    subscriptionId: container._id,
    date: "2026-08-06",
    status: "open",
    plannerState: "draft",
    planningState: "draft",
    mealSlots: [],
  });

  return { userId, container, oldBatch, newBatch, day };
}

async function testFullTransactionalSlice() {
  const seeded = await seedStack();
  const initialBatches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: seeded.container._id,
  }).sort({ validityEndDate: 1, _id: 1 }).lean();

  const projection = projectSubscriptionEntitlements({
    batches: initialBatches,
    businessDate: "2026-08-06",
  });
  assert.strictEqual(projection.mealBalance.remainingMeals, 72);
  assert.strictEqual(projection.requiredMealsPerDay, 5);
  assert.strictEqual(projection.hasMixedProteinGrams, true);
  assert.deepStrictEqual(
    projection.grams.map((row) => [row.proteinGrams, row.mealsPerDay]),
    [[150, 2], [200, 3]]
  );

  const reservation = await withTransaction(async (session) => {
    const batches = await SubscriptionEntitlementBatch.find({
      containerSubscriptionId: seeded.container._id,
    }).sort({ validityEndDate: 1, _id: 1 }).session(session).lean();
    const materialized = await materializeEntitlementDayBlueprint({
      userId: seeded.userId,
      containerSubscriptionId: seeded.container._id,
      date: "2026-08-06",
      batches,
      session,
    });
    assert.strictEqual(materialized.blueprint.requiredSlotCount, 5);
    assert.deepStrictEqual(
      materialized.blueprint.slots.map((slot) => slot.proteinGrams),
      [200, 200, 200, 150, 150]
    );
    return reserveBlueprintAllocationsTransactional({
      userId: seeded.userId,
      containerSubscriptionId: seeded.container._id,
      blueprint: materialized.blueprint,
      subscriptionDayId: seeded.day._id,
      plannerRevisionHash: "vertical-slice-r1",
      operationIdempotencyKeyPrefix: "vertical-slice-confirm",
      session,
    });
  });

  assert.strictEqual(reservation.allocationCount, 5);
  assert.strictEqual(reservation.newlyReservedCount, 5);
  const reservedBatches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: seeded.container._id,
  }).sort({ proteinGrams: -1 }).lean();
  const oldReserved = reservedBatches.find((row) => row.proteinGrams === 200);
  const newReserved = reservedBatches.find((row) => row.proteinGrams === 150);
  assert.deepStrictEqual(
    [oldReserved.remainingMeals, oldReserved.reservedMeals],
    [17, 3]
  );
  assert.deepStrictEqual(
    [newReserved.remainingMeals, newReserved.reservedMeals],
    [50, 2]
  );

  await withTransaction((session) => transitionStackingDayEntitlementsTransactional({
    containerSubscriptionId: seeded.container._id,
    day: seeded.day,
    toState: "consumed",
    businessDate: "2026-08-06",
    session,
  }));

  const consumedBatches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: seeded.container._id,
  }).sort({ proteinGrams: -1 }).lean();
  const oldConsumed = consumedBatches.find((row) => row.proteinGrams === 200);
  const newConsumed = consumedBatches.find((row) => row.proteinGrams === 150);
  assert.deepStrictEqual(
    [oldConsumed.remainingMeals, oldConsumed.reservedMeals, oldConsumed.consumedMeals],
    [17, 0, 61]
  );
  assert.deepStrictEqual(
    [newConsumed.remainingMeals, newConsumed.reservedMeals, newConsumed.consumedMeals],
    [50, 0, 2]
  );
  assert.strictEqual(
    await SubscriptionEntitlementAllocation.countDocuments({ state: "consumed" }),
    5
  );

  const compensated = await withTransaction((session) => (
    applyStackingCompensationTransactional({
      containerSubscriptionId: seeded.container._id,
      userId: seeded.userId,
      sourceDate: "2026-08-07",
      actionType: "skip",
      businessDate: "2026-08-06",
      session,
    })
  ));
  assert.strictEqual(compensated.idempotent, false);
  assert.strictEqual(compensated.tokenResults.length, 2);
  assert.strictEqual(
    await SubscriptionEntitlementCompensation.countDocuments({ state: "active" }),
    2
  );

  const extended = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: seeded.container._id,
  }).sort({ proteinGrams: -1 }).lean();
  assert.strictEqual(
    extended.find((row) => row.proteinGrams === 200).compensationDays,
    1
  );
  assert.strictEqual(
    extended.find((row) => row.proteinGrams === 150).compensationDays,
    1
  );

  const revoked = await withTransaction((session) => (
    revokeStackingCompensationTransactional({
      containerSubscriptionId: seeded.container._id,
      userId: seeded.userId,
      sourceDate: "2026-08-07",
      actionType: "skip",
      businessDate: "2026-08-06",
      session,
    })
  ));
  assert.strictEqual(revoked.idempotent, false);
  assert.strictEqual(
    await SubscriptionEntitlementCompensation.countDocuments({ state: "revoked" }),
    2
  );
  const restored = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: seeded.container._id,
  }).lean();
  assert(restored.every((row) => row.compensationDays === 0));
}

async function run() {
  await connect();
  try {
    await testFullTransactionalSlice();
    console.log("subscription stacking vertical slice integration passed");
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
