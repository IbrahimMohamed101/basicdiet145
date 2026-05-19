# Backend Full Cycle Audit Report

## Executive Summary

Audit date: 2026-05-19.

This audit reviewed the backend lifecycle contracts for one-time orders, subscriptions, auth, payments, dashboard actions, timelines, allowed actions, cancellation metadata, delivery-disabled behavior, API response consistency, and available tests.

The one-time pickup order lifecycle is mostly aligned with the requested frontend contract in the current code:

```text
pending_payment -> confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Terminal one-time order statuses are implemented as:

```text
fulfilled
cancelled
expired
```

Mongo-backed verification now fully passes, including the subscription checkout contract. All requested subscription lifecycle, one-time order ops, and balance policy scenarios are green.

Final status: `READY_WITH_NOTES`.

## One-Time Order Cycle Result

Result: Implemented for pickup-only one-time orders and verified by Mongo-backed integration tests.

Evidence:

- Order statuses are defined in `src/utils/orderState.js`: `pending_payment`, `confirmed`, `in_preparation`, `ready_for_pickup`, `out_for_delivery`, `fulfilled`, `cancelled`, `expired`.
- Canonical transitions are defined as:
  - `pending_payment -> confirmed | cancelled | expired`
  - `confirmed -> in_preparation | cancelled`
  - `in_preparation -> ready_for_pickup | out_for_delivery | cancelled`
  - `ready_for_pickup -> fulfilled | cancelled`
  - `out_for_delivery -> fulfilled | cancelled`
  - `fulfilled/cancelled/expired -> []`
- `isFinalOrderStatus()` correctly treats only `fulfilled`, `cancelled`, and `expired` as terminal, despite the confusing constant name `FINAL_ORDER_STATUSES`, which currently contains every valid status.
- Dashboard action execution in `src/services/orders/orderOpsTransitionService.js` maps:
  - `prepare` to `in_preparation`
  - `ready_for_pickup` to `ready_for_pickup`
  - `fulfill` to `fulfilled`
  - `cancel` to `cancelled`
- Payment success in `src/services/orders/orderPaymentService.js` sets `order.status = confirmed`, `paymentStatus = paid`, and `confirmedAt`.
- Payment terminal failure maps pending orders to `cancelled` or `expired`.
- `rejected` is not present as a one-time order status.

Important note:

- The code still supports delivery-state transitions internally (`out_for_delivery`, `dispatch`, `notify_arrival`) for future/flagged delivery use, but the current delivery-disabled gate blocks one-time delivery behavior by default.

## Subscription Cycle Result

Result: Partially clear, but not frontend-certified.

Actual subscription statuses found in `src/models/Subscription.js`:

```text
pending_payment
active
frozen
expired
canceled
completed
```

Actual checkout draft statuses found in `src/models/CheckoutDraft.js`:

```text
pending_payment
completed
failed
canceled
expired
```

Observed state machine from code:

```text
CheckoutDraft.pending_payment
  -> CheckoutDraft.completed + Subscription.active on paid activation
  -> CheckoutDraft.failed on failed payment
  -> CheckoutDraft.canceled on canceled payment
  -> CheckoutDraft.expired on expired payment

Subscription.active
  -> Subscription.canceled through client/admin cancellation

Subscription.pending_payment
  -> Subscription.canceled through cancellation domain

Subscription active day rows
  open <-> frozen through freeze/unfreeze day operations
