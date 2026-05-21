# Order Delivery / Handoff Cycle

This audit documents the backend behavior currently implemented for dashboard/kitchen delivery and handoff operations. It is based on the code paths in:

- `src/services/dashboard/opsActionPolicy.js`
- `src/services/dashboard/opsTransitionService.js`
- `src/services/dashboard/dashboardDtoService.js`
- `src/controllers/dashboard/opsBoardController.js`
- `src/controllers/dashboard/opsActionController.js`
- `src/services/orders/orderOpsTransitionService.js`
- `src/services/orders/orderDashboardService.js`
- `src/models/SubscriptionDay.js`
- `src/models/SubscriptionPickupRequest.js`
- `src/models/Subscription.js`
- `src/models/Order.js`
- `src/models/Delivery.js`
- related legacy kitchen routes/controllers and tests under `tests/`

## 1. Entities Covered

### `subscription_day`

Subscription day items are stored in the `SubscriptionDay` model (`src/models/SubscriptionDay.js`). Each row belongs to a parent `Subscription` via `subscriptionId` and represents a single operational day in a subscription.

The parent `Subscription` model stores the subscription fulfillment mode in `deliveryMode`.

Dashboard DTO shape:

- `source`: `subscription`
- `entityType`: `subscription_day`
- `type`: `subscription`
- `status`: copied from `SubscriptionDay.status`
- `mode`: resolved from `Subscription.deliveryMode`
- `allowedActions`: action DTO objects

### `subscription_pickup_request`

There is also a separate pickup request entity stored in `SubscriptionPickupRequest` (`src/models/SubscriptionPickupRequest.js`). It is not the same as a `subscription_day`, but it appears in the dashboard kitchen queue for pickup flows.

Dashboard DTO shape:

- `source`: `subscription_pickup_request`
- `entityType`: `subscription_pickup_request`
- `type`: `subscription_pickup_request`
- `status`: mapped request status
- `mode`: `pickup`
- `allowedActions`: action DTO objects

### Individual order / one-time order

One-time orders are stored in the `Order` model (`src/models/Order.js`). The operational dashboard order service treats these as canonical individual orders.

Dashboard DTO shape:

- `source`: `one_time_order`
- `entityType`: `order`
- `type`: `order`
- `status`: normalized through `normalizeLegacyOrderStatus`
- `fulfillmentMethod`: resolved mode
- `mode`: resolved mode
- `allowedActions`: action DTO objects

## 2. Fulfillment Modes

### Pickup from branch

Subscription pickup is identified by:

- `Subscription.deliveryMode === "pickup"`

One-time order pickup is identified by:

- `Order.fulfillmentMethod === "pickup"`, or
- fallback legacy field `Order.deliveryMode === "pickup"`

Possible values:

- `pickup`
- `delivery`

Effects on allowed actions:

- Subscription days use `opsActionPolicy.getAllowedActions`.
- Actions with `modes: ["pickup"]` are only returned for pickup rows. Currently this applies to `ready_for_pickup` and `no_show`.
- One-time orders use `getAllowedOrderActions`, which returns pickup-specific `ready_for_pickup` from `in_preparation`, then `fulfill` from `ready_for_pickup`.

Effects on status transitions:

- Subscription pickup days can move from `in_preparation` to `ready_for_pickup`, then `fulfilled`.
- One-time pickup orders can move from `confirmed` to `in_preparation` to `ready_for_pickup` to `fulfilled`.
- The backend uses the final status `fulfilled`; it does not currently store final statuses named `picked_up` or `completed`.

### Home delivery

Subscription delivery is identified by:

- `Subscription.deliveryMode !== "pickup"`; DTO mapping treats anything else as `delivery`.

One-time order delivery is identified by:

- `Order.fulfillmentMethod === "delivery"`, or
- fallback legacy field `Order.deliveryMode === "delivery"`

Possible values:

- `delivery`
- `pickup`

Effects on allowed actions:

- Subscription delivery rows receive `dispatch` from `in_preparation` and `notify_arrival`/`fulfill` from `out_for_delivery`.
- One-time delivery orders receive `dispatch` from `in_preparation` and `notify_arrival`/`fulfill` from `out_for_delivery`.
- One-time delivery orders are completely hidden/blocked unless `ONE_TIME_ORDER_DELIVERY_ENABLED === "true"`.

Effects on status transitions:

- Subscription delivery days can move from `open`/`locked` to `in_preparation`, then `out_for_delivery`, then `fulfilled`.
- One-time delivery orders can move from `confirmed` to `in_preparation` to `out_for_delivery` to `fulfilled`.
- The backend uses `fulfilled` for the final order/day status and `Delivery.status = "delivered"` for the delivery-side record where that record is updated.

