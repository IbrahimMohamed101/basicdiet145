"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  applyStackingCompensationTransactional,
  batchContributesOnDate,
  buildCompensationSourceKey,
  buildExtensionDayEntries,
  computeCompensatedValidityDate,
  revokeStackingCompensationTransactional,
} = require("../src/services/subscription/subscriptionStackingCompensationService");

function session() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function container(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    status: "active",
    deliveryMode: "delivery",
    ...overrides,
  };
}

function batch(containerDoc, overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: containerDoc.userId,
    containerSubscriptionId: containerDoc._id,
    status: "active",
    stackVersion: 1,
    compensationRevision: 0,
    compensationDays: 0,
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    baseValidityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    deliverySnapshot: {
      mode: "delivery",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Olaya" },
    },
    ...overrides,
  };
}

function runtimeFixture({ containerDoc, batchDocs }) {
  const batches = batchDocs.map((row) => ({ ...row }));
  const tokens = [];
  const calls = {
    batchUpdates: [],
    extensionEntries: [],
    lifecycle: [],
  };

  function findBatch(batchId) {
    return batches.find((row) => String(row._id) === String(batchId));
  }

  const runtime = {
    findContainer: async () => ({ ...containerDoc }),
    findBatches: async () => batches.map((row) => ({ ...row })),
    activateToken: async ({ payload, now }) => {
      const existing = tokens.find((row) => row.sourceKey === payload.sourceKey);
      if (existing && existing.state === "active") {
        return { token: { ...existing }, changed: false, created: false };
      }
      if (existing) {
        existing.state = "active";
        existing.appliedAt = now;
        existing.revokedAt = null;
        return { token: { ...existing }, changed: true, created: false };
      }
      const created = {
        _id: new mongoose.Types.ObjectId(),
        ...payload,
        state: "active",
        appliedAt: now,
        revokedAt: null,
      };
      tokens.push(created);
      return { token: { ...created }, changed: true, created: true };
    },
    findActiveTokensForSource: async ({ sourceDate, actionType }) => tokens
      .filter((row) => row.sourceDate === sourceDate
        && row.actionType === actionType
        && row.state === "active")
      .map((row) => ({ ...row })),
    countActiveTokens: async ({ entitlementBatchId }) => tokens.filter((row) => (
      String(row.entitlementBatchId) === String(entitlementBatchId)
      && row.state === "active"
    )).length,
    revokeToken: async ({ token, now }) => {
      const stored = tokens.find((row) => String(row._id) === String(token._id));
      if (!stored || stored.state !== "active") return null;
      stored.state = "revoked";
      stored.revokedAt = now;
      return { ...stored };
    },
    updateBatchCompensation: async ({
      batch: source,
      baseValidityEndDate,
      compensationDays,
      validityEndDate,
    }) => {
      const stored = findBatch(source._id);
      if (!stored) return null;
      stored.baseValidityEndDate = baseValidityEndDate;
      stored.compensationDays = compensationDays;
      stored.validityEndDate = new Date(`${validityEndDate}T00:00:00+03:00`);
      stored.stackVersion += 1;
      stored.compensationRevision += 1;
      calls.batchUpdates.push({
        batchId: String(stored._id),
        compensationDays,
        validityEndDate,
      });
      return { ...stored };
    },
    upsertExtensionDays: async ({ entries }) => {
      calls.extensionEntries.push(...entries);
      return {
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: entries.length,
      };
    },
    countBlockingAllocations: async () => 0,
    countBlockingBlueprints: async () => 0,
    reconcileLifecycle: async (args) => {
      calls.lifecycle.push(args);
      return { outcome: "reconciled", container: { ...containerDoc } };
    },
  };

  return { runtime, batches, tokens, calls };
}

function testPureCompensationRules() {
  const containerDoc = container();
  const active = batch(containerDoc);
  const future = batch(containerDoc, {
    status: "paid_scheduled",
    effectiveStartDate: new Date("2026-08-10T00:00:00+03:00"),
    endDate: new Date("2026-09-04T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-04T00:00:00+03:00"),
    baseValidityEndDate: new Date("2026-09-04T00:00:00+03:00"),
  });

  assert.strictEqual(batchContributesOnDate(active, "2026-08-06"), true);
  assert.strictEqual(batchContributesOnDate(future, "2026-08-06"), false);
  assert.strictEqual(batchContributesOnDate(future, "2026-08-10"), true);
  assert.strictEqual(
    buildCompensationSourceKey({
      entitlementBatchId: active._id,
      actionType: "skip",
      sourceDate: "2026-08-06",
    }),
    `stack-comp:${active._id}:skip:2026-08-06`
  );
  assert.strictEqual(computeCompensatedValidityDate(active, 2), "2026-08-28");

  const entries = buildExtensionDayEntries({
    container: containerDoc,
    batch: active,
    fromExclusive: "2026-08-26",
    toInclusive: "2026-08-28",
  });
  assert.deepStrictEqual(entries.map((entry) => entry.date), ["2026-08-27", "2026-08-28"]);
  assert(entries.every((entry) => String(entry.subscriptionId) === String(containerDoc._id)));
}

