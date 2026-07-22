"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const {
  reservePickupEntitlements,
  transitionPickupEntitlements,
} = require("./subscriptionMealEntitlementService");
const {
  applyLegacyPickupRelease,
} = require("./subscriptionLegacyMealBalanceOperationService");

function createServiceError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function assertPositiveMealCount(mealCount) {
  if (!Number.isInteger(mealCount) || mealCount <= 0) {
    throw createServiceError("INVALID_MEAL_COUNT", "mealCount must be a positive integer", 400);
  }
}

function buildZeroMealResult(kind, pickupRequest) {
  return {
    [kind]: false,
    zeroMealRequest: true,
    pickupRequest,
    mealCount: 0,
  };
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function normalizeSlotKey(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function collectPickupSlotKeys(pickupRequest = {}) {
  const ordered = [];
  const seen = new Set();
  const add = (value) => {
    const key = normalizeSlotKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  (Array.isArray(pickupRequest.selectedMealSlotIds) ? pickupRequest.selectedMealSlotIds : []).forEach(add);
  (Array.isArray(pickupRequest.selectedPickupItemIds) ? pickupRequest.selectedPickupItemIds : []).forEach(add);

  for (const item of Array.isArray(pickupRequest.selectedPickupItems) ? pickupRequest.selectedPickupItems : []) {
    if (!item || typeof item !== "object") continue;
    add(item.slotKey);
    add(item.slotId);
    if (item.source === "mealSlot") add(item.sourceId);
    if (["meal", "premium_meal", "large_salad", "sandwich"].includes(String(item.itemType || ""))) add(item.itemId);
  }

  const snapshotSlots = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  for (const slot of snapshotSlots) {
    if (!slot || typeof slot !== "object") continue;
    add(slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : null));
  }

  return ordered;
}

async function releaseLinkedDayAllocationClaims({
  subscriptionId,
  pickupRequestId,
  allocationKeys,
  session = null,
} = {}) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return;
  await Subscription.updateOne(
    { _id: subscriptionId },
    { $set: { "baseMealAllocations.$[allocation].pickupRequestId": null } },
    withOptionalSession({
      arrayFilters: [{
        "allocation.allocationKey": { $in: keys },
        "allocation.pickupRequestId": pickupRequestId,
      }],
    }, session)
  );
}

async function claimLinkedDayAllocations({
  subscriptionId,
  pickupRequest,
  mealCount,
  session = null,
} = {}) {
  const linkedDayId = pickupRequest && pickupRequest.subscriptionDayId;
  if (!linkedDayId) {
    return { hasLinkedDayAllocations: false, allocationKeys: [], newlyClaimedKeys: [] };
  }

  const subscriptionQuery = Subscription.findById(subscriptionId).select("baseMealAllocations");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery.lean();
  if (!subscription) {
    throw createServiceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const dayAllocations = (Array.isArray(subscription.baseMealAllocations) ? subscription.baseMealAllocations : [])
    .filter((allocation) => String(allocation.dayId || "") === String(linkedDayId));
  if (!dayAllocations.length) {
    return { hasLinkedDayAllocations: false, allocationKeys: [], newlyClaimedKeys: [] };
  }

  const requestedSlotKeys = collectPickupSlotKeys(pickupRequest);
  const requestedSet = new Set(requestedSlotKeys);
  const matching = requestedSet.size > 0
    ? dayAllocations.filter((allocation) => requestedSet.has(normalizeSlotKey(allocation.slotKey)))
    : dayAllocations;
  const eligible = matching.filter((allocation) => (
    allocation.state === "reserved"
      && (!allocation.pickupRequestId || String(allocation.pickupRequestId) === String(pickupRequest._id))
  ));

  const orderedEligible = requestedSlotKeys.length > 0
    ? requestedSlotKeys.flatMap((slotKey) => eligible.filter((allocation) => normalizeSlotKey(allocation.slotKey) === slotKey))
    : eligible;
  const uniqueEligible = [];
  const seen = new Set();
  for (const allocation of orderedEligible) {
    const key = String(allocation.allocationKey || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueEligible.push(allocation);
  }

  if (uniqueEligible.length < mealCount) {
    throw createServiceError(
      "MEAL_SLOT_UNAVAILABLE",
      "Linked day entitlement is not available for this pickup request",
      409
    );
  }

  const allocationKeys = [];
  const newlyClaimedKeys = [];
  for (const allocation of uniqueEligible.slice(0, mealCount)) {
    const allocationKey = String(allocation.allocationKey);
    if (allocation.pickupRequestId && String(allocation.pickupRequestId) === String(pickupRequest._id)) {
      allocationKeys.push(allocationKey);
      continue;
    }

    const updated = await Subscription.findOneAndUpdate(
      {
        _id: subscriptionId,
        baseMealAllocations: {
          $elemMatch: {
            allocationKey,
            state: "reserved",
            pickupRequestId: null,
          },
        },
      },
      { $set: { "baseMealAllocations.$[allocation].pickupRequestId": pickupRequest._id } },
      withOptionalSession({
        new: true,
        arrayFilters: [{
          "allocation.allocationKey": allocationKey,
          "allocation.state": "reserved",
          "allocation.pickupRequestId": null,
        }],
      }, session)
    ).lean();

    if (!updated) {
      const rereadQuery = Subscription.findById(subscriptionId).select("baseMealAllocations");
      if (session) rereadQuery.session(session);
      const reread = await rereadQuery.lean();
      const current = (reread && reread.baseMealAllocations || [])
        .find((entry) => String(entry.allocationKey || "") === allocationKey);
      if (current && current.state === "reserved" && String(current.pickupRequestId || "") === String(pickupRequest._id)) {
        allocationKeys.push(allocationKey);
        continue;
      }
      await releaseLinkedDayAllocationClaims({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        allocationKeys: newlyClaimedKeys,
        session,
      });
      throw createServiceError("MEAL_SLOT_UNAVAILABLE", "Linked day entitlement was claimed by another pickup request", 409);
    }

    allocationKeys.push(allocationKey);
    newlyClaimedKeys.push(allocationKey);
  }

  return { hasLinkedDayAllocations: true, allocationKeys, newlyClaimedKeys };
}

async function cleanupReservationAttempt({
  subscriptionId,
  pickupRequestId,
  newlyReservedKeys = [],
  newlyClaimedKeys = [],
  session = null,
} = {}) {
  let firstError = null;
  for (const allocationKey of newlyReservedKeys) {
    try {
      await transitionPickupEntitlements({
        subscriptionId,
        allocationKeys: [allocationKey],
        toState: "released",
        session,
      });
    } catch (err) {
      firstError = firstError || err;
    }
  }
  try {
    await releaseLinkedDayAllocationClaims({
      subscriptionId,
      pickupRequestId,
      allocationKeys: newlyClaimedKeys,
      session,
    });
  } catch (err) {
    firstError = firstError || err;
  }
  if (firstError) throw firstError;
}

async function findPickupRequestOrThrow(pickupRequestId, session) {
  if (!pickupRequestId) {
    throw createServiceError("INVALID_ARGUMENTS", "pickupRequestId is required", 400);
  }

  const query = SubscriptionPickupRequest.findById(pickupRequestId);
  if (session) query.session(session);
  const pickupRequest = await query;
  if (!pickupRequest) {
    throw createServiceError("PICKUP_REQUEST_NOT_FOUND", "Pickup request not found", 404);
  }
  return pickupRequest;
}

async function reserveSubscriptionMealsForPickupRequest({
  subscriptionId,
  pickupRequestId,
  mealCount,
  session = null,
} = {}) {
  if (!subscriptionId) {
    throw createServiceError("INVALID_ARGUMENTS", "subscriptionId is required", 400);
  }

  const pickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
  const requestMealCount = Number(pickupRequest.mealCount || 0);
  const resolvedMealCount = mealCount == null ? requestMealCount : Number(mealCount);
  if (resolvedMealCount === 0 && requestMealCount === 0) {
    if (!pickupRequest.creditsReserved) {
      pickupRequest.creditsReserved = true;
      pickupRequest.creditsReservedAt = pickupRequest.creditsReservedAt || new Date();
      await pickupRequest.save(withOptionalSession({}, session));
    }
    return buildZeroMealResult("reserved", pickupRequest);
  }
  assertPositiveMealCount(resolvedMealCount);

  if (requestMealCount !== resolvedMealCount) {
    throw createServiceError("MEAL_COUNT_MISMATCH", "mealCount does not match pickup request mealCount", 400);
  }

  if (String(pickupRequest.subscriptionId) !== String(subscriptionId)) {
    throw createServiceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
  }

  if (pickupRequest.creditsReserved) {
    return {
      reserved: false,
      alreadyReserved: true,
      pickupRequest,
      mealCount: resolvedMealCount,
    };
  }

  let linkedDayClaim = {
    hasLinkedDayAllocations: false,
    allocationKeys: [],
    newlyClaimedKeys: [],
  };
  let reservation;
  try {
    linkedDayClaim = await claimLinkedDayAllocations({
      subscriptionId,
      pickupRequest,
      mealCount: resolvedMealCount,
      session,
    });
    reservation = linkedDayClaim.hasLinkedDayAllocations
      ? { allocationKeys: linkedDayClaim.allocationKeys, newlyReservedKeys: [] }
      : await reservePickupEntitlements({
        subscriptionId,
        pickupRequest,
        session,
      });
  } catch (err) {
    await releaseLinkedDayAllocationClaims({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKeys: linkedDayClaim.newlyClaimedKeys,
      session,
    }).catch(() => {});
    throw err;
  }

  const now = new Date();
  let updatedPickupRequest;
  try {
    updatedPickupRequest = await SubscriptionPickupRequest.findOneAndUpdate(
      { _id: pickupRequestId, creditsReserved: { $ne: true } },
      {
        $set: {
          creditsReserved: true,
          creditsReservedAt: now,
          baseAllocationKeys: reservation.allocationKeys,
        },
      },
      withOptionalSession({ new: true }, session)
    );
  } catch (err) {
    await cleanupReservationAttempt({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      newlyReservedKeys: reservation.newlyReservedKeys,
      newlyClaimedKeys: linkedDayClaim.newlyClaimedKeys,
      session,
    }).catch(() => {});
    throw err;
  }

  if (!updatedPickupRequest) {
    const currentPickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
    const currentKeys = new Set(
      (Array.isArray(currentPickupRequest.baseAllocationKeys) ? currentPickupRequest.baseAllocationKeys : [])
        .map((key) => String(key))
    );
    const currentOwnsReservation = Boolean(currentPickupRequest.creditsReserved)
      && reservation.allocationKeys.every((key) => currentKeys.has(String(key)));
    if (!currentOwnsReservation) {
      await cleanupReservationAttempt({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        newlyReservedKeys: reservation.newlyReservedKeys,
        newlyClaimedKeys: linkedDayClaim.newlyClaimedKeys,
        session,
      });
    }
    return {
      reserved: false,
      alreadyReserved: Boolean(currentPickupRequest.creditsReserved),
      pickupRequest: currentPickupRequest,
      mealCount: resolvedMealCount,
    };
  }

  return {
    reserved: true,
    alreadyReserved: false,
    pickupRequest: updatedPickupRequest,
    mealCount: resolvedMealCount,
  };
}

async function consumeReservedPickupMeals({
  pickupRequestId,
  entitlementState = "consumed",
  session = null,
} = {}) {
  const now = new Date();
  const existing = await findPickupRequestOrThrow(pickupRequestId, session);
  if (Number(existing.mealCount || 0) === 0) {
    if (!existing.creditsConsumedAt && !existing.creditsReleasedAt) {
      existing.creditsConsumedAt = now;
      await existing.save(withOptionalSession({}, session));
    }
    return buildZeroMealResult("consumed", existing);
  }
  if (Array.isArray(existing.baseAllocationKeys) && existing.baseAllocationKeys.length > 0) {
    await transitionPickupEntitlements({
      subscriptionId: existing.subscriptionId,
      allocationKeys: existing.baseAllocationKeys,
      toState: entitlementState,
      session,
    });
  }
  const updatedPickupRequest = await SubscriptionPickupRequest.findOneAndUpdate(
    {
      _id: pickupRequestId,
      creditsReserved: true,
      creditsConsumedAt: null,
      creditsReleasedAt: null,
    },
    { $set: { creditsConsumedAt: now } },
    withOptionalSession({ new: true }, session)
  );

  if (updatedPickupRequest) {
    return {
      consumed: true,
      alreadyConsumed: false,
      pickupRequest: updatedPickupRequest,
      mealCount: Number(updatedPickupRequest.mealCount || 0),
    };
  }

  const pickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
  if (pickupRequest.creditsConsumedAt) {
    return {
      consumed: false,
      alreadyConsumed: true,
      pickupRequest,
      mealCount: Number(pickupRequest.mealCount || 0),
    };
  }
  if (pickupRequest.creditsReleasedAt) {
    throw createServiceError("CREDITS_RELEASED", "Reserved pickup meals were already released", 409);
  }
  if (!pickupRequest.creditsReserved) {
    throw createServiceError("CREDITS_NOT_RESERVED", "Pickup request meals are not reserved", 409);
  }

  throw createServiceError("INVALID_PICKUP_REQUEST_STATE", "Pickup request cannot be consumed", 409);
}

async function releaseReservedPickupMeals({
  subscriptionId,
  pickupRequestId,
  session = null,
} = {}) {
  if (!subscriptionId) {
    throw createServiceError("INVALID_ARGUMENTS", "subscriptionId is required", 400);
  }

  const now = new Date();
  const existing = await findPickupRequestOrThrow(pickupRequestId, session);
  if (String(existing.subscriptionId) !== String(subscriptionId)) {
    throw createServiceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
  }
  if (Number(existing.mealCount || 0) === 0) {
    if (!existing.creditsReleasedAt && !existing.creditsConsumedAt) {
      existing.creditsReleasedAt = now;
      await existing.save(withOptionalSession({}, session));
    }
    return buildZeroMealResult("released", existing);
  }
  const mealCount = Number(existing.mealCount || 0);
  assertPositiveMealCount(mealCount);
  const hasAllocationKeys = Array.isArray(existing.baseAllocationKeys)
    && existing.baseAllocationKeys.length > 0;
  if (hasAllocationKeys) {
    await transitionPickupEntitlements({
      subscriptionId,
      allocationKeys: existing.baseAllocationKeys,
      toState: "released",
      session,
    });
  } else {
    await applyLegacyPickupRelease({
      subscriptionId,
      pickupRequestId,
      mealCount,
      session,
    });
  }
  const releasedPickupRequest = await SubscriptionPickupRequest.findOneAndUpdate(
    {
      _id: pickupRequestId,
      subscriptionId,
      creditsReserved: true,
      creditsConsumedAt: null,
      creditsReleasedAt: null,
    },
    { $set: { creditsReleasedAt: now } },
    withOptionalSession({ new: true }, session)
  );

  if (!releasedPickupRequest) {
    const pickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
    if (String(pickupRequest.subscriptionId) !== String(subscriptionId)) {
      throw createServiceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
    }
    if (pickupRequest.creditsReleasedAt) {
      return {
        released: false,
        alreadyReleased: true,
        pickupRequest,
        mealCount: Number(pickupRequest.mealCount || 0),
      };
    }
    if (pickupRequest.creditsConsumedAt) {
      throw createServiceError("CREDITS_CONSUMED", "Reserved pickup meals were already consumed", 409);
    }
    if (!pickupRequest.creditsReserved) {
      throw createServiceError("CREDITS_NOT_RESERVED", "Pickup request meals are not reserved", 409);
    }
    throw createServiceError("INVALID_PICKUP_REQUEST_STATE", "Pickup request cannot be released", 409);
  }

  return {
    released: true,
    alreadyReleased: false,
    pickupRequest: releasedPickupRequest,
    mealCount,
  };
}

module.exports = {
  consumeReservedPickupMeals,
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
};
