## Subscription Lifecycle — Backend Final Source of Truth (Phase 6)

Last updated: 2026-06-10

**Executive Summary**

- Current backend readiness: Hardened for subscription planner permissioning, date-range checks, day lock rules, payment lifecycle safety, and payment-guard integration. Core subscription flows operate on real DB-backed models (`Payment`, `Subscription`, `SubscriptionDay`).
- Completed phases: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 5B.
- What is protected now: global meal balance checks; premium/add-on pricing safety; pending payment lifecycle (supersede, paid immutability); fulfillment rules and same-day locks; centralized date, access, and day-lock guards; adaptation of throw-based guards to result-based payment services without breaking public shapes.
- Known risks / future work: concurrency races across independent saves when no persisted planner counter exists; no refund/post-paid adjustment logic; legacy delivery rows or missing fulfillment metadata may require migration; some admin/manual deduction flows require transactional environment.

---

## Phase Summary

Phase 1: Global Meal Balance

- Purpose: Prevent planner saves that would exceed a subscription's allowed planned meals.
- Key rule: planned-complete slot count must not exceed remaining allowances.
- Formula used by backend to validate single-save changes:

  totalAfterSave = existingCompleteSlotsOutsideAffectedDates + incomingCompleteSlotsForAffectedDates

- Coverage: single save, validate-only, and bulk selection operations.
- Residual risk: concurrent saves across different requests/dates may still race if there is no persisted planner counter/lock.

Phase 2: Premium/Add-on Pricing Safety

- Premium is a slot-level upgrade (not an extra meal). Premium slots count as one planned meal.
- Add-ons are separate selections and do not change planned meal count.
- Pricing is enforced from the backend-owned catalog; exact premium-key matching (e.g., `premium_large_salad`) is relied upon for correctness.

Phase 3: Pending Payment Lifecycle

- Pending/unpaid payments do NOT lock planner edits.
- Editing a day (planner revision change) supersedes initiated unpaid day-planning payments. Metadata retained on `Payment.metadata` records superseded fields: `isSuperseded`, `supersededAt`, `supersededByRevisionHash`, `supersededPreviousRevisionHash`, `supersededReason`.
- Verification rejects stale/superseded attempts (error code surface: `DAY_PAYMENT_REVISION_MISMATCH`).
- Paid payments are immutable with respect to supersede behavior — paid payments are not replaced by planner edits.
- There is no refund or post-paid adjustment logic added in these phases.

Phase 4: Fulfillment Rules

- Home Delivery: supports multiple meals per subscription/date but enforces one delivery visit per subscription/date.
- Home Delivery day 1: pickup exception is handled via existing pickup-request path.
- Delivery subscriptions: day 2+ pickup is rejected by policy.
- Branch Pickup: can reserve/pick up any positive count up to `Subscription.remainingMeals`.
- Dates validated using KSA date helpers and functions in `src/utils/date`.
- No durable public per-day fulfillment method field introduced in this phase; fulfillment behavior is derived from `Subscription.deliveryMode` and `Subscription/SubscriptionDay` fields.

Phase 5: Date / Lock / Permissions Hardening

- Centralized guard services introduced and used across the backend:
  - `subscriptionDateRangeHelperService.js` — date-range and status checks.
  - `subscriptionAccessGuardService.js` — ownership and access checks.
  - `subscriptionDayLockService.js` — day lock determination and helper predicates.
- Enforced protections: wrong user, inactive/cancelled/expired subscription access, delivered/fulfilled/explicitly locked day blocking client planner edits.
- Pending or superseded unpaid payments do NOT lock planner edits.
- Admin overrides are explicit, role-gated, and constrained.

Phase 5B: Payment Guard Integration

- Throw-based guards (the centralized services above) were integrated with the real, result-based payment flows by using a small adapter pattern where needed. The adapter maps thrown guard errors to the existing `buildErrorResult` or to payment-application result shapes without changing public contracts.
- No result-shape, API contract, or payment persistence style was changed.
- Payment creation and verification flows perform subscription ownership/status/date checks and day-lock checks before creation or application.
- Real DB-backed models remain authoritative: `Payment`, `Subscription`, `SubscriptionDay`.
- No mock/in-memory payment flows were introduced.

---

## Backend Flow Map (important files / responsibilities)

