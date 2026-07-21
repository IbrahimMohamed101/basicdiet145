"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const {
  reacquireAllocation,
  transitionAllocation,
} = require("./subscriptionMealEntitlementService");
const linkPolicy = require("./pickupEntitlementLinkService");

const ACTIVE_CLAIM_STATUSES = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "fulfilled",
  "no_show",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function isClaimBlocking(request) {
  if (!request) return false;
  if (request.creditsReleasedAt) return false;
  if (clean(request.status) === "canceled") return false;
  return ACTIVE_CLAIM_STATUSES.has(clean(request.status));
}

async function readSubscription(subscriptionId, session = null) {
  const query = Subscription.findById(subscriptionId)
    .select("remainingMeals reservedMeals baseMealAllocations");
  if (session) query.session(session);
  return query.lean();
}

async function loadClaimRequests(allocations, currentRequestId, session = null) {
  const ids = [...new Set((Array.isArray(allocations) ? allocations : [])
    .map((allocation) => clean(allocation && allocation.pickupRequestId))
    .filter((id) => id && id !== clean(currentRequestId)))];
  if (!ids.length) return new Map();
  const query = SubscriptionPickupRequest.find({ _id: { $in: ids } })
    .select("_id status creditsReleasedAt creditsConsumedAt");
  if (session) query.session(session);
  const rows = await query.lean();
  return new Map(rows.map((request) => [clean(request._id), request]));
}

async function clearLinkedClaimsPositional({
  subscriptionId,
  pickupRequestId,
  allocationKeys,
  session = null,
} = {}) {
  const keys = [...new Set((Array.isArray(allocationKeys) ? allocationKeys : [])
    .map(clean)
    .filter(Boolean))];
  let modifiedCount = 0;
  for (const allocationKey of keys) {
    const elementMatch = { allocationKey };
    if (pickupRequestId) elementMatch.pickupRequestId = pickupRequestId;
    const result = await Subscription.updateOne(
      {
        _id: subscriptionId,
        baseMealAllocations: { $elemMatch: elementMatch },
      },
      { $set: { "baseMealAllocations.$.pickupRequestId": null } },
      withOptionalSession({}, session)
    );
    modifiedCount += Number(result && result.modifiedCount || 0);
  }
  return { modifiedCount };
}

async function claimAllocationPositional({
  subscriptionId,
  pickupRequestId,
  allocationKey,
  session = null,
} = {}) {
  return Subscription.findOneAndUpdate(
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
    { $set: { "baseMealAllocations.$.pickupRequestId": pickupRequestId } },
    withOptionalSession({ new: true }, session)
  ).lean();
}

function allocationStateSummary(allocations = []) {
  return allocations.map((allocation) => ({
    allocationKey: clean(allocation.allocationKey),
    slotKey: clean(allocation.slotKey),
    state: clean(allocation.state),
    pickupRequestId: clean(allocation.pickupRequestId) || null,
  }));
}

async function repairCandidates({
  subscriptionId,
  pickupRequest,
  candidates,
  claimRequests,
  session = null,
} = {}) {
  const currentRequestId = clean(pickupRequest && pickupRequest._id);
  const repairedKeys = [];
  for (const allocation of Array.isArray(candidates) ? candidates : []) {
    const allocationKey = clean(allocation && allocation.allocationKey);
    if (!allocationKey) continue;
    const claimId = clean(allocation.pickupRequestId);
    const claimIsCurrent = claimId && claimId === currentRequestId;
    const staleClaim = claimId && !claimIsCurrent && !isClaimBlocking(claimRequests.get(claimId));

    if (allocation.state === "released" && (!claimId || staleClaim || claimIsCurrent)) {
      await reacquireAllocation({ subscriptionId, allocationKey, session });
      await clearLinkedClaimsPositional({
        subscriptionId,
        pickupRequestId: claimId || null,
        allocationKeys: [allocationKey],
        session,
      });
      repairedKeys.push(allocationKey);
      continue;
    }

    if (allocation.state === "reserved" && staleClaim) {
      await clearLinkedClaimsPositional({
        subscriptionId,
        pickupRequestId: claimId,
        allocationKeys: [allocationKey],
        session,
      });
      repairedKeys.push(allocationKey);
    }
  }
  return repairedKeys;
}

