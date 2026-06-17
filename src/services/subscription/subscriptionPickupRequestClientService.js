"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const MenuProduct = require("../../models/MenuProduct");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
require("../../models/Plan");
const dateUtils = require("../../utils/date");
const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("./subscriptionPickupRequestBalanceService");
const {
  assertDateInsideSubscriptionRange,
  assertFulfillmentMethodAllowed,
} = require("./subscriptionFulfillmentPolicyService");
const { assertRestaurantOpenForOrdering } = require("../restaurantHoursService");
const {
  assertSubscriptionActiveAndOwned,
} = require("./subscriptionDateRangeHelperService");
const {
  assertSelectedPickupItemsAvailable,
  assertSelectedSlotsAvailableForPickup,
  buildAvailabilityFromDay,
  buildPickupRequestPayloadHash,
  enrichDayMealSlotsWithResolvedSnapshots,
  filterAvailabilityForVisibility,
  findBlockingPickupRequests,
  normalizeSelectedMealSlotIds,
  normalizeSelectedPickupItemIds,
  resolveCanonicalPaymentReason,
} = require("./subscriptionPickupSlotService");

const PICKUP_REQUEST_ALLOWED_DAY_STATUSES = [
  "open",
  "locked",
  "in_preparation",
  "out_for_delivery",
  "ready_for_pickup",
  "fulfilled",
  "consumed_without_preparation",
  "delivery_canceled",
  "canceled_at_branch",
  "no_show",
];
const ACTIVE_PICKUP_REQUEST_STATUSES = ["locked", "in_preparation", "ready_for_pickup"];
const TERMINAL_PICKUP_REQUEST_STATUSES = ["fulfilled", "no_show", "canceled"];

const PICKUP_REQUEST_STATUS_COPY = {
  locked: {
    currentStep: 2,
    statusLabel: "Your order is locked",
    message: "Modification period has ended. Waiting for kitchen.",
  },
  in_preparation: {
    currentStep: 3,
    statusLabel: "Kitchen is preparing your meals",
    message: "Chef is hand-picking ingredients for your order.",
  },
  ready_for_pickup: {
    currentStep: 4,
    statusLabel: "Your order is ready",
    message: "Use this pickup code at the branch.",
  },
  fulfilled: {
    currentStep: 4,
    statusLabel: "Completed",
    message: "Order picked up successfully.",
  },
  no_show: {
    currentStep: 4,
    statusLabel: "Pickup window ended without collection",
    message: "Your prepared pickup was not collected.",
  },
  canceled: {
    currentStep: 1,
    statusLabel: "Canceled",
    message: "Pickup request was canceled.",
  },
};

function createServiceError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function buildPickupAvailabilityWallet(subscription = {}, availability = {}) {
  const remainingMeals = Number(subscription.remainingMeals || 0);
  const reservedMeals = Array.isArray(availability.slots)
    ? availability.slots.filter((slot) => slot && slot.reservedByPickupRequestId && slot.unavailableReason !== "SLOT_ALREADY_FULFILLED").length
    : 0;
  const consumedMeals = Array.isArray(availability.slots)
    ? availability.slots.filter((slot) => slot && ["SLOT_ALREADY_FULFILLED", "SLOT_ALREADY_CONSUMED"].includes(slot.unavailableReason)).length
    : 0;
  return {
    remainingMeals,
    availableMeals: remainingMeals,
    reservedMeals,
    consumedMeals,
    totalEntitlement: Number(subscription.totalMeals || subscription.mealCount || 0),
  };
}

