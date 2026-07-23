#!/usr/bin/env bash
set -euo pipefail

run() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

run "Unit baseline" npm test
run "Catalog and validator consistency" npm run test:catalog-validator-consistency
run "Dashboard and mobile menu parity" npm run test:menu-dashboard-mobile-parity
run "Meal Builder dashboard/mobile parity" npm run test:meal-builder-dashboard-mobile-parity
run "Premium salad eligibility" npm run test:premium-salad-eligibility
run "Flutter planner payload compatibility" node tests/flutterMealPlannerPayloadCompatibility.test.js
run "Flutter premium salad legacy payload integration" node tests/flutterPremiumLargeSaladLegacyPayload.integration.test.js
run "Premium salad kitchen snapshot projection" node tests/kitchenPremiumSaladProjectionFallback.test.js
run "Subscription quote and checkout lifecycle" npm run test:checkout
run "Subscription lifecycle and wallet policies" npm run test:subscriptions
run "Meal planner integration" npm run test:integration
run "Mobile API contracts" npm run test:mobile-contracts
run "Canonical builder contract" npm run test:builder-catalog-v2-contract

printf '\nPremium meal backend lifecycle gate: PASS\n'
