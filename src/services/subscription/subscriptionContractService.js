const { addDays } = require("date-fns");
const { formatInTimeZone } = require("date-fns-tz");

const {
  KSA_TIMEZONE,
  isOnOrAfterKSADate,
  isValidKSADateString,
} = require("../../utils/date");
const {
  PHASE1_CONTRACT_VERSION,
  PHASE1_CONTRACT_TIMEZONE,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../../constants/phase1Contract");
const { buildContractHash } = require("../idempotencyService");
const {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
} = require("../../utils/premiumWallet");
const {
  buildRecurringAddonEntitlementsFromQuote,
} = require("../recurringAddonService");

function getKsaDateString(date, timezone = PHASE1_CONTRACT_TIMEZONE) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function toKsaMidnightDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`);
}

function normalizePlanName(name) {
  if (name && typeof name === "object") {
    return {
      ar: String(name.ar || ""),
      en: String(name.en || ""),
    };
  }
  const normalized = String(name || "");
  return { ar: normalized, en: normalized };
}

function resolveFreezePolicy(plan) {
  const source = plan && typeof plan.freezePolicy === "object" ? plan.freezePolicy : {};
  return {
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    maxDays: Number.isInteger(source.maxDays) && source.maxDays >= 1 ? source.maxDays : 31,
    maxTimes: Number.isInteger(source.maxTimes) && source.maxTimes >= 0 ? source.maxTimes : 1,
  };
}

function resolveSkipPolicy(plan) {
  const source = plan && typeof plan.skipPolicy === "object" ? plan.skipPolicy : {};
  return {
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    maxDays: Number.isInteger(source.maxDays) && source.maxDays >= 0 ? source.maxDays : 0,
  };
}

function ensureAllowedValue(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    const err = new Error(`Unsupported ${fieldName}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
}

function resolveTomorrowKsaDateString(now, timezone = PHASE1_CONTRACT_TIMEZONE) {
  const currentKsaDate = getKsaDateString(now, timezone);
  const currentKsaMidnight = toKsaMidnightDate(currentKsaDate);
  return getKsaDateString(addDays(currentKsaMidnight, 1), timezone);
}

