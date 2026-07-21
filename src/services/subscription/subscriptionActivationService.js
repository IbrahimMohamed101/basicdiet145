const { addDays } = require("date-fns");
const mongoose = require("mongoose");

const Plan = require("../../models/Plan");
const BuilderProtein = require("../../models/BuilderProtein");
const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString } = require("../../utils/date");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { createLocalizedError } = require("../../utils/errorLocalization");
const {
  PHASE1_CONTRACT_VERSION,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../../constants/phase1Contract");
const { consumePromoCodeUsageReservation } = require("../promoCodeService");
const { logger } = require("../../utils/logger");
const { resolveCanonicalPremiumIdentity, resolvePremiumKeyFromName, getPremiumDisplayName } = require("../../utils/subscription/premiumIdentity");
const { getPickupLocationsSetting } = require("./subscriptionFulfillmentSummaryService");
const {
  assertPremiumUpgradeLimit,
  countPremiumItemsQty,
} = require("./premiumUpgradeLimitService");
const {
  buildAddonBalanceRowsFromEntitlements,
} = require("./subscriptionAddonBalanceService");
const {
  cancelSubscriptionDomain,
} = require("./subscriptionCancellationService");
const {
  findActiveSubscriptionsForUser,
} = require("./subscriptionCurrentResolverService");

const SYSTEM_CURRENCY = "SAR";

function normalizeOptionalObjectId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s === "null" || s === "undefined") return null;
  return value;
}

function assertValidPremiumBalanceRows(rows) {
  for (const row of rows || []) {
    if (!row.premiumKey || typeof row.premiumKey !== "string" || !row.premiumKey.trim()) {
      throw new Error("Invalid premiumBalance row: premiumKey is required");
    }
  }
}

function premiumSnapshotName(item = {}, fallbackName = "") {
  if (item.nameI18n && typeof item.nameI18n === "object") {
    return item.nameI18n.en || item.nameI18n.ar || fallbackName || item.name || "";
  }
  return item.name || fallbackName || "";
}

function hasImmutablePremiumSnapshot(item = {}) {
  return Boolean(
    item
      && item.premiumKey
      && Number.isSafeInteger(Number(item.unitExtraFeeHalala))
      && Number(item.unitExtraFeeHalala) >= 0
  );
}

function premiumBalanceRowFromSnapshot(item = {}, qty, purchasedAt = new Date()) {
  const purchasedQty = Number(qty || item.qty || item.purchasedQty || 0);
  const unitExtraFeeHalala = Number(item.unitExtraFeeHalala || 0);
  return {
    configId: normalizeOptionalObjectId(item.configId),
    revision: Number(item.revision || 0),
    proteinId: normalizeOptionalObjectId(item.proteinId),
    premiumKey: item.premiumKey,
    kind: item.kind || "",
    entityType: item.entityType || "premium_meal",
    selectionType: item.selectionType || "",
    sourceType: item.sourceType || "",
    sourceModel: item.sourceModel || "",
    sourceId: item.sourceId || "",
    sourceProductId: item.sourceProductId || "",
    sourceGroupId: item.sourceGroupId || "",
    sourceGroupKey: item.sourceGroupKey || "",
    sourceKey: item.sourceKey || "",
    name: premiumSnapshotName(item),
    nameI18n: item.nameI18n || undefined,
    imageUrl: item.imageUrl || "",
    purchasedQty,
    consumedQty: 0,
    reservedQty: 0,
    remainingQty: purchasedQty,
    unitExtraFeeHalala,
    totalHalala: Number(item.totalHalala || purchasedQty * unitExtraFeeHalala),
    currency: item.currency || SYSTEM_CURRENCY,
    catalogVersion: item.catalogVersion || null,
    purchasedAt: item.purchasedAt ? new Date(item.purchasedAt) : purchasedAt,
  };
}

// Removed isCanonicalCheckoutDraft as the system now assumes a single unified contract model.



async function toCanonicalPremiumBalanceRows(draft) {
  const rows = [];
  for (const item of (draft.premiumItems || [])) {
    if (hasImmutablePremiumSnapshot(item)) {
      rows.push(premiumBalanceRowFromSnapshot(item, Number(item.qty || 0)));
      continue;
    }

    // Normalize proteinId before passing to identity resolver (avoids findById("") errors)
    const normalizedProteinId = normalizeOptionalObjectId(item.proteinId);

    let resolved;
    try {
      resolved = await resolveCanonicalPremiumIdentity({
        proteinId: normalizedProteinId,
        name: item.name,
        premiumKey: item.premiumKey,
      });
    } catch (err) {
      if (item.premiumKey && normalizedProteinId) {
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: normalizedProteinId,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else if (item.premiumKey) {
        // Static item (e.g. custom_premium_salad) has no proteinId
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: null,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else {
        throw err;
      }
    }

    if (!resolved.premiumKey) {
      logger.warn("Activation: premiumKey missing after initial resolution; attempting fallback", {
        proteinId: normalizedProteinId,
        name: item.name,
      });
      // Fallback: try resolving from name if it wasn't already resolved
      resolved.premiumKey = resolved.premiumKey || (typeof resolvePremiumKeyFromName === 'function' ? resolvePremiumKeyFromName(item.name || "") : null);
    }

    if (!resolved.premiumKey) {
      logger.error("Activation (Draft): FAILING to resolve premiumKey for premium item", {
        proteinId: normalizedProteinId,
        name: item.name,
      });
      throw createLocalizedError({
        code: "INVALID_DRAFT_CONTRACT",
        key: "errors.activation.invalidPremiumEntitlement",
        fallbackMessage: `Could not resolve canonical premium identity for ${item.name || normalizedProteinId}`,
      });
    }

    rows.push({
      proteinId: normalizeOptionalObjectId(resolved.canonicalProteinId || normalizedProteinId),
      premiumKey: resolved.premiumKey,
      name: getPremiumDisplayName({ premiumKey: resolved.premiumKey, name: resolved.name || item.name, lang: "en" }),
      purchasedQty: Number(item.qty || 0),
      consumedQty: 0,
      reservedQty: 0,
      remainingQty: Number(item.qty || 0),
      unitExtraFeeHalala: resolved.unitExtraFeeHalala || item.unitExtraFeeHalala || 0,
      totalHalala: Number(item.qty || 0) * Number(resolved.unitExtraFeeHalala || item.unitExtraFeeHalala || 0),
      currency: item.currency || SYSTEM_CURRENCY,
      purchasedAt: new Date(),
    });
  }
  return rows;
}

function normalizeProteinIdForPremiumBalance(proteinId) {
  const s = String(proteinId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(s)) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Invalid premium protein id in checkout contract",
    });
  }
  return new mongoose.Types.ObjectId(s);
}

