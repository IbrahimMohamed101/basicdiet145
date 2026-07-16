const {
  resolveAddonChoiceProductById,
} = require("./subscriptionAddonChoicesService");
const {
  buildSimulatedAddonRemainingByEntitlement,
  resolveAddonEntitlementContext,
} = require("./subscriptionAddonPolicyService");
const {
  buildAddonChoicePricingPreview,
} = require("./subscriptionAddonPricingService");
const {
  buildAddonSelectionAvailability,
} = require("./subscriptionAddonAvailabilityService");

function resolveAddonSelectionName(addonDoc) {
  if (!addonDoc || addonDoc.name == null) return "";
  if (typeof addonDoc.name === "string") return addonDoc.name;
  if (typeof addonDoc.name === "object") {
    return String(addonDoc.name.en || addonDoc.name.ar || "").trim();
  }
  return String(addonDoc.name || "").trim();
}

function resolveAddonSelectionNameI18n(addonDoc) {
  if (!addonDoc || !addonDoc.name || typeof addonDoc.name !== "object") return undefined;
  return {
    ar: addonDoc.name.ar || addonDoc.name.en || "",
    en: addonDoc.name.en || addonDoc.name.ar || "",
  };
}

function normalizeRequestedAddonSelection(value) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  const isPlainObject = Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (prototype === Object.prototype || prototype === null));
  const isStructured = Boolean(isPlainObject && (
    value.productId || value.menuProductId || value.addonId || value.id
  ));
  const productId = String(isStructured
    ? (value.productId || value.menuProductId || value.addonId || value.id)
    : (value || "")
  ).trim();
  return {
    productId,
    addonPlanId: isStructured ? String(value.addonPlanId || value.groupId || "").trim() : "",
    balanceBucketId: isStructured ? String(value.balanceBucketId || "").trim() : "",
    entitlementKey: isStructured ? String(value.entitlementKey || "").trim() : "",
    category: isStructured
      ? String(value.displayCategory || value.category || value.allowanceCategory || "").trim()
      : "",
  };
}

function requestedAddonSelectionKey(selection) {
  return [
    selection.productId,
    selection.balanceBucketId,
    selection.addonPlanId,
    selection.entitlementKey,
  ].join(":");
}

