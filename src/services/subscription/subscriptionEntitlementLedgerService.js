"use strict";

const crypto = require("node:crypto");

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require("../../models/SubscriptionEntitlementDayBlueprint");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const {
  buildEntitlementSlotBlueprint,
} = require("./subscriptionEntitlementSlotBlueprintService");
const {
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");

const TERMINAL_ALLOCATION_STATES = new Set(["consumed", "released", "forfeited"]);

function ledgerError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function normalizeDateString(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw ledgerError("INVALID_DATE", "date must use YYYY-MM-DD", 400, { value });
  }
  return normalized;
}

function dateWindowForQuery(date) {
  const normalized = normalizeDateString(date);
  const start = new Date(`${normalized}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { normalized, start, end };
}

function assertTransactionalSession(session) {
  const inTransaction = Boolean(
    session
      && session.supportsTransactions !== false
      && typeof session.inTransaction === "function"
      && session.inTransaction()
  );
  if (!inTransaction) {
    throw ledgerError(
      "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED",
      "Stacking ledger mutations require an active MongoDB transaction",
      503
    );
  }
}

function buildBlueprintSourceHash({ date, batches = [] } = {}) {
  const normalizedDate = normalizeDateString(date);
  const rows = (Array.isArray(batches) ? batches : [])
    .map((batch) => ({
      id: String(batch && batch._id || ""),
      status: String(batch && batch.status || ""),
      effectiveStartDate: batch && batch.effectiveStartDate
        ? new Date(batch.effectiveStartDate).toISOString()
        : null,
      validityEndDate: batch && (batch.validityEndDate || batch.endDate)
        ? new Date(batch.validityEndDate || batch.endDate).toISOString()
        : null,
      mealsPerDay: Number(batch && batch.mealsPerDay || 0),
      proteinGrams: Number(batch && batch.proteinGrams || 0),
      remainingMeals: Number(batch && batch.remainingMeals || 0),
      stackVersion: Number(batch && batch.stackVersion || 1),
      deliverySnapshot: batch && batch.deliverySnapshot || null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return stableHash({ date: normalizedDate, batches: rows });
}

function buildAllocationKey({
  containerSubscriptionId,
  entitlementBatchId,
  date,
  slotKey,
  plannerRevisionHash = "",
}) {
  return stableHash({
    containerSubscriptionId: String(containerSubscriptionId || ""),
    entitlementBatchId: String(entitlementBatchId || ""),
    date: normalizeDateString(date),
    slotKey: String(slotKey || ""),
    plannerRevisionHash: String(plannerRevisionHash || ""),
  });
}

function defaultRuntime() {
  return {
    async findBlueprint({ containerSubscriptionId, date, session = null }) {
      let query = SubscriptionEntitlementDayBlueprint.findOne({
        containerSubscriptionId,
        date,
      });
      if (session) query = query.session(session);
      return query.lean();
    },
    async upsertBlueprint({ filter, update, session = null }) {
      return SubscriptionEntitlementDayBlueprint.findOneAndUpdate(
        filter,
        update,
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          ...(session ? { session } : {}),
        }
      ).lean();
    },
    async findAllocation({ allocationKey, session }) {
      return SubscriptionEntitlementAllocation.findOne({ allocationKey })
        .session(session)
        .lean();
    },
    async createAllocation({ payload, session }) {
      const created = await SubscriptionEntitlementAllocation.create([payload], { session });
      return created[0];
    },
    async reserveBatchCredit({ batchId, containerSubscriptionId, date, session }) {
      const window = dateWindowForQuery(date);
      return SubscriptionEntitlementBatch.findOneAndUpdate(
        {
          _id: batchId,
          containerSubscriptionId,
          status: { $in: ["active", "paid_scheduled"] },
          effectiveStartDate: { $lte: window.end },
          validityEndDate: { $gte: window.start },
          remainingMeals: { $gte: 1 },
        },
        {
          $inc: {
            remainingMeals: -1,
            reservedMeals: 1,
            stackVersion: 1,
          },
        },
        { new: true, session }
      ).lean();
    },
    async findAllocationById({ allocationId, session }) {
      return SubscriptionEntitlementAllocation.findById(allocationId)
        .session(session)
        .lean();
    },
    async transitionAllocation({ allocationId, fromState, toState, now, session }) {
      return SubscriptionEntitlementAllocation.findOneAndUpdate(
        { _id: allocationId, state: fromState },
        {
          $set: {
            state: toState,
            [`${toState}At`]: now,
          },
        },
        { new: true, session }
      ).lean();
    },
    async transitionBatchCredit({ batchId, toState, session }) {
      const increment = { reservedMeals: -1, stackVersion: 1 };
      if (toState === "consumed") increment.consumedMeals = 1;
      if (toState === "released") increment.remainingMeals = 1;
      if (toState === "forfeited") increment.forfeitedMeals = 1;

      return SubscriptionEntitlementBatch.findOneAndUpdate(
        { _id: batchId, reservedMeals: { $gte: 1 } },
        { $inc: increment },
        { new: true, session }
      ).lean();
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function materializeEntitlementDayBlueprint({
  userId,
  containerSubscriptionId,
  date,
  batches = [],
  session = null,
  runtime: runtimeOverrides = null,
} = {}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const normalizedDate = normalizeDateString(date);
  const sourceHash = buildBlueprintSourceHash({ date: normalizedDate, batches });
  const existing = await runtime.findBlueprint({
    containerSubscriptionId,
    date: normalizedDate,
    session,
  });
  if (existing && existing.sourceHash === sourceHash) {
    return { blueprint: existing, idempotent: true };
  }

  const slotBlueprint = buildEntitlementSlotBlueprint({
    batches,
    businessDate: normalizedDate,
  });
  const projection = projectSubscriptionEntitlements({
    batches,
    businessDate: normalizedDate,
  });

  const payload = {
    userId,
    containerSubscriptionId,
    date: normalizedDate,
    projectionVersion: "subscription_stacking.v1",
    sourceHash,
    requiredSlotCount: slotBlueprint.requiredSlotCount,
    slots: slotBlueprint.slots,
    fulfillmentProfiles: projection.fulfillmentProfiles,
    hasMixedProteinGrams: projection.hasMixedProteinGrams,
    hasFulfillmentConflict: projection.hasFulfillmentConflict,
    materializedAt: new Date(),
  };

  const blueprint = await runtime.upsertBlueprint({
    filter: { containerSubscriptionId, date: normalizedDate },
    update: { $set: payload },
    session,
  });
  return { blueprint, idempotent: false };
}

async function reserveBlueprintAllocationsTransactional({
  userId,
  containerSubscriptionId,
  blueprint,
  subscriptionDayId = null,
  pickupRequestId = null,
  plannerRevisionHash = "",
  paymentId = null,
  operationIdempotencyKeyPrefix = "",
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  if (!blueprint || !Array.isArray(blueprint.slots)) {
    throw ledgerError("STACKING_BLUEPRINT_REQUIRED", "A materialized slot blueprint is required", 422);
  }

  const date = normalizeDateString(blueprint.date);
  const results = [];

  for (const slot of blueprint.slots) {
    const allocationKey = buildAllocationKey({
      containerSubscriptionId,
      entitlementBatchId: slot.entitlementBatchId,
      date,
      slotKey: slot.slotKey,
      plannerRevisionHash,
    });
    const existing = await runtime.findAllocation({ allocationKey, session });
    if (existing) {
      if (["reserved", "consumed", "forfeited"].includes(existing.state)) {
        results.push({ allocation: existing, idempotent: true });
        continue;
      }
      throw ledgerError(
        "STACKING_ALLOCATION_ALREADY_RELEASED",
        "Released allocation cannot be reused with the same planner revision",
        409,
        { allocationKey, slotKey: slot.slotKey }
      );
    }

    const operationIdempotencyKey = operationIdempotencyKeyPrefix
      ? `${operationIdempotencyKeyPrefix}:${slot.slotKey}`
      : "";
    const allocation = await runtime.createAllocation({
      payload: {
        allocationKey,
        userId,
        containerSubscriptionId,
        entitlementBatchId: slot.entitlementBatchId,
        subscriptionDayId,
        pickupRequestId,
        date,
        slotKey: slot.slotKey,
        plannerRevisionHash,
        quantity: 1,
        proteinGrams: slot.proteinGrams,
        state: "reserved",
        parentAllocationKey: "",
        operationIdempotencyKey,
        paymentId,
        reservedAt: new Date(),
        metadata: {
          blueprintId: blueprint._id ? String(blueprint._id) : "",
          blueprintSourceHash: blueprint.sourceHash || "",
        },
      },
      session,
    });

    const updatedBatch = await runtime.reserveBatchCredit({
      batchId: slot.entitlementBatchId,
      containerSubscriptionId,
      date,
      session,
    });
    if (!updatedBatch) {
      throw ledgerError(
        "INSUFFICIENT_BATCH_CREDITS",
        "The entitlement batch does not have enough available meals",
        422,
        {
          entitlementBatchId: String(slot.entitlementBatchId || ""),
          date,
          slotKey: slot.slotKey,
        }
      );
    }

    results.push({
      allocation: allocation.toObject ? allocation.toObject() : allocation,
      batch: updatedBatch,
      idempotent: false,
    });
  }

  return {
    allocationCount: results.length,
    newlyReservedCount: results.filter((entry) => !entry.idempotent).length,
    results,
  };
}

async function transitionEntitlementAllocationTransactional({
  allocationId,
  toState,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  if (!TERMINAL_ALLOCATION_STATES.has(String(toState || ""))) {
    throw ledgerError(
      "INVALID_STACKING_ALLOCATION_TRANSITION",
      "Allocation target state must be consumed, released, or forfeited",
      400,
      { toState }
    );
  }
  const runtime = resolveRuntime(runtimeOverrides);
  const allocation = await runtime.findAllocationById({ allocationId, session });
  if (!allocation) {
    throw ledgerError("STACKING_ALLOCATION_NOT_FOUND", "Allocation not found", 404);
  }
  if (allocation.state === toState) {
    return { allocation, idempotent: true };
  }
  if (allocation.state !== "reserved") {
    throw ledgerError(
      "INVALID_STACKING_ALLOCATION_TRANSITION",
      "Only reserved allocations can transition",
      409,
      { fromState: allocation.state, toState }
    );
  }

  const now = new Date();
  const transitioned = await runtime.transitionAllocation({
    allocationId,
    fromState: "reserved",
    toState,
    now,
    session,
  });
  if (!transitioned) {
    const raced = await runtime.findAllocationById({ allocationId, session });
    if (raced && raced.state === toState) return { allocation: raced, idempotent: true };
    throw ledgerError(
      "STACKING_ALLOCATION_CONFLICT",
      "Allocation state changed concurrently",
      409,
      { allocationId: String(allocationId), toState }
    );
  }

  const updatedBatch = await runtime.transitionBatchCredit({
    batchId: allocation.entitlementBatchId,
    toState,
    session,
  });
  if (!updatedBatch) {
    throw ledgerError(
      "STACKING_BATCH_BALANCE_CONFLICT",
      "Batch reserved balance is inconsistent with allocation state",
      409,
      {
        allocationId: String(allocationId),
        entitlementBatchId: String(allocation.entitlementBatchId || ""),
        toState,
      }
    );
  }

  return {
    allocation: transitioned,
    batch: updatedBatch,
    idempotent: false,
  };
}

module.exports = {
  TERMINAL_ALLOCATION_STATES,
  assertTransactionalSession,
  buildAllocationKey,
  buildBlueprintSourceHash,
  materializeEntitlementDayBlueprint,
  reserveBlueprintAllocationsTransactional,
  transitionEntitlementAllocationTransactional,
};
