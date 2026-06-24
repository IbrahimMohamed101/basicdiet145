"use strict";

const { ACTIVE_STATUS } = require("./constants");
const { ManualDeductionError } = require("./ManualDeductionError");

function normalizeCount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return NaN;
  return numeric;
}

function resolvePremiumRemaining(subscription) {
  return (Array.isArray(subscription && subscription.premiumBalance) ? subscription.premiumBalance : [])
    .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row && row.remainingQty) || 0)), 0);
}

function resolveBalances(subscription) {
  const totalMeals = Math.max(0, Math.floor(Number(subscription && subscription.totalMeals) || 0));
  const remainingMeals = Math.max(0, Math.floor(Number(subscription && subscription.remainingMeals) || 0));
  const remainingPremiumMeals = resolvePremiumRemaining(subscription);
  const remainingRegularMeals = Math.max(0, remainingMeals - remainingPremiumMeals);
  return {
    totalMeals,
    consumedMeals: Math.max(0, totalMeals - remainingMeals),
    remainingMeals,
    remainingRegularMeals,
    remainingPremiumMeals,
  };
}

function resolveAddonBalances(subscription) {
  if (!subscription || !Array.isArray(subscription.addonBalance)) return [];
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];

  return subscription.addonBalance.map((row) => {
    const entitlement = entitlements.find((entry) => String(entry.addonId) === String(row.addonId));
    const name = entitlement ? (entitlement.name || entitlement.addonPlanName || "") : "";
    const remainingQty = Math.max(0, Math.floor(Number(row.remainingQty) || 0));
    const totalQty = Math.max(0, Math.floor(Number(row.purchasedQty) || 0));
    return {
      addonId: String(row.addonId),
      name,
      remainingQty,
      totalQty,
      consumedQty: Math.max(0, totalQty - remainingQty),
    };
  });
}

function chooseDefaultSubscription(subscriptions, businessDate) {
  const current = subscriptions.find((subscription) => {
    const start = subscription.startDate ? String(subscription.startDate.toISOString()).slice(0, 10) : null;
    const endDate = subscription.validityEndDate || subscription.endDate || null;
    const end = endDate ? String(endDate.toISOString()).slice(0, 10) : null;
    return (!start || start <= businessDate) && (!end || end >= businessDate);
  });
  return current || subscriptions[0] || null;
}

function validateCounts({ regularMeals, premiumMeals, addons }) {
  const regular = normalizeCount(regularMeals);
  const premium = normalizeCount(premiumMeals);

  let validAddons = [];
  let addonsTotal = 0;
  if (addons && Array.isArray(addons)) {
    validAddons = addons.map((addon) => {
      const qty = normalizeCount(addon.qty);
      if (!addon.addonId || qty < 0) {
        throw new ManualDeductionError("INVALID_ADDON_COUNT", "Invalid addon count or missing addonId", 400);
      }
      addonsTotal += qty;
      return { addonId: String(addon.addonId), qty };
    }).filter((addon) => addon.qty > 0);
  }

  if (
    !Number.isInteger(regular)
    || !Number.isInteger(premium)
    || regular < 0
    || premium < 0
    || (regular + premium + addonsTotal) <= 0
  ) {
    throw new ManualDeductionError("INVALID_MEAL_COUNT", "Invalid meal or addon count", 400);
  }
  return { regularMeals: regular, premiumMeals: premium, total: regular + premium, addons: validAddons };
}

function validateSubscriptionCanDeduct(subscription) {
  if (!subscription) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }
  if (subscription.status !== ACTIVE_STATUS) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active", 409);
  }
}

function validateBalances(subscription, counts) {
  const balances = resolveBalances(subscription);
  if (counts.total > balances.remainingMeals) {
    throw new ManualDeductionError("INSUFFICIENT_REMAINING_MEALS", "Not enough remaining meals", 409);
  }
  if (counts.regularMeals > balances.remainingRegularMeals) {
    throw new ManualDeductionError("INSUFFICIENT_REGULAR_MEALS", "Not enough regular meals", 409);
  }
  if (counts.premiumMeals > balances.remainingPremiumMeals) {
    throw new ManualDeductionError("INSUFFICIENT_PREMIUM_MEALS", "Not enough premium meals", 409);
  }

  const addonBalances = resolveAddonBalances(subscription);
  const beforeAddons = [];
  for (const addonRequest of counts.addons) {
    const balance = addonBalances.find((entry) => String(entry.addonId) === String(addonRequest.addonId));
    if (!balance) {
      throw new ManualDeductionError("UNKNOWN_ADDON", `Unknown addon: ${addonRequest.addonId}`, 404);
    }
    if (addonRequest.qty > balance.remainingQty) {
      throw new ManualDeductionError("INSUFFICIENT_ADDON_BALANCE", `Not enough balance for addon: ${addonRequest.addonId}`, 409);
    }
    beforeAddons.push({
      addonId: addonRequest.addonId,
      qty: addonRequest.qty,
      remainingBefore: balance.remainingQty,
    });
  }

  return { ...balances, beforeAddons };
}

function buildPremiumAllocation(subscription, premiumMeals) {
  let remaining = premiumMeals;
  const rows = (Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [])
    .filter((row) => row && row._id && Number(row.remainingQty || 0) > 0)
    .sort((a, b) => {
      const dateA = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const dateB = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      return String(a._id).localeCompare(String(b._id));
    });

  const allocations = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, Math.max(0, Math.floor(Number(row.remainingQty) || 0)));
    if (qty > 0) {
      allocations.push({ rowId: row._id, qty });
      remaining -= qty;
    }
  }
  if (remaining > 0) {
    throw new ManualDeductionError("INSUFFICIENT_PREMIUM_MEALS", "Not enough premium meals", 409);
  }
  return allocations;
}

module.exports = {
  buildPremiumAllocation,
  chooseDefaultSubscription,
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
};
