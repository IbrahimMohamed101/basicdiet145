"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

mongoose.set("autoIndex", false);

const SubscriptionExtraEntitlementBucket = require("../src/models/SubscriptionExtraEntitlementBucket");
const {
  buildExtraBucketPayloadsFromBatch,
  deriveConservedCounters,
  ensureExtraBucketsForBatch,
  projectExtraEntitlements,
} = require("../src/services/subscription/subscriptionExtraEntitlementBucketService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function buildBatch(overrides = {}) {
  const addonPlanId = oid();
  const addonId = oid();
  return {
    _id: oid(),
    userId: oid(),
    containerSubscriptionId: oid(),
    sourceKey: `payment:${oid()}`,
    sourceType: "checkout",
    applicationState: "applied",
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T23:59:59+03:00"),
    premiumSnapshot: [
      {
        _id: oid(),
        premiumKey: "shrimp",
        configId: oid(),
        revision: 3,
        proteinId: oid(),
        purchasedQty: 4,
        remainingQty: 2,
        reservedQty: 1,
        consumedQty: 1,
        unitExtraFeeHalala: 2500,
        totalHalala: 10000,
        currency: "SAR",
      },
      {
        _id: oid(),
        premiumKey: "salmon",
        configId: oid(),
        revision: 2,
        proteinId: oid(),
        purchasedQty: 2,
        remainingQty: 2,
        reservedQty: 0,
        consumedQty: 0,
        unitExtraFeeHalala: 1800,
        totalHalala: 3600,
        currency: "SAR",
      },
    ],
    addonSnapshot: {
      subscriptions: [
        {
          addonId,
          addonPlanId,
          entitlementKey: "salad:daily",
          category: "salad",
          allowanceCategory: "salad",
          purchasedDailyQty: 1,
          includedTotalQty: 10,
          unitPriceHalala: 500,
          totalHalala: 5000,
          currency: "SAR",
        },
      ],
      balances: [
        {
          _id: oid(),
          balanceBucketId: oid(),
          addonId,
          addonPlanId,
          entitlementKey: "salad:daily",
          category: "salad",
          allowanceCategory: "salad",
          purchasedDailyQty: 1,
          includedTotalQty: 10,
          purchasedQty: 10,
          remainingQty: 7,
          reservedQty: 1,
          consumedQty: 2,
          unitPriceHalala: 500,
          overageUnitPriceHalala: 650,
          currency: "SAR",
        },
      ],
    },
    ...overrides,
  };
}

function testCounterConservation() {
  assert.deepStrictEqual(
    deriveConservedCounters({
      purchasedQty: 6,
      remainingQty: 2,
      reservedQty: 1,
      consumedQty: 1,
    }),
    {
      purchasedQty: 6,
      remainingQty: 2,
      reservedQty: 1,
      consumedQty: 1,
      forfeitedQty: 2,
    }
  );

  // Historical counters are authority. If their observed sum is larger than
  // the stale purchasedQty field, preserve the observed credits instead of
  // dropping them or creating a negative forfeiture.
  assert.deepStrictEqual(
    deriveConservedCounters({
      purchasedQty: 2,
      remainingQty: 2,
      reservedQty: 1,
      consumedQty: 1,
    }),
    {
      purchasedQty: 4,
      remainingQty: 2,
      reservedQty: 1,
      consumedQty: 1,
      forfeitedQty: 0,
    }
  );
}

function testSnapshotBuildDoesNotMintAddonEntitlementWithoutBalance() {
  const batch = buildBatch();
  const payloads = buildExtraBucketPayloadsFromBatch(batch);
  assert.strictEqual(payloads.length, 3);
  assert.strictEqual(payloads.filter((row) => row.kind === "premium").length, 2);
  assert.strictEqual(payloads.filter((row) => row.kind === "addon").length, 1);
  assert.ok(payloads.every((row) => (
    row.purchasedQty
      === row.remainingQty + row.reservedQty + row.consumedQty + row.forfeitedQty
  )));

  const entitlementOnly = buildBatch({
    premiumSnapshot: [],
    addonSnapshot: {
      subscriptions: [{
        addonId: oid(),
        addonPlanId: oid(),
        entitlementKey: "historical:missing-balance",
        category: "snack",
        includedTotalQty: 20,
      }],
      balances: [],
    },
  });
  assert.deepStrictEqual(buildExtraBucketPayloadsFromBatch(entitlementOnly), []);
}