function buildPickupAvailabilitySummary({ subscription = {}, availability = {} }) {
  const selectableItems = Array.isArray(availability.pickupItems)
    ? availability.pickupItems.filter((item) => item && item.selectionMode === "independent")
    : [];
  const stateCount = (state) => selectableItems.filter((item) => item && item.availability && item.availability.state === state).length;
  const availableSelectableCount = selectableItems.filter((item) => item && item.availability && item.availability.available && item.availability.canSelect).length;
  const paymentBlockedCount = stateCount("payment_required");
  const reservedCount = stateCount("reserved");
  const fulfilledCount = stateCount("fulfilled");
  const noShowCount = stateCount("no_show");
  const availableByType = (type) => selectableItems.filter((item) => item && item.itemType === type && item.availability && item.availability.available && item.availability.canSelect).length;
  const appendLimit = Number(subscription.remainingMeals || 0);
  const canAppendMeals = appendLimit > 0;
  return {
    availableCount: availableSelectableCount,
    unavailableCount: selectableItems.length - availableSelectableCount,
    availableSelectableCount,
    paymentBlockedCount,
    reservedCount,
    fulfilledCount,
    noShowCount,
    hiddenUnavailableCount: Number(availability.hiddenUnavailableCount || 0),
    availableMealSlotCount: availableByType("meal") + availableByType("premium_meal"),
    availableAddonCount: availableByType("addon"),
    availableSaladCount: availableByType("large_salad"),
    availableProteinExtraCount: availableByType("protein_extra"),
    availableSandwichCount: availableByType("sandwich"),
    canCreatePickupRequest: availableSelectableCount > 0,
    canAppendMeals,
    appendLimit,
    titleAr: availableSelectableCount > 0 ? "عناصر متاحة للاستلام" : "لا توجد عناصر متاحة للاستلام",
    titleEn: availableSelectableCount > 0 ? "Items available for pickup" : "No items available for pickup",
    emptyTextAr: availableSelectableCount === 0 && canAppendMeals
      ? "لا توجد عناصر متاحة للاستلام الآن. يمكنك إضافة عناصر جديدة لهذا اليوم من رصيد اشتراكك."
      : "",
    emptyTextEn: availableSelectableCount === 0 && canAppendMeals
      ? "No items are available for pickup now. You can add new items for this day from your subscription balance."
      : "",
  };
}

function addSetValue(set, value) {
  if (value === undefined || value === null) return;
  const raw = String(value).trim();
  if (raw) set.add(raw);
}

function dedupeLocal(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function isObjectIdString(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || ""));
}

function addDocToMaps(maps, kind, doc) {
  if (!doc) return;
  if (doc._id) maps[`${kind}ById`].set(String(doc._id), doc);
  if (doc.key) maps[`${kind}ByKey`].set(String(doc.key), doc);
}

