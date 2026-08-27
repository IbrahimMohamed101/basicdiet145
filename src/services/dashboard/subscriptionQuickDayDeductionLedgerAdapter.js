"use strict";

const crypto = require("node:crypto");

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

async function consumeBatchThroughAllocationLedgerTransactional({
  subscription,
  batch,
  businessDate,
  mealsToDeduct,
  idempotencyKey,
  session,
} = {}) {
  const plannerRevisionHash = buildRevisionHash(idempotencyKey);
  const blueprint = buildQuickDeductionBlueprint({
    batch,
    businessDate,
    mealsToDeduct,
  });

  const reserved = await reserveBlueprintAllocationsTransactional({
    userId: subscription.userId,
    containerSubscriptionId: subscription._id,
    blueprint,
    plannerRevisionHash,
    paymentId: batch.paymentId || null,
    operationIdempotencyKeyPrefix: `pickup-quick:${plannerRevisionHash}`,
    session,
  });

  const allocationKeys = reserved.results
    .map((entry) => entry && entry.allocation && entry.allocation.allocationKey)
    .filter(Boolean)
    .map(String);

  if (allocationKeys.length !== mealsToDeduct) {
    const error = new Error("Quick deduction allocation set is incomplete");
    error.code = "QUICK_DEDUCTION_ALLOCATION_SET_INCOMPLETE";
    error.status = 409;
    error.details = {
      expectedCount: mealsToDeduct,
      actualCount: allocationKeys.length,
    };
    throw error;
  }

  await transitionStackingAllocationsByKeysTransactional({
    containerSubscriptionId: subscription._id,
    allocationKeys,
    toState: "consumed",
    businessDate,
    session,
  });

  const updatedBatch = await SubscriptionEntitlementBatch.findById(batch._id)
    .session(session)
    .lean();
  if (!updatedBatch) {
    const error = new Error("Entitlement batch disappeared after quick deduction");
    error.code = "ENTITLEMENT_BATCH_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  return {
    updatedBatch,
    allocationKeys,
  };
}

module.exports = {
  buildQuickDeductionBlueprint,
  buildRevisionHash,
  consumeBatchThroughAllocationLedgerTransactional,
};
