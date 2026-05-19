# Backend Order Contract Confirmation

This report confirms the backend contracts implemented for the current one-time order frontend handoff.

Subscription checkout premium item note:

- `premiumItems` accepts backend premium protein IDs, backend premium protein keys, and `premium_large_salad`.
- `custom_premium_salad` is a legacy alias and is normalized to `premium_large_salad`.
- Frontend should send `premium_large_salad` for subscription quote/checkout large salad purchases.
- Unknown premium keys return HTTP 422 with `INVALID_PREMIUM_ITEM`.

## 1. Implemented Endpoints

| Area | Endpoint | Auth | Status |
|---|---|---|---|
| Customer order detail | `GET /api/orders/:id` | Customer bearer token | Confirmed |
| Customer order list | `GET /api/orders` | Customer bearer token | Confirmed |
| Customer order cancel | `DELETE /api/orders/:id` | Customer bearer token | Confirmed |
| Customer order timeline | `GET /api/orders/:id/timeline` | Customer bearer token | Implemented |
| Dashboard order list | `GET /api/dashboard/orders` | Dashboard bearer token | Confirmed |
| Dashboard order detail | `GET /api/dashboard/orders/:orderId` | Dashboard bearer token | Confirmed |
| Dashboard order action | `POST /api/dashboard/orders/:orderId/actions/:action` | Dashboard bearer token | Confirmed |
| Dashboard order timeline | `GET /api/dashboard/orders/:orderId/timeline` | Dashboard bearer token | Implemented |
| Customer register OTP | `POST /api/auth/register/request-otp` | Public | Confirmed |
| Customer register verify | `POST /api/auth/register/verify` | Public | Confirmed |
| Customer login | `POST /api/auth/login` | Public | Confirmed |
| Customer refresh | `POST /api/auth/refresh` | Public with refresh token body | Confirmed |
| Customer me | `GET /api/auth/me` | Customer bearer token | Confirmed |
| Customer logout | `POST /api/auth/logout` | Customer bearer token | Confirmed |
| Customer logout all | `POST /api/auth/logout-all` | Customer bearer token | Confirmed |
| Forgot password | `POST /api/auth/password/forgot` | Public | Confirmed |
| Reset password | `POST /api/auth/password/reset` | Public | Confirmed |
| Dashboard login | `POST /api/dashboard/auth/login` | Public | Confirmed |
| Dashboard me | `GET /api/dashboard/auth/me` | Dashboard bearer token optional | Confirmed |
| Dashboard logout | `POST /api/dashboard/auth/logout` | Dashboard bearer token | Confirmed |

## 2. Final Order Response Shape

Customer and dashboard order serializers now expose frontend contract fields:

```json
{
  "id": "ORDER_ID",
  "orderId": "ORDER_ID",
  "source": "one_time_order",
  "status": "in_preparation",
  "paymentStatus": "paid",
  "fulfillmentMethod": "pickup",
  "allowedActions": ["ready_for_pickup", "cancel"],
  "timeline_endpoint": "/api/orders/ORDER_ID/timeline",
  "cancelled_by": null,
  "cancellation_reason": null,
  "cancellation_source": null,
  "cancelled_at": null
}
```

Dashboard action response returns the updated dashboard order DTO, including:

```json
{
  "status": true,
  "data": {
    "id": "ORDER_ID",
    "status": "ready_for_pickup",
    "paymentStatus": "paid",
    "fulfillmentMethod": "pickup",
    "allowedActions": ["fulfill", "cancel"],
    "cancelled_by": null,
    "cancellation_reason": null,
    "cancellation_source": null,
    "cancelled_at": null,
    "timeline_endpoint": "/api/orders/ORDER_ID/timeline"
  }
}
```

## 3. Final Timeline Response Shape

Endpoints:

- `GET /api/orders/:id/timeline`
- `GET /api/dashboard/orders/:orderId/timeline`

Example:

