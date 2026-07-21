"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");
const {
  findAddonBalanceBucket,
} = require("../src/services/subscription/subscriptionAddonPolicyService");
const {
  findCurrentActiveSubscriptionForUser,
  selectCurrentSubscription,
} = require("../src/services/subscription/subscriptionCurrentResolverService");

function subscription({ id, createdAt, startDate, endDate, status = "active" }) {
  return {
    _id: id || new mongoose.Types.ObjectId(),
    status,
    createdAt: new Date(createdAt),
    startDate: new Date(`${startDate}T00:00:00.000+03:00`),
    endDate: new Date(`${endDate}T23:59:59.999+03:00`),
    validityEndDate: new Date(`${endDate}T23:59:59.999+03:00`),
  };
}

function queryFor(rows) {
  let result = [...rows];
  const query = {
    sort(spec) {
      if (spec && spec.createdAt === -1) {
        result.sort((left, right) => right.createdAt - left.createdAt || String(right._id).localeCompare(String(left._id)));
      }
      return query;
    },
    limit(value) {
      if (value > 0) result = result.slice(0, value);
      return query;
    },
    lean() { return query; },
    session() { return query; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return query;
}

async function run() {
  const businessDate = "2026-07-16";
  const expiredNewest = subscription({
    createdAt: "2026-07-16T12:00:00.000Z",
    startDate: "2026-07-01",
    endDate: "2026-07-15",
  });
  const currentNew = subscription({
    createdAt: "2026-07-16T11:00:00.000Z",
    startDate: "2026-07-16",
    endDate: "2026-07-22",
  });
  const currentOld = subscription({
    createdAt: "2026-07-15T11:00:00.000Z",
    startDate: "2026-07-14",
    endDate: "2026-07-20",
  });
  const future = subscription({
    createdAt: "2026-07-17T11:00:00.000Z",
    startDate: "2026-07-17",
    endDate: "2026-07-24",
  });

  const selected = selectCurrentSubscription(
    [future, expiredNewest, currentNew, currentOld],
    { businessDate }
  );
  assert.strictEqual(selected.subscription, currentNew);
  assert.strictEqual(selected.reason, "newest_active_in_current_date_window");
  assert.deepStrictEqual(
    selected.evaluated.filter((row) => !row.evaluation.eligible).map((row) => row.evaluation.reason),
    ["not_started", "date_window_ended"]
  );

  const upcomingOnly = selectCurrentSubscription(
    [future, expiredNewest],
    { businessDate, includeUpcoming: true }
  );
  assert.strictEqual(upcomingOnly.subscription, future);
  assert.strictEqual(upcomingOnly.reason, "newest_active_upcoming_subscription");

  const strictCurrentOnly = selectCurrentSubscription(
    [future, expiredNewest],
    { businessDate }
  );
  assert.strictEqual(strictCurrentOnly.subscription, null);

  // The resolver performs a fresh query on every call. A newly created/current
  // subscription therefore replaces the old result without cache invalidation.
  const batches = [[currentOld], [currentNew, currentOld]];
  const SubscriptionModel = {
    find() { return queryFor(batches.shift() || []); },
  };
  const first = await findCurrentActiveSubscriptionForUser(new mongoose.Types.ObjectId(), {
    SubscriptionModel,
    businessDate,
    context: "resolver_cache_regression_first",
  });
  const second = await findCurrentActiveSubscriptionForUser(new mongoose.Types.ObjectId(), {
    SubscriptionModel,
    businessDate,
    context: "resolver_cache_regression_second",
  });
  assert.strictEqual(first, currentOld);
  assert.strictEqual(second, currentNew);

  const planA = new mongoose.Types.ObjectId();
  const planB = new mongoose.Types.ObjectId();
  const planABucket = { _id: new mongoose.Types.ObjectId(), addonPlanId: planA, addonId: planA, category: "snack" };
  const planBBucket = { _id: new mongoose.Types.ObjectId(), addonPlanId: planB, addonId: planB, category: "snack" };
  const wallet = { addonBalance: [planABucket, planBBucket] };
  assert.strictEqual(
    findAddonBalanceBucket(wallet, { balanceBucketId: planABucket._id, addonPlanId: planB, category: "snack" }),
    planABucket,
    "explicit balanceBucketId has highest lookup priority"
  );
  assert.strictEqual(
    findAddonBalanceBucket(wallet, { balanceBucketId: new mongoose.Types.ObjectId(), addonPlanId: planB }),
    null,
    "unknown explicit balanceBucketId fails closed instead of falling through to another plan"
  );
  assert.strictEqual(findAddonBalanceBucket(wallet, { addonPlanId: planB, category: "juice" }), planBBucket);
  assert.strictEqual(findAddonBalanceBucket(wallet, { category: "snack" }), null, "ambiguous category fallback never collapses plans");

  const persistedIdentity = {
    addonId: planA,
    addonPlanId: planA,
    addonPlanName: "Ice cream",
    addonPlanNameI18n: { ar: "آيس كريم", en: "Ice cream" },
    category: "snack",
    allowanceCategory: "snack",
    displayKey: "ice_cream",
    displayCategory: "ice_cream",
    entitlementKey: `snack:${planA}`,
    sourceRequestShape: "object",
    includedTotalQty: 7,
  };
  const draft = new CheckoutDraft({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    idempotencyKey: "resolver-persistence-test",
    requestHash: "resolver-persistence-hash",
    daysCount: 7,
    grams: 200,
    mealsPerDay: 1,
    addonSubscriptions: [persistedIdentity],
  });
  const subscriptionDoc = new Subscription({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    totalMeals: 7,
    remainingMeals: 7,
    deliveryMode: "pickup",
    addonSubscriptions: [persistedIdentity],
  });
  for (const row of [draft.addonSubscriptions[0], subscriptionDoc.addonSubscriptions[0]]) {
    assert.strictEqual(row.allowanceCategory, "snack");
    assert.strictEqual(row.displayKey, "ice_cream");
    assert.strictEqual(row.displayCategory, "ice_cream");
    assert.strictEqual(row.entitlementKey, `snack:${planA}`);
    assert.strictEqual(row.sourceRequestShape, "object");
  }

  console.log("subscription current resolver tests passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
