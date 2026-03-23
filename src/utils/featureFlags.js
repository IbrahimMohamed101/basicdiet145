function isEnabled(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "true";
}

function isPhase1CanonicalCheckoutDraftWriteEnabled() {
  return isEnabled(process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE);
}

function isPhase1CanonicalDraftActivationEnabled() {
  return isEnabled(process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION);
}

function isPhase1CanonicalAdminCreateEnabled() {
  return isEnabled(process.env.PHASE1_CANONICAL_ADMIN_CREATE);
}

function isPhase1SharedPaymentDispatcherEnabled() {
  return isEnabled(process.env.PHASE1_SHARED_PAYMENT_DISPATCHER);
}

function isPhase1SnapshotFirstReadsEnabled() {
  return isEnabled(process.env.PHASE1_SNAPSHOT_FIRST_READS);
}

function isPhase1CompatLoggingEnabled() {
  return isEnabled(process.env.PHASE1_COMPAT_LOGGING);
}

function isPhase1NonCheckoutPaidIdempotencyEnabled() {
  return isEnabled(process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY);
}

function isPhase2CanonicalDayPlanningEnabled() {
  return isEnabled(process.env.PHASE2_CANONICAL_DAY_PLANNING);
}

function isPhase2GenericPremiumWalletEnabled() {
  return isEnabled(process.env.PHASE2_GENERIC_PREMIUM_WALLET);
}

module.exports = {
  isEnabled,
  isPhase1CanonicalCheckoutDraftWriteEnabled,
  isPhase1CanonicalDraftActivationEnabled,
  isPhase1CanonicalAdminCreateEnabled,
  isPhase1SharedPaymentDispatcherEnabled,
  isPhase1SnapshotFirstReadsEnabled,
  isPhase1CompatLoggingEnabled,
  isPhase1NonCheckoutPaidIdempotencyEnabled,
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
};