async function loadPickupAvailabilityCatalogMaps(day, { session = null } = {}) {
  const productIds = new Set();
  const productKeys = new Set();
  const optionIds = new Set();
  const optionKeys = new Set();
  const groupIds = new Set();
  const groupKeys = new Set();
  const proteinIds = new Set();
  const proteinKeys = new Set();
  const carbIds = new Set();
  const carbKeys = new Set();

  for (const slot of Array.isArray(day && day.mealSlots) ? day.mealSlots : []) {
    addSetValue(productIds, slot && slot.productId);
    addSetValue(productKeys, slot && slot.productKey);
    addSetValue(proteinIds, slot && slot.proteinId);
    addSetValue(proteinKeys, slot && (slot.proteinKey || slot.premiumKey || slot.proteinFamilyKey));
    addSetValue(carbIds, slot && slot.carbId);
    for (const carb of Array.isArray(slot && slot.carbs) ? slot.carbs : []) {
      addSetValue(carbIds, carb && carb.carbId);
      addSetValue(carbKeys, carb && (carb.key || carb.carbKey));
    }
    for (const carb of Array.isArray(slot && slot.carbSelections) ? slot.carbSelections : []) {
      addSetValue(carbIds, carb && carb.carbId);
      addSetValue(carbKeys, carb && (carb.key || carb.carbKey));
    }
    for (const option of Array.isArray(slot && slot.selectedOptions) ? slot.selectedOptions : []) {
      addSetValue(optionIds, option && option.optionId);
      addSetValue(optionKeys, option && option.optionKey);
      addSetValue(groupIds, option && option.groupId);
      addSetValue(groupKeys, option && (option.groupKey || option.canonicalGroupKey));
    }
  }
  for (const meal of Array.isArray(day && day.materializedMeals) ? day.materializedMeals : []) {
    addSetValue(proteinIds, meal && meal.proteinId);
    addSetValue(proteinKeys, meal && meal.premiumKey);
    addSetValue(carbIds, meal && meal.carbId);
  }

  const productQueryParts = [];
  const optionQueryParts = [];
  const groupQueryParts = [];
  const proteinQueryParts = [];
  const carbQueryParts = [];
  const validProductIds = [...productIds].filter(isObjectIdString);
  const validOptionIds = [...optionIds].filter(isObjectIdString);
  const validGroupIds = [...groupIds].filter(isObjectIdString);
  const validProteinIds = [...proteinIds].filter(isObjectIdString);
  const validCarbIds = [...carbIds].filter(isObjectIdString);
  if (validProductIds.length) productQueryParts.push({ _id: { $in: validProductIds } });
  if (productKeys.size) productQueryParts.push({ key: { $in: [...productKeys] } });
  if (validOptionIds.length) optionQueryParts.push({ _id: { $in: validOptionIds } });
  if (optionKeys.size) optionQueryParts.push({ key: { $in: [...optionKeys] } });
  if (validGroupIds.length) groupQueryParts.push({ _id: { $in: validGroupIds } });
  if (groupKeys.size) groupQueryParts.push({ key: { $in: [...groupKeys] } });
  if (validProteinIds.length) proteinQueryParts.push({ _id: { $in: validProteinIds } });
  if (proteinKeys.size) proteinQueryParts.push({
    $or: [
      { key: { $in: [...proteinKeys] } },
      { premiumKey: { $in: [...proteinKeys] } },
      { proteinFamilyKey: { $in: [...proteinKeys] } },
    ],
  });
  if (validCarbIds.length) carbQueryParts.push({ _id: { $in: validCarbIds } });
  if (carbKeys.size) carbQueryParts.push({ key: { $in: [...carbKeys] } });

  const productQuery = productQueryParts.length ? MenuProduct.find({ $or: productQueryParts }) : null;
  const optionQuery = optionQueryParts.length ? MenuOption.find({ $or: optionQueryParts }) : null;
  const groupQuery = groupQueryParts.length ? MenuOptionGroup.find({ $or: groupQueryParts }) : null;
  const proteinQuery = proteinQueryParts.length ? BuilderProtein.find({ $or: proteinQueryParts }) : null;
  const carbQuery = carbQueryParts.length ? BuilderCarb.find({ $or: carbQueryParts }) : null;
  if (session) {
    if (productQuery) productQuery.session(session);
    if (optionQuery) optionQuery.session(session);
    if (groupQuery) groupQuery.session(session);
    if (proteinQuery) proteinQuery.session(session);
    if (carbQuery) carbQuery.session(session);
  }

  const [products, options, groups, proteins, carbs] = await Promise.all([
    productQuery ? productQuery.lean() : [],
    optionQuery ? optionQuery.lean() : [],
    groupQuery ? groupQuery.lean() : [],
    proteinQuery ? proteinQuery.lean() : [],
    carbQuery ? carbQuery.lean() : [],
  ]);
  const maps = {
    productById: new Map(),
    productByKey: new Map(),
    optionById: new Map(),
    optionByKey: new Map(),
    groupById: new Map(),
    groupByKey: new Map(),
    proteinById: new Map(),
    proteinByKey: new Map(),
    carbById: new Map(),
    carbByKey: new Map(),
  };
  products.forEach((doc) => addDocToMaps(maps, "product", doc));
  options.forEach((doc) => addDocToMaps(maps, "option", doc));
  groups.forEach((doc) => addDocToMaps(maps, "group", doc));
  proteins.forEach((doc) => {
    addDocToMaps(maps, "protein", doc);
    if (doc.premiumKey) maps.proteinByKey.set(String(doc.premiumKey), doc);
    if (doc.proteinFamilyKey) maps.proteinByKey.set(String(doc.proteinFamilyKey), doc);
  });
  carbs.forEach((doc) => addDocToMaps(maps, "carb", doc));
  return maps;
}

function assertValidMealCount(mealCount, { allowZero = false } = {}) {
  if (!Number.isInteger(mealCount) || mealCount < (allowZero ? 0 : 1)) {
    throw createServiceError("INVALID_MEAL_COUNT", allowZero ? "mealCount must be a non-negative integer" : "mealCount must be a positive integer", 400);
  }
}

