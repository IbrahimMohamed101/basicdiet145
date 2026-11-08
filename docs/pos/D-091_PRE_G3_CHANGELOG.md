# D-091 — Stage G, pre-G3 owner decision (STAGING ONLY)

**Authority:** owner request 2026-11-08. **Status:** implementation under isolated staging CI review; **not approved for main or Production**.

Cashier and restaurant retain equal operational rights (D-087/D-091), including manual cash/Visa-Mada dashboard recording, customer creation and POS refunds. Legacy kitchen customer creation remains allowed. No existing permissions are revoked and no admin-only actions are conferred on cashier.

## Exact modification register

| File | Change |
| --- | --- |
| `src/controllers/adminController.js` | Remove cash-only role check; reject client-supplied `paidAt`, assign server time in payment row, write authenticated customer-creator actor to ActivityLog |
| `src/controllers/dashboard/subscriptionPaymentRecordingController.js` | Stop cashier Visa/quote filter; reject `paidAt` before activation, keep #207 paid-state and exact-halalas checks |
| `src/routes/admin.js` | Replace temporary #205 cashier-only route exception with permission-based `POST /admin/users` for admin/restaurant (cashier inherits restaurant), leave other mutations behind original guards |
| `src/routes/dashboardRestaurantCapabilities.js` | Restore kitchen on original `/users` route `["admin","restaurant","kitchen"]`; cashier inherits restaurant. No role loses previously granted access |
| `src/services/pos/financialRuntime.js` | Refund entitlement uses inherited dashboard roles, with optional `POS_REFUND_ROLES` policy |
| `src/services/pos/financialLedgerService.js` | POS sale/refund permissions through effective roles; use versioned policy to stamp immutable businessDate |
| `src/services/pos/businessDate.js` | HH:mm Riyadh rollover (default 00:00); exact half-open business date bounds |
| `src/services/pos/businessDaySetting.js` | Versioned daily cutoff policy and transactionally audited changes (`previousCutoff`, `newCutoff`, actor, timestamp, `effectiveFrom` next business day) |
| `src/services/pos/expectedTotals.js` | Use historical versioned cutoff bounds; include dashboard_cashier and both dashboard_subscription_* sources |
| `src/services/dashboard/dailyCashClosingService.js` | Use historical versioned cutoff for payments and refunds, start-inclusive/end-exclusive |
| `tests/posG2ExpectedTotals.test.js` | Test 23:59, 00:01, 03:59, 04:00 with 04:00 and default 00:00 |
| `tests/posG3StandaloneSubscriptionGuard.test.js` | Real HTTP role/payment/paidAt/customer-audit checks on isolated standalone Mongo |
| `tests/posGD091BusinessCutoff.integration.test.js` | Verify cutoff, payment/closing matching, immutable invoice date on disposable standalone and rs0 |
| `.github/workflows/pos-g-d091-ci.yml` | Run isolated safety gates on both Mongo topologies |

**Frontend** (separate staging-only PR): `src/lib/rolePermissions.ts`; `src/features/pos/PosOperationsShell.tsx`; `src/features/pos/PosOperationsShell.test.tsx`; `src/components/pages/subscriptions/create/CreateSubscriptionFormContent.tsx`.

## Permissions before and after PR #208 (no permission removals)

| Role | Capability | Before PR #208 | After corrected PR #208 |
| --- | --- | --- | --- |
| cashier | Dashboard cash subscription | Allowed, plus temporary G1 guard | Allowed, permanent inherited restaurant permission |
| cashier | Dashboard Visa/Mada subscription | Denied by direct role/cash-only checks | Allowed through verified `POST /dashboard/subscriptions` |
| cashier | New customer `POST /admin/users` | Temporary Staging-only exception | Allowed through inherited restaurant permission |
| cashier | POS refund (D-090) | Allowed | Allowed, unchanged |
| restaurant | Cash/Visa subscriptions, customers, POS refund | Allowed | Allowed, unchanged |
| kitchen | Create customers | Allowed | Allowed, **restored**, unchanged |
| kitchen | POS refund / subscriptions sales | Not granted | Not granted, unchanged |
| courier | Create customer, POS refund, payment recording | Not granted | Not granted, unchanged |
| admin | Operational changes and permitted settings | Allowed | Allowed, unchanged |
| superadmin | Existing administrative operations | Allowed | Allowed, unchanged |

**Payment sources are server-only**: `/dashboard/subscriptions` creates `dashboard_subscription_cash` or `dashboard_subscription_visa` based on the verified payment method; `/admin/subscriptions` is cash-only with `dashboard_cashier`. Both routes reject `body.source` or `payment.source` (400 `SOURCE_NOT_ALLOWED`). Payment pre-validation never changes provider/method from source alone.

**Cutoff transitions**: `businessDayCutoff` is stored in `Setting` as baseline + ordered revisions. Each update has the authenticated actor, timestamp, previous and new HH:mm and `effectiveFrom` next business date, written with its audit in one MongoDB rs0 transaction. The transition day starts at the previous cutoff and ends at the new cutoff, preventing overlap or gaps. Earlier dates remain fixed. `expectedTotals`, all subscription `paidAt` reports, `accountingDailyReportService`, and POS issue/refund stamps use the same historical boundaries.

## #204 seed dependency

Use the existing isolated staging Mongo database `basicdiet_pos_staging_test` on private `mongodb-qxhu.railway.internal`, not a separate unsynchronized G3 database. Require staging environment ID and backend service ID, explicit seed enable, `rs0`, matching connected host/database, allowlisted configuration only, and **synthetic users only**. **No direct Subscription creation**. G3 will create subscriptions solely with `POST /dashboard/subscriptions` so payment/entitlements/ledger are coherent. **No Production configuration export without separate owner approval.** PR #204 is maintained separately and must pass its guards.

## Release and acceptance gate (not yet a completion statement)

1. Backend and frontend PR checks green, including tests on Mongo standalone and disposable rs0.
2. Isolated runtime and Staging Mongo host/database/topology independently verified. No real customers or Production data.
3. Deploy exact backend and frontend commit SHAs **to Railway Staging only**, never main or Production.
4. G3 cashier E2E: one cash subscription, one Mada subscription, new customer; three sales including discount, refund, meal deduction, and submitted closing. Compare every total in **integer halalas**.
5. Verify rejected yesterday `paidAt` returns `400 PAID_AT_NOT_ALLOWED`, leaves subscriptions/payments/closing unchanged, and auditing records actual actor.

A business date already persisted on an invoice is immutable and not retroactively rewritten by changing the cutoff. Changes to cutoff must be deliberately coordinated with closing day boundaries.
