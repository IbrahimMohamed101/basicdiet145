# Subscription Stacking — Safe Staging Runbook

> This runbook is intentionally non-production. The current code hard-blocks
> `SUBSCRIPTION_STACKING_SHADOW_ENABLED=true`,
> `SUBSCRIPTION_STACKING_READ_ENABLED=true`, or
> `SUBSCRIPTION_STACKING_WRITE_ENABLED=true` in production-like environments.

## 1. Preconditions

Do not start a remote write test until all conditions are true:

- The deployment uses the feature branch:
  `feat/subscription-stacking-phase-0-1-20260806`.
- MongoDB is a dedicated staging database and is not the production database.
- A fresh database backup/snapshot exists.
- Payment mode is `sandbox`, `mock`, or `test` only.
- Moyasar production credentials and production webhook URL are not present.
- The staging base URL is not either production host:
  - `basicdiet145-production-51e9.up.railway.app`
  - `clientdashbourd-production.up.railway.app`
- A dedicated staging mobile user is available.
- The user ID is known before configuring the allowlists.
- Premium items and add-ons are removed from the staging purchase scenario.
- Direct pickup reservation, freeze, cancellation, and skip range are not used.
- `STAGING_DATABASE_ISOLATION_CONFIRMED=true` is set only after database separation is verified.
- `STAGING_PAYMENT_SANDBOX_CONFIRMED=true` is set only after provider sandbox/mock mode is verified.

Stop immediately if database isolation or payment mode cannot be proven.

The application runtime uses these rollout variables exactly:

```text
SUBSCRIPTION_STACKING_SHADOW_USER_IDS
SUBSCRIPTION_STACKING_USER_IDS
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS
```

Do not use these obsolete aliases; the readiness validator rejects them:

```text
SUBSCRIPTION_STACKING_READ_USER_IDS
SUBSCRIPTION_STACKING_WRITE_USER_IDS
SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE
```

## 2. First deployment — everything closed

Deploy with:

```text
SUBSCRIPTION_STACKING_SHADOW_ENABLED=false
SUBSCRIPTION_STACKING_READ_ENABLED=false
SUBSCRIPTION_STACKING_WRITE_ENABLED=false
SUBSCRIPTION_STACKING_SHADOW_USER_IDS=
SUBSCRIPTION_STACKING_USER_IDS=
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=false
```

Required checks:

- Server starts normally.
- Existing current-subscription response is unchanged.
- Existing timeline response is unchanged.
- Existing selection, pickup, delivery, accounting, and payment flows are unchanged.
- No `SubscriptionEntitlementBatch`, blueprint, allocation, or compensation rows are created.

## 3. Shadow-only deployment

Configure one test user:

```text
SUBSCRIPTION_STACKING_SHADOW_ENABLED=true
SUBSCRIPTION_STACKING_READ_ENABLED=false
SUBSCRIPTION_STACKING_WRITE_ENABLED=false
SUBSCRIPTION_STACKING_SHADOW_USER_IDS=<TEST_USER_ID>
SUBSCRIPTION_STACKING_USER_IDS=
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=false
```

Check logs for:

```text
projection_match
projection_mismatch
invalid_balance
missing_batch
duplicate_batch
```

No response or database mutation is allowed in this phase.

## 4. Read-only allowlist

Configure:

```text
SUBSCRIPTION_STACKING_SHADOW_ENABLED=true
SUBSCRIPTION_STACKING_READ_ENABLED=true
SUBSCRIPTION_STACKING_WRITE_ENABLED=false
SUBSCRIPTION_STACKING_SHADOW_USER_IDS=<TEST_USER_ID>
SUBSCRIPTION_STACKING_USER_IDS=<TEST_USER_ID>
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=false
```

The test user does not have batches yet, so the API must continue to return the
legacy response. Verify there is no added latency or unexpected database error.

## 5. Single-user staging write

Only after phases 2–4 pass:

```text
NODE_ENV=staging
STAGING_DATABASE_ISOLATION_CONFIRMED=true
STAGING_PAYMENT_SANDBOX_CONFIRMED=true
SUBSCRIPTION_STACKING_SHADOW_ENABLED=true
SUBSCRIPTION_STACKING_READ_ENABLED=true
SUBSCRIPTION_STACKING_WRITE_ENABLED=true
SUBSCRIPTION_STACKING_SHADOW_USER_IDS=<TEST_USER_ID>
SUBSCRIPTION_STACKING_USER_IDS=<TEST_USER_ID>
SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=false
```

Never use `*` in either allowlist.

Before starting the server, run:

```text
node scripts/validate-subscription-stacking-staging-env.js
```

Do not continue unless it returns `"ok": true`.

## 6. Acceptance scenario A — overlapping packages

Initial state:

```text
Current package: 3 meals/day, 200 g
Current remaining balance: 20 meals
New package: 26 days × 2 meals/day, 150 g
New package start date: current business date
```

Expected database state after one successful sandbox payment:

- Exactly one active parent `Subscription`.
- Exactly one legacy entitlement batch.
- Exactly one purchase entitlement batch.
- Legacy batch remaining balance is 20 before planning.
- Purchase batch remaining balance is 52 before planning.
- Payment and checkout draft point to the parent subscription.
- Repeating payment verification or webhook does not create another batch.

Expected API state:

```text
remainingMeals = 72
requiredMeals for overlapping day = 5
```

Expected slot blueprint:

```text
slot_1 → legacy batch → 200 g
slot_2 → legacy batch → 200 g
slot_3 → legacy batch → 200 g
slot_4 → purchase batch → 150 g
slot_5 → purchase batch → 150 g
```

Confirm all five selections, then verify:

- Three reservations are written against the legacy batch.
- Two reservations are written against the new batch.
- Kitchen payload contains the correct grams for every slot.
- Repeating confirmation is idempotent.

Consume the day and verify all five allocations transition to `consumed` once.

## 7. Acceptance scenario B — future package

Initial state:

```text
Current package ends: day 9
New package starts: day 10
```

Before day 10:

- New batch status is `paid_scheduled`.
- New balance is not included in current overview.
- New slots are not included in today’s planning.
- New premium/add-on balances are not exposed.

On day 10 using `Asia/Riyadh` business date:

- Batch becomes active.
- Its balance appears.
- Timeline/planning uses its daily count and grams.
- Repeating lifecycle reconciliation does not duplicate any balance or day.

## 8. Acceptance scenario C — partial final balance

Prepare a 3-meal/day batch with one remaining credit.

Expected:

- Current planner exposes one reservable slot.
- It never exposes three slots and then fails during confirmation.
- Historical timeline continues to show the purchased 3-meal daily shape.

## 9. Acceptance scenario D — skip and unskip

For an overlapping, unprocessed future day:

Skip:

- Existing day allocations move from `reserved` to `released`.
- One compensation token is created per contributing batch.
- Every contributing batch is extended by exactly one day.
- Parent `skipDaysUsed` increments once.
- Day becomes `skipped`.
- Repeating the same request does not add another token/day or usage count.

Unskip:

- Released allocations are reacquired from their original batches.
- Compensation tokens are revoked.
- Batch validity returns to the immutable baseline plus remaining active tokens.
- Parent `skipDaysUsed` decrements once.
- Day becomes `open`.
- The whole operation rolls back if credits were reused or later planning blocks
  validity shrink.

Skip range remains blocked.

## 10. Explicitly blocked scenarios

Do not attempt these in the current staging write phase:

- Additive package containing premium entitlements.
- Additive package containing add-on entitlements.
- Bulk planning.
- Direct pickup reservation, including the experimental planned-pickup adapter.
- Freeze or unfreeze.
- Skip range.
- Cancellation or refund of one batch.
- Wildcard user rollout.
- Any production Shadow, Read, or Write activation.

The backend must fail closed before invoice or mutation where applicable.

## 11. Rollback rules

### Before any entitlement batch is written

Set all three feature flags to `false`.

### After at least one stacked purchase is written in staging

The safe operational rollback is:

```text
SUBSCRIPTION_STACKING_WRITE_ENABLED=false
SUBSCRIPTION_STACKING_READ_ENABLED=true
SUBSCRIPTION_STACKING_USER_IDS=<AFFECTED_TEST_USER_ID>
```

Keep affected user IDs in `SUBSCRIPTION_STACKING_USER_IDS`. Do not turn off the
stacking read path in staging for users whose source of truth has already moved
to entitlement batches; otherwise scheduled activation and per-day projections
may be hidden.

Do not delete batches, allocations, blueprints, or compensation rows manually.

Production rollout remains impossible until the production kill switch is
removed in a separate reviewed change after all acceptance evidence exists.

## 12. Required evidence before removing the production kill switch

- CI stacking phase passes.
- Security Matrix and Startup Isolation pass.
- Changed-code Secret Scan passes.
- Production Dependency Security gate passes.
- Changed JavaScript Syntax gate passes.
- Atomic skip workflow passes.
- Transactional vertical-slice workflow passes.
- Remote staging scenarios A–D pass.
- Repeated webhook/verify concurrency test passes.
- Flutter smoke test passes without a new application build.
- Kitchen grams are validated from the real dashboard/operations response.
- Pickup and delivery transitions are validated.
- Premium/add-on stacking is implemented or explicitly prevented before invoice.
- Freeze, cancellation, refund, and direct pickup policies are completed.
- Monitoring and an operator rollback command are documented.
- A production database backup and limited rollout window are approved.

Until all evidence exists, keep the pull request draft and all production
stacking modes disabled.
