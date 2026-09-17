"use strict";

const assert = require("assert");
const {
  buildCancellationBalanceUpdate,
  buildCancellationFallbackUpdate,
  entitlementVersionGuard,
} = require("../src/services/subscription/subscriptionCancellationService");

function run() {
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

  console.log("subscription cancellation balance policy tests passed");
}

run();
