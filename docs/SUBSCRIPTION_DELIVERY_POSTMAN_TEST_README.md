# Subscription Home Delivery Postman Test

This guide verifies Home Delivery subscription operations. Home Delivery uses `subscription_day` as the operational entity. It does not create or require `subscription_pickup_request`.

Canonical delivery lifecycle:

```text
open -> in_preparation -> out_for_delivery -> fulfilled
```

Cancel/reopen lifecycle:

```text
open -> delivery_canceled -> open
```

## Seed Data

Use a local/test/dev database only. The script refuses unsafe database names unless `ALLOW_HOME_DELIVERY_POSTMAN_SEED=true` is set.

```bash
NODE_ENV=development node scripts/seedHomeDeliveryPostmanCycle.js
```

Optional fixed date:

```bash
NODE_ENV=development node scripts/seedHomeDeliveryPostmanCycle.js --date=2026-06-20
```

The script resets only rows tagged `postman-home-delivery-cycle` by default and prints Postman variables:

```json
{
  "baseUrl": "http://localhost:5000",
  "testDate": "YYYY-MM-DD",
  "adminEmail": "postman-home-delivery-cycle-admin@example.com",
  "adminPassword": "PostmanAdmin@123",
  "kitchenEmail": "postman-home-delivery-cycle-kitchen@example.com",
  "kitchenPassword": "PostmanAdmin@123",
  "courierEmail": "postman-home-delivery-cycle-courier@example.com",
  "courierPassword": "PostmanAdmin@123",
  "clientOnePhone": "postman-home-delivery-cycle-happy",
  "clientOnePassword": "Client12345",
  "deliverySubscriptionId": "...",
  "deliverySubscriptionDayId": "...",
  "entityType": "subscription_day",
  "entityId": "...",
  "deliveryId": "",
  "pickupRequestId": "",
  "emptySubscriptionDayId": "...",
  "unpaidSubscriptionDayId": "...",
  "cancelSubscriptionDayId": "...",
  "multiMealSubscriptionDayId": "...",
  "expectedMealCount": "1",
  "expectedMultiMealCount": "3"
}
```

Start the API separately:

```bash
npm start
```

## Authentication

Admin login:

```http
POST {{baseUrl}}/api/dashboard/auth/login
Content-Type: application/json

{
  "email": "{{adminEmail}}",
  "password": "{{adminPassword}}"
}
```

Save `token` as `adminToken`.

Kitchen login uses `{{kitchenEmail}}`; save as `kitchenToken`. Courier login uses `{{courierEmail}}`; save as `courierToken`.

## A. Happy Path

Get the Home Delivery kitchen queue:

```http
GET {{baseUrl}}/api/dashboard/kitchen/queue?date={{testDate}}&method=delivery
Authorization: Bearer {{adminToken}}
Accept-Language: en
```

Expected row for `{{deliverySubscriptionDayId}}`:

```json
{
  "ids": {
    "entityType": "subscription_day",
    "entityId": "{{deliverySubscriptionDayId}}",
    "subscriptionDayId": "{{deliverySubscriptionDayId}}",
    "deliveryId": null,
    "pickupRequestId": null
  },
  "source": { "status": "open" },
  "fulfillment": {
    "type": "home_delivery",
    "delivery": { "status": null },
    "pickup": { "pickupRequestId": null }
  },
  "payment": { "canPrepare": true },
  "actions": { "canPrepare": true },
  "dataQuality": { "warnings": [] }
}
```

Prepare:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/prepare
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{deliverySubscriptionDayId}}"
}
```

Expected: `200`, `data.status` or `data.source.status` is `in_preparation`.

Dispatch:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/dispatch
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{deliverySubscriptionDayId}}",
  "payload": { "etaAt": "2026-06-20T13:00:00.000Z" }
}
```

Expected: `200`, status `out_for_delivery`, and queue `ids.deliveryId`/`fulfillment.delivery.deliveryId` is set after reload.

Fulfill:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/fulfill
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{deliverySubscriptionDayId}}"
}
```

Expected: `200`, status `fulfilled`, `timestamps.fulfilledAt` present after queue reload, and no pickup code/request.

## B. Planned Day Without Meals

```http
GET {{baseUrl}}/api/dashboard/kitchen/queue?date={{testDate}}&method=delivery
Authorization: Bearer {{adminToken}}
```

Expected row for `{{emptySubscriptionDayId}}`:

```json
{
  "kitchen": { "meals": [] },
  "actions": { "canPrepare": false },
  "payment": { "canPrepare": false },
  "dataQuality": {
    "warnings": [{ "code": "EMPTY_KITCHEN_MEALS" }]
  }
}
```

Prepare should fail:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/prepare
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{emptySubscriptionDayId}}"
}
```

