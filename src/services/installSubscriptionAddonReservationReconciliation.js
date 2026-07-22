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
    const nested = value.nameI18n || value.name || value.labelI18n || value.label;
    if (nested && nested !== value) return localizedPair(nested);
    const ar = clean(value.ar || value.en);
    const en = clean(value.en || value.ar);
    return { ar, en };
  }
  const text = clean(value);
  return { ar: text, en: text };
}

function subscriptionLabel(value) {
  const source = localizedPair(value);
  const ar = source.ar || source.en || "إضافة يومية";
  const en = source.en || source.ar || "Daily Add-on";
  return {
    ar: /اشتراك/.test(ar) ? ar : `اشتراك ${ar}`,
    en: /subscription/i.test(en) ? en : `${en} Subscription`,
  };
}

function entitlementForSelection(subscription, selection) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  const balances = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance.filter(Boolean)
    : [];
  const selectionBucketId = clean(selection && selection.balanceBucketId);
  const selectionEntitlementKey = clean(selection && selection.entitlementKey);
  const selectionPlanId = clean(selection && selection.addonPlanId);

  let bucket = null;
  if (selectionBucketId) {
    bucket = balances.find((row) => clean(row && (row._id || row.balanceBucketId)) === selectionBucketId) || null;
  }
  const bucketEntitlementKey = clean(bucket && bucket.entitlementKey);
  const bucketPlanId = clean(bucket && (bucket.addonPlanId || bucket.addonId));

  const byKey = entitlements.filter((row) => {
    const key = clean(row && row.entitlementKey);
    return key && (key === selectionEntitlementKey || key === bucketEntitlementKey);
  });
  if (byKey.length === 1) return byKey[0];

  const targetPlanId = selectionPlanId || bucketPlanId;
  const byPlan = entitlements.filter((row) => (
    targetPlanId && clean(row && (row.addonPlanId || row.addonId)) === targetPlanId
  ));
  return byPlan.length === 1 ? byPlan[0] : null;
}

function composeDefaultName(selection = {}, entitlement = null) {
  const planSource = selection.subscriptionAddonLabelI18n
    || (entitlement && (
      entitlement.addonPlanNameI18n
      || entitlement.addonPlanName
      || entitlement.name
    ))
    || selection.entitlementCategory
    || selection.category;
  const plan = subscriptionLabel(planSource);

  if (selection.requiresKitchenChoice === true) return plan;

  const product = localizedPair(
    selection.resolvedProductNameI18n
      || selection.nameI18n
      || selection.name
  );
  const productLooksLikePlan = /اشتراك/.test(product.ar) || /subscription/i.test(product.en);
  if ((!product.ar && !product.en) || productLooksLikePlan) return plan;

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

function normalizedAutomaticSelection(subscription, selection) {
  if (!selection || selection.autoDailyAddon !== true) return selection;
  const entitlement = entitlementForSelection(subscription, selection);
  const nameI18n = composeDefaultName(selection, entitlement);
  const planI18n = subscriptionLabel(
    selection.subscriptionAddonLabelI18n
      || (entitlement && (
        entitlement.addonPlanNameI18n
        || entitlement.addonPlanName
        || entitlement.name
      ))
      || selection.entitlementCategory
      || selection.category
  );
  const desiredName = nameI18n.ar || nameI18n.en;
  const currentI18n = localizedPair(selection.nameI18n);
  const currentPlan = localizedPair(selection.subscriptionAddonLabelI18n);
  const unchanged = clean(selection.name) === desiredName
    && currentI18n.ar === nameI18n.ar
    && currentI18n.en === nameI18n.en
    && currentPlan.ar === planI18n.ar
    && currentPlan.en === planI18n.en;
  if (unchanged) return selection;
  return {
    ...selection,
    name: desiredName,
    nameI18n,
    subscriptionAddonLabelI18n: planI18n,
  };
}

async function normalizeAutomaticDefaultNames({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { updatedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription) return { updatedCount: 0, skipped: true, reason: "SUBSCRIPTION_NOT_FOUND" };

  const source = Array.isArray(day.addonSelections) ? day.addonSelections : [];
  let updatedCount = 0;
  const nextSelections = source.map((selection) => {
    const normalized = normalizedAutomaticSelection(subscription, selection);
    if (normalized !== selection) updatedCount += 1;
    return normalized;
  });
  if (!updatedCount) return { updatedCount: 0 };

  const filter = { _id: day._id };
  if (clean(day.plannerRevisionHash)) filter.plannerRevisionHash = day.plannerRevisionHash;
  const updated = await SubscriptionDay.findOneAndUpdate(
    filter,
    { $set: { addonSelections: nextSelections } },
    { new: true }
  ).lean();
  if (!updated) {
    const err = new Error("Subscription day changed while normalizing daily add-on labels");
    err.code = "DAY_CHANGED";
    err.status = 409;
    throw err;
  }
  return { updatedCount, day: updated };
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

    const normalized = await normalizeAutomaticDefaultNames({ dayId: day._id });
    const [latestDay, subscription] = await Promise.all([
      normalized.day || SubscriptionDay.findById(day._id).lean(),
      Subscription.findById(day.subscriptionId).lean(),
    ]);

    return {
      ...(result || {}),
      normalizationUpdatedCount: Number(normalized.updatedCount || 0),
      day: latestDay,
      wallet: dailyAddonService.buildDailyAddonWallet(subscription),
    };
  };

  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = originalEnsure;
  wrapped.__reservationReconciliation = true;
  dailyAddonService.ensureDailyAddonDefaultsForDay = wrapped;
}

installSubscriptionAddonReservationReconciliation();

module.exports = {
  composeDefaultName,
  entitlementForSelection,
  installSubscriptionAddonReservationReconciliation,
  normalizeAutomaticDefaultNames,
  normalizedAutomaticSelection,
};
