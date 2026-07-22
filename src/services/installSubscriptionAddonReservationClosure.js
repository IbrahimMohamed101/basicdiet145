"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("./subscription/subscriptionDailyAddonService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonReservationClosure.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonReservationClosure.wrapped");
const CUSTOMER_REPLACEMENT_REASON = "customer_explicit_addon_selection_replaced_default";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function nonNegativeInt(value) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function positiveInt(value, fallback = 1) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function hasExplicitAddonPayload(body = {}) {
  return Object.prototype.hasOwnProperty.call(body, "addonsOneTime")
    || Object.prototype.hasOwnProperty.call(body, "oneTimeAddonSelections");
}

function explicitAddonPayload(body = {}) {
  const value = body.addonsOneTime !== undefined
    ? body.addonsOneTime
    : body.oneTimeAddonSelections;
  return Array.isArray(value) ? value : [];
}

function explicitAllocationKey({ subscriptionId, date, selectionId, bucketId, index = 0 }) {
  const identity = clean(selectionId) || `${clean(bucketId)}:${Number(index)}`;
  return `subscription-addon:${clean(subscriptionId)}:${clean(date)}:${identity}`;
}

function isActiveSelection(selection) {
  return Boolean(selection && clean(selection.addonSettlementState) !== "released");
}

function isSubscriptionFundedSelection(selection) {
  return Boolean(selection && ["subscription", "wallet"].includes(clean(selection.source)));
}

function isReservedSelection(selection) {
  return isSubscriptionFundedSelection(selection)
    && clean(selection.addonSettlementState) === "reserved"
    && Boolean(clean(selection.dailyAllocationKey))
    && Boolean(clean(selection.balanceBucketId));
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

async function moveConsumedUnitToReservation({ subscriptionId, bucketId, allocationKey }) {
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      addonBalance: {
        $elemMatch: {
          _id: bucketId,
          consumedQty: { $gt: 0 },
          reservationKeys: { $ne: allocationKey },
          consumedAllocationKeys: { $ne: allocationKey },
        },
      },
    },
    {
      $inc: {
        "addonBalance.$.consumedQty": -1,
        "addonBalance.$.reservedQty": 1,
      },
      $addToSet: { "addonBalance.$.reservationKeys": allocationKey },
    },
    { new: true }
  ).lean();

  if (updated) return { reserved: true, idempotent: false };

  const bucket = await readBucket(subscriptionId, bucketId);
  const reservationKeys = Array.isArray(bucket && bucket.reservationKeys)
    ? bucket.reservationKeys.map(clean)
    : [];
  const consumedKeys = Array.isArray(bucket && bucket.consumedAllocationKeys)
    ? bucket.consumedAllocationKeys.map(clean)
    : [];

  if (reservationKeys.includes(allocationKey)) {
    return { reserved: true, idempotent: true };
  }
  if (consumedKeys.includes(allocationKey)) {
    return { reserved: false, alreadyConsumed: true, reason: "ADDON_ALREADY_CONSUMED" };
  }
  return { reserved: false, reason: "EXPLICIT_ADDON_RESERVATION_NOT_FOUND" };
}

async function getOrCreateOperation({ day, selection, allocationKey }) {
  let operation = await SubscriptionDailyAddonOperation.findOne({
    subscriptionDayId: day._id,
    allocationKey,
  });
  if (operation) return operation;

  try {
    operation = await SubscriptionDailyAddonOperation.create({
      subscriptionId: day.subscriptionId,
      subscriptionDayId: day._id,
      date: day.date,
      allocationKey,
      entitlementKey: clean(selection.entitlementKey)
        || `bucket:${clean(selection.balanceBucketId)}`,
      balanceBucketId: selection.balanceBucketId,
      addonPlanId: selection.addonPlanId || null,
      productId: selection.productId || selection.menuProductId || selection.addonId || null,
      status: "started",
      selectionSnapshot: selection,
    });
    return operation;
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    return SubscriptionDailyAddonOperation.findOne({
      subscriptionDayId: day._id,
      allocationKey,
    });
  }
}