Expected: `422`, `error.code=EMPTY_KITCHEN_MEALS`.

## C. Payment Required

Expected queue row for `{{unpaidSubscriptionDayId}}`:

```json
{
  "payment": {
    "paymentRequired": true,
    "pendingUnpaid": true,
    "canPrepare": false,
    "reason": "PREMIUM_PAYMENT_REQUIRED"
  },
  "actions": { "canPrepare": false }
}
```

Prepare should fail:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/prepare
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{unpaidSubscriptionDayId}}"
}
```

Expected: `409`, `error.code=PREMIUM_PAYMENT_REQUIRED`.

## D. Invalid Transitions

Dispatch before prepare:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/dispatch
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{multiMealSubscriptionDayId}}"
}
```

Expected: `409`, `error.code=INVALID_TRANSITION`.

Fulfill before dispatch:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/fulfill
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{multiMealSubscriptionDayId}}"
}
```

Expected: `409`, `error.code=INVALID_TRANSITION`.

## E. Cancel And Reopen

Cancel:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/cancel
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{cancelSubscriptionDayId}}",
  "payload": {
    "reason": "postman_test_cancel",
    "note": "Cancel before preparation"
  }
}
```

Expected: `200`, status `delivery_canceled`. Queue `actions.allowed` should include `reopen` for admin.

Reopen:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/reopen
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{cancelSubscriptionDayId}}"
}
```

Expected: `200`, status `open`, prepare action restored if the day has meals and no payment block.

## F. No-Show Equivalent

Home Delivery does not support `no_show`. The delivery failure/cancel equivalent is `delivery_canceled` through the `cancel` action. `no_show` is pickup-only and should fail for delivery with `INVALID_MODE_FOR_ACTION` or `INVALID_TRANSITION`.

## G. Multiple Meals Per Day

Queue row for `{{multiMealSubscriptionDayId}}` should show:

```json
{
  "orderSummary": { "mealCount": 3 },
  "kitchen": { "meals": ["length: 3"] },
  "ids": { "pickupRequestId": null }
}
```

Run `prepare -> dispatch -> fulfill` using `{{multiMealSubscriptionDayId}}`. Expected remaining meal balance decreases by 3 once; duplicate fulfill must not decrement again.

## H. Authorization

No token:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/prepare
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{deliverySubscriptionDayId}}"
}
```

Expected: `401`.

Client token against dashboard action:

```http
POST {{baseUrl}}/api/dashboard/ops/actions/prepare
Authorization: Bearer {{clientToken}}
Content-Type: application/json

{
  "entityType": "subscription_day",
  "entityId": "{{deliverySubscriptionDayId}}"
}
```

Expected: `401` or `403`. Dashboard ops require dashboard roles. Kitchen can prepare; courier can dispatch/fulfill delivery; admin/superadmin can perform the full lifecycle.

## I. Queue Contract Checklist

For every state, verify:

- `ids.entityType=subscription_day`
- `ids.entityId` equals the action payload `entityId`
- `ids.subscriptionDayId` is set
- `ids.deliveryId` is null before dispatch and set after dispatch
- `ids.pickupRequestId=null`
- `source.status` is canonical backend status
- `fulfillment.type=home_delivery`
- `fulfillment.delivery.status` follows `out_for_delivery` then `delivered`
- `fulfillment.pickup.pickupRequestId=null`
- `payment.canPrepare` and `payment.canFulfill` match payment state
- `actions.allowed`, `actions.disabled`, `actions.canPrepare`, `actions.canDispatch`, `actions.canFulfill` match the current status
- `timestamps.preparedAt` is currently not populated for Home Delivery prepare; use `source.status=in_preparation`
- `timestamps.fulfilledAt` is populated after fulfill
- `dataQuality.warnings` contains `EMPTY_KITCHEN_MEALS` only for no-meal rows

## Automated Regression

```bash
NODE_ENV=test node tests/homeDeliveryPostmanContract.test.js
NODE_ENV=test node tests/homeDeliveryAndBranchPickupRules.test.js
npm run test:subscriptions
```
