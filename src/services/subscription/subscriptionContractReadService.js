const { PHASE1_CONTRACT_VERSION } = require("../../constants/phase1Contract");
const { pickLang } = require("../../utils/i18n");
const { logger } = require("../../utils/logger");
const {
  isPhase1SnapshotFirstReadsEnabled,
  isPhase1CompatLoggingEnabled,
} = require("../../utils/featureFlags");

function normalizeFreezePolicy(source) {
  const value = source && typeof source === "object" ? source : {};
  return {
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    maxDays: Number.isInteger(value.maxDays) && value.maxDays >= 1 ? value.maxDays : 31,
    maxTimes: Number.isInteger(value.maxTimes) && value.maxTimes >= 0 ? value.maxTimes : 1,
  };
}

function normalizeSkipPolicy(source) {
  const value = source && typeof source === "object" ? source : {};
  return {
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    maxDays: Number.isInteger(value.maxDays) && value.maxDays >= 0 ? value.maxDays : 0,
  };
}

function normalizeDateComparable(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isCanonicalSubscriptionContract(subscription) {
  return Boolean(
    subscription
    && subscription.contractVersion === PHASE1_CONTRACT_VERSION
    && subscription.contractMode === "canonical"
    && subscription.contractSnapshot
    && typeof subscription.contractSnapshot === "object"
  );
}

function isGrandfatheredSubscriptionContract(subscription) {
  if (!subscription || typeof subscription !== "object") {
    return true;
  }
  if (subscription.contractMode === "legacy_grandfathered") {
    return true;
  }
  return !isCanonicalSubscriptionContract(subscription);
}

function getSnapshot(subscription) {
  return subscription && subscription.contractSnapshot && typeof subscription.contractSnapshot === "object"
    ? subscription.contractSnapshot
    : {};
}

function getSnapshotPlanName(snapshot, lang) {
  const rawName = snapshot && snapshot.plan ? snapshot.plan.planName : null;
  if (!rawName) return null;
  if (typeof rawName === "string") {
    return rawName.trim() || null;
  }
  if (typeof rawName === "object" && !Array.isArray(rawName)) {
    return pickLang(rawName, lang) || null;
  }
  return null;
}

function pushMismatch(mismatches, field, snapshotValue, liveValue) {
  if (snapshotValue === null || snapshotValue === undefined || liveValue === null || liveValue === undefined) {
    return;
  }
  if (String(snapshotValue) !== String(liveValue)) {
    mismatches.push(field);
  }
}

function getSubscriptionContractDiagnostics(subscription, {
  lang = "ar",
  livePlanName = null,
  livePlan = null,
  snapshotFirstReadsEnabled = isPhase1SnapshotFirstReadsEnabled(),
} = {}) {
  const canonical = isCanonicalSubscriptionContract(subscription);
  const snapshot = getSnapshot(subscription);
  const mismatches = [];
  const fallbacks = [];

  if (!canonical) {
    return {
      canonical: false,
      readMode: "legacy",
      mismatches,
      fallbacks,
    };
  }

  const snapshotPlan = snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : {};
  const snapshotPricing = snapshot.pricing && typeof snapshot.pricing === "object" ? snapshot.pricing : {};
  const snapshotDelivery = snapshot.delivery && typeof snapshot.delivery === "object" ? snapshot.delivery : {};
  const snapshotStart = snapshot.start && typeof snapshot.start === "object" ? snapshot.start : {};

  pushMismatch(mismatches, "planId", snapshotPlan.planId, subscription && subscription.planId);
  pushMismatch(mismatches, "selectedGrams", snapshotPlan.selectedGrams, subscription && subscription.selectedGrams);
  pushMismatch(mismatches, "selectedMealsPerDay", snapshotPlan.mealsPerDay, subscription && subscription.selectedMealsPerDay);
  pushMismatch(mismatches, "totalMeals", snapshotPlan.totalMeals, subscription && subscription.totalMeals);
  pushMismatch(mismatches, "basePlanPriceHalala", snapshotPricing.basePlanPriceHalala, subscription && subscription.basePlanPriceHalala);
  pushMismatch(mismatches, "deliveryMode", snapshotDelivery.mode, subscription && subscription.deliveryMode);
  pushMismatch(
    mismatches,
    "deliveryWindow",
    snapshotDelivery && snapshotDelivery.slot ? snapshotDelivery.slot.window : null,
    subscription && subscription.deliveryWindow
  );

  const snapshotStartDate = normalizeDateComparable(snapshotStart.resolvedStartDate);
  const liveStartDate = normalizeDateComparable(subscription && subscription.startDate);
  if (snapshotStartDate && liveStartDate && snapshotStartDate !== liveStartDate) {
    mismatches.push("startDate");
  }

  const snapshotPlanName = getSnapshotPlanName(snapshot, lang);
  if (snapshotFirstReadsEnabled && !snapshotPlanName && livePlanName) {
    fallbacks.push("planName");
  }

  const snapshotFreezePolicy = snapshot.policySnapshot && snapshot.policySnapshot.freezePolicy;
  if (snapshotFirstReadsEnabled && canonical && !snapshotFreezePolicy) {
    fallbacks.push("freezePolicy");
  }
  if (snapshotFreezePolicy && livePlan && typeof livePlan === "object") {
    const normalizedSnapshotFreezePolicy = normalizeFreezePolicy(snapshotFreezePolicy);
    const normalizedLiveFreezePolicy = normalizeFreezePolicy(livePlan.freezePolicy);
    if (JSON.stringify(normalizedSnapshotFreezePolicy) !== JSON.stringify(normalizedLiveFreezePolicy)) {
      mismatches.push("freezePolicy");
    }
  }

  const snapshotSkipPolicy = snapshot.policySnapshot && snapshot.policySnapshot.skipPolicy;
  if (snapshotFirstReadsEnabled && canonical && !snapshotSkipPolicy) {
    fallbacks.push("skipPolicy");
  }
  if (snapshotSkipPolicy && livePlan && typeof livePlan === "object") {
    const normalizedSnapshotSkipPolicy = normalizeSkipPolicy(snapshotSkipPolicy);
    const normalizedLiveSkipPolicy = normalizeSkipPolicy(livePlan.skipPolicy);
    if (JSON.stringify(normalizedSnapshotSkipPolicy) !== JSON.stringify(normalizedLiveSkipPolicy)) {
      mismatches.push("skipPolicy");
    }
  }

  return {
    canonical: true,
    readMode: snapshotFirstReadsEnabled ? "snapshot_first" : "legacy",
    mismatches: Array.from(new Set(mismatches)),
    fallbacks: Array.from(new Set(fallbacks)),
  };
}

function maybeLogContractDiagnostics(subscription, diagnostics, {
  audience = "client",
  context = "subscription_read",
  compatLoggingEnabled = isPhase1CompatLoggingEnabled(),
  loggerOverride = logger,
} = {}) {
  if (!compatLoggingEnabled) return;
  if (!diagnostics || (!diagnostics.mismatches.length && !diagnostics.fallbacks.length)) return;

  try {
    loggerOverride.info("Phase 1 subscription contract diagnostics", {
      subscriptionId: subscription && subscription._id ? String(subscription._id) : null,
      audience,
      context,
      contractVersion: subscription && subscription.contractVersion ? subscription.contractVersion : null,
      contractMode: subscription && subscription.contractMode ? subscription.contractMode : null,
      contractSource: subscription && subscription.contractSource ? subscription.contractSource : null,
      readMode: diagnostics.readMode,
      mismatches: diagnostics.mismatches,
      fallbacks: diagnostics.fallbacks,
    });
  } catch (_) {
    // Diagnostic-only logging must never block reads.
  }
}

function getSubscriptionContractReadView(subscription, {
  audience = "client",
  lang = "ar",
  livePlanName = null,
  livePlan = null,
  context = "subscription_read",
  snapshotFirstReadsEnabled = isPhase1SnapshotFirstReadsEnabled(),
  compatLoggingEnabled = isPhase1CompatLoggingEnabled(),
  loggerOverride = logger,
} = {}) {
  const canonical = isCanonicalSubscriptionContract(subscription);
  const grandfathered = isGrandfatheredSubscriptionContract(subscription);
  const snapshot = getSnapshot(subscription);
  const diagnostics = getSubscriptionContractDiagnostics(subscription, {
    lang,
    livePlanName,
    livePlan,
    snapshotFirstReadsEnabled,
  });

  maybeLogContractDiagnostics(subscription, diagnostics, {
    audience,
    context,
    compatLoggingEnabled,
    loggerOverride,
  });

  const snapshotPlanName = getSnapshotPlanName(snapshot, lang);
  const planName = canonical && snapshotFirstReadsEnabled && snapshotPlanName
    ? snapshotPlanName
    : livePlanName || null;

  const contract = {
    isCanonical: canonical,
    isGrandfathered: grandfathered,
    version: subscription && subscription.contractVersion ? subscription.contractVersion : null,
  };

  const contractMeta = audience === "admin"
    ? {
      version: contract.version,
      mode: subscription && subscription.contractMode
        ? subscription.contractMode
        : grandfathered
          ? "legacy_grandfathered"
          : null,
      completeness: subscription && subscription.contractCompleteness
        ? subscription.contractCompleteness
        : canonical
          ? "authoritative"
          : "unavailable",
      source: subscription && subscription.contractSource ? subscription.contractSource : null,
      isCanonical: canonical,
      isGrandfathered: grandfathered,
      snapshotAvailable: Boolean(canonical && snapshot && Object.keys(snapshot).length),
      readMode: diagnostics.readMode,
      diagnosticsAvailable: canonical,
    }
    : undefined;

  return {
    contract,
    contractMeta,
    planName,
    diagnostics,
  };
}

function resolveSubscriptionFreezePolicy(subscription, livePlan, {
  context = "freeze_policy",
  snapshotFirstReadsEnabled = isPhase1SnapshotFirstReadsEnabled(),
  compatLoggingEnabled = isPhase1CompatLoggingEnabled(),
  loggerOverride = logger,
} = {}) {
  const canonical = isCanonicalSubscriptionContract(subscription);
  const snapshot = getSnapshot(subscription);
  const snapshotFreezePolicy = snapshot
    && snapshot.policySnapshot
    && typeof snapshot.policySnapshot === "object"
    ? snapshot.policySnapshot.freezePolicy
    : null;

  if (canonical && snapshotFirstReadsEnabled && snapshotFreezePolicy) {
    const diagnostics = getSubscriptionContractDiagnostics(subscription, {
      livePlan,
      snapshotFirstReadsEnabled,
    });
    maybeLogContractDiagnostics(subscription, diagnostics, {
      audience: "system",
      context,
      compatLoggingEnabled,
      loggerOverride,
    });
    return normalizeFreezePolicy(snapshotFreezePolicy);
  }

  return normalizeFreezePolicy(livePlan && typeof livePlan === "object" ? livePlan.freezePolicy : {});
}

function resolveSubscriptionSkipPolicy(subscription, livePlan, {
  context = "skip_policy",
  snapshotFirstReadsEnabled = isPhase1SnapshotFirstReadsEnabled(),
  compatLoggingEnabled = isPhase1CompatLoggingEnabled(),
  loggerOverride = logger,
} = {}) {
  const canonical = isCanonicalSubscriptionContract(subscription);
  const snapshot = getSnapshot(subscription);
  const snapshotSkipPolicy = snapshot
    && snapshot.policySnapshot
    && typeof snapshot.policySnapshot === "object"
    ? snapshot.policySnapshot.skipPolicy
    : null;

  if (canonical && snapshotFirstReadsEnabled && snapshotSkipPolicy) {
    const diagnostics = getSubscriptionContractDiagnostics(subscription, {
      livePlan,
      snapshotFirstReadsEnabled,
    });
    maybeLogContractDiagnostics(subscription, diagnostics, {
      audience: "system",
      context,
      compatLoggingEnabled,
      loggerOverride,
    });
    return normalizeSkipPolicy(snapshotSkipPolicy);
  }

  return normalizeSkipPolicy(livePlan && typeof livePlan === "object" ? livePlan.skipPolicy : {});
}

module.exports = {
  isCanonicalSubscriptionContract,
  isGrandfatheredSubscriptionContract,
  getSubscriptionContractDiagnostics,
  getSubscriptionContractReadView,
  resolveSubscriptionFreezePolicy,
  resolveSubscriptionSkipPolicy,
};
