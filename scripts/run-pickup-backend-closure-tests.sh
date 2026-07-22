#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV=test

echo "[pickup] verifying startup installation"
node tests/pickupEntitlementInstaller.test.js

echo "[pickup] verifying active-claim visibility under corrupted historical state"
node tests/pickupActiveClaimAvailability.test.js

echo "[pickup] verifying nested localized product names"
node tests/pickupLocalizedNameGuard.test.js

echo "[pickup] verifying same-day multi-cycle reservations, fulfillment, and next-day release"
node tests/pickupMultiCyclePolicy.integration.test.js

echo "[pickup] running entitlement, availability, integration, ObjectId, and bilingual contracts"
npm run test:pickup-backend-closure

echo "[pickup] verifying localized mobile errors"
node tests/pickupErrorResponseLocalization.test.js

echo "[pickup] backend closure suite passed"
