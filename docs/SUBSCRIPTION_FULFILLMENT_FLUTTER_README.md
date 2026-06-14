# Subscription Fulfillment Flutter Integration

Related docs:

- [Dashboard integration](./SUBSCRIPTION_FULFILLMENT_DASHBOARD_README.md)
- [Backend lifecycle](./SUBSCRIPTION_FULFILLMENT_BACKEND_README.md)

## Purpose

This README is for Flutter/mobile developers. It explains when the app saves meal selections, when it creates Branch Pickup requests, how it displays pickup and delivery statuses, and how to avoid confusing a planned `subscription_day` with an operational `subscription_pickup_request`.

## Core Concepts For Flutter

- `subscription`: the user's active plan and meal balance.
- `subscription_day`: a scheduled/planned day. It stores selected meals and planning state, but it is not itself a Branch Pickup operation.
- `subscription_pickup_request`: the actual Branch Pickup operation created by the app when the user confirms pickup.
- `mealCount`: the number of meals the user wants to reserve in a pickup request.
- `remainingMeals`: the remaining subscription balance. For pickup, it is reserved/decremented when the pickup request is created.
- `idempotencyKey`: a stable client-generated key for one user intent. Reuse it for retries of the same tap/request.
- `pickupCode`: the code shown to the user only after the backend moves the request to `ready_for_pickup`.
- `status`: the pickup request lifecycle status, such as `locked`, `in_preparation`, `ready_for_pickup`, or `fulfilled`.
- `currentStep`: client-friendly progress value returned by the pickup request status mapper.

## Branch Pickup User Flow

1. User opens a subscription day.
2. User selects meal/addons/premium options.
3. App saves planner/selection state.
4. User confirms branch pickup.
5. App must call `POST /api/subscriptions/:subscriptionId/pickup-requests`.
6. App receives `requestId` and `status = locked`.
7. App shows waiting-for-kitchen.
8. App polls/refreshes request status.
9. App shows `pickupCode` only after `ready_for_pickup`.
10. App shows completed after `fulfilled`.

Strong warning:

```txt
Saving or locking subscription_day is not enough. If the app does not call pickup-requests, the dashboard will keep showing entityType=subscription_day with pickupRequestId=null and the preparation button will not appear.
```

## Pickup Request Endpoint

```http
POST /api/subscriptions/:subscriptionId/pickup-requests
Authorization: Bearer <clientToken>
Content-Type: application/json
```

Body:

```json
{
  "date": "YYYY-MM-DD",
  "mealCount": 1,
  "idempotencyKey": "unique-client-generated-key"
}
```

Expected response:

```json
{
  "status": true,
  "data": {
    "requestId": "...",
    "subscriptionId": "...",
    "subscriptionDayId": "...",
    "date": "YYYY-MM-DD",
    "mealCount": 1,
    "currentStep": 2,
    "status": "locked",
    "isReady": false,
    "isCompleted": false,
    "pickupCode": null,
    "creditsReserved": true,
    "nextAction": "poll_pickup_request_status"
  }
}
```

Use `clientToken` only. Admin, kitchen, and courier tokens receive `403 FORBIDDEN`.

Current backend tests/source confirm pickup request creation only accepts today's date.

## Flutter UI States For Branch Pickup

```txt
status=locked:
  show waiting for kitchen
  pickupCode hidden

status=in_preparation:
  show kitchen is preparing
  pickupCode hidden

status=ready_for_pickup:
  show ready for pickup
  show pickupCode

status=fulfilled:
  show completed

status=no_show/canceled:
  show final state and reason if available
```

## Multiple Meals / Multiple Pickup Requests In The Same Day

If the user wants multiple meals in the day, send `mealCount > 1` when that is the intended user action.

Current backend tests confirm multiple pickup requests on the same date are allowed if each request has a distinct `idempotencyKey` and enough remaining balance.

Flutter rules:

- Show `remainingMeals` before confirmation where possible.
- Use a stable `idempotencyKey` for retry of the same tap/request.
- Use a new `idempotencyKey` only for a new user intent.
- Do not submit duplicate requests accidentally.
- If the backend returns insufficient balance or a duplicate constraint error, show a clear user message.

## Home Delivery Flow In Flutter

- Do not call the pickup request endpoint.
- Home Delivery uses subscription day and delivery status.
- App displays delivery states returned by the backend.
- Pickup code is not relevant.

Expected Home Delivery flow:

```txt
open/locked -> prepare -> in_preparation -> dispatch/out_for_delivery -> fulfill/delivered
```

## Flutter Mistakes To Avoid

- Not calling `pickup-requests` after branch pickup confirmation.
- Calling `pickup-requests` with an admin token.
- Showing `pickupCode` before `ready_for_pickup`.
- Treating `remainingMeals` decrement after pickup request creation as an error.
- Creating a new `idempotencyKey` for retry after timeout.
- Assuming `prepare` or `fulfill` are mobile app actions. They are dashboard operations.

## Flutter Manual QA Checklist

```txt
1. Select Branch Pickup subscription day.
2. Save meal selection.
3. Confirm pickup.
4. Verify app calls pickup-requests endpoint.
5. Verify response has requestId and creditsReserved=true.
6. Verify dashboard row becomes subscription_pickup_request.
7. Verify app shows waiting while locked.
8. After dashboard marks ready_for_pickup, verify app shows pickupCode.
9. After fulfillment, verify app shows completed.
10. Test mealCount > 1 if supported by UI.
11. Test retry uses same idempotencyKey.
```
