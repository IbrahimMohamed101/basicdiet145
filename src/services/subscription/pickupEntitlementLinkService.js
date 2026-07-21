"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const {
  reacquireAllocation,
  transitionAllocation,
} = require("./subscriptionMealEntitlementService");

const ACTIVE_CLAIM_STATUSES = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "fulfilled",
  "no_show",
]);

const MEAL_ITEM_TYPES = new Set([
  "meal",
  "premium_meal",
  "large_salad",
  "sandwich",
]);

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

function slotAliases(value) {
  const raw = clean(value);
  if (!raw) return [];
  const aliases = new Set([raw]);
  if (/^\d+$/.test(raw)) aliases.add(`slot_${Number(raw)}`);
  const slotMatch = raw.match(/^slot[_-]?(\d+)$/i);
  if (slotMatch) {
    aliases.add(String(Number(slotMatch[1])));
    aliases.add(`slot_${Number(slotMatch[1])}`);
  }
  const legacyMatch = raw.match(/^(?:meal|meal_slot|pickup_item)[_-]?(\d+)$/i);
  if (legacyMatch) {
    aliases.add(String(Number(legacyMatch[1])));
    aliases.add(`slot_${Number(legacyMatch[1])}`);
  }
  return [...aliases];
}

function isMealPickupItem(item) {
  if (!item || typeof item !== "object") return false;
  if (MEAL_ITEM_TYPES.has(clean(item.itemType).toLowerCase())) return true;
  const selectionType = clean(item.selectionType).toLowerCase();
  if ([
    "standard_meal",
    "basic_meal",
    "premium_meal",
    "premium_large_salad",
    "sandwich",
    "full_meal_product",
  ].includes(selectionType)) return true;
  return Boolean(item.slotKey || item.slotId || item.slotIndex)
    && !["addon", "protein", "protein_extra"].includes(selectionType);
}

function collectPickupMealSlotKeys(pickupRequest = {}) {
  const ordered = [];
  const seen = new Set();
  const add = (value) => {
    for (const alias of slotAliases(value)) {
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      ordered.push(alias);
    }
  };

  for (const value of Array.isArray(pickupRequest.selectedMealSlotIds)
    ? pickupRequest.selectedMealSlotIds
    : []) add(value);

  const selectedItems = Array.isArray(pickupRequest.selectedPickupItems)
    ? pickupRequest.selectedPickupItems
    : [];
  for (const item of selectedItems) {
    if (!isMealPickupItem(item)) continue;
    add(item.slotKey);
    add(item.slotId);
    add(item.slotIndex);
    if (item.source === "mealSlot") add(item.sourceId);
    add(item.itemId);
  }

  for (const value of Array.isArray(pickupRequest.selectedPickupItemIds)
    ? pickupRequest.selectedPickupItemIds
    : []) add(value);

  const snapshotSlots = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  for (const slot of snapshotSlots) {
    if (!slot || typeof slot !== "object") continue;
    add(slot.slotKey);
    add(slot.slotId);
    add(slot.slotIndex);
  }

  return ordered;
}

function allocationAliases(allocation = {}) {
  return slotAliases(allocation.slotKey);
}

function matchesRequestedSlot(allocation, requestedSet) {
  return allocationAliases(allocation).some((alias) => requestedSet.has(alias));
}

function isStandaloneAllocation(allocation = {}) {
  return /^pickup_\d+$/i.test(clean(allocation.slotKey));
}

function isClaimBlocking(request) {
  if (!request) return false;
  if (request.creditsReleasedAt) return false;
  if (clean(request.status) === "canceled") return false;
  return ACTIVE_CLAIM_STATUSES.has(clean(request.status));
}

async function loadClaimRequests(allocations, currentRequestId, session = null) {
  const ids = [...new Set((Array.isArray(allocations) ? allocations : [])
    .map((allocation) => clean(allocation && allocation.pickupRequestId))
    .filter((id) => id && id !== clean(currentRequestId)))];
  if (!ids.length) return new Map();
  const query = SubscriptionPickupRequest.find({ _id: { $in: ids } })
    .select("_id status creditsReleasedAt creditsConsumedAt");
  if (session) query.session(session);
  const requests = await query.lean();
  return new Map(requests.map((request) => [clean(request._id), request]));
}

