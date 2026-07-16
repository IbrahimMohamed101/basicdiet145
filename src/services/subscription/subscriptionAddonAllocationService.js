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

  const choiceMap = new Map();
  for (const addonId of requestedAddonIds) {
    if (choiceMap.has(String(addonId))) continue;
    const choice = await resolveChoiceProductById(addonId, { subscription });
    if (choice) choiceMap.set(String(addonId), choice);
  }

  const simulatedRemaining = buildSimulatedAddonRemainingByEntitlement(subscription, day);
  const newSelections = [];

  for (const addonId of requestedAddonIds) {
    const choice = choiceMap.get(String(addonId));
    if (!choice) {
      throw {
        status: 400,
        code: "INVALID_ONE_TIME_ADDON_SELECTION",
        message: `Add-on choice ${String(addonId)} is not an active one-time MenuProduct in an allowed subscription add-on category`,
      };
    }

    const doc = choice.product;
    const category = choice.addonCategory;
    const entitlementContext = resolveAddonEntitlementContext(subscription, {
      productId: doc && doc._id ? doc._id : addonId,
      category,
      preferPositiveRemaining: true,
      remainingQtyByEntitlement: simulatedRemaining,
    });
    const entitlement = entitlementContext ? entitlementContext.entitlement : null;
    const entitlementKey = entitlementContext ? entitlementContext.entitlementKey : null;
    const balanceBucket = entitlementContext ? entitlementContext.bucket : null;
    const existingPaid = (day.addonSelections || []).find(
      (selection) => String(selection.addonId) === String(addonId) && selection.source === "paid"
    );
    if (existingPaid) {
      newSelections.push(existingPaid);
      continue;
    }

    const quantity = 1;
    const productId = doc && doc._id ? doc._id : addonId;
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
      ownedSnapshot: preview.ownedSnapshot,
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
