"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../../models/SubscriptionDailyAddonOperation");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { logger } = require("../../utils/logger");

const ELIGIBLE_DAY_STATUSES = new Set([
  "open",
  "locked",
  "in_preparation",
  "ready_for_delivery",
  "out_for_delivery",
  "ready_for_pickup",
]);
const RELEASE_DAY_STATUSES = new Set([
  "skipped",
  "frozen",
  "delivery_canceled",
  "canceled_at_branch",
  "canceled",
  "no_show",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function positiveInt(value, fallback = 0) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function nonNegativeInt(value) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function localizedObject(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ar = clean(value.ar || value.en || fallback);
    const en = clean(value.en || value.ar || fallback);
    return { ar, en };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}

function subscriptionLabel(value) {
  const name = localizedObject(value, "إضافة يومية");
  const ar = /اشتراك/.test(name.ar) ? name.ar : `اشتراك ${name.ar || "إضافة يومية"}`;
  const en = /subscription/i.test(name.en) ? name.en : `${name.en || "Daily Add-on"} Subscription`;
  return { ar, en };
}

function entitlementIdentity(entitlement, index = 0) {
  const addonPlanId = clean(entitlement && (entitlement.addonPlanId || entitlement.addonId));
  const allowanceCategory = clean(entitlement && (entitlement.allowanceCategory || entitlement.category));
  const entitlementKey = clean(entitlement && entitlement.entitlementKey)
    || `${allowanceCategory || "addon"}:${addonPlanId || index}`;
  return { addonPlanId, allowanceCategory, entitlementKey };
}

function bucketIdOf(bucket) {
  return clean(bucket && (bucket._id || bucket.balanceBucketId));
}

function findBalanceBucket(subscription, entitlement, index = 0) {
  const balances = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance.filter(Boolean)
    : [];
  const identity = entitlementIdentity(entitlement, index);
  const requestedBucketId = clean(entitlement && entitlement.balanceBucketId);
  if (requestedBucketId) {
    const match = balances.find((bucket) => bucketIdOf(bucket) === requestedBucketId);
    if (match) return match;
  }

  if (identity.addonPlanId) {
    const matches = balances.filter((bucket) => clean(bucket.addonPlanId || bucket.addonId) === identity.addonPlanId);
    if (matches.length === 1) return matches[0];
  }

  if (identity.entitlementKey) {
    const matches = balances.filter((bucket) => clean(bucket.entitlementKey) === identity.entitlementKey);
    if (matches.length === 1) return matches[0];
  }

  if (identity.allowanceCategory) {
    const matches = balances.filter((bucket) => clean(bucket.allowanceCategory || bucket.category) === identity.allowanceCategory);
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function selectionMatchesEntitlement(selection, entitlement, bucket, index = 0) {
  if (!selection) return false;
  const identity = entitlementIdentity(entitlement, index);
  const selectionBucketId = clean(selection.balanceBucketId);
  if (selectionBucketId && bucketIdOf(bucket)) return selectionBucketId === bucketIdOf(bucket);
  const selectionKey = clean(selection.entitlementKey);
  if (selectionKey) return selectionKey === identity.entitlementKey;
  const selectionPlanId = clean(selection.addonPlanId);
  if (selectionPlanId && identity.addonPlanId) return selectionPlanId === identity.addonPlanId;
  return clean(selection.entitlementCategory || selection.category) === identity.allowanceCategory;
}

function activeSelection(selection) {
  return Boolean(selection && clean(selection.addonSettlementState) !== "released");
}

function resolveSingleProduct(entitlement) {
  const snapshots = Array.isArray(entitlement && entitlement.menuProductsSnapshot)
    ? entitlement.menuProductsSnapshot.filter(Boolean)
    : [];
  const ids = Array.isArray(entitlement && entitlement.menuProductIds)
    ? entitlement.menuProductIds.map(clean).filter(Boolean)
    : [];

  if (snapshots.length === 1) {
    const snapshot = snapshots[0];
    return {
      productId: clean(snapshot.id || snapshot._id || snapshot.productId),
      productKey: clean(snapshot.key),
      nameI18n: localizedObject(snapshot.nameI18n || snapshot.name),
      imageUrl: clean(snapshot.imageUrl),
      concrete: true,
    };
  }
  if (snapshots.length === 0 && ids.length === 1) {
    return {
      productId: ids[0],
      productKey: "",
      nameI18n: { ar: "", en: "" },
      imageUrl: "",
      concrete: true,
    };
  }
  return {
    productId: "",
    productKey: "",
    nameI18n: { ar: "", en: "" },
    imageUrl: "",
    concrete: false,
  };
}

function dailyAllocationKey({ subscriptionId, date, entitlementKey, ordinal }) {
  return `daily-addon:${clean(subscriptionId)}:${clean(date)}:${clean(entitlementKey)}:${Number(ordinal)}`;
}

function explicitReleaseKey(dayId, selection, index) {
  return `released-addon:${clean(dayId)}:${clean(selection && selection._id) || index}:${clean(selection && selection.balanceBucketId)}`;
}

function buildDefaultSelection({ subscription, day, entitlement, bucket, entitlementIndex, ordinal }) {
  const identity = entitlementIdentity(entitlement, entitlementIndex);
  const planName = entitlement && (
    entitlement.addonPlanNameI18n
    || entitlement.addonPlanName
    || entitlement.name
  );
  const planLabelI18n = subscriptionLabel(planName || identity.allowanceCategory || "إضافة يومية");
  const product = resolveSingleProduct(entitlement);
  const productId = product.productId || identity.addonPlanId || clean(entitlement && entitlement.addonId);
  const displayNameI18n = product.concrete && (product.nameI18n.ar || product.nameI18n.en)
    ? {
      ar: `${product.nameI18n.ar || product.nameI18n.en} — ${planLabelI18n.ar}`,
      en: `${product.nameI18n.en || product.nameI18n.ar} — ${planLabelI18n.en}`,
    }
    : planLabelI18n;
  const allocationKey = dailyAllocationKey({
    subscriptionId: subscription._id,
    date: day.date,
    entitlementKey: identity.entitlementKey,
    ordinal,
  });
  const now = new Date();

  return {
    addonId: productId,
    productId: product.concrete ? productId : null,
    menuProductId: product.concrete ? productId : null,
    addonPlanId: identity.addonPlanId || clean(entitlement && entitlement.addonId) || null,
    addonKey: product.productKey || "",
    productKey: product.productKey || "",
    name: displayNameI18n.ar || displayNameI18n.en,
    nameI18n: displayNameI18n,
    subscriptionAddonLabelI18n: planLabelI18n,
    resolvedProductNameI18n: product.nameI18n,
    imageUrl: product.imageUrl || "",
    category: clean(entitlement && (entitlement.displayCategory || entitlement.displayKey || entitlement.category))
      || identity.allowanceCategory,
    entitlementCategory: identity.allowanceCategory,
    entitlementKey: identity.entitlementKey,
    balanceBucketId: bucket && (bucket._id || bucket.balanceBucketId),
    ownedSnapshot: Boolean(product.concrete),
    snapshotMissing: !product.concrete,
    liveCatalogMissing: false,
    legacyRecovered: false,
    available: true,
    active: true,
    availableForNewSale: true,
    catalogAvailable: true,
    catalogActive: true,
    liveCatalogAvailable: true,
    liveCatalogActive: true,
    selectable: false,
    selectionAvailable: true,
    disabled: false,
    disableReason: null,
    isEligibleForAllowance: true,
    requestedQty: 1,
    includedTotalQty: nonNegativeInt(bucket && bucket.includedTotalQty),
    remainingQty: Math.max(0, nonNegativeInt(bucket && bucket.remainingQty) - 1),
    freeQtyAvailable: nonNegativeInt(bucket && bucket.remainingQty),
    remainingBefore: nonNegativeInt(bucket && bucket.remainingQty),
    remainingAfter: Math.max(0, nonNegativeInt(bucket && bucket.remainingQty) - 1),
    pricingMode: "allowance_covered",
    maxPerDay: Math.max(
      positiveInt(entitlement && (entitlement.maxPerDay || entitlement.quantityPerDay), 1),
      nonNegativeInt(bucket && bucket.remainingQty)
    ),
    source: "wallet",
    qty: 1,
    quantity: 1,
    coveredQty: 1,
    paidQty: 0,
    priceHalala: 0,
    unitPriceHalala: nonNegativeInt(bucket && bucket.unitPriceHalala),
    payableTotalHalala: 0,
    currency: clean(bucket && bucket.currency) || clean(entitlement && entitlement.currency) || "SAR",
    consumedAt: null,
    autoDailyAddon: true,
    dailyEntitlement: true,
    selectionOrigin: "subscription_daily_default",
    dailyAllocationKey: allocationKey,
    addonSettlementState: "reserved",
    reservedAt: now,
    settledAt: null,
    releasedAt: null,
    settlementReason: null,
    requiresKitchenChoice: !product.concrete,
  };
}

function isEligibleDay(day) {
  if (!day || !ELIGIBLE_DAY_STATUSES.has(clean(day.status || "open"))) return false;
  const confirmed = day.plannerState === "confirmed"
    || day.planningState === "confirmed"
    || clean(day.status) !== "open";
  return confirmed;
}

async function readBucket(subscriptionId, bucketId) {
  const subscription = await Subscription.findOne(
    { _id: subscriptionId, "addonBalance._id": bucketId },
    { "addonBalance.$": 1 }
  ).lean();
  return subscription && Array.isArray(subscription.addonBalance)
    ? subscription.addonBalance[0]
    : null;
}

async function reserveBalanceAllocation({ subscriptionId, bucketId, allocationKey }) {
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      addonBalance: {
        $elemMatch: {
          _id: bucketId,
          remainingQty: { $gt: 0 },
          reservationKeys: { $ne: allocationKey },
          consumedAllocationKeys: { $ne: allocationKey },
        },
      },
    },
    {
      $inc: {
        "addonBalance.$.remainingQty": -1,
        "addonBalance.$.reservedQty": 1,
      },
      $addToSet: { "addonBalance.$.reservationKeys": allocationKey },
    },
    { new: true }
  ).lean();

  if (updated) return { reserved: true, idempotent: false };
  const bucket = await readBucket(subscriptionId, bucketId);
  const reservationKeys = Array.isArray(bucket && bucket.reservationKeys) ? bucket.reservationKeys.map(clean) : [];
  const consumedKeys = Array.isArray(bucket && bucket.consumedAllocationKeys) ? bucket.consumedAllocationKeys.map(clean) : [];
  if (reservationKeys.includes(allocationKey)) return { reserved: true, idempotent: true };
  if (consumedKeys.includes(allocationKey)) return { reserved: false, consumed: true, idempotent: true };
  return { reserved: false, reason: "NO_ADDON_BALANCE" };
}

async function consumeBalanceAllocation({ subscriptionId, bucketId, allocationKey }) {
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      addonBalance: {
        $elemMatch: {
          _id: bucketId,
          reservedQty: { $gt: 0 },
          reservationKeys: allocationKey,
          consumedAllocationKeys: { $ne: allocationKey },
        },
      },
    },
    {
      $inc: {
        "addonBalance.$.reservedQty": -1,
        "addonBalance.$.consumedQty": 1,
      },
      $pull: { "addonBalance.$.reservationKeys": allocationKey },
      $addToSet: { "addonBalance.$.consumedAllocationKeys": allocationKey },
    },
    { new: true }
  ).lean();

  if (updated) return { consumed: true, idempotent: false };
  const bucket = await readBucket(subscriptionId, bucketId);
  const consumedKeys = Array.isArray(bucket && bucket.consumedAllocationKeys) ? bucket.consumedAllocationKeys.map(clean) : [];
  if (consumedKeys.includes(allocationKey)) return { consumed: true, idempotent: true };
  return { consumed: false, reason: "ADDON_RESERVATION_NOT_FOUND" };
}