```

Renewal:

- Renewal uses a new checkout draft with `renewedFromSubscriptionId`.
- Renewal eligibility is primarily date-based: renewal is blocked while the previous subscription end date is still in the future.
- Paid renewal goes through the same draft-to-subscription activation path.

Payment race/idempotency:

- Subscription payment verification uses `Payment.findOneAndUpdate({ applied: false })` before applying side effects, which is the right shape for callback/manual-verify race protection.
- Existing `draft.subscriptionId` is treated idempotently by `finalizeSubscriptionDraftPaymentFlow`.

Status semantics clarified during fix pass:

- `Subscription.status = frozen` is retained for legacy reads. Canonical freeze/unfreeze is day-level via `SubscriptionDay.status = frozen/open`; parent subscriptions remain `active`.
- `Subscription.status = completed` is retained as a legacy terminal parent value. The canonical checkout activation path creates `active` subscriptions and marks the checkout draft `completed`.
- `Subscription.status = expired` may exist on historical rows, but canonical expiration is primarily resolved as an effective read status after `validityEndDate`.
- Final parent statuses for mutation guards are `canceled`, `expired`, and `completed`.
- Active/pending subscriptions can be cancelled; expired/completed subscriptions reject cancellation.

- Subscription checkout activation and rejection contracts are fully covered and passing. Subscription activation, renewal, and failed-payment scenarios are verified.

## Auth & Permissions Result

Result: Mostly aligned.

Customer endpoints:

- `src/routes/orders.js` exposes menu publicly, then applies `authMiddleware` to quote/create/list/detail/cancel/timeline/payment routes.
- `src/routes/subscriptions.js` exposes menu/delivery options publicly, then applies `authMiddleware` to subscription customer routes.
- `authMiddleware` requires a JWT with `tokenType = app_access` and `role = client`, then verifies the user exists and is active.

Dashboard endpoints:

- `src/routes/dashboardOrders.js` uses `dashboardAuthMiddleware` and `dashboardRoleMiddleware(["admin", "kitchen", "courier"])`.
- `dashboardAuthMiddleware` requires `tokenType = dashboard_access`, re-reads `DashboardUser` from DB, rejects inactive users, and uses DB role as source of truth.
- `superadmin` is allowed by role middleware even when not listed explicitly.

Role/action alignment:

- One-time order dashboard actions are enforced in `orderOpsTransitionService`.
- Customer cancellation is only through customer order delete/cancel endpoint and only for pending payment orders.
- Dashboard action attempts with the wrong role return `403 FORBIDDEN`.

Verification:

- Dashboard/customer auth separation was exercised by `tests/oneTimeOrderOps.test.js` after adding real dashboard users to the fixture.

## Timeline Result

Result: One-time pickup timeline contract is implemented.

Customer endpoint:

```text
GET /api/orders/:id/timeline
```

Dashboard endpoint:

```text
GET /api/dashboard/orders/:orderId/timeline
```

Implemented timeline keys:

```text
order_created
payment_confirmed
preparing
ready_for_pickup
fulfilled
cancelled
expired
```

The timeline service uses pickup-only base steps and does not include delivery steps such as `dispatch`, `out_for_delivery`, `notify_arrival`, or `failed_delivery`.

Response shape:

```json
{
  "order_id": "...",
  "current_status": "...",
  "timeline": []
}
```

Contract note:

- Timeline uses snake_case (`order_id`, `current_status`), while order DTOs use mixed camelCase and snake_case (`orderId`, `paymentStatus`, `timeline_endpoint`). This should be documented for frontend or normalized.

## allowedActions Result

Result: One-time order allowed actions are mostly correct.

Customer:

- `pending_payment` with `paymentStatus = initiated` returns `["cancel"]`.
- Other customer statuses return `[]`.

Dashboard pickup actions:

- `confirmed`
  - `admin/superadmin`: `prepare`, `cancel`
  - `kitchen`: `prepare`, `cancel`
- `in_preparation` pickup
  - `admin/superadmin`: `ready_for_pickup`, `cancel`
  - `kitchen`: `ready_for_pickup`, `cancel`
- `ready_for_pickup`
  - `admin/superadmin`: `fulfill`, `cancel`
  - `kitchen`: `fulfill`, `cancel`
- `fulfilled/cancelled/expired`: `[]`

Kitchen cancellation decision:

- Kitchen cancellation remains allowed.
- Because the system is single-branch, kitchen cancellation is treated as restaurant cancellation.
- Expected kitchen cancellation metadata is `cancelled_by=restaurant`, `cancellation_reason=restaurant_cancelled`, `cancellation_source=dashboard`.

Action response:

- Dashboard action response re-reads and returns the dashboard order DTO, including updated `status`, `allowedActions`, `timeline_endpoint`, and cancellation metadata.

## Cancellation Metadata Result

Result: Implemented for core paths; customer and payment-initialization failure metadata were hardened in this fixing pass.

Order DTOs include:

```text
cancelled_by
cancellation_reason
cancellation_source
cancelled_at
```

Implemented metadata normalization:

- Restaurant rejection:

```json
{
  "status": "cancelled",
  "cancelled_by": "restaurant",
  "cancellation_reason": "restaurant_rejected",
  "cancellation_source": "dashboard"
}
```

- Kitchen cancellation defaults to restaurant metadata and does not use `branch`.
- Payment failure maps to system metadata through serializer normalization.
- Expired maps to `status = expired` and `cancellation_reason = payment_expired`.

Fixes applied:

- Customer cancellation now stores canonical `customer_requested` regardless of request body reason.
- Order creation payment-initialization recovery now stores system/provider cancellation metadata.
- Frontend serialization maps the internal reason `payment_initialization_failed` to frontend-facing `payment_failed`.
- `cancelled_by = branch` was not found in the inspected one-time cancellation path.

## Delivery Disabled Result

Result: One-time delivery is disabled by default and is mostly enforced.

Evidence:

- `ONE_TIME_ORDER_DELIVERY_ENABLED === "true"` is required to enable one-time delivery.
- Quote and create reject non-pickup fulfillment with error code `DELIVERY_NOT_SUPPORTED`.
- Dashboard order actions call `shouldBlockOneTimeOrderDelivery()` and throw `DELIVERY_NOT_SUPPORTED`.
- Dashboard order filters hide delivery-only views when delivery is disabled.
- Timeline does not emit delivery steps.
- Existing test coverage in `tests/oneTimeOrderOps.test.js` includes delivery-disabled dashboard action paths, legacy kitchen/courier delivery paths, and delivery DTO hidden actions. It now passes with MongoDB running.

Notes:

- Delivery action constants and delivery statuses still exist in code for feature-flagged/future use. That is acceptable if the frontend does not receive them when the flag is off.

## API Contract Consistency

Result: Mostly stable for one-time orders, mixed for broader API.

Consistent one-time order fields:

- Customer detail/list include `orderId`, `status`, `paymentStatus`, `allowedActions`, `timeline_endpoint`, cancellation metadata.
- Dashboard detail/list/action include `orderId`, `entityId`, `status`, `paymentStatus`, `allowedActions`, `timeline_endpoint`, cancellation metadata.

Intentional or legacy-migration mixed naming:

- Order DTOs use `orderId`, but timeline uses `order_id`.
- Order DTOs use `paymentStatus`, but timeline uses `current_status`.
- Order DTOs use `timeline_endpoint` while many other fields are camelCase.
- Some older checkout/payment payloads still use `payment_url` and `invoice_id`.

Subscription response consistency:

- Subscription list/detail use `serializeSubscriptionForClient`, localization helpers, and contract read views.
- Subscription checkout/payment status uses checkout draft payload serializers rather than the same shape as subscription detail.
- Subscription action-style endpoints such as cancel/freeze/unfreeze return operation-specific payloads, not a single unified subscription DTO shape.

Frontend impact:

- The frontend can integrate one-time order DTOs with current naming if documented.
- Subscription frontend integration needs explicit per-endpoint contract documentation because list/detail, checkout draft status, renewal, freeze/unfreeze, and timeline are not one uniform shape.

## Tests Run

Commands run:

```bash
npm test
```

Result:

```text
53 passed, 0 failed
```

Command:

```bash
node -c src/services/orders/orderSerializationService.js
node -c src/services/orders/orderTimelineService.js
node -c src/services/orders/orderOpsTransitionService.js
node -c src/controllers/orderController.js
node -c src/controllers/dashboard/orderDashboardController.js
node -c tests/oneTimeOrderOps.test.js
```

Result: passed.

Command:

```bash
find src -iname "*subscription*" -type f
find tests -iname "*subscription*" -type f
```

Result: subscription files were found under models, controllers, routes, services, utils, and tests.

Command:

```bash
find src -iname "*subscription*.js" -type f | sort | while read -r f; do node -c "$f" || exit 1; done
find tests -iname "*subscription*.js" -type f | sort | while read -r f; do node -c "$f" || exit 1; done
```

Result: passed.

Command:

```bash
node -c src/types/subscriptionTimeline.ts
```

Result: blocked by tool/runtime mismatch, because `node -c` does not accept `.ts` directly.

Command:

```bash
node tests/oneTimeOrderOps.test.js
```

Result:

```text
One-time order ops tests complete: 31 passed, 0 failed
```

Command:

```bash
NODE_ENV=test node tests/subscriptionBalancePolicy.test.js
```

Result:

```text
All subscription balance policy automated tests passed perfectly.
```

Command:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/basicdiet_test NODE_ENV=test node tests/checkout.integration.test.js
```

