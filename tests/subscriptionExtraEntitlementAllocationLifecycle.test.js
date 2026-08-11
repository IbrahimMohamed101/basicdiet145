"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

mongoose.set("autoIndex", false);

const SubscriptionExtraEntitlementBucket = require("../src/models/SubscriptionExtraEntitlementBucket");
const SubscriptionExtraEntitlementAllocation = require("../src/models/SubscriptionExtraEntitlementAllocation");
const {
  assertPersistedBucketConservation,
  consumeReservedExtraEntitlements,
  releaseReservedExtraEntitlements,
  reserveExtraEntitlements,
  reserveExtraEntitlementsTransactional,
} = require("../src/services/subscription/subscriptionExtraEntitlementAllocationService");

const BUSINESS_DATE = "2026-08-11";
const ACTIVE_START = new Date("2026-08-01T00:00:00+03:00");
const ACTIVE_END = new Date("2026-08-26T23:59:59+03:00");
const CONCURRENCY_OPTIONS = { maxRetries: 24, baseDelayMs: 2 };

let replSet;

function oid() {
  return new mongoose.Types.ObjectId();
}

function context() {
  return {
    userId: oid(),
    containerSubscriptionId: oid(),
  };
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: "subscription_extra_entitlement_allocation_p1",
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(
    replSet.getUri("subscription_extra_entitlement_allocation_p1"),
    { serverSelectionTimeoutMS: 10000, autoIndex: false }
  );
  await Promise.all([
    SubscriptionExtraEntitlementBucket.syncIndexes(),
    SubscriptionExtraEntitlementAllocation.syncIndexes(),
  ]);
}

async function disconnect() {
  await mongoose.disconnect().catch(() => {});
  if (replSet) await replSet.stop();
}

async function resetCollections() {
  await Promise.all([
    SubscriptionExtraEntitlementAllocation.deleteMany({}),
    SubscriptionExtraEntitlementBucket.deleteMany({}),
  ]);
}

async function seedBucket({
  bucketId = oid(),
  ctx,
  kind,
  total,
  remaining = total,
  reserved = 0,
  consumed = 0,
  forfeited = 0,
  effectiveStartDate = ACTIVE_START,
  validityEndDate = ACTIVE_END,
  applicationState = "applied",
  premiumKey = "",
  addonId = null,
  addonPlanId = null,
  entitlementKey = "",
  category = "",
  sourceBalanceBucketId = oid(),
}) {
  const entitlementBatchId = oid();
  const walletIdentity = kind === "premium"
    ? `premium:${premiumKey}:config:${oid()}`
    : `addon:${String(addonPlanId || "none")}:${String(addonId || "none")}:${entitlementKey}`;
  return SubscriptionExtraEntitlementBucket.create({
    _id: bucketId,
    bucketKey: `${entitlementBatchId}:${walletIdentity}`,
    kind,
    walletKey: walletIdentity,
    userId: ctx.userId,
    containerSubscriptionId: ctx.containerSubscriptionId,
    entitlementBatchId,
    sourceKey: `payment:${oid()}`,
    sourceType: "checkout",
    premiumKey,
    configId: kind === "premium" ? oid() : null,
    revision: kind === "premium" ? 1 : 0,
    proteinId: kind === "premium" ? oid() : null,
    addonId,
    addonPlanId,
    entitlementKey,
    category,
    allowanceCategory: category,
    purchasedQty: total,
    remainingQty: remaining,
    reservedQty: reserved,
    consumedQty: consumed,
    forfeitedQty: forfeited,
    effectiveStartDate,
    validityEndDate,
    applicationState,
    metadata: { sourceBalanceBucketId: String(sourceBalanceBucketId) },
  });
}

function premiumRequest(ctx, reservationKey, overrides = {}) {
  return {
    ...ctx,
    reservationKey,
    sourceKey: `planner:${reservationKey}`,
    businessDate: BUSINESS_DATE,
    kind: "premium",
    premiumKey: "shrimp",
    quantity: 1,
    ...overrides,
  };
}

