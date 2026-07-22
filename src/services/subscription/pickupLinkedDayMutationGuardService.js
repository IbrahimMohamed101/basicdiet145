"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const liveBalanceService = require("./subscriptionPickupRequestBalanceService");
const balanceClosureService = require("./subscriptionPickupRequestBalanceClosureService");
const linkPolicy = require("./pickupEntitlementLinkService");
const { dayHasPlannedMeals } = require("./pickupLinkedDayIntegrityService");
const {
  ensureEntitlementLedger,
} = require("./subscriptionMealEntitlementService");
const {
  repairLinkedDayAllocations,
} = require("./pickupLinkedDayAllocationRepairService");

const INSTALL_KEY = Symbol.for("basicdiet.pickupLinkedDayMutationGuard.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupLinkedDayMutationGuard.wrapped");

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
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function selectedMealSlotKeys(pickupRequest = {}) {
  const direct = unique(pickupRequest.selectedMealSlotIds || []);
  if (direct.length) return direct;

  const selectedItems = Array.isArray(pickupRequest.selectedPickupItems)
    ? pickupRequest.selectedPickupItems
    : [];
  return unique(selectedItems
    .filter((item) => linkPolicy.isMealPickupItem(item))
    .map((item) => item.slotKey || item.slotId || item.sourceId || item.itemId));
}

function allocationMatchesSlot(allocation, requestedSlotKey) {
  const requestedAliases = new Set(linkPolicy.slotAliases(requestedSlotKey));
  return linkPolicy.slotAliases(allocation && allocation.slotKey)
    .some((alias) => requestedAliases.has(alias));
}

function integrityDetails({ subscription, day, pickupRequest, allocations, requestedSlotKeys }) {
  return {
    subscriptionId: clean(subscription && subscription._id),
    subscriptionDayId: clean(day && day._id) || clean(pickupRequest && pickupRequest.subscriptionDayId),
    date: clean(day && day.date) || clean(pickupRequest && pickupRequest.date),
    pickupRequestId: clean(pickupRequest && pickupRequest._id),
    selectionMode: clean(pickupRequest && pickupRequest.selectionMode),
    mealCount: Number(pickupRequest && pickupRequest.mealCount || 0),
    requestedSlotKeys,
    remainingMeals: Number(subscription && subscription.remainingMeals || 0),
    reservedMeals: Number(subscription && subscription.reservedMeals || 0),
    allocations: (Array.isArray(allocations) ? allocations : []).map((allocation) => ({
      allocationKey: clean(allocation && allocation.allocationKey),
      slotKey: clean(allocation && allocation.slotKey),
      state: clean(allocation && allocation.state),
      pickupRequestId: clean(allocation && allocation.pickupRequestId) || null,
    })),
  };
}

