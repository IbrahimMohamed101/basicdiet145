"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString } = require("../../utils/date");
const {
  ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES,
  normalizeSubscriptionAddonCategory,
  resolveAddonBalanceRemainingQty,
} = require("./subscriptionAddonPolicyService");

const SYSTEM_CURRENCY = "SAR";

function collectAddonCategoriesFromSubscription(subscription) {
  const categories = new Set(ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES);
  for (const row of Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : []) {
    const category = normalizeSubscriptionAddonCategory(row && row.category);
    if (category) categories.add(category);
  }
  for (const row of Array.isArray(subscription && subscription.addonSubscriptions) ? subscription.addonSubscriptions : []) {
    const category = normalizeSubscriptionAddonCategory(row && row.category);
    if (category) categories.add(category);
  }
  return [...categories];
}

function buildAddonBalanceRowsFromEntitlements(addonSubscriptions, { daysCount = 0 } = {}) {
  return (Array.isArray(addonSubscriptions) ? addonSubscriptions : []).map((row) => {
    const quantityPerDay = Math.max(1, Math.floor(Number(row && (row.quantityPerDay || row.purchasedDailyQty) || 1)));
    const includedTotalQty = Math.max(0, Math.floor(Number(
      row && row.includedTotalQty != null ? row.includedTotalQty : Number(daysCount || 0) * quantityPerDay
    )));
    const unitPriceHalala = Number(row && (row.unitPlanPriceHalala != null ? row.unitPlanPriceHalala : row.priceHalala) || 0);
    const extraPurchasedQty = Math.max(0, Math.floor(Number(row && row.extraPurchasedQty || 0)));
    const purchasedQty = includedTotalQty + extraPurchasedQty;
    const addonPlanId = row && (row.addonPlanId || row.addonId);
    const category = normalizeSubscriptionAddonCategory(row && row.category, { allowEmpty: true });
    return {
      addonPlanId,
      addonId: row && (row.addonId || row.addonPlanId),
      entitlementKey: row && row.entitlementKey || `${category || "addon"}:${addonPlanId || ""}`,
      name: row && (row.addonPlanName || row.name || ""),
      category,
      allowanceCategory: normalizeSubscriptionAddonCategory(row && (row.allowanceCategory || row.category), { allowEmpty: true }),
      displayKey: row && (row.displayKey || row.displayCategory) || "",
      displayCategory: row && (row.displayCategory || row.displayKey) || "",
      purchasedDailyQty: quantityPerDay,
      includedTotalQty,
      purchasedQty,
      consumedQty: 0,
      reservedQty: 0,
      remainingQty: purchasedQty,
      extraPurchasedQty,
      overageConsumedQty: 0,
      unitIncludedPriceHalala: unitPriceHalala,
      overageUnitPriceHalala: unitPriceHalala,
      unitPriceHalala,
      currency: row && row.currency || SYSTEM_CURRENCY,
      purchasedAt: new Date(),
    };
  }).filter((row) => row.addonId && row.category);
}

async function resolveSubscriptionAddonBalanceWithAudit(subscription) {
  if (!subscription) return null;
  const auditResult = await SubscriptionDay.aggregate([
    { $match: { subscriptionId: subscription._id, status: { $nin: ["skipped", "frozen", "canceled"] } } },
    { $unwind: "$addonSelections" },
    { $match: { "addonSelections.source": "subscription" } },
    { $group: { _id: "$addonSelections.category", consumed: { $sum: 1 } } },
  ]);

  const auditedConsumptionMap = {};
  for (const row of auditResult) {
    const category = normalizeSubscriptionAddonCategory(row && row._id);
    if (category) auditedConsumptionMap[category] = Number(row.consumed || 0);
  }
  subscription._auditedAddonConsumption = auditedConsumptionMap;
  return auditedConsumptionMap;
}

