"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const canonical = require("./subscription/pickupCanonicalPresentationService");
const {
  applyEntitlementAvailability,
} = require("./subscription/pickupEntitlementLinkService");
const balanceClosure = require("./subscription/subscriptionPickupRequestBalanceClosureService");

const INSTALL_KEY = Symbol.for("basicdiet.pickupEntitlementClosure.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupEntitlementClosure.wrapped");
const ACTIVE_PICKUP_STATUSES = ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "no_show"];

function recomputeSummary(result = {}) {
  const items = Array.isArray(result.pickupItems) ? result.pickupItems : [];
  const selectable = items.filter((item) => item && item.selectionMode === "independent");
  const available = selectable.filter((item) => item.availability && item.availability.available && item.availability.canSelect);
  const stateCount = (state) => selectable.filter((item) => item.availability && item.availability.state === state).length;
  const availableByType = (type) => available.filter((item) => item.itemType === type).length;
  const previous = result.summary && typeof result.summary === "object" ? result.summary : {};
  return {
    ...previous,
    availableCount: available.length,
    unavailableCount: selectable.length - available.length,
    availableSelectableCount: available.length,
    paymentBlockedCount: stateCount("payment_required"),
    reservedCount: stateCount("reserved"),
    fulfilledCount: stateCount("fulfilled"),
    noShowCount: stateCount("no_show"),
    availableMealSlotCount: availableByType("meal") + availableByType("premium_meal")
      + availableByType("large_salad") + availableByType("sandwich"),
    availableAddonCount: availableByType("addon"),
    availableSaladCount: availableByType("large_salad"),
    availableProteinExtraCount: availableByType("protein_extra"),
    availableSandwichCount: availableByType("sandwich"),
    canCreatePickupRequest: available.length > 0,
    titleAr: available.length > 0 ? "عناصر متاحة للاستلام" : "لا توجد عناصر متاحة للاستلام",
    titleEn: available.length > 0 ? "Items available for pickup" : "No items available for pickup",
  };
}

function filterVisible(result, { includeUnavailable = false, includeHistory = false } = {}) {
  if (includeUnavailable || includeHistory) return result;
  const isVisible = (item) => {
    const state = item && item.availability && item.availability.state || item && item.availabilityState || "available";
    return state === "available" || state === "payment_required";
  };
  const pickupItems = (result.pickupItems || []).filter(isVisible);
  const itemIds = new Set(pickupItems.map((item) => String(item.itemId || "")));
  const visibleSlotIds = new Set(pickupItems.filter((item) => item.slotId).map((item) => String(item.slotId)));
  const slots = (result.slots || []).filter((slot) => visibleSlotIds.has(String(slot.slotId || "")));
  const sections = (result.sections || []).map((section) => ({
    ...section,
    items: (section.items || []).filter((item) => itemIds.has(String(item.itemId || ""))),
  }));
  return {
    ...result,
    slots,
    pickupItems,
    sections,
    availableSlotIds: slots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: slots.filter((slot) => !slot.available).map((slot) => slot.slotId),
  };
}

function patchBalanceService() {
  const balance = require("./subscription/subscriptionPickupRequestBalanceService");
  balance.reserveSubscriptionMealsForPickupRequest = balanceClosure.reserveSubscriptionMealsForPickupRequest;
  balance.releaseReservedPickupMeals = balanceClosure.releaseReservedPickupMeals;
  return balance;
}

function patchPickupSlotService() {
  const service = require("./subscription/subscriptionPickupSlotService");
  const original = service.assertSelectedPickupItemsAvailable;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return service;
  const wrapped = async function entitlementAwareSelectedItems(args = {}) {
    const result = await original(args);
    const selectedMealItems = (result.selectedPickupItems || []).filter((item) => canonical.isMealPickupItem(item));
    return {
      ...result,
      selectedMealSlotIds: selectedMealItems
        .map((item) => String(item.slotId || item.slotKey || item.itemId || "").trim())
        .filter(Boolean),
      mealCreditCount: selectedMealItems.length,
    };
  };
  wrapped[WRAPPED_KEY] = true;
  service.assertSelectedPickupItemsAvailable = wrapped;
  return service;
}

function patchPickupClientService() {
  const service = require("./subscription/subscriptionPickupRequestClientService");
  const original = service.getPickupAvailabilityForClient;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return service;
  const wrapped = async function entitlementAwarePickupAvailability(args = {}) {
    let result = await original(args);
    const [subscription, day, pickupRequests] = await Promise.all([
      Subscription.findById(args.subscriptionId).select("remainingMeals reservedMeals baseMealAllocations").lean(),
      SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean(),
      SubscriptionPickupRequest.find({
        subscriptionId: args.subscriptionId,
        date: args.date,
        status: { $in: ACTIVE_PICKUP_STATUSES },
      }).lean(),
    ]);
    if (!subscription || !day) return result;
    result = applyEntitlementAvailability({
      availability: result,
      subscription,
      day,
      pickupRequests,
    });
    result = filterVisible(result, args);
    result.summary = recomputeSummary(result);
    return result;
  };
  wrapped[WRAPPED_KEY] = true;
  service.getPickupAvailabilityForClient = wrapped;
  return service;
}

function installPickupEntitlementClosure() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  patchBalanceService();
  patchPickupSlotService();
}

installPickupEntitlementClosure();

module.exports = {
  installPickupEntitlementClosure,
  patchBalanceService,
  patchPickupClientService,
  patchPickupSlotService,
  recomputeSummary,
};