function addonRequest(ctx, reservationKey, addonId, overrides = {}) {
  return {
    ...ctx,
    reservationKey,
    sourceKey: `planner:${reservationKey}`,
    businessDate: BUSINESS_DATE,
    kind: "addon",
    addonId,
    entitlementKey: "juice:daily",
    category: "juice",
    quantity: 1,
    ...overrides,
  };
}

async function readBucket(bucket) {
  const row = await SubscriptionExtraEntitlementBucket.findById(bucket._id).lean();
  assertPersistedBucketConservation(row);
  return row;
}

function assertCounters(bucket, expected) {
  assert.deepStrictEqual(
    {
      remaining: bucket.remainingQty,
      reserved: bucket.reservedQty,
      consumed: bucket.consumedQty,
      forfeited: bucket.forfeitedQty,
      total: bucket.purchasedQty,
    },
    expected
  );
}

async function assertRejectCode(work, code) {
  await assert.rejects(
    work,
    (err) => Boolean(err && err.code === code),
    `expected ${code}`
  );
}

async function testPremiumReserveConsumeAndReplay() {
  const ctx = context();
  const bucket = await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 4 });
  const request = premiumRequest(ctx, "premium-consume", { quantity: 1 });

  const reserved = await reserveExtraEntitlements(request);
  assert.strictEqual(reserved.idempotent, false);
  assert.strictEqual(reserved.newlyReservedCount, 1);
  assertCounters(await readBucket(bucket), {
    remaining: 3,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });

  for (let replay = 0; replay < 10; replay += 1) {
    const repeated = await reserveExtraEntitlements(request);
    assert.strictEqual(repeated.idempotent, true);
    assert.strictEqual(repeated.newlyReservedCount, 0);
  }
  assert.strictEqual(
    await SubscriptionExtraEntitlementAllocation.countDocuments({ reservationKey: request.reservationKey }),
    1
  );
  assertCounters(await readBucket(bucket), {
    remaining: 3,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });

  const consumed = await consumeReservedExtraEntitlements({
    ...ctx,
    reservationKey: request.reservationKey,
  });
  assert.strictEqual(consumed.idempotent, false);
  assertCounters(await readBucket(bucket), {
    remaining: 3,
    reserved: 0,
    consumed: 1,
    forfeited: 0,
    total: 4,
  });
  const replayedConsume = await consumeReservedExtraEntitlements({
    ...ctx,
    reservationKey: request.reservationKey,
  });
  assert.strictEqual(replayedConsume.idempotent, true);
  const reserveReplayAfterConsume = await reserveExtraEntitlements(request);
  assert.strictEqual(reserveReplayAfterConsume.idempotent, true);
  assert.strictEqual(reserveReplayAfterConsume.state, "consumed");
  await assertRejectCode(
    () => releaseReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey }),
    "STACKING_EXTRA_ALLOCATION_STATE_CONFLICT"
  );
}

async function testPremiumReserveReleaseAndReplay() {
  const ctx = context();
  const bucket = await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 4 });
  const request = premiumRequest(ctx, "premium-release");

  await reserveExtraEntitlements(request);
  const released = await releaseReservedExtraEntitlements({
    ...ctx,
    reservationKey: request.reservationKey,
  });
  assert.strictEqual(released.idempotent, false);
  assertCounters(await readBucket(bucket), {
    remaining: 4,
    reserved: 0,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });
  const replayed = await releaseReservedExtraEntitlements({
    ...ctx,
    reservationKey: request.reservationKey,
  });
  assert.strictEqual(replayed.idempotent, true);
  const reserveReplayAfterRelease = await reserveExtraEntitlements(request);
  assert.strictEqual(reserveReplayAfterRelease.idempotent, true);
  assert.strictEqual(reserveReplayAfterRelease.state, "released");
  await assertRejectCode(
    () => consumeReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey }),
    "STACKING_EXTRA_ALLOCATION_STATE_CONFLICT"
  );
}