async function releaseBalanceAllocation({ subscriptionId, bucketId, allocationKey }) {
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      addonBalance: {
        $elemMatch: {
          _id: bucketId,
          reservedQty: { $gt: 0 },
          reservationKeys: allocationKey,
        },
      },
    },
    {
      $inc: {
        "addonBalance.$.remainingQty": 1,
        "addonBalance.$.reservedQty": -1,
      },
      $pull: { "addonBalance.$.reservationKeys": allocationKey },
    },
    { new: true }
  ).lean();

  if (updated) return { released: true, idempotent: false };
  const bucket = await readBucket(subscriptionId, bucketId);
  const reservationKeys = Array.isArray(bucket && bucket.reservationKeys) ? bucket.reservationKeys.map(clean) : [];
  const consumedKeys = Array.isArray(bucket && bucket.consumedAllocationKeys) ? bucket.consumedAllocationKeys.map(clean) : [];
  if (!reservationKeys.includes(allocationKey) && !consumedKeys.includes(allocationKey)) {
    return { released: true, idempotent: true };
  }
  if (consumedKeys.includes(allocationKey)) return { released: false, reason: "ADDON_ALREADY_CONSUMED" };
  return { released: false, reason: "ADDON_RELEASE_FAILED" };
}

async function releaseExplicitConsumedSelection({ subscriptionId, bucketId, releaseKey }) {
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      addonBalance: {
        $elemMatch: {
          _id: bucketId,
          consumedQty: { $gt: 0 },
          releasedAllocationKeys: { $ne: releaseKey },
        },
      },
    },
    {
      $inc: {
        "addonBalance.$.remainingQty": 1,
        "addonBalance.$.consumedQty": -1,
      },
      $addToSet: { "addonBalance.$.releasedAllocationKeys": releaseKey },
    },
    { new: true }
  ).lean();
  if (updated) return { released: true, idempotent: false };
  const bucket = await readBucket(subscriptionId, bucketId);
  const releasedKeys = Array.isArray(bucket && bucket.releasedAllocationKeys)
    ? bucket.releasedAllocationKeys.map(clean)
    : [];
  if (releasedKeys.includes(releaseKey)) return { released: true, idempotent: true };
  return { released: false, reason: "EXPLICIT_ADDON_RELEASE_FAILED" };
}