async function testOverlapAppliesOneTokenPerContributingBatch() {
  const containerDoc = container();
  const first = batch(containerDoc, {
    mealsPerDay: 3,
    proteinGrams: 200,
  });
  const second = batch(containerDoc, {
    mealsPerDay: 2,
    proteinGrams: 150,
    effectiveStartDate: new Date("2026-08-05T00:00:00+03:00"),
    endDate: new Date("2026-08-30T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-30T00:00:00+03:00"),
    baseValidityEndDate: new Date("2026-08-30T00:00:00+03:00"),
  });
  const fixture = runtimeFixture({ containerDoc, batchDocs: [first, second] });

  const result = await applyStackingCompensationTransactional({
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "skip",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });

  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.idempotent, false);
  assert.strictEqual(result.tokenResults.length, 2);
  assert.strictEqual(fixture.tokens.length, 2);
  assert.deepStrictEqual(
    fixture.calls.batchUpdates.map((row) => row.validityEndDate).sort(),
    ["2026-08-27", "2026-08-31"]
  );
  assert.deepStrictEqual(
    fixture.calls.extensionEntries.map((row) => row.date).sort(),
    ["2026-08-27", "2026-08-31"]
  );
  assert.strictEqual(fixture.calls.lifecycle.length, 1);
}

async function testRepeatedApplyDoesNotCreateDuplicateTokens() {
  const containerDoc = container();
  const row = batch(containerDoc);
  const fixture = runtimeFixture({ containerDoc, batchDocs: [row] });
  const args = {
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "freeze",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  };

  const first = await applyStackingCompensationTransactional(args);
  const second = await applyStackingCompensationTransactional(args);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(fixture.tokens.length, 1);
  assert.strictEqual(fixture.tokens[0].state, "active");
  assert.strictEqual(fixture.batches[0].compensationDays, 1);
  assert.strictEqual(
    fixture.batches[0].validityEndDate.toISOString().slice(0, 10),
    "2026-08-26"
  );
  // Stored midnight is KSA; compare with a KSA-aware date string indirectly.
  assert.strictEqual(computeCompensatedValidityDate(fixture.batches[0], 1), "2026-08-27");
}

async function testRevokeShrinksSafelyAndIsIdempotent() {
  const containerDoc = container();
  const row = batch(containerDoc);
  const fixture = runtimeFixture({ containerDoc, batchDocs: [row] });
  await applyStackingCompensationTransactional({
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "skip",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });

  const revoked = await revokeStackingCompensationTransactional({
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "skip",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });
  assert.strictEqual(revoked.revoked, true);
  assert.strictEqual(revoked.idempotent, false);
  assert.strictEqual(fixture.tokens[0].state, "revoked");
  assert.strictEqual(fixture.batches[0].compensationDays, 0);

  const repeated = await revokeStackingCompensationTransactional({
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "skip",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });
  assert.strictEqual(repeated.idempotent, true);
}

async function testRevokeBlocksLaterAllocationOrBlueprint() {
  const containerDoc = container();
  const row = batch(containerDoc);
  const fixture = runtimeFixture({ containerDoc, batchDocs: [row] });
  await applyStackingCompensationTransactional({
    containerSubscriptionId: containerDoc._id,
    userId: containerDoc.userId,
    sourceDate: "2026-08-06",
    actionType: "freeze",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });
  fixture.runtime.countBlockingAllocations = async () => 1;

  await assert.rejects(
    () => revokeStackingCompensationTransactional({
      containerSubscriptionId: containerDoc._id,
      userId: containerDoc.userId,
      sourceDate: "2026-08-06",
      actionType: "freeze",
      businessDate: "2026-08-06",
      session: session(),
      runtime: fixture.runtime,
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_COMPENSATION_SHRINK_CONFLICT"
      && err.details.blockingAllocations === 1
    )
  );
  assert.strictEqual(fixture.tokens[0].state, "active");
}

async function testTransactionAndOwnershipAreRequired() {
  const containerDoc = container();
  const row = batch(containerDoc);
  const fixture = runtimeFixture({ containerDoc, batchDocs: [row] });
  await assert.rejects(
    () => applyStackingCompensationTransactional({
      containerSubscriptionId: containerDoc._id,
      userId: containerDoc.userId,
      sourceDate: "2026-08-06",
      actionType: "skip",
      businessDate: "2026-08-06",
      session: null,
      runtime: fixture.runtime,
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
  await assert.rejects(
    () => applyStackingCompensationTransactional({
      containerSubscriptionId: containerDoc._id,
      userId: new mongoose.Types.ObjectId(),
      sourceDate: "2026-08-06",
      actionType: "skip",
      businessDate: "2026-08-06",
      session: session(),
      runtime: fixture.runtime,
    }),
    (err) => Boolean(err && err.code === "FORBIDDEN")
  );
}

async function run() {
  testPureCompensationRules();
  await testOverlapAppliesOneTokenPerContributingBatch();
  await testRepeatedApplyDoesNotCreateDuplicateTokens();
  await testRevokeShrinksSafelyAndIsIdempotent();
  await testRevokeBlocksLaterAllocationOrBlueprint();
  await testTransactionAndOwnershipAreRequired();
  console.log("subscription stacking compensation service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