function buildPickupRequestSnapshot(day, catalogMaps = {}) {
  const resolvedDay = enrichDayMealSlotsWithResolvedSnapshots(day || {}, catalogMaps);
  return {
    dayStatus: resolvedDay && resolvedDay.status ? resolvedDay.status : "open",
    mealSelections: Array.isArray(resolvedDay && resolvedDay.selections) ? resolvedDay.selections : [],
    mealSlots: Array.isArray(resolvedDay && resolvedDay.mealSlots) ? resolvedDay.mealSlots : [],
    materializedMeals: Array.isArray(resolvedDay && resolvedDay.materializedMeals) ? resolvedDay.materializedMeals : [],
    addons: Array.isArray(resolvedDay && resolvedDay.addonSelections) ? resolvedDay.addonSelections : [],
    premium: Array.isArray(resolvedDay && resolvedDay.premiumUpgradeSelections) ? resolvedDay.premiumUpgradeSelections : [],
    createdFrom: "client_pickup_request",
  };
}

function buildSelectedPickupRequestSnapshot(day, selectedMealSlotIds, catalogMaps = {}, selectedPickupItems = []) {
  const ids = new Set(normalizeSelectedMealSlotIds(selectedMealSlotIds));
  const selectedAddonCountsBySourceId = (Array.isArray(selectedPickupItems) ? selectedPickupItems : [])
    .filter((item) => item && item.itemType === "addon")
    .reduce((map, item) => {
      const key = item.sourceId ? String(item.sourceId) : null;
      if (!key) return map;
      map.set(key, Number(map.get(key) || 0) + 1);
      return map;
    }, new Map());
  const base = buildPickupRequestSnapshot(day, catalogMaps);
  return {
    ...base,
    mealSlots: Array.isArray(base.mealSlots)
      ? base.mealSlots.filter((slot) => ids.has(String(slot.slotKey || slot.slotIndex || "")))
      : [],
    addons: Array.isArray(base.addons)
      ? base.addons
        .filter((addon) => selectedAddonCountsBySourceId.has(String(addon.addonId || addon.id || addon._id || "")))
        .map((addon) => ({
          ...addon,
          quantity: selectedAddonCountsBySourceId.get(String(addon.addonId || addon.id || addon._id || "")) || 1,
        }))
      : [],
    selectedMealSlotIds: [...ids],
    selectedPickupItemIds: selectedPickupItems.map((item) => item.itemId),
    selectedPickupItems,
  };
}

function resolvePickupRequestDayStatus(day) {
  return String(day && day.status || "open");
}

function assertPickupRequestDayIsEligible(day) {
  if (!day) return;
  if (["skipped", "frozen"].includes(resolvePickupRequestDayStatus(day))) {
    throw createServiceError("DAY_SKIPPED", "This day is skipped or frozen", 409);
  }
}

function stringifyId(value) {
  return value ? String(value) : null;
}