```json
{
  "status": true,
  "data": {
    "order_id": "ORDER_ID",
    "current_status": "in_preparation",
    "timeline": [
      {
        "key": "order_created",
        "label_ar": "تم إنشاء الطلب",
        "label_en": "Order Created",
        "state": "completed",
        "time": "2026-05-19T10:00:00.000Z"
      },
      {
        "key": "payment_confirmed",
        "label_ar": "تم تأكيد الطلب",
        "label_en": "Payment Confirmed",
        "state": "completed",
        "time": "2026-05-19T10:05:00.000Z"
      },
      {
        "key": "preparing",
        "label_ar": "جاري تجهيز الطلب",
        "label_en": "Preparing",
        "state": "active",
        "time": "2026-05-19T10:10:00.000Z"
      },
      {
        "key": "ready_for_pickup",
        "label_ar": "الطلب جاهز للاستلام",
        "label_en": "Ready for Pickup",
        "state": "pending",
        "time": null
      },
      {
        "key": "fulfilled",
        "label_ar": "تم استلام الطلب",
        "label_en": "Picked Up",
        "state": "pending",
        "time": null
      }
    ]
  }
}
```

Timeline keys are pickup-only for one-time orders:

- `order_created`
- `payment_confirmed`
- `preparing`
- `ready_for_pickup`
- `fulfilled`
- `cancelled`
- `expired`

No one-time delivery timeline is returned.

## 4. Final Cancellation Metadata Shape

### Customer Cancellation

