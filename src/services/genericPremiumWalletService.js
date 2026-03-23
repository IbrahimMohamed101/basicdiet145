const {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
  sumPremiumRemainingFromBalance,
  syncPremiumRemainingFromBalance,
} = require("../utils/premiumWallet");

const SYSTEM_CURRENCY = "SAR";

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : 0;
}

function normalizePremiumWalletMode(entity) {
  return entity && entity.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? GENERIC_PREMIUM_WALLET_MODE
    : LEGACY_PREMIUM_WALLET_MODE;
}

function isGenericPremiumWalletMode(entity) {
  return normalizePremiumWalletMode(entity) === GENERIC_PREMIUM_WALLET_MODE;
}

function ensureGenericPremiumBalanceArray(entity) {
  if (!entity) return [];
  if (!Array.isArray(entity.genericPremiumBalance)) {
    entity.genericPremiumBalance = [];
  }
  return entity.genericPremiumBalance;
}

function sumGenericPremiumRemaining(balanceRows) {
  if (!Array.isArray(balanceRows)) return 0;
  return balanceRows.reduce(
    (sum, row) => sum + normalizeNonNegativeInteger(row && row.remainingQty),
    0
  );
}

function syncPremiumRemainingFromGenericBalance(subscription) {
  if (!subscription) return 0;
  const rows = ensureGenericPremiumBalanceArray(subscription);
  const remaining = sumGenericPremiumRemaining(rows);
  subscription.premiumRemaining = remaining;
  return remaining;
}

function syncPremiumRemainingFromActivePremiumWallet(subscription) {
  if (isGenericPremiumWalletMode(subscription)) {
    return syncPremiumRemainingFromGenericBalance(subscription);
  }
  return syncPremiumRemainingFromBalance(subscription);
}

function getRemainingPremiumCredits(subscription) {
  if (isGenericPremiumWalletMode(subscription)) {
    return sumGenericPremiumRemaining(subscription && subscription.genericPremiumBalance);
  }
  return sumPremiumRemainingFromBalance(subscription && subscription.premiumBalance);
}

function buildGenericPremiumBalanceRows({
  premiumCount,
  unitCreditPriceHalala,
  currency = SYSTEM_CURRENCY,
  source = "purchase",
} = {}) {
  const normalizedQty = normalizeNonNegativeInteger(premiumCount);
  if (normalizedQty <= 0) return [];
  const normalizedUnit = normalizeNonNegativeInteger(unitCreditPriceHalala);
  return [{
    purchasedQty: normalizedQty,
    remainingQty: normalizedQty,
    unitCreditPriceHalala: normalizedUnit,
    currency: String(currency || SYSTEM_CURRENCY).toUpperCase(),
    source: String(source || "purchase"),
  }];
}

function appendGenericPremiumCredits(subscription, options = {}) {
  const rows = ensureGenericPremiumBalanceArray(subscription);
  const createdRows = buildGenericPremiumBalanceRows(options);
  if (!createdRows.length) return [];
  rows.push(...createdRows);
  subscription.premiumWalletMode = GENERIC_PREMIUM_WALLET_MODE;
  syncPremiumRemainingFromGenericBalance(subscription);
  return createdRows;
}

function consumeGenericPremiumCredits(subscription, qty) {
  const rows = ensureGenericPremiumBalanceArray(subscription)
    .filter((row) => normalizeNonNegativeInteger(row && row.remainingQty) > 0)
    .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());

  const requestedQty = normalizeNonNegativeInteger(qty);
  const available = rows.reduce((sum, row) => sum + normalizeNonNegativeInteger(row.remainingQty), 0);
  if (requestedQty <= 0 || available < requestedQty) {
    return null;
  }

  const consumed = [];
  let remaining = requestedQty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAvailable = normalizeNonNegativeInteger(row.remainingQty);
    if (rowAvailable <= 0) continue;
    const used = Math.min(rowAvailable, remaining);
    row.remainingQty = rowAvailable - used;
    remaining -= used;
    for (let index = 0; index < used; index += 1) {
      consumed.push({
        premiumWalletRowId: row && row._id ? String(row._id) : null,
        unitCreditPriceHalala: normalizeNonNegativeInteger(row.unitCreditPriceHalala),
        currency: String(row.currency || SYSTEM_CURRENCY).toUpperCase(),
      });
    }
  }

  syncPremiumRemainingFromGenericBalance(subscription);
  return consumed;
}

function refundGenericPremiumSelectionRowsOrThrow(subscription, selections) {
  const rows = ensureGenericPremiumBalanceArray(subscription);
  for (const selection of Array.isArray(selections) ? selections : []) {
    const walletRowId = selection && selection.premiumWalletRowId ? String(selection.premiumWalletRowId) : "";
    const match = rows.find((row) => row && row._id && String(row._id) === walletRowId);
    if (!match) {
      const err = new Error("Cannot refund premium credits because the original generic wallet row was not found");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    const nextRemainingQty = normalizeNonNegativeInteger(match.remainingQty) + 1;
    const purchasedQty = normalizeNonNegativeInteger(match.purchasedQty);
    if (nextRemainingQty > purchasedQty) {
      const err = new Error("Cannot refund premium credits because refund exceeds purchased quantity");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    match.remainingQty = nextRemainingQty;
  }
  syncPremiumRemainingFromGenericBalance(subscription);
}

module.exports = {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
  normalizePremiumWalletMode,
  isGenericPremiumWalletMode,
  ensureGenericPremiumBalanceArray,
  sumGenericPremiumRemaining,
  syncPremiumRemainingFromGenericBalance,
  syncPremiumRemainingFromActivePremiumWallet,
  getRemainingPremiumCredits,
  buildGenericPremiumBalanceRows,
  appendGenericPremiumCredits,
  consumeGenericPremiumCredits,
  refundGenericPremiumSelectionRowsOrThrow,
};