async function assertLinkedDayMutationIntegrity({
  subscriptionId,
  pickupRequest,
  session = null,
} = {}) {
  if (!pickupRequest || !pickupRequest.subscriptionDayId) {
    return { linked: false, reason: "no_linked_day" };
  }

  const mealCount = Number(pickupRequest.mealCount || 0);
  if (!Number.isInteger(mealCount) || mealCount <= 0) {
    return { linked: false, reason: "no_base_meal_credits" };
  }

  const dayQuery = SubscriptionDay.findById(pickupRequest.subscriptionDayId);
  if (session) dayQuery.session(session);
  const day = await dayQuery.lean();
  if (!day) {
    throw serviceError(
      "LINKED_DAY_NOT_FOUND",
      "Linked subscription day was not found",
      409,
      {
        messageAr: "تعذر العثور على يوم الاشتراك المرتبط بطلب الاستلام.",
        messageEn: "The subscription day linked to this pickup request could not be found.",
        subscriptionId: clean(subscriptionId),
        subscriptionDayId: clean(pickupRequest.subscriptionDayId),
        pickupRequestId: clean(pickupRequest._id),
      }
    );
  }

  const requestedSlotKeys = selectedMealSlotKeys(pickupRequest);
  const isCanonicalSelection = requestedSlotKeys.length > 0
    || ["pickup_item_ids", "slot_ids"].includes(clean(pickupRequest.selectionMode));
  const plannedDay = dayHasPlannedMeals(day);

  if (!isCanonicalSelection && !plannedDay) {
    return { linked: false, reason: "legacy_empty_day" };
  }

  const subscriptionQuery = Subscription.findById(subscriptionId)
    .select("remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery.lean();
  if (!subscription) {
    throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const allocations = (Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation.dayId) === clean(day._id));
  const details = integrityDetails({
    subscription,
    day,
    pickupRequest,
    allocations,
    requestedSlotKeys,
  });

  if (!allocations.length) {
    throw serviceError(
      "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
      "The planned pickup day has no entitlement allocations; refusing standalone debit",
      409,
      {
        ...details,
        reason: "linked_day_allocations_missing",
        messageAr: "تعذر تأكيد رصيد وجبات هذا اليوم. لم يتم خصم رصيد إضافي.",
        messageEn: "This day's meal balance could not be verified. No extra credit was deducted.",
      }
    );
  }

  if (requestedSlotKeys.length) {
    const exactAllocations = allocations.filter((allocation) => requestedSlotKeys
      .some((requestedSlotKey) => allocationMatchesSlot(allocation, requestedSlotKey)));
    const exactAllocationKeys = unique(exactAllocations.map((allocation) => allocation.allocationKey));

    if (exactAllocationKeys.length < mealCount) {
      throw serviceError(
        "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
        "The selected pickup slots do not match the linked day entitlement allocations",
        409,
        {
          ...details,
          reason: "selected_slots_do_not_match_allocations",
          exactMatchCount: exactAllocationKeys.length,
          messageAr: "تعذر مطابقة الوجبات المحددة مع رصيد اليوم. لم يتم خصم رصيد إضافي.",
          messageEn: "The selected meals could not be matched to this day's balance. No extra credit was deducted.",
        }
      );
    }
  }

  return {
    linked: true,
    day,
    allocations,
    requestedSlotKeys,
  };
}

function buildGuardedReserve(originalReserve) {
  const guarded = async function reserveWithLinkedDayMutationGuard(args = {}) {
    const requestQuery = SubscriptionPickupRequest.findById(args.pickupRequestId);
    if (args.session) requestQuery.session(args.session);
    const pickupRequest = await requestQuery;

    if (!pickupRequest || pickupRequest.creditsReserved || Number(pickupRequest.mealCount || 0) <= 0) {
      return originalReserve(args);
    }

    // Upgrade legacy aggregate-only balances first. The migration reclassifies
    // totalMeals - remainingMeals as an unmaterialized consumed aggregate; the
    // linked-day repair can then adopt that existing debit instead of charging
    // remainingMeals again.
    await ensureEntitlementLedger(args.subscriptionId, args.session || null);
    await repairLinkedDayAllocations({
      subscriptionId: args.subscriptionId,
      date: pickupRequest.date,
      dayId: pickupRequest.subscriptionDayId,
      pickupRequest,
      mealCount: pickupRequest.mealCount,
      selectedMealSlotIds: pickupRequest.selectedMealSlotIds,
      selectedPickupItemIds: pickupRequest.selectedPickupItemIds,
      session: args.session || null,
    });
    await assertLinkedDayMutationIntegrity({
      subscriptionId: args.subscriptionId,
      pickupRequest,
      session: args.session || null,
    });
    return originalReserve(args);
  };
  guarded[WRAPPED_KEY] = true;
  guarded.__original = originalReserve;
  guarded.__linkedDayMutationGuard = true;
  guarded.__linkedDayAllocationRepair = true;
  guarded.__legacyEntitlementUpgrade = true;
  return guarded;
}

function installPickupLinkedDayMutationGuard() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const originalReserve = balanceClosureService.reserveSubscriptionMealsForPickupRequest;
  if (typeof originalReserve !== "function") {
    throw serviceError(
      "PICKUP_LINKED_DAY_GUARD_INSTALL_FAILED",
      "Pickup balance closure reserve function is unavailable",
      500
    );
  }

  const guardedReserve = originalReserve[WRAPPED_KEY]
    ? originalReserve
    : buildGuardedReserve(originalReserve);

  balanceClosureService.reserveSubscriptionMealsForPickupRequest = guardedReserve;
  liveBalanceService.reserveSubscriptionMealsForPickupRequest = guardedReserve;

  const state = {
    installed: true,
    guardedReserve,
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPickupLinkedDayMutationGuard();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  allocationMatchesSlot,
  assertLinkedDayMutationIntegrity,
  installPickupLinkedDayMutationGuard,
  selectedMealSlotKeys,
};
