# Frontend Dashboard Operations README

## 1. Purpose

This document is for the frontend/dashboard developer building operational dashboard screens for:

- kitchen queue and kitchen actions
- pickup / receiving flows
- One-Time Orders
- subscription pickup from branch
- subscription home delivery
- manual subscription meal deduction

It documents the backend routes, DTO fields, status lifecycles, request bodies, error handling, and UI rules that the dashboard should follow.

## 2. Core Concepts

### One-Time Order

A One-Time Order is a paid standalone order, separate from subscriptions.

Dashboard identifiers:

- `source: "one_time_order"`
- `entityType: "order"`
- `type: "order"`

Current launch behavior:

- pickup-only operational flow should be used by the dashboard
- uses the `Order` status lifecycle
- uses backend `allowedActions`
- does not use `SubscriptionDay`
- does not use `mealSlots`, `remainingMeals`, skip/freeze, delivery zone, delivery address editing, delivery window editing, or subscription meal balance controls

### Subscription

A subscription is a recurring/prepaid meal balance.

Subscription behavior:

- has total and remaining meal balance on `Subscription`
- may be `pickup` or `delivery`
- may have regular meals and premium meal balance
- premium remaining balance comes from `premiumBalance[].remainingQty`
- manual deduction is allowed only for dashboard `admin` / `superadmin`

### Kitchen

Kitchen screens show paid operational items that can be prepared.

Frontend rule:

- show actions returned by the backend
- do not hardcode action availability from status alone
- a row may be a One-Time Order or a subscription day

### Pickup / Receiving

Pickup / receiving means staff confirms the customer received the order or meal.

One-Time Orders:

- backend exposes `context.pickupCode`
- customer shows code from app
- staff visually matches customer code to dashboard code
- staff clicks fulfill / `تم الاستلام`
- frontend does not send `pickupCode`

Subscription pickup:

- existing app-prepared pickup flow may require pickup verification
- if customer has no phone/app or did not select meals, use manual subscription meal deduction

### Delivery

Subscription delivery manual deduction is once per business day.

Frontend behavior:

- if search response has `today.hasDeliveryDeductionToday = true`, show a disabled/warning state
- backend remains the source of truth
- if backend returns `DELIVERY_ALREADY_DEDUCTED_TODAY`, show that message

## 3. Global Frontend Rules

- Always use backend `allowedActions`.
- Never hardcode action availability only on frontend.
- Hide unsupported buttons if `allowedActions` does not include them.
- For One-Time Orders, do not show subscription controls.
- For subscription manual deduction, do not show product/food selection.
- Do not calculate totals or VAT in dashboard operations.
- Do not trigger refunds from cancel unless a dedicated refund API exists.
- Do not assume every queue row is a subscription day.
- Branch row rendering by `source` and `entityType` where available.
- Treat unpaid / `pending_payment` / non-paid orders as non-operational.
- Show backend errors in user-friendly language.
- Refresh row/detail after every successful action.

Action model clarification:

- `/api/dashboard/ops/*` returns `allowedActions`. For these rows, call `/api/dashboard/ops/actions/:action` with `entityId`, `entityType`, and `payload`.
- `/api/kitchen/operations/list` returns `actions[]`. For these rows, use each returned `actions[].endpoint`, `actions[].method`, and `actions[].enabled` directly.
- Do not mix the two action models in the same component without normalizing them first.

## 4. One-Time Order Lifecycle

The codebase currently persists One-Time Order preparation as `in_preparation`.
Some legacy/direct endpoint names still use `preparing`, such as `/api/kitchen/orders/:id/preparing`, but the dashboard should render and transition from the returned backend status.

```text
initiated / pending payment
   |
   | payment paid
   v
confirmed
   |
   | prepare
   v
in_preparation
   |
   | ready_for_pickup
   v
ready_for_pickup
   |
   | fulfill
   v
fulfilled
```

Terminal / final states:

```text
fulfilled
canceled
expired payment/order payment flow, where present in payment state
```

Important:

- `paymentStatus` must be `paid` for operational order transitions.
- Unpaid orders cannot be prepared or fulfilled.
- Cancel does not mean refund.
- Refunds must not be triggered unless a dedicated refund endpoint is introduced.

## 5. One-Time Order Endpoints Map