## 3. Subscription Day Lifecycle

Implemented `SubscriptionDay.status` values:

- `open`
- `frozen`
- `locked`
- `in_preparation`
- `out_for_delivery`
- `ready_for_pickup`
- `fulfilled`
- `consumed_without_preparation`
- `delivery_canceled`
- `canceled_at_branch`
- `no_show`
- `skipped`

Implemented transition validator in `src/utils/state.js`:

```text
open -> locked, in_preparation, skipped, frozen, delivery_canceled, canceled_at_branch
locked -> open, in_preparation, out_for_delivery, delivery_canceled, canceled_at_branch
in_preparation -> out_for_delivery, ready_for_pickup, delivery_canceled, canceled_at_branch
out_for_delivery -> fulfilled, delivery_canceled
ready_for_pickup -> fulfilled, canceled_at_branch, no_show
delivery_canceled -> open
canceled_at_branch -> open
no_show -> open
```

### Subscription day action table

| Current status | Fulfillment mode | Allowed action | Endpoint | Method | Roles | Next status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `open` | delivery | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | `in_preparation` | Executes through `handlePrepare`. |
| `open` | delivery | `lock` / Lock Day | `/api/dashboard/ops/actions/lock` | POST | `superadmin`, `admin`, `kitchen` | `locked` | Executes through `handleLock`; sets `lockedAt`. |
| `open` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `delivery_canceled` | Executes. |
| `locked` | delivery | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | `in_preparation` | Executes. |
| `locked` | delivery | `reopen` / Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | `open` | Executes. |
| `locked` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `delivery_canceled` | Executes. |
| `in_preparation` | delivery | `dispatch` / Dispatch | `/api/dashboard/ops/actions/dispatch` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `out_for_delivery` | Executes and upserts `Delivery` with `status: "out_for_delivery"`. |
| `in_preparation` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `delivery_canceled` | Executes. |
| `out_for_delivery` | delivery | `notify_arrival` / Notify Arrival | `/api/dashboard/ops/actions/notify_arrival` | POST | `superadmin`, `admin`, `courier` | `out_for_delivery` | Does not change day status; sets `Delivery.arrivingSoonReminderSentAt`. Requires an existing `Delivery`. |
| `out_for_delivery` | delivery | `fulfill` / Fulfill | `/api/dashboard/ops/actions/fulfill` | POST | `superadmin`, `admin`, `courier`, `kitchen` | `fulfilled` | Executes through `fulfillSubscriptionDay`; updates `Delivery.status` to `delivered`. |
| `out_for_delivery` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `delivery_canceled` | Executes; syncs `Delivery.status` to `canceled`. |
| `open` | pickup | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | Intended `in_preparation` | Advertised, but execution requires `pickupRequested`; without it returns `PICKUP_PREPARE_REQUIRED`. |
| `open` | pickup | `lock` / Lock Day | `/api/dashboard/ops/actions/lock` | POST | `superadmin`, `admin`, `kitchen` | `locked` | Executes in unified ops without checking `pickupRequested`. Legacy kitchen lock path does check pickup readiness. |
| `open` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `canceled_at_branch` | Executes. Courier is filtered out for pickup cancel by validation. |
| `locked` | pickup | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | Intended `in_preparation` | Advertised, but execution requires `pickupRequested`. |
| `locked` | pickup | `reopen` / Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | `open` | Executes. |
| `locked` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `canceled_at_branch` | Executes. |
| `in_preparation` | pickup | `ready_for_pickup` / Ready for Pickup | `/api/dashboard/ops/actions/ready_for_pickup` | POST | `superadmin`, `admin`, `kitchen` | `ready_for_pickup` | Executes only if pickup day was requested and status is `in_preparation`; issues pickup code. |
| `in_preparation` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `canceled_at_branch` | Executes. |
| `ready_for_pickup` | pickup | `fulfill` / Fulfill | `/api/dashboard/ops/actions/fulfill` | POST | `superadmin`, `admin`, `kitchen` | `fulfilled` | Staff visually compares the customer code with the dashboard code, then presses fulfill. No `pickupCode` payload is required; fulfillment stores verification metadata. |
| `ready_for_pickup` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `canceled_at_branch` | Executes. |
| `ready_for_pickup` | pickup | `no_show` / No-show | `/api/dashboard/ops/actions/no_show` | POST | `superadmin`, `admin`, `kitchen` | `no_show` | Executes for branch pickup only. |
| `delivery_canceled` | delivery/pickup | `reopen` / Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | `open` | Policy exposes this status under subscription rules. |
| `canceled_at_branch` | delivery/pickup | `reopen` / Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | `open` | Policy exposes this status under subscription rules. |
| `no_show` | delivery/pickup | `reopen` / Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | `open` | Policy exposes this status under subscription rules. |
| `fulfilled` | delivery/pickup | none | n/a | n/a | n/a | terminal | No allowed dashboard actions. |
| `skipped` | delivery/pickup | none | n/a | n/a | n/a | terminal in policy | No allowed dashboard actions. |
| `frozen` | delivery/pickup | none | n/a | n/a | n/a | terminal in policy | No allowed dashboard actions. |

