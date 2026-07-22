"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("./subscription/subscriptionDailyAddonService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonReopenClosure.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonReopenClosure.wrapped");
const ELIGIBLE_STATUSES = new Set([
  "open",
  "locked",
  "in_preparation",
  "ready_for_delivery",
  "out_for_delivery",
  "ready_for_pickup",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function activeSelection(selection) {
  return Boolean(selection && clean(selection.addonSettlementState) !== "released");
}

function eligibleDay(day) {
  if (!day || !ELIGIBLE_STATUSES.has(clean(day.status || "open"))) return false;
  return day.plannerState === "confirmed"
    || day.planningState === "confirmed"
    || clean(day.status) !== "open";
}

async function reactivateReleasedSelection({ day, subscription, selection }) {
  const allocationKey = clean(selection.dailyAllocationKey);
  if (!allocationKey || !selection.balanceBucketId) {
    return { reactivated: false, reason: "MISSING_RELEASED_SELECTION_IDENTITY" };
  }

  const reservation = await dailyAddonService.reserveBalanceAllocation({
    subscriptionId: subscription._id,
    bucketId: selection.balanceBucketId,
    allocationKey,
  });
  if (!reservation.reserved) {
    return {
      reactivated: false,
      idempotent: Boolean(reservation.idempotent),
      reason: reservation.reason || (reservation.consumed ? "ADDON_ALREADY_CONSUMED" : "NO_ADDON_BALANCE"),
    };
  }

  const now = new Date();
  const update = await SubscriptionDay.updateOne(
    {
      _id: day._id,
      addonSelections: {
        $elemMatch: {
          dailyAllocationKey: allocationKey,
          addonSettlementState: "released",
        },
      },
    },
    {
      $set: {
        "addonSelections.$[selection].addonSettlementState": "reserved",
        "addonSelections.$[selection].source": "wallet",
        "addonSelections.$[selection].autoDailyAddon": true,
        "addonSelections.$[selection].dailyEntitlement": true,
        "addonSelections.$[selection].selectionOrigin": "subscription_daily_default",
        "addonSelections.$[selection].reservedAt": now,
        "addonSelections.$[selection].settledAt": null,
        "addonSelections.$[selection].releasedAt": null,
        "addonSelections.$[selection].consumedAt": null,
        "addonSelections.$[selection].settlementReason": null,
      },
    },
    {
      arrayFilters: [{
        "selection.dailyAllocationKey": allocationKey,
        "selection.addonSettlementState": "released",
      }],
    }
  );
  const modified = Number(
    update && (update.modifiedCount !== undefined ? update.modifiedCount : update.nModified) || 0
  );

  if (modified === 0) {
    const current = await SubscriptionDay.findOne({
      _id: day._id,
      addonSelections: {
        $elemMatch: {
          dailyAllocationKey: allocationKey,
          addonSettlementState: "reserved",
        },
      },
    }).select("_id").lean();
    if (!current) {
      await dailyAddonService.releaseBalanceAllocation({
        subscriptionId: subscription._id,
        bucketId: selection.balanceBucketId,
        allocationKey,
      });
      return { reactivated: false, compensated: true, reason: "RELEASED_SELECTION_CHANGED" };
    }
  }

  await SubscriptionDailyAddonOperation.updateOne(
    { subscriptionDayId: day._id, allocationKey },
    {
      $set: {
        status: "completed",
        completedAt: now,
        releasedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        selectionSnapshot: {
          ...selection,
          addonSettlementState: "reserved",
          source: "wallet",
          reservedAt: now,
          releasedAt: null,
          consumedAt: null,
        },
      },
    }
  );

  return {
    reactivated: true,
    idempotent: Boolean(reservation.idempotent || modified === 0),
    allocationKey,
  };
}

async function reactivateReleasedDailyDefaultsForDay({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day || !eligibleDay(day)) {
    return { reactivatedCount: 0, skipped: true, reason: "DAY_NOT_ELIGIBLE" };
  }
  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription || subscription.status !== "active") {
    return { reactivatedCount: 0, skipped: true, reason: "SUBSCRIPTION_NOT_ACTIVE" };
  }

  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  let currentDay = day;
  let reactivatedCount = 0;
  const results = [];

  for (let index = 0; index < entitlements.length; index += 1) {
    const entitlement = entitlements[index];
    const bucket = dailyAddonService.findBalanceBucket(subscription, entitlement, index);
    if (!bucket) continue;
    const dailyQty = positiveInt(entitlement.quantityPerDay || entitlement.purchasedDailyQty, 1);
    const matches = (selection) => dailyAddonService.selectionMatchesEntitlement(
      selection,
      entitlement,
      bucket,
      index
    );
    let activeCount = (currentDay.addonSelections || [])
      .filter(activeSelection)
      .filter(matches)
      .length;
    if (activeCount >= dailyQty) continue;

    const released = (currentDay.addonSelections || [])
      .filter((selection) => selection && selection.autoDailyAddon === true)
      .filter((selection) => clean(selection.addonSettlementState) === "released")
      .filter(matches)
      .filter((selection) => clean(selection.dailyAllocationKey) && selection.balanceBucketId);

    for (const selection of released) {
      if (activeCount >= dailyQty) break;
      const result = await reactivateReleasedSelection({ day: currentDay, subscription, selection });
      results.push(result);
      if (result.reactivated) {
        if (!result.idempotent) reactivatedCount += 1;
        activeCount += 1;
        currentDay = await SubscriptionDay.findById(currentDay._id).lean();
      } else if (result.reason === "NO_ADDON_BALANCE") {
        break;
      }
    }
  }

  return {
    reactivatedCount,
    results,
    day: currentDay,
  };
}

function installSubscriptionAddonReopenClosure() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  const original = dailyAddonService.ensureDailyAddonDefaultsForDay;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function reopenAwareDailyDefaults(args = {}) {
    let reactivation = null;
    if (args.dayId) {
      reactivation = await reactivateReleasedDailyDefaultsForDay({ dayId: args.dayId });
    }
    const result = await original(args);
    return {
      ...(result || {}),
      reactivatedCount: Number(reactivation && reactivation.reactivatedCount || 0),
      reactivationResults: reactivation && reactivation.results || [],
    };
  };
  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  wrapped.__reopenAwareDailyDefaults = true;
  dailyAddonService.ensureDailyAddonDefaultsForDay = wrapped;
}

installSubscriptionAddonReopenClosure();

module.exports = {
  installSubscriptionAddonReopenClosure,
  reactivateReleasedDailyDefaultsForDay,
  reactivateReleasedSelection,
};