async function getOrCreateOperation({ subscription, day, selection }) {
  let operation = await SubscriptionDailyAddonOperation.findOne({
    subscriptionDayId: day._id,
    allocationKey: selection.dailyAllocationKey,
  });
  if (operation) return operation;
  try {
    operation = await SubscriptionDailyAddonOperation.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      date: day.date,
      allocationKey: selection.dailyAllocationKey,
      entitlementKey: selection.entitlementKey,
      balanceBucketId: selection.balanceBucketId,
      addonPlanId: selection.addonPlanId || null,
      productId: selection.productId || null,
      status: "started",
      selectionSnapshot: selection,
    });
    return operation;
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    return SubscriptionDailyAddonOperation.findOne({
      subscriptionDayId: day._id,
      allocationKey: selection.dailyAllocationKey,
    });
  }
}

async function reserveDailySelection({ subscription, day, selection }) {
  const operation = await getOrCreateOperation({ subscription, day, selection });
  if (operation && operation.status === "consumed") {
    return { applied: false, alreadyConsumed: true, selection };
  }

  const reservation = await reserveBalanceAllocation({
    subscriptionId: subscription._id,
    bucketId: selection.balanceBucketId,
    allocationKey: selection.dailyAllocationKey,
  });
  if (!reservation.reserved) {
    await SubscriptionDailyAddonOperation.updateOne(
      { _id: operation._id },
      {
        $set: {
          status: reservation.consumed ? "consumed" : "failed",
          failedAt: reservation.consumed ? null : new Date(),
          errorCode: reservation.reason || null,
          errorMessage: reservation.reason || null,
        },
      }
    );
    return { applied: false, reason: reservation.reason, selection };
  }

  await SubscriptionDailyAddonOperation.updateOne(
    { _id: operation._id },
    { $set: { status: "balance_reserved", selectionSnapshot: selection } }
  );

  const dayUpdate = await SubscriptionDay.findOneAndUpdate(
    {
      _id: day._id,
      status: { $in: [...ELIGIBLE_DAY_STATUSES] },
      "addonSelections.dailyAllocationKey": { $ne: selection.dailyAllocationKey },
    },
    { $push: { addonSelections: selection } },
    { new: true }
  );

  if (!dayUpdate) {
    const current = await SubscriptionDay.findById(day._id).lean();
    const alreadyApplied = Array.isArray(current && current.addonSelections)
      && current.addonSelections.some((entry) => clean(entry && entry.dailyAllocationKey) === selection.dailyAllocationKey);
    if (!alreadyApplied) {
      await releaseBalanceAllocation({
        subscriptionId: subscription._id,
        bucketId: selection.balanceBucketId,
        allocationKey: selection.dailyAllocationKey,
      });
      await SubscriptionDailyAddonOperation.updateOne(
        { _id: operation._id },
        {
          $set: {
            status: "compensated",
            releasedAt: new Date(),
            errorCode: "DAY_NOT_ELIGIBLE",
            errorMessage: "Subscription day became ineligible before the daily add-on was applied",
          },
        }
      );
      return { applied: false, reason: "DAY_NOT_ELIGIBLE", selection };
    }
  }

  await SubscriptionDailyAddonOperation.updateOne(
    { _id: operation._id },
    { $set: { status: "completed", completedAt: new Date() } }
  );
  return { applied: true, idempotent: Boolean(reservation.idempotent), selection };
}