async function testReservationPayloadConflictFailsClosed() {
  const ctx = context();
  await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 4 });
  await reserveExtraEntitlements(premiumRequest(ctx, "premium-payload-conflict"));
  await assertRejectCode(
    () => reserveExtraEntitlements(premiumRequest(ctx, "premium-payload-conflict", { quantity: 2 })),
    "STACKING_EXTRA_RESERVATION_IDEMPOTENCY_CONFLICT"
  );
}

async function testConcurrentSamePremiumReservationOnlyDebitsOnce() {
  const ctx = context();
  const bucket = await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 4 });
  const request = premiumRequest(ctx, "premium-same-concurrent", {
    transactionOptions: CONCURRENCY_OPTIONS,
  });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => reserveExtraEntitlements(request))
  );
  assert.strictEqual(results.filter((row) => !row.idempotent).length, 1);
  assert.strictEqual(
    await SubscriptionExtraEntitlementAllocation.countDocuments({ reservationKey: request.reservationKey }),
    1
  );
  assertCounters(await readBucket(bucket), {
    remaining: 3,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });
}

async function testConcurrentDistinctPremiumReservationsNeverOverspend() {
  const ctx = context();
  const bucket = await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 5 });
  const settled = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => reserveExtraEntitlements(
      premiumRequest(ctx, `premium-distinct-${index}`, {
        transactionOptions: CONCURRENCY_OPTIONS,
      })
    ))
  );
  const fulfilled = settled.filter((row) => row.status === "fulfilled");
  const rejected = settled.filter((row) => row.status === "rejected");
  assert.strictEqual(fulfilled.length, 5);
  assert.strictEqual(rejected.length, 15);
  assert.ok(rejected.every((row) => (
    row.reason && row.reason.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  )));
  assert.strictEqual(await SubscriptionExtraEntitlementAllocation.countDocuments({}), 5);
  assertCounters(await readBucket(bucket), {
    remaining: 0,
    reserved: 5,
    consumed: 0,
    forfeited: 0,
    total: 5,
  });
}

async function testConcurrentTerminalTransitionsAreExactlyOnce() {
  const consumeContext = context();
  const consumeBucket = await seedBucket({
    ctx: consumeContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 2,
  });
  const consumeRequest = premiumRequest(consumeContext, "premium-concurrent-consume");
  await reserveExtraEntitlements(consumeRequest);
  const consumeResults = await Promise.all(
    Array.from({ length: 20 }, () => consumeReservedExtraEntitlements({
      ...consumeContext,
      reservationKey: consumeRequest.reservationKey,
      transactionOptions: CONCURRENCY_OPTIONS,
    }))
  );
  assert.strictEqual(consumeResults.filter((row) => !row.idempotent).length, 1);
  assertCounters(await readBucket(consumeBucket), {
    remaining: 1,
    reserved: 0,
    consumed: 1,
    forfeited: 0,
    total: 2,
  });

  await resetCollections();
  const releaseContext = context();
  const releaseBucket = await seedBucket({
    ctx: releaseContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 2,
  });
  const releaseRequest = premiumRequest(releaseContext, "premium-concurrent-release");
  await reserveExtraEntitlements(releaseRequest);
  const releaseResults = await Promise.all(
    Array.from({ length: 20 }, () => releaseReservedExtraEntitlements({
      ...releaseContext,
      reservationKey: releaseRequest.reservationKey,
      transactionOptions: CONCURRENCY_OPTIONS,
    }))
  );
  assert.strictEqual(releaseResults.filter((row) => !row.idempotent).length, 1);
  assertCounters(await readBucket(releaseBucket), {
    remaining: 2,
    reserved: 0,
    consumed: 0,
    forfeited: 0,
    total: 2,
  });
}