function mapSubscriptionPickupRequestStatus(pickupRequest, { idempotent = false, includeNextAction = true } = {}) {
  const status = String(pickupRequest.status || "locked");
  const copy = PICKUP_REQUEST_STATUS_COPY[status] || PICKUP_REQUEST_STATUS_COPY.locked;
  const showCode = ["ready_for_pickup", "fulfilled"].includes(pickupRequest.status);
  const isReady = ["ready_for_pickup", "fulfilled"].includes(status);
  const isCompleted = TERMINAL_PICKUP_REQUEST_STATUSES.includes(status);
  const selectedPickupItems = Array.isArray(pickupRequest.selectedPickupItems) ? pickupRequest.selectedPickupItems : [];
  const selectedPickupItemIds = Array.isArray(pickupRequest.selectedPickupItemIds) ? pickupRequest.selectedPickupItemIds : [];
  const addonCount = selectedPickupItems.length
    ? selectedPickupItems.filter((item) => item && item.itemType === "addon").length
    : selectedPickupItemIds.filter((id) => String(id || "").startsWith("addon_")).length;
  const itemCount = selectedPickupItemIds.length || selectedPickupItems.length;

  const payload = {
    requestId: stringifyId(pickupRequest._id),
    subscriptionId: stringifyId(pickupRequest.subscriptionId),
    subscriptionDayId: stringifyId(pickupRequest.subscriptionDayId),
    date: pickupRequest.date,
    mealCount: Number(pickupRequest.mealCount || 0),
    selectedMealSlotIds: Array.isArray(pickupRequest.selectedMealSlotIds) ? pickupRequest.selectedMealSlotIds : [],
    selectedPickupItemIds,
    selectedPickupItems,
    addonCount,
    itemCount,
    selectionMode: pickupRequest.selectionMode || "legacy_meal_count",
    currentStep: copy.currentStep,
    status,
    statusLabel: copy.statusLabel,
    message: copy.message,
    isReady,
    isCompleted,
    pickupCode: showCode ? pickupRequest.pickupCode || null : null,
    pickupCodeIssuedAt: showCode ? pickupRequest.pickupCodeIssuedAt || null : null,
    fulfilledAt: pickupRequest.status === "fulfilled" ? pickupRequest.fulfilledAt || null : null,
    createdAt: pickupRequest.createdAt || null,
    creditsReserved: Boolean(pickupRequest.creditsReserved),
    idempotent,
  };
  if (includeNextAction) {
    payload.nextAction = "poll_pickup_request_status";
  }
  return payload;
}

const mapPickupRequestForClient = mapSubscriptionPickupRequestStatus;

async function findExistingByIdempotencyKey({
  subscriptionId,
  userId,
  idempotencyKey,
  session = null,
}) {
  if (!idempotencyKey) return null;
  const query = SubscriptionPickupRequest.findOne({
    subscriptionId,
    userId,
    idempotencyKey,
  });
  if (session) query.session(session);
  return query;
}

async function createPickupRequestDocument({
  subscription,
  day,
  date,
  mealCount,
  selectedMealSlotIds = [],
  selectedPickupItemIds = [],
  selectedPickupItems = [],
  requestPayloadHash = null,
  selectionMode = "legacy_meal_count",
  idempotencyKey,
  catalogMaps = {},
  session = null,
}) {
  const createPayload = {
    subscriptionId: subscription._id,
    subscriptionDayId: day && day._id ? day._id : null,
    userId: subscription.userId,
    date,
    mealCount,
    selectedMealSlotIds,
    selectedPickupItemIds,
    selectedPickupItems,
    requestPayloadHash,
    selectionMode,
    status: "locked",
    idempotencyKey: idempotencyKey || null,
    creditsReserved: Number(mealCount || 0) === 0,
    creditsReservedAt: Number(mealCount || 0) === 0 ? new Date() : null,
    snapshot: selectionMode === "slot_ids" || selectionMode === "pickup_item_ids"
      ? buildSelectedPickupRequestSnapshot(day, selectedMealSlotIds, catalogMaps, selectedPickupItems)
      : buildPickupRequestSnapshot(day, catalogMaps),
  };

  const created = await SubscriptionPickupRequest.create(
    [createPayload],
    withOptionalSession({}, session)
  );
  return created[0];
}

async function createSubscriptionPickupRequestForClient({
  userId,
  subscriptionId,
  date,
  mealCount,
  selectedMealSlotIds,
  selectedPickupItemIds,
  idempotencyKey = null,
  lang = "en",
  session = null,
} = {}) {
  let useSession = session;
  let localSession = null;
  if (!useSession) {
    const mongoose = require("mongoose");
    localSession = await mongoose.startSession();
    localSession.startTransaction();
    useSession = localSession;
  }

  try {
    const result = await _createSubscriptionPickupRequestForClientInternal({
      userId,
      subscriptionId,
      date,
      mealCount,
      selectedMealSlotIds,
      selectedPickupItemIds,
      idempotencyKey,
      lang,
      session: useSession,
    });

    if (localSession) {
      await localSession.commitTransaction();
      localSession.endSession();
    }
    return result;
  } catch (err) {
    if (localSession) {
      await localSession.abortTransaction();
      localSession.endSession();
    }
    throw err;
  }
}

