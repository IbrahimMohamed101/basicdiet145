"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { logger } = require("../../utils/logger");
const {
  assertSubscriptionActiveAndOwned,
} = require("./subscriptionDateRangeHelperService");
const {
  assertDateInsideSubscriptionRange,
  assertFulfillmentMethodAllowed,
} = require("./subscriptionFulfillmentPolicyService");
const {
  buildAvailabilityFromDay,
  filterAvailabilityForVisibility,
  findBlockingPickupRequests,
} = require("./subscriptionPickupSlotService");

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function attachSession(query, session) {
  return session && query && typeof query.session === "function"
    ? query.session(session)
    : query;
}

function serviceError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function readOnlyMetadata() {
  return {
    readOnly: true,
    reconciliationApplied: false,
    reconciliationSource: "explicit_commands_and_recovery_workers",
  };
}

function localizedPair(value, fallback = { ar: "وجبة", en: "Meal" }) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.en || value.name || fallback.ar);
    const en = clean(value.en || value.nameEn || value.titleEn || value.ar || value.name || fallback.en);
    return { ar: ar || en || fallback.ar, en: en || ar || fallback.en };
  }
  const text = clean(value);
  return {
    ar: text || fallback.ar,
    en: text || fallback.en,
  };
}

function slotIdentity(slot = {}, index = 0) {
  return clean(slot.slotKey)
    || (Number(slot.slotIndex || 0) > 0 ? `slot_${Number(slot.slotIndex)}` : `slot_${index + 1}`);
}

function itemTypeForSlot(slot = {}) {
  const type = clean(slot.selectionType).toLowerCase();
  if (type === "premium_large_salad") return "large_salad";
  if (type === "sandwich") return "sandwich";
  if (type === "premium_meal" || slot.isPremium === true) return "premium_meal";
  if (["protein", "protein_extra"].includes(type)) return "protein_extra";
  return "meal";
}

function categoryForItemType(itemType) {
  if (itemType === "premium_meal") return "premium_meals";
  if (itemType === "large_salad") return "salads";
  if (itemType === "sandwich") return "sandwiches";
  if (itemType === "protein_extra") return "proteins";
  return "meals";
}

function buildActiveClaimMap(pickupRequests = []) {
  const map = new Map();
  for (const request of Array.isArray(pickupRequests) ? pickupRequests : []) {
    const ids = [
      ...(Array.isArray(request && request.selectedPickupItemIds) ? request.selectedPickupItemIds : []),
      ...(Array.isArray(request && request.selectedMealSlotIds) ? request.selectedMealSlotIds : []),
    ];
    for (const id of ids.map(clean).filter(Boolean)) {
      if (!map.has(id)) {
        map.set(id, {
          requestId: clean(request && request._id),
          status: clean(request && request.status),
        });
      }
    }
  }
  return map;
}

function claimReason(claim) {
  if (!claim) return null;
  if (claim.status === "fulfilled") return "SLOT_ALREADY_FULFILLED";
  if (claim.status === "no_show") return "SLOT_ALREADY_NO_SHOW";
  return "SLOT_ALREADY_RESERVED";
}

function reasonCopy(reason) {
  const copy = {
    PLANNING_INCOMPLETE: {
      ar: "يجب إكمال اختيار الوجبة أولاً",
      en: "Meal selection must be completed first",
    },
    PREMIUM_PAYMENT_REQUIRED: {
      ar: "يجب إتمام دفع ترقية الوجبة أولاً",
      en: "Premium meal upgrade payment is required first",
    },
    ADDON_PAYMENT_REQUIRED: {
      ar: "يجب إتمام دفع الإضافات أولاً",
      en: "Add-on payment is required first",
    },
    SLOT_ALREADY_RESERVED: {
      ar: "تم طلب استلام هذه الوجبة بالفعل",
      en: "This meal has already been requested for pickup",
    },
    SLOT_ALREADY_FULFILLED: {
      ar: "تم استلام هذه الوجبة بالفعل",
      en: "This meal has already been picked up",
    },
    SLOT_ALREADY_NO_SHOW: {
      ar: "تم تسجيل عدم استلام هذه الوجبة",
      en: "This meal was marked as not collected",
    },
  };
  return copy[reason] || { ar: "هذه الوجبة غير متاحة الآن", en: "This meal is not available now" };
}

