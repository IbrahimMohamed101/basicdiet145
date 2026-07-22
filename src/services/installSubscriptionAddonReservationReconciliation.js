"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const dailyAddonService = require("./subscription/subscriptionDailyAddonService");
const reservationClosure = require("./installSubscriptionAddonReservationClosure");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonReservationReconciliation.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonReservationReconciliation.wrapped");
const TERMINAL_DAY_STATUSES = new Set([
  "fulfilled",
  "no_show",
  "skipped",
  "frozen",
  "delivery_canceled",
  "canceled_at_branch",
  "canceled",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function localizedPair(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ar = clean(value.ar || value.en);
    const en = clean(value.en || value.ar);
    return { ar, en };
  }
  const text = clean(value);
  return { ar: text, en: text };
}

function composeDefaultName(selection = {}) {
  const product = localizedPair(selection.resolvedProductNameI18n);
  const plan = localizedPair(selection.subscriptionAddonLabelI18n);
  if (!plan.ar && !plan.en) return null;
  if (!product.ar && !product.en) return plan;
  return {
    ar: `${product.ar || product.en} — ${plan.ar || plan.en}`,
    en: `${product.en || product.ar} — ${plan.en || plan.ar}`,
  };
}

async function resolveDay(args = {}, result = null) {
  const resultDayId = result && result.day && result.day._id;
  if (args.dayId || resultDayId) {
    return SubscriptionDay.findById(args.dayId || resultDayId).lean();
  }
  if (args.subscriptionId && args.date) {
    return SubscriptionDay.findOne({
      subscriptionId: args.subscriptionId,
      date: args.date,
    }).lean();
  }
  return null;
}

async function normalizeAutomaticDefaultNames({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { updatedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  let updatedCount = 0;

  for (const selection of Array.isArray(day.addonSelections) ? day.addonSelections : []) {
    if (!selection || selection.autoDailyAddon !== true) continue;
    const nameI18n = composeDefaultName(selection);
    if (!nameI18n) continue;
    const desiredName = nameI18n.ar || nameI18n.en;
    const currentName = clean(selection.name);
    const currentI18n = localizedPair(selection.nameI18n);
    if (
      currentName === desiredName
      && currentI18n.ar === nameI18n.ar
      && currentI18n.en === nameI18n.en
    ) {
      continue;
    }

    const result = await SubscriptionDay.updateOne(
      { _id: day._id, "addonSelections._id": selection._id },
      {
        $set: {
          "addonSelections.$.name": desiredName,
          "addonSelections.$.nameI18n": nameI18n,
        },
      }
    );
    const matched = Number(
      result && (result.matchedCount !== undefined ? result.matchedCount : result.n) || 0
    );
    if (matched > 0) updatedCount += 1;
  }

  return { updatedCount };
}

function installSubscriptionAddonReservationReconciliation() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const originalEnsure = dailyAddonService.ensureDailyAddonDefaultsForDay;
  if (typeof originalEnsure !== "function" || originalEnsure[WRAPPED_KEY]) return;

  const wrapped = async function reservationReconciledDefaults(args = {}) {
    let day = await resolveDay(args);
    if (day && !TERMINAL_DAY_STATUSES.has(clean(day.status))) {
      await reservationClosure.reserveExplicitSubscriptionSelectionsForDay({
        dayId: day._id,
      });
    }

    const result = await originalEnsure(args);
    day = await resolveDay(args, result);
    if (!day) return result;

    await normalizeAutomaticDefaultNames({ dayId: day._id });
    const [latestDay, subscription] = await Promise.all([
      SubscriptionDay.findById(day._id).lean(),
      Subscription.findById(day.subscriptionId).lean(),
    ]);

    return {
      ...(result || {}),
      day: latestDay,
      wallet: dailyAddonService.buildDailyAddonWallet(subscription),
    };
  };

  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = originalEnsure;
  dailyAddonService.ensureDailyAddonDefaultsForDay = wrapped;
}

installSubscriptionAddonReservationReconciliation();

module.exports = {
  composeDefaultName,
  installSubscriptionAddonReservationReconciliation,
  normalizeAutomaticDefaultNames,
};
