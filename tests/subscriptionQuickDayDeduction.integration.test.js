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
  createQuickDayDeductionService,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");

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
      SubscriptionQuickDayDeduction.syncIndexes(),
    ]);

    const userId = new mongoose.Types.ObjectId();
    const subscriptionId = new mongoose.Types.ObjectId();
    const planAId = new mongoose.Types.ObjectId();
    const planBId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const startDate = new Date("2026-08-01T00:00:00+03:00");
    const endDate = new Date("2026-09-30T23:59:59+03:00");

    await Subscription.create({
      _id: subscriptionId,
      userId,
      planId: planAId,
      status: "active",
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: 21,
      remainingMeals: 21,
      entitlementVersion: 2,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      selectedMealsPerDay: 4,
      selectedGrams: 150,
      deliveryMode: "pickup",
    });

    const [batchA, batchB] = await SubscriptionEntitlementBatch.create([
      {
        sourceKey: `quick-int-a-${subscriptionId}`,
        sourceType: "checkout",
        userId,
        containerSubscriptionId: subscriptionId,
        planId: planAId,
        requestedStartDate: startDate,
        effectiveStartDate: startDate,
        endDate,
        validityEndDate: endDate,
        daysCount: 4,
        mealsPerDay: 3,
        proteinGrams: 150,
        totalMeals: 12,
        remainingMeals: 12,
        reservedMeals: 0,
        consumedMeals: 0,
        forfeitedMeals: 0,
        status: "active",
        applicationState: "applied",
        appliedAt: new Date(),
        deliverySnapshot: { mode: "pickup" },
      },
      {
        sourceKey: `quick-int-b-${subscriptionId}`,
        sourceType: "checkout",
        userId,
        containerSubscriptionId: subscriptionId,
        planId: planBId,
        requestedStartDate: startDate,
        effectiveStartDate: startDate,
        endDate,
        validityEndDate: endDate,
        daysCount: 9,
        mealsPerDay: 1,
        proteinGrams: 200,
        totalMeals: 9,
        remainingMeals: 9,
        reservedMeals: 0,
        consumedMeals: 0,
        forfeitedMeals: 0,
        status: "active",
        applicationState: "applied",
        appliedAt: new Date(),
        deliverySnapshot: { mode: "pickup" },
      },
    ]);

    const service = createQuickDayDeductionService({
      async getBusinessDate() {
        return "2026-08-27";
      },
    });

    const args = {
      subscriptionId,
      batchId: batchA._id,
      days: 2,
      idempotencyKey: "pickup-quick-integration-0001",
      actorId,
      actorRole: "cashier",
    };

    const first = await service.deduct(args);
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(first.days, 2);
    assert.strictEqual(first.mealsPerDay, 3);
    assert.strictEqual(first.mealsDeducted, 6);
    assert.strictEqual(first.allocationKeys.length, 6);

    const [updatedA, updatedB, container, allocations, operation, activity, audit] = await Promise.all([
      SubscriptionEntitlementBatch.findById(batchA._id).lean(),
      SubscriptionEntitlementBatch.findById(batchB._id).lean(),
      Subscription.findById(subscriptionId).lean(),
      SubscriptionEntitlementAllocation.find({ containerSubscriptionId: subscriptionId }).sort({ slotKey: 1 }).lean(),
      SubscriptionQuickDayDeduction.findOne({ idempotencyKey: args.idempotencyKey }).lean(),
      ActivityLog.findOne({
        entityType: "subscription",
        entityId: subscriptionId,
        action: "manual_subscription_meal_deduction",
        "meta.source": "pickup_quick_deduction",
      }).lean(),
      SubscriptionAuditLog.findOne({
        entityType: "subscription",
        entityId: subscriptionId,
        action: "quick_day_deduction",
      }).lean(),
    ]);

    assert.strictEqual(updatedA.remainingMeals, 6);
    assert.strictEqual(updatedA.reservedMeals, 0);
    assert.strictEqual(updatedA.consumedMeals, 6);
    assert.strictEqual(updatedB.remainingMeals, 9, "other stacked batch must stay untouched");
    assert.strictEqual(updatedB.consumedMeals, 0);
    assert.strictEqual(container.remainingMeals, 15);
    assert.strictEqual(container.consumedMeals, 6);
    assert.strictEqual(allocations.length, 6);
    assert.ok(allocations.every((row) => row.state === "consumed"));
    assert.ok(allocations.every((row) => String(row.entitlementBatchId) === String(batchA._id)));
    assert.ok(allocations.every((row) => row.proteinGrams === 150));
    assert.deepStrictEqual(
      [...operation.allocationKeys].sort(),
      allocations.map((row) => row.allocationKey).sort()
    );
    assert(activity, "activity projection must exist");
    assert.strictEqual(activity.meta.deductedTotalMeals, 6);
    assert.strictEqual(activity.meta.entitlementBatchId, String(batchA._id));
    assert(audit, "subscription audit must exist");
    assert.strictEqual(audit.meta.mealsDeducted, 6);

    const replay = await service.deduct(args);
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(replay.mealsDeducted, 6);

    const [replayA, replayB, replayAllocations, operationCount, activityCount, auditCount] = await Promise.all([
      SubscriptionEntitlementBatch.findById(batchA._id).lean(),
      SubscriptionEntitlementBatch.findById(batchB._id).lean(),
      SubscriptionEntitlementAllocation.find({ containerSubscriptionId: subscriptionId }).lean(),
      SubscriptionQuickDayDeduction.countDocuments({ idempotencyKey: args.idempotencyKey }),
      ActivityLog.countDocuments({
        entityType: "subscription",
        entityId: subscriptionId,
        action: "manual_subscription_meal_deduction",
        "meta.source": "pickup_quick_deduction",
      }),
      SubscriptionAuditLog.countDocuments({
        entityType: "subscription",
        entityId: subscriptionId,
        action: "quick_day_deduction",
      }),
    ]);

    assert.strictEqual(replayA.remainingMeals, 6);
    assert.strictEqual(replayB.remainingMeals, 9);
    assert.strictEqual(replayAllocations.length, 6, "replay must not create more allocations");
    assert.strictEqual(operationCount, 1);
    assert.strictEqual(activityCount, 1);
    assert.strictEqual(auditCount, 1);

    console.log("subscriptionQuickDayDeduction.integration.test.js: OK");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
