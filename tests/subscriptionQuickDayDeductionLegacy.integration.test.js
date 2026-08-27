"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

mongoose.set("autoIndex", true);

const ActivityLog = require("../src/models/ActivityLog");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionQuickDayDeduction = require("../src/models/SubscriptionQuickDayDeduction");
const {
  LEGACY_TARGET_ID,
  deduct,
  listOption,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionLegacyService");
const {
  QuickDayDeductionError,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");
const {
  DAILY_DEDUCTION_ACTION,
} = require("../src/services/subscription/subscriptionDashboardTrackingReadService");

async function expectQuickError(work, code) {
  try {
    await work();
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof QuickDayDeductionError, `expected QuickDayDeductionError, got ${error && error.name}`);
    assert.strictEqual(error.code, code);
  }
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  try {
    await mongoose.connect(replSet.getUri(), {
      serverSelectionTimeoutMS: 10000,
      autoIndex: true,
    });

    await Promise.all([
      SubscriptionEntitlementAllocation.syncIndexes(),
      SubscriptionEntitlementBatch.syncIndexes(),
      SubscriptionQuickDayDeduction.syncIndexes(),
    ]);

    const userId = new mongoose.Types.ObjectId();
    const subscriptionId = new mongoose.Types.ObjectId();
    const planId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const startDate = new Date("2026-08-01T00:00:00+03:00");
    const endDate = new Date("2026-09-30T23:59:59+03:00");

    await Subscription.create({
      _id: subscriptionId,
      userId,
      planId,
      status: "active",
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: 12,
      remainingMeals: 10,
      entitlementVersion: 1,
      selectedMealsPerDay: 3,
      selectedGrams: 150,
      deliveryMode: "pickup",
      premiumBalance: [{
        premiumKey: "premium:test",
        purchasedQty: 2,
        remainingQty: 2,
        reservedQty: 0,
        consumedQty: 0,
      }],
    });

    const option = await listOption({
      subscriptionId,
      role: "restaurant",
    });
    assert(option, "legacy pickup subscription must produce a quick-day option");
    assert.strictEqual(option.id, LEGACY_TARGET_ID);
    assert.strictEqual(option.targetType, "legacy_subscription");
    assert.strictEqual(option.mealsPerDay, 3);
    assert.strictEqual(option.proteinGrams, 150);
    assert.strictEqual(option.remainingMeals, 8, "premium credits must not be exposed as regular daily credits");
    assert.strictEqual(await SubscriptionEntitlementBatch.countDocuments({ containerSubscriptionId: subscriptionId }), 0);

    const args = {
      subscriptionId,
      batchId: LEGACY_TARGET_ID,
      days: 2,
      idempotencyKey: "pickup-quick-legacy-integration-0001",
      actorId,
      actorRole: "restaurant",
    };
    const first = await deduct(args);
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(first.targetType, "legacy_subscription");
    assert.strictEqual(first.batchId, LEGACY_TARGET_ID);
    assert.strictEqual(first.days, 2);
    assert.strictEqual(first.mealsPerDay, 3);
    assert.strictEqual(first.mealsDeducted, 6);
    assert.strictEqual(first.allocationKeys.length, 6);

    const [updated, operation, activity, audit, stackingAllocations, batchCount] = await Promise.all([
      Subscription.findById(subscriptionId).lean(),
      SubscriptionQuickDayDeduction.findOne({ idempotencyKey: args.idempotencyKey }).lean(),
      ActivityLog.findOne({
        entityType: "subscription",
        entityId: subscriptionId,
        action: DAILY_DEDUCTION_ACTION,
        "meta.source": "pickup_quick_deduction",
      }).lean(),
      SubscriptionAuditLog.findOne({
        entityType: "subscription",
        entityId: subscriptionId,
        action: "quick_day_deduction",
      }).lean(),
      SubscriptionEntitlementAllocation.find({ containerSubscriptionId: subscriptionId }).lean(),
      SubscriptionEntitlementBatch.countDocuments({ containerSubscriptionId: subscriptionId }),
    ]);

    assert.strictEqual(updated.entitlementVersion, 2);
    assert.strictEqual(updated.remainingMeals, 4);
    assert.strictEqual(updated.reservedMeals, 0);
    assert.strictEqual(updated.consumedMeals, 8);
    assert.strictEqual(updated.forfeitedMeals, 0);
    assert.strictEqual(updated.premiumBalance[0].remainingQty, 2, "premium balance must stay untouched");
    assert.strictEqual(updated.premiumBalance[0].consumedQty, 0, "premium balance must stay untouched");
    assert.strictEqual(updated.baseMealAllocations.length, 6);
    assert.ok(updated.baseMealAllocations.every((row) => row.state === "consumed"));
    assert.deepStrictEqual(
      updated.baseMealAllocations.map((row) => row.allocationKey).sort(),
      first.allocationKeys.slice().sort()
    );
    assert.strictEqual(batchCount, 0, "legacy quick deduction must not materialize a stacking batch");
    assert.strictEqual(stackingAllocations.length, 0, "legacy path must stay on the embedded entitlement ledger");
    assert(operation);
    assert.strictEqual(operation.targetType, "legacy_subscription");
    assert.strictEqual(operation.entitlementBatchId, null);
    assert(activity);
    assert.strictEqual(activity.meta.classification, "daily_deduction");
    assert.strictEqual(activity.meta.targetType, "legacy_subscription");
    assert.strictEqual(activity.meta.entitlementBatchId, null);
    assert.strictEqual(activity.meta.deductedRegularMeals, 6);
    assert.strictEqual(activity.meta.deductedPremiumMeals, 0);
    assert(audit);
    assert.strictEqual(audit.meta.targetType, "legacy_subscription");
    assert.strictEqual(audit.meta.mealsDeducted, 6);

    const replay = await deduct(args);
    assert.strictEqual(replay.idempotent, true);
    const replayed = await Subscription.findById(subscriptionId).lean();
    assert.strictEqual(replayed.remainingMeals, 4);
    assert.strictEqual(replayed.baseMealAllocations.length, 6, "replay must not duplicate embedded allocations");
    assert.strictEqual(await SubscriptionQuickDayDeduction.countDocuments({ idempotencyKey: args.idempotencyKey }), 1);
    assert.strictEqual(await ActivityLog.countDocuments({
      entityType: "subscription",
      entityId: subscriptionId,
      action: DAILY_DEDUCTION_ACTION,
      "meta.source": "pickup_quick_deduction",
    }), 1);

    const premiumProtectedId = new mongoose.Types.ObjectId();
    await Subscription.create({
      _id: premiumProtectedId,
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: 5,
      remainingMeals: 5,
      entitlementVersion: 2,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      selectedMealsPerDay: 2,
      selectedGrams: 200,
      deliveryMode: "pickup",
      premiumBalance: [{
        premiumKey: "premium:protected",
        purchasedQty: 4,
        remainingQty: 4,
        reservedQty: 0,
        consumedQty: 0,
      }],
    });
    const protectedOption = await listOption({ subscriptionId: premiumProtectedId, role: "cashier" });
    assert(protectedOption);
    assert.strictEqual(protectedOption.remainingMeals, 1);
    await expectQuickError(() => deduct({
      subscriptionId: premiumProtectedId,
      batchId: LEGACY_TARGET_ID,
      days: 1,
      idempotencyKey: "pickup-quick-legacy-premium-protected",
      actorRole: "cashier",
    }), "INSUFFICIENT_BATCH_CREDITS");
    const premiumProtected = await Subscription.findById(premiumProtectedId).lean();
    assert.strictEqual(premiumProtected.remainingMeals, 5);
    assert.strictEqual(premiumProtected.premiumBalance[0].remainingQty, 4);

    await SubscriptionEntitlementBatch.create({
      sourceKey: `quick-legacy-guard-${subscriptionId}`,
      sourceType: "checkout",
      userId,
      containerSubscriptionId: subscriptionId,
      planId,
      requestedStartDate: startDate,
      effectiveStartDate: startDate,
      endDate,
      validityEndDate: endDate,
      daysCount: 1,
      mealsPerDay: 3,
      proteinGrams: 150,
      totalMeals: 3,
      remainingMeals: 3,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      status: "active",
      applicationState: "applied",
      appliedAt: new Date(),
      deliverySnapshot: { mode: "pickup" },
    });
    assert.strictEqual(await listOption({ subscriptionId, role: "cashier" }), null);
    await expectQuickError(() => deduct({
      subscriptionId,
      batchId: LEGACY_TARGET_ID,
      days: 1,
      idempotencyKey: "pickup-quick-legacy-batch-guard",
      actorRole: "cashier",
    }), "LEGACY_TARGET_NO_LONGER_AVAILABLE");

    console.log("subscriptionQuickDayDeductionLegacy.integration.test.js: OK");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