function availabilityState(reason) {
  if (!reason) return "available";
  if (["PREMIUM_PAYMENT_REQUIRED", "ADDON_PAYMENT_REQUIRED"].includes(reason)) return "payment_required";
  if (reason === "SLOT_ALREADY_FULFILLED") return "fulfilled";
  if (reason === "SLOT_ALREADY_NO_SHOW") return "no_show";
  if (reason === "SLOT_ALREADY_RESERVED") return "reserved";
  return "canceled";
}

function titleForSlot(slot = {}) {
  const display = slot.displaySnapshot && typeof slot.displaySnapshot === "object"
    ? slot.displaySnapshot
    : {};
  const confirmation = slot.confirmationSnapshot && typeof slot.confirmationSnapshot === "object"
    ? slot.confirmationSnapshot
    : {};
  return localizedPair(
    display.title
      || confirmation.title
      || slot.productNameI18n
      || slot.productName
      || slot.nameI18n
      || slot.name,
    slot.isPremium
      ? { ar: "وجبة مميزة", en: "Premium meal" }
      : { ar: "وجبة", en: "Meal" }
  );
}

function subtitleForSlot(slot = {}) {
  const display = slot.displaySnapshot && typeof slot.displaySnapshot === "object"
    ? slot.displaySnapshot
    : {};
  const confirmation = slot.confirmationSnapshot && typeof slot.confirmationSnapshot === "object"
    ? slot.confirmationSnapshot
    : {};
  return localizedPair(
    display.subtitle || confirmation.subtitle || slot.descriptionI18n || slot.description,
    { ar: "", en: "" }
  );
}