function selectLinkedAllocationCandidates({
  dayAllocations,
  pickupRequest,
  mealCount,
  claimRequests = new Map(),
} = {}) {
  const allocations = Array.isArray(dayAllocations) ? dayAllocations : [];
  const requestedSlotKeys = collectPickupMealSlotKeys(pickupRequest);
  const requestedSet = new Set(requestedSlotKeys);
  const exact = requestedSet.size
    ? allocations.filter((allocation) => matchesRequestedSlot(allocation, requestedSet))
    : [];

  // A partial exact match means at least one selected slot has a real conflicting
  // ledger row. Never steal a different day's slot merely to satisfy the count.
  if (exact.length > 0 && exact.length < mealCount) {
    return {
      requestedSlotKeys,
      usedLegacyFallback: false,
      exactMatchCount: exact.length,
      candidates: exact,
      eligible: [],
      reason: "partial_exact_match",
    };
  }

  const candidates = exact.length > 0 ? exact : allocations;
  const currentRequestId = clean(pickupRequest && pickupRequest._id);
  const eligible = candidates.filter((allocation) => {
    if (allocation.state !== "reserved") return false;
    const claimId = clean(allocation.pickupRequestId);
    if (!claimId || claimId === currentRequestId) return true;
    return !isClaimBlocking(claimRequests.get(claimId));
  });

  const ordered = [];
  const seen = new Set();
  const push = (allocation) => {
    const key = clean(allocation && allocation.allocationKey);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(allocation);
  };

  if (exact.length > 0 && requestedSlotKeys.length > 0) {
    for (const requestedKey of requestedSlotKeys) {
      for (const allocation of eligible) {
        if (allocationAliases(allocation).includes(requestedKey)) push(allocation);
      }
    }
  }
  for (const allocation of eligible) push(allocation);

  return {
    requestedSlotKeys,
    usedLegacyFallback: exact.length === 0 && allocations.length > 0,
    exactMatchCount: exact.length,
    candidates,
    eligible: ordered,
    reason: null,
  };
}

async function clearLinkedClaims({
  subscriptionId,
  pickupRequestId,
  allocationKeys,
  session = null,
} = {}) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.map(clean).filter(Boolean) : [];
  if (!keys.length) return { modifiedCount: 0 };
  return Subscription.updateOne(
    { _id: subscriptionId },
    { $set: { "baseMealAllocations.$[allocation].pickupRequestId": null } },
    withOptionalSession({
      arrayFilters: [{
        "allocation.allocationKey": { $in: keys },
        ...(pickupRequestId
          ? { "allocation.pickupRequestId": pickupRequestId }
          : {}),
      }],
    }, session)
  );
}

