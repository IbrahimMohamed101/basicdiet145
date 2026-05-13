# Pickup Multi-Request Backend Contract

Last updated: 2026-05-12

## Final Flow

`SubscriptionPickupRequest` is the source of truth for the multi-request pickup lifecycle:

- `status`
- `mealCount`
- `pickupCode`
- `pickupCodeIssuedAt`
- `fulfilledAt`
- `pickupNoShowAt`
- `canceledAt`
- `creditsReserved`
- `creditsReservedAt`
- `creditsConsumedAt`
- `creditsReleasedAt`
- `snapshot`

`SubscriptionDay` remains the planning source for selected meals. In multi-request pickup flow, backend must not write `SubscriptionDay.pickupRequested`, `SubscriptionDay.pickupCode`, or move `SubscriptionDay.status` as part of request lifecycle actions.

Courier/delivery day flow remains day-level and unchanged.

## Audit Summary

Current pickup endpoints:

- `POST /api/subscriptions/:id/pickup-requests`
- `GET /api/subscriptions/:id/pickup-requests`
- `GET /api/subscriptions/:id/pickup-requests/:requestId/status`
- `POST /api/subscriptions/:id/days/:date/pickup/prepare`
- `GET /api/subscriptions/:id/days/:date/pickup/status`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/pickup/queue/:dayId`
- `POST /api/dashboard/pickup/actions/:action`
- `GET /api/dashboard/ops/list`
- `POST /api/dashboard/ops/actions/:action`

Legacy day-level endpoints:

- `POST /api/subscriptions/:id/days/:date/pickup/prepare`
- `GET /api/subscriptions/:id/days/:date/pickup/status`
- kitchen day-level handlers in `src/controllers/kitchenController.js`

Request-level endpoints:

- `POST /api/subscriptions/:id/pickup-requests`
- `GET /api/subscriptions/:id/pickup-requests`
- `GET /api/subscriptions/:id/pickup-requests/:requestId/status`
- dashboard actions with `entityType = "subscription_pickup_request"`

Creation happens in `src/services/subscription/subscriptionPickupRequestClientService.js`.

Balance reservation happens in `reserveSubscriptionMealsForPickupRequest()` in `src/services/subscription/subscriptionPickupRequestBalanceService.js`.

Pickup code generation for the new flow happens only in request-level `ready_for_pickup` action in `src/services/dashboard/opsTransitionService.js`.

Fulfillment for the new flow happens through `fulfillSubscriptionPickupRequest()` in `src/services/fulfillmentService.js`, which consumes already reserved credits and does not decrement `remainingMeals` again.

Legacy fields still exist on `SubscriptionDay` and are used by legacy services/controllers such as `subscriptionPickupClientService`, `kitchenController`, day fulfillment snapshots, and legacy settlement/skip safeguards. They are isolated from the multi-request queue/actions.

The bug was caused by dashboard pickup reads mixing `SubscriptionDay` pickup rows with `SubscriptionPickupRequest` rows. The multi-request pickup queue now excludes pickup `SubscriptionDay` rows, so old day-level `pickupCode` values do not appear beside request-level rows.

`/dashboard/pickup/actions/fulfill` and `/api/dashboard/ops/actions/fulfill` support `subscription_pickup_request` for the new flow. Legacy `subscription_day` actions remain for compatibility.

`allowedActions` can be empty on terminal statuses or when role/mode/state policy rejects the action.

Validation errors now return 4xx for missing/invalid `entityId`, missing/unsupported `entityType`, invalid pickup code, mismatches, and invalid transitions.

## Create Request

`POST /api/subscriptions/:id/pickup-requests`

```json
{
  "date": "2026-05-12",
  "mealCount": 3,
  "idempotencyKey": "uuid"
}
```

Rules:

- `mealCount` must be a positive integer.
- The subscription must be active and `deliveryMode = "pickup"`.
- The request date must be today in KSA date.
- The day planning must be valid/confirmed according to day execution validation.
- `remainingMeals` is reserved atomically.
- `idempotencyKey` returns the same request and does not reserve twice.
- Multiple requests on the same day are allowed while balance remains.
- No `SubscriptionDay.pickupRequested`, `SubscriptionDay.pickupCode`, or `SubscriptionDay.status` writes happen.

Response data follows request status shape with `pickupCode = null` until ready.

## Queue Contract

`GET /api/dashboard/pickup/queue?date=YYYY-MM-DD`

Multi-request subscription pickup rows use:

```json
{
  "source": "subscription_pickup_request",
  "entityType": "subscription_pickup_request",
  "entityId": "...",
  "requestId": "...",
  "subscriptionId": "...",
  "subscriptionDayId": "...",
  "userId": "...",
  "date": "YYYY-MM-DD",
  "mealCount": 3,
  "status": "locked",
  "statusLabel": "Your order is locked",
  "currentStep": 2,
  "isReady": false,
  "isCompleted": false,
  "pickupCode": null,
  "pickupCodeIssuedAt": null,
  "fulfilledAt": null,
  "customer": {},
  "pickup": {
    "pickupLocationId": "...",
    "pickupCode": null,
    "pickupCodeIssuedAt": null
  },
  "context": {
    "date": "YYYY-MM-DD",
    "branch": "Main Branch",
    "mealCount": 3,
    "creditsReserved": true,
    "creditsConsumedAt": null,
    "creditsReleasedAt": null,
    "snapshot": {}
  },
  "allowedActions": []
}
```

Allowed action IDs:

- `locked`: `start_preparation`, `ready_for_pickup`, `cancel`, `no_show`
- `in_preparation`: `ready_for_pickup`, `cancel`, `no_show`
- `ready_for_pickup`: `fulfill`, `no_show`
- `fulfilled`: none
- `no_show`: none
- `canceled`: none

Pickup code visibility:

- `locked`: hidden
- `in_preparation`: hidden
- `ready_for_pickup`: visible
- `fulfilled`: visible if issued
- `no_show`: hidden
- `canceled`: hidden

Legacy `SubscriptionDay` pickup rows are not mixed into this multi-request queue. Legacy day-level endpoints remain available for backward compatibility.

## Dashboard Actions

Use `entityType = "subscription_pickup_request"` for the new flow.

Start preparation:

```json
{
  "entityType": "subscription_pickup_request",
  "entityId": "REQUEST_ID"
}
```

Endpoint:

- `POST /api/dashboard/ops/actions/start_preparation`
- `POST /dashboard/pickup/actions/start_preparation`

`prepare` remains accepted as a backward-compatible alias.

Ready for pickup:

```json
{
  "entityType": "subscription_pickup_request",
  "entityId": "REQUEST_ID"
}
```

Endpoint:

- `POST /api/dashboard/ops/actions/ready_for_pickup`
- `POST /dashboard/pickup/actions/ready-for-pickup`

On transition, backend generates a six-digit `pickupCode` on `SubscriptionPickupRequest` only.

Fulfill:

```json
{
  "entityType": "subscription_pickup_request",
  "entityId": "REQUEST_ID",
  "code": "123456"
}
```

Rules:

- Only `ready_for_pickup` can be fulfilled.
- `code` is required and must match `SubscriptionPickupRequest.pickupCode`.
- Fulfillment sets `fulfilledAt`.
- Fulfillment consumes reserved pickup meals.
- Fulfillment does not decrement `remainingMeals` again.
- Fulfillment does not use `SubscriptionDay.creditsDeducted`.

No-show:

```json
{
  "entityType": "subscription_pickup_request",
  "entityId": "REQUEST_ID"
}
```

Rules:

- `locked`, `in_preparation`, and `ready_for_pickup` can become `no_show`.
- No-show consumes reserved pickup meals.
- No-show does not release reserved meals.

Cancel:

```json
{
  "entityType": "subscription_pickup_request",
  "entityId": "REQUEST_ID"
}
```

Rules:

- `locked` and `in_preparation` can be canceled.
- Cancel releases reserved pickup meals once.
- Cancel is not allowed after `ready_for_pickup`, `fulfilled`, or `no_show`.

## Status Endpoint

`GET /api/subscriptions/:id/pickup-requests/:requestId/status`

```json
{
  "requestId": "...",
  "subscriptionId": "...",
  "date": "YYYY-MM-DD",
  "mealCount": 3,
  "currentStep": 2,
  "status": "locked",
  "statusLabel": "...",
  "message": "...",
  "isReady": false,
  "isCompleted": false,
  "pickupCode": null,
  "pickupCodeIssuedAt": null,
  "fulfilledAt": null
}
```

Status mapping:

- `locked`: `currentStep = 2`, code hidden, polling continues
- `in_preparation`: `currentStep = 3`, code hidden, polling continues
- `ready_for_pickup`: `currentStep = 4`, ready, code visible
- `fulfilled`: `currentStep = 4`, completed, code visible if issued
- `no_show`: `currentStep = 4`, completed, code hidden
- `canceled`: `currentStep = 1`, completed, code hidden

## Overview

For pickup subscriptions using the new flow:

```json
{
  "pickupPreparation": {
    "mode": "multi_request",
    "flowStatus": "available",
    "canCreatePickupRequest": true,
    "availableMealBalance": 4,
    "activePickupRequestCount": 1,
    "latestPickupRequest": {}
  }
}
```

Rules:

- Previous `fulfilled`, `no_show`, or `canceled` requests do not block a new request if balance remains.
- `SubscriptionDay.pickupRequested` does not block multi-request creation.
- Terminal `SubscriptionDay.status` does not block multi-request creation if planning and balance rules pass.

## Settlement

Daily settlement processes active request-level pickups:

- `locked` -> `no_show`
- `in_preparation` -> `no_show`
- `ready_for_pickup` -> `no_show`

Settlement calls `consumeReservedPickupMeals()` and does not decrement `remainingMeals` again. `fulfilled`, `no_show`, and `canceled` requests are not touched. Settlement is idempotent.

## Error Codes

- Missing `entityId`: `400 INVALID_REQUEST` with `entityId is required`
- Invalid `entityId`: `400 INVALID_ENTITY_ID` with `Invalid entityId`
- Missing `entityType`: `400 INVALID_REQUEST` with `entityType is required`
- Unsupported `entityType`: `400 INVALID_ENTITY_TYPE`
- Missing fulfill code: `400 INVALID_PICKUP_CODE` with `Pickup code is required`
- Invalid code format: `400 INVALID_PICKUP_CODE` with `Pickup code must be a 6-digit value`
- Code mismatch: `422 PICKUP_CODE_MISMATCH`
- Fulfill before ready: `409 INVALID_TRANSITION`
- Invalid ready/cancel/no-show transitions: `409 INVALID_TRANSITION`
- Insufficient reservation credits: `422 INSUFFICIENT_CREDITS`

Unexpected exceptions are the only errors that should return 500.

## Integration Notes

Dashboard:

- For subscription pickup multi-request rows, use `entityType = "subscription_pickup_request"` and `entityId = requestId`.
- Use `allowedActions[].id` for action buttons.
- Send `code` at the top level for fulfill; `payload.pickupCode` remains accepted for older callers.

Flutter:

- Use `pickupPreparation.mode = "multi_request"` to switch to request-level APIs.
- Create requests with `POST /api/subscriptions/:id/pickup-requests`.
- Poll request-level status by `requestId`.
- Do not call day-level legacy pickup prepare/status endpoints for multi-request mode.

Legacy:

- Day-level pickup prepare/status, `kitchenController.verifyPickup`, and day-level fulfillment remain for existing clients.
- Legacy day-level `pickupRequested` and `pickupCode` are not used by multi-request queue/actions.