function buildConservativeAvailability({ day, pickupRequests = [], subscription = {} } = {}) {
  const activeClaims = buildActiveClaimMap(pickupRequests);
  const pendingAddonPayment = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .some((selection) => selection && selection.source === "pending_payment");

  const slots = (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).map((slot, index) => {
    const slotId = slotIdentity(slot, index);
    const claim = activeClaims.get(slotId);
    const reasons = [];
    if (clean(slot && slot.status || "complete") !== "complete") reasons.push("PLANNING_INCOMPLETE");
    if (slot && slot.isPremium === true && clean(slot.premiumSource) === "pending_payment") {
      reasons.push("PREMIUM_PAYMENT_REQUIRED");
    }
    if (pendingAddonPayment) reasons.push("ADDON_PAYMENT_REQUIRED");
    const existingClaimReason = claimReason(claim);
    if (existingClaimReason) reasons.push(existingClaimReason);

    const unavailableReason = reasons[0] || null;
    const available = !unavailableReason;
    const itemType = itemTypeForSlot(slot);
    const title = titleForSlot(slot);
    const subtitle = subtitleForSlot(slot);
    const copy = unavailableReason
      ? reasonCopy(unavailableReason)
      : { ar: "متاح للاستلام", en: "Available for pickup" };
    const productId = clean(
      slot && (slot.productId || slot.sandwichId || slot.proteinId || slot.sourceId)
    ) || null;
    const paymentRequired = ["PREMIUM_PAYMENT_REQUIRED", "ADDON_PAYMENT_REQUIRED"].includes(unavailableReason);

    return {
      slotId,
      slotKey: clean(slot && slot.slotKey) || slotId,
      slotIndex: Number(slot && slot.slotIndex || index + 1),
      selectionType: clean(slot && slot.selectionType) || "standard_meal",
      isPremium: Boolean(slot && slot.isPremium),
      premiumSource: clean(slot && slot.premiumSource) || "none",
      title,
      productId,
      productName: title.en || title.ar,
      product: {
        id: productId,
        key: clean(slot && slot.productKey) || null,
        name: title,
      },
      meal: {
        title,
        subtitle,
        image: clean(slot && (slot.imageUrl || slot.image)) || null,
        mealType: clean(slot && slot.selectionType) || "standard_meal",
        quantity: 1,
      },
      available,
      isAvailableForPickup: available,
      canSelect: available,
      unavailableReason,
      reasons,
      reservedByPickupRequestId: claim ? claim.requestId : null,
      availabilityState: availabilityState(unavailableReason),
      options: [],
      addons: [],
      paymentRequired,
      paymentStatus: paymentRequired ? "pending" : "not_required",
      amountDue: 0,
      payment: {
        required: paymentRequired,
        status: paymentRequired ? "pending" : "not_required",
        reason: paymentRequired ? unavailableReason : null,
        amountDue: 0,
        currency: "SAR",
      },
      display: {
        titleAr: title.ar,
        titleEn: title.en,
        subtitleAr: subtitle.ar,
        subtitleEn: subtitle.en,
        badgesAr: [],
        badgesEn: [],
        statusTextAr: copy.ar,
        statusTextEn: copy.en,
        selectionTextAr: available ? "اختر هذه الوجبة للاستلام" : "",
        selectionTextEn: available ? "Select this meal for pickup" : "",
        unavailableTextAr: available ? "" : copy.ar,
        unavailableTextEn: available ? "" : copy.en,
      },
      _itemType: itemType,
    };
  });

  const pickupItems = slots.map((slot) => ({
    itemId: slot.slotId,
    itemType: slot._itemType,
    source: "mealSlot",
    sourceId: slot.slotId,
    slotId: slot.slotId,
    slotKey: slot.slotKey,
    slotIndex: slot.slotIndex,
    selectionType: slot.selectionType,
    categoryKey: categoryForItemType(slot._itemType),
    quantity: 1,
    title: slot.title,
    subtitle: slot.meal.subtitle,
    image: slot.meal.image,
    product: slot.product,
    components: [],
    payment: slot.payment,
    availability: {
      state: slot.availabilityState,
      available: slot.available,
      canSelect: slot.canSelect,
      unavailableReason: slot.unavailableReason,
      reasonLabel: slot.unavailableReason ? reasonCopy(slot.unavailableReason) : { ar: "", en: "" },
      reservedByPickupRequestId: slot.reservedByPickupRequestId,
      fulfilledByPickupRequestId: ["fulfilled", "no_show"].includes(slot.availabilityState)
        ? slot.reservedByPickupRequestId
        : null,
      reasons: slot.reasons,
    },
    display: slot.display,
    selectionMode: "independent",
  }));

  const visibleSlots = slots.map(({ _itemType, ...slot }) => slot);
  const availableCount = pickupItems.filter((item) => item.availability.available && item.availability.canSelect).length;
  const byCategory = (categoryKey) => pickupItems.filter((item) => item.categoryKey === categoryKey);
  const sections = [
    { sectionKey: "meals", titleAr: "الوجبات", titleEn: "Meals", items: byCategory("meals") },
    { sectionKey: "premium_meals", titleAr: "الوجبات المميزة", titleEn: "Premium Meals", items: byCategory("premium_meals") },
    { sectionKey: "salads", titleAr: "السلطات", titleEn: "Salads", items: byCategory("salads") },
    { sectionKey: "proteins", titleAr: "البروتين الإضافي", titleEn: "Extra Protein", items: byCategory("proteins") },
    { sectionKey: "sandwiches", titleAr: "الساندوتشات", titleEn: "Sandwiches", items: byCategory("sandwiches") },
    { sectionKey: "addons", titleAr: "الإضافات", titleEn: "Add-ons", items: [] },
  ];

  return {
    date: day && day.date || null,
    subscriptionDayId: clean(day && day._id) || null,
    paymentReason: pendingAddonPayment ? "ADDON_PAYMENT_REQUIRED" : null,
    paymentRequirement: {
      requiresPayment: pendingAddonPayment,
      blockingReason: pendingAddonPayment ? "ADDON_PAYMENT_REQUIRED" : null,
    },
    commercialState: pendingAddonPayment ? "payment_required" : "ready",
    addonCategoryAllowances: [],
    addonSubscriptionAllowances: [],
    slots: visibleSlots,
    dayAddons: [],
    availableAddonChoices: [],
    addonSummary: {
      totalCount: 0,
      pendingCount: 0,
      paidCount: 0,
      includedCount: 0,
      availableCount: 0,
      amountDue: 0,
      currency: "SAR",
      availableChoiceCount: 0,
      categoryAllowances: [],
      subscriptionAllowances: [],
    },
    pickupItems,
    sections,
    availableSlotIds: visibleSlots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: visibleSlots.filter((slot) => !slot.available).map((slot) => slot.slotId),
    hiddenUnavailableCount: 0,
    summary: {
      availableCount,
      unavailableCount: pickupItems.length - availableCount,
      availableSelectableCount: availableCount,
      paymentBlockedCount: pickupItems.filter((item) => item.availability.state === "payment_required").length,
      reservedCount: pickupItems.filter((item) => item.availability.state === "reserved").length,
      fulfilledCount: pickupItems.filter((item) => item.availability.state === "fulfilled").length,
      noShowCount: pickupItems.filter((item) => item.availability.state === "no_show").length,
      hiddenUnavailableCount: 0,
      availableMealSlotCount: availableCount,
      availableAddonCount: 0,
      availableSaladCount: pickupItems.filter((item) => item.itemType === "large_salad" && item.availability.available).length,
      availableProteinExtraCount: pickupItems.filter((item) => item.itemType === "protein_extra" && item.availability.available).length,
      availableSandwichCount: pickupItems.filter((item) => item.itemType === "sandwich" && item.availability.available).length,
      canCreatePickupRequest: availableCount > 0,
      canAppendMeals: Number(subscription && subscription.remainingMeals || 0) > 0,
      appendLimit: Number(subscription && subscription.remainingMeals || 0),
      titleAr: availableCount > 0 ? "عناصر متاحة للاستلام" : "لا توجد عناصر متاحة للاستلام",
      titleEn: availableCount > 0 ? "Items available for pickup" : "No items available for pickup",
      emptyTextAr: "",
      emptyTextEn: "",
    },
  };
}

