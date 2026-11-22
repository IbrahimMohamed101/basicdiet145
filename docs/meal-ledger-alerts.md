# Meal ledger alerts and same-day extra deductions

## What it does

A daily scan runs the meal-ledger reconciliation (the same rules as
`scripts/reconcile-meal-balances.js`) over the **current** subscriptions and keeps
one alert per problem in the `MealLedgerAlert` collection. Alerts stay visible to
dashboard staff until someone verifies them or the problem is gone. The scan
**never changes a customer balance**.

Current = `status: "active"` and a validity end date that has not passed (KSA
date). Subscriptions that are still `active` but already ended are skipped.

## Alert lifecycle

| Status | Meaning |
| --- | --- |
| `open` | Pending. Counted in the dashboard banner. |
| `acknowledged` | A staff member checked it and left a note. Not counted as pending, but kept and refreshed while the problem exists. |
| `resolved` | The scan no longer finds it (fixed), or the subscription is no longer current. Reopened (acknowledgement cleared) if the problem returns. |

One alert is created per problem and per day. A stale reservation on three
different days is three alerts, and each one disappears when that day is settled.

A scan only writes after the whole reconciliation finished, so a failed run can
never resolve alerts by mistake.

## Schedule

`src/jobs/index.js` runs the scan once a day after 05:30 KSA and retries every 30
minutes if it fails. Set `MEAL_LEDGER_ALERTS_ENABLED=false` to turn it off. Several
instances running it at once is harmless (idempotent upserts).

## API (dashboard auth)

Base path: `/api/dashboard/meal-ledger-alerts`

| Method and path | Roles | Purpose |
| --- | --- | --- |
| `GET /summary` | admin, restaurant, cashier, kitchen | Banner payload: `pending`, `pendingBySeverity`, `acknowledged`, `oldestPendingAt`, `lastScan`. Call on every dashboard load. |
| `GET /?status=pending\|open\|acknowledged\|resolved\|all&severity=&subscriptionId=&page=&limit=` | same | List. `pending` (default) means `open`. Critical first. |
| `POST /:id/acknowledge` body `{ "note": "..." }` | admin, restaurant, cashier | Mark as verified. A note of at least 3 characters is required. |
| `POST /scan` | admin | Run the scan now. |

## Indexes

The collection needs a unique index on `{ subscriptionId, dedupeKey }`. It is in
`scripts/create-production-indexes.js`; run that script where `autoIndex` is off.

## Same-day extra deductions (no blocking)

A customer can receive the day's delivery and also take extra meals from the
balance. The system must not block that. Instead:

* `POST` manual deduction accepts an optional `confirmExtraBalanceUse: true`. The
  cashier ticks it when the extra meals are on purpose.
* When it is sent, an evidence-only log `subscription_manual_deduction_same_day_extra`
  is written for that business date (same transaction on the legacy path, right
  after success on the stacked path). It never moves a balance.
* The reconciliation does not report a double deduction on a confirmed date.
* When it is **not** sent and the delivery day was already fulfilled, the deduction
  still goes through and the response carries `warnings: ["DAY_ALREADY_DELIVERED_TODAY"]`
  so the dashboard can ask. If it stays unexplained, the daily scan raises a
  `DAY_OVER_DEDUCTED` alert for staff to verify.

The dashboard UI (separate repo) needs a checkbox that sends
`confirmExtraBalanceUse`, and should show the banner from `GET /summary`.

## Settling stuck days

Days that were really delivered but never closed (their meals stay reserved) are
settled with `scripts/settle-stuck-delivered-days.js`: dry-run by default,
transactional, verified, and logged. The dashboard cannot do it because it blocks
changes to past days.