async function markSelectionState({
  dayId,
  selectionId,
  allocationKey,
  state,
  reason = null,
  origin = null,
}) {
  const now = new Date();
  const set = {
    "addonSelections.$.dailyAllocationKey": allocationKey,
    "addonSelections.$.addonSettlementState": state,
    "addonSelections.$.settlementReason": reason,
    "addonSelections.$.settledAt": state === "reserved" ? null : now,
  };

  if (state === "reserved") {
    set["addonSelections.$.reservedAt"] = now;
    set["addonSelections.$.releasedAt"] = null;
    set["addonSelections.$.consumedAt"] = null;
    set["addonSelections.$.dailyEntitlement"] = true;
    set["addonSelections.$.autoDailyAddon"] = false;
    set["addonSelections.$.selectionOrigin"] = origin || "customer_selected";
    set["addonSelections.$.source"] = "subscription";
  } else if (state === "consumed") {
    set["addonSelections.$.consumedAt"] = now;
  } else if (state === "released") {
    set["addonSelections.$.releasedAt"] = now;
  }

  return SubscriptionDay.updateOne(
    { _id: dayId, "addonSelections._id": selectionId },
    { $set: set }
  );
}

async function syncSubscriptionProjectionState({ subscriptionId, dayId, date, state, reason = null }) {
  const now = new Date();
  const set = {
    "addonSelections.$[selection].addonSettlementState": state,
    "addonSelections.$[selection].settlementReason": reason,
    "addonSelections.$[selection].settledAt": state === "reserved" ? null : now,
  };
  if (state === "reserved") {
    set["addonSelections.$[selection].reservedAt"] = now;
    set["addonSelections.$[selection].releasedAt"] = null;
    set["addonSelections.$[selection].consumedAt"] = null;
    set["addonSelections.$[selection].dailyEntitlement"] = true;
    set["addonSelections.$[selection].autoDailyAddon"] = false;
    set["addonSelections.$[selection].selectionOrigin"] = "customer_selected";
  } else if (state === "consumed") {
    set["addonSelections.$[selection].consumedAt"] = now;
  } else if (state === "released") {
    set["addonSelections.$[selection].releasedAt"] = now;
  }

  await Subscription.updateOne(
    { _id: subscriptionId },
    { $set: set },
    {
      arrayFilters: [{
        "selection.dayId": dayId,
        "selection.date": date,
        "selection.source": "subscription",
      }],
    }
  ).catch(() => {});
}

async function reserveExplicitSubscriptionSelectionsForDay({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { reservedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };

  const selections = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.autoDailyAddon !== true)
    .filter((selection) => clean(selection.source) === "subscription")
    .filter((selection) => Boolean(selection.balanceBucketId));

  let reservedCount = 0;
  const results = [];

  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const allocationKey = clean(selection.dailyAllocationKey) || explicitAllocationKey({
      subscriptionId: day.subscriptionId,
      date: day.date,
      selectionId: selection._id,
      bucketId: selection.balanceBucketId,
      index,
    });
    const operation = await getOrCreateOperation({ day, selection, allocationKey });

    if (
      clean(selection.addonSettlementState) === "reserved"
      && clean(selection.dailyAllocationKey) === allocationKey
    ) {
      results.push({ reserved: true, idempotent: true, allocationKey });
      continue;
    }

    if (operation && operation.status === "consumed") {
      results.push({ reserved: false, alreadyConsumed: true, allocationKey });
      continue;
    }

    const reservation = await moveConsumedUnitToReservation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey,
    });

    if (!reservation.reserved) {
      await SubscriptionDailyAddonOperation.updateOne(
        { _id: operation._id },
        {
          $set: {
            status: reservation.alreadyConsumed ? "consumed" : "failed",
            failedAt: reservation.alreadyConsumed ? null : new Date(),
            errorCode: reservation.reason || null,
            errorMessage: reservation.reason || null,
          },
        }
      );
      const err = new Error(`Explicit add-on reservation failed: ${reservation.reason || "unknown"}`);
      err.code = "EXPLICIT_ADDON_RESERVATION_FAILED";
      err.status = 409;
      throw err;
    }

    await SubscriptionDailyAddonOperation.updateOne(
      { _id: operation._id },
      { $set: { status: "balance_reserved", selectionSnapshot: selection } }
    );

    const dayUpdate = await markSelectionState({
      dayId: day._id,
      selectionId: selection._id,
      allocationKey,
      state: "reserved",
      origin: "customer_selected",
    });
    const matchedCount = Number(
      dayUpdate && (dayUpdate.matchedCount !== undefined ? dayUpdate.matchedCount : dayUpdate.n) || 0
    );

    if (matchedCount === 0) {
      await dailyAddonService.releaseBalanceAllocation({
        subscriptionId: day.subscriptionId,
        bucketId: selection.balanceBucketId,
        allocationKey,
      });
      await SubscriptionDailyAddonOperation.updateOne(
        { _id: operation._id },
        {
          $set: {
            status: "compensated",
            releasedAt: new Date(),
            errorCode: "DAY_SELECTION_DISAPPEARED",
            errorMessage: "Explicit add-on selection disappeared before reservation metadata was saved",
          },
        }
      );
      const err = new Error("Explicit add-on selection changed while reserving balance");
      err.code = "DAY_CHANGED";
      err.status = 409;
      throw err;
    }

    await SubscriptionDailyAddonOperation.updateOne(
      { _id: operation._id },
      { $set: { status: "completed", completedAt: new Date(), selectionSnapshot: selection } }
    );

    if (!reservation.idempotent) reservedCount += 1;
    results.push({ reserved: true, idempotent: Boolean(reservation.idempotent), allocationKey });
  }

  if (selections.length > 0) {
    await syncSubscriptionProjectionState({
      subscriptionId: day.subscriptionId,
      dayId: day._id,
      date: day.date,
      state: "reserved",
    });
  }

  return { reservedCount, selectionsCount: selections.length, results };
}