async function ensureDailyAddonDefaultsForDay({ subscriptionId, dayId = null, date = null } = {}) {
  const dayQuery = dayId ? { _id: dayId } : { subscriptionId, date };
  const day = await SubscriptionDay.findOne(dayQuery).lean();
  if (!day || !isEligibleDay(day)) return { appliedCount: 0, skipped: true, reason: "DAY_NOT_ELIGIBLE" };

  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription || subscription.status !== "active") {
    return { appliedCount: 0, skipped: true, reason: "SUBSCRIPTION_NOT_ACTIVE" };
  }

  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  if (!entitlements.length) return { appliedCount: 0, skipped: true, reason: "NO_DAILY_ADDON_ENTITLEMENTS" };

  let currentDay = day;
  let appliedCount = 0;
  const results = [];

  for (let entitlementIndex = 0; entitlementIndex < entitlements.length; entitlementIndex += 1) {
    const entitlement = entitlements[entitlementIndex];
    const dailyQty = positiveInt(entitlement.quantityPerDay || entitlement.purchasedDailyQty, 1);
    const bucket = findBalanceBucket(subscription, entitlement, entitlementIndex);
    if (!bucket || !bucketIdOf(bucket)) continue;

    const activeSelections = (Array.isArray(currentDay.addonSelections) ? currentDay.addonSelections : [])
      .filter(activeSelection)
      .filter((selection) => selectionMatchesEntitlement(selection, entitlement, bucket, entitlementIndex))
      .filter((selection) => ["subscription", "wallet"].includes(clean(selection.source)) || selection.autoDailyAddon === true);

    if (activeSelections.length >= dailyQty) continue;

    for (let ordinal = 1; ordinal <= dailyQty; ordinal += 1) {
      const currentActiveCount = (Array.isArray(currentDay.addonSelections) ? currentDay.addonSelections : [])
        .filter(activeSelection)
        .filter((selection) => selectionMatchesEntitlement(selection, entitlement, bucket, entitlementIndex))
        .filter((selection) => ["subscription", "wallet"].includes(clean(selection.source)) || selection.autoDailyAddon === true)
        .length;
      if (currentActiveCount >= dailyQty) break;

      const selection = buildDefaultSelection({
        subscription,
        day: currentDay,
        entitlement,
        bucket,
        entitlementIndex,
        ordinal,
      });
      const alreadyExists = (currentDay.addonSelections || [])
        .some((entry) => clean(entry && entry.dailyAllocationKey) === selection.dailyAllocationKey && activeSelection(entry));
      if (alreadyExists) continue;

      const result = await reserveDailySelection({ subscription, day: currentDay, selection });
      results.push(result);
      if (result.applied) appliedCount += 1;
      currentDay = await SubscriptionDay.findById(currentDay._id).lean();
      if (!currentDay || !isEligibleDay(currentDay)) break;
    }
  }

  const latestSubscription = await Subscription.findById(subscription._id).lean();
  return {
    appliedCount,
    skipped: false,
    results,
    day: currentDay,
    wallet: buildDailyAddonWallet(latestSubscription),
  };
}

