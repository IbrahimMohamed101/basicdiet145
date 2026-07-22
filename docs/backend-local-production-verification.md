# Backend repair verification runbook

This runbook verifies branch `fix/backend-entitlement-lifecycle` without changing Flutter or the Dashboard.

## 1. Select the exact branch and Node version

The project supports Node 20. The repository contains `.nvmrc` and `.npmrc`; `npm ci` now fails on an unsupported Node version instead of continuing with an engine warning.

```bash
nvm install 20
nvm use 20
node --version
npm --version
```

Expected Node output starts with:

```text
v20.
```

Fetch the repair branch and ensure it tracks exactly one upstream branch:

```bash
git fetch origin
git checkout fix/backend-entitlement-lifecycle
git branch --set-upstream-to=origin/fix/backend-entitlement-lifecycle
```

If `git pull --ff-only origin fix/backend-entitlement-lifecycle` reports `Cannot rebase onto multiple branches`, repair only the duplicated local tracking configuration:

```bash
git config --unset-all branch.fix/backend-entitlement-lifecycle.merge || true
git config branch.fix/backend-entitlement-lifecycle.remote origin
git config --add branch.fix/backend-entitlement-lifecycle.merge refs/heads/fix/backend-entitlement-lifecycle
git pull --ff-only
```

Before using `reset --hard`, inspect local work first:

```bash
git status --short
git log --oneline --decorate -5
```

## 2. Install and run isolated tests

These tests use test databases or `mongodb-memory-server`. Do not point their environment variables at production.

```bash
npm ci
npm run test:release-gates
bash scripts/run-pickup-backend-closure-tests.sh
```

Expected result: every command exits with code `0`.

Do not run `npm audit fix --force` as part of verification. It may introduce breaking dependency upgrades. Review production and development dependency findings separately.

## 3. Start the Backend against the intended local/staging database

Use a database copy when possible. Verify the selected database name before starting.

```bash
export NODE_ENV=development
export PORT=3000
export MONGODB_URI='mongodb://.../basicdiet_test_copy'
npm start
```

Do not run test files containing `dropDatabase`, `deleteMany`, seed, reset, migration, backfill, or cleanup logic against the real production database.

## 4. Run the Flutter response contract verifier

The verifier calls GET endpoints only. It does not confirm a day, create a Pickup request, append meals, consume balances, or change operations state.

```bash
export API_BASE_URL='http://127.0.0.1:3000'
export CUSTOMER_TOKEN='customer_access_token'
export SUBSCRIPTION_ID='active_subscription_id'
export BUSINESS_DATE='YYYY-MM-DD'

node scripts/verify-flutter-contract-against-api.js
```

For a Delivery-only account where Pickup endpoints are intentionally unavailable:

```bash
SKIP_PICKUP_CONTRACTS=true node scripts/verify-flutter-contract-against-api.js
```

The contract baseline is:

```text
Basic-Diet/mobile_app@6e1be0b38272160bc377cedf391cf082d0f2abfa
```

A failure prints the exact response path that is incompatible with the current Dart model. The validator rejects scalar coercions that Dart cannot parse, such as a string in a Boolean or integer field.

## 5. Audit real subscription data — read only

This audit has no write mode. It rejects `--apply`, `--execute`, and `--write` and only reads subscriptions, days, Pickup requests, Delivery append operations, and daily add-on operations.

Audit one subscription first:

```bash
export MONGODB_URI='mongodb://.../basicdiet_test_copy'

node scripts/audit-subscription-entitlements.js \
  --subscription-id 'ACTIVE_SUBSCRIPTION_OBJECT_ID' \
  --stale-minutes 5
```

Audit active subscriptions in a database copy:

```bash
node scripts/audit-subscription-entitlements.js \
  --limit 200 \
  --stale-minutes 5
```

Useful optional filters:

```text
--user-id USER_OBJECT_ID
--all-statuses
--fail-on-warning
```

It checks:

```text
totalMeals = remainingMeals + reservedMeals + consumedMeals + forfeitedMeals
purchasedQty = remainingQty + reservedQty + consumedQty
unique base allocation keys
unique active day/slot meal allocations
non-overlapping add-on reservation/consumed/released ledgers
day selection settlement ↔ wallet ledger parity
no consumed add-on before fulfillment
no reserved add-on after fulfillment/skip/cancel/no-show
incomplete Pickup reservations
stale Delivery append and daily add-on operations
```

Exit codes:

- `0`: no integrity errors were found.
- `2`: integrity errors were found, or warnings were found with `--fail-on-warning`; no data was changed.
- `1`: configuration, connection, or execution error.

## 6. Inspect stale operations — dry run

This command is read-only unless `--apply --confirm-safe-recovery` are both provided.

```bash
node scripts/recover-subscription-operations.js \
  --type all \
  --stale-minutes 5 \
  --limit 200
```

Exit codes:

- `0`: no unresolved manual-review rows were found.
- `2`: one or more rows need an idempotent API retry or manual review; no data was changed.
- `1`: configuration, connection, or execution error.

## 7. Apply only provably safe recovery actions

Take a database backup first. Review the dry-run JSON and target one operation where possible.

```bash
node scripts/recover-subscription-operations.js \
  --type append \
  --operation-id 'operation_object_id' \
  --stale-minutes 5 \
  --apply \
  --confirm-safe-recovery
```

The command applies only these conservative actions:

1. Close a stale `started` operation when the day revision and slots prove the operation never changed the day.
2. Finalize an `addons_reserved` append when the exact planner revision, expected slots, meal allocations, and add-on operation states all agree.
3. Finalize a daily add-on operation when the day projection and wallet allocation ledger agree exactly.

It does not automatically compensate revision conflicts, missing days, missing ledgers, `day_saved`, or ambiguous `recovery_required` rows.

## 8. Before/after balance verification

For each real account used in write E2E, record these values before every action:

```text
remainingMeals
reservedMeals
consumedMeals
addonBalance[].remainingQty
addonBalance[].reservedQty
addonBalance[].consumedQty
addonBalance[].reservationKeys
addonBalance[].consumedAllocationKeys
addonBalance[].releasedAllocationKeys
```

Then verify:

```text
purchasedQty = remainingQty + reservedQty + consumedQty
```

Required write E2E sequence on a database copy:

```text
confirm → prepare → ready_for_pickup/ready_for_delivery → fulfill
confirm → skip → unskip/reopen
confirm → cancel
confirm → no_show
append → retry same idempotencyKey
append → retry changed payload with same idempotencyKey
```

Do not claim production completion until these authenticated API flows pass with before/after database evidence.