async function testPremiumDateEligibility() {
  const futureContext = context();
  const future = await seedBucket({
    ctx: futureContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 2,
    effectiveStartDate: new Date("2026-08-12T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-01T23:59:59+03:00"),
  });
  await assertRejectCode(
    () => reserveExtraEntitlements(premiumRequest(futureContext, "premium-future")),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(future)).remainingQty, 2);

  const expiredContext = context();
  const expired = await seedBucket({
    ctx: expiredContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 2,
    effectiveStartDate: new Date("2026-07-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-10T23:59:59+03:00"),
  });
  await assertRejectCode(
    () => reserveExtraEntitlements(premiumRequest(expiredContext, "premium-expired")),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(expired)).remainingQty, 2);

  const pendingContext = context();
  const pending = await seedBucket({
    ctx: pendingContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 2,
    applicationState: "pending",
  });
  await assertRejectCode(
    () => reserveExtraEntitlements(premiumRequest(pendingContext, "premium-pending")),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(pending)).remainingQty, 2);
}

async function testFundingOrderMatchesExistingExpiryFirstConvention() {
  const ctx = context();
  const earliestExpiry = await seedBucket({
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 1,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-20T23:59:59+03:00"),
  });
  const earliestStart = await seedBucket({
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 1,
    effectiveStartDate: new Date("2026-07-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-15T23:59:59+03:00"),
  });
  const lowerStableId = new mongoose.Types.ObjectId("000000000000000000000001");
  const higherStableId = new mongoose.Types.ObjectId("000000000000000000000002");
  const lowerIdBucket = await seedBucket({
    bucketId: lowerStableId,
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 1,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-15T23:59:59+03:00"),
  });
  const higherIdBucket = await seedBucket({
    bucketId: higherStableId,
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 1,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-15T23:59:59+03:00"),
  });

  // This deliberately mirrors base-entitlement funding: earliest expiry,
  // then earliest effective start, then stable Mongo bucket identity.
  const reserved = await reserveExtraEntitlements(
    premiumRequest(ctx, "premium-deterministic-order", { quantity: 4 })
  );
  assert.deepStrictEqual(
    reserved.allocations.map((row) => String(row.extraEntitlementBucketId)),
    [
      String(earliestExpiry._id),
      String(earliestStart._id),
      String(lowerIdBucket._id),
      String(higherIdBucket._id),
    ]
  );
}

async function testAddonDeterministicSplitAndConsume() {
  const ctx = context();
  const addonId = oid();
  const oldPlanId = oid();
  const newPlanId = oid();
  const oldBucket = await seedBucket({
    ctx,
    kind: "addon",
    addonId,
    addonPlanId: oldPlanId,
    entitlementKey: "juice:daily",
    category: "juice",
    total: 1,
    effectiveStartDate: new Date("2026-07-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-15T23:59:59+03:00"),
  });
  const newBucket = await seedBucket({
    ctx,
    kind: "addon",
    addonId,
    addonPlanId: newPlanId,
    entitlementKey: "juice:daily",
    category: "juice",
    total: 5,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-15T23:59:59+03:00"),
  });
  const request = addonRequest(ctx, "addon-split-consume", addonId, { quantity: 3 });
  const reserved = await reserveExtraEntitlements(request);
  assert.deepStrictEqual(
    reserved.allocations.map((row) => ({
      bucketId: String(row.extraEntitlementBucketId),
      addonPlanId: String(row.addonPlanId),
      quantity: row.quantity,
      sequence: row.fundingSequence,
    })),
    [
      { bucketId: String(oldBucket._id), addonPlanId: String(oldPlanId), quantity: 1, sequence: 1 },
      { bucketId: String(newBucket._id), addonPlanId: String(newPlanId), quantity: 2, sequence: 2 },
    ]
  );
  assertCounters(await readBucket(oldBucket), {
    remaining: 0,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 1,
  });
  assertCounters(await readBucket(newBucket), {
    remaining: 3,
    reserved: 2,
    consumed: 0,
    forfeited: 0,
    total: 5,
  });

  await consumeReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey });
  await consumeReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey });
  assertCounters(await readBucket(oldBucket), {
    remaining: 0,
    reserved: 0,
    consumed: 1,
    forfeited: 0,
    total: 1,
  });
  assertCounters(await readBucket(newBucket), {
    remaining: 3,
    reserved: 0,
    consumed: 2,
    forfeited: 0,
    total: 5,
  });
}

