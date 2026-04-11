/**
 * @file constants.js
 * @description Centralized constants for the subscription backend
 */

module.exports = {
  SYSTEM_CURRENCY: "SAR",
  STALE_DRAFT_THRESHOLD_MS: 30 * 1000,
  LEGACY_PREMIUM_WALLET_MODE: "legacy_itemized",
  GENERIC_PREMIUM_WALLET_MODE: "generic_v1",
  LEGACY_DAY_PREMIUM_SLOT_PREFIX: "legacy_day_premium_slot_",
  PREMIUM_OVERAGE_DAY_PAYMENT_TYPE: "premium_overage_day",
  ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE: "one_time_addon_day_planning",
  LEGACY_PREMIUM_TOPUP_SUNSET_HTTP_DATE: "Tue, 30 Jun 2026 23:59:59 GMT",
};
