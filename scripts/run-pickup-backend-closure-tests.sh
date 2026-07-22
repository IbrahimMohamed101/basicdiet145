#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV=test

echo "[pickup] verifying startup installation"
node tests/pickupEntitlementInstaller.test.js

echo "[pickup] verifying incomplete reservation recovery installation"
node tests/pickupRequestRecoveryInstaller.test.js

echo "[pickup] verifying active-claim visibility under corrupted historical state"
node tests/pickupActiveClaimAvailability.test.js

echo "[pickup] verifying nested localized product names"
node tests/pickupLocalizedNameGuard.test.js

echo "[pickup] verifying same-day multi-cycle reservations, fulfillment, and next-day release"
node tests/pickupMultiCyclePolicy.integration.test.js

echo "[pickup] verifying crash recovery and concurrent idempotent replay"
node tests/pickupRequestRecovery.integration.test.js

echo "[pickup] verifying linked days cannot fall back to standalone debit"
node tests/pickupLinkedDayNoFallback.test.js

echo "[addons] verifying final daily add-on runtime composition"
node tests/subscriptionDailyAddonRuntimeComposition.test.js

echo "[addons] verifying daily defaults through the final backend composition"
node tests/runSubscriptionDailyAddonPolicyWithReservation.test.js

echo "[addons] verifying explicit customer choices win over daily defaults"
node tests/subscriptionDailyAddonSelectionPreference.test.js

echo "[addons] verifying explicit subscription choices stay reserved until fulfillment"
node tests/subscriptionDailyAddonReservationLifecycle.test.js

echo "[addons] verifying paid or pending explicit choices suppress duplicate daily defaults"
node tests/subscriptionDailyAddonExplicitPriority.test.js

echo "[pickup] running entitlement, availability, integration, ObjectId, and bilingual contracts"
npm run test:pickup-backend-closure

echo "[pickup] verifying localized mobile errors"
node tests/pickupErrorResponseLocalization.test.js

echo "[pickup] backend closure suite passed"