function premiumBalanceRowSignature(row) {
  const key = String(row && row.premiumKey != null ? row.premiumKey : "");
  const configId = String(row && row.configId != null ? row.configId : "");
  const revision = Number(row && row.revision != null ? row.revision : 0);
  const pid = String(row && row.proteinId != null ? row.proteinId : "");
  const pq = Number(row && row.purchasedQty != null ? row.purchasedQty : 0);
  const rq = Number(row && row.remainingQty != null ? row.remainingQty : 0);
  const unit = Number(row && row.unitExtraFeeHalala != null ? row.unitExtraFeeHalala : 0);
  const cur = String(row && row.currency != null ? row.currency : SYSTEM_CURRENCY);
  return `${key}|${configId}|${revision}|${pid}|${pq}|${rq}|${unit}|${cur}`;
}

function premiumBalanceRowsAreEquivalent(a, b) {
  const aa = (a || []).map(premiumBalanceRowSignature).sort();
  const bb = (b || []).map(premiumBalanceRowSignature).sort();
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

async function toPremiumBalanceRowsFromContractEntitlements(contractSnapshot, lang = "en") {
  const snapshot = contractSnapshot && typeof contractSnapshot === "object" ? contractSnapshot : {};
  const ec = snapshot.entitlementContract && typeof snapshot.entitlementContract === "object"
    ? snapshot.entitlementContract
    : null;
  const items = ec && Array.isArray(ec.premiumItems) ? ec.premiumItems : [];

  const rows = [];
  for (const item of items) {
    const qty = Number(item && item.qty != null ? item.qty : 0);
    if (!Number.isInteger(qty) || qty < 1) {
      throw createLocalizedError({
        code: "INVALID_DRAFT_CONTRACT",
        key: "errors.activation.invalidPremiumEntitlement",
        fallbackMessage: "Invalid premium entitlement quantity in contract",
      });
    }

    if (hasImmutablePremiumSnapshot(item)) {
      rows.push(premiumBalanceRowFromSnapshot(item, qty));
      continue;
    }

    // Normalize proteinId before passing to identity resolver to avoid BuilderProtein.findById("")
    const normalizedProteinId = normalizeOptionalObjectId(item.proteinId);

    let resolved;
    try {
      resolved = await resolveCanonicalPremiumIdentity({
        proteinId: normalizedProteinId,
        name: item.name,
        premiumKey: item.premiumKey,
      });
    } catch (err) {
      if (item.premiumKey && normalizedProteinId) {
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: normalizedProteinId,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else if (item.premiumKey) {
        // Static item (custom_premium_salad) has no proteinId — build a minimal resolved shape
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: null,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else {
        throw err;
      }
    }

    if (!resolved.premiumKey) {
      logger.warn("Activation: premiumKey missing after initial resolution; attempting fallback", {
        proteinId: normalizedProteinId,
        name: item.name,
      });
      // Fallback: try resolving from name if it wasn't already resolved
      resolved.premiumKey = resolved.premiumKey || resolvePremiumKeyFromName(item.name || "");
    }

    if (!resolved.premiumKey) {
      logger.error("Activation: FAILING to resolve premiumKey for premium item", {
        proteinId: normalizedProteinId,
        name: item.name,
      });
      throw createLocalizedError({
        code: "INVALID_DRAFT_CONTRACT",
        key: "errors.activation.invalidPremiumEntitlement",
        fallbackMessage: `Could not resolve canonical premium identity for ${item.name || normalizedProteinId}`,
      });
    }

    rows.push({
      proteinId: normalizeOptionalObjectId(resolved.canonicalProteinId || normalizedProteinId),
      premiumKey: resolved.premiumKey,
      name: getPremiumDisplayName({ premiumKey: resolved.premiumKey, name: resolved.name || item.name, lang: "en" }),
      purchasedQty: qty,
      consumedQty: 0,
      reservedQty: 0,
      remainingQty: qty,
      unitExtraFeeHalala: resolved.unitExtraFeeHalala || item.unitExtraFeeHalala || 0,
      totalHalala: qty * Number(resolved.unitExtraFeeHalala || item.unitExtraFeeHalala || 0),
      currency: String(item.currency || SYSTEM_CURRENCY),
      purchasedAt: new Date(),
    });
  }
  return rows;
}

function assertPremiumBalanceMatchesContractPricing(contractSnapshot, rows) {
  const snapshot = contractSnapshot && typeof contractSnapshot === "object" ? contractSnapshot : {};
  const snapshotPricing = snapshot.pricing && typeof snapshot.pricing === "object" ? snapshot.pricing : {};
  const contractedPremiumTotal = Number(snapshotPricing.premiumTotalHalala || 0);
  const impliedPremiumTotal = (rows || []).reduce(
    (sum, row) => sum + Number(row.purchasedQty || 0) * Number(row.unitExtraFeeHalala || 0),
    0
  );

  if ((rows || []).length > 0 && contractedPremiumTotal !== impliedPremiumTotal) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Premium entitlement rows do not match contract premium total",
    });
  }

  if ((rows || []).length === 0 && contractedPremiumTotal > 0) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Contract charges premium fees but premium entitlements are missing",
    });
  }

  if ((rows || []).length > 0 && contractedPremiumTotal === 0 && impliedPremiumTotal > 0) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Contract premium total is missing while premium entitlements exist",
    });
  }
}

