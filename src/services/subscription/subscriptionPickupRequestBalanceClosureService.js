"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const {
  reservePickupEntitlements,
  transitionPickupEntitlements,
} = require("./subscriptionMealEntitlementService");
const {
  claimLinkedDayAllocations,
  clearLinkedClaims,
  releasePickupAllocationsForRequest,
} = require("./pickupEntitlementLinkService");

function serviceError(code, message, status = 400, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function assertPositiveMealCount(mealCount) {
  if (!Number.isInteger(mealCount) || mealCount <= 0) {
    throw serviceError("INVALID_MEAL_COUNT", "mealCount must be a positive integer", 400);
  }
}

function zeroMealResult(kind, pickupRequest) {
  return {
    [kind]: false,
    zeroMealRequest: true,
    pickupRequest,
    mealCount: 0,
  };
}

async function findPickupRequestOrThrow(pickupRequestId, session = null) {
  if (!pickupRequestId) throw serviceError("INVALID_ARGUMENTS", "pickupRequestId is required", 400);
  const query = SubscriptionPickupRequest.findById(pickupRequestId);
  if (session) query.session(session);
  const pickupRequest = await query;
  if (!pickupRequest) throw serviceError("PICKUP_REQUEST_NOT_FOUND", "Pickup request not found", 404);
  return pickupRequest;
}

async function cleanupReservationAttempt({
  subscriptionId,
  pickupRequestId,
  newlyReservedKeys = [],
  newlyClaimedKeys = [],
  session = null,
} = {}) {
  let firstError = null;
  if (newlyReservedKeys.length) {
    try {
      await transitionPickupEntitlements({
        subscriptionId,
        allocationKeys: newlyReservedKeys,
        toState: "released",
        session,
      });
    } catch (err) {
      firstError = err;
    }
  }
  if (newlyClaimedKeys.length) {
    try {
      await clearLinkedClaims({
        subscriptionId,
        pickupRequestId,
        allocationKeys: newlyClaimedKeys,
        session,
      });
    } catch (err) {
      firstError = firstError || err;
    }
  }
  if (firstError) throw firstError;
}

async function reserveSubscriptionMealsForPickupRequest({
  subscriptionId,
  pickupRequestId,
  mealCount,
  session = null,
} = {}) {
  if (!subscriptionId) throw serviceError("INVALID_ARGUMENTS", "subscriptionId is required", 400);

  const pickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
  const requestMealCount = Number(pickupRequest.mealCount || 0);
  const resolvedMealCount = mealCount == null ? requestMealCount : Number(mealCount);

  if (resolvedMealCount === 0 && requestMealCount === 0) {
    if (!pickupRequest.creditsReserved) {
      pickupRequest.creditsReserved = true;
      pickupRequest.creditsReservedAt = pickupRequest.creditsReservedAt || new Date();
      pickupRequest.baseAllocationMode = "none";
      await pickupRequest.save(withOptionalSession({}, session));
    }
    return zeroMealResult("reserved", pickupRequest);
  }

  assertPositiveMealCount(resolvedMealCount);
  if (requestMealCount !== resolvedMealCount) {
    throw serviceError("MEAL_COUNT_MISMATCH", "mealCount does not match pickup request mealCount", 400);
  }
  if (String(pickupRequest.subscriptionId) !== String(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
  }
  if (pickupRequest.creditsReserved) {
    return {
      reserved: false,
      alreadyReserved: true,
      pickupRequest,
      mealCount: resolvedMealCount,
    };
  }

  let linkedClaim = {
    hasLinkedDayAllocations: false,
    allocationKeys: [],
    newlyClaimedKeys: [],
    mode: "standalone",
  };
  let reservation;
  try {
    linkedClaim = await claimLinkedDayAllocations({
      subscriptionId,
      pickupRequest,
      mealCount: resolvedMealCount,
      session,
    });
    reservation = linkedClaim.hasLinkedDayAllocations
      ? { allocationKeys: linkedClaim.allocationKeys, newlyReservedKeys: [] }
      : await reservePickupEntitlements({
        subscriptionId,
        pickupRequest,
        session,
      });
  } catch (err) {
    await clearLinkedClaims({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKeys: linkedClaim.newlyClaimedKeys || [],
      session,
    }).catch(() => {});
    throw err;
  }

  const allocationMode = linkedClaim.hasLinkedDayAllocations ? "linked_day" : "standalone";
  const now = new Date();
  let updated;
  try {
    updated = await SubscriptionPickupRequest.findOneAndUpdate(
      { _id: pickupRequestId, creditsReserved: { $ne: true } },
      {
        $set: {
          creditsReserved: true,
          creditsReservedAt: now,
          baseAllocationKeys: reservation.allocationKeys,
          baseAllocationMode: allocationMode,
        },
      },
      withOptionalSession({ new: true }, session)
    );
  } catch (err) {
    await cleanupReservationAttempt({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      newlyReservedKeys: reservation.newlyReservedKeys || [],
      newlyClaimedKeys: linkedClaim.newlyClaimedKeys || [],
      session,
    }).catch(() => {});
    throw err;
  }

  if (!updated) {
    const current = await findPickupRequestOrThrow(pickupRequestId, session);
    const currentKeys = new Set((current.baseAllocationKeys || []).map(String));
    const ownsReservation = Boolean(current.creditsReserved)
      && reservation.allocationKeys.every((key) => currentKeys.has(String(key)));
    if (!ownsReservation) {
      await cleanupReservationAttempt({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        newlyReservedKeys: reservation.newlyReservedKeys || [],
        newlyClaimedKeys: linkedClaim.newlyClaimedKeys || [],
        session,
      });
    }
    return {
      reserved: false,
      alreadyReserved: Boolean(current.creditsReserved),
      pickupRequest: current,
      mealCount: resolvedMealCount,
    };
  }

  return {
    reserved: true,
    alreadyReserved: false,
    pickupRequest: updated,
    mealCount: resolvedMealCount,
    allocationMode,
    repairedAllocationKeys: linkedClaim.repairedKeys || [],
  };
}

async function releaseReservedPickupMeals({
  subscriptionId,
  pickupRequestId,
  session = null,
} = {}) {
  if (!subscriptionId) throw serviceError("INVALID_ARGUMENTS", "subscriptionId is required", 400);

  const pickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
  if (String(pickupRequest.subscriptionId) !== String(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
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
    throw serviceError("CREDITS_CONSUMED", "Reserved pickup meals were already consumed", 409);
  }
  if (!pickupRequest.creditsReserved) {
    throw serviceError("CREDITS_NOT_RESERVED", "Pickup request meals are not reserved", 409);
  }

  const now = new Date();
  const requestMealCount = Number(pickupRequest.mealCount || 0);
  if (requestMealCount === 0) {
    pickupRequest.creditsReleasedAt = now;
    pickupRequest.baseAllocationMode = "none";
    await pickupRequest.save(withOptionalSession({}, session));
    return zeroMealResult("released", pickupRequest);
  }

  const allocationKeys = Array.isArray(pickupRequest.baseAllocationKeys)
    ? pickupRequest.baseAllocationKeys
    : [];
  const releaseResult = allocationKeys.length
    ? await releasePickupAllocationsForRequest({ subscriptionId, pickupRequest, session })
    : { mode: pickupRequest.baseAllocationMode || "none", changedCount: 0 };

  const updated = await SubscriptionPickupRequest.findOneAndUpdate(
    {
      _id: pickupRequestId,
      subscriptionId,
      creditsReserved: true,
      creditsConsumedAt: null,
      creditsReleasedAt: null,
    },
    {
      $set: {
        creditsReleasedAt: now,
        baseAllocationMode: releaseResult.mode,
      },
    },
    withOptionalSession({ new: true }, session)
  );

  if (!updated) {
    const current = await findPickupRequestOrThrow(pickupRequestId, session);
    if (current.creditsReleasedAt) {
      return {
        released: false,
        alreadyReleased: true,
        pickupRequest: current,
        mealCount: Number(current.mealCount || 0),
      };
    }
    if (current.creditsConsumedAt) {
      throw serviceError("CREDITS_CONSUMED", "Reserved pickup meals were already consumed", 409);
    }
    throw serviceError("INVALID_PICKUP_REQUEST_STATE", "Pickup request cannot be released", 409);
  }

  // Legacy requests without allocation keys directly decremented remainingMeals.
  if (allocationKeys.length === 0) {
    await Subscription.updateOne(
      { _id: subscriptionId },
      { $inc: { remainingMeals: requestMealCount } },
      withOptionalSession({}, session)
    );
  }

  return {
    released: true,
    alreadyReleased: false,
    pickupRequest: updated,
    mealCount: requestMealCount,
    allocationMode: releaseResult.mode,
  };
}

module.exports = {
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
};
