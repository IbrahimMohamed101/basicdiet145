# Subscription Menu / Meal Planner Backend Review

Status: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

## Blocker Review

1. Premium Large Salad v3 Allowlist Enforcement: fixed.
   Evidence: `src/services/subscription/canonicalMealSlotPlannerService.js`, `tests/premiumLargeSaladV3Allowlist.test.js`.

2. Unified Day Payment Contract Hardening: fixed.
   Evidence: `src/services/subscription/unifiedDayPaymentService.js`, `tests/mealPlannerPaymentContract.test.js`.

3. Dashboard Subscription Planner Readiness Check: fixed.
   Evidence: `src/services/dashboardHealthService.js`, `tests/dashboardSubscriptionMenuReadiness.test.js`.

4. Stale Catalog Error Matrix: fixed.
   Evidence: `src/services/subscription/canonicalMealSlotPlannerService.js`, `tests/subscriptionPlannerStaleCatalog.test.js`.

5. Dashboard-to-Flutter Subscription Planner E2E: fixed.
   Evidence: `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js`.

## Remaining Risks

- Production payment verification still needs real Moyasar staging/live verification.
- Environment secrets and callback URLs must be validated outside unit/integration tests.
- Dashboard/Flutter can start against this contract, but final request/response examples should be frozen during contract review.

## Verification Evidence

Passing targeted commands:

```bash
NODE_ENV=test node tests/premiumLargeSaladV3Allowlist.test.js
NODE_ENV=test node tests/mealPlannerPaymentContract.test.js
NODE_ENV=test node tests/dashboardSubscriptionMenuReadiness.test.js
NODE_ENV=test node tests/subscriptionPlannerStaleCatalog.test.js
NODE_ENV=test node tests/subscriptionPlannerDashboardToFlutter.e2e.test.js
```

The broad suite and backend validator should still be run before merge/deploy:

```bash
npm test
npm run validate:backend
```

## Dashboard Meal Builder With Premium Upgrade Support

Status: additive backend implementation added.

Evidence:

- `src/models/MealBuilderConfig.js`
- `src/services/subscription/mealBuilderConfigService.js`
- `src/routes/dashboardMealBuilder.js`
- `src/controllers/dashboard/mealBuilderController.js`
- `src/controllers/mealBuilderController.js`
- `tests/dashboardMealBuilderComposer.test.js`
- `tests/subscriptionMealBuilderContract.test.js`
- `tests/subscriptionMealBuilderValidation.test.js`

Contract decision:

- Flutter uses `GET /api/subscriptions/meal-planner-menu?lang=ar` and reads `plannerCatalog v3`.
- A published Dashboard-authored Meal Builder config is compiled into `plannerCatalog.sections[].products[].optionGroups[].options[]`.
- `GET /api/subscriptions/meal-builder` remains a published-layout read model, not a separate Flutter contract.
- No published builder config means `/meal-builder` returns `MEAL_BUILDER_NOT_PUBLISHED`; current v3 planner validation keeps legacy fallback behavior until a config is published.
- `builderCatalog` and `builderCatalogV2` remain read-only compatibility fields.

Premium review:

- Premium display fields are derived from existing catalog and planner rules.
- Canonical v3 validation remains the authority for premium proteins, premium large salad, balance consumption, payment requirement, and unified day payment.
- Premium large salad allowlist and `extra_protein_50g` rejection remain enforced.

## Meal Builder Seed / Bootstrap Review

Status: opt-in bootstrap support added.

Evidence:

- `scripts/bootstrap/seed-meal-builder.js`
- `scripts/bootstrap/index.js`
- `tests/seedMealBuilderConfig.test.js`
- `tests/bootstrapOrchestrator.test.js`

Bootstrap behavior:

- `MEAL_BUILDER_BOOTSTRAP=true` enables the seed after catalog/plans.
- Default mode creates missing draft/published configs and skips existing admin configs.
- Sync mode requires `MEAL_BUILDER_BOOTSTRAP_SYNC=true` plus `--sync` and updates only bootstrap-owned configs.
- Premium proteins require existing premium keys and positive pricing.
- Premium large salad uses existing pricing service and refuses disallowed proteins or `extra_protein_50g`.