async function _createSubscriptionPickupRequestForClientInternal({
  userId,
  subscriptionId,
  date,
  mealCount,
  selectedMealSlotIds,
  selectedPickupItemIds,
  idempotencyKey = null,
  lang = "en",
  session = null,
} = {}) {
  const normalizedSelectedMealSlotIds = selectedMealSlotIds !== undefined
    ? normalizeSelectedMealSlotIds(selectedMealSlotIds)
    : [];
  const normalizedSelectedPickupItemIds = selectedPickupItemIds !== undefined
    ? normalizeSelectedPickupItemIds(selectedPickupItemIds)
    : [];
  const explicitPickupItemIds = dedupeLocal([...normalizedSelectedPickupItemIds, ...normalizedSelectedMealSlotIds]);
  const usesItemSelection = normalizedSelectedPickupItemIds.length > 0;
  const usesSlotSelection = normalizedSelectedMealSlotIds.length > 0;
  let normalizedMealCount = usesItemSelection ? 0 : (usesSlotSelection ? normalizedSelectedMealSlotIds.length : Number(mealCount));
  assertValidMealCount(normalizedMealCount, { allowZero: usesItemSelection });

  const normalizedIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : null;

  const subscriptionQuery = Subscription.findById(subscriptionId).populate("planId");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;
  if (!subscription) {
    throw createServiceError("NOT_FOUND", "Subscription not found", 404);
  }

  // Phase 5: Centralized ownership and status check (preserves existing behavior)
  assertSubscriptionActiveAndOwned({ subscription, userId, date });
  try {
    assertFulfillmentMethodAllowed({
      subscription,
      date,
      requestedMethod: "pickup",
    });
  } catch (err) {
    if (err && err.code === "FULFILLMENT_METHOD_NOT_ALLOWED") {
      throw createServiceError("INVALID_DELIVERY_MODE", "Delivery mode is not pickup", 400);
    }
    throw err;
  }

  await assertRestaurantOpenForOrdering({
    pickupLocationId: subscription.pickupLocationId,
    deliveryMode: "pickup",
  });

  const today = dateUtils.getTodayKSADate();
  if (date !== today) {
    throw createServiceError("INVALID_DATE", "Pickup request can only be created for the current day", 400);
  }

  const existing = await findExistingByIdempotencyKey({
    subscriptionId: subscription._id,
    userId,
    idempotencyKey: normalizedIdempotencyKey,
    session,
  });
  const requestPayloadHash = buildPickupRequestPayloadHash({
    date,
    mealCount: normalizedMealCount,
    selectedMealSlotIds: normalizedSelectedMealSlotIds,
    selectedPickupItemIds: explicitPickupItemIds,
  });
  if (existing) {
    if (existing.requestPayloadHash && existing.requestPayloadHash !== requestPayloadHash) {
      throw createServiceError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different payload", 409);
    }
    return {
      pickupRequest: existing,
      data: mapPickupRequestForClient(existing, { lang, idempotent: true }),
      idempotent: true,
    };
  }

  const dayQuery = SubscriptionDay.findOne({ subscriptionId: subscription._id, date });
  if (session) dayQuery.session(session);
  const day = await dayQuery;
  const catalogMaps = day ? await loadPickupAvailabilityCatalogMaps(day, { session }) : {};
  assertPickupRequestDayIsEligible(day);
  if (day) {
    validateDayBeforeLockOrPrepare({
      subscription,
      day,
      allowedStatuses: PICKUP_REQUEST_ALLOWED_DAY_STATUSES,
      allowQuantityOnlyPickup: true,
      allowPendingAddons: true,
    });
  }

  assertDateInsideSubscriptionRange({ subscription, date });

  let selectedPickupItems = [];
  let finalSelectedPickupItemIds = explicitPickupItemIds;
  let finalSelectedMealSlotIds = normalizedSelectedMealSlotIds;
  if (usesItemSelection) {
    const selection = await assertSelectedPickupItemsAvailable({
      subscriptionId: subscription._id,
      day,
      selectedPickupItemIds: explicitPickupItemIds,
      session,
      subscription,
      catalogMaps,
    });
    selectedPickupItems = selection.selectedPickupItems;
    finalSelectedPickupItemIds = selection.selectedPickupItemIds;
    finalSelectedMealSlotIds = dedupeLocal([...normalizedSelectedMealSlotIds, ...selection.selectedMealSlotIds]);
    normalizedMealCount = selection.mealCreditCount;
  } else if (usesSlotSelection) {
    const selection = await assertSelectedSlotsAvailableForPickup({
      subscriptionId: subscription._id,
      day,
      selectedMealSlotIds: normalizedSelectedMealSlotIds,
      session,
    });
    const pickupItemById = new Map((selection.availability.pickupItems || []).map((item) => [item.itemId, item]));
    selectedPickupItems = normalizedSelectedMealSlotIds.map((id) => pickupItemById.get(id)).filter(Boolean);
    finalSelectedPickupItemIds = normalizedSelectedMealSlotIds;
  } else if (day && Array.isArray(day.mealSlots) && day.mealSlots.length > 0) {
    const pickupRequests = await findBlockingPickupRequests({ subscriptionId: subscription._id, date, session });
    const availability = buildAvailabilityFromDay({ day, pickupRequests, subscription, catalogMaps });
    const availableCount = availability.availableSlotIds.length;
    if (availableCount < normalizedMealCount) {
      const reason = availability.slots.find((slot) => !slot.available)?.unavailableReason || "MEAL_SLOT_UNAVAILABLE";
      throw createServiceError(
        reason === "PREMIUM_PAYMENT_REQUIRED" || reason === "ADDON_PAYMENT_REQUIRED" ? reason : "MEAL_SLOT_UNAVAILABLE",
        "Requested mealCount exceeds available meal slots",
        422,
        { availableMealSlots: availableCount, requestedMealCount: normalizedMealCount, availability }
      );
    }
  }

  if (Number(subscription.remainingMeals || 0) < normalizedMealCount) {
    throw createServiceError("INSUFFICIENT_CREDITS", "رصيد وجباتك غير كافٍ", 422);
  }

  let pickupRequest;
  try {
    pickupRequest = await createPickupRequestDocument({
      subscription,
      day,
      date,
      mealCount: normalizedMealCount,
      selectedMealSlotIds: finalSelectedMealSlotIds,
      selectedPickupItemIds: finalSelectedPickupItemIds,
      selectedPickupItems,
      requestPayloadHash,
      selectionMode: usesItemSelection ? "pickup_item_ids" : (usesSlotSelection ? "slot_ids" : "legacy_meal_count"),
      idempotencyKey: normalizedIdempotencyKey,
      catalogMaps,
      session,
    });
  } catch (err) {
    if (err && err.code === 11000 && normalizedIdempotencyKey) {
      const racedExisting = await findExistingByIdempotencyKey({
        subscriptionId: subscription._id,
        userId,
        idempotencyKey: normalizedIdempotencyKey,
        session,
      });
      if (racedExisting) {
        if (racedExisting.requestPayloadHash && racedExisting.requestPayloadHash !== requestPayloadHash) {
          throw createServiceError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different payload", 409);
        }
        return {
          pickupRequest: racedExisting,
          data: mapPickupRequestForClient(racedExisting, { lang, idempotent: true }),
          idempotent: true,
        };
      }
    }
    throw err;
  }

  try {
    if (normalizedMealCount > 0) {
      const reservation = await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: normalizedMealCount,
        session,
      });
      pickupRequest = reservation.pickupRequest;
    }
  } catch (err) {
    await SubscriptionPickupRequest.deleteOne(
      { _id: pickupRequest._id, creditsReserved: { $ne: true } },
      withOptionalSession({}, session)
    );
    throw err;
  }
  return {
    pickupRequest,
    data: mapPickupRequestForClient(pickupRequest, { lang, idempotent: false }),
    idempotent: false,
  };
}