### Recommended Dashboard Ops List

```http
GET /api/dashboard/ops/list?date=YYYY-MM-DD
Authorization: Bearer <dashboard_access_token>
```

Roles:

- `admin`
- `kitchen`
- `courier`

Actual query params supported by this endpoint:

| Param | Required | Notes |
| --- | --- | --- |
| `date` | Yes | `YYYY-MM-DD`; used to fetch subscription days and paid One-Time Orders for the date |

This endpoint returns a mixed list of subscription-day DTOs and One-Time Order DTOs. One-Time Orders are filtered to `paymentStatus: "paid"` internally.

Unsupported on this endpoint:

- `status`
- `paymentStatus`
- `fulfillmentMethod`
- `from`
- `to`
- `page`
- `limit`

Use `/api/dashboard/ops/search?q=...` for text search and `/api/kitchen/operations/list` for paginated/filterable kitchen queues.

Response example:

```json
{
  "status": true,
  "data": [
    {
      "id": "665f...",
      "type": "order",
      "entityType": "order",
      "source": "one_time_order",
      "mode": "pickup",
      "reference": "ORD-ABC123",
      "status": "ready_for_pickup",
      "ui": {
        "label": "ready_for_pickup",
        "badge": "success",
        "icon": "shopping-bag"
      },
      "customer": {
        "id": "665c...",
        "name": "Customer Name",
        "phone": "+966..."
      },
      "context": {
        "date": "2026-05-15",
        "window": "",
        "address": null,
        "branch": "Main Branch",
        "pickupCode": "123456",
        "pickupCodeIssuedAt": "2026-05-15T10:00:00.000Z",
        "pickupVerifiedAt": null
      },
      "allowedActions": [
        {
          "id": "fulfill",
          "label": "Fulfill",
          "color": "green",
          "icon": "check-circle",
          "requiresReason": false
        }
      ],
      "timestamps": {
        "createdAt": "2026-05-15T09:00:00.000Z",
        "updatedAt": "2026-05-15T10:00:00.000Z"
      }
    }
  ]
}
```

Notes:

- This DTO does not currently include `paymentStatus` or pricing fields.
- The backend list only includes paid One-Time Orders.
- Use `id` as the `entityId` for dashboard ops actions.
- Use `mode` as the fulfillment method. `mode: "pickup"` means pickup.

### Recommended Dashboard Ops Search

```http
GET /api/dashboard/ops/search?q=<phone-or-name-or-reference>
Authorization: Bearer <dashboard_access_token>
```

Actual query params:

| Param | Required | Notes |
| --- | --- | --- |
| `q` | Yes | Minimum length 3; searches users by phone/name, `ORD-*` references, subscription days, and pickup code |

Response shape is the same DTO shape as `/api/dashboard/ops/list`.

### Prepare Action

Recommended endpoint:

```http
POST /api/dashboard/ops/actions/prepare
Authorization: Bearer <dashboard_access_token>
Content-Type: application/json
```

Body:

```json
{
  "entityId": "<orderId>",
  "entityType": "order",
  "payload": {
    "reason": "Kitchen started preparing the one-time pickup order",
    "notes": "Optional note"
  }
}
```

Notes:

- `payload.reason` and `payload.notes` are accepted by the generic action shape but are not required for prepare.
- Backend validates `allowedActions`, role, state transition, and `paymentStatus: "paid"`.
- Order status becomes `in_preparation`.

Legacy/direct endpoint also exists:

```http
POST /api/kitchen/orders/:id/preparing
```

### Ready For Pickup Action

Recommended endpoint:

```http
POST /api/dashboard/ops/actions/ready_for_pickup
Authorization: Bearer <dashboard_access_token>
Content-Type: application/json
```

Body:

```json
{
  "entityId": "<orderId>",
  "entityType": "order",
  "payload": {
    "reason": "Order is ready for pickup",
    "notes": "Optional note"
  }
}
```

Backend behavior:

- validates the action with `allowedActions`
- validates paid order state
- transitions `preparing -> ready_for_pickup`
- generates `pickupCode` and `pickupCodeIssuedAt` for pickup orders if missing

Legacy/direct endpoint also exists:

```http
POST /api/kitchen/orders/:id/ready-for-pickup
```

### Fulfill / Received Action