- Planner selection save/update: `src/services/subscription/subscriptionSelectionService.js` and `src/services/subscription/subscriptionDayModificationPolicyService.js`
- Global meal balance: `tests/subscriptionPlannerGlobalMealBalance.test.js` and the selection validators in `subscriptionSelectionService` + balance helpers
- Premium/add-on pricing: `src/services/subscription/...` (premium helpers and `premiumExtraDayPaymentService.js`) and catalog-driven pricing in `src/services/subscription/subscriptionPaymentPayloadService.js`
- Day commercial state / payment requirement: `src/services/subscription/subscriptionDayCommercialStateService.js`
- Unified day payment creation / verification: `src/services/subscription/unifiedDayPaymentService.js`
- Payment application / webhook side-effects: `src/services/paymentApplicationService.js` and targeted `apply*` methods
- Pickup request / reservation: `src/services/subscription/subscriptionPickupRequestClientService.js`
- Delivery / ops transitions: `src/services/dashboard/opsTransitionService.js` and fulfillment services
- Date / access / day lock guards (centralized): `src/services/subscription/subscriptionDateRangeHelperService.js`, `src/services/subscription/subscriptionAccessGuardService.js`, `src/services/subscription/subscriptionDayLockService.js`, plus `subscriptionGuardAdapter.js` used for adapter mapping

---

## Current Source of Truth (authoritative fields)

- `Subscription.totalMeals` — original purchased total meals for subscription contract.
- `Subscription.remainingMeals` — remaining meals available; used by planner validators.
- Planned complete slots represented by `SubscriptionDay.mealSlots` and their selection status.
- `Payment.metadata.isSuperseded` (and related `supersededAt`, `supersededByRevisionHash`, `supersededPreviousRevisionHash`, `supersededReason`) — indicate initiation-level supersede state rather than deletion.
- `SubscriptionDay.plannerRevisionHash` — used to validate payment snapshot/revision compatibility; essential for supersede and revision mismatch checks.
- `Subscription.deliveryMode` — authoritative for fulfillment branch vs delivery logic.
- Delivery records are keyed by subscription + date (i.e., `Delivery.subscriptionId + date`) as the effective scheduling key.
- Date-range logic uses KSA helpers in `src/utils/date` and centralized assertions in `subscriptionDateRangeHelperService.js`.

---

## Error Codes / Compatibility Notes (public-facing)

The following codes are referenced by the backend and may be surfaced to clients (Flutter / Dashboard). Do NOT rename these in code during this phase — only document them.

- `MEAL_PLANNING_LIMIT_EXCEEDED` — planner save would exceed allowed meals.
- `ADDON_PAYMENT_REQUIRED` (or equivalent existing payment-required code) — when an addon/premium requires payment.
- `DAY_PAYMENT_REVISION_MISMATCH` — planner revision mismatch vs payment snapshot (Phase 3 legacy compatibility).
- `FORBIDDEN` — access denied (wrong user/admin role missing).
- `LOCKED` — legacy locked-day response returned by some flows when day cannot be edited; kept for backward compatibility.
- `SUBSCRIPTION_NOT_ACTIVE` — subscription inactive/pending/canceled.
- `SUBSCRIPTION_EXPIRED` — date outside validity.
- `SUBSCRIPTION_CANCELED` — subscription explicitly canceled.
- `SUBSCRIPTION_DATE_OUT_OF_RANGE` — date invalid against subscription range.
- `INSUFFICIENT_CREDITS` — balance not enough for requested operation.
- `INVALID_DELIVERY_MODE` — invalid fulfillment conditions for requested operation.

Notes:
- Phase 5B intentionally preserved existing result shapes and legacy codes such as `LOCKED` and `DAY_PAYMENT_REVISION_MISMATCH` to avoid breaking Flutter/frontend.

---

## Regression Test Matrix (area → file/test → what it protects)

- Global meal balance:
  - `tests/subscriptionPlannerGlobalMealBalance.test.js` — prevents over-planning; protects `Subscription.remainingMeals` invariants and planner save logic.

- Premium/add-on pricing safety:
  - `tests/subscriptionPremiumAddonPricingSafety.test.js` — ensures premium price semantics remain correct; protects premium snapshot application and pricing keys (e.g., `premium_large_salad`).

