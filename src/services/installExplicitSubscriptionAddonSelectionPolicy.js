"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getRestaurantBusinessDate } = require("./restaurantHoursService");
const { logger } = require("../utils/logger");
const dailyAddonService = require("./subscription/subscriptionDailyAddonService");

const INSTALL_KEY = Symbol.for(
  "basicdiet.explicitSubscriptionAddonSelectionPolicy.installed"
);
const ORIGINALS_KEY = Symbol.for(
  "basicdiet.explicitSubscriptionAddonSelectionPolicy.originals"
);

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

function implicitDefaultsEnabled() {
  return clean(process.env.SUBSCRIPTION_DAILY_ADDON_AUTO_DEFAULTS_ENABLED)
    .toLowerCase() === "true";
}

async function explicitSelectionOnlyResult({
  subscriptionId,
  dayId = null,
  date = null,
} = {}) {
  const dayQuery = dayId ? { _id: dayId } : { subscriptionId, date };
  const day = await SubscriptionDay.findOne(dayQuery).lean();
  if (!day) {
    return {
      appliedCount: 0,
      skipped: true,
      reason: "DAY_NOT_FOUND",
      results: [],
      day: null,
      wallet: dailyAddonService.buildDailyAddonWallet(null),
    };
  }

  const subscription = await Subscription.findById(day.subscriptionId).lean();
  return {
    appliedCount: 0,
    skipped: true,
    reason: "EXPLICIT_ADDON_SELECTION_REQUIRED",
    results: [],
    day,
    wallet: dailyAddonService.buildDailyAddonWallet(subscription),
  };
}

function installExplicitSubscriptionAddonSelectionPolicy() {
  if (globalThis[INSTALL_KEY]) return dailyAddonService;

  const originals = {
    ensureDailyAddonDefaultsForDay:
      dailyAddonService.ensureDailyAddonDefaultsForDay,
    reconcileDayDailyAddonState:
      dailyAddonService.reconcileDayDailyAddonState,
    reconcileDailyAddonsForDate:
      dailyAddonService.reconcileDailyAddonsForDate,
    reconcileDailyAddonsForUser:
      dailyAddonService.reconcileDailyAddonsForUser,
  };

  Object.defineProperty(dailyAddonService, ORIGINALS_KEY, {
    value: originals,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  dailyAddonService.ensureDailyAddonDefaultsForDay = async function (
    args = {}
  ) {
    if (implicitDefaultsEnabled()) {
      return originals.ensureDailyAddonDefaultsForDay(args);
    }
    return explicitSelectionOnlyResult(args);
  };

  dailyAddonService.reconcileDayDailyAddonState = async function ({
    dayId,
  } = {}) {
    if (implicitDefaultsEnabled()) {
      return originals.reconcileDayDailyAddonState({ dayId });
    }

    const day = await SubscriptionDay.findById(dayId).lean();
    if (!day) {
      return { skipped: true, reason: "DAY_NOT_FOUND" };
    }

    const status = clean(day.status);
    if (status === "fulfilled" || RELEASE_DAY_STATUSES.has(status)) {
      // Preserve settlement of historical reservations, but never create a new one.
      return originals.reconcileDayDailyAddonState({ dayId: day._id });
    }

    return explicitSelectionOnlyResult({ dayId: day._id });
  };

  dailyAddonService.reconcileDailyAddonsForDate = async function ({
    date,
  } = {}) {
    if (implicitDefaultsEnabled()) {
      return originals.reconcileDailyAddonsForDate({ date });
    }

    const days = await SubscriptionDay.find({ date }).select("_id").lean();
    const results = [];
    for (const day of days) {
      try {
        results.push(
          await dailyAddonService.reconcileDayDailyAddonState({
            dayId: day._id,
          })
        );
      } catch (error) {
        logger.error("explicit add-on reconciliation failed", {
          dayId: clean(day._id),
          date: clean(date),
          error: error.message,
          code: error.code || null,
        });
        results.push({
          error: error.message,
          code: error.code || "INTERNAL",
        });
      }
    }
    return results;
  };

  dailyAddonService.reconcileDailyAddonsForUser = async function ({
    userId,
  } = {}) {
    if (implicitDefaultsEnabled()) {
      return originals.reconcileDailyAddonsForUser({ userId });
    }
    if (!userId) return null;

    const subscription = await Subscription.findOne({
      userId,
      status: "active",
    })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (!subscription) return null;

    const date = await getRestaurantBusinessDate();
    const day = await SubscriptionDay.findOne({
      subscriptionId: subscription._id,
      date,
    })
      .select("_id")
      .lean();

    return day
      ? dailyAddonService.reconcileDayDailyAddonState({ dayId: day._id })
      : null;
  };

  globalThis[INSTALL_KEY] = true;
  return dailyAddonService;
}

installExplicitSubscriptionAddonSelectionPolicy();
require("./installExplicitKitchenAddonVisibilityPolicy");

module.exports = {
  implicitDefaultsEnabled,
  installExplicitSubscriptionAddonSelectionPolicy,
};
