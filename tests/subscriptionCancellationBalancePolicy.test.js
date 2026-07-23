"use strict";

const assert = require("assert");
const Subscription = require("../src/models/Subscription");
const {
  buildCancellationBalanceUpdate,
  buildCancellationFallbackUpdate,
  cancelSubscriptionDomain,
  entitlementVersionGuard,
} = require("../src/services/subscription/subscriptionCancellationService");

function testBalanceUpdateShapes() {
  const canceledAt = new Date("2026-07-22T00:00:00.000Z");
  const canonical = {
    entitlementVersion: 2,
    remainingMeals: 8,
    forfeitedMeals: 1,
  };
  const canonicalUpdate = buildCancellationBalanceUpdate(canonical, 6);
  assert.deepStrictEqual(canonicalUpdate, {
    $inc: { remainingMeals: -6, forfeitedMeals: 6 },
  });
  assert.deepStrictEqual(entitlementVersionGuard(canonical), { entitlementVersion: 2 });

  const fallback = buildCancellationFallbackUpdate(
    canonical,
    2,
    canceledAt,
    { cancellationReason: "customer_request" }
  );
  assert(Array.isArray(fallback), "canonical fallback must use one atomic update pipeline");
  assert.deepStrictEqual(fallback[0].$set.remainingMeals, { $min: ["$remainingMeals", 2] });
  assert.deepStrictEqual(fallback[0].$set.forfeitedMeals, {
    $add: [
      { $ifNull: ["$forfeitedMeals", 0] },
      { $max: [0, { $subtract: ["$remainingMeals", 2] }] },
    ],
  });

  const legacy = { remainingMeals: 8 };
  assert.deepStrictEqual(buildCancellationBalanceUpdate(legacy, 6), {
    $inc: { remainingMeals: -6 },
  });
  assert.deepStrictEqual(
    buildCancellationFallbackUpdate(legacy, 2, canceledAt, {}).$set.remainingMeals,
    2
  );
  assert(Array.isArray(entitlementVersionGuard(legacy).$or));
}

async function testCancellationRefreshesUpgradedLedger() {
  const originalFindOneAndUpdate = Subscription.findOneAndUpdate;
  const initialSubscription = {
    _id: "subscription-refresh-test",
    userId: "user-refresh-test",
    status: "active",
    totalMeals: 4,
    remainingMeals: 4,
    entitlementVersion: undefined,
  };
  const upgradedSubscription = {
    ...initialSubscription,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
  };
  let readCount = 0;
  let capturedQuery = null;
  let capturedUpdate = null;

  Subscription.findOneAndUpdate = async (query, update) => {
    capturedQuery = query;
    capturedUpdate = update;
    return {
      ...upgradedSubscription,
      status: "canceled",
      remainingMeals: 0,
      forfeitedMeals: 4,
    };
  };

  try {
    const result = await cancelSubscriptionDomain({
      subscriptionId: initialSubscription._id,
      actor: { kind: "system" },
      session: {},
      reason: "replaced_by_new_subscription",
      runtime: {
        async findSubscriptionById() {
          readCount += 1;
          return readCount === 1 ? { ...initialSubscription } : { ...upgradedSubscription };
        },
        async countUndeductedCommittedDays() {
          return 0;
        },
        async findFutureOpenAndFrozenDays() {
          return [];
        },
        async deleteFutureOpenAndFrozenDays() {
          return { deletedCount: 0 };
        },
        resolveMealsPerDay() {
          return 2;
        },
        async getTodayKSADate() {
          return "2026-07-23";
        },
        now() {
          return new Date("2026-07-23T12:00:00.000Z");
        },
      },
    });

    assert.strictEqual(result.outcome, "canceled");
    assert.strictEqual(readCount, 2, "cancellation re-reads the subscription after day releases");
    assert.strictEqual(capturedQuery.entitlementVersion, 2, "CAS uses the upgraded ledger version");
    assert.deepStrictEqual(capturedUpdate.$inc, {
      remainingMeals: -4,
      forfeitedMeals: 4,
    });
  } finally {
    Subscription.findOneAndUpdate = originalFindOneAndUpdate;
  }
}

async function run() {
  testBalanceUpdateShapes();
  await testCancellationRefreshesUpgradedLedger();
  console.log("subscription cancellation balance policy tests passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