async function claimLinkedDayAllocationsPositional({
  subscriptionId,
  pickupRequest,
  mealCount,
  session = null,
} = {}) {
  const linkedDayId = pickupRequest && pickupRequest.subscriptionDayId;
  if (!linkedDayId) {
    return {
      hasLinkedDayAllocations: false,
      allocationKeys: [],
      newlyClaimedKeys: [],
      repairedKeys: [],
      mode: "standalone",
    };
  }

  let subscription = await readSubscription(subscriptionId, session);
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);

  let dayAllocations = (subscription.baseMealAllocations || [])
    .filter((allocation) => clean(allocation.dayId) === clean(linkedDayId));
  if (!dayAllocations.length) {
    return {
      hasLinkedDayAllocations: false,
      allocationKeys: [],
      newlyClaimedKeys: [],
      repairedKeys: [],
      mode: "standalone",
    };
  }

  let claimRequests = await loadClaimRequests(dayAllocations, pickupRequest._id, session);
  let selection = linkPolicy.selectLinkedAllocationCandidates({
    dayAllocations,
    pickupRequest,
    mealCount,
    claimRequests,
  });
  const repairedKeys = await repairCandidates({
    subscriptionId,
    pickupRequest,
    candidates: selection.candidates,
    claimRequests,
    session,
  });

  if (repairedKeys.length) {
    subscription = await readSubscription(subscriptionId, session);
    dayAllocations = (subscription.baseMealAllocations || [])
      .filter((allocation) => clean(allocation.dayId) === clean(linkedDayId));
    claimRequests = await loadClaimRequests(dayAllocations, pickupRequest._id, session);
    selection = linkPolicy.selectLinkedAllocationCandidates({
      dayAllocations,
      pickupRequest,
      mealCount,
      claimRequests,
    });
  }

  if (selection.reason || selection.eligible.length < mealCount) {
    throw serviceError(
      "MEAL_SLOT_UNAVAILABLE",
      "Linked day entitlement is not available for this pickup request",
      409,
      {
        messageI18n: {
          ar: "تعذر حجز الوجبة المحددة للاستلام. حدّث اختيارات اليوم ثم حاول مرة أخرى.",
          en: "The selected meal could not be reserved for pickup. Refresh today's choices and try again.",
        },
        reason: selection.reason || "insufficient_linked_allocations",
        requestedMealCount: mealCount,
        requestedSlotKeys: selection.requestedSlotKeys,
        exactMatchCount: selection.exactMatchCount,
        eligibleCount: selection.eligible.length,
        usedLegacyFallback: selection.usedLegacyFallback,
        allocations: allocationStateSummary(dayAllocations),
      }
    );
  }

  const allocationKeys = [];
  const newlyClaimedKeys = [];
  for (const allocation of selection.eligible.slice(0, mealCount)) {
    const allocationKey = clean(allocation.allocationKey);
    if (clean(allocation.pickupRequestId) === clean(pickupRequest._id)) {
      allocationKeys.push(allocationKey);
      continue;
    }

    const updated = await claimAllocationPositional({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKey,
      session,
    });
    if (!updated) {
      const reread = await readSubscription(subscriptionId, session);
      const current = (reread && reread.baseMealAllocations || [])
        .find((entry) => clean(entry.allocationKey) === allocationKey);
      if (current
        && current.state === "reserved"
        && clean(current.pickupRequestId) === clean(pickupRequest._id)) {
        allocationKeys.push(allocationKey);
        continue;
      }
      await clearLinkedClaimsPositional({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        allocationKeys: newlyClaimedKeys,
        session,
      });
      throw serviceError(
        "MEAL_SLOT_UNAVAILABLE",
        "Linked day entitlement was claimed by another pickup request",
        409,
        {
          messageI18n: {
            ar: "تم حجز الوجبة المحددة في طلب استلام آخر.",
            en: "The selected meal was reserved by another pickup request.",
          },
          allocationKey,
        }
      );
    }
    allocationKeys.push(allocationKey);
    newlyClaimedKeys.push(allocationKey);
  }

  return {
    hasLinkedDayAllocations: true,
    allocationKeys,
    newlyClaimedKeys,
    repairedKeys,
    mode: "linked_day",
    usedLegacyFallback: selection.usedLegacyFallback,
  };
}

function isStandaloneAllocation(allocation = {}) {
  return /^pickup_\d+$/i.test(clean(allocation.slotKey));
}

async function releasePickupAllocationsPositional({
  subscriptionId,
  pickupRequest,
  session = null,
} = {}) {
  const keys = Array.isArray(pickupRequest && pickupRequest.baseAllocationKeys)
    ? pickupRequest.baseAllocationKeys.map(clean).filter(Boolean)
    : [];
  if (!keys.length) return { mode: "none", changedCount: 0 };

  const subscription = await readSubscription(subscriptionId, session);
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  const allocations = (subscription.baseMealAllocations || [])
    .filter((allocation) => keys.includes(clean(allocation.allocationKey)));
  const explicitMode = clean(pickupRequest.baseAllocationMode);
  const inferredMode = allocations.length > 0 && allocations.every(isStandaloneAllocation)
    ? "standalone"
    : "linked_day";
  const mode = ["linked_day", "standalone"].includes(explicitMode)
    ? explicitMode
    : inferredMode;

  if (mode === "linked_day") {
    const result = await clearLinkedClaimsPositional({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKeys: keys,
      session,
    });
    return {
      mode,
      changedCount: Number(result.modifiedCount || 0),
      allocationKeys: keys,
    };
  }

  let changedCount = 0;
  for (const allocation of allocations) {
    if (allocation.state === "released") continue;
    if (allocation.state !== "reserved") {
      throw serviceError(
        "INVALID_PICKUP_REQUEST_STATE",
        "Pickup request entitlement cannot be released",
        409,
        { allocationKey: clean(allocation.allocationKey), state: allocation.state }
      );
    }
    const result = await transitionAllocation({
      subscriptionId,
      allocationKey: allocation.allocationKey,
      toState: "released",
      session,
    });
    if (result.changed) changedCount += 1;
  }
  return { mode, changedCount, allocationKeys: keys };
}

function installAtomicLinkedClaimService() {
  linkPolicy.claimLinkedDayAllocations = claimLinkedDayAllocationsPositional;
  linkPolicy.clearLinkedClaims = clearLinkedClaimsPositional;
  linkPolicy.releasePickupAllocationsForRequest = releasePickupAllocationsPositional;
  return linkPolicy;
}

module.exports = {
  claimAllocationPositional,
  claimLinkedDayAllocationsPositional,
  clearLinkedClaimsPositional,
  installAtomicLinkedClaimService,
  releasePickupAllocationsPositional,
};