async function resolveActivationPremiumBalanceRows(draft, contractSnapshot) {
  const fromDraft = await toCanonicalPremiumBalanceRows(draft);
  const fromContract = await toPremiumBalanceRowsFromContractEntitlements(contractSnapshot);

  const draftId = draft && draft._id ? String(draft._id) : "unknown";

  if (fromContract.length > 0) {
    logger.info("Activation: using premium balance from contract snapshot", {
      draftId,
      rowCount: fromContract.length,
    });
    if (fromDraft.length > 0 && !premiumBalanceRowsAreEquivalent(fromContract, fromDraft)) {
      logger.warn("Activation: draft premiumItems mismatch with contract entitlements; prioritizing contract", {
        draftId,
        fromContract: JSON.stringify(fromContract),
        fromDraft: JSON.stringify(fromDraft),
      });
    }
    if (contractSnapshot) {
      assertPremiumBalanceMatchesContractPricing(contractSnapshot, fromContract);
    }
    assertValidPremiumBalanceRows(fromContract);
    return fromContract;
  }

  if (fromDraft.length > 0) {
    logger.info("Activation: using premium balance from draft.premiumItems (contract empty/missing)", {
      draftId,
      rowCount: fromDraft.length,
    });
    if (contractSnapshot) {
      assertPremiumBalanceMatchesContractPricing(contractSnapshot, fromDraft);
    }
    assertValidPremiumBalanceRows(fromDraft);
    return fromDraft;
  }

  logger.info("Activation: no premium balance rows found in contract or draft", { draftId });
  return [];
}