async function repairCandidateAllocations({
  subscriptionId,
  pickupRequest,
  candidates,
  claimRequests,
  session = null,
} = {}) {
  const currentRequestId = clean(pickupRequest && pickupRequest._id);
  const repairedKeys = [];
  for (const allocation of Array.isArray(candidates) ? candidates : []) {
    const allocationKey = clean(allocation.allocationKey);
    if (!allocationKey) continue;
    const claimId = clean(allocation.pickupRequestId);
    const claimIsCurrent = claimId && claimId === currentRequestId;
    const staleClaim = claimId && !claimIsCurrent && !isClaimBlocking(claimRequests.get(claimId));

    if (allocation.state === "released" && (!claimId || staleClaim || claimIsCurrent)) {
      await reacquireAllocation({ subscriptionId, allocationKey, session });
      await clearLinkedClaims({
        subscriptionId,
        pickupRequestId: claimId || null,
        allocationKeys: [allocationKey],
        session,
      });
      repairedKeys.push(allocationKey);
      continue;
    }

    if (allocation.state === "reserved" && staleClaim) {
      await clearLinkedClaims({
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

function allocationStateSummary(allocations = []) {
  return (Array.isArray(allocations) ? allocations : []).map((allocation) => ({
    allocationKey: clean(allocation.allocationKey),
    slotKey: clean(allocation.slotKey),
    state: clean(allocation.state),
    pickupRequestId: clean(allocation.pickupRequestId) || null,
  }));
}

async function claimLinkedDayAllocations({
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

  const readSubscription = async () => {
    const query = Subscription.findById(subscriptionId)
      .select("remainingMeals reservedMeals baseMealAllocations");
    if (session) query.session(session);
    return query.lean();
  };

  let subscription = await readSubscription();
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);

  let dayAllocations = (Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation.dayId) === clean(linkedDayId));
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
  let selection = selectLinkedAllocationCandidates({
    dayAllocations,
    pickupRequest,
    mealCount,
    claimRequests,
  });

  const repairedKeys = await repairCandidateAllocations({
    subscriptionId,
    pickupRequest,
    candidates: selection.candidates,
    claimRequests,
    session,
  });

  if (repairedKeys.length) {
    subscription = await readSubscription();
    dayAllocations = (subscription.baseMealAllocations || [])
      .filter((allocation) => clean(allocation.dayId) === clean(linkedDayId));
    claimRequests = await loadClaimRequests(dayAllocations, pickupRequest._id, session);
    selection = selectLinkedAllocationCandidates({
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
    const currentClaimId = clean(allocation.pickupRequestId);
    if (currentClaimId === clean(pickupRequest._id)) {
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
            $or: [
              { pickupRequestId: null },
              { pickupRequestId: { $exists: false } },
            ],
          },
        },
      },
      { $set: { "baseMealAllocations.$[allocation].pickupRequestId": pickupRequest._id } },
      withOptionalSession({
        new: true,
        arrayFilters: [{
          "allocation.allocationKey": allocationKey,
          "allocation.state": "reserved",
          $or: [
            { "allocation.pickupRequestId": null },
            { "allocation.pickupRequestId": { $exists: false } },
          ],
        }],
      }, session)
    ).lean();

    if (!updated) {
      const reread = await readSubscription();
      const current = (reread && reread.baseMealAllocations || [])
        .find((entry) => clean(entry.allocationKey) === allocationKey);
      if (current
        && current.state === "reserved"
        && clean(current.pickupRequestId) === clean(pickupRequest._id)) {
        allocationKeys.push(allocationKey);
        continue;
      }
      await clearLinkedClaims({
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

async function releasePickupAllocationsForRequest({
  subscriptionId,
  pickupRequest,
  session = null,
} = {}) {
  const keys = Array.isArray(pickupRequest && pickupRequest.baseAllocationKeys)
    ? pickupRequest.baseAllocationKeys.map(clean).filter(Boolean)
    : [];
  if (!keys.length) return { mode: "none", changedCount: 0 };

  const query = Subscription.findById(subscriptionId).select("baseMealAllocations");
  if (session) query.session(session);
  const subscription = await query.lean();
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
    const result = await clearLinkedClaims({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKeys: keys,
      session,
    });
    return {
      mode,
      changedCount: Number(result && result.modifiedCount || 0),
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

function availabilityReasonCopy(reason) {
  if (reason === "SLOT_ALREADY_RESERVED") {
    return {
      ar: "تم طلب استلام هذه الوجبة بالفعل",
      en: "This meal has already been requested for pickup",
    };
  }
  return {
    ar: "تم استخدام هذه الوجبة بالفعل",
    en: "This meal has already been consumed",
  };
}

function applyReasonToAvailabilityItem(item, reason, claimId = null) {
  if (!item || !reason) return item;
  const copy = availabilityReasonCopy(reason);
  const state = reason === "SLOT_ALREADY_RESERVED" ? "reserved" : "fulfilled";
  return {
    ...item,
    available: false,
    canSelect: false,
    unavailableReason: reason,
    reasons: [...new Set([...(item.reasons || []), reason])],
    reservedByPickupRequestId: claimId || item.reservedByPickupRequestId || null,
    availabilityState: state,
    availability: item.availability ? {
      ...item.availability,
      state,
      available: false,
      canSelect: false,
      unavailableReason: reason,
      reasonLabel: copy,
      reservedByPickupRequestId: claimId || item.availability.reservedByPickupRequestId || null,
      reasons: [...new Set([...(item.availability.reasons || []), reason])],
    } : item.availability,
    display: item.display ? {
      ...item.display,
      statusTextAr: copy.ar,
      statusTextEn: copy.en,
      selectionTextAr: "",
      selectionTextEn: "",
      unavailableTextAr: copy.ar,
      unavailableTextEn: copy.en,
    } : item.display,
  };
}

function applyEntitlementAvailability({
  availability,
  subscription,
  day,
  pickupRequests = [],
} = {}) {
  if (!availability || typeof availability !== "object") return availability;
  const dayId = clean(day && day._id) || clean(availability.subscriptionDayId);
  const allocations = (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation.dayId) === dayId);
  if (!allocations.length) return availability;

  const activeRequestIds = new Set((Array.isArray(pickupRequests) ? pickupRequests : [])
    .filter(isClaimBlocking)
    .map((request) => clean(request._id))
    .filter(Boolean));

  const slots = Array.isArray(availability.slots) ? availability.slots : [];
  const exactMatches = slots.map((slot) => {
    const aliases = new Set([
      ...slotAliases(slot.slotKey),
      ...slotAliases(slot.slotId),
      ...slotAliases(slot.slotIndex),
    ]);
    return allocations.find((allocation) => allocationAliases(allocation)
      .some((alias) => aliases.has(alias))) || null;
  });
  const hasAnyExact = exactMatches.some(Boolean);
  const allocationBySlotId = new Map();

  const normalizedSlots = slots.map((slot, index) => {
    const allocation = exactMatches[index]
      || (!hasAnyExact && allocations.length >= slots.length ? allocations[index] : null);
    if (!allocation) return slot;
    allocationBySlotId.set(clean(slot.slotId || slot.slotKey || slot.slotIndex), allocation);
    const claimId = clean(allocation.pickupRequestId);
    if (["consumed", "forfeited"].includes(allocation.state)) {
      return applyReasonToAvailabilityItem(slot, "SLOT_ALREADY_CONSUMED", claimId);
    }
    if (allocation.state === "reserved" && claimId && activeRequestIds.has(claimId)) {
      return applyReasonToAvailabilityItem(slot, "SLOT_ALREADY_RESERVED", claimId);
    }
    // Released rows left by historical pickup cancellation are repairable during
    // the next create request, so they remain visible/selectable here.
    return {
      ...slot,
      entitlementState: allocation.state,
      entitlementRepairRequired: allocation.state === "released",
    };
  });

  const slotById = new Map(normalizedSlots.map((slot) => [
    clean(slot.slotId || slot.slotKey || slot.slotIndex),
    slot,
  ]));
  const pickupItems = (Array.isArray(availability.pickupItems) ? availability.pickupItems : [])
    .map((item) => {
      const key = clean(item.slotId || item.slotKey || item.itemId || item.slotIndex);
      const slot = slotById.get(key);
      if (!slot || !item.slotId) return item;
      if (slot.unavailableReason && !item.availability?.unavailableReason) {
        return applyReasonToAvailabilityItem(
          item,
          slot.unavailableReason,
          slot.reservedByPickupRequestId
        );
      }
      return {
        ...item,
        entitlementState: slot.entitlementState,
        entitlementRepairRequired: slot.entitlementRepairRequired,
      };
    });
  const itemById = new Map(pickupItems.map((item) => [clean(item.itemId), item]));
  const sections = (Array.isArray(availability.sections) ? availability.sections : [])
    .map((section) => ({
      ...section,
      items: (Array.isArray(section.items) ? section.items : [])
        .map((item) => itemById.get(clean(item.itemId)) || item),
    }));

  return {
    ...availability,
    slots: normalizedSlots,
    pickupItems,
    sections,
    availableSlotIds: normalizedSlots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: normalizedSlots.filter((slot) => !slot.available).map((slot) => slot.slotId),
  };
}

function buildEntitlementDiagnostics({ subscription, day, pickupRequests = [] } = {}) {
  const dayId = clean(day && day._id);
  const allocations = (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation.dayId) === dayId);
  const requestsById = new Map((Array.isArray(pickupRequests) ? pickupRequests : [])
    .map((request) => [clean(request._id), request]));
  return {
    subscriptionId: clean(subscription && subscription._id),
    date: clean(day && day.date),
    dayId,
    remainingMeals: Number(subscription && subscription.remainingMeals || 0),
    reservedMeals: Number(subscription && subscription.reservedMeals || 0),
    slots: (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).map((slot) => ({
      slotKey: clean(slot.slotKey),
      slotIndex: Number(slot.slotIndex || 0),
      status: clean(slot.status),
      selectionType: clean(slot.selectionType),
    })),
    allocations: allocations.map((allocation) => {
      const claimId = clean(allocation.pickupRequestId);
      const claim = requestsById.get(claimId) || null;
      return {
        allocationKey: clean(allocation.allocationKey),
        slotKey: clean(allocation.slotKey),
        state: clean(allocation.state),
        pickupRequestId: claimId || null,
        claimStatus: claim ? clean(claim.status) : null,
        claimIsBlocking: claim ? isClaimBlocking(claim) : false,
        staleClaim: Boolean(claimId && !isClaimBlocking(claim)),
      };
    }),
  };
}

module.exports = {
  ACTIVE_CLAIM_STATUSES,
  applyEntitlementAvailability,
  buildEntitlementDiagnostics,
  claimLinkedDayAllocations,
  clearLinkedClaims,
  collectPickupMealSlotKeys,
  isMealPickupItem,
  isStandaloneAllocation,
  releasePickupAllocationsForRequest,
  selectLinkedAllocationCandidates,
  slotAliases,
};