async function getPickupAvailabilityForClient({
  userId,
  subscriptionId,
  date,
  includeUnavailable = false,
  includeHistory = false,
  session = null,
} = {}) {
  const subscriptionQuery = Subscription.findById(subscriptionId).populate("planId");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;
  if (!subscription) throw createServiceError("NOT_FOUND", "Subscription not found", 404);

  assertSubscriptionActiveAndOwned({ subscription, userId, date });
  try {
    assertFulfillmentMethodAllowed({ subscription, date, requestedMethod: "pickup" });
  } catch (err) {
    if (err && err.code === "FULFILLMENT_METHOD_NOT_ALLOWED") {
      throw createServiceError("INVALID_DELIVERY_MODE", "Delivery mode is not pickup", 400);
    }
    throw err;
  }
  assertDateInsideSubscriptionRange({ subscription, date });

  const dayQuery = SubscriptionDay.findOne({ subscriptionId: subscription._id, date });
  if (session) dayQuery.session(session);
  const day = await dayQuery.lean();
  const pickupRequests = await findBlockingPickupRequests({ subscriptionId: subscription._id, date, session });
  const catalogMaps = day ? await loadPickupAvailabilityCatalogMaps(day, { session }) : {};
  const fullAvailability = buildAvailabilityFromDay({
    day,
    pickupRequests,
    subscription,
    catalogMaps,
  });
  const availability = filterAvailabilityForVisibility(fullAvailability, { includeUnavailable, includeHistory });
  availability.hiddenUnavailableCount = Math.max(0, (fullAvailability.pickupItems || []).length - (availability.pickupItems || []).length);
  const wallet = buildPickupAvailabilityWallet(subscription, availability);
  const summary = buildPickupAvailabilitySummary({ subscription, availability });
  return {
    subscriptionId: stringifyId(subscription._id),
    date,
    subscriptionDayId: availability.subscriptionDayId,
    remainingMeals: Number(subscription.remainingMeals || 0),
    paymentReason: day ? resolveCanonicalPaymentReason(day) : null,
    wallet,
    summary,
    slots: availability.slots,
    dayAddons: availability.dayAddons,
    addonSummary: availability.addonSummary,
    pickupItems: availability.pickupItems,
    sections: availability.sections,
    availableSlotIds: availability.availableSlotIds,
    unavailableSlotIds: availability.unavailableSlotIds,
  };
}