- Pending payment lifecycle (Phase 3):
  - `tests/subscriptionPlannerPaymentLifecycle.test.js` — supersede logic, pending payment non-locking, paid immutability, snapshot validation.

- Fulfillment / ops rules:
  - `tests/subscriptionFulfillmentPolicy.test.js` — home delivery/day 1 rules, pickup exceptions, daily delivery visit invariants.

- Date/Lock/Permissions hardening (Phase 5 + 5B):
  - `tests/subscriptionDateLockPermissionsHardening.test.js` — ownership, subscription status/date range, locked day behavior, pending/superseded payments do not lock edits, payment creation/verification rejection shapes.

- Subscription test suite (group run):
  - `npm run test:subscriptions` — runs `subscriptionBalancePolicy`, `subscriptionDayModificationPolicy`, and `subscriptionFulfillmentConcurrency` tests; protects a set of production invariants across day modification and concurrency-concerned flows.

Each test file should be run as part of regression checks before release and after any change touching payment, planner, or fulfillment logic.

---

## Flutter / Dashboard Contract Impact

- No breaking Flutter contract changes were required in Phase 6.
- What Flutter should expect (or optionally handle better):
  - handle `MEAL_PLANNING_LIMIT_EXCEEDED` gracefully by showing a user-facing message and optionally disabling the save action.
  - handle `DAY_PAYMENT_REVISION_MISMATCH` by refreshing day state and prompting the user to reapply planner changes.
  - treat pending payments as allowing planner edits (UI should not assume pending payments lock edits).
  - optionally show remaining planned/available meals if the backend exposes it directly.
  - support explicit per-day fulfillment method UI only if backend later exposes a durable per-day fulfillment field.

---

## Known Remaining Risks / Future Work

- Concurrent saves across separate requests/dates can still race if no persisted planner counter/lock is present. Consider adding a persisted planner counter or a per-subscription planning mutex in a future phase if strict concurrency safety is required.
- Legacy/edge surfaces: some legacy delivery DB rows without `date` or missing fields may need backfill/migration.
- No refund/post-paid adjustment logic was added — if business requires auto-adjustments, add controlled flows and tests.
- Admin/manual deduction flows require MongoDB transactions in many scenarios; test and validate in production cluster with transactions enabled.
- Consider centralizing error-code mappings in a compatibility layer if future standardization is desired, but avoid changing codes until cross-platform clients are coordinated.

---

## Final Backend Readiness Decision

- Ready for additional Flutter integration? Yes — with caveats described below.
- Ready for production? Yes, with monitoring and caveats:
  - Monitor for concurrent planning race conditions under high load (run synthetic concurrency load tests if possible).
  - Monitor payment verification failures and webhook deliverability.
  - Observe metrics for `DAY_PAYMENT_REVISION_MISMATCH`, `LOCKED`, and `MEAL_PLANNING_LIMIT_EXCEEDED` to detect UX friction points.

- Post-deploy must-monitor list:
  - rate of `DAY_PAYMENT_REVISION_MISMATCH` errors (client frustration if high)
  - occurrences of `MEAL_PLANNING_LIMIT_EXCEEDED` after UX changes
  - any unexpected `SUBSCRIPTION_NOT_ACTIVE` rejects from valid clients (investigate clock/zone/date issues)

---

Appendix: reference to implemented files (source of truth):

- `src/models/Subscription.js`
- `src/models/SubscriptionDay.js`
- `src/models/Payment.js`
- `src/services/subscription/subscriptionDateRangeHelperService.js`
- `src/services/subscription/subscriptionAccessGuardService.js`
- `src/services/subscription/subscriptionDayLockService.js`
- `src/services/subscription/unifiedDayPaymentService.js`
- `src/services/paymentApplicationService.js`
- `src/services/subscription/subscriptionDayPaymentLifecycleService.js`
- `tests/subscriptionDateLockPermissionsHardening.test.js`
- `tests/subscriptionPlannerPaymentLifecycle.test.js`
- `tests/subscriptionPlannerGlobalMealBalance.test.js`
- `tests/subscriptionPremiumAddonPricingSafety.test.js`
- `tests/subscriptionFulfillmentPolicy.test.js`

---

Contact: backend team / maintainer for follow-up actions and migration planning.
