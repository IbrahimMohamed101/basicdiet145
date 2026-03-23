const PHASE1_CONTRACT_VERSION = "subscription_contract.v1";
const PHASE1_CONTRACT_TIMEZONE = "Asia/Riyadh";

const CONTRACT_MODES = ["canonical", "legacy_grandfathered"];
const CONTRACT_COMPLETENESS_VALUES = ["authoritative", "derived_full", "derived_partial", "unavailable"];
const CONTRACT_SOURCES = ["customer_checkout", "admin_create", "renewal", "legacy_backfill"];

const OPERATION_SCOPES = [
  "subscription_checkout",
  "premium_topup",
  "premium_overage_day",
  "one_time_addon_day_planning",
  "addon_topup",
  "one_time_addon",
  "custom_salad_day",
  "custom_meal_day",
];

// P2-S7-S1: Canonical skip policy mode identifier.
// Inert in this slice — exported only; not wired into any contract builder or runtime behavior yet.
const CANONICAL_SKIP_POLICY_MODE = "canonical_v1";

module.exports = {
  PHASE1_CONTRACT_VERSION,
  PHASE1_CONTRACT_TIMEZONE,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
  OPERATION_SCOPES,
  CANONICAL_SKIP_POLICY_MODE,
};