function buildCanonicalActivationPayload({ userId, planId, contractVersion, contractMode, contractCompleteness, contractSource, contractHash, contractSnapshot, renewedFromSubscriptionId = null, legacyRuntimeData = {} }) {
  // Validate that we have a contractHash; contractSnapshot may be missing for non-canonical drafts
  if (!contractHash) {
    throw createLocalizedError({ code: "INVALID_DRAFT_CONTRACT", key: "errors.activation.invalidContract", fallbackMessage: "Contract hash is required for activation" });
  }

  // Extract snapshot fields; use empty objects as fallback if contractSnapshot is missing
  const snapshot = (contractSnapshot && typeof contractSnapshot === "object") ? contractSnapshot : {};
  const plan = snapshot.plan || {};
  const pricing = snapshot.pricing || {};
  const legacyDelivery = legacyRuntimeData.delivery && typeof legacyRuntimeData.delivery === "object" ? legacyRuntimeData.delivery : {};
  const delivery = snapshot.delivery || {};
  const legacySlot = legacyDelivery.slot && typeof legacyDelivery.slot === "object" ? legacyDelivery.slot : {};
  const slot = delivery.slot || legacySlot || {};
  
  // Robust start date selection.
  let start = snapshot.start && snapshot.start.resolvedStartDate ? new Date(snapshot.start.resolvedStartDate) : null;
  if (!start && legacyRuntimeData.startDate) {
    start = new Date(legacyRuntimeData.startDate);
  }

  // Robust field selection for non-canonical drafts.
  const daysCount = Number(plan.daysCount || legacyRuntimeData.daysCount || 0);
  const mealsPerDay = Number(plan.mealsPerDay || legacyRuntimeData.mealsPerDay || 0);
  const totalMeals = daysCount * mealsPerDay;

  if (!start || Number.isNaN(start.getTime()) || !Number.isInteger(daysCount) || daysCount < 1 || !Number.isInteger(mealsPerDay) || mealsPerDay < 1 || !Number.isInteger(totalMeals) || totalMeals < 1) {
    throw createLocalizedError({ code: "INVALID_DRAFT_CONTRACT", key: "errors.activation.invalidContractPayload", fallbackMessage: "Cannot activate subscription because of missing or invalid schedule/meal data" });
  }

  const premiumBalanceRows = Array.isArray(legacyRuntimeData.premiumBalance) ? legacyRuntimeData.premiumBalance : [];
  assertValidPremiumBalanceRows(premiumBalanceRows);
  assertPremiumUpgradeLimit({
    premiumUpgradeCount: countPremiumItemsQty(premiumBalanceRows.map((row) => ({ qty: row.purchasedQty }))),
    totalSubscriptionMeals: totalMeals,
  });
  let addonSubscriptions = legacyRuntimeData.addonSubscriptions || [];
  if ((!addonSubscriptions || addonSubscriptions.length === 0) && snapshot.entitlementContract && Array.isArray(snapshot.entitlementContract.addonSubscriptions)) {
    addonSubscriptions = snapshot.entitlementContract.addonSubscriptions;
  }
  const addonBalanceRows = Array.isArray(legacyRuntimeData.addonBalance) && legacyRuntimeData.addonBalance.length > 0
    ? legacyRuntimeData.addonBalance
    : buildAddonBalanceRowsFromEntitlements(addonSubscriptions, { daysCount });
  const end = addDays(start, daysCount - 1);

  const subscriptionPayload = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    planId: planId || plan.planId,
    status: "active",
    startDate: start,
    endDate: end,
    validityEndDate: end,
    totalMeals,
    remainingMeals: totalMeals,
    selectedGrams: Number(plan.selectedGrams || 0),
    selectedMealsPerDay: mealsPerDay,
    basePlanPriceHalala: Number(pricing.basePlanPriceHalala || 0),
    basePlanGrossHalala: Number(pricing.basePlanGrossHalala || pricing.basePlanPriceHalala || 0),
    basePlanNetHalala: Number(pricing.basePlanNetHalala || 0),
    discountHalala: Number(pricing.discountHalala || 0),
    subtotalHalala: Number(pricing.subtotalHalala || 0),
    subtotalBeforeVatHalala: Number(pricing.subtotalBeforeVatHalala || pricing.subtotalHalala || 0),
    vatPercentage: Number(pricing.vatPercentage || 0),
    vatHalala: Number(pricing.vatHalala || 0),
    totalPriceHalala: Number(pricing.totalPriceHalala || pricing.totalHalala || 0),
    checkoutCurrency: pricing.currency ? String(pricing.currency) : SYSTEM_CURRENCY,
    appliedPromo:
      snapshot.promo && typeof snapshot.promo === "object"
        ? {
          promoCodeId: snapshot.promo.promoCodeId || null,
          usageId: null,
          code: String(snapshot.promo.code || ""),
          title: String(snapshot.promo.title || ""),
          description: String(snapshot.promo.description || ""),
          discountType: String(snapshot.promo.discountType || ""),
          discountValue: Number(snapshot.promo.discountValue || 0),
          discountAmountHalala: Number(snapshot.promo.discountAmountHalala || 0),
          message: String(snapshot.promo.message || ""),
        }
        : null,
    premiumBalance: premiumBalanceRows,
    addonSubscriptions,
    addonBalance: addonBalanceRows,
    deliveryMode: (delivery.mode || legacyDelivery.type) === "pickup" ? "pickup" : "delivery",
    deliveryAddress: Object.prototype.hasOwnProperty.call(delivery, "address") ? delivery.address || undefined : (legacyDelivery.address || undefined),
    deliveryWindow: slot.window ? String(slot.window) : undefined,
    deliverySlot: {
      type: slot.type === "pickup" ? "pickup" : ((delivery.mode || legacyDelivery.type) === "pickup" ? "pickup" : "delivery"),
      window: String(slot.window || ""),
      slotId: String(slot.slotId || ""),
      label: String(slot.label || ""),
    },
    deliveryZoneId: delivery.zoneId || legacyDelivery.zoneId || null,
    deliveryZoneName: delivery.zoneName || legacyDelivery.zoneName || "",
    pickupLocationId: String(delivery.pickupLocationId || legacyRuntimeData.delivery?.pickupLocationId || legacyRuntimeData.resolvedPickupLocationId || ""),
    deliveryFeeHalala: Number(pricing.deliveryFeeHalala || 0),
    contractVersion,
    contractMode,
    contractCompleteness,
    contractSource,
    contractHash,
    contractSnapshot,
    renewedFromSubscriptionId: renewedFromSubscriptionId || null,
  };

  logger.info("Activation: built canonical subscription payload", {
    userId: String(userId),
    planId: String(subscriptionPayload.planId),
    premiumBalanceCount: Array.isArray(subscriptionPayload.premiumBalance) ? subscriptionPayload.premiumBalance.length : 0,
    premiumBalancePreview: JSON.stringify(subscriptionPayload.premiumBalance),
  });

  const dayEntries = Array.from({ length: daysCount }, (_, index) => {
    const isFirstDay = index === 0;
    const overrideObj = legacyRuntimeData.delivery?.firstDayFulfillmentOverride || delivery.firstDayFulfillmentOverride;
    const overrideType = overrideObj && typeof overrideObj === "object" ? overrideObj.type : overrideObj;
    const overrideLocId = overrideObj && typeof overrideObj === "object" ? overrideObj.pickupLocationId : null;
    const isPickupOverride = isFirstDay && overrideType === "pickup";
    return {
      date: toKSADateString(addDays(start, index)),
      status: "open",
      fulfillmentModeOverride: isPickupOverride ? "pickup" : null,
      pickupLocationIdOverride: isPickupOverride
        ? String(overrideLocId || delivery.pickupLocationId || legacyRuntimeData.delivery?.pickupLocationId || legacyRuntimeData.resolvedPickupLocationId || "") || null
        : null,
    };
  });
  return { subscriptionPayload, dayEntries };
}

