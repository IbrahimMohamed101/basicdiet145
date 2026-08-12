"use strict";

const mongoose = require("mongoose");

const SubscriptionExtraEntitlementBucket = require(
  "../../models/SubscriptionExtraEntitlementBucket"
);

function authorityError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function text(value) {
  return String(value || "").trim();
}

function key(value) {
  return text(value).toLowerCase();
}

function id(value) {
  return text(value && value._id ? value._id : value);
}

function dateWindow(businessDate) {
  const normalized = text(businessDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw authorityError("INVALID_DATE", "businessDate must use YYYY-MM-DD", 400);
  }
  const start = new Date(`${normalized}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
}

function normalizeAddonRequest(value) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  const structured = Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (prototype === Object.prototype || prototype === null)
  );
  return {
    productId: id(structured
      ? (value.productId || value.menuProductId || value.addonId || value.id)
      : value),
    addonPlanId: id(structured && (value.addonPlanId || value.groupId)),
    balanceBucketId: id(structured && value.balanceBucketId),
    entitlementKey: key(structured && value.entitlementKey),
    category: key(structured && (value.category || value.allowanceCategory || value.displayCategory)),
  };
}

function menuProductIds(bucket) {
  return (Array.isArray(bucket && bucket.metadata && bucket.metadata.menuProductIds)
    ? bucket.metadata.menuProductIds
    : []).map(id).filter(Boolean);
}

function addonBucketMatches(bucket, request) {
  if (!bucket || bucket.kind !== "addon" || !request.productId) return false;
  const productMatches = new Set([
    id(bucket.addonId),
    id(bucket.addonPlanId),
    id(bucket.balanceBucketId),
    ...menuProductIds(bucket),
  ]).has(request.productId);
  if (!productMatches) return false;
  if (request.addonPlanId && id(bucket.addonPlanId) !== request.addonPlanId) return false;
  if (request.balanceBucketId && id(bucket.balanceBucketId) !== request.balanceBucketId) return false;
  if (request.entitlementKey && key(bucket.entitlementKey) !== request.entitlementKey) return false;
  if (request.category && key(bucket.category) !== request.category) return false;
  return true;
}

function canonicalAddonIdentity(bucket) {
  return JSON.stringify({
    addonId: id(bucket.addonId),
    addonPlanId: id(bucket.addonPlanId),
    entitlementKey: key(bucket.entitlementKey),
    category: key(bucket.category),
  });
}

function premiumRowsFromDraft(draft = {}) {
  const bySlot = new Map(
    (Array.isArray(draft.premiumUpgradeSelections) ? draft.premiumUpgradeSelections : [])
      .map((row) => [text(row && (row.baseSlotKey || row.slotKey)), row])
      .filter(([slotKey]) => Boolean(slotKey))
  );
  return (Array.isArray(draft.processedSlots) ? draft.processedSlots : [])
    .filter((slot) => Boolean(slot && (
      slot.isPremium === true
      || ["premium_meal", "premium_large_salad"].includes(text(slot.selectionType))
    )))
    .map((slot) => {
      const slotKey = text(slot.slotKey || `slot_${slot.slotIndex}`);
      const projected = bySlot.get(slotKey) || {};
      return {
        slot,
        projected,
        slotKey,
        premiumKey: key(projected.premiumKey || slot.premiumKey),
      };
    });
}

async function loadEligibleExtraBuckets({ userId, containerSubscriptionId, businessDate, session }) {
  const window = dateWindow(businessDate);
  return SubscriptionExtraEntitlementBucket.find({
    userId,
    containerSubscriptionId,
    applicationState: "applied",
    effectiveStartDate: { $lte: window.end },
    validityEndDate: { $gte: window.start },
  }).sort({ validityEndDate: 1, effectiveStartDate: 1, _id: 1 }).session(session || null).lean();
}

async function resolveStackingExtraSelectionAuthority({
  userId,
  containerSubscriptionId,
  businessDate,
  draft,
  requestedOneTimeAddonIds,
  session = null,
  buckets: suppliedBuckets = null,
} = {}) {
  const buckets = suppliedBuckets || await loadEligibleExtraBuckets({
    userId,
    containerSubscriptionId,
    businessDate,
    session,
  });
  const premiumBuckets = buckets.filter((row) => row.kind === "premium");
  const addonBuckets = buckets.filter((row) => row.kind === "addon");
  const desiredSelections = [];
  const premiumSelections = [];
  const addonSelections = [];

  for (const row of premiumRowsFromDraft(draft)) {
    if (!row.premiumKey) {
      throw authorityError(
        "STACKING_EXTRA_PREMIUM_KEY_REQUIRED",
        "Premium meal selection requires a canonical premiumKey"
      );
    }
    const matches = premiumBuckets.filter((bucket) => key(bucket.premiumKey) === row.premiumKey);
    if (!matches.length) {
      throw authorityError(
        "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT",
        "No eligible stacked Premium entitlement exists for this date",
        422,
        { premiumKey: row.premiumKey }
      );
    }
    const bucket = matches[0];
    desiredSelections.push({ kind: "premium", premiumKey: row.premiumKey, quantity: 1 });
    premiumSelections.push({
      ...row.projected,
      baseSlotKey: row.slotKey,
      proteinId: row.slot.proteinId || row.projected.proteinId || bucket.proteinId || null,
      premiumKey: row.premiumKey,
      configId: bucket.configId || row.projected.configId || null,
      revision: Number(bucket.revision || row.projected.revision || 0),
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      unitExtraFeeHalala: Number(bucket.unitPriceHalala || 0),
      payableTotalHalala: 0,
      currency: bucket.currency || "SAR",
      balanceBucketId: bucket._id,
      premiumWalletRowId: bucket._id,
      premiumSource: "balance",
      source: "subscription",
      consumedAt: null,
    });
  }

  for (const rawRequest of Array.isArray(requestedOneTimeAddonIds)
    ? requestedOneTimeAddonIds
    : []) {
    const request = normalizeAddonRequest(rawRequest);
    if (!request.productId || !mongoose.isValidObjectId(request.productId)) {
      throw authorityError(
        "INVALID_ONE_TIME_ADDON_SELECTION",
        "Add-on selection requires a valid product identity",
        400
      );
    }
    const matches = addonBuckets.filter((bucket) => addonBucketMatches(bucket, request));
    if (!matches.length) {
      throw authorityError(
        "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT",
        "No eligible stacked Add-on entitlement exists for this date",
        422,
        { productId: request.productId }
      );
    }
    if (new Set(matches.map(canonicalAddonIdentity)).size !== 1) {
      throw authorityError(
        "STACKING_EXTRA_ADDON_IDENTITY_AMBIGUOUS",
        "Add-on selection matches conflicting canonical entitlement identities",
        409,
        { productId: request.productId }
      );
    }
    const bucket = matches[0];
    const metadata = bucket.metadata || {};
    desiredSelections.push({
      kind: "addon",
      addonId: bucket.addonId,
      addonPlanId: bucket.addonPlanId,
      entitlementKey: bucket.entitlementKey,
      category: bucket.category,
      quantity: 1,
    });
    addonSelections.push({
      addonId: request.productId,
      productId: request.productId,
      menuProductId: request.productId,
      addonPlanId: bucket.addonPlanId || bucket.addonId,
      addonKey: text(metadata.displayKey),
      productKey: text(metadata.displayKey),
      name: metadata.name || "",
      imageUrl: "",
      category: bucket.category,
      entitlementCategory: bucket.allowanceCategory || bucket.category,
      entitlementKey: bucket.entitlementKey,
      balanceBucketId: bucket.balanceBucketId || bucket._id,
      ownedSnapshot: true,
      available: true,
      active: true,
      availableForNewSale: false,
      selectable: true,
      selectionAvailable: true,
      disabled: false,
      isEligibleForAllowance: true,
      requestedQty: 1,
      includedTotalQty: Number(bucket.purchasedQty || 0),
      remainingQty: Number(bucket.remainingQty || 0),
      freeQtyAvailable: Number(bucket.remainingQty || 0),
      remainingBefore: Number(bucket.remainingQty || 0),
      remainingAfter: Math.max(0, Number(bucket.remainingQty || 0) - 1),
      pricingMode: "allowance_covered",
      maxPerDay: Math.max(1, Number(bucket.purchasedDailyQty || 1)),
      source: "subscription",
      qty: 1,
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      priceHalala: 0,
      unitPriceHalala: Number(bucket.unitPriceHalala || 0),
      payableTotalHalala: 0,
      currency: bucket.currency || "SAR",
      consumedAt: null,
    });
  }

  return { buckets, desiredSelections, premiumSelections, addonSelections };
}

module.exports = {
  addonBucketMatches,
  loadEligibleExtraBuckets,
  normalizeAddonRequest,
  resolveStackingExtraSelectionAuthority,
};
