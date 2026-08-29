process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  QuickDayDeductionError,
  createQuickDayDeductionService,
  normalizeInput,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function buildHarness({
  supportsTransactions = true,
  remainingMeals = 12,
  reservedMeals = 0,
} = {}) {
  const subscriptionId = objectId();
  const userId = objectId();
  const batchAId = objectId();
  const batchBId = objectId();
  const operations = new Map();
  const audits = [];
  let mutated = 0;

  const subscription = {
    _id: subscriptionId,
    userId,
    status: "active",
    remainingMeals: remainingMeals + 9,
    reservedMeals,
    consumedMeals: 0,
  };
  const batches = new Map([
    [String(batchAId), {
      _id: batchAId,
      containerSubscriptionId: subscriptionId,
      userId,
      planId: objectId(),
      applicationState: "applied",
      status: "active",
      effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
      validityEndDate: new Date("2026-09-30T23:59:59+03:00"),
      mealsPerDay: 3,
      proteinGrams: 150,
      totalMeals: 30,
      remainingMeals,
      reservedMeals,
      consumedMeals: Math.max(0, 30 - remainingMeals - reservedMeals),
      stackVersion: 1,
    }],
    [String(batchBId), {
      _id: batchBId,
      containerSubscriptionId: subscriptionId,
      userId,
      planId: objectId(),
      applicationState: "applied",
      status: "active",
      effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
      validityEndDate: new Date("2026-09-30T23:59:59+03:00"),
      mealsPerDay: 1,
      proteinGrams: 200,
      totalMeals: 10,
      remainingMeals: 9,
      reservedMeals: 0,
      consumedMeals: 1,
      stackVersion: 1,
    }],
  ]);

  const session = {
    supportsTransactions,
    inTransaction: false,
    async withTransaction(work) {
      this.inTransaction = true;
      try { return await work(); } finally { this.inTransaction = false; }
    },
    async endSession() {},
  };

  const runtime = {
    async startSession() { return session; },
    async getBusinessDate() { return "2026-08-27"; },
    async findOperation(key) { return operations.get(key) || null; },
    async findSubscription(id) {
      return String(id) === String(subscriptionId) ? subscription : null;
    },
    async findBatch({ subscriptionId: ownerId, batchId }) {
      const batch = batches.get(String(batchId));
      return batch && String(batch.containerSubscriptionId) === String(ownerId) ? { ...batch } : null;
    },
    async consumeBatch({ batch, mealsToDeduct }) {
      const current = batches.get(String(batch._id));
      const deductible = current
        ? Number(current.remainingMeals || 0) + Number(current.reservedMeals || 0)
        : 0;
      if (!current || current.stackVersion !== batch.stackVersion || deductible < mealsToDeduct) {
        return null;
      }

      const consumedReservedMeals = Math.min(current.reservedMeals, mealsToDeduct);
      const consumedAvailableMeals = mealsToDeduct - consumedReservedMeals;
      current.reservedMeals -= consumedReservedMeals;
      current.remainingMeals -= consumedAvailableMeals;
      current.consumedMeals += mealsToDeduct;
      current.stackVersion += 1;
      mutated += 1;
      return {
        updatedBatch: { ...current },
        allocationKeys: Array.from(
          { length: mealsToDeduct },
          (_, index) => `allocation-${index + 1}`
        ),
        consumedReservedMeals,
        consumedAvailableMeals,
      };
    },
    async reconcile() {
      subscription.remainingMeals = [...batches.values()]
        .reduce((sum, batch) => sum + batch.remainingMeals, 0);
      subscription.reservedMeals = [...batches.values()]
        .reduce((sum, batch) => sum + batch.reservedMeals, 0);
      subscription.consumedMeals = [...batches.values()]
        .reduce((sum, batch) => sum + batch.consumedMeals, 0);
      return { container: { ...subscription } };
    },
    async createOperation(payload) {
      const operation = { _id: objectId(), ...payload, createdAt: new Date() };
      operations.set(payload.idempotencyKey, operation);
      return operation;
    },
    async createAudit(payload) { audits.push(payload); return payload; },
    async findEligibleBatches() { return [...batches.values()].map((row) => ({ ...row })); },
    async findPlans() { return []; },
  };

  return {
    service: createQuickDayDeductionService(runtime),
    subscriptionId,
    batchAId,
    batchBId,
    batches,
    audits,
    get mutationCount() { return mutated; },
  };
}

async function expectQuickError(work, code) {
  try {
    await work();
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof QuickDayDeductionError, `expected QuickDayDeductionError, got ${error && error.name}`);
    assert.strictEqual(error.code, code);
  }
}