async function buildCanonicalSubscriptionActivationPayload({ draft }) {
  const snapshot = (draft.contractSnapshot && typeof draft.contractSnapshot === "object") ? draft.contractSnapshot : {};
  const snapshotContract = snapshot.contract && typeof snapshot.contract === "object" ? snapshot.contract : {};

  const premiumBalanceRows = await resolveActivationPremiumBalanceRows(draft, draft.contractSnapshot);

  // Auto-resolve pickupLocationId when deliveryMode=pickup but no locationId was captured.
  // Guards against checkouts where the frontend omitted pickupLocationId (single-branch setups).
  const deliveryFromDraft = draft.delivery && typeof draft.delivery === "object" ? draft.delivery : {};
  const deliveryFromSnapshot = snapshot.delivery && typeof snapshot.delivery === "object" ? snapshot.delivery : {};
  const deliveryMode = deliveryFromSnapshot.mode || deliveryFromDraft.type || "";
  const overrideObj = deliveryFromDraft.firstDayFulfillmentOverride;
  const overrideType = overrideObj && typeof overrideObj === "object" ? overrideObj.type : overrideObj;
  const overrideLocId = overrideObj && typeof overrideObj === "object" ? overrideObj.pickupLocationId : null;
  const hasPickupLocationId = !!(deliveryFromSnapshot.pickupLocationId || deliveryFromDraft.pickupLocationId || overrideLocId);
  let resolvedPickupLocationId = null;
  if ((deliveryMode === "pickup" || overrideType === "pickup") && !hasPickupLocationId) {
    try {
      const availableLocations = await getPickupLocationsSetting();
      if (Array.isArray(availableLocations) && availableLocations.length === 1) {
        const loc = availableLocations[0];
        resolvedPickupLocationId = (loc && (loc.id || loc.locationId)) || null;
        if (resolvedPickupLocationId) {
          logger.info("Activation: auto-resolved pickupLocationId from single-location setting", {
            draftId: String(draft._id || ""),
            resolvedPickupLocationId,
          });
        }
      }
    } catch (err) {
      logger.warn("Activation: failed to auto-resolve pickupLocationId", { err: err.message });
    }
  }

  const activationPayload = buildCanonicalActivationPayload({
    userId: draft.userId,
    planId: draft.planId,
    contractVersion: draft.contractVersion || snapshotContract.contractVersion || PHASE1_CONTRACT_VERSION,
    contractMode: draft.contractMode || snapshotContract.contractMode || CONTRACT_MODES[0],
    contractCompleteness: draft.contractCompleteness || snapshotContract.contractCompleteness || CONTRACT_COMPLETENESS_VALUES[0],
    contractSource: draft.contractSource || snapshotContract.contractSource || CONTRACT_SOURCES[0],
    contractHash: draft.contractHash || "legacy-transition",
    contractSnapshot: draft.contractSnapshot || null,
    renewedFromSubscriptionId: draft.renewedFromSubscriptionId || null,
    legacyRuntimeData: {
      premiumBalance: premiumBalanceRows,
      addonSubscriptions: Array.isArray(draft.addonSubscriptions) ? draft.addonSubscriptions : [],
      startDate: draft.startDate,
      daysCount: draft.daysCount,
      mealsPerDay: draft.mealsPerDay,
      delivery: draft.delivery,
      resolvedPickupLocationId,
    },
  });
  if (draft.activationSubscriptionId) {
    activationPayload.subscriptionPayload._id = draft.activationSubscriptionId;
  }
  return activationPayload;
}

