const LEGACY_PREMIUM_MEAL_BUCKET_ID = "000000000000000000000001";

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : 0;
}

function sumPremiumRemainingFromBalance(balanceRows) {
  if (!Array.isArray(balanceRows)) return 0;
  return balanceRows.reduce(
    (sum, row) => sum + normalizeNonNegativeInteger(row && row.remainingQty),
    0
  );
}

function syncPremiumRemainingFromBalance(subscription) {
  if (!subscription) return 0;
  if (!Array.isArray(subscription.premiumBalance)) {
    subscription.premiumBalance = [];
  }
  const remaining = sumPremiumRemainingFromBalance(subscription.premiumBalance);
  subscription.premiumRemaining = remaining;
  return remaining;
}

function ensureLegacyPremiumBalanceFromRemaining(
  subscription,
  { premiumMealId = LEGACY_PREMIUM_MEAL_BUCKET_ID, unitExtraFeeHalala = 0, currency = "SAR" } = {}
) {
  if (!subscription) return false;
  if (!Array.isArray(subscription.premiumBalance)) {
    subscription.premiumBalance = [];
  }

  const hasWalletRows = subscription.premiumBalance.some(
    (row) =>
      normalizeNonNegativeInteger(row && row.purchasedQty) > 0
      || normalizeNonNegativeInteger(row && row.remainingQty) > 0
  );
  const legacyRemaining = normalizeNonNegativeInteger(subscription.premiumRemaining);
  if (hasWalletRows || legacyRemaining <= 0) {
    return false;
  }

  subscription.premiumBalance.push({
    premiumMealId,
    purchasedQty: legacyRemaining,
    remainingQty: legacyRemaining,
    unitExtraFeeHalala: normalizeNonNegativeInteger(unitExtraFeeHalala),
    currency: String(currency || "SAR").toUpperCase(),
  });
  syncPremiumRemainingFromBalance(subscription);
  return true;
}

module.exports = {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  sumPremiumRemainingFromBalance,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
};
