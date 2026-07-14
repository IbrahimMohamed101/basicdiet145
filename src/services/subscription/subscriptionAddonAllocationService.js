const {
  resolveAddonChoiceProductById,
} = require("./subscriptionAddonChoicesService");
const {
  buildSimulatedAddonRemainingByEntitlement,
  getAddonEntitlementKey,
  getEligibleAddonEntitlementsForProduct,
} = require("./subscriptionAddonPolicyService");
const {
  resolveAuthoritativeAddonUnitPriceHalala,
} = require("./subscriptionAddonPricingService");

function resolveAddonSelectionName(addonDoc) {
  if (!addonDoc || addonDoc.name == null) return "";
  if (typeof addonDoc.name === "string") return addonDoc.name;
  if (typeof addonDoc.name === "object") {
    return String(addonDoc.name.en || addonDoc.name.ar || "").trim();
  }
  return String(addonDoc.name || "").trim();
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
    const choice = await resolveChoiceProductById(addonId);
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
    const eligibleEntitlements = getEligibleAddonEntitlementsForProduct(subscription, {
      productId: addonId,
      category,
    });
    const selectedMatch = eligibleEntitlements.find(({ entry, index }) => {
      const key = getAddonEntitlementKey(entry, index);
      return Number(simulatedRemaining.get(key) || 0) > 0;
    }) || eligibleEntitlements[0] || null;
    const entitlement = selectedMatch ? selectedMatch.entry : null;
    const entitlementKey = selectedMatch ? getAddonEntitlementKey(selectedMatch.entry, selectedMatch.index) : null;
    let source = "pending_payment";
    let unitPriceHalala = resolveAuthoritativeAddonUnitPriceHalala(doc, { required: !entitlement });
    let priceHalala = unitPriceHalala;

    const existingPaid = (day.addonSelections || []).find(
      (selection) => String(selection.addonId) === String(addonId) && selection.source === "paid"
    );
    if (existingPaid) {
      newSelections.push(existingPaid);
      continue;
    }

    if (entitlement) {
      const remainingQty = simulatedRemaining.get(entitlementKey) || 0;
      if (remainingQty > 0) {
        simulatedRemaining.set(entitlementKey, remainingQty - 1);
        source = "subscription";
        priceHalala = 0;
      } else {
        unitPriceHalala = resolveAuthoritativeAddonUnitPriceHalala(doc, { required: true });
        priceHalala = unitPriceHalala;
      }
    }

    newSelections.push({
      addonId: doc._id,
      addonPlanId: entitlement ? (entitlement.addonPlanId || entitlement.addonId) : null,
      name: resolveAddonSelectionName(doc),
      category,
      source,
      priceHalala,
      unitPriceHalala,
      currency: doc.currency || "SAR",
      consumedAt: new Date(),
    });
  }

  day.addonSelections = newSelections;
}

module.exports = {
  reconcileAddonInclusions,
};