async function assertSubscriptionOwnership({ subscriptionId, userId, session = null }) {
  const query = Subscription.findById(subscriptionId).select("_id userId");
  if (session) query.session(session);
  const subscription = await query.lean();
  if (!subscription) {
    throw createServiceError("NOT_FOUND", "Subscription not found", 404);
  }
  if (String(subscription.userId) !== String(userId)) {
    throw createServiceError("FORBIDDEN", "Forbidden", 403);
  }
  return subscription;
}

async function listSubscriptionPickupRequestsForClient({
  userId,
  subscriptionId,
  date = null,
  status = "all",
  session = null,
} = {}) {
  await assertSubscriptionOwnership({ subscriptionId, userId, session });

  const query = { subscriptionId };
  if (date) query.date = String(date);
  if (status === "active") {
    query.status = { $in: ACTIVE_PICKUP_REQUEST_STATUSES };
  }

  const findQuery = SubscriptionPickupRequest.find(query).sort({ createdAt: -1 });
  if (session) findQuery.session(session);
  const requests = await findQuery.lean();
  return {
    requests: requests.map((request) => mapSubscriptionPickupRequestStatus(request, { includeNextAction: false })),
  };
}

async function getSubscriptionPickupRequestStatusForClient({
  userId,
  subscriptionId,
  requestId,
  session = null,
} = {}) {
  await assertSubscriptionOwnership({ subscriptionId, userId, session });

  const query = SubscriptionPickupRequest.findOne({ _id: requestId, subscriptionId });
  if (session) query.session(session);
  const pickupRequest = await query.lean();
  if (!pickupRequest) {
    throw createServiceError("NOT_FOUND", "Pickup request not found", 404);
  }
  if (String(pickupRequest.userId) !== String(userId)) {
    throw createServiceError("FORBIDDEN", "Forbidden", 403);
  }
  return mapSubscriptionPickupRequestStatus(pickupRequest, { includeNextAction: true });
}

module.exports = {
  createSubscriptionPickupRequestForClient,
  getPickupAvailabilityForClient,
  getSubscriptionPickupRequestStatusForClient,
  listSubscriptionPickupRequestsForClient,
  mapPickupRequestForClient,
  mapSubscriptionPickupRequestStatus,
};
