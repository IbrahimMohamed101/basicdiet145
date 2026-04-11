const STALE_DRAFT_THRESHOLD_MS = 30 * 1000; // 30 seconds - reduced for faster recovery

const { LEGACY_PREMIUM_WALLET_MODE } = require("../utils/premiumWallet");

module.exports = {
  STALE_DRAFT_THRESHOLD_MS,
  LEGACY_PREMIUM_WALLET_MODE,
};