function resolveEntitlementForBucket(bucket, entitlements) {
  if (!bucket) return null;
  const rows = (Array.isArray(entitlements) ? entitlements : []).filter(Boolean);
  const bucketCategory = normalizeSubscriptionAddonCategory(bucket.category, { allowEmpty: true });
  const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
  const bucketAddonId = String(bucket.addonId || "");
  if (bucketPlanId || bucketAddonId) {
    const identityMatches = rows.filter((entry) => {
      const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
      const entryAddonId = String(entry.addonId || entry.addonPlanId || "");
      return Boolean(bucketPlanId && (entryPlanId === bucketPlanId || entryAddonId === bucketPlanId))
        || Boolean(bucketAddonId && (entryAddonId === bucketAddonId || entryPlanId === bucketAddonId));
    });
    if (identityMatches.length === 1) return identityMatches[0];
  }

  const bucketEntitlementKey = String(bucket.entitlementKey || "").trim();
  if (bucketEntitlementKey) {
    const keyMatches = rows.filter((entry, index) => entitlementIdentity(entry, index).entitlementKey === bucketEntitlementKey);
    if (keyMatches.length === 1) return keyMatches[0];
  }

  const categoryMatches = rows.filter((entry) => {
    const entryCategory = normalizeSubscriptionAddonCategory(
      entry.allowanceCategory || entry.category,
      { allowEmpty: true }
    );
    const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
    return Boolean(bucketCategory && entryCategory === bucketCategory && entryPlanId);
  });
  return categoryMatches.length === 1 ? categoryMatches[0] : null;
}

