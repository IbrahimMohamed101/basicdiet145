# Subscription Fulfillment Dashboard Integration

Related docs:

- [Flutter integration](./SUBSCRIPTION_FULFILLMENT_FLUTTER_README.md)
- [Backend lifecycle](./SUBSCRIPTION_FULFILLMENT_BACKEND_README.md)

## Purpose

This README is for Dashboard/operations UI developers. It explains how to render kitchen queue rows and execute operational actions for Home Delivery and Branch Pickup.

## Dashboard Source Of Truth

Dashboard must call:

```http
GET /api/dashboard/kitchen/queue?date=YYYY-MM-DD
```

Dashboard must render from:

- `item.ids`
- `item.source`
- `item.fulfillment`
- `item.actions.allowed`
- `item.actions.disabled`
- `item.actions.canPrepare`
- `item.actions.canReadyForPickup`
- `item.actions.canFulfill`
- `item.actions.canNoShow`

Do not hardcode lifecycle transitions that contradict the queue contract.

## Entity Targeting Rule

Dashboard action payloads must use:

```json
{
  "entityType": "<item.ids.entityType>",
  "entityId": "<item.ids.entityId>"
}
```

Do not use `subscriptionDayId` as `entityId` when the row is `subscription_pickup_request`.

## Branch Pickup Row Types

### Planned Day Only

```txt
entityType=subscription_day
pickupRequestId=null
fulfillment.type=branch_pickup
```

Expected dashboard behavior:

```txt
do not show prepare as clickable
show disabled reason PICKUP_REQUEST_REQUIRED if desired
```

The expected queue gates are:

```txt
canPrepare=false
disabled.prepare.reason=PICKUP_REQUEST_REQUIRED
```

### Operational Pickup Request

```txt
entityType=subscription_pickup_request
pickupRequestId exists
```

Expected dashboard behavior:

```txt
render operational buttons from actions.allowed
```

## Branch Pickup Dashboard Lifecycle/Buttons

Locked pickup request:

```txt
status=locked
allowed=prepare,cancel
canPrepare=true
show clickable "تحضير الطلب"
```

In preparation:

```txt
status=in_preparation
allowed=ready_for_pickup,cancel
canReadyForPickup=true
canFulfill=false
show clickable "جاهز للاستلام"
do not show/enable "تسليم الطلب" yet
```

Ready for pickup:

```txt
status=ready_for_pickup
allowed=fulfill,no_show
canFulfill=true
canNoShow=true
show clickable "تسليم الطلب"
show no_show if returned
```

Fulfilled:

```txt
status=fulfilled
no operational action except details/reopen if returned
```

## Button Enablement Rules

```txt
prepare             enabled by canPrepare
ready_for_pickup    enabled by canReadyForPickup
fulfill             enabled by canFulfill
cancel              enabled by canCancel
no_show             enabled by canNoShow
reopen              enabled by canReopen
dispatch            enabled if returned in actions.allowed and not disabled
```

Important warnings:

```txt
Do not disable ready_for_pickup because canFulfill=false.
canFulfill must remain false until ready_for_pickup succeeds.
Do not show fulfill immediately after prepare. The next action after prepare is ready_for_pickup.
```

## Action Execution

For each action use:

- `action.endpoint`
- `action.method`
- `action.requiresReason`
- `ids.entityType`
- `ids.entityId`

Payload without reason:

```json
{
  "entityType": "<item.ids.entityType>",
  "entityId": "<item.ids.entityId>"
}
```

Payload with reason:

```json
{
  "entityType": "<item.ids.entityType>",
  "entityId": "<item.ids.entityId>",
  "payload": {
    "reason": "..."
  }
}
```

Current source/tests confirm reasoned dashboard actions use `payload.reason`.

Preparation action:

```txt
Dashboard-compatible action id: prepare
Endpoint: /api/dashboard/ops/actions/prepare
Alias still supported: /api/dashboard/ops/actions/start_preparation
```

Use the returned `prepare` action from `actions.allowed`.

## Home Delivery Dashboard Lifecycle

```txt
open/locked -> prepare -> in_preparation -> dispatch/out_for_delivery -> fulfill/delivered
```

Home Delivery uses `subscription_day` and the delivery row. It does not create or target a `subscription_pickup_request`.

Render actions from backend `actions.allowed`. Home Delivery rows commonly target:

```txt
entityType=subscription_day
entityId=<item.ids.entityId>
```

## Dashboard Mistakes To Avoid

- Hardcoding action rules instead of using `actions.allowed`.
- Using `subscriptionDayId` instead of `ids.entityId`.
- Treating all Branch Pickup rows as `subscription_day`.
- Hiding prepare for `subscription_pickup_request`.
- Disabling `ready_for_pickup` because `canFulfill` is false.
- Showing fulfill directly after prepare.
- Sending `ready_for_pickup` before `prepare`.
- Assuming `start_preparation` is the public dashboard action id; use returned `prepare`.
- Ignoring disabled reason `PICKUP_REQUEST_REQUIRED`.

## Dashboard Manual QA Checklist

Branch Pickup:

```txt
1. Before pickup request: row is subscription_day, pickupRequestId=null, prepare disabled.
2. After app creates pickup request: row is subscription_pickup_request, prepare button appears.
3. Click prepare.
4. Row becomes in_preparation with preparedAt non-null.
5. Ready for pickup button appears and is clickable.
6. Click ready_for_pickup.
7. Row becomes ready_for_pickup; pickupCode issued.
8. Fulfill button appears and is clickable.
9. Click fulfill.
10. Row becomes fulfilled.
11. remainingMeals does not double decrement.
```

Home Delivery:

```txt
1. Row is subscription_day.
2. Prepare appears when allowed.
3. Dispatch appears after preparation if delivery flow requires it.
4. Fulfill appears after dispatch/out_for_delivery.
```
