"use strict";

const opsPayloadService = require("./dashboard/opsPayloadService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonOpsIdentityClosure.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonOpsIdentityClosure.wrapped");

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    if (value && typeof value === "object" && value._id && value._id !== value) {
      return clean(value._id);
    }
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function localizedPair(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.name || value.titleI18n || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return localizedPair(nested);
    const ar = clean(value.ar || value.en);
    const en = clean(value.en || value.ar);
    return { ar, en };
  }
  const text = clean(value);
  return { ar: text, en: text };
}

function identityParts(addon = {}) {
  return {
    allocationKey: clean(addon.dailyAllocationKey || addon.addonAllocationKey),
    bucketId: clean(addon.balanceBucketId),
    entitlementKey: clean(addon.entitlementKey),
    planId: clean(addon.addonPlanId),
    productId: clean(addon.productId || addon.menuProductId || addon.addonId || addon.id || addon._id),
    sourceId: clean(addon.id || addon._id),
  };
}

function identityKeys(addon = {}) {
  const ids = identityParts(addon);
  return [
    ids.allocationKey ? `allocation:${ids.allocationKey}` : "",
    ids.bucketId && ids.entitlementKey && ids.productId
      ? `bucket-entitlement-product:${ids.bucketId}:${ids.entitlementKey}:${ids.productId}`
      : "",
    ids.bucketId && ids.productId ? `bucket-product:${ids.bucketId}:${ids.productId}` : "",
    ids.entitlementKey && ids.productId ? `entitlement-product:${ids.entitlementKey}:${ids.productId}` : "",
    ids.planId && ids.productId ? `plan-product:${ids.planId}:${ids.productId}` : "",
    ids.sourceId ? `source:${ids.sourceId}` : "",
  ].filter(Boolean);
}

function buildSourceQueues(sources = []) {
  const queues = new Map();
  for (const source of sources) {
    for (const key of identityKeys(source)) {
      const queue = queues.get(key) || [];
      queue.push(source);
      queues.set(key, queue);
    }
  }
  return queues;
}

function matchSource(addon, queues, used) {
  for (const key of identityKeys(addon)) {
    const queue = queues.get(key) || [];
    const match = queue.find((source) => !used.has(source));
    if (match) {
      used.add(match);
      return match;
    }
  }
  return null;
}

function sourceAddons(day = {}) {
  return []
    .concat(Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .concat(Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [])
    .concat(Array.isArray(day.recurringAddons) ? day.recurringAddons : []);
}

function localizedName(pair, lang) {
  return String(lang || "en").toLowerCase() === "ar"
    ? pair.ar || pair.en
    : pair.en || pair.ar;
}

function enrichAddon(addon = {}, source = null, lang = "en") {
  if (!source) {
    return {
      ...addon,
      addonIdentityResolved: false,
    };
  }

  const autoDailyAddon = source.autoDailyAddon === true;
  const subscriptionFunded = ["subscription", "wallet"].includes(clean(source.source))
    || autoDailyAddon;
  const sourceName = localizedPair(source.nameI18n || source.name);
  const sourcePlanName = localizedPair(
    source.subscriptionAddonLabelI18n
      || source.addonPlanNameI18n
      || addon.addonPlanNameI18n
  );
  const nameI18n = autoDailyAddon && (sourceName.ar || sourceName.en)
    ? sourceName
    : localizedPair(addon.nameI18n || addon.name || sourceName);

  return {
    ...addon,
    name: localizedName(nameI18n, lang),
    nameI18n,
    dailyAllocationKey: clean(source.dailyAllocationKey) || null,
    balanceBucketId: clean(source.balanceBucketId || addon.balanceBucketId) || null,
    entitlementKey: clean(source.entitlementKey || addon.entitlementKey) || null,
    addonPlanId: clean(source.addonPlanId || addon.addonPlanId) || null,
    autoDailyAddon,
    dailyEntitlement: source.dailyEntitlement === true || autoDailyAddon,
    selectionOrigin: source.selectionOrigin
      || (autoDailyAddon ? "subscription_daily_default" : "customer_selected"),
    addonSettlementState: clean(source.addonSettlementState)
      || (subscriptionFunded ? "reserved" : null),
    requiresKitchenChoice: source.requiresKitchenChoice === true,
    subscriptionAddonLabelI18n: sourcePlanName.ar || sourcePlanName.en
      ? sourcePlanName
      : undefined,
    resolvedProductNameI18n: source.resolvedProductNameI18n || undefined,
    sourceOfTruth: subscriptionFunded ? "subscription.addonBalance" : undefined,
    addonIdentityResolved: true,
  };
}

function installSubscriptionAddonOpsIdentityClosure() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const original = opsPayloadService.buildKitchenDetailsPayload;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = function identityAwareKitchenDetails(day = {}, subscription = {}, lang = "en", catalogMaps = {}) {
    const result = original(day, subscription, lang, catalogMaps) || {};
    const sources = sourceAddons(day);
    const queues = buildSourceQueues(sources);
    const used = new Set();
    const addons = (Array.isArray(result.addons) ? result.addons : [])
      .map((addon) => enrichAddon(addon, matchSource(addon, queues, used), lang));

    const automatic = addons.filter((addon) => addon.autoDailyAddon === true);
    return {
      ...result,
      addons,
      dailyAddonSummary: {
        total: automatic.reduce((sum, addon) => sum + Math.max(1, Number(addon.quantity || 1)), 0),
        requiresKitchenChoice: automatic
          .filter((addon) => addon.requiresKitchenChoice === true)
          .reduce((sum, addon) => sum + Math.max(1, Number(addon.quantity || 1)), 0),
        identityUnresolved: addons.filter((addon) => addon.addonIdentityResolved === false).length,
        sourceOfTruth: "subscription.addonBalance",
      },
    };
  };

  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  wrapped.__stableAddonIdentity = true;
  opsPayloadService.buildKitchenDetailsPayload = wrapped;
}

installSubscriptionAddonOpsIdentityClosure();

module.exports = {
  enrichAddon,
  identityKeys,
  installSubscriptionAddonOpsIdentityClosure,
  matchSource,
};
