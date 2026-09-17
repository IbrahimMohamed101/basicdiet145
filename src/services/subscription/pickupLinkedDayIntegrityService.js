"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
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

function optionalSession(query, session) {
  if (session && query && typeof query.session === "function") query.session(session);
  return query;
}

function requestedMealCount({ mealCount, selectedMealSlotIds, selectedPickupItemIds, pickupRequest } = {}) {
  const request = pickupRequest || {};
  const directCount = Number(
    mealCount !== undefined && mealCount !== null
      ? mealCount
      : request.mealCount
  );
  if (Number.isFinite(directCount) && directCount > 0) return Math.floor(directCount);

  const slotIds = Array.isArray(selectedMealSlotIds)
    ? selectedMealSlotIds
    : (Array.isArray(request.selectedMealSlotIds) ? request.selectedMealSlotIds : []);
  if (slotIds.length > 0) return slotIds.length;

  const itemIds = Array.isArray(selectedPickupItemIds)
    ? selectedPickupItemIds
    : (Array.isArray(request.selectedPickupItemIds) ? request.selectedPickupItemIds : []);
  return itemIds.filter((id) => {
    const value = clean(id).toLowerCase();
    return /^(?:slot|meal|meal_slot|pickup_item)[_-]?\d+$/.test(value);
  }).length;
}

function dayHasPlannedMeals(day = {}) {
  const slots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  if (slots.some((slot) => slot && (slot.status === "complete" || slot.productId || slot.proteinId || slot.sandwichId))) {
    return true;
  }
  if (Array.isArray(day.materializedMeals) && day.materializedMeals.length > 0) return true;
  if (Array.isArray(day.selections) && day.selections.length > 0) return true;
  return false;
}

async function resolveLinkedDay({ subscriptionId, date = null, pickupRequest = null, session = null } = {}) {
  const linkedDayId = pickupRequest && pickupRequest.subscriptionDayId;
  if (linkedDayId) {
    return optionalSession(SubscriptionDay.findById(linkedDayId), session).lean();
  }
  if (!subscriptionId || !date) return null;
  return optionalSession(SubscriptionDay.findOne({ subscriptionId, date }), session).lean();
}

async function assertLinkedDayAllocationIntegrity({
  subscriptionId,
  date = null,
  mealCount = null,
  selectedMealSlotIds = null,
  selectedPickupItemIds = null,
  pickupRequest = null,
  session = null,
} = {}) {
  const count = requestedMealCount({
    mealCount,
    selectedMealSlotIds,
    selectedPickupItemIds,
    pickupRequest,
  });
  if (count <= 0) return { linked: false, requiredMealCount: 0 };

  const day = await resolveLinkedDay({ subscriptionId, date, pickupRequest, session });
  const explicitLinkedDayId = clean(pickupRequest && pickupRequest.subscriptionDayId);
  if (!day) {
    if (explicitLinkedDayId) {
      throw serviceError(
        "LINKED_DAY_NOT_FOUND",
        "The pickup request references a subscription day that no longer exists",
        409,
        { subscriptionDayId: explicitLinkedDayId, requestedMealCount: count }
      );
    }
    return { linked: false, requiredMealCount: count };
  }

  const hasPlannedMeals = dayHasPlannedMeals(day);
  const hasExplicitSlotSelection = (Array.isArray(selectedMealSlotIds) && selectedMealSlotIds.length > 0)
    || (pickupRequest && Array.isArray(pickupRequest.selectedMealSlotIds) && pickupRequest.selectedMealSlotIds.length > 0);
  const linkedIntent = explicitLinkedDayId || hasPlannedMeals || hasExplicitSlotSelection;
  if (!linkedIntent) {
    return { linked: false, day, requiredMealCount: count };
  }

  const query = Subscription.findById(subscriptionId)
    .select("baseMealAllocations remainingMeals reservedMeals entitlementVersion");
  optionalSession(query, session);
  const subscription = await query.lean();
  if (!subscription) {
    throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const projectedKeys = new Set(
    (Array.isArray(day.baseAllocationKeys) ? day.baseAllocationKeys : [])
      .map(clean)
      .filter(Boolean)
  );
  const allocations = (Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => (
    clean(allocation && allocation.dayId) === clean(day._id)
      || projectedKeys.has(clean(allocation && allocation.allocationKey))
  ));

  if (allocations.length === 0) {
    throw serviceError(
      "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
      "The linked subscription day has no meal allocation ledger; standalone debit is not allowed",
      409,
      {
        messageI18n: {
          ar: "تعذر تأكيد رصيد وجبات هذا اليوم. لم يتم خصم رصيد إضافي، ويرجى تحديث اليوم أو مراجعة الدعم.",
          en: "This day's meal balance could not be verified. No extra credit was deducted; refresh the day or contact support.",
        },
        subscriptionDayId: clean(day._id),
        date: day.date,
        dayStatus: day.status,
        plannerState: day.plannerState || day.planningState || null,
        requestedMealCount: count,
        remainingMeals: Number(subscription.remainingMeals || 0),
        reservedMeals: Number(subscription.reservedMeals || 0),
        entitlementVersion: Number(subscription.entitlementVersion || 0),
      }
    );
  }

  return {
    linked: true,
    day,
    allocations,
    requiredMealCount: count,
  };
}

module.exports = {
  assertLinkedDayAllocationIntegrity,
  dayHasPlannedMeals,
  requestedMealCount,
};