function resolvePhase1StartDate({ requestedStartDate, now = new Date(), timezone = KSA_TIMEZONE } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    const err = new Error("now must be a valid date");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const tomorrowDateKsa = resolveTomorrowKsaDateString(nowDate, timezone);

  if (requestedStartDate === undefined || requestedStartDate === null || requestedStartDate === "") {
    const resolvedStartDate = toKsaMidnightDate(tomorrowDateKsa);
    return {
      requestedStartDate: null,
      resolvedStartDate,
      resolvedStartDateKSA: tomorrowDateKsa,
      defaultedToTomorrow: true,
      timezone,
    };
  }

  const normalized = String(requestedStartDate).trim();
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const parsed = bareDate ? toKsaMidnightDate(normalized) : new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    const err = new Error("startDate must be a valid date");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const resolvedStartDateKSA = getKsaDateString(parsed, timezone);
  if (!isValidKSADateString(resolvedStartDateKSA) || !isOnOrAfterKSADate(resolvedStartDateKSA, tomorrowDateKsa)) {
    const err = new Error("startDate must be a future date");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  return {
    requestedStartDate: normalized,
    resolvedStartDate: toKsaMidnightDate(resolvedStartDateKSA),
    resolvedStartDateKSA,
    defaultedToTomorrow: false,
    timezone,
  };
}

function cloneAddress(address) {
  if (!address || typeof address !== "object") return null;
  return JSON.parse(JSON.stringify(address));
}

function buildPhase1SubscriptionContract({
  payload = {},
  resolvedQuote,
  actorContext = {},
  source,
  now = new Date(),
  renewalSeed = null,
} = {}) {
  ensureAllowedValue(source, CONTRACT_SOURCES.filter((value) => value !== "legacy_backfill"), "contract source");

  if (!resolvedQuote || typeof resolvedQuote !== "object") {
    const err = new Error("resolvedQuote is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const plan = resolvedQuote.plan && typeof resolvedQuote.plan === "object" ? resolvedQuote.plan : null;
  if (!plan || !plan._id) {
    const err = new Error("resolvedQuote.plan is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const daysCount = Number(plan.daysCount || 0);
  const mealsPerDay = Number(resolvedQuote.mealsPerDay || 0);
  const selectedGrams = Number(resolvedQuote.grams || 0);
  const totalMeals = daysCount * mealsPerDay;
  if (!daysCount || !mealsPerDay || !selectedGrams || !totalMeals) {
    const err = new Error("resolvedQuote must include valid daysCount, grams, and mealsPerDay");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const resolvedStart = resolvePhase1StartDate({
    requestedStartDate:
      payload.startDate !== undefined ? payload.startDate : (resolvedQuote.startDate || null),
    now,
    timezone: PHASE1_CONTRACT_TIMEZONE,
  });

  const breakdown = resolvedQuote.breakdown && typeof resolvedQuote.breakdown === "object"
    ? resolvedQuote.breakdown
    : {};
  const delivery = resolvedQuote.delivery && typeof resolvedQuote.delivery === "object"
    ? resolvedQuote.delivery
    : {};
  const slot = delivery.slot && typeof delivery.slot === "object" ? delivery.slot : {};
  const deliveryMode = delivery.type === "pickup" ? "pickup" : "delivery";
  const premiumWalletMode = resolvedQuote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? GENERIC_PREMIUM_WALLET_MODE
    : LEGACY_PREMIUM_WALLET_MODE;
  const premiumCount = Number(resolvedQuote.premiumCount || 0);
  const premiumUnitPriceHalala = Number(resolvedQuote.premiumUnitPriceHalala || 0);
  const recurringAddons = buildRecurringAddonEntitlementsFromQuote({
    addonItems: resolvedQuote.addonItems || [],
  });

  const contractSnapshot = {
    meta: {
      version: PHASE1_CONTRACT_VERSION,
      capturedAt: new Date(now).toISOString(),
      source,
      mode: CONTRACT_MODES[0],
      completeness: CONTRACT_COMPLETENESS_VALUES[0],
    },
    origin: {
      actorRole: String(actorContext.actorRole || "system"),
      actorUserId: actorContext.actorUserId ? String(actorContext.actorUserId) : null,
      renewedFromSubscriptionId: renewalSeed && renewalSeed.subscriptionId
        ? String(renewalSeed.subscriptionId)
        : null,
      adminOverrideMeta: actorContext.adminOverrideMeta || null,
      deliveryPreferenceSeeded: Boolean(renewalSeed && renewalSeed.deliveryPreference),
    },
    plan: {
      planId: String(plan._id),
      planName: normalizePlanName(plan.name),
      daysCount,
      selectedGrams,
      mealsPerDay,
      totalMeals,
      currency: String(plan.currency || breakdown.currency || "SAR"),
    },
    start: {
      requestedStartDate: resolvedStart.requestedStartDate,
      resolvedStartDate: resolvedStart.resolvedStartDate.toISOString(),
      defaultedToTomorrow: resolvedStart.defaultedToTomorrow,
      timezone: resolvedStart.timezone,
    },
    pricing: {
      basePlanPriceHalala: Number(breakdown.basePlanPriceHalala || 0),
      deliveryFeeHalala: Number(breakdown.deliveryFeeHalala || 0),
      vatPercentage: Number(breakdown.vatPercentage || 0),
      vatHalala: Number(breakdown.vatHalala || 0),
      totalHalala: Number(breakdown.totalHalala || 0),
      currency: String(breakdown.currency || plan.currency || "SAR"),
    },
    delivery: {
      mode: deliveryMode,
      pricingMode: deliveryMode === "pickup" ? "pickup_legacy" : "zone_snapshot",
      seedOnlyFromPreviousPreference: Boolean(renewalSeed && renewalSeed.deliveryPreference),
      slot: {
        type: slot.type === "pickup" ? "pickup" : deliveryMode,
        window: String(slot.window || ""),
        slotId: String(slot.slotId || ""),
      },
      address: cloneAddress(delivery.address),
      zoneId: delivery.zoneId ? String(delivery.zoneId) : null,
      zoneName: delivery.zoneName ? String(delivery.zoneName) : "",
      pickupLocationId: delivery.pickupLocationId ? String(delivery.pickupLocationId) : null,
    },
    policySnapshot: {
      freezePolicy: resolveFreezePolicy(plan),
      skipPolicy: resolveSkipPolicy(plan),
      fallbackMode: "legacy_current",
      premiumAutoConsume: false,
      oneTimeAddonRequiresPaymentBeforeConfirmation: false,
    },
    entitlementContract: {
      premiumWalletMode,
      premiumCount: premiumCount > 0 ? premiumCount : 0,
      premiumUnitPriceHalala: premiumUnitPriceHalala > 0 ? premiumUnitPriceHalala : 0,
      recurringAddons,
    },
    compatibility: {
      usesLegacyPremiumRuntime: premiumWalletMode !== GENERIC_PREMIUM_WALLET_MODE,
      usesLegacyAddonRuntime: true,
      usesLegacyDeliveryRuntime: true,
      usesLegacySkipRuntime: false,
    },
  };

  return {
    contractVersion: PHASE1_CONTRACT_VERSION,
    contractMode: CONTRACT_MODES[0],
    contractCompleteness: CONTRACT_COMPLETENESS_VALUES[0],
    contractSource: source,
    contractHash: buildContractHash({ contractSnapshot }),
    contractSnapshot,
    resolvedQuote,
    resolvedStart,
    derivedFields: {
      daysCount,
      mealsPerDay,
      totalMeals,
    },
  };
}

function buildCanonicalDraftPersistenceFields({ contract } = {}) {
  if (!contract || typeof contract !== "object" || !contract.contractSnapshot || !contract.resolvedStart) {
    const err = new Error("contract is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const renewedFromSubscriptionId = contract.contractSnapshot
    && contract.contractSnapshot.origin
    && contract.contractSnapshot.origin.renewedFromSubscriptionId
    ? String(contract.contractSnapshot.origin.renewedFromSubscriptionId)
    : null;

  return {
    startDate: contract.resolvedStart.resolvedStartDate,
    premiumWalletMode:
      contract.contractSnapshot
      && contract.contractSnapshot.entitlementContract
      && contract.contractSnapshot.entitlementContract.premiumWalletMode
        ? contract.contractSnapshot.entitlementContract.premiumWalletMode
        : LEGACY_PREMIUM_WALLET_MODE,
    premiumCount:
      contract.contractSnapshot
      && contract.contractSnapshot.entitlementContract
      && Number(contract.contractSnapshot.entitlementContract.premiumCount) > 0
        ? Number(contract.contractSnapshot.entitlementContract.premiumCount)
        : 0,
    premiumUnitPriceHalala:
      contract.contractSnapshot
      && contract.contractSnapshot.entitlementContract
      && Number(contract.contractSnapshot.entitlementContract.premiumUnitPriceHalala) > 0
        ? Number(contract.contractSnapshot.entitlementContract.premiumUnitPriceHalala)
        : 0,
    contractVersion: contract.contractVersion,
    contractMode: contract.contractMode,
    contractCompleteness: contract.contractCompleteness,
    contractSource: contract.contractSource,
    contractHash: contract.contractHash,
    contractSnapshot: contract.contractSnapshot,
    renewedFromSubscriptionId,
  };
}

module.exports = {
  resolvePhase1StartDate,
  buildPhase1SubscriptionContract,
  resolveTomorrowKsaDateString,
  buildCanonicalDraftPersistenceFields,
};
