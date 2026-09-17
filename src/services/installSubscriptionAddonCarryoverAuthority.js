"use strict";

const pricingService = require("./subscription/subscriptionAddonPricingService");
const balanceService = require("./subscription/subscriptionAddonBalanceService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonCarryoverAuthority.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonCarryoverAuthority.wrapped");

function positiveInt(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function entitlementForAllowance(subscription, row) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const byIndex = Number.isInteger(Number(row && row.entitlementIndex))
    ? entitlements[Number(row.entitlementIndex)]
    : null;
  if (byIndex) return byIndex;

  const key = String(row && row.entitlementKey || "");
  const planId = String(row && row.addonPlanId || "");
  return entitlements.find((entitlement, index) => {
    const entitlementPlanId = String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
    const entitlementKey = String(entitlement && entitlement.entitlementKey || "")
      || `${String(entitlement && (entitlement.allowanceCategory || entitlement.category) || "addon")}:${entitlementPlanId || index}`;
    return Boolean(planId && entitlementPlanId === planId) || Boolean(key && entitlementKey === key);
  }) || null;
}

function decorateAllowance(subscription, row = {}) {
  const entitlement = entitlementForAllowance(subscription, row);
  const defaultDailyQty = positiveInt(
    entitlement && (
      entitlement.quantityPerDay
      || entitlement.purchasedDailyQty
      || entitlement.dailyQuantity
      || entitlement.maxPerDay
    ) || row.defaultDailyQty || row.maxPerDay,
    1
  );
  const walletRemainingQty = nonNegativeInt(
    row.walletRemainingQty != null
      ? row.walletRemainingQty
      : row.remainingIncludedQty != null
        ? row.remainingIncludedQty
        : row.remainingQty,
    0
  );
  const maximumSpendableFromWallet = walletRemainingQty;

  return {
    ...row,
    // Flutter currently parses maxPerDay. Keep it as a compatibility alias while
    // the explicit fields below define the authoritative semantics.
    maxPerDay: Math.max(defaultDailyQty, maximumSpendableFromWallet),
    defaultDailyQty,
    walletRemainingQty,
    maximumSpendableFromWallet,
    pooledCarryoverEnabled: true,
    carryoverPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
  };
}

function installSubscriptionAddonCarryoverAuthority() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  // Restore the pure core implementation after the legacy runtime installer.
  // The core now calculates carryover without mutating entitlement.maxPerDay.
  if (typeof pricingService.buildAddonChoicePricingPreviewCore === "function") {
    pricingService.buildAddonChoicePricingPreview = pricingService.buildAddonChoicePricingPreviewCore;
  }

  const originalAllowances = balanceService.buildAddonSubscriptionAllowances;
  if (typeof originalAllowances === "function" && !originalAllowances[WRAPPED_KEY]) {
    const wrapped = function explicitCarryoverAllowances(subscription, day) {
      return (originalAllowances(subscription, day) || []).map((row) => decorateAllowance(subscription, row));
    };
    wrapped[WRAPPED_KEY] = true;
    balanceService.buildAddonSubscriptionAllowances = wrapped;
  }

  const originalClientBalance = balanceService.buildClientAddonBalance;
  if (typeof originalClientBalance === "function" && !originalClientBalance[WRAPPED_KEY]) {
    const wrapped = function explicitCarryoverClientBalance(subscription, businessDate, auditedConsumptionMap) {
      const result = originalClientBalance(subscription, businessDate, auditedConsumptionMap);
      if (!result || typeof result !== "object") return result;
      const balances = Array.isArray(subscription && subscription.addonBalance)
        ? subscription.addonBalance
        : [];
      return {
        ...result,
        reservedUnits: balances.reduce((sum, row) => sum + nonNegativeInt(row && row.reservedQty, 0), 0),
        pooledCarryoverEnabled: true,
        carryoverPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
        sourceOfTruth: "subscription.addonBalance",
      };
    };
    wrapped[WRAPPED_KEY] = true;
    balanceService.buildClientAddonBalance = wrapped;
  }
}

installSubscriptionAddonCarryoverAuthority();

module.exports = {
  decorateAllowance,
  installSubscriptionAddonCarryoverAuthority,
};
