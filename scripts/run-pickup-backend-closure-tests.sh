#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV=test

echo "[baseline] running the repository test suite"
npm test

echo "[schema] verifying subscription add-on lifecycle fields are static"
node tests/subscriptionAddonStaticSchemaAuthority.test.js

echo "[composition] verifying fail-closed subscription backend repair installation"
node tests/subscriptionBackendRepairComposition.test.js

echo "[dashboard] verifying nullable menu UI compatibility"
node tests/dashboardMenuUiNullCompatibility.test.js

echo "[audit] verifying read-only entitlement integrity classifications"
node tests/subscriptionEntitlementAuditService.test.js

echo "[pickup] verifying startup installation"
node tests/pickupEntitlementInstaller.test.js

echo "[pickup] verifying incomplete reservation recovery installation"
node tests/pickupRequestRecoveryInstaller.test.js

echo "[pickup] verifying active-claim visibility under corrupted historical state"
node tests/pickupActiveClaimAvailability.test.js

echo "[pickup] verifying nested localized product names"
node tests/pickupLocalizedNameGuard.test.js

echo "[pickup] verifying cyclic ObjectId inputs at the canonical presentation boundary"
node tests/pickupCanonicalObjectIdCoreGuard.test.js

echo "[pickup] verifying same-day multi-cycle reservations, fulfillment, and next-day release"
node tests/pickupMultiCyclePolicy.integration.test.js

echo "[pickup] verifying crash recovery and concurrent idempotent replay"
node tests/pickupRequestRecovery.integration.test.js

echo "[pickup] verifying legacy release crash replay is idempotent"
node tests/subscriptionLegacyMealBalanceOperation.test.js

echo "[pickup] verifying concurrent API idempotency-key replay"
node tests/subscriptionPickupRequestIdempotency.integration.test.js

echo "[pickup] verifying linked days cannot fall back to standalone debit"
node tests/pickupLinkedDayNoFallback.test.js

echo "[pickup] verifying Flutter linked-day requests repair before claiming exact slots"
node tests/pickupLinkedDayMutationGuard.test.js

echo "[pickup] repairing historical aggregate debits into exact linked-day allocations"
node tests/pickupLinkedDayAllocationRepair.test.js

echo "[pickup] upgrading legacy aggregate-only balances without a second debit"
node tests/pickupLegacyEntitlementRepair.test.js

echo "[delivery] verifying append saga installation order"
node tests/subscriptionDeliveryAppendSagaInstaller.test.js

echo "[delivery] verifying idempotency, compensation, payment, and revision conflicts"
node tests/subscriptionDeliveryAppendSaga.test.js

echo "[recovery] verifying only provably safe stale operations can be auto-recovered"
node tests/subscriptionOperationRecoveryService.test.js

echo "[reads] verifying pickup reads never invoke cleanup commands"
node tests/pickupReadOnlyPolicy.test.js

echo "[reads] verifying Ops and reconciliation diagnostics never mutate Mongo state"
node tests/subscriptionReadOnlyQueries.integration.test.js

echo "[addons] verifying final daily add-on runtime composition"
node tests/subscriptionDailyAddonRuntimeComposition.test.js

echo "[addons] verifying daily defaults through the final backend composition"
node tests/runSubscriptionDailyAddonPolicyWithReservation.test.js

echo "[addons] verifying defaults cannot be created after preparation starts"
node tests/subscriptionDailyAddonOperationBoundary.test.js

echo "[addons] verifying explicit customer choices win over daily defaults"
node tests/subscriptionDailyAddonSelectionPreference.test.js

echo "[addons] verifying explicit subscription choices stay reserved until fulfillment"
node tests/subscriptionDailyAddonReservationLifecycle.test.js

echo "[addons] verifying paid or pending explicit choices suppress duplicate daily defaults"
node tests/subscriptionDailyAddonExplicitPriority.test.js

echo "[addons] verifying daily defaults and accumulated wallet spend are separate"
node tests/subscriptionDailyAddonCarryoverAuthority.test.js

echo "[flutter] verifying backend fixtures against current mobile response models"
node tests/flutterMobileResponseContract.test.js

echo "[flutter] rejecting scalar coercions that Dart cannot parse"
node tests/flutterMobileStrictScalarContract.test.js

echo "[pickup] running entitlement, availability, integration, ObjectId, and bilingual contracts"
npm run test:pickup-backend-closure

echo "[pickup] verifying localized mobile errors"
node tests/pickupErrorResponseLocalization.test.js

echo "[pickup] backend closure suite passed"