## 4. Individual Order Lifecycle

Implemented canonical `Order.status` values:

- `pending_payment`
- `confirmed`
- `in_preparation`
- `ready_for_pickup`
- `out_for_delivery`
- `fulfilled`
- `cancelled`
- `expired`

Legacy normalization:

- `created` becomes `confirmed` when `paymentStatus === "paid"`, otherwise `pending_payment`
- `preparing` becomes `in_preparation`
- `canceled` / `cancelled` becomes `cancelled`
- `delivered` becomes `fulfilled`

Implemented order transition validator:

```text
pending_payment -> confirmed, cancelled, expired
confirmed -> in_preparation, cancelled
in_preparation -> ready_for_pickup, out_for_delivery, cancelled
ready_for_pickup -> fulfilled, cancelled
out_for_delivery -> fulfilled, cancelled
```

The dashboard action endpoints for orders route to `orderDashboardService.executeDashboardOrderAction`, which uses `orderOpsTransitionService.executeOrderAction`.

### Individual order action table

| Current status | Fulfillment mode | Allowed action | Endpoint | Method | Roles | Next status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pending_payment` | pickup/delivery | none | n/a | n/a | n/a | n/a | Operational actions require `paymentStatus: "paid"`. |
| `confirmed` | pickup | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | `in_preparation` | Sets `preparationStartedAt`. |
| `confirmed` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Sets cancellation fields and writes `ActivityLog`. |
| `in_preparation` | pickup | `ready_for_pickup` / Ready for Pickup | `/api/dashboard/ops/actions/ready_for_pickup` | POST | `superadmin`, `admin`, `kitchen` | `ready_for_pickup` | Sets `readyAt`, `pickup.readyAt`, pickup code fields. |
| `in_preparation` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Executes. |
| `ready_for_pickup` | pickup | `fulfill` / Fulfill | `/api/dashboard/ops/actions/fulfill` | POST | `superadmin`, `admin`, `kitchen` | `fulfilled` | Staff visually compares the customer code with the dashboard code, then presses fulfill. No `pickupCode` payload is required; sets `fulfilledAt`, `pickup.pickedUpAt`, and pickup verification timestamps. |
| `ready_for_pickup` | pickup | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Executes. |
| `confirmed` | delivery | `prepare` / Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | `in_preparation` | Only available when one-time delivery feature flag is enabled. |
| `confirmed` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Only available when one-time delivery feature flag is enabled; upserts/updates `Delivery.status = "canceled"`. |
| `in_preparation` | delivery | `dispatch` / Dispatch | `/api/dashboard/ops/actions/dispatch` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `out_for_delivery` | Sets `dispatchedAt`; upserts `Delivery.status = "out_for_delivery"`. |
| `in_preparation` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Updates `Delivery.status = "canceled"`; courier cannot cancel one-time orders through the dedicated order service. |
| `out_for_delivery` | delivery | `notify_arrival` / Notify Arrival | `/api/dashboard/ops/actions/notify_arrival` | POST | `superadmin`, `admin`, `courier` | `out_for_delivery` | Writes activity log; no status change. |
| `out_for_delivery` | delivery | `fulfill` / Fulfill | `/api/dashboard/ops/actions/fulfill` | POST | `superadmin`, `admin`, `courier` | `fulfilled` | Sets `fulfilledAt`; updates `Delivery.status = "delivered"`. |
| `out_for_delivery` | delivery | `cancel` / Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen` | `cancelled` | Updates `Delivery.status = "canceled"`; courier is not allowed in `orderOpsTransitionService`. |
| `fulfilled` | pickup/delivery | none | n/a | n/a | n/a | terminal | No allowed dashboard actions. |
| `cancelled` | pickup/delivery | none | n/a | n/a | n/a | terminal | No reopen support in dedicated one-time order ops. |
| `expired` | pickup/delivery | none | n/a | n/a | n/a | terminal | No allowed dashboard actions. |

## 5. Kitchen Queue Behavior

Primary endpoint:

```text
GET /api/dashboard/kitchen/queue
```

Mounted from `src/routes/dashboardBoards.js`, implemented by `opsBoardController.queue` and `queryBoardDays`.

The response uses:

- `status` at the top level as a boolean request result
- `data.items[]`
- item-level `status`
- item-level `type`
- item-level `entityType`
- item-level `allowedActions` as action DTO objects, not strings
- no `itemStatus` field in this queue DTO

Example shape:

```json
{
  "status": true,
  "data": {
    "date": "2026-05-10",
    "summary": {
      "total": 1
    },
    "items": [
      {
        "entityType": "subscription_day",
        "type": "subscription",
        "status": "open",
        "deliveryMethod": "delivery",
        "allowedActions": [
          {
            "id": "prepare",
            "label": "Start Preparation",
            "endpoint": "/api/dashboard/ops/actions/prepare",
            "method": "POST"
          }
        ]
      }
    ]
  }
}
```

### Default subscription day inclusion

For `screen === "kitchen"`, default subscription statuses included are:

- `open`
- `locked`
- `in_preparation`
- `ready_for_pickup`
- `out_for_delivery`
- `delivery_canceled`
- `canceled_at_branch`

If the requested date is before the restaurant business date, the queue also includes:

- `consumed_without_preparation`
- `no_show`

For a `subscription_day` with `status: "open"`:

- delivery mode returns `prepare`, `lock`, `cancel` for kitchen/admin roles.
- pickup mode also returns `prepare`, `lock`, `cancel`, but `prepare` may fail unless `pickupRequested` is true.

For `status: "in_preparation"`:

- delivery mode returns `dispatch`, `cancel`.
- pickup mode returns `ready_for_pickup`, `cancel`.

For later statuses:

- delivery `out_for_delivery` returns `notify_arrival`, `fulfill`, `cancel`.
- pickup `ready_for_pickup` returns `fulfill`, `cancel`.
- terminal statuses like `fulfilled`, `skipped`, `frozen` return no actions.

### Default one-time order inclusion

For `screen === "kitchen"`, default one-time order statuses included are:

- `confirmed`
- `in_preparation`
- legacy `preparing`

The default kitchen queue does not include one-time orders already in `ready_for_pickup`, `out_for_delivery`, `fulfilled`, or `cancelled` unless the caller passes a `status` query that maps to those states.

One-time orders are also filtered by:

- `fulfillmentDate`
- `paymentStatus: "paid"`
- fulfillment `method` query if supplied
- one-time delivery feature gate (`ONE_TIME_ORDER_DELIVERY_ENABLED`)