function buildCanonicalContractActivationPayload({ userId, planId, contract, legacyRuntimeData = {} }) {
  if (!contract || typeof contract !== "object") {
    const err = new Error("contract is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const renewedFromSubscriptionId = contract.contractSnapshot && contract.contractSnapshot.origin && contract.contractSnapshot.origin.renewedFromSubscriptionId ? contract.contractSnapshot.origin.renewedFromSubscriptionId : null;
  return buildCanonicalActivationPayload({ userId, planId, contractVersion: contract.contractVersion, contractMode: contract.contractMode, contractCompleteness: contract.contractCompleteness, contractSource: contract.contractSource, contractHash: contract.contractHash, contractSnapshot: contract.contractSnapshot, renewedFromSubscriptionId, legacyRuntimeData });
}

function defaultPersistence() {
  return {
    async createSubscription(payload, { session } = {}) {
      const created = await Subscription.create([payload], { session });
      return created[0];
    },
    async countSubscriptionDays(subscriptionId, { session } = {}) {
      return SubscriptionDay.countDocuments({ subscriptionId }).session(session);
    },
    async insertSubscriptionDays(entries, { session } = {}) {
      return SubscriptionDay.insertMany(entries, { session });
    },
    async upsertSubscriptionDays(entries, { session } = {}) {
      if (!entries.length) return { upsertedCount: 0, matchedCount: 0 };
      return SubscriptionDay.bulkWrite(
        entries.map((entry) => ({
          updateOne: {
            filter: { subscriptionId: entry.subscriptionId, date: entry.date },
            update: { $setOnInsert: entry },
            upsert: true,
          },
        })),
        { ordered: false, ...(session ? { session } : {}) }
      );
    },
    async getPlan(planId, { session } = {}) {
      return Plan.findById(planId).session(session).lean();
    },
    async findSubscriptionById(subscriptionId, { session } = {}) {
      return Subscription.findById(subscriptionId).session(session);
    },
    async findPreviousActiveSubscriptions(userId, { session, excludeSubscriptionId } = {}) {
      return findActiveSubscriptionsForUser(userId, {
        session,
        excludeSubscriptionId,
        lean: true,
      });
    },
    async findSuspendedSubscriptionsForReplacement(replacedBySubscriptionId, { session } = {}) {
      return Subscription.find({
        status: "pending_payment",
        replacementState: "switching",
        replacedBySubscriptionId,
      }).session(session);
    },
    async cancelSubscriptionForReplacement({ subscriptionId, actor, session, reason, replacedBySubscriptionId }) {
      return cancelSubscriptionDomain({
        subscriptionId,
        actor,
        session,
        reason,
        replacedBySubscriptionId,
      });
    },
    async suspendActiveSubscriptionForReplacement({ subscriptionId, replacedBySubscriptionId, session, replacedAt }) {
      return Subscription.findOneAndUpdate(
        { _id: subscriptionId, status: "active" },
        {
          $set: {
            status: "pending_payment",
            replacementState: "switching",
            replacedBySubscriptionId,
            replacedAt,
            cancellationReason: "replaced_by_new_subscription",
          },
        },
        { new: true, session }
      );
    },
    async activateStagedSubscription({ subscriptionId, session }) {
      return Subscription.findOneAndUpdate(
        { _id: subscriptionId, status: "pending_payment" },
        { $set: { status: "active", replacementState: "" } },
        { new: true, session }
      );
    },
    async finalizeSuspendedSubscription({ subscriptionId, replacedBySubscriptionId, session, canceledAt }) {
      return Subscription.findOneAndUpdate(
        {
          _id: subscriptionId,
          status: "pending_payment",
          replacementState: "switching",
          replacedBySubscriptionId,
        },
        {
          $set: {
            status: "canceled",
            replacementState: "completed",
            canceledAt,
          },
        },
        { new: true, session }
      );
    },
    async restoreSuspendedSubscription({ subscriptionId, replacedBySubscriptionId, session }) {
      return Subscription.findOneAndUpdate(
        {
          _id: subscriptionId,
          status: "pending_payment",
          replacementState: "switching",
          replacedBySubscriptionId,
        },
        {
          $set: {
            status: "active",
            replacementState: "",
            replacedBySubscriptionId: null,
            replacedAt: null,
            cancellationReason: "",
          },
        },
        { new: true, session }
      );
    },
    async cancelStagedSubscription({ subscriptionId, session, canceledAt }) {
      return Subscription.findOneAndUpdate(
        { _id: subscriptionId, status: "pending_payment", replacementState: { $ne: "switching" } },
        { $set: { status: "canceled", canceledAt, cancellationReason: "activation_failed" } },
        { new: true, session }
      );
    },
    async restageFailedSubscription({ subscriptionId, session }) {
      return Subscription.findOneAndUpdate(
        {
          _id: subscriptionId,
          status: "canceled",
          cancellationReason: "activation_failed",
        },
        {
          $set: {
            status: "pending_payment",
            replacementState: "staged",
            canceledAt: null,
            cancellationReason: "",
          },
        },
        { new: true, session }
      );
    },
  };
}

function isDuplicateActiveSubscriptionError(err) {
  return Boolean(
    err
    && (err.code === 11000 || err.code === 11001)
    && (
      String(err.message || "").includes("userId")
      || (err.keyPattern && err.keyPattern.userId)
      || (err.keyValue && err.keyValue.userId)
    )
  );
}

function createActiveSubscriptionConflictError(err) {
  const conflict = new Error("User already has an active subscription");
  conflict.status = 409;
  conflict.code = "ACTIVE_SUBSCRIPTION_CONFLICT";
  conflict.cause = err;
  return conflict;
}

async function cancelPreviousActiveSubscriptionsForReplacement({
  subscriptionPayload,
  session,
  persistence = defaultPersistence(),
}) {
  const previousSubscriptions = await persistence.findPreviousActiveSubscriptions(subscriptionPayload.userId, {
    session,
    excludeSubscriptionId: subscriptionPayload._id,
  });

  const canceled = [];
  for (const previous of previousSubscriptions) {
    const result = await persistence.cancelSubscriptionForReplacement({
      subscriptionId: previous._id,
      actor: { kind: "system", reason: "subscription_replacement" },
      session,
      reason: "replaced_by_new_subscription",
      replacedBySubscriptionId: subscriptionPayload._id,
    });
    if (!["canceled", "already_canceled"].includes(result && result.outcome)) {
      const err = new Error("Previous active subscription could not be canceled");
      err.status = 409;
      err.code = "SUBSCRIPTION_REPLACEMENT_CANCEL_FAILED";
      err.details = { subscriptionId: String(previous._id), outcome: result && result.outcome };
      throw err;
    }
    canceled.push(result);
  }

  return canceled;
}

function transactionIsAvailable(session) {
  return !session || session.supportsTransactions !== false;
}

async function persistActivatedSubscriptionWithoutTransaction({
  subscriptionPayload,
  dayEntries,
  session,
  persistence,
}) {
  const stagedPayload = {
    ...subscriptionPayload,
    status: "pending_payment",
    replacementState: "staged",
  };
  let subscription;
  let activated = false;
  const suspendedIds = new Set();

  try {
    try {
      subscription = await persistence.createSubscription(stagedPayload, { session });
    } catch (err) {
      if (Number(err && err.code) !== 11000 && Number(err && err.code) !== 11001) throw err;
      subscription = await persistence.findSubscriptionById(subscriptionPayload._id, { session });
      if (!subscription) throw err;
    }

    if (subscription.status === "canceled" && subscription.cancellationReason === "activation_failed") {
      subscription = await persistence.restageFailedSubscription({
        subscriptionId: subscription._id,
        session,
      }) || subscription;
    }
    activated = subscription.status === "active";

    await persistence.upsertSubscriptionDays(
      dayEntries.map((entry) => ({ ...entry, subscriptionId: subscription._id })),
      { session }
    );

    const previouslySuspended = await persistence.findSuspendedSubscriptionsForReplacement(
      subscription._id,
      { session }
    );
    for (const previous of previouslySuspended) suspendedIds.add(String(previous._id));

    // Standalone MongoDB cannot atomically replace two documents. Temporarily
    // move the current active row out of the unique partial index, promote the
    // fully staged paid subscription with a CAS, then finalize the predecessor.
    // A concurrent paid activation repeats the same deterministic switch and
    // the database unique index still guarantees exactly one active row.
    for (let attempt = 0; attempt < 5 && !activated; attempt += 1) {
      const previousSubscriptions = await persistence.findPreviousActiveSubscriptions(
        subscriptionPayload.userId,
        { session, excludeSubscriptionId: subscription._id }
      );
      for (const previous of previousSubscriptions) {
        const replacedAt = new Date();
        const suspended = await persistence.suspendActiveSubscriptionForReplacement({
          subscriptionId: previous._id,
          replacedBySubscriptionId: subscription._id,
          session,
          replacedAt,
        });
        if (suspended) suspendedIds.add(String(previous._id));
      }

      try {
        const promoted = await persistence.activateStagedSubscription({
          subscriptionId: subscription._id,
          session,
        });
        if (promoted) {
          subscription = promoted;
          activated = true;
          break;
        }
      } catch (err) {
        if (!isDuplicateActiveSubscriptionError(err)) throw err;
      }
    }

    if (!activated) {
      throw createActiveSubscriptionConflictError(new Error("Standalone activation CAS did not acquire the active slot"));
    }

    const replacementResults = [];
    for (const subscriptionId of suspendedIds) {
      const finalized = await persistence.finalizeSuspendedSubscription({
        subscriptionId,
        replacedBySubscriptionId: subscription._id,
        session,
        canceledAt: new Date(),
      });
      if (finalized) {
        replacementResults.push({ outcome: "canceled", subscriptionId: String(subscriptionId) });
      }
    }
    subscription.$locals = subscription.$locals || {};
    subscription.$locals.replacedSubscriptions = replacementResults;
    return subscription;
  } catch (err) {
    if (!activated) {
      await persistence.cancelStagedSubscription({
        subscriptionId: subscriptionPayload._id,
        session,
        canceledAt: new Date(),
      }).catch(() => null);

      // Restore only when no competing activation currently owns the unique
      // active slot. CAS + the unique index make this safe under concurrency.
      const activeRows = await persistence.findPreviousActiveSubscriptions(
        subscriptionPayload.userId,
        { session, excludeSubscriptionId: subscriptionPayload._id }
      ).catch(() => []);
      if (!activeRows.length) {
        for (const subscriptionId of suspendedIds) {
          try {
            const restored = await persistence.restoreSuspendedSubscription({
              subscriptionId,
              replacedBySubscriptionId: subscriptionPayload._id,
              session,
            });
            if (restored) break;
          } catch (_) {
            // Another paid activation won the unique active slot.
            break;
          }
        }
      }
    }
    throw err;
  }
}

async function persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence = defaultPersistence(), replaceExistingActive = true }) {
  if (replaceExistingActive && session && !transactionIsAvailable(session)) {
    return persistActivatedSubscriptionWithoutTransaction({
      subscriptionPayload,
      dayEntries,
      session,
      persistence,
    });
  }
  const replacementResults = replaceExistingActive && session
    ? await cancelPreviousActiveSubscriptionsForReplacement({ subscriptionPayload, session, persistence })
    : [];

  let subscription;
  try {
    subscription = await persistence.createSubscription(subscriptionPayload, { session });
  } catch (err) {
    if (isDuplicateActiveSubscriptionError(err)) {
      throw createActiveSubscriptionConflictError(err);
    }
    throw err;
  }
  const existingDays = await persistence.countSubscriptionDays(subscription._id, { session });
  if (!existingDays) {
    await persistence.insertSubscriptionDays(dayEntries.map((entry) => ({ ...entry, subscriptionId: subscription._id })), { session });
  }
  subscription.$locals = subscription.$locals || {};
  subscription.$locals.replacedSubscriptions = replacementResults;
  return subscription;
}

