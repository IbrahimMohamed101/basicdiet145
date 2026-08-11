"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const { logger } = require("../../utils/logger");
const {
  isSubscriptionStackingReadEnabled,
} = require("../../utils/featureFlags");
const {
  isReadStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");

const PICKUP_AVAILABILITY_READ_EVENT = "subscription_stacking_pickup_availability_read";

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeId(value) {
  return String(value || "").trim();
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingReadEnabled(),
    readEnabledForUser: (userId) => isReadStackingEnabledForUser(userId),
    async hasAppliedBatch({ subscriptionId, userId }) {
      return Boolean(await SubscriptionEntitlementBatch.exists({
        containerSubscriptionId: subscriptionId,
        userId,
        applicationState: "applied",
      }));
    },
    async findUnclaimedReservedDayAllocations({
      subscriptionId,
      userId,
      subscriptionDayId,
      date,
      session = null,
    }) {
      let query = SubscriptionEntitlementAllocation.find({
        containerSubscriptionId: subscriptionId,
        userId,
        subscriptionDayId,
        date,
        state: "reserved",
        pickupRequestId: null,
      }).select("slotKey allocationKey").lean();
      if (session) query = query.session(session);
      return query;
    },
    info: (message, meta) => logger.info(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function countUniqueReservedSlots(rows = []) {
  const identities = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const slotKey = normalizeId(row.slotKey);
    const allocationKey = normalizeId(row.allocationKey);
    const identity = slotKey || allocationKey;
    if (identity) identities.add(identity);
  }
  return identities.size;
}

function applyStackingPickupWalletProjection(availability, externalReservedDayMeals) {
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) {
    return availability;
  }
  const wallet = availability.wallet;
  if (!wallet || typeof wallet !== "object" || Array.isArray(wallet)) {
    return availability;
  }

  const remainingMeals = normalizeCount(wallet.remainingMeals);
  const currentAvailableMeals = normalizeCount(wallet.availableMeals);
  // Legacy pickup availability already adds confirmed-day embedded reservations
  // back to remainingMeals because those exact slots are still pickup-spendable.
  // Stacking stores the same reservation lifecycle in the external ledger. Use
  // the larger representation rather than summing both, which avoids double
  // counting a legacy day that has already been mirrored into the new ledger.
  const legacyReservedDayMeals = Math.max(0, currentAvailableMeals - remainingMeals);
  const projectedReservedDayMeals = Math.max(
    legacyReservedDayMeals,
    normalizeCount(externalReservedDayMeals)
  );

  return {
    ...availability,
    wallet: {
      ...wallet,
      remainingMeals,
      availableMeals: remainingMeals + projectedReservedDayMeals,
    },
  };
}

function createStackingPickupAvailabilityReadWrapper(original, runtimeOverrides = null) {
  if (typeof original !== "function") {
    throw new TypeError("original pickup availability function must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function getPickupAvailabilityWithStackingWallet(args = {}) {
    const availability = await original(args);
    if (!runtime.globallyEnabled()) return availability;

    const userId = normalizeId(args.userId);
    if (!userId || !runtime.readEnabledForUser(userId)) return availability;

    const subscriptionId = normalizeId(
      availability && availability.subscriptionId || args.subscriptionId
    );
    const subscriptionDayId = normalizeId(
      availability && availability.subscriptionDayId
    );
    const date = normalizeId(
      availability && availability.date || args.date
    );
    if (!subscriptionId || !subscriptionDayId || !date) return availability;

    try {
      const hasBatch = await runtime.hasAppliedBatch({ subscriptionId, userId });
      if (!hasBatch) return availability;

      const allocations = await runtime.findUnclaimedReservedDayAllocations({
        subscriptionId,
        userId,
        subscriptionDayId,
        date,
        session: args.session || null,
      });
      const externalReservedDayMeals = countUniqueReservedSlots(allocations);
      const projected = applyStackingPickupWalletProjection(
        availability,
        externalReservedDayMeals
      );

      runtime.info(PICKUP_AVAILABILITY_READ_EVENT, {
        outcome: "projection_applied",
        userId,
        subscriptionId,
        subscriptionDayId,
        date,
        externalReservedDayMeals,
        availableMeals: projected && projected.wallet
          ? normalizeCount(projected.wallet.availableMeals)
          : null,
      });
      return projected;
    } catch (err) {
      // This projection only repairs a displayed wallet total. The canonical
      // selectable pickup items and the write-side allocation guards remain the
      // authority, so a projection read failure must not make Pickup unavailable.
      runtime.error(PICKUP_AVAILABILITY_READ_EVENT, {
        outcome: "projection_failed_open",
        userId,
        subscriptionId,
        subscriptionDayId,
        date,
        error: err && err.message ? err.message : String(err),
      });
      return availability;
    }
  };
}

module.exports = {
  PICKUP_AVAILABILITY_READ_EVENT,
  applyStackingPickupWalletProjection,
  countUniqueReservedSlots,
  createStackingPickupAvailabilityReadWrapper,
};