function buildWallet(subscription = {}, availability = {}) {
  const subscriptionDayId = clean(availability.subscriptionDayId);
  const availableReservedDayMeals = (Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => (
    allocation
      && allocation.state === "reserved"
      && !allocation.pickupRequestId
      && (!subscriptionDayId || clean(allocation.dayId) === subscriptionDayId)
  )).length;
  const remainingMeals = Number(subscription.remainingMeals || 0);
  return {
    totalEntitlement: Number(subscription.totalMeals || 0),
    remainingMeals,
    availableMeals: remainingMeals + availableReservedDayMeals,
    reservedMeals: (availability.slots || []).filter((slot) => slot && slot.reservedByPickupRequestId).length,
    consumedMeals: (availability.slots || []).filter((slot) => (
      slot && ["SLOT_ALREADY_FULFILLED", "SLOT_ALREADY_CONSUMED"].includes(slot.unavailableReason)
    )).length,
  };
}

async function buildCanonicalPickupAvailabilityRead({
  userId,
  subscriptionId,
  date,
  includeUnavailable = false,
  includeHistory = false,
  session = null,
} = {}) {
  const subscription = await attachSession(
    Subscription.findById(subscriptionId).lean(),
    session
  );
  if (!subscription) {
    throw serviceError("NOT_FOUND", "Subscription not found", 404);
  }

  assertSubscriptionActiveAndOwned({ subscription, userId, date });
  assertDateInsideSubscriptionRange({ subscription, date });

  const day = await attachSession(
    SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).lean(),
    session
  );
  try {
    assertFulfillmentMethodAllowed({ subscription, day, date, requestedMethod: "pickup" });
  } catch (error) {
    if (error && error.code === "FULFILLMENT_METHOD_NOT_ALLOWED") {
      throw serviceError("INVALID_DELIVERY_MODE", "Delivery mode is not pickup", 400);
    }
    throw error;
  }

  const pickupRequests = await findBlockingPickupRequests({
    subscriptionId: subscription._id,
    date,
    session,
  });

  let availability;
  let readMode = "canonical_snapshot";
  let presentationError = null;
  try {
    availability = buildAvailabilityFromDay({
      day,
      pickupRequests,
      subscription,
      catalogMaps: {},
      addonChoiceGroups: null,
    });
    availability = filterAvailabilityForVisibility(availability, {
      includeUnavailable,
      includeHistory,
    });
  } catch (error) {
    presentationError = error;
    readMode = "conservative_snapshot";
    availability = buildConservativeAvailability({ day, pickupRequests, subscription });
    if (!includeUnavailable && !includeHistory) {
      const visibleIds = new Set((availability.pickupItems || [])
        .filter((item) => ["available", "payment_required"].includes(item && item.availability && item.availability.state))
        .map((item) => item.itemId));
      availability.pickupItems = (availability.pickupItems || []).filter((item) => visibleIds.has(item.itemId));
      availability.slots = (availability.slots || []).filter((slot) => visibleIds.has(slot.slotId));
      availability.sections = (availability.sections || []).map((section) => ({
        ...section,
        items: (section.items || []).filter((item) => visibleIds.has(item.itemId)),
      }));
      availability.availableSlotIds = availability.slots.filter((slot) => slot.available).map((slot) => slot.slotId);
      availability.unavailableSlotIds = availability.slots.filter((slot) => !slot.available).map((slot) => slot.slotId);
    }
  }

  const wallet = buildWallet(subscription, availability);
  const summary = {
    ...(availability.summary || {}),
    canAppendMeals: Number(subscription.remainingMeals || 0) > 0,
    appendLimit: Number(subscription.remainingMeals || 0),
  };

  return {
    subscriptionId: clean(subscription._id),
    date,
    subscriptionDayId: availability.subscriptionDayId,
    remainingMeals: Number(subscription.remainingMeals || 0),
    paymentReason: availability.paymentReason || null,
    paymentRequirement: availability.paymentRequirement || null,
    commercialState: availability.commercialState || null,
    addonCategoryAllowances: availability.addonCategoryAllowances || [],
    addonSubscriptionAllowances: availability.addonSubscriptionAllowances || [],
    wallet,
    summary,
    slots: availability.slots || [],
    dayAddons: availability.dayAddons || [],
    availableAddonChoices: availability.availableAddonChoices || [],
    addonSummary: availability.addonSummary || {},
    pickupItems: availability.pickupItems || [],
    sections: availability.sections || [],
    availableSlotIds: availability.availableSlotIds || [],
    unavailableSlotIds: availability.unavailableSlotIds || [],
    readConsistency: readOnlyMetadata(),
    dailyAddonReconciliation: null,
    availabilityRead: {
      mode: readMode,
      sourceOfTruth: "subscription_day_and_pickup_requests",
      presentationFallbackApplied: Boolean(presentationError),
    },
  };
}