function testDateProjectionAndOverlap() {
  const legacy = buildBatch({ sourceType: "legacy_seed" });
  const legacyBuckets = buildExtraBucketPayloadsFromBatch(legacy).map((row) => ({
    _id: oid(),
    ...row,
  }));

  const future = buildBatch({
    userId: legacy.userId,
    containerSubscriptionId: legacy.containerSubscriptionId,
    sourceKey: `payment:${oid()}`,
    effectiveStartDate: new Date("2026-09-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-26T23:59:59+03:00"),
    premiumSnapshot: [{
      _id: oid(),
      premiumKey: "shrimp",
      configId: legacy.premiumSnapshot[0].configId,
      revision: 3,
      purchasedQty: 3,
      remainingQty: 3,
      unitExtraFeeHalala: 2500,
      currency: "SAR",
    }],
    addonSnapshot: { subscriptions: [], balances: [] },
  });
  const futureBuckets = buildExtraBucketPayloadsFromBatch(future).map((row) => ({
    _id: oid(),
    ...row,
  }));

  const august = projectExtraEntitlements({
    buckets: [...legacyBuckets, ...futureBuckets],
    businessDate: "2026-08-11",
  });
  assert.strictEqual(august.eligibleBucketCount, 3);
  assert.strictEqual(august.premiumTotals.purchasedQty, 6);
  assert.strictEqual(august.premiumTotals.remainingQty, 4);
  assert.strictEqual(august.addonTotals.purchasedQty, 10);
  assert.strictEqual(august.addonTotals.remainingQty, 7);
  assert.strictEqual(august.premium.find((row) => row.key === "shrimp").fundingBuckets.length, 1);

  const september = projectExtraEntitlements({
    buckets: [...legacyBuckets, ...futureBuckets],
    businessDate: "2026-09-05",
  });
  assert.strictEqual(september.eligibleBucketCount, 1);
  assert.strictEqual(september.premiumTotals.purchasedQty, 3);
  assert.strictEqual(september.premiumTotals.remainingQty, 3);

  const overlap = buildBatch({
    userId: legacy.userId,
    containerSubscriptionId: legacy.containerSubscriptionId,
    sourceKey: `payment:${oid()}`,
    effectiveStartDate: new Date("2026-08-10T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-20T23:59:59+03:00"),
    premiumSnapshot: [{
      _id: oid(),
      premiumKey: "shrimp",
      configId: legacy.premiumSnapshot[0].configId,
      revision: 3,
      purchasedQty: 3,
      remainingQty: 3,
      unitExtraFeeHalala: 2500,
      currency: "SAR",
    }],
    addonSnapshot: { subscriptions: [], balances: [] },
  });
  const overlapBuckets = buildExtraBucketPayloadsFromBatch(overlap).map((row) => ({
    _id: oid(),
    ...row,
  }));
  const projectedOverlap = projectExtraEntitlements({
    buckets: [...legacyBuckets, ...overlapBuckets],
    businessDate: "2026-08-11",
  });
  const shrimp = projectedOverlap.premium.find((row) => row.key === "shrimp");
  assert.strictEqual(shrimp.purchasedQty, 7);
  assert.strictEqual(shrimp.remainingQty, 5);
  assert.strictEqual(shrimp.reservedQty, 1);
  assert.strictEqual(shrimp.consumedQty, 1);
  assert.strictEqual(shrimp.fundingBuckets.length, 2);
}

async function testPersistenceReplayDoesNotResetMutableCounters() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  try {
    await mongoose.connect(replSet.getUri(), { autoIndex: false });
    await SubscriptionExtraEntitlementBucket.syncIndexes();

    const batch = buildBatch();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await ensureExtraBucketsForBatch({ batch, session });
      await session.commitTransaction();
    } finally {
      await session.endSession();
    }

    const initialRows = await SubscriptionExtraEntitlementBucket.find({
      entitlementBatchId: batch._id,
    }).lean();
    assert.strictEqual(initialRows.length, 3);

    const shrimp = initialRows.find((row) => row.kind === "premium" && row.premiumKey === "shrimp");
    assert.ok(shrimp);
    await SubscriptionExtraEntitlementBucket.updateOne(
      { _id: shrimp._id, remainingQty: 2, reservedQty: 1, consumedQty: 1 },
      { $set: { remainingQty: 1, reservedQty: 1, consumedQty: 2 } }
    );

    const replaySession = await mongoose.startSession();
    try {
      replaySession.startTransaction();
      await ensureExtraBucketsForBatch({ batch, session: replaySession });
      await replaySession.commitTransaction();
    } finally {
      await replaySession.endSession();
    }

    const afterReplay = await SubscriptionExtraEntitlementBucket.findById(shrimp._id).lean();
    assert.strictEqual(afterReplay.remainingQty, 1);
    assert.strictEqual(afterReplay.reservedQty, 1);
    assert.strictEqual(afterReplay.consumedQty, 2);
    assert.strictEqual(afterReplay.purchasedQty, 4);

    const changedSnapshot = {
      ...batch,
      premiumSnapshot: batch.premiumSnapshot.map((row, index) => (
        index === 0 ? { ...row, purchasedQty: 5, remainingQty: 3 } : row
      )),
    };
    const conflictSession = await mongoose.startSession();
    try {
      conflictSession.startTransaction();
      await assert.rejects(
        () => ensureExtraBucketsForBatch({ batch: changedSnapshot, session: conflictSession }),
        (err) => Boolean(err && err.code === "STACKING_EXTRA_WALLET_IDEMPOTENCY_CONFLICT")
      );
      await conflictSession.abortTransaction();
    } finally {
      await conflictSession.endSession();
    }
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop();
  }
}

async function run() {
  testCounterConservation();
  testSnapshotBuildDoesNotMintAddonEntitlementWithoutBalance();
  testDateProjectionAndOverlap();
  await testPersistenceReplayDoesNotResetMutableCounters();
  console.log("subscription extra entitlement bucket tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
