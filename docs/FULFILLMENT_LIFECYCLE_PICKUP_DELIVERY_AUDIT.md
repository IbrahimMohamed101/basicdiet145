# Fulfillment Lifecycle Pickup/Delivery Audit

Date: 2026-06-13

## Final Rules

- Branch Pickup is balance-based. Real operations must target `SubscriptionPickupRequest`.
- A branch-pickup `subscription_day` is only a planned meal-selection day unless represented by a pickup request. Dashboard execution rejects `prepare`, `ready_for_pickup`, `fulfill`, and `no_show` on branch-pickup `subscription_day` with HTTP 422 `PICKUP_REQUEST_REQUIRED`.
- Creating `SubscriptionPickupRequest` reserves/decrements `Subscription.remainingMeals`.
- Fulfilling a pickup request consumes the reserved meals but does not decrement `remainingMeals` again.
- Canceling a pickup request before consumption releases reserved meals back to `remainingMeals`.
- `no_show` consumes reserved meals and does not release them.
- Multiple same-day pickup requests are allowed up to available `remainingMeals`.
- Pickup request idempotency keys return the original request and do not reserve twice.
- Home Delivery is date/day-based. `subscription_day` can be prepared, dispatched, and fulfilled without `pickupRequestId`.
- Home Delivery creates at most one delivery visit per `subscriptionId + date` and must not double-consume meals.

## Endpoint/Role Matrix

| Endpoint | Token type | Allowed roles | Wrong/missing auth | Wrong valid role | Business guard |
|---|---|---:|---|---|---|
| `POST /api/subscriptions/:subscriptionId/pickup-requests` | app client access | `client` owner only | 401 `AUTH_REQUIRED`, `TOKEN_INVALID`, or `TOKEN_EXPIRED` | dashboard token: 403 `FORBIDDEN`; other client owner mismatch: 403/404 | 400 invalid mode/date/count; 422 insufficient credits/payment/planning |
| `GET /api/subscriptions/:subscriptionId/pickup-requests` | app client access | `client` owner only | 401 | 403/404 owner mismatch | none |
| `GET /api/subscriptions/:subscriptionId/pickup-requests/:requestId/status` | app client access | `client` owner only | 401 | 403/404 owner mismatch | pickup code hidden before ready |
| `POST /api/dashboard/ops/actions/prepare` | dashboard access | `superadmin`, `admin`, `kitchen` | 401 `UNAUTHORIZED` | 403 `FORBIDDEN` or 409 role/mode reason | branch pickup `subscription_day`: 422 `PICKUP_REQUEST_REQUIRED` |
| `POST /api/dashboard/ops/actions/ready_for_pickup` | dashboard access | `superadmin`, `admin`, `kitchen` | 401 | 403/409 | branch pickup `subscription_day`: 422 `PICKUP_REQUEST_REQUIRED` |
| `POST /api/dashboard/ops/actions/fulfill` | dashboard access | pickup: `superadmin`, `admin`, `kitchen`; delivery: `superadmin`, `admin`, `courier` | 401 | 403/409 | branch pickup `subscription_day`: 422 `PICKUP_REQUEST_REQUIRED` |
| `POST /api/dashboard/ops/actions/no_show` | dashboard access | `superadmin`, `admin`, `kitchen` | 401 | 403/409 | branch pickup `subscription_day`: 422 `PICKUP_REQUEST_REQUIRED` |
| `GET /api/dashboard/kitchen/queue` | dashboard access | `superadmin`, `admin`, `kitchen` | 401 | 403 `FORBIDDEN` | planned pickup rows are visible but disabled |
| `GET /api/dashboard/pickup/queue` | dashboard access | `superadmin`, `admin`, `kitchen` | 401 | 403 `FORBIDDEN` | includes actual `subscription_pickup_request` rows |
| `GET /api/dashboard/courier/queue` | dashboard access | `superadmin`, `admin`, `courier` | 401 | 403 `FORBIDDEN` | delivery only |

There is currently no dashboard endpoint to create pickup requests on behalf of a client. The client endpoint is intentionally client-only. A valid admin/dashboard token on `POST /api/subscriptions/:subscriptionId/pickup-requests` returns 403 `FORBIDDEN`, not `TOKEN_INVALID`.

