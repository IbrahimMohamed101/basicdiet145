"use strict";

const crypto = require("node:crypto");

const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  reserveBlueprintAllocationsTransactional,
} = require("../subscription/subscriptionEntitlementLedgerService");
const {
  transitionStackingAllocationsByKeysTransactional,
} = require("../subscription/subscriptionStackingFulfillmentLedgerService");

function buildRevisionHash(idempotencyKey) {
  return crypto
    .createHash("sha256")
    .update(`pickup_quick_deduction:${String(idempotencyKey || "")}`, "utf8")
    .digest("hex");
}

function buildQuickDeductionBlueprint({ batch, businessDate, mealsToDeduct } = {}) {
  return {
    date: businessDate,
    slots: Array.from({ length: mealsToDeduct }, (_, index) => ({
      slotKey: `pickup_quick_${index + 1}`,
      entitlementBatchId: batch._id,
      proteinGrams: Number(batch.proteinGrams || 0),
    })),
  };
}

function createDefaultRuntime() {
  return {
    findReservedAllocations({ subscriptionId, batchId, limit, session }) {
      return SubscriptionEntitlementAllocation.find({
        containerSubscriptionId: subscriptionId,
        entitlementBatchId: batchId,
        state: "reserved",
      })
        .sort({ date: 1, slotKey: 1, _id: 1 })
        .limit(limit)
        .session(session)
        .lean();
    },
    reserveBlueprint(args) {
      return reserveBlueprintAllocationsTransactional(args);
    },
    transitionAllocations(args) {
      return transitionStackingAllocationsByKeysTransactional(args);
    },
    findBatch({ batchId, session }) {
      return SubscriptionEntitlementBatch.findById(batchId)
        .session(session)
        .lean();
    },
  };
}

function resolveRuntime(overrides = null) {
  const runtime = createDefaultRuntime();
  return overrides && typeof overrides === "object"
    ? { ...runtime, ...overrides }
    : runtime;
}

function allocationKeysOf(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row && row.allocationKey)
    .filter(Boolean)
    .map(String);
}

async function consumeBatchThroughAllocationLedgerTransactional({
  subscription,
  batch,
  businessDate,
  mealsToDeduct,
  idempotencyKey,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const plannerRevisionHash = buildRevisionHash(idempotencyKey);

  // A planner reservation only moves a credit from available -> reserved.
  // It is not a receipt. When staff confirms pickup/deduction, consume those
  // existing reservations first so we do not reserve/debit the same credit twice.
  const existingReserved = await runtime.findReservedAllocations({
    subscriptionId: subscription._id,
    batchId: batch._id,
    limit: mealsToDeduct,
    session,
  });
  const reservedAllocationKeys = allocationKeysOf(existingReserved);

  if (reservedAllocationKeys.length) {
    await runtime.transitionAllocations({
      containerSubscriptionId: subscription._id,
      allocationKeys: reservedAllocationKeys,
      toState: "consumed",
      businessDate,
      session,
    });
  }

  const freshMealsToConsume = mealsToDeduct - reservedAllocationKeys.length;
  let freshAllocationKeys = [];

  if (freshMealsToConsume > 0) {
    const blueprint = buildQuickDeductionBlueprint({
      batch,
      businessDate,
      mealsToDeduct: freshMealsToConsume,
    });

    const reserved = await runtime.reserveBlueprint({
      userId: subscription.userId,
      containerSubscriptionId: subscription._id,
      blueprint,
      plannerRevisionHash,
      paymentId: batch.paymentId || null,
      operationIdempotencyKeyPrefix: `pickup-quick:${plannerRevisionHash}`,
      session,
    });

    freshAllocationKeys = allocationKeysOf(
      reserved.results.map((entry) => entry && entry.allocation)
    );

    if (freshAllocationKeys.length !== freshMealsToConsume) {
      const error = new Error("Quick deduction allocation set is incomplete");
      error.code = "QUICK_DEDUCTION_ALLOCATION_SET_INCOMPLETE";
      error.status = 409;
      error.details = {
        expectedCount: freshMealsToConsume,
        actualCount: freshAllocationKeys.length,
      };
      throw error;
    }

    await runtime.transitionAllocations({
      containerSubscriptionId: subscription._id,
      allocationKeys: freshAllocationKeys,
      toState: "consumed",
      businessDate,
      session,
    });
  }

  const allocationKeys = [...reservedAllocationKeys, ...freshAllocationKeys];
  if (allocationKeys.length !== mealsToDeduct) {
    const error = new Error("Quick deduction consumption set is incomplete");
    error.code = "QUICK_DEDUCTION_CONSUMPTION_SET_INCOMPLETE";
    error.status = 409;
    error.details = {
      expectedCount: mealsToDeduct,
      actualCount: allocationKeys.length,
    };
    throw error;
  }

  const updatedBatch = await runtime.findBatch({
    batchId: batch._id,
    session,
  });
  if (!updatedBatch) {
    const error = new Error("Entitlement batch disappeared after quick deduction");
    error.code = "ENTITLEMENT_BATCH_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  return {
    updatedBatch,
    allocationKeys,
    consumedReservedMeals: reservedAllocationKeys.length,
    consumedAvailableMeals: freshAllocationKeys.length,
  };
}

module.exports = {
  allocationKeysOf,
  buildQuickDeductionBlueprint,
  buildRevisionHash,
  consumeBatchThroughAllocationLedgerTransactional,
};