Example one-time pickup order in `confirmed`:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "type": "order",
  "mode": "pickup",
  "status": "confirmed",
  "fulfillmentMethod": "pickup",
  "allowedActions": [
    {
      "id": "prepare",
      "label": "Start Preparation",
      "endpoint": "/api/dashboard/ops/actions/prepare",
      "method": "POST"
    },
    {
      "id": "cancel",
      "label": "Cancel",
      "endpoint": "/api/dashboard/ops/actions/cancel",
      "method": "POST",
      "requiresReason": true
    }
  ]
}
```

### Pickup request inclusion

When `method` is `all` or `pickup`, the kitchen queue also includes `subscription_pickup_request` rows with default statuses:

- `locked`
- `in_preparation`
- `ready_for_pickup`

These rows use their own lifecycle and are not the same as `subscription_day` rows.

### Pickup code behavior

For branch pickup, `fulfilled` means the customer has collected the item from the branch.

Implemented behavior:

- `subscription_day` pickup generates `pickupCode` and `pickupCodeIssuedAt` when the day moves to `ready_for_pickup`.
- one-time pickup orders generate `pickupCode`/`pickup.pickupCode` and `pickupCodeIssuedAt` when the order moves to `ready_for_pickup`.
- `subscription_pickup_request` also generates a pickup code in its ready flow and uses the same dashboard visual verification behavior.
- Customer-owned subscription day APIs return the pickup code for the owner after the day is `ready_for_pickup`.
- Customer-owned order APIs return the pickup code for the owner after the order is `ready_for_pickup`.
- Dashboard queue/detail DTOs return the same pickup code to authenticated dashboard users who can see the row.
- Staff visually compares the code shown by the customer with the same code in the dashboard.
- Dashboard pickup `fulfill` does not require or validate a `pickupCode` request payload.
- Fulfill remains protected by dashboard authentication, role permissions, and state transition rules.
- Successful pickup fulfillment stores verification metadata:
  - subscription days: `pickupVerifiedAt`, `pickupVerifiedByDashboardUserId`
  - one-time orders: `pickupVerifiedAt`, `pickupVerifiedByDashboardUserId`, `pickup.pickedUpAt`

### Delivery record sync behavior

For home delivery, `fulfilled` means the item was handed off to the customer. The primary entity remains `fulfilled`; the `Delivery` record uses `delivered`.

Implemented behavior:

- subscription day `dispatch` upserts `Delivery.status = "out_for_delivery"`.
- subscription day delivery `fulfill` updates `Delivery.status = "delivered"`.
- subscription day delivery `cancel` updates `Delivery.status = "canceled"`.
- one-time order delivery `dispatch` upserts `Delivery.status = "out_for_delivery"`.
- one-time order delivery `fulfill` upserts/updates `Delivery.status = "delivered"`.
- one-time order delivery `cancel` upserts/updates `Delivery.status = "canceled"`.

## 6. Action Policy Mapping

### `ACTION_REGISTRY`

| Action ID | Label EN | Endpoint | Method | Roles | Modes | Entity usage |
| --- | --- | --- | --- | --- | --- | --- |
| `start_preparation` | Start Preparation | `/api/dashboard/ops/actions/start_preparation` | POST | `superadmin`, `admin`, `kitchen` | all | Registry alias; execution normalizes to `prepare`. Used by pickup request rules. |
| `lock` | Lock Day | `/api/dashboard/ops/actions/lock` | POST | `superadmin`, `admin`, `kitchen` | all | Subscription days in policy; not supported by dedicated order action service. |
| `prepare` | Start Preparation | `/api/dashboard/ops/actions/prepare` | POST | `superadmin`, `admin`, `kitchen` | all | Subscription days, one-time orders, pickup requests. |
| `dispatch` | Dispatch | `/api/dashboard/ops/actions/dispatch` | POST | `superadmin`, `admin`, `kitchen`, `courier` | `delivery` | Subscription days and one-time delivery orders. |
| `ready_for_pickup` | Ready for Pickup | `/api/dashboard/ops/actions/ready_for_pickup` | POST | `superadmin`, `admin`, `kitchen` | `pickup` | Subscription days, one-time pickup orders, pickup requests. |
| `notify_arrival` | Notify Arrival | `/api/dashboard/ops/actions/notify_arrival` | POST | `superadmin`, `admin`, `courier` | `delivery` | Subscription days and one-time delivery orders. |
| `fulfill` | Fulfill | `/api/dashboard/ops/actions/fulfill` | POST | `superadmin`, `admin`, `courier`, `kitchen` | all | Subscription days, one-time orders, pickup requests. Dedicated order service restricts by mode. |
| `cancel` | Cancel | `/api/dashboard/ops/actions/cancel` | POST | `superadmin`, `admin`, `kitchen`, `courier` | all | Subscription days, one-time orders, pickup requests. Dedicated order service does not allow courier cancel. |
| `no_show` | No-show | `/api/dashboard/ops/actions/no_show` | POST | `superadmin`, `admin`, `kitchen` | `pickup` | Pickup requests. Handler can also route subscription days to no-show through cancel, but policy does not expose it for subscription days. |
| `reopen` | Reopen | `/api/dashboard/ops/actions/reopen` | POST | `superadmin`, `admin` | all | Subscription days only in current executable dashboard flow. Dedicated order service rejects reopen. |

### `TRANSITION_RULES`

`subscription`:

```text
open: prepare, lock, cancel
locked: prepare, reopen, cancel
in_preparation: dispatch, ready_for_pickup, cancel
out_for_delivery: notify_arrival, fulfill, cancel
ready_for_pickup: fulfill, cancel, no_show
fulfilled: none
delivery_canceled: reopen
canceled_at_branch: reopen
no_show: reopen
skipped: none
frozen: none
```

`order` in `opsActionPolicy`:

```text
created: lock, cancel
confirmed: prepare, cancel
in_preparation: dispatch, ready_for_pickup, cancel
out_for_delivery: notify_arrival, fulfill, cancel
ready_for_pickup: fulfill, cancel
fulfilled: none
cancelled: none
expired: none
pending_payment: none
```

Important: dashboard order DTOs do not use this `order` policy table. They use `getAllowedOrderActions` from `orderOpsTransitionService`.

`subscription_pickup_request`:

```text
locked: start_preparation, ready_for_pickup, cancel, no_show
in_preparation: ready_for_pickup, cancel, no_show
ready_for_pickup: fulfill, no_show
fulfilled: none
no_show: none
canceled: none
```

## 7. Transition Execution Mapping

### Unified subscription/pickup-request execution

`src/services/dashboard/opsTransitionService.js` handles subscription days and subscription pickup requests.

| Action | Handler | Entity updated | From status | To status | Timestamps / records | Role validation | Mode validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lock` | `handleLock` | `SubscriptionDay` | `open` | `locked` | Sets `lockedAt`; appends `operationAuditLog`; creates `SubscriptionAuditLog`; writes post-transaction log. | Done before execution by controller/policy. | No execution-time pickup/delivery check. |
| `prepare` | `handlePrepare` | `SubscriptionDay` | `open` or `locked` | `in_preparation` | Sets `pickupPreparationStartedAt` for subscription days; audit log; `SubscriptionAuditLog`; post log. | Done before execution. | For pickup subscriptions requires `pickupRequested`; for orders requires paid status. |
| `prepare` | `handlePrepare` | `SubscriptionPickupRequest` | `locked` | `in_preparation` | Sets `preparationStartedAt`; appends pickup request audit log; post log. | Done before execution. | Entity is always pickup. |
| `dispatch` | `handleDispatch` | `SubscriptionDay` | `in_preparation` | `out_for_delivery` | Appends audit; upserts `Delivery` with status `out_for_delivery`; `SubscriptionAuditLog`; post log; notification side effect. | Done before execution. | Rejects pickup subscription during execution. |
| `ready_for_pickup` | `handleReadyForPickup` | `SubscriptionDay` | `in_preparation` | `ready_for_pickup` | Sets `pickupPreparedAt`, `pickupCode`, `pickupCodeIssuedAt`; audit; `SubscriptionAuditLog`; post log. | Done before execution. | Requires pickup subscription with `pickupRequested` and current `in_preparation`. |
| `ready_for_pickup` | `handleReadyForPickup` | `SubscriptionPickupRequest` | `locked` or `in_preparation` | `ready_for_pickup` | Sets `pickupCode`, `pickupCodeIssuedAt`, `pickupPreparedAt`; pickup request audit; post log. | Done before execution. | Entity is always pickup. |
| `fulfill` | `handleFulfill` | `SubscriptionDay` | `out_for_delivery` or `ready_for_pickup` | `fulfilled` | Calls `fulfillSubscriptionDay`; consumes credits; appends audit; creates `SubscriptionAuditLog`; updates `Delivery.status` to `delivered`; post log. Pickup fulfillment stores `pickupVerifiedAt` and `pickupVerifiedByDashboardUserId`. | Done before execution. | Pickup mode uses visual code comparison by staff; no code payload is required. |
| `fulfill` | `handleFulfill` | `SubscriptionPickupRequest` | `ready_for_pickup` | `fulfilled` | Calls `fulfillSubscriptionPickupRequest`; consumes reserved pickup meals; appends pickup request audit. | Done before execution. | Entity is always pickup; no code payload is required by dashboard fulfill. |
| `cancel` | `handleCancel` | `SubscriptionDay` | depends on status | delivery: `delivery_canceled`; pickup: `canceled_at_branch` or `no_show` | Sets cancellation fields; appends audit; creates `SubscriptionAuditLog`; updates `Delivery.status` to `canceled`; post log. | Done before execution. | Target status depends on parent `Subscription.deliveryMode`. |
| `cancel` | `handleCancel` | `SubscriptionPickupRequest` | `locked` or `in_preparation` | `canceled` | Releases reserved pickup meals; sets cancellation fields; appends pickup request audit. | Done before execution. | Entity is always pickup. |
| `no_show` | `handleNoShow` | `SubscriptionPickupRequest` | `locked`, `in_preparation`, or `ready_for_pickup` | `no_show` | Sets no-show/cancel fields; consumes reserved pickup meals; appends pickup request audit. | Done before execution. | Entity is always pickup. |
| `no_show` | `handleNoShow` | `SubscriptionDay` | `ready_for_pickup` | `no_show` | Internally calls cancel with `noShow: true`; appends audit/log records. | Done before execution. | Pickup only by registry and policy. |
| `reopen` | `handleReopen` | `SubscriptionDay` | `locked`, `delivery_canceled`, `canceled_at_branch`, or `no_show` | `open` | Clears cancellation/no-show fields where present; appends audit; creates `SubscriptionAuditLog`; post log. | Done before execution. | No mode-specific validation. |
| `notify_arrival` | `handleNotifyArrival` | `Delivery` | n/a | n/a | Sets `arrivingSoonReminderSentAt`; post log. | Done before execution. | Requires existing delivery record. |