function buildClientAddonBalance(subscription, businessDate, auditedConsumptionMap = null) {
  if (!subscription) return undefined;

  const isSubscriptionActive = subscription.status === "active";
  const validityEndDateStr = subscription.validityEndDate
    ? toKSADateString(subscription.validityEndDate)
    : (subscription.endDate ? toKSADateString(subscription.endDate) : null);
  const isInsideValidity = !validityEndDateStr || (businessDate && businessDate <= validityEndDateStr);

  const result = {};
  let needsReviewFlag = false;
  const balances = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const auditMap = auditedConsumptionMap || subscription._auditedAddonConsumption || {};

  for (const category of collectAddonCategoriesFromSubscription(subscription)) {
    const categoryBuckets = balances.filter((bucket) => normalizeSubscriptionAddonCategory(bucket && bucket.category) === category);
    if (categoryBuckets.length) {
      const totalUnits = categoryBuckets.reduce((sum, bucket) => {
        const entitlement = resolveEntitlementForBucket(bucket, entitlements);
        return sum + Math.max(Number(bucket.includedTotalQty || 0), Number(entitlement && entitlement.includedTotalQty || 0));
      }, 0);
      const remainingUnits = categoryBuckets.reduce((sum, bucket) => {
        const entitlement = resolveEntitlementForBucket(bucket, entitlements);
        return sum + resolveAddonBalanceRemainingQty(bucket, { entitlement });
      }, 0);
      const consumedUnits = categoryBuckets.reduce((sum, bucket) => sum + Number(bucket.consumedQty || 0), 0);
      result[category] = {
        totalUnits,
        remainingUnits,
        consumedUnits,
        canConsumeNow: isSubscriptionActive && isInsideValidity && remainingUnits > 0,
        unitPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
      };
      continue;
    }

    const entitlement = entitlements.find((entry) => normalizeSubscriptionAddonCategory(entry && entry.category) === category);
    if (entitlement) {
      needsReviewFlag = true;
      result[category] = {
        totalUnits: 0,
        remainingUnits: 0,
        consumedUnits: auditMap[category] || 0,
        canConsumeNow: false,
        unitPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
        missingBalance: true,
      };
    }
  }

  if (needsReviewFlag) {
    Object.defineProperty(result, "addonBalanceNeedsReview", {
      value: true,
      enumerable: false,
    });
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function countReservedAddonSelectionsForCategory(day = {}, category = "") {
  const normalizedCategory = normalizeSubscriptionAddonCategory(category, { allowEmpty: true });
  const selections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  return selections.reduce((sum, selection) => {
    if (!selection || selection.source !== "subscription") return sum;
    if (normalizedCategory && normalizeSubscriptionAddonCategory(selection.category) !== normalizedCategory) return sum;
    return sum + Math.max(1, Math.floor(Number(selection.qty || 1)));
  }, 0);
}

function objectIdString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function normalizeDisplayCategory(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  if (normalized === "desserts") return "dessert";
  if (normalized === "salads") return "salad";
  if (normalized === "juices") return "juice";
  return normalized;
}

function entitlementProductIds(entitlement) {
  const ids = [];
  for (const id of Array.isArray(entitlement && entitlement.menuProductIds) ? entitlement.menuProductIds : []) {
    const normalized = objectIdString(id);
    if (normalized) ids.push(normalized);
  }
  for (const snapshot of Array.isArray(entitlement && entitlement.menuProductsSnapshot)
    ? entitlement.menuProductsSnapshot
    : []) {
    const normalized = objectIdString(snapshot && (snapshot.id || snapshot._id || snapshot.productId));
    if (normalized) ids.push(normalized);
  }
  return [...new Set(ids)];
}

function resolveEntitlementDisplayCategory(entitlement, allowanceCategory) {
  const explicit = normalizeDisplayCategory(
    entitlement && (entitlement.displayCategory || entitlement.categoryKey || entitlement.displayCategoryKey)
  );
  if (explicit) return explicit;

  const snapshotCategories = new Set(
    (Array.isArray(entitlement && entitlement.menuProductsSnapshot) ? entitlement.menuProductsSnapshot : [])
      .map((snapshot) => normalizeDisplayCategory(
        snapshot && (snapshot.categoryKey || snapshot.category || snapshot.itemType)
      ))
      .filter(Boolean)
  );
  if (snapshotCategories.size === 1) return [...snapshotCategories][0];

  const menuCategoryKeys = new Set(
    (Array.isArray(entitlement && entitlement.menuCategoryKeys) ? entitlement.menuCategoryKeys : [])
      .map(normalizeDisplayCategory)
      .filter(Boolean)
  );
  if (menuCategoryKeys.size === 1) return [...menuCategoryKeys][0];

  return allowanceCategory;
}

function entitlementIdentity(entitlement, entitlementIndex) {
  const allowanceCategory = normalizeSubscriptionAddonCategory(
    entitlement && (entitlement.allowanceCategory || entitlement.category),
    { allowEmpty: true }
  );
  const addonPlanId = objectIdString(entitlement && (entitlement.addonPlanId || entitlement.addonId));
  const explicitEntitlementKey = String(entitlement && entitlement.entitlementKey || "").trim();
  return {
    addonPlanId,
    allowanceCategory,
    entitlementKey: explicitEntitlementKey || `${allowanceCategory || "addon"}:${addonPlanId || entitlementIndex}`,
  };
}

function resolveBalanceBucketForEntitlement(entitlement, entitlementIndex, balances) {
  const identity = entitlementIdentity(entitlement, entitlementIndex);
  const rows = Array.isArray(balances) ? balances.filter(Boolean) : [];

  if (identity.addonPlanId) {
    const matches = rows.filter((bucket) => {
      const bucketPlanId = objectIdString(bucket && (bucket.addonPlanId || bucket.addonId));
      return bucketPlanId && bucketPlanId === identity.addonPlanId;
    });
    if (matches.length === 1) return { bucket: matches[0], matchSource: "addonPlanId" };
  }

  if (identity.entitlementKey) {
    const matches = rows.filter((bucket) => {
      const bucketKey = String(bucket && bucket.entitlementKey || "").trim();
      return bucketKey === identity.entitlementKey
        || Boolean(identity.addonPlanId && bucketKey.includes(identity.addonPlanId));
    });
    if (matches.length === 1) return { bucket: matches[0], matchSource: "entitlementKey" };
  }

  const requestedBucketId = objectIdString(entitlement && entitlement.balanceBucketId);
  if (requestedBucketId) {
    const matches = rows.filter((bucket) => objectIdString(bucket && (bucket._id || bucket.balanceBucketId)) === requestedBucketId);
    if (matches.length === 1) return { bucket: matches[0], matchSource: "balanceBucketId" };
  }

  const requestedDisplayKey = normalizeDisplayCategory(
    entitlement && (entitlement.displayKey || entitlement.displayCategory)
  );
  if (requestedDisplayKey) {
    const matches = rows.filter((bucket) => normalizeDisplayCategory(
      bucket && (bucket.displayKey || bucket.displayCategory)
    ) === requestedDisplayKey);
    if (matches.length === 1) return { bucket: matches[0], matchSource: "displayKey" };
  }

  if (identity.allowanceCategory) {
    const matches = rows.filter((bucket) => (
      normalizeSubscriptionAddonCategory(bucket && bucket.category, { allowEmpty: true }) === identity.allowanceCategory
    ));
    if (matches.length === 1) return { bucket: matches[0], matchSource: "category_legacy" };
  }

  return { bucket: null, matchSource: "none" };
}

function countReservedAddonSelectionsForEntitlement(day, entitlement, entitlementIndex, bucket, categoryEntitlementCount) {
  const identity = entitlementIdentity(entitlement, entitlementIndex);
  const bucketId = objectIdString(bucket && (bucket._id || bucket.balanceBucketId));
  const selections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];

  return selections.reduce((sum, selection) => {
    if (!selection || selection.source !== "subscription") return sum;
    const selectionPlanId = objectIdString(selection.addonPlanId);
    const selectionEntitlementKey = String(selection.entitlementKey || "").trim();
    const selectionBucketId = objectIdString(selection.balanceBucketId);

    if (selectionPlanId) {
      if (selectionPlanId !== identity.addonPlanId) return sum;
    } else if (selectionEntitlementKey) {
      if (selectionEntitlementKey !== identity.entitlementKey) return sum;
    } else if (selectionBucketId) {
      if (!bucketId || selectionBucketId !== bucketId) return sum;
    } else {
      const selectionCategory = normalizeSubscriptionAddonCategory(selection.category, { allowEmpty: true });
      if (categoryEntitlementCount !== 1 || selectionCategory !== identity.allowanceCategory) return sum;
    }

    return sum + Math.max(1, Math.floor(Number(selection.qty || selection.quantity || 1)));
  }, 0);
}

function buildAddonSubscriptionAllowances(subscription, day = {}) {
  if (!subscription) return [];

  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const balances = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const entitlementCountsByCategory = entitlements.reduce((counts, entitlement) => {
    const category = normalizeSubscriptionAddonCategory(
      entitlement && (entitlement.allowanceCategory || entitlement.category),
      { allowEmpty: true }
    );
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
    return counts;
  }, new Map());

  return entitlements.filter(Boolean).map((entitlement, entitlementIndex) => {
    const identity = entitlementIdentity(entitlement, entitlementIndex);
    const { bucket, matchSource } = resolveBalanceBucketForEntitlement(entitlement, entitlementIndex, balances);
    const entitlementIncludedTotalQty = Math.max(0, Math.floor(Number(entitlement.includedTotalQty || 0)));
    const includedTotalQty = bucket
      ? Math.max(
        entitlementIncludedTotalQty,
        Math.max(0, Math.floor(Number(bucket.includedTotalQty || 0)))
      )
      : entitlementIncludedTotalQty;
    const remainingBeforeReservation = bucket
      ? resolveAddonBalanceRemainingQty(bucket, { entitlement })
      : includedTotalQty;
    const reservedQty = countReservedAddonSelectionsForEntitlement(
      day,
      entitlement,
      entitlementIndex,
      bucket,
      entitlementCountsByCategory.get(identity.allowanceCategory) || 0
    );
    const rawConsumedQty = bucket
      ? Math.max(0, Math.floor(Number(
        bucket.consumedQty != null ? bucket.consumedQty : includedTotalQty - remainingBeforeReservation
      )))
      : 0;
    const consumedQty = Math.max(0, rawConsumedQty - reservedQty);
    const displayCategory = resolveEntitlementDisplayCategory(entitlement, identity.allowanceCategory);
    const menuProductIds = entitlementProductIds(entitlement);

    return {
      entitlementIndex,
      entitlementKey: identity.entitlementKey,
      addonPlanId: identity.addonPlanId || null,
      addonId: objectIdString(entitlement.addonId || entitlement.addonPlanId) || null,
      addonPlanName: entitlement.addonPlanName || entitlement.name || "",
      category: displayCategory,
      entitlementCategory: identity.allowanceCategory,
      displayCategory,
      allowanceCategory: identity.allowanceCategory,
      balanceBucketId: bucket ? objectIdString(bucket._id || bucket.balanceBucketId) || null : null,
      balanceMatchSource: matchSource,
      includedTotalQty,
      consumedQty,
      reservedQty,
      remainingIncludedQty: Math.max(0, remainingBeforeReservation - reservedQty),
      overageUnitPriceHalala: Math.max(0, Math.floor(Number(
        bucket && bucket.overageUnitPriceHalala != null
          ? bucket.overageUnitPriceHalala
          : bucket && bucket.unitPriceHalala != null
            ? bucket.unitPriceHalala
            : entitlement.unitPriceHalala != null
              ? entitlement.unitPriceHalala
              : entitlement.unitPlanPriceHalala != null
                ? entitlement.unitPlanPriceHalala
                : entitlement.priceHalala || 0
      ))),
      currency: bucket && bucket.currency || entitlement.currency || SYSTEM_CURRENCY,
      choicesCount: menuProductIds.length,
      menuProductIds,
      maxPerDay: Math.max(1, Math.floor(Number(entitlement.maxPerDay || entitlement.quantityPerDay || 1))),
      source: "subscription",
    };
  });
}

function buildAddonCategoryAllowances(subscription, day = {}) {
  if (!subscription) return [];

  const balances = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const entitlementCountsByCategory = entitlements.reduce((counts, entitlement) => {
    const category = normalizeSubscriptionAddonCategory(entitlement && entitlement.category, { allowEmpty: true });
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
    return counts;
  }, new Map());
  const byCategory = new Map();

  for (const entitlement of entitlements) {
    const category = normalizeSubscriptionAddonCategory(entitlement && (entitlement.allowanceCategory || entitlement.category));
    if (!category) continue;
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        category,
        includedTotalQty: 0,
        consumedQty: 0,
        reservedQty: 0,
        remainingIncludedQty: 0,
        overageUnitPriceHalala: Number(entitlement.unitPlanPriceHalala || entitlement.priceHalala || 0),
        currency: entitlement.currency || SYSTEM_CURRENCY,
        hasBalanceBucket: false,
      });
    }
    const row = byCategory.get(category);
    row.includedTotalQty += Math.max(0, Math.floor(Number(entitlement.includedTotalQty || 0)));
    if (!row.overageUnitPriceHalala) {
      row.overageUnitPriceHalala = Number(entitlement.unitPlanPriceHalala || entitlement.priceHalala || 0);
    }
  }

  for (const bucket of balances) {
    const category = normalizeSubscriptionAddonCategory(bucket && bucket.category);
    if (!category) continue;
    const entitlement = resolveEntitlementForBucket(bucket, entitlements);
    const includedTotalQty = Math.max(
      0,
      Math.floor(Number(bucket.includedTotalQty || 0)),
      Math.floor(Number(bucket.purchasedQty || 0)),
      Math.floor(Number(entitlement && entitlement.includedTotalQty || 0))
    );
    const remainingQty = resolveAddonBalanceRemainingQty(bucket, { entitlement });
    const entitlementIndex = entitlement ? entitlements.indexOf(entitlement) : -1;
    const categoryBuckets = balances.filter((candidate) => (
      normalizeSubscriptionAddonCategory(candidate && candidate.category) === category
    ));
    const reservedQty = entitlementIndex >= 0
      ? countReservedAddonSelectionsForEntitlement(
        day,
        entitlement,
        entitlementIndex,
        bucket,
        entitlementCountsByCategory.get(category) || 0
      )
      : (categoryBuckets[0] === bucket ? countReservedAddonSelectionsForCategory(day, category) : 0);
    const rawConsumedQty = Math.max(0, Math.floor(Number(
      bucket.consumedQty != null ? bucket.consumedQty : includedTotalQty - remainingQty
    )));
    const consumedQty = Math.max(0, rawConsumedQty - reservedQty);

    const current = byCategory.get(category) || {
      category,
      includedTotalQty: 0,
      consumedQty: 0,
      reservedQty: 0,
      remainingIncludedQty: 0,
      overageUnitPriceHalala: 0,
      currency: bucket.currency || SYSTEM_CURRENCY,
      hasBalanceBucket: false,
    };
    if (!current.hasBalanceBucket) {
      current.includedTotalQty = 0;
      current.consumedQty = 0;
      current.reservedQty = 0;
      current.remainingIncludedQty = 0;
      current.hasBalanceBucket = true;
    }

    current.includedTotalQty += includedTotalQty;
    current.consumedQty += consumedQty;
    current.reservedQty += reservedQty;
    current.remainingIncludedQty += Math.max(0, remainingQty - reservedQty);
    current.overageUnitPriceHalala = Number(
      bucket.overageUnitPriceHalala != null
        ? bucket.overageUnitPriceHalala
        : bucket.unitPriceHalala || current.overageUnitPriceHalala || 0
    );
    current.currency = bucket.currency || current.currency || SYSTEM_CURRENCY;
    byCategory.set(category, current);
  }

  return Array.from(byCategory.values())
    .map((row) => ({
      category: row.category,
      includedTotalQty: Math.max(0, Math.floor(Number(row.includedTotalQty || 0))),
      consumedQty: Math.max(0, Math.floor(Number(row.consumedQty || 0))),
      reservedQty: Math.max(0, Math.floor(Number(row.reservedQty || 0))),
      remainingIncludedQty: Math.max(0, Math.floor(Number(row.remainingIncludedQty || 0))),
      overageUnitPriceHalala: Math.max(0, Math.floor(Number(row.overageUnitPriceHalala || 0))),
      currency: row.currency || SYSTEM_CURRENCY,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

module.exports = {
  resolveSubscriptionAddonBalanceWithAudit,
  buildClientAddonBalance,
  buildAddonCategoryAllowances,
  buildAddonSubscriptionAllowances,
  buildAddonBalanceRowsFromEntitlements,
};