function shouldRecoverAvailabilityError(error) {
  if (!error) return true;
  const status = Number(error.status || 500);
  return status >= 500;
}

function buildAvailabilityReadClosure(original, {
  resolveContext,
  buildCanonicalRead = buildCanonicalPickupAvailabilityRead,
  log = logger,
} = {}) {
  if (typeof original !== "function") {
    throw serviceError("PICKUP_AVAILABILITY_READ_INSTALL_FAILED", "Pickup availability function is unavailable", 500);
  }
  if (typeof resolveContext !== "function") {
    throw serviceError("PICKUP_AVAILABILITY_READ_INSTALL_FAILED", "Pickup ownership resolver is unavailable", 500);
  }

  const wrapped = async function canonicalPickupAvailabilityRead(args = {}) {
    try {
      return await original(args);
    } catch (error) {
      if (!shouldRecoverAvailabilityError(error)) throw error;

      let context;
      try {
        context = await resolveContext(args);
      } catch (_contextError) {
        throw error;
      }

      log.error("pickup availability primary read failed; rebuilding canonical read", {
        subscriptionId: clean(context && context.subscriptionId),
        requestedSubscriptionId: clean(args.subscriptionId),
        userId: clean(args.userId),
        date: clean(args.date),
        errorCode: clean(error && error.code) || "INTERNAL",
        error: clean(error && error.message) || "Pickup availability failed",
        stack: error && error.stack,
      });

      const recovered = await buildCanonicalRead({
        ...args,
        subscriptionId: context.subscriptionId,
      });
      return {
        ...recovered,
        identifierResolution: context && context.resolution !== "exact_owner"
          ? {
            requestedId: clean(context.requestedSubscriptionId || args.subscriptionId),
            requestedPlanId: clean(context.requestedPlanId) || null,
            subscriptionId: clean(context.subscriptionId),
            resolution: context.resolution,
          }
          : undefined,
        availabilityRecovery: {
          recovered: true,
          originalErrorCode: clean(error && error.code) || "INTERNAL",
          sourceOfTruth: "subscription_day_and_pickup_requests",
        },
      };
    }
  };
  wrapped.__pickupAvailabilityCanonicalReadClosure = true;
  wrapped.__original = original;
  return wrapped;
}

module.exports = {
  buildAvailabilityReadClosure,
  buildCanonicalPickupAvailabilityRead,
  buildConservativeAvailability,
  buildWallet,
  shouldRecoverAvailabilityError,
};
