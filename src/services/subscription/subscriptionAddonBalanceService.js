"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString } = require("../../utils/date");
const {
  SUBSCRIPTION_ADDON_CATEGORIES,
  normalizeSubscriptionAddonCategory,
} = require("./subscriptionAddonPolicyService");

const SYSTEM_CURRENCY = "SAR";

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
      name: row && (row.addonPlanName || row.name || ""),
      category,
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

  for (const category of SUBSCRIPTION_ADDON_CATEGORIES) {
    const categoryBuckets = balances.filter((bucket) => normalizeSubscriptionAddonCategory(bucket && bucket.category) === category);
    if (categoryBuckets.length) {
      const totalUnits = categoryBuckets.reduce((sum, bucket) => sum + Number(bucket.includedTotalQty || 0), 0);
      const remainingUnits = categoryBuckets.reduce((sum, bucket) => sum + Math.max(0, Number(bucket.remainingQty || 0)), 0);
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

function buildAddonCategoryAllowances(subscription, day = {}) {
  if (!subscription) return [];

  const balances = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const byCategory = new Map();

  for (const entitlement of entitlements) {
    const category = normalizeSubscriptionAddonCategory(entitlement && entitlement.category);
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
    const includedTotalQty = Math.max(0, Math.floor(Number(
      bucket.includedTotalQty != null ? bucket.includedTotalQty : bucket.purchasedQty || 0
    )));
    const remainingQty = Math.max(0, Math.floor(Number(bucket.remainingQty || 0)));
    const reservedQty = countReservedAddonSelectionsForCategory(day, category);
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
    current.remainingIncludedQty += Math.max(0, includedTotalQty - consumedQty - reservedQty);
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
  buildAddonBalanceRowsFromEntitlements,
};