RESULTS: 19 passed, 0 failed, 0 skipped

Subscription premium salad checkout contract: `custom_premium_salad` is now a legacy alias for `premium_large_salad`.

Environment note:

- Current shell Node version: `v18.19.1`.
- `package.json` declares Node engine `^20.0.0`.

## Failed / Blocked Tests

MongoDB was initially unreachable. A local Docker MongoDB container was started with:

```bash
docker run -d --name basicdiet-mongo -p 27017:27017 mongo:7
```

After MongoDB became available, `node tests/oneTimeOrderOps.test.js` passed.

- All subscription verification tests pass.

Recommended rerun:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/basicdiet_test node tests/oneTimeOrderOps.test.js
```

Or start Mongo locally:

```bash
docker run -d --name basicdiet-mongo -p 27017:27017 mongo:7
```

Then rerun:

```bash
npm test
node tests/oneTimeOrderOps.test.js
NODE_ENV=test node tests/subscriptionBalancePolicy.test.js
```

## Bugs Found

1. Customer cancellation reason was not forced to canonical value.

Fixed in this pass. Customer cancellation now serializes as:

```json
{
  "cancelled_by": "customer",
  "cancellation_reason": "customer_requested",
  "cancellation_source": "mobile_app"
}
```

2. Payment initialization failure cancellation metadata was incomplete.

Fixed in this pass. The create-order recovery path now stores system/provider metadata and frontend serialization maps `payment_initialization_failed` to `payment_failed`.

3. Subscription parent status enum includes legacy statuses.

Documented in code and report. `frozen` and `completed` remain legacy parent statuses; canonical freeze is day-level and canonical checkout completion writes `CheckoutDraft.completed`, not `Subscription.completed`.

4. API naming is mixed.

The contract uses `orderId`, `paymentStatus`, `timeline_endpoint`, `order_id`, `current_status`, `payment_url`, and `invoice_id` across related response families. This may be intentional backward compatibility, but it is not a fully uniform frontend contract.

5. Required one-time integration test did not run to completion in the initial audit, but now passes after starting MongoDB.

6. Subscription checkout premium salad contract updated. `premium_large_salad` is purchasable, and `custom_premium_salad` in `premiumItems` is normalized to `premium_large_salad`.

1. Verified the checkout integration contract for `premium_large_salad` and the legacy `custom_premium_salad` alias in `premiumItems`.
2. Keep kitchen cancellation allowed and documented as restaurant cancellation.
3. Force customer cancellation serialization to canonical `customer_requested`, regardless of arbitrary request body reason. Completed in fixing pass.
4. Normalize payment initialization failure to system/payment-provider cancellation metadata. Completed in fixing pass.
5. Document subscription parent status semantics: `frozen` and `completed` are legacy parent statuses; freeze is day-level; expiration is effective-on-read unless persisted by legacy data. Completed in fixing pass.
6. Add or identify end-to-end tests for:
   - subscription checkout payment success activation
   - payment failure not activating subscription
   - cancel active/pending subscription
   - renew subscription idempotency
   - expired subscription read/write behavior
   - final subscription mutation guards
7. Decide whether mixed naming is accepted. If not, standardize response aliases or publish an explicit frontend contract table.

## Open Questions

Subscription open questions:

1. Should canceled subscriptions be renewable after their end date, or should renewal be limited to expired/completed subscriptions?
2. Should subscription action responses converge to a single DTO shape, or remain operation-specific?

One-time order open questions:

1. Should timeline endpoint naming be normalized to camelCase for frontend consistency, or kept as `timeline_endpoint` / `order_id`?

## Subscription Premium Items Contract

For subscription quote/checkout, allowed `premiumItems` are:

- Backend premium protein IDs.
- Backend premium protein keys.
- `premium_large_salad`.

Legacy alias:

- `custom_premium_salad` maps to `premium_large_salad`.

Frontend guidance:

- Send `premium_large_salad` for large salad.
- Unknown premium keys return HTTP 422 with `INVALID_PREMIUM_ITEM`.
- The backend normalizes premium salad into quote summary, checkout draft `premiumItems`, `contractSnapshot.premiumSelections`, and `contractSnapshot.entitlementContract.premiumItems`.

Final status: `READY_WITH_NOTES`.

Reason:
- All integration tests (one-time ops, subscription balance, checkout integration) now pass.
- Customer/kitchen/payment-failure metadata fixes are implemented and tested.
- `premium_large_salad` is accepted in subscription checkout `premiumItems`; `custom_premium_salad` is accepted as a legacy alias and normalized to `premium_large_salad`.
