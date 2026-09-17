"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const {
  assertTransactionalSession,
  transitionEntitlementAllocationTransactional,
} = require("./subscriptionEntitlementLedgerService");
const {
  reconcileSubscriptionStackingLifecycleTransactional,
} = require("./subscriptionStackingLifecycleService");

const TERMINAL_TARGETS = new Set(["consumed", "released", "forfeited"]);

function fulfillmentError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    findDayAllocations({ containerSubscriptionId, day, session }) {
      const sourceDay = day && typeof day.toObject === "function" ? day.toObject() : day || {};
      return SubscriptionEntitlementAllocation.find({
        containerSubscriptionId,
        $or: [
          ...(sourceDay._id ? [{ subscriptionDayId: sourceDay._id }] : []),
          ...(sourceDay.date ? [{ date: sourceDay.date }] : []),
        ],
      }).sort({ slotKey: 1, _id: 1 }).session(session).lean();
    },
    findAllocationsByKeys({ containerSubscriptionId, allocationKeys, session }) {
      return SubscriptionEntitlementAllocation.find({
        containerSubscriptionId,
        allocationKey: { $in: allocationKeys },
      }).sort({ slotKey: 1, _id: 1 }).session(session).lean();
    },
    transitionAllocation: (args) => transitionEntitlementAllocationTransactional(args),
    updateDayState({ dayId, allocationKeys, toState, session }) {
      if (!dayId) return Promise.resolve({ acknowledged: true, matchedCount: 0 });
      return SubscriptionDay.updateOne(
        { _id: dayId },
        {
          $set: {
            baseAllocationKeys: allocationKeys,
            entitlementTransitionState: toState,
          },
        },
        { session }
      );
    },
    findAllocationByKey({ containerSubscriptionId, allocationKey, session }) {
      return SubscriptionEntitlementAllocation.findOne({
        containerSubscriptionId,
        allocationKey,
      }).session(session).lean();
    },
    reserveReleasedBatchCredit({ allocation, session }) {
      return SubscriptionEntitlementBatch.findOneAndUpdate(
        {
          _id: allocation.entitlementBatchId,
          containerSubscriptionId: allocation.containerSubscriptionId,
          status: { $in: ["active", "paid_scheduled", "exhausted"] },
          remainingMeals: { $gte: 1 },
        },
        {
          $inc: {
            remainingMeals: -1,
            reservedMeals: 1,
            stackVersion: 1,
          },
          $set: {
            status: "active",
            exhaustedAt: null,
          },
        },
        { new: true, session }
      ).lean();
    },
    reacquireAllocationDocument({ allocation, now, session }) {
      return SubscriptionEntitlementAllocation.findOneAndUpdate(
        { _id: allocation._id, state: "released" },
        {
          $set: {
            state: "reserved",
            reservedAt: now,
            releasedAt: null,
            consumedAt: null,
            forfeitedAt: null,
          },
        },
        { new: true, session }
      ).lean();
    },
    reconcileLifecycle: (args) => (
      reconcileSubscriptionStackingLifecycleTransactional(args)
    ),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function normalizeKeys(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

async function transitionAllocationRows({
  containerSubscriptionId,
  allocations,
  toState,
  businessDate,
  session,
  runtime,
} = {}) {
  if (!TERMINAL_TARGETS.has(String(toState || ""))) {
    throw fulfillmentError(
      "INVALID_STACKING_FULFILLMENT_TRANSITION",
      "Fulfillment target must be consumed, released, or forfeited",
      400,
      { toState }
    );
  }
  const rows = Array.isArray(allocations) ? allocations : [];
  const results = [];
  for (const allocation of rows) {
    if (String(allocation.state || "") === String(toState)) {
      results.push({ allocation, idempotent: true });
      continue;
    }
    if (String(allocation.state || "") !== "reserved") {
      throw fulfillmentError(
        "STACKING_FULFILLMENT_STATE_CONFLICT",
        "Allocation is not in a compatible fulfillment state",
        409,
        {
          allocationKey: String(allocation.allocationKey || ""),
          fromState: allocation.state,
          toState,
        }
      );
    }
    results.push(await runtime.transitionAllocation({
      allocationId: allocation._id,
      toState,
      session,
    }));
  }

  const lifecycle = rows.length > 0
    ? await runtime.reconcileLifecycle({
      containerSubscriptionId,
      businessDate,
      session,
    })
    : null;
  return { results, lifecycle };
}

async function transitionStackingDayEntitlementsTransactional({
  containerSubscriptionId,
  day,
  toState,
  businessDate,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const allocations = await runtime.findDayAllocations({
    containerSubscriptionId,
    day,
    session,
  });
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return {
      handled: false,
      changedCount: 0,
      allocationKeys: [],
      lifecycle: null,
    };
  }

  const transitioned = await transitionAllocationRows({
    containerSubscriptionId,
    allocations,
    toState,
    businessDate,
    session,
    runtime,
  });
  const allocationKeys = allocations.map((row) => String(row.allocationKey));
  await runtime.updateDayState({
    dayId: day && day._id,
    allocationKeys,
    toState,
    session,
  });

  return {
    handled: true,
    changedCount: transitioned.results.filter((entry) => !entry.idempotent).length,
    allocationKeys,
    lifecycle: transitioned.lifecycle,
  };
}

async function transitionStackingAllocationsByKeysTransactional({
  containerSubscriptionId,
  allocationKeys,
  toState,
  businessDate,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const keys = normalizeKeys(allocationKeys);
  if (!keys.length) {
    return { handled: false, changedCount: 0, allocationKeys: [], lifecycle: null };
  }
  const runtime = resolveRuntime(runtimeOverrides);
  const allocations = await runtime.findAllocationsByKeys({
    containerSubscriptionId,
    allocationKeys: keys,
    session,
  });
  if (allocations.length !== keys.length) {
    throw fulfillmentError(
      "STACKING_ALLOCATION_SET_INCOMPLETE",
      "One or more stacking allocations were not found",
      409,
      {
        expectedCount: keys.length,
        actualCount: allocations.length,
      }
    );
  }
  const transitioned = await transitionAllocationRows({
    containerSubscriptionId,
    allocations,
    toState,
    businessDate,
    session,
    runtime,
  });
  return {
    handled: true,
    changedCount: transitioned.results.filter((entry) => !entry.idempotent).length,
    allocationKeys: keys,
    lifecycle: transitioned.lifecycle,
  };
}

async function reacquireStackingAllocationTransactional({
  containerSubscriptionId,
  allocationKey,
  businessDate,
  session,
  now = new Date(),
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const allocation = await runtime.findAllocationByKey({
    containerSubscriptionId,
    allocationKey,
    session,
  });
  if (!allocation) {
    throw fulfillmentError(
      "STACKING_ALLOCATION_NOT_FOUND",
      "Stacking allocation was not found",
      404,
      { allocationKey }
    );
  }
  if (allocation.state === "reserved") {
    return { allocation, idempotent: true, lifecycle: null };
  }
  if (allocation.state !== "released") {
    throw fulfillmentError(
      "STACKING_ALLOCATION_REACQUIRE_CONFLICT",
      "Only a released allocation can be reacquired",
      409,
      { allocationKey, state: allocation.state }
    );
  }

  const batch = await runtime.reserveReleasedBatchCredit({ allocation, session });
  if (!batch) {
    throw fulfillmentError(
      "INSUFFICIENT_BATCH_CREDITS",
      "The original entitlement batch has no credit available to reopen",
      422,
      {
        allocationKey,
        entitlementBatchId: String(allocation.entitlementBatchId || ""),
      }
    );
  }
  const reacquired = await runtime.reacquireAllocationDocument({
    allocation,
    now,
    session,
  });
  if (!reacquired) {
    throw fulfillmentError(
      "STACKING_ALLOCATION_REACQUIRE_CONFLICT",
      "Allocation changed while it was being reacquired",
      409,
      { allocationKey }
    );
  }
  const lifecycle = await runtime.reconcileLifecycle({
    containerSubscriptionId,
    businessDate,
    session,
  });
  return {
    allocation: reacquired,
    batch,
    idempotent: false,
    lifecycle,
  };
}

async function reopenStackingDayEntitlementsTransactional({
  containerSubscriptionId,
  day,
  businessDate,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const allocations = await runtime.findDayAllocations({
    containerSubscriptionId,
    day,
    session,
  });
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return { handled: false, changedCount: 0, allocationKeys: [], lifecycle: null };
  }

  let changedCount = 0;
  let lifecycle = null;
  for (const allocation of allocations) {
    const result = await reacquireStackingAllocationTransactional({
      containerSubscriptionId,
      allocationKey: allocation.allocationKey,
      businessDate,
      session,
      runtime,
    });
    if (!result.idempotent) changedCount += 1;
    lifecycle = result.lifecycle || lifecycle;
  }
  const allocationKeys = allocations.map((row) => String(row.allocationKey));
  await runtime.updateDayState({
    dayId: day && day._id,
    allocationKeys,
    toState: "reserved",
    session,
  });
  return {
    handled: true,
    changedCount,
    allocationKeys,
    lifecycle,
  };
}

module.exports = {
  TERMINAL_TARGETS,
  reacquireStackingAllocationTransactional,
  reopenStackingDayEntitlementsTransactional,
  transitionStackingAllocationsByKeysTransactional,
  transitionStackingDayEntitlementsTransactional,
};