### Dedicated one-time order execution

`src/services/orders/orderOpsTransitionService.js` handles one-time order dashboard actions.

| Action | Handler | Entity updated | From status | To status | Timestamps / records | Role validation | Mode validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prepare` | `executeOrderAction` | `Order` | `confirmed` | `in_preparation` | Sets `preparationStartedAt`; writes `ActivityLog`. | Inside service. | No mode distinction. |
| `ready_for_pickup` | `executeOrderAction` | `Order` | `in_preparation` | `ready_for_pickup` | Sets `readyAt`, `pickup.readyAt`, `pickupCode`, `pickupCodeIssuedAt`; writes `ActivityLog`. | Inside service. | Requires pickup mode. |
| `dispatch` | `executeOrderAction` | `Order` | `in_preparation` | `out_for_delivery` | Sets `dispatchedAt`; upserts `Delivery.status = "out_for_delivery"`; writes `ActivityLog`. | Inside service. | Requires delivery mode and one-time delivery feature flag. |
| `notify_arrival` | `executeOrderAction` | `Order` | `out_for_delivery` | `out_for_delivery` | Writes `ActivityLog`; no status change. | Inside service. | Requires delivery mode. |
| `fulfill` | `executeOrderAction` | `Order` | `ready_for_pickup` or `out_for_delivery` | `fulfilled` | Sets `fulfilledAt`; for pickup sets `pickup.pickedUpAt`, `pickupVerifiedAt`, `pickupVerifiedByDashboardUserId`; for delivery updates `Delivery.status = "delivered"`; writes `ActivityLog`. | Inside service. | Fulfill roles are pickup: kitchen/admin/superadmin; delivery: courier/admin/superadmin. Pickup code is visual-only and not submitted. |
| `cancel` | `executeOrderAction` | `Order` | `confirmed`, `in_preparation`, `ready_for_pickup`, `out_for_delivery` | `cancelled` | Sets cancellation fields; for delivery upserts/updates `Delivery.status = "canceled"`; writes `ActivityLog`. | Inside service. | No mode distinction, but courier is not allowed. |
| `reopen` | `assertSupportedAction` | `Order` | n/a | n/a | n/a | n/a | Explicitly rejected with `REOPEN_NOT_SUPPORTED`. |

## Remaining Gaps / Intentional Limitations

Fixed in the current implementation:

- Subscription delivery cancellation from `open`, `locked`, and `in_preparation` now executes.
- Pickup subscription cancellation from `open`, `locked`, and `in_preparation` now executes.
- Subscription-day `locked -> reopen -> open` now executes.
- Subscription-day pickup fulfillment uses visual pickup-code comparison and no longer requires a code payload.
- Subscription-day pickup `no_show` is exposed for `ready_for_pickup` pickup rows and executes.
- One-time order delivery dashboard actions now sync the `Delivery` collection.
- Pickup `fulfill` visibility is role/mode filtered so courier does not see pickup fulfillment.

Remaining confirmed limitations:

1. One-time order policy in `opsActionPolicy.TRANSITION_RULES.order` is stale relative to actual order DTO/action execution.
   - It lists `created: ["lock", "cancel"]`.
   - The `Order` schema uses canonical `pending_payment`/`confirmed`, not `created`.
   - Order DTOs do not use this table; they use `orderOpsTransitionService.getAllowedOrderActions`.
   - Dedicated order action execution does not support `lock`.

2. Role metadata differs between registry and dedicated one-time order execution.
   - `ACTION_REGISTRY.cancel.roles` includes `courier`.
   - `orderOpsTransitionService.actionRoles("cancel")` only allows `superadmin`, `admin`, and `kitchen`.
   - Order DTOs are correct because they use `getAllowedOrderActions`, but the registry alone is misleading.

3. The current backend does not have separate final statuses named `delivered`, `picked_up`, or `completed` on `SubscriptionDay` or `Order`.
   - Both lifecycles end at `fulfilled`.
   - `Delivery.status` can become `delivered`, but this is a separate collection.

4. The default kitchen queue does not show one-time orders in `ready_for_pickup` or `out_for_delivery`.
    - For `GET /api/dashboard/kitchen/queue`, default order statuses are `confirmed`, `in_preparation`, and legacy `preparing`.
    - Later statuses require an explicit `status` query or another board such as pickup/courier.

5. One-time delivery remains feature-gated.
   - Delivery-mode one-time order actions are hidden and rejected unless `ONE_TIME_ORDER_DELIVERY_ENABLED === "true"`.

## 9. Recommended Final Lifecycle

These are recommendations, not the currently implemented status names unless explicitly stated.

### For home delivery

Recommended lifecycle for both `subscription_day` and `order`:

```text
open/confirmed
  -> in_preparation
  -> ready
  -> out_for_delivery
  -> delivered
  -> completed