async function testValidation() {
  assert.throws(
    () => normalizeInput({ subscriptionId: objectId(), batchId: objectId(), days: 1.5, idempotencyKey: "valid-key-123" }),
    (error) => error.code === "INVALID_DAYS"
  );
  assert.throws(
    () => normalizeInput({ subscriptionId: objectId(), batchId: objectId(), days: 1, idempotencyKey: "" }),
    (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
}

async function testSelectedBatchDeductionAndReplay() {
  const harness = buildHarness({ remainingMeals: 12 });
  const beforeOther = harness.batches.get(String(harness.batchBId)).remainingMeals;
  const args = {
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 2,
    idempotencyKey: "quick-day-test-0001",
    actorId: objectId(),
    actorRole: "cashier",
  };

  const first = await harness.service.deduct(args);
  assert.strictEqual(first.days, 2);
  assert.strictEqual(first.mealsPerDay, 3);
  assert.strictEqual(first.mealsDeducted, 6);
  assert.strictEqual(first.before.remainingMeals, 12);
  assert.strictEqual(first.before.reservedMeals, 0);
  assert.strictEqual(first.before.deductibleMeals, 12);
  assert.strictEqual(first.after.remainingMeals, 6);
  assert.strictEqual(first.after.reservedMeals, 0);
  assert.strictEqual(first.after.deductibleMeals, 6);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(harness.batches.get(String(harness.batchAId)).remainingMeals, 6);
  assert.strictEqual(harness.batches.get(String(harness.batchBId)).remainingMeals, beforeOther, "other stacked batch must not change");
  assert.strictEqual(harness.audits.length, 1);
  assert.strictEqual(harness.audits[0].meta.source, "pickup_quick_deduction");
  assert.strictEqual(harness.audits[0].meta.entitlementBatchId, String(harness.batchAId));

  const replay = await harness.service.deduct(args);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(replay.mealsDeducted, 6);
  assert.strictEqual(harness.mutationCount, 1, "idempotent replay must not mutate balance twice");
  assert.strictEqual(harness.audits.length, 1, "idempotent replay must not duplicate audit log");
}

async function testReservedMealsAreDeductibleWithoutDoubleDebit() {
  const harness = buildHarness({ remainingMeals: 0, reservedMeals: 10 });
  const first = await harness.service.deduct({
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 2,
    idempotencyKey: "quick-day-reserved-0001",
    actorRole: "cashier",
  });

  assert.strictEqual(first.mealsDeducted, 6);
  assert.strictEqual(first.before.remainingMeals, 0);
  assert.strictEqual(first.before.reservedMeals, 10);
  assert.strictEqual(first.before.deductibleMeals, 10);
  assert.strictEqual(first.after.remainingMeals, 0, "reserved consumption must not debit available twice");
  assert.strictEqual(first.after.reservedMeals, 4);
  assert.strictEqual(first.after.deductibleMeals, 4);
  assert.strictEqual(first.after.consumedMeals, 26);
  assert.strictEqual(harness.mutationCount, 1);
}

async function testIdempotencyConflict() {
  const harness = buildHarness();
  const key = "quick-day-test-0002";
  await harness.service.deduct({
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 1,
    idempotencyKey: key,
    actorRole: "admin",
  });
  await expectQuickError(() => harness.service.deduct({
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 2,
    idempotencyKey: key,
    actorRole: "admin",
  }), "IDEMPOTENCY_KEY_CONFLICT");
}

async function testInsufficientBatchCredits() {
  const harness = buildHarness({ remainingMeals: 2, reservedMeals: 3 });
  await expectQuickError(() => harness.service.deduct({
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 2,
    idempotencyKey: "quick-day-test-0003",
    actorRole: "cashier",
  }), "INSUFFICIENT_BATCH_CREDITS");
  assert.strictEqual(harness.batches.get(String(harness.batchAId)).remainingMeals, 2);
  assert.strictEqual(harness.batches.get(String(harness.batchAId)).reservedMeals, 3);
  assert.strictEqual(harness.mutationCount, 0);
}

async function testTransactionRequiredBeforeMutation() {
  const harness = buildHarness({ supportsTransactions: false });
  await expectQuickError(() => harness.service.deduct({
    subscriptionId: harness.subscriptionId,
    batchId: harness.batchAId,
    days: 1,
    idempotencyKey: "quick-day-test-0004",
    actorRole: "cashier",
  }), "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED");
  assert.strictEqual(harness.mutationCount, 0);
}

async function testOptionsExposeAuthoritativeBatchRate() {
  const harness = buildHarness({ remainingMeals: 0, reservedMeals: 10 });
  const options = await harness.service.listOptions({
    subscriptionId: harness.subscriptionId,
    role: "cashier",
  });
  assert.strictEqual(options.batches.length, 2);
  assert.strictEqual(options.batches[0].mealsPerDay, 3);
  assert.strictEqual(options.batches[0].proteinGrams, 150);
  assert.strictEqual(options.batches[0].remainingMeals, 0);
  assert.strictEqual(options.batches[0].reservedMeals, 10);
  assert.strictEqual(options.batches[0].deductibleMeals, 10);
}

async function run() {
  await testValidation();
  await testSelectedBatchDeductionAndReplay();
  await testReservedMealsAreDeductibleWithoutDoubleDebit();
  await testIdempotencyConflict();
  await testInsufficientBatchCredits();
  await testTransactionRequiredBeforeMutation();
  await testOptionsExposeAuthoritativeBatchRate();
  console.log("subscriptionQuickDayDeduction.test.js: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
