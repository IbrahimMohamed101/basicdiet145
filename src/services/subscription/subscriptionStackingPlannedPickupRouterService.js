"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");

function pickupError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeKeys(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function resolveRequestedMealCount(args = {}) {
  const candidates = [
    args.mealCount,
    args.quantity,
    args.count,
    args.requestedMealCount,
    args.requestedMeals,
    args.pickupRequest && args.pickupRequest.mealCount,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function resolvePickupDate(args = {}) {
  const candidates = [
    args.date,
    args.pickupDate,
    args.day && args.day.date,
    args.pickupRequest && args.pickupRequest.date,
  ];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  }
  return "";
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    findBatchOwner(subscriptionId, session = null) {
      let query = SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      }).select("userId containerSubscriptionId").lean();
      if (session) query = query.session(session);
      return query;
    },
    findAllocations({ subscriptionId, allocationKeys, dayId, date, session = null }) {
      const filter = { containerSubscriptionId: subscriptionId };
      if (allocationKeys.length > 0) {
        filter.allocationKey = { $in: allocationKeys };
      } else {
        const clauses = [];
        if (dayId) clauses.push({ subscriptionDayId: dayId });
        if (date) clauses.push({ date });
        if (!clauses.length) return Promise.resolve([]);
        filter.$or = clauses;
      }
      let query = SubscriptionEntitlementAllocation.find(filter)
        .sort({ slotKey: 1, _id: 1 });
      if (session) query = query.session(session);
      return query.lean();
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

async function resolvePlannedPickupRoute({ subscriptionId, session, runtime }) {
  if (!runtime.globallyEnabled()) {
    return { enabled: false, reason: "write_globally_disabled", ownerId: "" };
  }
  const batch = await runtime.findBatchOwner(subscriptionId, session);
  if (!batch) {
    return { enabled: false, reason: "subscription_not_stacked", ownerId: "" };
  }
  const ownerId = String(batch.userId || "");
  if (!ownerId || !runtime.writeEnabledForUser(ownerId)) {
    return { enabled: false, reason: "batch_owner_not_allowlisted", ownerId };
  }
  return {
    enabled: true,
    reason: "planned_pickup_supported",
    ownerId,
    containerSubscriptionId: String(batch.containerSubscriptionId || subscriptionId || ""),
  };
}

function assertPlannedPickupAllocations({
  allocations,
  requestedKeys,
  requestedMealCount,
  subscriptionId,
  date,
} = {}) {
  const rows = Array.isArray(allocations) ? allocations : [];
  if (!rows.length) {
    throw pickupError(
      "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY",
      "Pickup for combined packages requires a confirmed meal-planning day",
      503,
      { subscriptionId: String(subscriptionId || ""), date: date || null }
    );
  }

  if (requestedKeys.length > 0) {
    const actualKeys = new Set(rows.map((row) => String(row.allocationKey || "")));
    const missingKeys = requestedKeys.filter((key) => !actualKeys.has(key));
    if (missingKeys.length > 0 || rows.length !== requestedKeys.length) {
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE",
        "One or more pickup allocations were not found",
        409,
        {
          expectedCount: requestedKeys.length,
          actualCount: rows.length,
          missingKeys,
        }
      );
    }
  }

  if (requestedMealCount > 0 && rows.length !== requestedMealCount) {
    throw pickupError(
      "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH",
      "Pickup meal count must match the confirmed day allocations",
      409,
      {
        requestedMealCount,
        allocationCount: rows.length,
        date: date || null,
      }
    );
  }

  const incompatible = rows.find((row) => String(row.state || "") !== "reserved");
  if (incompatible) {
    throw pickupError(
      "STACKING_PICKUP_ALLOCATION_STATE_CONFLICT",
      "Pickup allocations must still be reserved",
      409,
      {
        allocationKey: String(incompatible.allocationKey || ""),
        state: incompatible.state,
      }
    );
  }

  const dateMismatch = date
    ? rows.find((row) => String(row.date || "") !== date)
    : null;
  if (dateMismatch) {
    throw pickupError(
      "STACKING_PICKUP_DATE_MISMATCH",
      "Pickup allocations belong to a different subscription day",
      409,
      {
        requestedDate: date,
        allocationKey: String(dateMismatch.allocationKey || ""),
        allocationDate: String(dateMismatch.date || ""),
      }
    );
  }

  return rows;
}

function createStackingPlannedPickupWrapper(originalReservePickup, runtimeOverrides = null) {
  if (typeof originalReservePickup !== "function") {
    throw new TypeError("originalReservePickup must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function reservePlannedStackingPickup(args = {}) {
    const route = await resolvePlannedPickupRoute({
      subscriptionId: args.subscriptionId,
      session: args.session,
      runtime,
    });
    if (!route.enabled) return originalReservePickup(args);

    const requestedKeys = normalizeKeys(args.allocationKeys);
    const date = resolvePickupDate(args);
    const dayId = args.subscriptionDayId
      || args.day && args.day._id
      || args.pickupRequest && args.pickupRequest.subscriptionDayId
      || null;
    const allocations = await runtime.findAllocations({
      subscriptionId: args.subscriptionId,
      allocationKeys: requestedKeys,
      dayId,
      date,
      session: args.session,
    });
    const rows = assertPlannedPickupAllocations({
      allocations,
      requestedKeys,
      requestedMealCount: resolveRequestedMealCount(args),
      subscriptionId: args.subscriptionId,
      date,
    });

    return {
      allocationKeys: rows.map((row) => String(row.allocationKey)),
      newlyReservedKeys: [],
      plannedStackingPickup: true,
    };
  };
}

module.exports = {
  assertPlannedPickupAllocations,
  createStackingPlannedPickupWrapper,
  normalizeKeys,
  resolvePickupDate,
  resolvePlannedPickupRoute,
  resolveRequestedMealCount,
};
