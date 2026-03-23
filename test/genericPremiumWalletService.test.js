const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  GENERIC_PREMIUM_WALLET_MODE,
  LEGACY_PREMIUM_WALLET_MODE,
  isGenericPremiumWalletMode,
  buildGenericPremiumBalanceRows,
  appendGenericPremiumCredits,
  consumeGenericPremiumCredits,
  refundGenericPremiumSelectionRowsOrThrow,
  syncPremiumRemainingFromActivePremiumWallet,
} = require("../src/services/genericPremiumWalletService");

function withWalletIds(rows) {
  return rows.map((row) => ({ _id: new mongoose.Types.ObjectId(), ...row }));
}

test("generic premium wallet builds rows and syncs premiumRemaining", () => {
  const subscription = {
    premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
    genericPremiumBalance: withWalletIds(buildGenericPremiumBalanceRows({
      premiumCount: 3,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      source: "subscription_purchase",
    })),
    premiumRemaining: 0,
  };

  assert.equal(isGenericPremiumWalletMode(subscription), true);
  assert.equal(syncPremiumRemainingFromActivePremiumWallet(subscription), 3);
  assert.equal(subscription.premiumRemaining, 3);
});

test("generic premium wallet consumes FIFO and refunds back to the original row", () => {
  const firstRowId = new mongoose.Types.ObjectId();
  const secondRowId = new mongoose.Types.ObjectId();
  const subscription = {
    premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
    genericPremiumBalance: [
      {
        _id: firstRowId,
        purchasedQty: 2,
        remainingQty: 2,
        unitCreditPriceHalala: 500,
        currency: "SAR",
        purchasedAt: new Date("2026-03-18T08:00:00.000Z"),
      },
      {
        _id: secondRowId,
        purchasedQty: 1,
        remainingQty: 1,
        unitCreditPriceHalala: 500,
        currency: "SAR",
        purchasedAt: new Date("2026-03-19T08:00:00.000Z"),
      },
    ],
    premiumRemaining: 0,
  };

  const consumed = consumeGenericPremiumCredits(subscription, 2);

  assert.equal(consumed.length, 2);
  assert.equal(consumed[0].premiumWalletRowId, String(firstRowId));
  assert.equal(consumed[1].premiumWalletRowId, String(firstRowId));
  assert.equal(subscription.genericPremiumBalance[0].remainingQty, 0);
  assert.equal(subscription.genericPremiumBalance[1].remainingQty, 1);
  assert.equal(subscription.premiumRemaining, 1);

  refundGenericPremiumSelectionRowsOrThrow(subscription, [{
    premiumWalletRowId: String(firstRowId),
  }]);

  assert.equal(subscription.genericPremiumBalance[0].remainingQty, 1);
  assert.equal(subscription.premiumRemaining, 2);
});

test("generic premium wallet appendGenericPremiumCredits keeps legacy mode subscriptions opt-in only", () => {
  const subscription = {
    premiumWalletMode: LEGACY_PREMIUM_WALLET_MODE,
    genericPremiumBalance: [],
    premiumRemaining: 0,
  };

  appendGenericPremiumCredits(subscription, {
    premiumCount: 2,
    unitCreditPriceHalala: 700,
    currency: "SAR",
    source: "topup_payment",
  });

  assert.equal(subscription.premiumWalletMode, GENERIC_PREMIUM_WALLET_MODE);
  assert.equal(subscription.genericPremiumBalance.length, 1);
  assert.equal(subscription.premiumRemaining, 2);
});