async function activateSubscriptionFromCanonicalDraft({ draft, payment, session, persistence = defaultPersistence() }) {
  const draftId = draft && draft._id ? draft._id : null;
  if (!draftId) {
    const err = new Error("draft is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let draftDoc = session
    ? await CheckoutDraft.findById(draftId).session(session)
    : await CheckoutDraft.findById(draftId);
  if (!draftDoc) {
    const err = new Error("Checkout draft not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (payment && String(payment.status || "").trim().toLowerCase() !== "paid") {
    return { applied: false, reason: "payment_not_paid" };
  }

  if (!draftDoc.activationSubscriptionId) {
    const reservedActivationId = new mongoose.Types.ObjectId();
    const activationIdQuery = CheckoutDraft.findOneAndUpdate(
      {
        _id: draftDoc._id,
        $or: [
          { activationSubscriptionId: null },
          { activationSubscriptionId: { $exists: false } },
        ],
      },
      { $set: { activationSubscriptionId: reservedActivationId } },
      { new: true, ...(session ? { session } : {}) }
    );
    draftDoc = await activationIdQuery
      || (session
        ? await CheckoutDraft.findById(draftDoc._id).session(session)
        : await CheckoutDraft.findById(draftDoc._id));
  }

  const { subscriptionPayload, dayEntries } = await buildCanonicalSubscriptionActivationPayload({ draft: draftDoc });
  const subscription = await persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });

  draftDoc.status = "completed";
  draftDoc.completedAt = new Date();
  draftDoc.paymentId = payment._id;
  draftDoc.providerInvoiceId = payment.providerInvoiceId || draftDoc.providerInvoiceId;
  draftDoc.subscriptionId = subscription._id;
  draftDoc.failureReason = "";
  draftDoc.failedAt = undefined;
  await draftDoc.save({ session });

  const promoUsage = await consumePromoCodeUsageReservation({
    checkoutDraftId: draftDoc._id,
    subscriptionId: subscription._id,
    paymentId: payment && payment._id ? payment._id : null,
    session,
  });
  if (promoUsage && subscription.appliedPromo) {
    subscription.appliedPromo.usageId = promoUsage._id;
    await subscription.save({ session });
  }

  payment.subscriptionId = subscription._id;
  await payment.save({ session });
  return { applied: true, subscriptionId: String(subscription._id) };
}

async function activateSubscriptionFromCanonicalContract({ userId, planId, contract, legacyRuntimeData = {}, session, persistence = defaultPersistence() }) {
  const { subscriptionPayload, dayEntries } = buildCanonicalContractActivationPayload({ userId, planId, contract, legacyRuntimeData });
  if (session) {
    return persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });
  }

  const ownedSession = await startSafeSession();
  let activatedSubscription = null;
  try {
    await ownedSession.withTransaction(async () => {
      activatedSubscription = await persistActivatedSubscription({
        subscriptionPayload,
        dayEntries,
        session: ownedSession,
        persistence,
      });
    });
    return activatedSubscription;
  } finally {
    await ownedSession.endSession();
  }
}