async function testAddonReleaseReplayAndExactIdentity() {
  const ctx = context();
  const addonA = oid();
  const addonB = oid();
  const bucketA = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonA,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 1,
  });
  const bucketB = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonB,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 10,
  });
  const request = addonRequest(ctx, "addon-release", addonA);
  await reserveExtraEntitlements(request);
  const replay = await reserveExtraEntitlements(request);
  assert.strictEqual(replay.idempotent, true);
  await releaseReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey });
  const releasedReplay = await releaseReservedExtraEntitlements({
    ...ctx,
    reservationKey: request.reservationKey,
  });
  assert.strictEqual(releasedReplay.idempotent, true);
  assert.strictEqual((await readBucket(bucketA)).remainingQty, 1);
  assert.strictEqual((await readBucket(bucketB)).remainingQty, 10);
}

async function testConcurrentAddonReservationsNeverDuplicateOrOverspend() {
  const sameContext = context();
  const sameAddonId = oid();
  const sameBucket = await seedBucket({
    ctx: sameContext,
    kind: "addon",
    addonId: sameAddonId,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 2,
  });
  const sameRequest = addonRequest(
    sameContext,
    "addon-same-concurrent",
    sameAddonId,
    { transactionOptions: CONCURRENCY_OPTIONS }
  );
  const sameResults = await Promise.all(
    Array.from({ length: 20 }, () => reserveExtraEntitlements(sameRequest))
  );
  assert.strictEqual(sameResults.filter((row) => !row.idempotent).length, 1);
  assert.strictEqual(
    await SubscriptionExtraEntitlementAllocation.countDocuments({
      reservationKey: sameRequest.reservationKey,
    }),
    1
  );
  assertCounters(await readBucket(sameBucket), {
    remaining: 1,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 2,
  });

  await resetCollections();
  const distinctContext = context();
  const distinctAddonId = oid();
  const distinctBucket = await seedBucket({
    ctx: distinctContext,
    kind: "addon",
    addonId: distinctAddonId,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 3,
  });
  const settled = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) => reserveExtraEntitlements(
      addonRequest(distinctContext, `addon-distinct-${index}`, distinctAddonId, {
        transactionOptions: CONCURRENCY_OPTIONS,
      })
    ))
  );
  assert.strictEqual(settled.filter((row) => row.status === "fulfilled").length, 3);
  assert.ok(settled.filter((row) => row.status === "rejected").every((row) => (
    row.reason && row.reason.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  )));
  assert.strictEqual(await SubscriptionExtraEntitlementAllocation.countDocuments({}), 3);
  assertCounters(await readBucket(distinctBucket), {
    remaining: 0,
    reserved: 3,
    consumed: 0,
    forfeited: 0,
    total: 3,
  });
}

