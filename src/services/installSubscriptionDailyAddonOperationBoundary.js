"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const Subscription = require("../models/Subscription");
const dailyAddonService = require("./subscription/subscriptionDailyAddonService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionDailyAddonOperationBoundary.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionDailyAddonOperationBoundary.wrapped");
const CREATION_STATUSES = new Set(["open", "locked"]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function canCreateDailyAddonDefaultsForStatus(status) {
  return CREATION_STATUSES.has(clean(status || "open"));
}

function activeSubscriptionAddonSelections(day) {
  return (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.source === "subscription")
    .filter((selection) => clean(selection.addonSettlementState) !== "released");
}

function installSubscriptionDailyAddonOperationBoundary() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const original = dailyAddonService.ensureDailyAddonDefaultsForDay;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function operationBoundaryAwareEnsure(args = {}) {
    const day = args.dayId
      ? await SubscriptionDay.findById(args.dayId).lean()
      : args.subscriptionId && args.date
        ? await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean()
        : null;
    if (!day || canCreateDailyAddonDefaultsForStatus(day.status)) return original(args);

    const subscription = await Subscription.findById(day.subscriptionId).lean();
    const activeSelections = activeSubscriptionAddonSelections(day);
    return {
      day,
      wallet: dailyAddonService.buildDailyAddonWallet(subscription),
      reserved: false,
      idempotent: true,
      skipped: true,
      reason: "operations_already_started",
      operationBoundary: {
        status: day.status,
        allowedCreationStatuses: [...CREATION_STATUSES],
        activeSubscriptionAddonCount: activeSelections.length,
        reconciliationRequired: activeSelections.length === 0,
        recommendedAction: activeSelections.length === 0
          ? "review_missing_daily_addon_before_next_transition"
          : null,
      },
    };
  };
  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  wrapped.__operationBoundaryAware = true;
  dailyAddonService.ensureDailyAddonDefaultsForDay = wrapped;
}

installSubscriptionDailyAddonOperationBoundary();

module.exports = {
  CREATION_STATUSES,
  canCreateDailyAddonDefaultsForStatus,
  installSubscriptionDailyAddonOperationBoundary,
};