Recommended endpoint:

```http
POST /api/dashboard/ops/actions/fulfill
Authorization: Bearer <dashboard_access_token>
Content-Type: application/json
```

Body:

```json
{
  "entityId": "<orderId>",
  "entityType": "order",
  "payload": {}
}
```

Important:

- Frontend must not show a manual `pickupCode` input.
- Frontend must show `context.pickupCode`.
- Staff visually compares customer app code with dashboard code.
- Staff clicks fulfill / `تم الاستلام`.
- Backend does not require `payload.pickupCode`.
- `source: "one_time_order"` is not required in the action request. `entityType: "order"` and `entityId` are sufficient.

Legacy/direct endpoint also exists:

```http
POST /api/kitchen/orders/:id/fulfilled
```

### Cancel Action

Recommended endpoint:

```http
POST /api/dashboard/ops/actions/cancel
Authorization: Bearer <dashboard_access_token>
Content-Type: application/json
```

Body:

```json
{
  "entityId": "<orderId>",
  "entityType": "order",
  "payload": {
    "reason": "Customer requested cancellation",
    "notes": "Optional note"
  }
}
```

Notes:

- Cancel does not mean refund.
- No provider refund should be triggered unless a dedicated backend refund API exists.

## 6. One-Time Order Pickup Code UI Behavior

Display pickup code on the order detail/card when present:

```text
context.pickupCode
context.pickupCodeIssuedAt
context.pickupVerifiedAt
```

Frontend behavior:

1. Customer shows code from app.
2. Staff visually matches customer code with `context.pickupCode`.
3. Staff clicks `تم الاستلام` / Fulfill.
4. Frontend calls `/api/dashboard/ops/actions/fulfill` without `pickupCode`.
5. Refresh row/detail from backend response.

Do not:

- render an input field for `pickupCode`
- require the admin to type the code
- send `payload.pickupCode` for One-Time Order fulfillment

## 7. Kitchen Queue Flow

There are two dashboard-authenticated kitchen APIs:

1. Unified dashboard ops API:
   - `/api/dashboard/ops/list`
   - `/api/dashboard/ops/search`
   - `/api/dashboard/ops/actions/:action`
2. Kitchen operations API:
   - `/api/kitchen/operations/list`
   - `/api/kitchen/operations/summary`
   - direct `/api/kitchen/*` action endpoints

Recommended general queue for mixed operations:

```http
GET /api/kitchen/operations/list?date=YYYY-MM-DD&tab=subscriptions|orders|branch_pickup&mode=all|pickup|delivery&page=1&limit=20
Authorization: Bearer <dashboard_access_token>
```

Roles:

- `admin`
- `kitchen`

Actual query params:

| Param | Required | Notes |
| --- | --- | --- |
| `date` | Yes | `YYYY-MM-DD` |
| `tab` | No | `subscriptions`, `orders`, `branch_pickup`; default `subscriptions` |
| `status` | No | Filters mapped row status |
| `mode` | No | `all`, `delivery`, `pickup`; default `all` |
| `search` | No | Searches row reference/customer name |
| `branchId` | No | Filters branch pickup rows by branch |
| `kitchenId` | No | Returned in filters; currently not used for dataset filtering |
| `sortBy` | No | `status`, `customerName`, `reference`, `timeWindow`, `date`, `createdAt` |
| `sortOrder` | No | `asc` or `desc` |
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `100` |

Response example:

```json
{
  "status": true,
  "data": {
    "date": "2026-05-15",
    "tab": "orders",
    "rows": [
      {
        "id": "665f...",
        "entityType": "order",
        "reference": "#ORD-20260515-ABC123",
        "customer": {
          "id": "665c...",
          "name": "Customer Name",
          "avatar": null
        },
        "date": "2026-05-15",
        "mode": "pickup",
        "modeLabel": "استلام",
        "timeWindow": {
          "from": null,
          "to": null,
          "label": ""
        },
        "items": [
          {
            "id": "mealId",
            "name": "Chicken x1",
            "kind": "meal"
          }
        ],
        "status": "ready_for_pickup",
        "statusLabel": "جاهز للاستلام",
        "progress": 75,
        "actions": [
          {
            "key": "fulfilled",
            "label": "تم التسليم",
            "method": "POST",
            "endpoint": "/api/kitchen/orders/<orderId>/fulfilled",
            "enabled": true,
            "variant": "primary",
            "requiresConfirmation": true,
            "confirmationMessage": "هل أنت متأكد من تسليم الطلب؟"
          }
        ],
        "badges": {
          "locked": true,
          "assignedByKitchen": false,
          "pickupRequested": false
        },
        "verification": {
          "status": "not_verified",
          "statusLabel": "لم يتم التحقق"
        },
        "ui": {
          "layout": "table"
        },
        "timing": {
          "createdAt": "2026-05-15T09:00:00.000Z",
          "createdAtLabel": "12:00 م"
        },
        "meta": {
          "subscriptionId": null,
          "orderId": "665f...",
          "dayId": null
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    },
    "appliedFilters": {
      "status": null,
      "mode": "all",
      "search": null,
      "branchId": null,
      "kitchenId": null,
      "sortBy": "status",
      "sortOrder": "asc"
    }
  }
}
```

Kitchen cycle:

```text
Kitchen Queue
  |
  | prepare
  v
Preparing
  |
  | ready_for_pickup OR out_for_delivery
  v
Ready / Out for delivery
```

Row identification:

| Row type | Identifier |
| --- | --- |
| One-Time Order in `/api/dashboard/ops/*` | `source: "one_time_order"`, `entityType: "order"` |
| One-Time Order in `/api/kitchen/operations/list` | `entityType: "order"`, `meta.orderId` |
| Subscription delivery day | `entityType: "subscription_day"`, `meta.subscriptionId`, `meta.dayId` |
| Subscription branch pickup day | `entityType: "pickup_day"`, `meta.subscriptionId`, `meta.dayId` |

Action examples for unified dashboard ops:

```json
{
  "entityId": "<orderId-or-subscriptionDayId>",
  "entityType": "order",
  "payload": {}
}
```

Action examples for direct kitchen endpoints:

```http
POST /api/kitchen/orders/:id/preparing
POST /api/kitchen/orders/:id/ready-for-pickup
POST /api/kitchen/orders/:id/out-for-delivery
POST /api/kitchen/subscriptions/:id/days/:date/in-preparation
POST /api/kitchen/subscriptions/:id/days/:date/out-for-delivery
POST /api/kitchen/subscriptions/:id/days/:date/ready-for-pickup
```

Use the `actions[].endpoint` returned by `/api/kitchen/operations/list` when using the kitchen operations API.

## 8. Pickup Queue Flow

Pickup flow:

```text
Ready for pickup
   |
   | customer arrives
   v
Staff verifies
   |
   | fulfill / deduct
   v
Received / Fulfilled
```

### One-Time Orders

Use dashboard ops DTOs:

- show `context.pickupCode`
- visually match customer app code
- call `/api/dashboard/ops/actions/fulfill`
- do not send `pickupCode`

### Subscription Pickup With App / Preselected Meal

Existing direct pickup queue endpoints:

```http
GET /api/kitchen/pickups/:date
GET /api/kitchen/today-pickup
POST /api/kitchen/pickups/:dayId/verify
POST /api/kitchen/subscriptions/:id/days/:date/fulfill-pickup
POST /api/kitchen/pickups/:dayId/no-show
```

Verify pickup request body:

```json
{
  "code": "123456"
}
```

Important:

- This verification endpoint is for subscription pickup days.
- Do not use it for One-Time Orders.
- For subscription pickup days with an issued code, direct fulfillment can require prior verification.
- The unified dashboard ops action flow for `subscription_pickup_request` also accepts `payload.pickupCode`, but the direct `/api/kitchen/pickups/:dayId/verify` endpoint reads `code`.

### Subscription Pickup Without Phone/App

Use manual subscription meal deduction:

```http
GET /api/dashboard/subscriptions/search?phone=<phone>
POST /api/dashboard/subscriptions/:subscriptionId/manual-deduction
```

## 9. Subscription Manual Deduction Flow

```text
Customer arrives without phone/app
   |
   v
Admin searches by phone
   |
   v
Dashboard shows active subscription summary
   |
   v
Admin enters regular/premium counts only
   |
   v
Admin confirms
   |
   v
Backend deducts balance + creates ActivityLog
```

Frontend fields:

- `regularMeals`
- `premiumMeals`
- `reason`
- `notes`

Do not ask for:

- food item
- product
- protein/carb/salad option
- meal slot
- delivery address/window
- skip/freeze controls

## 10. Subscription Search Endpoint

```http
GET /api/dashboard/subscriptions/search?phone=<phone>
Authorization: Bearer <dashboard_access_token>
```

Roles:

- `admin`
- `superadmin`

Response example:

```json
{
  "status": true,
  "data": {
    "customer": {
      "id": "665c...",
      "name": "Customer Name",
      "phone": "+966..."
    },
    "subscription": {
      "id": "665d...",
      "planName": "Plan Name",
      "status": "active",
      "fulfillmentMethod": "pickup",
      "totalMeals": 30,
      "consumedMeals": 23,
      "remainingMeals": 7,
      "remainingRegularMeals": 5,
      "remainingPremiumMeals": 2
    },
    "subscriptions": [
      {
        "id": "665d...",
        "planName": "Plan Name",
        "status": "active",
        "fulfillmentMethod": "pickup",
        "totalMeals": 30,
        "consumedMeals": 23,
        "remainingMeals": 7,
        "remainingRegularMeals": 5,
        "remainingPremiumMeals": 2
      }
    ],
    "today": {
      "businessDate": "2026-05-15",
      "hasDeliveryDeductionToday": false,
      "lastDeductionAt": null
    }
  }
}
```

Multiple active subscriptions:

- The backend returns a primary `subscription`.
- The backend also returns `subscriptions`.
- If `subscriptions.length > 1`, show a subscription selector.
- Submit manual deduction against the selected subscription id.

## 11. Manual Subscription Deduction Endpoint

```http
POST /api/dashboard/subscriptions/:subscriptionId/manual-deduction
Authorization: Bearer <dashboard_access_token>
Content-Type: application/json
```

Request body:

```json
{
  "regularMeals": 1,
  "premiumMeals": 2,
  "reason": "Manual branch pickup deduction",
  "notes": "Customer came without phone"
}
```

Success response:

```json
{
  "status": true,
  "data": {
    "subscriptionId": "665d...",
    "deducted": {
      "regularMeals": 1,
      "premiumMeals": 2,
      "total": 3
    },
    "remaining": {
      "regularMeals": 4,
      "premiumMeals": 0,
      "totalMeals": 4
    },
    "businessDate": "2026-05-15",
    "fulfillmentMethod": "pickup"
  }
}
```

Audit behavior:

- backend creates `ActivityLog`
- `action: "manual_subscription_meal_deduction"`
- `entityType: "subscription"`
- includes actor, before/after balances, reason, notes, fulfillment method, and business date

## 12. Subscription Pickup vs Delivery Rules

| Fulfillment Method | Same-day multiple deductions? | Rule |
| --- | --- | --- |
| `pickup` | Yes | Allowed while balance remains |
| `delivery` | No | Only once per business day |

Pickup subscription:

- multiple deductions per day are allowed
- backend checks subscription status and balance
- frontend should not block same-day pickup deductions

Delivery subscription:

- only one manual deduction per business date
- frontend may disable the form if `today.hasDeliveryDeductionToday = true`
- backend remains source of truth
- if backend returns `DELIVERY_ALREADY_DEDUCTED_TODAY`, show “already delivered/deducted today”
- manual subscription deduction is not a replacement for normal delivery operations
- normal delivery meals should still use the existing kitchen/subscription-day delivery flow, such as `/api/kitchen/subscriptions/:id/days/:date/in-preparation`, `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery`, and the appropriate fulfillment flow
- manual delivery deduction is only an admin balance-deduction flow and remains limited to once per business day

## 13. Manual Deduction Validation Errors

Manual deduction stable error codes:

| Error Code | Meaning | Frontend Behavior |
| --- | --- | --- |
| `CUSTOMER_NOT_FOUND` | Phone does not match a customer, or subscription customer is missing | Show customer not found |
| `SUBSCRIPTION_NOT_FOUND` | No active subscription found or invalid subscription id | Show no active subscription |
| `SUBSCRIPTION_NOT_ACTIVE` | Subscription cannot be used | Show inactive subscription |
| `INVALID_MEAL_COUNT` | Counts are invalid, negative, non-integer, or total is zero | Highlight count fields |
| `INSUFFICIENT_REMAINING_MEALS` | Total requested exceeds balance | Show insufficient balance |
| `INSUFFICIENT_REGULAR_MEALS` | Regular requested exceeds regular balance | Show insufficient regular meals |
| `INSUFFICIENT_PREMIUM_MEALS` | Premium requested exceeds premium balance | Show insufficient premium meals |
| `DELIVERY_ALREADY_DEDUCTED_TODAY` | Delivery already used today | Show already delivered/deducted today |
| `FORBIDDEN` | Staff role cannot do this | Show permission message |
| `UNAUTHORIZED` | Missing/invalid dashboard token | Redirect to login |

One-Time Order / ops error codes currently used by the dashboard ops controller and policy:

| Error Code | Meaning | Frontend Behavior |
| --- | --- | --- |
| `INVALID_REQUEST` | Missing `entityId` or `entityType` | Treat as implementation bug |
| `NOT_FOUND` | Entity does not exist | Remove stale row / show not found |
| `UNKNOWN_ACTION` | Action id is not registered | Treat as implementation bug |
| `INSUFFICIENT_PERMISSIONS` | Staff role cannot perform action | Hide/disable action and show permission message |
| `INVALID_MODE_FOR_ACTION` | Action does not apply to pickup/delivery mode | Refresh row/detail |
| `INVALID_TRANSITION` / `INVALID_STATE_TRANSITION` | Action not allowed from current state | Refresh row/detail |
| `ORDER_PAYMENT_REQUIRED` | Order is not paid | Keep non-operational |
| `PICKUP_PREPARE_REQUIRED` | Subscription pickup day needs explicit pickup prepare request | Show preparation requirement |
| `INVALID_PICKUP_CODE` | Subscription pickup code mismatch in unified action flow | Ask staff to re-check code |

Legacy/direct kitchen endpoints may return additional codes such as:

| Error Code | Meaning | Frontend Behavior |
| --- | --- | --- |
| `INVALID` | Invalid mode/request for endpoint | Show backend message |
| `PICKUP_VERIFICATION_REQUIRED` | Subscription pickup fulfillment requires verification first | Show verify step |
| `PICKUP_CODE_NOT_ISSUED` | Subscription pickup code missing | Refresh / ask kitchen to mark ready |
| `PICKUP_CODE_MISMATCH` | Subscription pickup code does not match | Show mismatch |
| `LOCKED_SNAPSHOT_REQUIRED` | Subscription day snapshot missing before preparation | Refresh / escalate |

## 14. Dashboard Screens Recommended

### Kitchen Queue Screen

Fields:

- order/subscription identifier
- customer name
- customer phone if available
- status
- fulfillment method (`mode`)
- items/summary if available
- allowed actions or `actions[]` depending on endpoint used

Actions:

- prepare
- ready for pickup
- out for delivery if supported
- cancel if allowed

### Pickup Queue Screen

Fields:

- customer
- order number/subscription reference
- pickup code for One-Time Orders
- status
- allowed actions

Actions:

- fulfill / `تم الاستلام`
- verify pickup for subscription pickup days where required
- no-show for subscription pickup days if returned by backend

### Manual Subscription Deduction Screen

Fields:

- phone search
- customer summary
- subscription selector if multiple active subscriptions
- subscription summary
- remaining regular meals
- remaining premium meals
- `regularMeals` input
- `premiumMeals` input
- reason
- notes
- confirm deduction

Do not include:

- product picker
- food picker
- meal slot picker
- subscription skip/freeze controls
- delivery address editor

## 15. End-to-End Flow Maps

### One-Time Order Pickup Flow

```text
Customer creates order
   |
Payment success
   |
Order confirmed
   |
Kitchen prepares
   |
Order ready_for_pickup + pickupCode generated
   |
Customer arrives
   |
Staff visually matches code
   |
Staff clicks fulfill
   |
Order fulfilled
```

### Subscription Pickup Manual Deduction Flow

```text
Customer arrives at branch
   |
Gives phone number to staff
   |
Staff searches subscription by phone
   |
Dashboard shows remaining balances
   |
Staff enters regular/premium meal counts
   |
Backend validates balance
   |
Backend deducts meals
   |
ActivityLog is created
   |
Customer receives meals
```

