# One-Time Order Dashboard Ops Flow

## Scope

This guide documents the final dashboard and operations lifecycle for pickup-only One-Time Orders.

One-Time Orders are pickup-only for launch. Kitchen and branch staff receive paid one-time pickup orders, prepare them, mark them ready for pickup, and fulfill them when the customer picks them up from the branch.

User story:

> As kitchen/branch staff, I want to receive paid one-time pickup orders, prepare them, mark them ready, and fulfill them when the customer picks them up.

This guide is for dashboard frontend developers building order lists, order detail, kitchen queue, pickup queue, and operational actions for one-time pickup orders.

## Important Business Rules

- One-Time Orders are separate from subscriptions.
- Do not use subscription endpoints.
- Do not send `SubscriptionDay` IDs.
- Do not send `mealSlots`.
- Do not consume subscription `remainingMeals`.
- Do not use skip/freeze.
- One-Time Orders use `Order` documents.
- One-Time Orders use `Payment.type = "one_time_order"`.
- Prices are calculated by the backend.
- Frontend must not calculate final totals.
- VAT is already included.
- Frontend must not add VAT again.
- The final lifecycle for launch is pickup-only.
- No home delivery is supported in this One-Time Order cycle.
- No courier board flow is supported for One-Time Orders in this launch cycle.
- Pending payment orders expire after 30 minutes.
- Expired orders stay in history and are not deleted.
- If older backend code or older docs mention delivery for one-time orders, the final product decision for this launch cycle is: **One-Time Orders are pickup-only for launch.**

## User Stories

- As kitchen staff, I can see paid one-time pickup orders that are ready to prepare.
- As kitchen staff, I can move a paid order from `confirmed` to `in_preparation`.
- As kitchen staff, I can mark a prepared order as `ready_for_pickup`.
- As branch pickup staff, I can fulfill an order when the customer picks it up.
- As an admin, I can list, inspect, and perform valid pickup actions on one-time orders.
- As dashboard staff, I can distinguish one-time orders from subscription days.
- As dashboard staff, I do not need delivery, courier, or subscription day controls for one-time pickup orders.

## Dashboard Order Lifecycle

Normal pickup-only dashboard lifecycle:

```text
confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Other states:

- `pending_payment`: visible in list if the backend returns it, but not operational.
- `cancelled`: final.
- `expired`: final.

Statuses such as `out_for_delivery`, `dispatch`, and `notify_arrival` may exist in backend code for generic compatibility, but they are not used in the pickup-only one-time order flow.

Do not include delivery or courier steps in the normal dashboard cycle.

## Step-by-Step Flow

## Step 1 - Dashboard Order List

Endpoint:

```http
GET /api/dashboard/orders
```

Query params:

| Param | Purpose |
| --- | --- |
| `status` | Filter by order status such as `confirmed`, `in_preparation`, or `ready_for_pickup`. |
| `paymentStatus` | Filter by payment state such as `paid` or `initiated`. |
| `fulfillmentMethod` | For pickup-only launch, use `pickup`. |
| `date` | Filter by one date when supported by backend. |
| `from` | Start date/time filter. |
| `to` | End date/time filter. |
| `branchId` | Filter by pickup branch. |
| `q` | Search by customer/order text when supported. |
| `page` | Page number. |
| `limit` | Page size. |

For pickup-only launch:

```http
GET /api/dashboard/orders?fulfillmentMethod=pickup&page=1&limit=20
```

Response example:

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "source": "one_time_order",
        "entityType": "order",
        "entityId": "...",
        "orderNumber": "OT-1001",
        "status": "confirmed",
        "paymentStatus": "paid",
        "fulfillmentMethod": "pickup",
        "customer": {},
        "items": [],
        "pricing": {},
        "allowedActions": ["prepare"]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1
    }
  }
}
```

UI behavior:

- Show one-time order rows separately or clearly tagged.
- Display `source = one_time_order`.
- Use `entityType = order` to choose one-time order behavior.
- Do not render subscription day UI for orders.
- Do not require `mealSlots`.
- Do not show delivery address, delivery zone, delivery window, dispatch, or courier fields.
- Use `allowedActions` from the backend to decide visible buttons.
- Treat `pending_payment` as non-operational; kitchen should not prepare unpaid orders.

## Step 2 - Dashboard Order Detail

Endpoint:

```http
GET /api/dashboard/orders/:orderId
```

Response example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "confirmed",
    "payment": {},
    "activity": [],
    "items": [],
    "pickup": {},
    "allowedActions": ["prepare"]
  }
}
```

UI behavior:

- Show customer info.
- Show pickup branch/window.
- Show order items.
- Show payment summary.
- Show activity log.
- Show only backend-provided `allowedActions`.
- Hide subscription fields such as subscription day, plan, skip/freeze, and meal slots.
- Hide delivery/courier fields for one-time pickup orders.

## Step 3 - Action: Prepare

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/prepare
```