// Removed activatePendingLegacySubscription as the system now uses unified draft-to-subscription activation.


const finalizeRuntime = {
  activateSubscriptionFromCanonicalDraft: (...args) => activateSubscriptionFromCanonicalDraft(...args),
  startSession: () => startSafeSession(),
  findDraftById: (draftId, session) => CheckoutDraft.findById(draftId).session(session),
  findPaymentById: (paymentId, session) => Payment.findById(paymentId).session(session),
};


async function finalizeSubscriptionDraftPaymentFlow({ draft, payment, session }, runtimeOverrides = null) {
  const runtime = runtimeOverrides
    ? { ...finalizeRuntime, ...runtimeOverrides }
    : finalizeRuntime;
  if (!draft) return { applied: false, reason: "draft_not_found" };
  if (!payment) return { applied: false, reason: "payment_not_found" };
  if (String(draft.userId) !== String(payment.userId)) return { applied: false, reason: "draft_user_mismatch" };

  // Every paid activation must use the same atomic replacement path. Some
  // callers (notably the reusable paid-checkout path) do not already own a
  // transaction. Previously those callers created the new subscription
  // without canceling the old active one because replacement was guarded by
  // `session`, which either left duplicate active rows or hit the unique index.
  if (!session) {
    const ownedSession = await runtime.startSession();
    let result;
    try {
      await ownedSession.withTransaction(async () => {
        const [draftInSession, paymentInSession] = await Promise.all([
          runtime.findDraftById(draft._id, ownedSession),
          runtime.findPaymentById(payment._id, ownedSession),
        ]);
        result = await finalizeSubscriptionDraftPaymentFlow(
          { draft: draftInSession, payment: paymentInSession, session: ownedSession },
          runtime
        );
      });
      return result;
    } finally {
      await ownedSession.endSession();
    }
  }

  if (draft.subscriptionId) {
    const existingSub = await Subscription.findById(draft.subscriptionId).session(session);
    if (!existingSub) return { applied: false, reason: "draft_subscription_missing" };
    if (draft.status !== "completed") {
      draft.status = "completed";
      draft.completedAt = draft.completedAt || new Date();
      draft.paymentId = payment._id;
      draft.providerInvoiceId = payment.providerInvoiceId || draft.providerInvoiceId;
      draft.failureReason = "";
      draft.failedAt = undefined;
      await draft.save({ session });
    }
    if (!payment.subscriptionId) {
      payment.subscriptionId = existingSub._id;
      await payment.save({ session });
    }
    return { applied: true, subscriptionId: String(existingSub._id) };
  }

  if (!["pending_payment", "failed", "canceled", "expired"].includes(draft.status)) return { applied: false, reason: `draft_not_recoverable:${draft.status}` };
  
  // Directly activate as there is no longer a separate "legacy" path.
  try {
    return await runtime.activateSubscriptionFromCanonicalDraft({ draft, payment, session });
  } catch (err) {
    if (isDuplicateActiveSubscriptionError(err)) {
      throw createActiveSubscriptionConflictError(err);
    }
    throw err;
  }
}

module.exports = {
  buildCanonicalSubscriptionActivationPayload,
  buildCanonicalContractActivationPayload,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromCanonicalContract,
  cancelPreviousActiveSubscriptionsForReplacement,
  finalizeSubscriptionDraftPaymentFlow,
  persistActivatedSubscription,
  assertValidPremiumBalanceRows,
  isDuplicateActiveSubscriptionError,
};
