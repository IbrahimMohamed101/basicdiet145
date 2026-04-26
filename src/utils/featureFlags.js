function isEnabled(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "true";
}

function isPhase1CanonicalCheckoutDraftWriteEnabled() {
  return true;
}

function isPhase1CanonicalDraftActivationEnabled() {
  return true;
}

function isPhase1CanonicalAdminCreateEnabled() {
  return true;
}

function isPhase1SharedPaymentDispatcherEnabled() {
  return true;
}

function isPhase1SnapshotFirstReadsEnabled() {
  return true;
}

function isPhase1CompatLoggingEnabled() {
  return false;
}

function isPhase1NonCheckoutPaidIdempotencyEnabled() {
  return true;
}

function isPhase2CanonicalDayPlanningEnabled() {
  return true;
}

function isPhase2GenericPremiumWalletEnabled() {
  return false; // User requested "no generic premium wallet"
}

module.exports = {
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