```

Recommended side transitions:

- cancel from `open`/`confirmed`, `locked`, or `in_preparation`
- lock/unlock before preparation if the domain needs it

Current backend mapping:

| Recommended status | Current subscription day status | Current one-time order status | Notes |
| --- | --- | --- | --- |
| `open` | `open` | `confirmed` after paid | Orders also have `pending_payment` before operational lifecycle. |
| `in_preparation` | `in_preparation` | `in_preparation` | Implemented. |
| `ready` | not currently implemented | not currently implemented | Recommended, not currently implemented. |
| `out_for_delivery` | `out_for_delivery` | `out_for_delivery` | Implemented. |
| `delivered` | `fulfilled`; `Delivery.status = delivered` after subscription fulfillment | `fulfilled`; `Delivery.status = delivered` after delivery fulfillment | Recommended as final delivery status, not currently implemented on primary entity. |
| `completed` | not currently implemented | not currently implemented | Recommended, not currently implemented. |

### For branch pickup

Recommended lifecycle for both `subscription_day` and `order`:

```text
open/confirmed
  -> in_preparation
  -> ready_for_pickup
  -> picked_up
  -> completed
```

Recommended side transitions:

- cancel from `open`/`confirmed`, `locked`, or `in_preparation`
- no-show from `ready_for_pickup`
- lock/unlock before preparation if the domain needs it

Current backend mapping:

| Recommended status | Current subscription day status | Current one-time order status | Notes |
| --- | --- | --- | --- |
| `open` | `open` | `confirmed` after paid | Orders also have `pending_payment` before operational lifecycle. |
| `in_preparation` | `in_preparation` | `in_preparation` | Implemented. |
| `ready_for_pickup` | `ready_for_pickup` | `ready_for_pickup` | Implemented. |
| `picked_up` | `fulfilled` | `fulfilled` | Recommended name, not currently implemented. |
| `completed` | not currently implemented | not currently implemented | Recommended, not currently implemented. |
| `no_show` | implemented on `SubscriptionDay` and exposed from pickup `ready_for_pickup` | not currently implemented | Recommended for pickup. |

## 10. Regression Tests

Focused regression coverage now exists in `tests/orderDeliveryLifecycleFixes.test.js` for:

1. `subscription_day` with `status: open` returns `prepare`, `lock`, and `cancel` from `GET /api/dashboard/kitchen/queue`.
2. `subscription_day` `prepare` changes status to `in_preparation`.
3. `subscription_day` `in_preparation` returns `dispatch` for delivery and `ready_for_pickup` for pickup.
4. Home delivery subscription item can progress through `in_preparation -> out_for_delivery -> fulfilled`, and `Delivery.status` becomes `delivered`.
5. Branch pickup subscription item can progress through `in_preparation -> ready_for_pickup -> fulfilled`, with an explicit test for whether pickup code is required.
6. Individual pickup order can progress through `confirmed -> in_preparation -> ready_for_pickup -> fulfilled`.
7. Individual delivery order can progress through `confirmed -> in_preparation -> out_for_delivery -> fulfilled` when `ONE_TIME_ORDER_DELIVERY_ENABLED === "true"`.
8. Every sampled allowed action returned by queue has executable endpoint metadata.
9. Visible one-time order actions match execution roles, including courier not seeing one-time order `cancel`.
10. Subscription delivery cancellation from `open`, `locked`, and `in_preparation` executes.
11. Pickup cancellation from `open` executes.
12. One-time order dispatch/fulfill/cancel syncs `Delivery`.

Additional broad matrix coverage can still be added later for every role/status/action permutation.

## Current Completeness

The current backend now supports the requested delivery/handoff lifecycle using `fulfilled` as the final completed handoff status.

Implemented and usable:

- Subscription delivery: `open -> in_preparation -> out_for_delivery -> fulfilled`.
- Subscription delivery cancellation from `open`, `locked`, `in_preparation`, and `out_for_delivery`.
- Subscription locked-day reopen: `locked -> open`.
- Subscription pickup: `open -> in_preparation -> ready_for_pickup -> fulfilled`.
- Subscription pickup cancellation from `open`, `locked`, `in_preparation`, and `ready_for_pickup`.
- Subscription pickup no-show from `ready_for_pickup`.
- One-time pickup: `confirmed -> in_preparation -> ready_for_pickup -> fulfilled`.
- One-time delivery: `confirmed -> in_preparation -> out_for_delivery -> fulfilled` when `ONE_TIME_ORDER_DELIVERY_ENABLED === "true"`.
- Delivery record sync for subscription delivery and one-time delivery dispatch/fulfill/cancel.
- Pickup code generation on `ready_for_pickup`, customer/dashboard code visibility, and required code verification on pickup fulfill.

Intentional limitations:

- Final statuses are collapsed into `fulfilled`; `picked_up`, primary-entity `delivered`, and `completed` are not implemented.
- One-time delivery is still feature-gated by `ONE_TIME_ORDER_DELIVERY_ENABLED`.
- One-time order dashboard DTOs use `orderOpsTransitionService.getAllowedOrderActions`; the older `opsActionPolicy.TRANSITION_RULES.order` table is not the source of truth for orders.