## Queue Contract

Planned branch-pickup `subscription_day` without `pickupRequestId`:

- `payment.canPrepare === false`
- `payment.canFulfill === false`
- `actions.canPrepare === false`
- `actions.canReadyForPickup === false`
- `actions.canFulfill === false`
- `actions.canNoShow === false`
- `actions.allowed` excludes `prepare`, `ready_for_pickup`, `fulfill`, `no_show`
- `actions.disabled` includes `prepare` with reason `PICKUP_REQUEST_REQUIRED`
- `dataQuality` can be true when display data is otherwise complete

Actual `subscription_pickup_request`:

- `ids.entityType === "subscription_pickup_request"`
- `ids.pickupRequestId` is present
- `fulfillment.pickup.mealCount > 0`
- `fulfillment.pickup.reserved === true`
- `subscription.plan.remainingMeals` reflects reservation
- prepare/ready/fulfill follow request status and role policy

Home delivery `subscription_day`:

- `ids.entityType === "subscription_day"`
- `fulfillment.type === "home_delivery"`
- prepare -> dispatch -> fulfill uses day lifecycle
- no `PICKUP_REQUEST_REQUIRED`

## Postman Test Flow

1. Authenticate User A, User B, admin, kitchen, and courier.
2. Create or seed User A and User B pickup subscriptions and home-delivery subscriptions.
3. Select meals for a pickup day and verify the kitchen queue planned row is disabled with `PICKUP_REQUEST_REQUIRED`.
4. Try direct dashboard prepare on the planned pickup day and expect 422.
5. Create a pickup request as User A and verify `remainingMeals` decreases.
6. Retry with the same idempotency key and verify no second decrement.
7. Try User B against User A subscription and expect forbidden/not found.
8. Try admin/kitchen tokens against the client pickup endpoint and expect 403 `FORBIDDEN`.
9. Run pickup request prepare -> ready_for_pickup -> fulfill and verify no second decrement.
10. Run no-show and cancel cases and verify balance effects.
11. Run home delivery prepare -> dispatch -> fulfill and verify one `Delivery` per `subscriptionId + date`.
12. Check queue display for no `[object Object]`, raw ObjectId display names, false semantic product warnings, or unknown labels when snapshots exist.

## Permanent Regression Coverage

- `tests/fulfillmentLifecyclePostmanSimulation.test.js` covers multi-user, multi-role, pickup request balance, branch planned-day guards, queue contracts, home delivery, idempotency, no-show, cancel, and display cleanliness.
- Existing supporting suites include `homeDeliveryAndBranchPickupRules`, `subscriptionPickupRequestOps`, `subscriptionPickupRequestClientService`, `subscriptionPickupRequestRoutes`, `subscriptionPickupRequestBalanceService`, `opsPayloadService`, `dashboardKitchenArabicHydration`, and `orderDeliveryLifecycleFixes`.

## Manual Curl Examples

Client pickup request:

```bash
curl -X POST "$baseUrl/api/subscriptions/$pickupSubscriptionAId/pickup-requests" \
  -H "Authorization: Bearer $clientAToken" \
  -H "Content-Type: application/json" \
  -d '{"date":"'"$dateToday"'","mealCount":1,"idempotencyKey":"manual-1"}'
```

Expected admin token on client endpoint:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "This endpoint requires a client access token"
  }
}
```

Direct planned pickup day prepare:

```json
{
  "ok": false,
  "error": {
    "code": "PICKUP_REQUEST_REQUIRED",
    "message": "Pickup preparation requires an explicit client request"
  }
}
```

## Why Branch Pickup Requires `SubscriptionPickupRequest`

Pickup is not a scheduled delivery visit. It is a balance reservation created when the client explicitly requests pickup. The request document is the operational entity that records meal count, reservation state, pickup code, preparation timestamps, consumption/release timestamps, cancellation/no-show state, and audit log. Operating directly on a planned `subscription_day` would bypass reservation semantics and risks double consumption or fulfillment of meals the client did not explicitly request for pickup.