async function testAddonInsufficientFutureExpiredAndCrossIsolation() {
  const ctx = context();
  const addonA = oid();
  const addonB = oid();
  const activeA = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonA,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 1,
  });
  const unrelated = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonB,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 10,
  });
  const futureA = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonA,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 5,
    effectiveStartDate: new Date("2026-08-12T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-01T23:59:59+03:00"),
  });
  const expiredA = await seedBucket({
    ctx,
    kind: "addon",
    addonId: addonA,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 5,
    effectiveStartDate: new Date("2026-07-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-10T23:59:59+03:00"),
  });

  await assertRejectCode(
    () => reserveExtraEntitlements(addonRequest(ctx, "addon-insufficient", addonA, { quantity: 2 })),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(activeA)).remainingQty, 1);
  assert.strictEqual((await readBucket(unrelated)).remainingQty, 10);
  assert.strictEqual((await readBucket(futureA)).remainingQty, 5);
  assert.strictEqual((await readBucket(expiredA)).remainingQty, 5);

  const futureOnlyContext = context();
  const futureOnlyAddon = oid();
  const futureOnlyBucket = await seedBucket({
    ctx: futureOnlyContext,
    kind: "addon",
    addonId: futureOnlyAddon,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 2,
    effectiveStartDate: new Date("2026-08-12T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-01T23:59:59+03:00"),
  });
  await assertRejectCode(
    () => reserveExtraEntitlements(addonRequest(
      futureOnlyContext,
      "addon-future-only",
      futureOnlyAddon
    )),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(futureOnlyBucket)).remainingQty, 2);

  const expiredOnlyContext = context();
  const expiredOnlyAddon = oid();
  const expiredOnlyBucket = await seedBucket({
    ctx: expiredOnlyContext,
    kind: "addon",
    addonId: expiredOnlyAddon,
    addonPlanId: oid(),
    entitlementKey: "juice:daily",
    category: "juice",
    total: 2,
    effectiveStartDate: new Date("2026-07-01T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-10T23:59:59+03:00"),
  });
  await assertRejectCode(
    () => reserveExtraEntitlements(addonRequest(
      expiredOnlyContext,
      "addon-expired-only",
      expiredOnlyAddon
    )),
    "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT"
  );
  assert.strictEqual((await readBucket(expiredOnlyBucket)).remainingQty, 2);
}

async function testTransitionCannotExceedActualReservedBalance() {
  const ctx = context();
  const bucket = await seedBucket({ ctx, kind: "premium", premiumKey: "shrimp", total: 4 });
  const request = premiumRequest(ctx, "premium-corrupt-reserved");
  await reserveExtraEntitlements(request);
  await SubscriptionExtraEntitlementBucket.updateOne(
    { _id: bucket._id },
    { $set: { remainingQty: 4, reservedQty: 0 } }
  );

  await assertRejectCode(
    () => consumeReservedExtraEntitlements({ ...ctx, reservationKey: request.reservationKey }),
    "STACKING_EXTRA_BUCKET_TRANSITION_CONFLICT"
  );
  const allocation = await SubscriptionExtraEntitlementAllocation.findOne({
    reservationKey: request.reservationKey,
  }).lean();
  assert.strictEqual(allocation.state, "reserved", "failed transition must roll back allocation state");
  assertCounters(await readBucket(bucket), {
    remaining: 4,
    reserved: 0,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });

  const releaseContext = context();
  const releaseBucket = await seedBucket({
    ctx: releaseContext,
    kind: "premium",
    premiumKey: "shrimp",
    total: 4,
  });
  const releaseRequest = premiumRequest(releaseContext, "premium-release-overflow");
  await reserveExtraEntitlements(releaseRequest);
  await SubscriptionExtraEntitlementBucket.updateOne(
    { _id: releaseBucket._id },
    { $set: { remainingQty: 4, reservedQty: 0 } }
  );
  await assertRejectCode(
    () => releaseReservedExtraEntitlements({
      ...releaseContext,
      reservationKey: releaseRequest.reservationKey,
    }),
    "STACKING_EXTRA_BUCKET_TRANSITION_CONFLICT"
  );
  const releaseAllocation = await SubscriptionExtraEntitlementAllocation.findOne({
    reservationKey: releaseRequest.reservationKey,
  }).lean();
  assert.strictEqual(releaseAllocation.state, "reserved");
  assertCounters(await readBucket(releaseBucket), {
    remaining: 4,
    reserved: 0,
    consumed: 0,
    forfeited: 0,
    total: 4,
  });
}