### Subscription Delivery Flow

```text
Delivery subscription due today
   |
Kitchen prepares delivery meal
   |
Delivery/fulfillment recorded
   |
Backend marks business day as used
   |
Second same-day manual deduction attempt
   |
Backend rejects DELIVERY_ALREADY_DEDUCTED_TODAY
```

## 16. API Quick Reference

| Area | Method | Endpoint | Body Required | Notes |
| --- | --- | --- | --- | --- |
| Ops | GET | `/api/dashboard/ops/list?date=YYYY-MM-DD` | No | Recommended mixed ops list |
| Ops | GET | `/api/dashboard/ops/search?q=<query>` | No | Search mixed ops rows |
| Orders | POST | `/api/dashboard/ops/actions/prepare` | Yes | Body uses `entityId`, `entityType: "order"` |
| Orders | POST | `/api/dashboard/ops/actions/ready_for_pickup` | Yes | Generates pickup code for pickup One-Time Orders |
| Orders | POST | `/api/dashboard/ops/actions/fulfill` | Yes, but no `pickupCode` | Visual verification only |
| Orders | POST | `/api/dashboard/ops/actions/cancel` | Yes | Cancel is not refund |
| Kitchen | GET | `/api/kitchen/operations/list?date=YYYY-MM-DD` | No | Kitchen queue with tabs/filters |
| Kitchen | GET | `/api/kitchen/operations/summary?date=YYYY-MM-DD` | No | Kitchen summary |
| Kitchen Orders | POST | `/api/kitchen/orders/:id/preparing` | No | Legacy/direct order action |
| Kitchen Orders | POST | `/api/kitchen/orders/:id/ready-for-pickup` | No | Legacy/direct order action |
| Kitchen Orders | POST | `/api/kitchen/orders/:id/fulfilled` | No | Legacy/direct order action |
| Subscription Days | POST | `/api/kitchen/subscriptions/:id/days/:date/in-preparation` | No | Legacy/direct subscription day action |
| Subscription Days | POST | `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery` | No | Legacy/direct subscription delivery action |
| Subscription Pickup | GET | `/api/kitchen/pickups/:date` | No | Pickup queue |
| Subscription Pickup | GET | `/api/kitchen/today-pickup` | No | Today pickup queue |
| Subscription Pickup | POST | `/api/kitchen/pickups/:dayId/verify` | Yes | Body requires `pickupCode` for subscription pickup |
| Subscription Pickup | POST | `/api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | No | Subscription pickup fulfillment |
| Subscriptions | GET | `/api/dashboard/subscriptions/search?phone=<phone>` | No | Manual deduction search |
| Subscriptions | POST | `/api/dashboard/subscriptions/:subscriptionId/manual-deduction` | Yes | `regularMeals` / `premiumMeals` only |

## 17. Frontend Implementation Checklist

- [ ] Branch rows by `source` and `entityType`.
- [ ] Use `allowedActions` from `/api/dashboard/ops/*`.
- [ ] Use `actions[]` from `/api/kitchen/operations/list` if building kitchen queue from that endpoint.
- [ ] Show pickup code for One-Time Orders from `context.pickupCode`.
- [ ] Remove pickup code input for One-Time Order fulfillment.
- [ ] Fulfill One-Time Order without `pickupCode`.
- [ ] Build phone search for subscription manual deduction.
- [ ] Show customer and subscription summary.
- [ ] Show remaining regular meals.
- [ ] Show remaining premium meals.
- [ ] Build regular/premium deduction form.
- [ ] Do not show food selection in manual deduction.
- [ ] Allow same-day repeated pickup deductions while balance remains.
- [ ] Block or warn for delivery if `hasDeliveryDeductionToday = true`.
- [ ] Show backend errors clearly.
- [ ] Refresh row/detail after every successful action.

## 18. Notes for Frontend Developer

- Backend is the source of truth.
- Frontend should not compute final permissions.
- Always refresh after actions.
- Use backend response balances after manual deduction.
- Do not assume pickup and delivery behave the same.
- Do not assume One-Time Orders and Subscriptions share fields.
- Use One-Time Order fields only for One-Time Orders.
- Use subscription balance fields only for subscriptions.
- Keep cancellation separate from refunds.
