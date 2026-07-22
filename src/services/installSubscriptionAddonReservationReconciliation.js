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

async function updateAutomaticSelectionName({ dayId, selection, desiredName, nameI18n, planI18n }) {
  const allocationKey = clean(selection && selection.dailyAllocationKey);
  if (allocationKey) {
    return SubscriptionDay.updateOne(
      { _id: dayId, "addonSelections.dailyAllocationKey": allocationKey },
      {
        $set: {
          "addonSelections.$[selection].name": desiredName,
          "addonSelections.$[selection].nameI18n": nameI18n,
          "addonSelections.$[selection].subscriptionAddonLabelI18n": planI18n,
        },
      },
      { arrayFilters: [{ "selection.dailyAllocationKey": allocationKey }] }
    );
  }

  if (selection && selection._id) {
    return SubscriptionDay.updateOne(
      { _id: dayId, "addonSelections._id": selection._id },
      {
        $set: {
          "addonSelections.$.name": desiredName,
          "addonSelections.$.nameI18n": nameI18n,
          "addonSelections.$.subscriptionAddonLabelI18n": planI18n,
        },
      }
    );
  }

  return { matchedCount: 0, modifiedCount: 0 };
}

async function normalizeAutomaticDefaultNames({ dayId } = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { updatedCount: 0, skipped: true, reason: "DAY_NOT_FOUND" };
  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription) return { updatedCount: 0, skipped: true, reason: "SUBSCRIPTION_NOT_FOUND" };
  let updatedCount = 0;

  for (const selection of Array.isArray(day.addonSelections) ? day.addonSelections : []) {
    if (!selection || selection.autoDailyAddon !== true) continue;
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
    const currentName = clean(selection.name);
    const currentI18n = localizedPair(selection.nameI18n);
    const currentPlan = localizedPair(selection.subscriptionAddonLabelI18n);
    if (
      currentName === desiredName
      && currentI18n.ar === nameI18n.ar
      && currentI18n.en === nameI18n.en
      && currentPlan.ar === planI18n.ar
      && currentPlan.en === planI18n.en
    ) {
      continue;
    }

    const result = await updateAutomaticSelectionName({
      dayId: day._id,
      selection,
      desiredName,
      nameI18n,
      planI18n,
    });
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
  entitlementForSelection,
  installSubscriptionAddonReservationReconciliation,
  normalizeAutomaticDefaultNames,
  updateAutomaticSelectionName,
};