async function releaseDetachedAutoReservations({ dayId, previousSelections = [] } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };

  const activeKeys = new Set(
    (Array.isArray(day.addonSelections) ? day.addonSelections : [])
      .filter(isActiveSelection)
      .map((selection) => clean(selection.dailyAllocationKey))
      .filter(Boolean)
  );
  const detached = (Array.isArray(previousSelections) ? previousSelections : [])
    .filter((selection) => selection && selection.autoDailyAddon === true)
    .filter((selection) => clean(selection.addonSettlementState || "reserved") === "reserved")
    .filter((selection) => clean(selection.dailyAllocationKey) && selection.balanceBucketId)
    .filter((selection) => !activeKeys.has(clean(selection.dailyAllocationKey)));

  let releasedCount = 0;
  for (const selection of detached) {
    const result = await dailyAddonService.releaseBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (!result.released) {
      const err = new Error(`Detached daily add-on release failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_RELEASE_FAILED";
      err.status = 409;
      throw err;
    }
    if (!result.idempotent) releasedCount += 1;
    await SubscriptionDailyAddonOperation.updateOne(
      { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
      { $set: { status: "released", releasedAt: new Date() } }
    );
  }

  return { releasedCount, selectionsCount: detached.length };
}

async function trimDefaultsCoveredByExplicitSelections({ dayId } = {}) {
  let day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription) return { releasedCount: 0, skipped: true, reason: "SUBSCRIPTION_NOT_FOUND" };

  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  let releasedCount = 0;

  for (let entitlementIndex = 0; entitlementIndex < entitlements.length; entitlementIndex += 1) {
    const entitlement = entitlements[entitlementIndex];
    const bucket = dailyAddonService.findBalanceBucket(subscription, entitlement, entitlementIndex);
    if (!bucket) continue;
    const matches = (selection) => dailyAddonService.selectionMatchesEntitlement(
      selection,
      entitlement,
      bucket,
      entitlementIndex
    );
    const dailyQty = positiveInt(
      entitlement.quantityPerDay || entitlement.purchasedDailyQty,
      1
    );
    const active = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
      .filter(isActiveSelection)
      .filter(matches);
    const explicitCount = active.filter((selection) => selection.autoDailyAddon !== true).length;
    const defaults = active.filter((selection) => selection.autoDailyAddon === true);
    const allowedDefaults = Math.max(0, dailyQty - explicitCount);
    const surplus = defaults.slice(allowedDefaults);

    for (const selection of surplus) {
      const result = await dailyAddonService.releaseBalanceAllocation({
        subscriptionId: day.subscriptionId,
        bucketId: selection.balanceBucketId,
        allocationKey: selection.dailyAllocationKey,
      });
      if (!result.released) {
        const err = new Error(`Explicit-selection priority release failed: ${result.reason || "unknown"}`);
        err.code = "DAILY_ADDON_RELEASE_FAILED";
        err.status = 409;
        throw err;
      }
      if (!result.idempotent) releasedCount += 1;
      await SubscriptionDay.updateOne(
        { _id: day._id },
        { $pull: { addonSelections: { dailyAllocationKey: selection.dailyAllocationKey } } }
      );
      await SubscriptionDailyAddonOperation.updateOne(
        { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
        {
          $set: {
            status: "released",
            releasedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        }
      );
      day = await SubscriptionDay.findById(day._id).lean();
    }
  }

  return { releasedCount };
}

async function consumeSubscriptionAddonReservationsForDay({ dayId, reason = "fulfilled" } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { consumedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };

  const selections = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter(isReservedSelection);
  let consumedCount = 0;

  for (const selection of selections) {
    const result = await dailyAddonService.consumeBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (!result.consumed) {
      const err = new Error(`Subscription add-on consumption failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_CONSUMPTION_FAILED";
      err.status = 409;
      throw err;
    }
    if (!result.idempotent) consumedCount += 1;
    await markSelectionState({
      dayId: day._id,
      selectionId: selection._id,
      allocationKey: selection.dailyAllocationKey,
      state: "consumed",
      reason,
    });
    await SubscriptionDailyAddonOperation.updateOne(
      { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
      { $set: { status: "consumed", consumedAt: new Date() } }
    );
  }

  if (selections.length > 0) {
    await syncSubscriptionProjectionState({
      subscriptionId: day.subscriptionId,
      dayId: day._id,
      date: day.date,
      state: "consumed",
      reason,
    });
  }

  return { consumedCount, selectionsCount: selections.length };
}

async function releaseReservedSubscriptionAddonSelectionsForDay({
  dayId,
  reason = "day_not_fulfilled_returned_to_balance",
} = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };

  const selections = (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter(isReservedSelection);
  let releasedCount = 0;

  for (const selection of selections) {
    const result = await dailyAddonService.releaseBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (!result.released) {
      const err = new Error(`Subscription add-on release failed: ${result.reason || "unknown"}`);
      err.code = "DAILY_ADDON_RELEASE_FAILED";
      err.status = 409;
      throw err;
    }
    if (!result.idempotent) releasedCount += 1;
    await markSelectionState({
      dayId: day._id,
      selectionId: selection._id,
      allocationKey: selection.dailyAllocationKey,
      state: "released",
      reason,
    });
    await SubscriptionDailyAddonOperation.updateOne(
      { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
      { $set: { status: "released", releasedAt: new Date() } }
    );
  }

  if (selections.length > 0) {
    await syncSubscriptionProjectionState({
      subscriptionId: day.subscriptionId,
      dayId: day._id,
      date: day.date,
      state: "released",
      reason,
    });
  }

  return { releasedCount, selectionsCount: selections.length };
}

function buildExactDailyAddonWallet(subscription) {
  const rows = (Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance
    : [])
    .filter(Boolean)
    .map((bucket) => {
      const purchasedQty = Math.max(
        nonNegativeInt(bucket.purchasedQty),
        nonNegativeInt(bucket.includedTotalQty) + nonNegativeInt(bucket.extraPurchasedQty)
      );
      const remainingQty = nonNegativeInt(bucket.remainingQty);
      const reservedQty = nonNegativeInt(bucket.reservedQty);
      const consumedQty = nonNegativeInt(bucket.consumedQty);
      const accountedQty = remainingQty + reservedQty + consumedQty;
      return {
        balanceBucketId: clean(bucket._id || bucket.balanceBucketId) || null,
        addonPlanId: clean(bucket.addonPlanId || bucket.addonId) || null,
        entitlementKey: clean(bucket.entitlementKey) || null,
        category: clean(bucket.allowanceCategory || bucket.category) || null,
        purchasedQty,
        remainingQty,
        reservedQty,
        consumedQty,
        accountedQty,
        invariantValid: purchasedQty === accountedQty,
        balanceDriftQty: purchasedQty - accountedQty,
        sourceOfTruth: "subscription.addonBalance",
      };
    });

  return {
    sourceOfTruth: "subscription.addonBalance",
    rows,
    remainingQty: rows.reduce((sum, row) => sum + row.remainingQty, 0),
    reservedQty: rows.reduce((sum, row) => sum + row.reservedQty, 0),
    consumedQty: rows.reduce((sum, row) => sum + row.consumedQty, 0),
    invariantValid: rows.every((row) => row.invariantValid),
    pooledCarryoverEnabled: true,
  };
}

function patchDailyAddonService() {
  if (dailyAddonService.__reservationClosurePatched) return;

  const originalEnsureDefaults = dailyAddonService.ensureDailyAddonDefaultsForDay.bind(dailyAddonService);
  const originalReleaseDefaults = dailyAddonService.releaseDailyAddonReservationsForDay.bind(dailyAddonService);
  const originalReleaseAll = dailyAddonService.releaseSubscriptionAddonSelectionsForDay.bind(dailyAddonService);

  dailyAddonService.ensureDailyAddonDefaultsForDay = async function explicitPriorityDefaults(args = {}) {
    const result = await originalEnsureDefaults(args);
    const dayId = clean(args.dayId)
      || clean(result && result.day && result.day._id);
    if (!dayId) return result;

    const trimmed = await trimDefaultsCoveredByExplicitSelections({ dayId });
    const [day, subscription] = await Promise.all([
      SubscriptionDay.findById(dayId).lean(),
      SubscriptionDay.findById(dayId).select("subscriptionId").lean()
        .then((row) => row && Subscription.findById(row.subscriptionId).lean()),
    ]);
    return {
      ...(result || {}),
      releasedForExplicitPriority: Number(trimmed.releasedCount || 0),
      day,
      wallet: buildExactDailyAddonWallet(subscription),
    };
  };

  dailyAddonService.releaseDailyAddonReservationsForDay = async function deferredCustomerReplacement(args = {}) {
    if (args.reason === CUSTOMER_REPLACEMENT_REASON && args.removeSelections === true) {
      return {
        releasedCount: 0,
        deferred: true,
        reason: "RELEASE_DEFERRED_UNTIL_EXPLICIT_SELECTION_PERSISTS",
      };
    }
    return originalReleaseDefaults(args);
  };

  dailyAddonService.consumeDailyAddonReservationsForDay = consumeSubscriptionAddonReservationsForDay;
  dailyAddonService.releaseSubscriptionAddonSelectionsForDay = async function releaseCurrentAndLegacy(args = {}) {
    const reserved = await releaseReservedSubscriptionAddonSelectionsForDay(args);
    const legacy = await originalReleaseAll(args);
    return {
      releasedCount: Number(reserved.releasedCount || 0) + Number(legacy.releasedCount || 0),
      reservedReleasedCount: Number(reserved.releasedCount || 0),
      legacyReleasedCount: Number(legacy.releasedCount || 0),
    };
  };
  dailyAddonService.buildDailyAddonWallet = buildExactDailyAddonWallet;
  dailyAddonService.__reservationClosurePatched = true;
}

function patchPlanningService() {
  const planningService = require("./subscription/subscriptionPlanningClientService");
  const original = planningService.updateDaySelectionForClient;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function reservationAwareDaySelectionUpdate(args = {}) {
    const body = args.body || {};
    const explicitSubmitted = hasExplicitAddonPayload(body);
    let previousSelections = [];

    if (explicitSubmitted) {
      const previousDay = await SubscriptionDay.findOne({
        subscriptionId: args.subscriptionId,
        date: args.date,
      }).select("addonSelections").lean();
      previousSelections = Array.isArray(previousDay && previousDay.addonSelections)
        ? previousDay.addonSelections
        : [];
    }

    const result = await original(args);
    if (!explicitSubmitted || !result || result.ok !== true) return result;

    const day = await SubscriptionDay.findOne({
      subscriptionId: args.subscriptionId,
      date: args.date,
    }).lean();
    if (!day) return result;

    const submittedChoices = explicitAddonPayload(body);
    if (submittedChoices.length > 0) {
      await reserveExplicitSubscriptionSelectionsForDay({ dayId: day._id });
      await releaseDetachedAutoReservations({
        dayId: day._id,
        previousSelections,
      });
    }

    await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });

    const [latestDay, latestSubscription] = await Promise.all([
      SubscriptionDay.findById(day._id).lean(),
      Subscription.findById(day.subscriptionId).lean(),
    ]);
    if (result.data && typeof result.data === "object") {
      result.data.addonSelections = Array.isArray(latestDay && latestDay.addonSelections)
        ? latestDay.addonSelections
        : [];
      result.data.dailyAddonWallet = buildExactDailyAddonWallet(latestSubscription);
    }
    return result;
  };

  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  planningService.updateDaySelectionForClient = wrapped;
}

function installSubscriptionAddonReservationClosure() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  patchDailyAddonService();
  patchPlanningService();
}

installSubscriptionAddonReservationClosure();

module.exports = {
  buildExactDailyAddonWallet,
  consumeSubscriptionAddonReservationsForDay,
  explicitAllocationKey,
  installSubscriptionAddonReservationClosure,
  moveConsumedUnitToReservation,
  releaseDetachedAutoReservations,
  releaseReservedSubscriptionAddonSelectionsForDay,
  reserveExplicitSubscriptionSelectionsForDay,
  trimDefaultsCoveredByExplicitSelections,
};