async function reconcileAddonInclusions(
  subscription,
  day,
  requestedAddonIds = [],
  { resolveChoiceProductById = resolveAddonChoiceProductById } = {}
) {
  if (!Array.isArray(requestedAddonIds) || requestedAddonIds.length === 0) {
    day.addonSelections = [];
    return;
  }

  const requestedSelections = requestedAddonIds.map(normalizeRequestedAddonSelection);
  const choiceMap = new Map();
  for (const requestedSelection of requestedSelections) {
    const selectionKey = requestedAddonSelectionKey(requestedSelection);
    if (choiceMap.has(selectionKey)) continue;
    const choice = await resolveChoiceProductById(requestedSelection.productId, {
      subscription,
      addonPlanId: requestedSelection.addonPlanId || null,
      balanceBucketId: requestedSelection.balanceBucketId || null,
      entitlementKey: requestedSelection.entitlementKey || null,
      category: requestedSelection.category || null,
    });
    if (choice) choiceMap.set(selectionKey, choice);
  }

  const simulatedRemaining = buildSimulatedAddonRemainingByEntitlement(subscription, day);
  const newSelections = [];

  for (const requestedSelection of requestedSelections) {
    const choice = choiceMap.get(requestedAddonSelectionKey(requestedSelection));
    if (!choice) {
      throw {
        status: 400,
        code: "INVALID_ONE_TIME_ADDON_SELECTION",
        message: `Add-on choice ${requestedSelection.productId} is not an active one-time MenuProduct in an allowed subscription add-on category`,
      };
    }

    const doc = choice.product;
    const category = choice.addonCategory;
    const entitlementContext = choice.ownedResolution || resolveAddonEntitlementContext(subscription, {
      productId: doc && doc._id ? doc._id : requestedSelection.productId,
      category: requestedSelection.category || category,
      addonPlanId: requestedSelection.addonPlanId || null,
      balanceBucketId: requestedSelection.balanceBucketId || null,
      entitlementKey: requestedSelection.entitlementKey || null,
    });
    const entitlement = entitlementContext ? entitlementContext.entitlement : null;
    const entitlementKey = entitlementContext ? entitlementContext.entitlementKey : null;
    const balanceBucket = entitlementContext ? entitlementContext.bucket : null;
    const existingPaid = (day.addonSelections || []).find(
      (selection) => String(selection.addonId) === String(requestedSelection.productId)
        && (!requestedSelection.addonPlanId || String(selection.addonPlanId) === requestedSelection.addonPlanId)
        && selection.source === "paid"
    );
    if (existingPaid) {
      newSelections.push(existingPaid);
      continue;
    }

    const quantity = 1;
    const productId = doc && doc._id ? doc._id : requestedSelection.productId;
    const availableBefore = entitlement ? Number(simulatedRemaining.get(entitlementKey) || 0) : 0;
    const preview = buildAddonChoicePricingPreview({
      subscription,
      entitlement,
      product: doc,
      category,
      addonPlanId: entitlement ? (entitlement.addonPlanId || entitlement.addonId) : null,
      balanceBucketId: balanceBucket && balanceBucket._id,
      entitlementKey,
      quantity,
      remainingQtyOverride: availableBefore,
    });
    if (entitlement) {
      simulatedRemaining.set(entitlementKey, preview.remainingAfter);
    }

    const ownedSnapshot = choice.fromOwnedSnapshot === true;
    const snapshotMissing = choice.snapshotMissing === true;
    const liveCatalogMissing = choice.liveCatalogMissing === true;
    const availability = buildAddonSelectionAvailability({
      product: doc,
      pricing: preview,
      ownedSnapshot: ownedSnapshot || choice.legacyRecovered === true,
      snapshotMissing: snapshotMissing && choice.legacyRecovered !== true,
      liveCatalogMissing,
      availableForNewSale: ownedSnapshot ? false : doc.availableForNewSale !== false,
    });

    newSelections.push({
      addonId: productId,
      productId,
      menuProductId: productId,
      addonPlanId: preview.addonPlanId,
      addonKey: doc.key || "",
      productKey: doc.key || "",
      name: resolveAddonSelectionName(doc),
      nameI18n: resolveAddonSelectionNameI18n(doc),
      imageUrl: doc.imageUrl || "",
      category,
      entitlementCategory: preview.entitlementCategory || "",
      entitlementKey: preview.entitlementKey || "",
      balanceBucketId: preview.balanceBucketId || null,
      ownedSnapshot,
      snapshotMissing,
      liveCatalogMissing,
      legacyRecovered: choice.legacyRecovered === true || preview.legacyRecovered === true,
      legacySourceProductId: choice.legacySourceProductId || preview.legacySourceProductId || null,
      ...availability,
      isEligibleForAllowance: preview.isEligibleForAllowance,
      source: preview.source,
      qty: quantity,
      quantity,
      requestedQty: preview.requestedQty,
      includedTotalQty: preview.includedTotalQty,
      remainingQty: preview.remainingQty,
      freeQtyAvailable: preview.freeQtyAvailable,
      coveredQty: preview.coveredQty,
      paidQty: preview.paidQty,
      remainingBefore: preview.remainingBefore,
      remainingAfter: preview.remainingAfter,
      priceHalala: preview.payableTotalHalala,
      unitPriceHalala: preview.unitPriceHalala,
      payableTotalHalala: preview.payableTotalHalala,
      pricingMode: preview.pricingMode,
      maxPerDay: preview.maxPerDay,
      currency: doc.currency || "SAR",
      consumedAt: new Date(),
    });
  }

  day.addonSelections = newSelections;
}

module.exports = {
  reconcileAddonInclusions,
};
