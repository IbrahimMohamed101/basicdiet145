"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  reacquireStackingAllocationTransactional,
  reopenStackingDayEntitlementsTransactional,
  transitionStackingAllocationsByKeysTransactional,
  transitionStackingDayEntitlementsTransactional,
} = require("./subscriptionStackingFulfillmentLedgerService");

function routerError(code, message, status = 503, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    async findStackingOwner(subscriptionId, session = null) {
      let query = SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      }).select("userId").lean();
      if (session) query = query.session(session);
      const batch = await query;
      return batch && batch.userId ? String(batch.userId) : "";
    },
    async findDayAllocations(subscriptionId, day, session = null) {
      const sourceDay = day && typeof day.toObject === "function" ? day.toObject() : day || {};
      const clauses = [];
      if (sourceDay._id) clauses.push({ subscriptionDayId: sourceDay._id });
      if (sourceDay.date) clauses.push({ date: sourceDay.date });
      if (!clauses.length) return [];
      let query = SubscriptionEntitlementAllocation.find({
        containerSubscriptionId: subscriptionId,
        $or: clauses,
      }).sort({ slotKey: 1, _id: 1 });
      if (session) query = query.session(session);
      return query.lean();
    },
    async findAllocationsByKeys(subscriptionId, allocationKeys, session = null) {
      const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
      if (!keys.length) return [];
      let query = SubscriptionEntitlementAllocation.find({
        containerSubscriptionId: subscriptionId,
        allocationKey: { $in: keys },
      }).sort({ slotKey: 1, _id: 1 });
      if (session) query = query.session(session);
      return query.lean();
    },
    startSession: () => startSafeSession(),
    getBusinessDate: () => getRestaurantBusinessDate(),
    transitionDay: (args) => transitionStackingDayEntitlementsTransactional(args),
    reopenDay: (args) => reopenStackingDayEntitlementsTransactional(args),
    transitionKeys: (args) => transitionStackingAllocationsByKeysTransactional(args),
    reacquireAllocation: (args) => reacquireStackingAllocationTransactional(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function withTransactionIfNeeded(session, runtime, work) {
  if (session) return work(session);
  const owned = await runtime.startSession();
  let result;
  try {
    await owned.withTransaction(async () => {
      result = await work(owned);
    });
    return result;
  } finally {
    await owned.endSession();
  }
}

async function resolveStackingRoute({ subscriptionId, session, runtime }) {
  if (!runtime.globallyEnabled()) {
    return { userId: "", enabled: false };
  }
  const userId = await runtime.findStackingOwner(subscriptionId, session);
  return {
    userId,
    enabled: Boolean(userId && runtime.writeEnabledForUser(userId)),
  };
}

function createStackingEntitlementWrappers(originals = {}, runtimeOverrides = null) {
  const runtime = resolveRuntime(runtimeOverrides);
  const required = [
    "reserveDayEntitlements",
    "transitionDayEntitlements",
    "reopenDayEntitlements",
    "transitionAllocation",
    "reacquireAllocation",
    "reservePickupEntitlements",
    "transitionPickupEntitlements",
  ];
  for (const name of required) {
    if (typeof originals[name] !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
  }

  return {
    async reserveDayEntitlements(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.reserveDayEntitlements(args);

      const allocations = await runtime.findDayAllocations(
        args.subscriptionId,
        args.day,
        args.session
      );
      if (!allocations.length) {
        throw routerError(
          "STACKING_DAY_RESERVATION_MISSING",
          "Stacked day allocations must be reserved by planner confirmation",
          409,
          {
            subscriptionId: String(args.subscriptionId || ""),
            dayId: String(args.day && args.day._id || ""),
          }
        );
      }
      const incompatible = allocations.find((row) => !["reserved", "consumed"].includes(row.state));
      if (incompatible) {
        throw routerError(
          "STACKING_DAY_RESERVATION_STATE_CONFLICT",
          "Stacked day allocation is not reserved",
          409,
          {
            allocationKey: incompatible.allocationKey,
            state: incompatible.state,
          }
        );
      }
      return {
        allocationKeys: allocations.map((row) => row.allocationKey),
        newlyReservedKeys: [],
      };
    },

    async transitionDayEntitlements(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.transitionDayEntitlements(args);
      return withTransactionIfNeeded(args.session, runtime, async (session) => {
        const businessDate = await runtime.getBusinessDate();
        return runtime.transitionDay({
          containerSubscriptionId: args.subscriptionId,
          day: args.day,
          toState: args.toState,
          businessDate,
          session,
        });
      });
    },

    async reopenDayEntitlements(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.reopenDayEntitlements(args);
      return withTransactionIfNeeded(args.session, runtime, async (session) => {
        const businessDate = await runtime.getBusinessDate();
        return runtime.reopenDay({
          containerSubscriptionId: args.subscriptionId,
          day: args.day,
          businessDate,
          session,
        });
      });
    },

    async transitionAllocation(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.transitionAllocation(args);
      const allocations = await runtime.findAllocationsByKeys(
        args.subscriptionId,
        [args.allocationKey],
        args.session
      );
      if (!allocations.length) return originals.transitionAllocation(args);
      return withTransactionIfNeeded(args.session, runtime, async (session) => {
        const businessDate = await runtime.getBusinessDate();
        const result = await runtime.transitionKeys({
          containerSubscriptionId: args.subscriptionId,
          allocationKeys: [args.allocationKey],
          toState: args.toState,
          businessDate,
          session,
        });
        return {
          changed: result.changedCount > 0,
          alreadyApplied: result.changedCount === 0,
        };
      });
    },

    async reacquireAllocation(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.reacquireAllocation(args);
      const allocations = await runtime.findAllocationsByKeys(
        args.subscriptionId,
        [args.allocationKey],
        args.session
      );
      if (!allocations.length) return originals.reacquireAllocation(args);
      return withTransactionIfNeeded(args.session, runtime, async (session) => {
        const businessDate = await runtime.getBusinessDate();
        const result = await runtime.reacquireAllocation({
          containerSubscriptionId: args.subscriptionId,
          allocationKey: args.allocationKey,
          businessDate,
          session,
        });
        return {
          changed: !result.idempotent,
          alreadyApplied: Boolean(result.idempotent),
        };
      });
    },

    async reservePickupEntitlements(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.reservePickupEntitlements(args);
      throw routerError(
        "STACKING_DIRECT_PICKUP_RESERVATION_NOT_READY",
        "Direct pickup reservation is not enabled for stacked subscriptions yet",
        503
      );
    },

    async transitionPickupEntitlements(args = {}) {
      const route = await resolveStackingRoute({
        subscriptionId: args.subscriptionId,
        session: args.session,
        runtime,
      });
      if (!route.enabled) return originals.transitionPickupEntitlements(args);
      const allocations = await runtime.findAllocationsByKeys(
        args.subscriptionId,
        args.allocationKeys,
        args.session
      );
      if (!allocations.length) return originals.transitionPickupEntitlements(args);
      return withTransactionIfNeeded(args.session, runtime, async (session) => {
        const businessDate = await runtime.getBusinessDate();
        return runtime.transitionKeys({
          containerSubscriptionId: args.subscriptionId,
          allocationKeys: args.allocationKeys,
          toState: args.toState,
          businessDate,
          session,
        });
      });
    },
  };
}

module.exports = {
  createStackingEntitlementWrappers,
  resolveStackingRoute,
  withTransactionIfNeeded,
};