Allowed from:

- `confirmed`

Result:

- `in_preparation`

Request body:

```json
{
  "reason": "Kitchen started preparing the one-time pickup order",
  "notes": "Optional note"
}
```

Response example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "in_preparation",
    "allowedActions": ["ready_for_pickup", "cancel"]
  }
}
```

UI behavior:

- Show this action only when `allowedActions` includes `prepare`.
- Optimistically disabling the button during the request is fine, but final state must come from the response.
- After success, update the row/detail status to `in_preparation`.
- Do not call subscription day prepare endpoints.

## Step 4 - Action: Ready for Pickup

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/ready_for_pickup
```

Allowed from:

- `in_preparation`

Result:

- `ready_for_pickup`

Request body:

```json
{
  "reason": "Order is ready for pickup",
  "pickupCode": "123456",
  "notes": "Optional"
}
```

Response example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "ready_for_pickup",
    "allowedActions": ["fulfill", "cancel"]
  }
}
```

UI behavior:

- Show this action only when `allowedActions` includes `ready_for_pickup`.
- If backend requires `pickupCode`, collect it before submitting.
- After success, move the order to the pickup board or ready section.
- Do not show dispatch or courier assignment controls.

## Step 5 - Action: Fulfill

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/fulfill
```

Allowed from:

- `ready_for_pickup`

Result:

- `fulfilled`

Request body:

```json
{
  "reason": "Customer picked up the order from branch",
  "pickupCode": "123456",
  "notes": "Optional"
}
```

Response example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "fulfilled",
    "allowedActions": []
  }
}
```

UI behavior:

- Show this action only when `allowedActions` includes `fulfill`.
- Ask staff to confirm customer pickup before submitting.
- If a pickup code is returned/required by backend, validate it through this endpoint.
- After success, remove the order from active ops queues and keep it available in history/reporting.

## Step 6 - Action: Cancel

Endpoint:

```http
POST /api/dashboard/orders/:orderId/actions/cancel
```

Allowed from:

- `confirmed`
- `in_preparation`
- `ready_for_pickup`

Result:

- `cancelled`

Request body:

```json
{
  "reason": "Customer requested cancellation",
  "notes": "Optional"
}
```

Important:

- Cancel does not automatically mean refund.
- Refund is out of scope unless the backend later adds an explicit refund endpoint.
- Do not trigger provider refund behavior from the dashboard unless a dedicated backend refund API is added.

Response example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "cancelled",
    "allowedActions": []
  }
}
```

UI behavior:

- Show cancel only when `allowedActions` includes `cancel`.
- Require a reason from staff if product policy requires auditability.
- After success, keep the order visible in final-state history/reporting.

## Unsupported Actions for Pickup-Only One-Time Orders

Do not show these actions for one-time pickup orders:

- `dispatch`
- `notify_arrival`
- courier fulfill
- delivery assignment
- delivery zone assignment
- delivery address editing
- delivery window editing

If the backend exposes these actions for generic compatibility, hide them in the pickup-only UI unless `fulfillmentMethod = delivery` is explicitly supported later.

## Kitchen Queue Integration

Endpoint:

```http
GET /api/dashboard/kitchen/queue
```

One-time pickup orders may appear with:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "entityId": "...",
  "status": "confirmed",
  "fulfillmentMethod": "pickup",
  "allowedActions": ["prepare"]
}
```

UI behavior:

- Use `source` and `entityType` to choose the correct UI.
- Do not assume every row is `subscription_day`.
- Do not call subscription actions for one-time orders.
- Show pickup branch/window when available.
- Hide delivery and courier controls.
- Only prepare orders with paid payment status and a valid backend action.

## Pickup Board Integration

Endpoint:

```http
GET /api/dashboard/pickup/queue
```

One-time pickup orders may appear with:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "entityId": "...",
  "status": "ready_for_pickup",
  "fulfillmentMethod": "pickup",
  "allowedActions": ["fulfill", "cancel"]
}
```

UI behavior:

- Use this board for branch pickup handoff.
- Show the order number, customer summary, pickup branch/window, pickup code if returned, and item summary.
- Show `fulfill` only when allowed by backend.
- Do not call courier fulfillment or delivery-arrival actions.

## Unified Ops Action Endpoint

Endpoint:

```http
POST /api/dashboard/ops/actions/:action
```

Body for one-time order:

```json
{
  "entityId": "...",
  "entityType": "order",
  "source": "one_time_order",
  "payload": {
    "reason": "Kitchen started preparing order",
    "notes": "Optional"
  }
}
```

Use this endpoint if the dashboard screen is built on the unified ops board.

Action examples:

```http
POST /api/dashboard/ops/actions/prepare
POST /api/dashboard/ops/actions/ready_for_pickup
POST /api/dashboard/ops/actions/fulfill
POST /api/dashboard/ops/actions/cancel
```

UI behavior:

- Always include `entityType = order` and `source = one_time_order`.
- Put action-specific fields such as `pickupCode`, `reason`, and `notes` under `payload`.
- Do not send subscription day identifiers for one-time orders.

## Endpoint Per Step

| Step | Purpose | Endpoint |
| --- | --- | --- |
| 1 | List dashboard orders | `GET /api/dashboard/orders` |
| 2 | View order detail | `GET /api/dashboard/orders/:orderId` |
| 3 | Prepare order | `POST /api/dashboard/orders/:orderId/actions/prepare` |
| 4 | Mark ready for pickup | `POST /api/dashboard/orders/:orderId/actions/ready_for_pickup` |
| 5 | Fulfill pickup | `POST /api/dashboard/orders/:orderId/actions/fulfill` |
| 6 | Cancel order | `POST /api/dashboard/orders/:orderId/actions/cancel` |
| Queue | Kitchen queue | `GET /api/dashboard/kitchen/queue` |
| Queue | Pickup queue | `GET /api/dashboard/pickup/queue` |
| Unified | Unified ops action | `POST /api/dashboard/ops/actions/:action` |

## Role Behavior

| Role | Expected behavior |
| --- | --- |
| `admin` / `superadmin` | Can list, view detail, and perform all valid pickup actions returned by backend. |
| `kitchen` | Can prepare and mark orders `ready_for_pickup` when allowed. |
| `branch` / pickup role if present | Can fulfill pickup orders when the customer arrives. |
| `courier` | No normal role in the pickup-only one-time order cycle. |

The dashboard must still respect backend authorization. Role-based UI hiding is only a convenience; backend errors remain authoritative.

## Error Handling

Use backend error codes to drive UI behavior. Refresh the order after transition errors because another staff member may have already acted on the order.

| Error code | Meaning | Dashboard behavior |
| --- | --- | --- |
| `INVALID_TRANSITION` | Requested status change is not allowed from the current status. | Refresh row/detail and show current state. |
| `ORDER_NOT_FOUND` | Order does not exist or is not visible to this dashboard scope. | Remove stale row or show not found. |
| `FORBIDDEN` | Staff role is not allowed to perform the action. | Hide/disable action and show permission message. |
| `REOPEN_NOT_SUPPORTED` | Final orders cannot be reopened. | Keep final state; do not retry as another action. |
| `ACTION_NOT_ALLOWED` | Backend does not allow this action for this order. | Refresh allowed actions. |
| `PAYMENT_NOT_PAID` | Operational action requires paid payment. | Keep as non-operational; do not prepare unpaid order. |
| `ORDER_FINAL` | Order is already final. | Move to final-state history/reporting view. |
| `INVALID_OBJECT_ID` | `orderId` or `entityId` is malformed. | Treat as implementation bug or stale route. |

Example error response shape:

```json
{
  "status": false,
  "code": "INVALID_TRANSITION",
  "message": "Action is not allowed from the current status"
}
```

## Status Lifecycle

Operational statuses:

```text
confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Non-operational or final statuses:

- `pending_payment`: not ready for kitchen work.
- `cancelled`: final.
- `expired`: final.

Normal pickup actions:

| Current status | Action | Next status |
| --- | --- | --- |
| `confirmed` | `prepare` | `in_preparation` |
| `in_preparation` | `ready_for_pickup` | `ready_for_pickup` |
| `ready_for_pickup` | `fulfill` | `fulfilled` |
| `confirmed` | `cancel` | `cancelled` |
| `in_preparation` | `cancel` | `cancelled` |
| `ready_for_pickup` | `cancel` | `cancelled` |

Not used in the normal pickup-only one-time order flow:

- `out_for_delivery`
- `dispatch`
- `notify_arrival`

## Final States

Final states:

- `fulfilled`
- `cancelled`
- `expired`

Dashboard UI behavior for final states:

- Show no operational actions unless backend explicitly returns one.
- Keep final orders visible in history/reporting.
- Do not hard delete expired or cancelled orders.
- Do not reopen final orders unless a future backend feature explicitly supports it.

## Notes / Common Mistakes

- Do not use subscription day endpoints for one-time orders.
- Do not assume `entityType = subscription_day`.
- Do not send `SubscriptionDay` IDs.
- Do not send `mealSlots`.
- Do not use cashier consumption endpoints for one-time orders.
- Do not consume subscription `remainingMeals`.
- Do not use skip/freeze.
- Do not use courier actions for pickup-only orders.
- Do not show delivery fields.
- Do not show dispatch, notify arrival, delivery assignment, delivery zone, delivery address, or delivery window controls.
- Do not trigger refund on cancel unless the backend explicitly adds a refund endpoint.
- Do not hard delete expired/cancelled orders.
- Do not calculate final totals in the dashboard.
- Do not add VAT again; VAT is already included.
- Do not ignore `allowedActions`; the backend is the source of truth for operational actions.