async function testMultiBucketFailureRollsBackAndRetrySucceedsOnce() {
  const ctx = context();
  const first = await seedBucket({
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 1,
    validityEndDate: new Date("2026-08-15T23:59:59+03:00"),
  });
  const second = await seedBucket({
    ctx,
    kind: "premium",
    premiumKey: "shrimp",
    total: 5,
    validityEndDate: new Date("2026-09-15T23:59:59+03:00"),
  });
  const request = premiumRequest(ctx, "premium-rollback", { quantity: 3 });
  const injected = new Error("injected P1 rollback verification");
  injected.code = "P1_TEST_ROLLBACK";

  await assertRejectCode(
    () => reserveExtraEntitlements({
      ...request,
      runtime: {
        afterBucketReserved: async ({ fundingSequence }) => {
          if (fundingSequence === 1) throw injected;
        },
      },
    }),
    "P1_TEST_ROLLBACK"
  );
  assert.strictEqual(await SubscriptionExtraEntitlementAllocation.countDocuments({}), 0);
  assert.strictEqual((await readBucket(first)).remainingQty, 1);
  assert.strictEqual((await readBucket(second)).remainingQty, 5);

  const retried = await reserveExtraEntitlements(request);
  assert.strictEqual(retried.newlyReservedCount, 2);
  const replay = await reserveExtraEntitlements(request);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(await SubscriptionExtraEntitlementAllocation.countDocuments({}), 2);
  assertCounters(await readBucket(first), {
    remaining: 0,
    reserved: 1,
    consumed: 0,
    forfeited: 0,
    total: 1,
  });
  assertCounters(await readBucket(second), {
    remaining: 3,
    reserved: 2,
    consumed: 0,
    forfeited: 0,
    total: 5,
  });
}

async function testTransactionalPrimitiveRejectsMissingTransaction() {
  const ctx = context();
  await assertRejectCode(
    () => reserveExtraEntitlementsTransactional({
      ...premiumRequest(ctx, "transaction-required"),
      session: null,
    }),
    "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED"
  );
}

async function runCase(name, work) {
  await resetCollections();
  await work();
  console.log(`PASS ${name}`);
}

async function run() {
  try {
    await connect();
    await runCase("premium reserve/consume/replay", testPremiumReserveConsumeAndReplay);
    await runCase("premium reserve/release/replay", testPremiumReserveReleaseAndReplay);
    await runCase("reservation payload conflict", testReservationPayloadConflictFailsClosed);
    await runCase("20 concurrent identical premium reservations", testConcurrentSamePremiumReservationOnlyDebitsOnce);
    await runCase("20 distinct premium reservations never overspend", testConcurrentDistinctPremiumReservationsNeverOverspend);
    await runCase("20 concurrent consume/release transitions", testConcurrentTerminalTransitionsAreExactlyOnce);
    await runCase("premium future and expired eligibility", testPremiumDateEligibility);
    await runCase("expiry/start/id deterministic funding order", testFundingOrderMatchesExistingExpiryFirstConvention);
    await runCase("add-on deterministic split and consume", testAddonDeterministicSplitAndConsume);
    await runCase("add-on release replay and exact identity", testAddonReleaseReplayAndExactIdentity);
    await runCase("add-on concurrent replay and overspend protection", testConcurrentAddonReservationsNeverDuplicateOrOverspend);
    await runCase("add-on insufficient/future/expired/cross isolation", testAddonInsufficientFutureExpiredAndCrossIsolation);
    await runCase("transition reserved-balance guard", testTransitionCannotExceedActualReservedBalance);
    await runCase("multi-bucket rollback and retry", testMultiBucketFailureRollsBackAndRetrySucceedsOnce);
    await runCase("transaction required", testTransactionalPrimitiveRejectsMissingTransaction);
    console.log("subscription extra entitlement allocation lifecycle tests passed");
  } finally {
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