async function markDaySelectionState({
  dayId,
  allocationKey = null,
  selectionId = null,
  state,
  reason = null,
  source = null,
}) {
  const now = new Date();
  const selector = allocationKey
    ? { "selection.dailyAllocationKey": allocationKey }
    : { "selection._id": selectionId };
  const set = {
    "addonSelections.$[selection].addonSettlementState": state,
    "addonSelections.$[selection].settledAt": now,
    "addonSelections.$[selection].settlementReason": reason,
  };
  if (source) set["addonSelections.$[selection].source"] = source;
  if (state === "consumed") set["addonSelections.$[selection].consumedAt"] = now;
  if (state === "released") set["addonSelections.$[selection].releasedAt"] = now;
  const filter = allocationKey
    ? { _id: dayId, "addonSelections.dailyAllocationKey": allocationKey }
    : { _id: dayId, "addonSelections._id": selectionId };
  await SubscriptionDay.updateOne(
    filter,
    { $set: set },
    { arrayFilters: [selector] }
  );
}

async function consumeDailyAddonReservationsForDay({ dayId, reason = "fulfilled" } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { consumedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  const selections = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.autoDailyAddon === true)
    .filter((selection) => clean(selection.addonSettlementState || "reserved") === "reserved");
  let consumedCount = 0;
  for (const selection of selections) {
    const result = await consumeBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (result.consumed) {
      consumedCount += result.idempotent ? 0 : 1;
      await markDaySelectionState({
        dayId: day._id,
        allocationKey: selection.dailyAllocationKey,
        state: "consumed",
        reason,
      });
      await SubscriptionDailyAddonOperation.updateOne(
        { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
        { $set: { status: "consumed", consumedAt: new Date() } }
      );
    } else {
      const err = new Error(`Daily add-on consumption failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_CONSUMPTION_FAILED";
      err.status = 409;
      throw err;
    }
  }
  return { consumedCount, selectionsCount: selections.length };
}

async function releaseDailyAddonReservationsForDay({
  dayId,
  reason = "released",
  removeSelections = false,
} = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  const selections = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.autoDailyAddon === true)
    .filter((selection) => clean(selection.addonSettlementState || "reserved") === "reserved");
  let releasedCount = 0;
  for (const selection of selections) {
    const result = await releaseBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (!result.released) {
      const err = new Error(`Daily add-on release failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_RELEASE_FAILED";
      err.status = 409;
      throw err;
    }
    releasedCount += result.idempotent ? 0 : 1;
    if (removeSelections) {
      await SubscriptionDay.updateOne(
        { _id: day._id },
        { $pull: { addonSelections: { dailyAllocationKey: selection.dailyAllocationKey } } }
      );
    } else {
      await markDaySelectionState({
        dayId: day._id,
        allocationKey: selection.dailyAllocationKey,
        state: "released",
        reason,
      });
    }
    await SubscriptionDailyAddonOperation.updateOne(
      { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
      { $set: { status: "released", releasedAt: new Date() } }
    );
  }
  return { releasedCount, selectionsCount: selections.length };
}

async function releaseSubscriptionAddonSelectionsForDay({
  dayId,
  reason = "day_not_fulfilled_returned_to_balance",
} = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  let releasedCount = 0;
  const selections = Array.isArray(day.addonSelections) ? day.addonSelections : [];

  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    if (!selection || clean(selection.addonSettlementState) === "released") continue;

    if (selection.autoDailyAddon === true) {
      if (clean(selection.addonSettlementState || "reserved") !== "reserved") continue;
      const result = await releaseBalanceAllocation({
        subscriptionId: day.subscriptionId,
        bucketId: selection.balanceBucketId,
        allocationKey: selection.dailyAllocationKey,
      });
      if (!result.released) {
        const err = new Error(`Daily add-on release failed: ${result.reason || "unknown"}`);
        err.code = "DAILY_ADDON_RELEASE_FAILED";
        err.status = 409;
        throw err;
      }
      releasedCount += result.idempotent ? 0 : 1;
      await markDaySelectionState({
        dayId: day._id,
        allocationKey: selection.dailyAllocationKey,
        state: "released",
        reason,
      });
      await SubscriptionDailyAddonOperation.updateOne(
        { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
        { $set: { status: "released", releasedAt: new Date() } }
      );
      continue;
    }

    if (clean(selection.source) !== "subscription" || !selection.balanceBucketId) continue;
    const releaseKey = explicitReleaseKey(day._id, selection, index);
    const result = await releaseExplicitConsumedSelection({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      releaseKey,
    });
    if (!result.released) {
      const err = new Error(`Explicit subscription add-on release failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_RELEASE_FAILED";
      err.status = 409;
      throw err;
    }
    releasedCount += result.idempotent ? 0 : 1;
    await markDaySelectionState({
      dayId: day._id,
      selectionId: selection._id,
      state: "released",
      reason,
      source: "pending_payment",
    });
  }

  return { releasedCount, selectionsCount: selections.length };
}

async function reconcileDayDailyAddonState({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { skipped: true, reason: "DAY_NOT_FOUND" };
  if (day.status === "fulfilled") {
    return consumeDailyAddonReservationsForDay({ dayId: day._id, reason: "fulfilled" });
  }
  if (RELEASE_DAY_STATUSES.has(clean(day.status))) {
    return releaseSubscriptionAddonSelectionsForDay({
      dayId: day._id,
      reason: `day_${clean(day.status)}_returned_to_balance`,
    });
  }
  return ensureDailyAddonDefaultsForDay({ dayId: day._id });
}

async function reconcileDailyAddonsForDate({ date } = {}) {
  const days = await SubscriptionDay.find({ date }).select("_id").lean();
  const results = [];
  for (const day of days) {
    try {
      results.push(await reconcileDayDailyAddonState({ dayId: day._id }));
    } catch (err) {
      logger.error("daily add-on reconciliation failed", {
        dayId: clean(day._id),
        date: clean(date),
        error: err.message,
        code: err.code || null,
      });
      results.push({ error: err.message, code: err.code || "INTERNAL" });
    }
  }
  return results;
}

async function reconcileDailyAddonsForUser({ userId } = {}) {
  if (!userId) return null;
  const subscription = await Subscription.findOne({ userId, status: "active" })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  if (!subscription) return null;
  const date = await getRestaurantBusinessDate();
  const day = await SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).select("_id").lean();
  return day ? reconcileDayDailyAddonState({ dayId: day._id }) : null;
}

function buildDailyAddonWallet(subscription) {
  const rows = (Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [])
    .filter(Boolean)
    .map((bucket) => ({
      balanceBucketId: bucketIdOf(bucket) || null,
      addonPlanId: clean(bucket.addonPlanId || bucket.addonId) || null,
      entitlementKey: clean(bucket.entitlementKey) || null,
      category: clean(bucket.allowanceCategory || bucket.category) || null,
      purchasedQty: nonNegativeInt(bucket.purchasedQty || bucket.includedTotalQty),
      remainingQty: nonNegativeInt(bucket.remainingQty),
      reservedQty: nonNegativeInt(bucket.reservedQty),
      consumedQty: nonNegativeInt(bucket.consumedQty),
      sourceOfTruth: "subscription.addonBalance",
    }));
  return {
    sourceOfTruth: "subscription.addonBalance",
    rows,
    remainingQty: rows.reduce((sum, row) => sum + row.remainingQty, 0),
    reservedQty: rows.reduce((sum, row) => sum + row.reservedQty, 0),
    consumedQty: rows.reduce((sum, row) => sum + row.consumedQty, 0),
    invariantValid: rows.every((row) => row.purchasedQty === 0
      || row.purchasedQty >= row.remainingQty + row.reservedQty + row.consumedQty),
    pooledCarryoverEnabled: true,
  };
}

module.exports = {
  buildDailyAddonWallet,
  buildDefaultSelection,
  consumeDailyAddonReservationsForDay,
  dailyAllocationKey,
  ensureDailyAddonDefaultsForDay,
  findBalanceBucket,
  isEligibleDay,
  reconcileDailyAddonsForDate,
  reconcileDailyAddonsForUser,
  reconcileDayDailyAddonState,
  releaseDailyAddonReservationsForDay,
  releaseSubscriptionAddonSelectionsForDay,
  reserveBalanceAllocation,
  consumeBalanceAllocation,
  releaseBalanceAllocation,
  selectionMatchesEntitlement,
};