```json
{
  "status": "cancelled",
  "cancelled_by": "customer",
  "cancellation_reason": "customer_requested",
  "cancellation_source": "mobile_app",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

### Restaurant Cancellation

Restaurant rejection:

```json
{
  "status": "cancelled",
  "cancelled_by": "restaurant",
  "cancellation_reason": "restaurant_rejected",
  "cancellation_source": "dashboard",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

Restaurant cancellation:

```json
{
  "status": "cancelled",
  "cancelled_by": "restaurant",
  "cancellation_reason": "restaurant_cancelled",
  "cancellation_source": "dashboard",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

Final decision: because the system currently has only one branch, the frontend contract does not expose `branch` as a cancellation actor. Use `cancelled_by=restaurant` for restaurant-side rejection/cancellation.

### Admin Cancellation

```json
{
  "status": "cancelled",
  "cancelled_by": "admin",
  "cancellation_reason": "admin_cancelled",
  "cancellation_source": "dashboard",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

### Payment Failed

```json
{
  "status": "cancelled",
  "cancelled_by": "system",
  "cancellation_reason": "payment_failed",
  "cancellation_source": "payment_provider",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

### Payment Expired

The backend uses `status=expired` for expired pending-payment orders.

```json
{
  "status": "expired",
  "cancelled_by": "system",
  "cancellation_reason": "payment_expired",
  "cancellation_source": "system",
  "cancelled_at": "2026-05-19T10:00:00.000Z"
}
```

## 5. Final allowedActions Rules

Buttons must be rendered from `allowedActions`.

| Status | Role | allowedActions |
|---|---|---|
| `pending_payment` | Customer detail/list | `["cancel"]` when `paymentStatus=initiated` |
| `pending_payment` | Dashboard roles | `[]` |
| `confirmed` | `admin`, `superadmin` | `["prepare", "cancel"]` |
| `confirmed` | `kitchen` | `["prepare", "cancel"]` |
| `confirmed` | `courier`, `cashier` | `[]` |
| `in_preparation` | `admin`, `superadmin` | `["ready_for_pickup", "cancel"]` |
| `in_preparation` | `kitchen` | `["ready_for_pickup", "cancel"]` |
| `in_preparation` | `courier`, `cashier` | `[]` |
| `ready_for_pickup` | `admin`, `superadmin` | `["fulfill", "cancel"]` |
| `ready_for_pickup` | `kitchen` | `["fulfill", "cancel"]` |
| `ready_for_pickup` | `courier`, `cashier` | `[]` |
| `fulfilled` | Any | `[]` |
| `cancelled` | Any | `[]` |
| `expired` | Any | `[]` |

Current dashboard order action service still has delivery action constants internally, but delivery orders are blocked by the one-time delivery gate when `ONE_TIME_ORDER_DELIVERY_ENABLED` is not true. Frontend responses for current one-time pickup orders do not return `dispatch`, `notify_arrival`, or delivery fulfill actions.

Kitchen cancellation decision: kitchen cancellation remains allowed. Because the system is single-branch, kitchen-side cancellation is restaurant cancellation and must return `cancelled_by=restaurant`, `cancellation_reason=restaurant_cancelled`, and `cancellation_source=dashboard`. The frontend must never render `branch` as a one-time cancellation actor.

## 6. Disabled Features Confirmed

| Feature / State | Backend Confirmation |
|---|---|
| One-time delivery | Disabled by default. Create/quote paths reject delivery. Dashboard order delivery actions are blocked by delivery gate. |
| `rejected` status | Not added. Rejection is represented as `status=cancelled` with cancellation metadata. |
| `refunded` order status | Not added to `Order.status`. Refund is not part of current order lifecycle. |
| `failed_delivery` for one-time orders | Not added. One-time delivery is disabled. |
| One-time delivery timeline | Not returned by the timeline endpoint. |

All one-time delivery disabled paths now use the frontend-facing error code `DELIVERY_NOT_SUPPORTED`.

## 7. Files Changed

- `src/models/Order.js`
- `src/routes/orders.js`
- `src/routes/dashboardOrders.js`
- `src/controllers/orderController.js`
- `src/controllers/dashboard/orderDashboardController.js`
- `src/services/orders/orderDashboardService.js`
- `src/services/orders/orderOpsTransitionService.js`
- `src/services/orders/orderPaymentService.js`
- `src/services/orders/orderSerializationService.js`
- `src/services/orders/orderTimelineService.js`
- `src/utils/oneTimeOrderDeliveryGate.js`
- `tests/oneTimeOrderOps.test.js`
- `frontend-order-lifecycle-map.md`
- `backend-order-contract-confirmation.md`

## 8. Tests Added / Updated

Updated `tests/oneTimeOrderOps.test.js` to cover:

- `prepare`: `confirmed -> in_preparation`
- `ready_for_pickup`: `in_preparation -> ready_for_pickup`
- `fulfill`: `ready_for_pickup -> fulfilled`
- `cancel`: active states -> `cancelled` with normalized metadata
- customer pending-payment cancellation metadata
- no one-time delivery actions returned while delivery is disabled
- restaurant rejection/cancellation metadata uses `cancelled_by=restaurant`, never `branch`
- timeline response for active, cancelled, and expired statuses
- `409` invalid/final transition behavior via existing tests
- dashboard/customer order response fields: `timeline_endpoint` and cancellation metadata

Verification run:

```text
node -c src/services/orders/orderSerializationService.js
node -c src/services/orders/orderTimelineService.js
node -c src/services/orders/orderOpsTransitionService.js
node -c src/controllers/orderController.js
node -c src/controllers/dashboard/orderDashboardController.js
node -c tests/oneTimeOrderOps.test.js
```

All syntax checks passed.

Full integration test command attempted:

```text
node tests/oneTimeOrderOps.test.js
```

Result: blocked by unavailable local MongoDB:

```text
MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017
```

Run the integration test again with a reachable `MONGO_URI`/`MONGODB_URI`.

## 9. Remaining Questions

1. Should cancellation reason be required for dashboard cancellations, or is defaulting to `admin_cancelled`/`restaurant_cancelled` acceptable?
2. Should customer order detail include dashboard-style `allowedActions`, or is the current customer-only `["cancel"]` for pending payment enough?
