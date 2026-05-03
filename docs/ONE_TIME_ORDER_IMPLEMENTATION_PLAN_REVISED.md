# BasicDiet145 One-Time Orders - Final Implementation Blueprint

This is the project-specific execution plan for adding One-Time Orders beside the subscription system in `/home/hema/Projects/basicdiet145`.

This document is planning only. It does not authorize backend implementation yet.

## Repository Findings

The backend already has a legacy one-time order surface:

- Model: `src/models/Order.js`
- Mobile routes: `src/routes/orders.js`, mounted at `/api/orders` from `src/routes/index.js`
- Mobile controller: `src/controllers/orderController.js`
- Legacy kitchen/courier order controllers: `src/controllers/orderKitchenController.js`, `src/controllers/orderCourierController.js`
- Unified dashboard ops services: `src/services/dashboard/opsReadService.js`, `src/services/dashboard/opsActionPolicy.js`, `src/services/dashboard/opsTransitionService.js`, `src/services/dashboard/opsSearchService.js`
- Dashboard board routes: `src/routes/dashboardBoards.js`, mounted under `/api/dashboard`
- Unified ops routes: `src/routes/dashboardOps.js`, mounted under `/api/dashboard/ops`

The existing order flow is real but not aligned with the requested final contract:

- Existing order statuses are `created`, `confirmed`, `preparing`, `out_for_delivery`, `ready_for_pickup`, `fulfilled`, `canceled`.
- Final requested statuses are `pending_payment`, `confirmed`, `in_preparation`, `ready_for_pickup`, `out_for_delivery`, `fulfilled`, `cancelled`, `expired`.
- Existing `/api/orders/checkout` creates a Moyasar invoice immediately.
- Existing `/api/orders/menu` uses legacy `Meal` menu, not the builder catalog requested for this final one-time order system.
- Existing webhook already handles `Payment.type = "one_time_order"` in `src/controllers/webhookController.js`.
- Existing `Payment` model already includes `type: "one_time_order"` and `orderId`.
- Existing ops already partially includes orders, but it uses `type: "order"` or `entityType: "order"` without the requested `source` field and still expects legacy order statuses.

The implementation should evolve the existing Order bounded context instead of creating a second competing order model.

# Final Architecture Decision

One-Time Orders are a separate bounded context beside subscriptions.

Use the existing `Order` model name and `/api/orders` route namespace, but refactor the schema, services, status names, DTOs, and controller structure so one-time orders are not modeled as subscription days.

One-Time Orders:

- are not subscriptions
- do not create or read `SubscriptionDay`
- do not use `mealSlots`
- do not use skip/freeze
- do not consume `remainingMeals`
- have their own `Order` document and lifecycle
- reuse generic shared services only where the service is not subscription-lifecycle-specific

Mobile routes live under `/api/orders`.

Dashboard routes live under `/api/dashboard/orders`.

Ops queues include both subscription days and one-time orders. Each ops DTO must identify its source:

```json
{
  "source": "subscription",
  "entityType": "subscription_day",
  "entityId": "..."
}
```

or:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "entityId": "..."
}
```

Payment uses the existing Moyasar service and `Payment` model. Webhook handling should add/refine the order branch without changing subscription payment behavior.

Promo codes may reuse `PromoCode`, `PromoUsage`, and discount helpers, but the current `PromoCode.appliesTo` enum does not explicitly include orders. The implementation must extend promo eligibility safely before enabling order promo codes.

Delivery fee should come from `Zone.deliveryFeeHalala` when `zoneId` is supplied and active. If no zone is supplied, fallback to a configured one-time setting such as `one_time_delivery_fee_halala` or current legacy `one_time_delivery_fee`.

VAT is included in prices and only displayed as a breakdown. The order total is not increased by VAT after item pricing.

Orders are not deleted on expiry. Pending payment orders become `expired` and remain in history.

## Reuse / Do Not Reuse Table

| Concern | Reuse existing? | Exact file/service to reuse | Notes |
|---|---|---|---|
| Auth | Yes | `src/middleware/auth.js` | Use `authMiddleware` for mobile client orders. Owner rule is always `Order.userId === req.userId`. |
| Dashboard auth | Yes | `src/middleware/dashboardAuth.js` | Use `dashboardAuthMiddleware` and `dashboardRoleMiddleware`. |
| Role middleware | Yes | `src/middleware/dashboardAuth.js` | Dashboard order routes should allow `superadmin`, `admin`, `kitchen`, `courier` based on action. |
| Moyasar | Yes | `src/services/moyasarService.js` | Reuse `createInvoice()` and `getInvoice()`. Add order-specific wrapper service instead of calling from controller directly. |
| Payment model | Yes | `src/models/Payment.js` | `type: "one_time_order"` already exists. Continue using `orderId`, `providerInvoiceId`, `providerPaymentId`, `applied`. |
| Payment redirect helpers | Partial | `src/services/paymentFlowService.js` | It currently dispatches to subscription side effects. Add an order-aware branch before using for the new verify endpoint. |
| Payment webhook | Yes, update carefully | `src/controllers/webhookController.js` | Existing `one_time_order` branch should be aligned to `pending_payment`, `cancelled`, and `expired`. Do not change subscription branches. |
| Promo | Partial | `src/models/PromoCode.js`, `src/services/promoCodeService.js`, `src/models/PromoUsage.js` | Extend promo applicability to orders before enabling. Do not use subscription quote-only eligibility unchanged. |
| VAT/settings | Yes | `src/models/Setting.js`, `src/utils/pricing.js`, `src/controllers/settingsController.js` | Use `vat_percentage`; use `computeInclusiveVatBreakdown()` for included VAT. |
| Zones | Yes | `src/models/Zone.js` | Validate active zone and use `deliveryFeeHalala`. |
| Restaurant hours | Yes | `src/services/restaurantHoursService.js` | Use for business date and pickup availability; do not call subscription cutoff lifecycle from `/api/orders`. |
| Delivery windows | Yes | `Setting` key `delivery_windows` | Validate requested delivery window for delivery orders. |
| Catalog | Yes | `BuilderProtein`, `BuilderCarb`, `Sandwich`, `SaladIngredient`, `Addon`, `mealPlannerCatalogService` | Build order menu from the builder catalog. Do not rely only on legacy `Meal` for the final one-time menu. |
| ActivityLog | Yes | `src/models/ActivityLog.js`, `src/utils/log.js` | Write order activity for create, payment, cancel, dashboard actions, expiry. |
| SubscriptionAuditLog | No | `src/models/SubscriptionAuditLog.js` | Keep for subscription days only. Orders use `ActivityLog`. |
| Ops action policy | Yes, update | `src/services/dashboard/opsActionPolicy.js` | Add final order statuses and one-time source metadata. |
| Ops transition service | Yes, update carefully | `src/services/dashboard/opsTransitionService.js` | Must not call subscription fulfillment for orders. Use order-only transition logic for `entityType: "order"`. |
| Kitchen ops mapping | Yes, update | `src/services/kitchenOperations/*` | Include `source`, new statuses, final DTO shape. |
| Postman style | Yes | `docs/dashboard-api/postman.dashboard_full_collection.json` | Add folders and variables following existing collection style. |
| Docs style | Yes | `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md`, `docs/dashboard-api/endpoint-matrix.md` | Add dashboard and Flutter contracts. |
| Tests style | Yes | `tests/*.test.js`, `tests/*verification*.js` | Existing tests are Node scripts with `supertest`, `assert`, and direct process exit. Follow that style. |

## Services That Must Not Be Called From `/api/orders`

Do not call subscription lifecycle/day logic from mobile one-time order APIs:

- `src/models/SubscriptionDay.js`
- `src/services/subscription/subscriptionActivationService.js`
- `src/services/subscription/subscriptionRenewalService.js`
- `src/services/subscription/subscriptionLifecycleService.js`
- `src/services/subscription/pastSubscriptionDaySettlementService.js`
- `src/services/subscription/subscriptionDaySelectionSync.js`
- `src/services/subscription/mealSlotPlannerService.js`
- skip/freeze/remaining-meal settlement services

Ops read services may query both `SubscriptionDay` and `Order`, but the order branch must stay order-only.

# Final Order Lifecycle

Final order statuses:

- `pending_payment`
- `confirmed`
- `in_preparation`
- `ready_for_pickup`
- `out_for_delivery`
- `fulfilled`
- `cancelled`
- `expired`

Use `fulfilled`, not `delivered`, to align with subscription ops.

Use `in_preparation`, not `preparing`.

Use `cancelled` for order business status. Existing payment status may continue using `canceled` because `Payment.status` already defines it that way.

| Status | Meaning | Final? | Allowed actions | Board |
|---|---|---|---|---|
| `pending_payment` | Order draft was created, priced, and invoice initialized, but payment is not paid yet. | No | Mobile `DELETE` cancel; verify payment; lazy expiry. Dashboard should not prepare. | Hidden from kitchen/courier/pickup. Visible in dashboard orders list with payment filter. |
| `confirmed` | Payment is paid and order can enter operations. | No | Dashboard `prepare`, `cancel`; mobile read only. | Kitchen queue. Delivery schedule if delivery. |
| `in_preparation` | Kitchen started preparing the order. | No | `ready_for_pickup` for pickup; `dispatch` for delivery; `cancel`. | Kitchen, pickup for pickup, courier prep visibility for delivery. |
| `ready_for_pickup` | Pickup order is ready at branch. | No | `fulfill`, `cancel`. | Pickup board. |
| `out_for_delivery` | Delivery order has been dispatched. | No | `notify_arrival`, `fulfill`, `cancel`. | Courier board and delivery schedule. |
| `fulfilled` | Order is completed. | Yes | None. | History; optional board visibility when status filter includes fulfilled. |
| `cancelled` | Order was cancelled by client before payment, by dashboard policy, or by payment failure mapping. | Yes by default | Optional dashboard `reopen` only if product confirms. | History; dashboard list. |
| `expired` | Pending payment order exceeded expiry window and was not paid. | Yes | None; optional create new order from same cart. | History; dashboard list. |

## Transition Rules

Final transition map for `src/utils/orderState.js`:

```js
{
  pending_payment: ["confirmed", "cancelled", "expired"],
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["fulfilled", "cancelled"],
  out_for_delivery: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: ["confirmed"], // only if dashboard reopen is enabled
  expired: []
}
```

If product rejects dashboard reopen, remove `cancelled: ["confirmed"]`.

# Final Endpoint Contract

All responses should follow the existing `{ status: true, data }` or `errorResponse()` convention.

Use ObjectId path params named `orderId` in docs and code variables, even though Express can use `:orderId`.

## Mobile One-Time Orders

### `GET /api/orders/menu`

Purpose: Return one-time order menu built from active catalog sources.

Auth required: no for public browsing, yes if personalized promo eligibility is included. Recommended default: no auth.

Owner rules: none.

Query params:

- `lang`: optional, existing request-language middleware may also use headers.
- `fulfillmentMethod`: optional `pickup|delivery` to include relevant availability.

Response body:

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "itemTypes": ["standard_meal", "sandwich", "salad", "addon_item"],
    "standardMeals": [],
    "sandwiches": [],
    "salad": { "ingredients": [], "rules": {} },
    "addons": { "items": [], "byCategory": {} },
    "delivery": { "windows": [], "zones": [] },
    "restaurantHours": {}
  }
}
```

Error codes:

- `500 INTERNAL`

Notes:

- Build from `BuilderProtein`, `BuilderCarb`, `Sandwich`, `SaladIngredient`, and `Addon kind=item`.
- Keep legacy `Meal` support only as a compatibility fallback if needed.

### `POST /api/orders/quote`

Decision: add this endpoint.

Reason: this repo already uses quote-before-create for subscription checkout (`POST /api/subscriptions/quote`), and Flutter needs backend-final cart pricing before creating a pending payment order. A quote endpoint prevents abandoned payment orders when the user is only checking totals.

Purpose: Price the cart without creating `Order` or `Payment`.

Auth required: yes, `authMiddleware`.

Owner rules: quote is calculated for `req.userId`; no persisted ownership.

Request body:

```json
{
  "fulfillmentMethod": "delivery",
  "delivery": {
    "zoneId": "6630f0f5d8f9f5a21b8c2222",
    "address": {
      "label": "Home",
      "line1": "Street 1",
      "line2": "",
      "district": "North",
      "city": "Riyadh",
      "phone": "+966500000000",
      "notes": ""
    },
    "deliveryWindow": "18:00-20:00"
  },
  "pickup": {
    "branchId": "main",
    "pickupWindow": "18:00-20:00"
  },
  "items": [
    {
      "itemType": "standard_meal",
      "qty": 1,
      "selections": {
        "proteinId": "...",
        "carbs": [{ "carbId": "...", "grams": 150 }]
      }
    }
  ],
  "promoCode": "WELCOME"
}
```

Response body:

```json
{
  "status": true,
  "data": {
    "quoteId": null,
    "currency": "SAR",
    "items": [],
    "pricing": {
      "subtotalHalala": 5000,
      "deliveryFeeHalala": 1500,
      "discountHalala": 500,
      "totalHalala": 6000,
      "vatPercentage": 15,
      "vatHalala": 783,
      "vatIncluded": true
    },
    "appliedPromo": null,
    "expiresInSeconds": 0
  }
}
```

Error codes:

- `400 INVALID_REQUEST`
- `400 INVALID_SELECTION`
- `400 INVALID_DELIVERY_WINDOW`
- `400 PROMO_*`
- `404 NOT_FOUND`
- `409 RESTAURANT_CLOSED`
- `409 ZONE_INACTIVE`

Notes:

- The quote is stateless by default. Do not persist quote records unless product later needs quote locking.
- `POST /api/orders` must recalculate pricing and must not trust the quote response.

### `POST /api/orders`

Purpose: Create a pending payment one-time order and Moyasar invoice.

Auth required: yes, `authMiddleware`, `checkoutLimiter`.

Owner rules: created order uses `req.userId`.

Headers:

- `Idempotency-Key` or `X-Idempotency-Key`: optional, max 128 chars.

Request body:

Same as `POST /api/orders/quote`, plus:

```json
{
  "successUrl": "basicdiet://orders/payment-success",
  "backUrl": "basicdiet://orders/payment-cancel"
}
```

Response body:

```json
{
  "status": true,
  "data": {
    "orderId": "...",
    "paymentId": "...",
    "paymentUrl": "https://moyasar.com/...",
    "invoiceId": "moyasar_invoice_id",
    "status": "pending_payment",
    "paymentStatus": "initiated",
    "expiresAt": "2026-05-03T12:30:00.000Z",
    "pricing": {},
    "items": []
  }
}
```

Error codes:

- `400 INVALID_REQUEST`
- `400 INVALID_SELECTION`
- `400 INVALID_REDIRECT_URL`
- `400 PROMO_*`
- `401 UNAUTHORIZED`
- `404 NOT_FOUND`
- `409 IDEMPOTENCY_CONFLICT`
- `409 CHECKOUT_IN_PROGRESS`
- `409 RESTAURANT_CLOSED`
- `409 ZONE_INACTIVE`
- `500 CONFIG`
- `502 PAYMENT_PROVIDER_ERROR`

Notes:

- Recalculate all prices server-side.
- Create `Order.status = "pending_payment"` and `Payment.status = "initiated"`.
- Set `expiresAt = now + 30 minutes`.
- Use Moyasar metadata: `orderId`, `userId`, `source: "one_time_order"`, `type: "one_time_order"`.

### `GET /api/orders/:orderId`

Purpose: Return order detail.

Auth required: yes.

Owner rules: only owner can read.

Query params: none.

Response body:

```json
{
  "status": true,
  "data": {
    "id": "...",
    "source": "one_time_order",
    "status": "confirmed",
    "paymentStatus": "paid",
    "fulfillmentMethod": "delivery",
    "items": [],
    "pricing": {},
    "delivery": {},
    "pickup": {},
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Error codes:

- `400 INVALID_OBJECT_ID`
- `401 UNAUTHORIZED`
- `404 NOT_FOUND`

Notes:

- Lazy expiry rule: if `status = pending_payment` and `expiresAt < now`, atomically set `status = expired` and `paymentStatus = expired` if the current payment is still unpaid.

### `GET /api/orders`

Purpose: Return current user's one-time order history.

Auth required: yes.

Owner rules: only own orders.

Query params:

- `status`: optional comma-separated list.
- `paymentStatus`: optional.
- `from`, `to`: optional date range on `createdAt` or `fulfillmentDate`.
- `page`, `limit`: pagination.

Response body:

```json
{
  "status": true,
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 }
  }
}
```

Error codes:

- `401 UNAUTHORIZED`
- `400 INVALID_QUERY`

### `DELETE /api/orders/:orderId`

Purpose: Client cancels an unpaid pending order.

Auth required: yes.

Owner rules: only owner can cancel.

Request body: empty.

Response body:

```json
{
  "status": true,
  "data": {
    "id": "...",
    "status": "cancelled",
    "paymentStatus": "canceled"
  }
}
```

Error codes:

- `400 INVALID_OBJECT_ID`
- `401 UNAUTHORIZED`
- `404 NOT_FOUND`
- `409 INVALID_TRANSITION`

Notes:

- Only allowed from `pending_payment`.
- If payment is already paid, return `409 INVALID_TRANSITION`.
- Do not hard delete the order.

### `POST /api/orders/:orderId/payments/:paymentId/verify`

Purpose: Verify Moyasar payment after Flutter WebView returns.

Auth required: yes.

Owner rules:

- `Order.userId === req.userId`
- `Payment.userId === req.userId`
- `Payment.orderId === orderId`
- `Payment.type === "one_time_order"`

Request body:

```json
{
  "providerPaymentId": "optional_moyasar_payment_id",
  "providerInvoiceId": "optional_moyasar_invoice_id"
}
```

Response body:

```json
{
  "status": true,
  "data": {
    "orderId": "...",
    "paymentId": "...",
    "orderStatus": "confirmed",
    "paymentStatus": "paid",
    "applied": true,
    "providerInvoiceStatus": "paid",
    "isFinal": true
  }
}
```

Error codes:

- `400 INVALID_OBJECT_ID`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 MISMATCH`
- `409 PAYMENT_EXPIRED`
- `409 PAYMENT_PROVIDER_ERROR`
- `502 PAYMENT_PROVIDER_ERROR`

Notes:

- Existing aliases `/api/orders/:id/verify-payment` and `/api/orders/:id/payment-status` may remain temporarily for backward compatibility, but the final Flutter contract should use the path above.

## Dashboard One-Time Orders

Create `src/routes/dashboardOrders.js` mounted at `/api/dashboard/orders`.

### `GET /api/dashboard/orders`

Purpose: List one-time orders for admin/ops.

Auth required: dashboard auth.

Roles: `superadmin`, `admin`, `kitchen`, `courier`; role filters may restrict visible rows.

Query params:

- `status`
- `paymentStatus`
- `fulfillmentMethod`
- `date`
- `from`
- `to`
- `zoneId`
- `branchId`
- `q`
- `page`
- `limit`

Response body:

```json
{
  "status": true,
  "data": {
    "items": [],
    "pagination": {}
  }
}
```

### `GET /api/dashboard/orders/:orderId`

Purpose: Dashboard order detail with payment, activity, and ops fields.

Auth required: dashboard auth.

Response body:

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
    "allowedActions": []
  }
}
```

### `POST /api/dashboard/orders/:orderId/actions/:action`

Purpose: Dashboard-specific action endpoint for order operations.

Auth required: dashboard auth.

Actions:

- `prepare`
- `ready_for_pickup`
- `dispatch`
- `notify_arrival`
- `fulfill`
- `cancel`
- `reopen`

Request body:

```json
{
  "reason": "optional cancellation/reopen reason",
  "notes": "optional",
  "etaAt": "2026-05-03T15:30:00.000Z",
  "pickupCode": "123456"
}
```

Response shape:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "entityType": "order",
    "entityId": "...",
    "status": "in_preparation",
    "allowedActions": []
  }
}
```

Action rules:

| Action | Allowed source statuses | Resulting status | Restrictions | ActivityLog |
|---|---|---|---|---|
| `prepare` | `confirmed` | `in_preparation` | kitchen/admin only | `dashboard_prepare` |
| `ready_for_pickup` | `in_preparation` | `ready_for_pickup` | pickup only; kitchen/admin only | `dashboard_ready_for_pickup` |
| `dispatch` | `in_preparation` | `out_for_delivery` | delivery only; kitchen/admin/courier | `dashboard_dispatch` |
| `notify_arrival` | `out_for_delivery` | `out_for_delivery` | delivery only; requires or creates `Delivery` record | `dashboard_notify_arrival` |
| `fulfill` | `ready_for_pickup`, `out_for_delivery` | `fulfilled` | kitchen may fulfill pickup; courier may fulfill delivery | `dashboard_fulfill` |
| `cancel` | `confirmed`, `in_preparation`, `ready_for_pickup`, `out_for_delivery` | `cancelled` | reason recommended; payment refund is out of scope unless product adds it | `dashboard_cancel` |
| `reopen` | `cancelled` | `confirmed` | admin only; product confirmation required | `dashboard_reopen` |

## Ops Integration

Existing endpoints to update:

- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/delivery-schedule`
- `GET /api/dashboard/ops/list`
- `GET /api/dashboard/ops/search`
- `POST /api/dashboard/ops/actions/:action`

Each response item must include:

```json
{
  "source": "subscription",
  "entityType": "subscription_day",
  "entityId": "...",
  "status": "in_preparation",
  "allowedActions": []
}
```

or:

```json
{
  "source": "one_time_order",
  "entityType": "order",
  "entityId": "...",
  "status": "confirmed",
  "allowedActions": []
}
```

Existing `entityType: "subscription_day" | "pickup_day"` can remain for subscriptions. Orders must consistently use `entityType: "order"` and `source: "one_time_order"`.

# Final Data Model

Update existing `src/models/Order.js`; do not create a second model with a different collection unless a migration decision is made.

## Schema

```js
{
  orderNumber: String,
  userId: ObjectId ref "User",
  status: enum [
    "pending_payment",
    "confirmed",
    "in_preparation",
    "ready_for_pickup",
    "out_for_delivery",
    "fulfilled",
    "cancelled",
    "expired"
  ],
  paymentStatus: enum ["initiated", "paid", "failed", "canceled", "expired", "refunded"],
  fulfillmentMethod: enum ["pickup", "delivery"],
  fulfillmentDate: String,
  requestedFulfillmentDate: String,
  fulfillmentDateAdjusted: Boolean,
  deliveryWindow: String,
  items: [{
    itemType: enum ["standard_meal", "sandwich", "salad", "addon_item"],
    catalogRef: {
      model: String,
      id: ObjectId
    },
    name: { ar: String, en: String },
    qty: Number,
    unitPriceHalala: Number,
    lineTotalHalala: Number,
    currency: String,
    selections: {
      proteinId: ObjectId ref "BuilderProtein",
      proteinName: { ar: String, en: String },
      carbs: [{
        carbId: ObjectId ref "BuilderCarb",
        name: { ar: String, en: String },
        grams: Number
      }],
      sandwichId: ObjectId ref "Sandwich",
      salad: {
        groups: Mixed,
        ingredients: [{
          ingredientId: ObjectId ref "SaladIngredient",
          groupKey: String,
          name: { ar: String, en: String },
          qty: Number,
          unitPriceHalala: Number
        }]
      },
      addonItemId: ObjectId ref "Addon"
    },
    nutrition: Mixed
  }],
  pricing: {
    subtotalHalala: Number,
    deliveryFeeHalala: Number,
    discountHalala: Number,
    totalHalala: Number,
    vatPercentage: Number,
    vatHalala: Number,
    vatIncluded: Boolean,
    currency: String,
    appliedPromo: Mixed
  },
  pickup: {
    branchId: String,
    branchName: { ar: String, en: String },
    pickupWindow: String,
    pickupCode: String,
    readyAt: Date,
    pickedUpAt: Date
  },
  delivery: {
    zoneId: ObjectId ref "Zone",
    zoneName: { ar: String, en: String },
    deliveryFeeHalala: Number,
    address: {
      label: String,
      line1: String,
      line2: String,
      district: String,
      city: String,
      phone: String,
      notes: String
    }
  },
  paymentId: ObjectId ref "Payment",
  providerInvoiceId: String,
  providerPaymentId: String,
  paymentUrl: String,
  idempotencyKey: String,
  requestHash: String,
  expiresAt: Date,
  confirmedAt: Date,
  preparationStartedAt: Date,
  readyAt: Date,
  dispatchedAt: Date,
  fulfilledAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  cancellationNote: String,
  cancelledBy: String
}
```

## Naming Notes

- Prefer `fulfillmentMethod` in the final API. Existing code uses `deliveryMode`; implementation may keep `deliveryMode` as a compatibility alias during migration.
- Prefer `fulfillmentDate` in new code. Existing ops uses `deliveryDate`; implementation may map `deliveryDate` to `fulfillmentDate` until clients are migrated.
- Use `cancelled` for order status. Keep `Payment.status = "canceled"` because that enum already exists and matches Moyasar normalization.
- Keep `paymentUrl` for mobile compatibility, but response should expose `paymentUrl` and may also include legacy `payment_url` during transition.

## Indexes

- `{ userId: 1, createdAt: -1 }`
- `{ status: 1, fulfillmentDate: 1 }`
- `{ fulfillmentMethod: 1, fulfillmentDate: 1, status: 1 }`
- `{ "delivery.zoneId": 1, fulfillmentDate: 1 }`
- `{ paymentId: 1 }`
- `{ providerInvoiceId: 1 }` sparse
- `{ userId: 1, idempotencyKey: 1 }` unique sparse / partial non-empty
- `{ userId: 1, requestHash: 1, status: 1 }` partial for `pending_payment`

Do not add a TTL index.

## Validation Notes

- `items` must be non-empty.
- `qty` must be integer `>= 1`.
- `unitPriceHalala`, `lineTotalHalala`, and totals must be integers `>= 0`.
- `delivery.zoneId` is required for delivery unless product confirms flat-fee delivery without zones.
- `pickup.branchId` is required only if pickup branch selection is enabled.
- `expiresAt` is required for `pending_payment`.
- Final statuses cannot be changed except by explicit dashboard reopen policy.

## Serialization Rules

Hide internal fields from mobile:

- `requestHash`
- raw provider metadata
- internal audit notes not meant for client
- `cancelledBy`

Include for mobile:

- `id`
- `source: "one_time_order"`
- `status`
- `paymentStatus`
- `paymentUrl` while pending
- `expiresAt`
- `items`
- `pricing`
- `fulfillmentMethod`
- `delivery` or `pickup`
- timestamps

# Pricing and VAT

Rules:

- Flutter never sends final prices.
- Backend fetches catalog prices.
- `subtotalHalala = sum(qty * unitPriceHalala)`.
- Pickup delivery fee is `0`.
- Delivery fee is `Zone.deliveryFeeHalala` when an active zone is supplied.
- Fallback delivery fee is setting-backed only if product allows orders without zone.
- Promo discount is calculated by backend only.
- VAT is included, not added.
- `totalHalala = subtotalHalala + deliveryFeeHalala - discountHalala`.
- `vatHalala` is an included breakdown value from `computeInclusiveVatBreakdown(totalHalala, vat_percentage)`.
- `currency = "SAR"`.

Create `src/services/orders/orderPricingService.js`.

Expected functions:

- `priceOrderCart({ userId, items, fulfillmentMethod, delivery, pickup, promoCode, lang })`
- `resolveOrderDeliveryFee({ fulfillmentMethod, zoneId })`
- `buildOrderPricingSnapshot({ subtotalHalala, deliveryFeeHalala, discountHalala, vatPercentage })`
- `buildRequestHash(payload)`

Reuse:

- `src/models/Setting.js`
- `src/models/Zone.js`
- `src/utils/pricing.js` using `computeInclusiveVatBreakdown()`
- promo helper functions after adding order eligibility support

Quote/create behavior:

- `POST /api/orders/quote` computes and returns price only.
- `POST /api/orders` recalculates the same pricing, creates `Order`, creates `Payment`, creates Moyasar invoice, and returns `paymentUrl`.
- Do not trust a client-supplied `quoteId`, totals, VAT, or unit prices.

# Menu Mapping

Create `src/services/orders/orderMenuService.js`.

| One-time itemType | Existing model/source | Required selections | Price source |
|---|---|---|---|
| `standard_meal` | `BuilderProtein` + `BuilderCarb` | `proteinId`, one or more carbs per existing builder rules | Base setting such as `one_time_standard_meal_price_halala`; premium protein extra from `BuilderProtein.extraFeeHalala` if allowed |
| `sandwich` | `Sandwich` | `sandwichId` only | `Sandwich.priceHalala`; fallback setting if current price is `0` |
| `salad` | `SaladIngredient` | Ingredient groups following `SALAD_INGREDIENT_GROUP_KEYS` | Sum `SaladIngredient.price * qty`; convert SAR to halala if needed |
| `addon_item` | `Addon` where `kind="item"` and `isActive=true` | `addonItemId` | `Addon.priceHalala` |
| `drink` | `Addon kind=item` category `juice` | `addonItemId` | `Addon.priceHalala` |
| `dessert` | Not a separate model today | Use `Addon kind=item` only if category support is extended | `Addon.priceHalala` |

Current `Addon.category` enum is `juice`, `snack`, `small_salad`. Drinks should initially map to `juice`, snacks/desserts to `snack`, and small salads to `small_salad`. Do not invent `Drink` or `Dessert` models unless product needs separate inventory rules.

Premium protein support:

- `BuilderProtein.isPremium = true`
- `BuilderProtein.extraFeeHalala`
- Store selected premium metadata on order item snapshot.
- One-time orders do not consume subscription premium balances.

# Payment and Moyasar

Create `src/services/orders/orderPaymentService.js`.

Expected functions:

- `createOrderInvoice({ order, payment, successUrl, backUrl })`
- `verifyOrderPayment({ orderId, paymentId, userId })`
- `applyPaidOrderPayment({ payment, providerInvoice, session, source })`
- `markOrderPaymentNonPaid({ payment, status, session })`

Reuse:

- `src/services/moyasarService.js`
- `src/models/Payment.js`
- `src/services/mongoTransactionRetryService.js`
- `src/utils/security.js` for redirect validation

Invoice creation:

- `amount = order.pricing.totalHalala`
- `currency = "SAR"`
- `callbackUrl = ${APP_URL}/api/webhooks/moyasar`
- `successUrl` and `backUrl` should use existing `validateRedirectUrl()` behavior
- metadata:

```json
{
  "source": "one_time_order",
  "type": "one_time_order",
  "orderId": "...",
  "userId": "...",
  "paymentUrl": "",
  "expiresAt": "..."
}
```

Webhook behavior:

- Keep existing subscription webhook branches unchanged.
- For `Payment.type === "one_time_order"`:
  - validate amount/currency/provider IDs using existing conventions
  - if already `paid` and `applied=true`, return idempotent success
  - if provider status is non-paid terminal, update `Payment.status` and set order to `expired` or `cancelled` only if order is still `pending_payment`
  - if provider status is paid, atomically claim payment with `{ applied: false }`, set `Payment.status="paid"`, set order `status="confirmed"`, `paymentStatus="paid"`, `confirmedAt`

Atomic update rules:

- Payment claim and order update happen in one transaction.
- Never confirm an order from a stale payment attempt if `order.paymentId` points to a different paid payment.
- Verify endpoint and webhook must be idempotent.

# Expiry and Cancellation

Final decision:

- Pending payment orders expire after 30 minutes.
- They are not deleted.
- `expiresAt` is used for expiry logic, not TTL deletion.
- Expired orders stay in history.
- No hard delete.

Expiry rules:

- On `GET /api/orders/:orderId`, if `status = pending_payment` and `expiresAt < now`, atomically set:
  - `Order.status = "expired"`
  - `Order.paymentStatus = "expired"`
  - current initiated `Payment.status = "expired"`
- Optional scheduled job may expire pending orders later, but do not add it in the first implementation unless requested.
- `DELETE /api/orders/:orderId` only works when `status = pending_payment` and payment is not paid.
- Dashboard `cancel` follows action policy and can cancel confirmed/in-progress orders.

Error codes:

- `409 PAYMENT_EXPIRED` when verify is attempted after expiry and provider is not paid.
- `409 INVALID_TRANSITION` when mobile tries to delete a confirmed/in-progress/final order.
- `409 PAYMENT_ALREADY_PAID` when cancellation races with payment success.

# Dashboard and Ops Execution Plan

## Kitchen Board

Endpoint: `GET /api/dashboard/kitchen/queue`

Include one-time orders where:

- `status in ["confirmed", "in_preparation"]`
- `paymentStatus = "paid"`
- `fulfillmentMethod in ["pickup", "delivery"]`

Fields:

- `source`
- `entityType`
- `entityId`
- `reference`
- `customer`
- `items`
- `status`
- `fulfillmentMethod`
- `timeWindow`
- `allowedActions`

Allowed actions:

- `confirmed`: `prepare`
- `in_preparation` delivery: `dispatch`, `cancel`
- `in_preparation` pickup: `ready_for_pickup`, `cancel`

## Courier Board

Endpoint: `GET /api/dashboard/courier/queue`

Include one-time orders where:

- `fulfillmentMethod = "delivery"`
- `paymentStatus = "paid"`
- `status in ["in_preparation", "out_for_delivery"]`

Allowed actions:

- `in_preparation`: `dispatch` if courier role is allowed by product; otherwise kitchen/admin only
- `out_for_delivery`: `notify_arrival`, `fulfill`, `cancel`

## Branch Pickup Board

Endpoint: `GET /api/dashboard/pickup/queue`

Include one-time orders where:

- `fulfillmentMethod = "pickup"`
- `paymentStatus = "paid"`
- `status in ["in_preparation", "ready_for_pickup"]`

Allowed actions:

- `in_preparation`: `ready_for_pickup`, `cancel`
- `ready_for_pickup`: `fulfill`, `cancel`

## Delivery Schedule

Endpoint: `GET /api/dashboard/delivery-schedule`

Include:

- subscription delivery days
- delivery one-time orders where `paymentStatus = "paid"` and status is operational or fulfilled/cancelled when filter asks for it

Group by:

- `deliveryWindow`
- `delivery.zoneId`

Summary counts:

- pending preparation
- in preparation
- out for delivery
- fulfilled
- cancelled

## Ops Board

Endpoints:

- `GET /api/dashboard/ops/list`
- `GET /api/dashboard/ops/search`
- `POST /api/dashboard/ops/actions/:action`

Implementation:

- Update `src/services/dashboard/opsReadService.js` order query to use final statuses and `fulfillmentDate`.
- Update `src/services/dashboard/dashboardDtoService.js` to add `source`.
- Update `src/services/dashboard/opsSearchService.js` to search `orderNumber`, `_id`, user phone/name, and source.
- Update `src/services/dashboard/opsActionPolicy.js` with final order transition rules.
- Update `src/services/dashboard/opsTransitionService.js` order branch to use `in_preparation`, `cancelled`, and order-only logic.

# Files to Create / Change

## Create

| File | Purpose | Expected functions/classes |
|---|---|---|
| `src/services/orders/orderMenuService.js` | One-time menu from builder catalog and addons | `getOneTimeOrderMenu()` |
| `src/services/orders/orderPricingService.js` | Cart validation, price snapshots, VAT, delivery fee, promo | `priceOrderCart()`, `buildOrderPricingSnapshot()`, `resolveOrderDeliveryFee()` |
| `src/services/orders/orderPaymentService.js` | Moyasar invoice/verify/apply for orders | `createOrderInvoice()`, `verifyOrderPayment()`, `applyPaidOrderPayment()` |
| `src/services/orders/orderSerializationService.js` | Mobile/dashboard DTOs | `serializeOrderForClient()`, `serializeOrderForDashboard()`, `serializeOrderForOps()` |
| `src/services/orders/orderExpiryService.js` | Lazy expiry and optional batch expiry | `expireOrderIfNeeded()`, `expirePendingOrders()` |
| `src/services/orders/orderOpsTransitionService.js` | Order-only dashboard transitions if separated from generic ops service | `executeOrderAction()` |
| `src/controllers/dashboard/orderDashboardController.js` | Dashboard order list/detail/actions | `listOrders()`, `getOrder()`, `handleAction()` |
| `src/routes/dashboardOrders.js` | `/api/dashboard/orders` routes | Express router |
| `tests/oneTimeOrders.test.js` | Core API and payment tests | Node script style with `supertest` |
| `tests/oneTimeOrderOps.test.js` | Dashboard/ops order tests | Node script style with `supertest` |

## Update

| File | Purpose |
|---|---|
| `src/models/Order.js` | Align schema and statuses; keep collection continuity. |
| `src/routes/orders.js` | Add final endpoints; keep temporary legacy aliases if needed. |
| `src/controllers/orderController.js` | Slim controller; delegate to order services. |
| `src/routes/index.js` | Mount `dashboardOrders` under `/api/dashboard/orders`. |
| `src/models/PromoCode.js` | Add order applicability if promo codes are enabled for one-time orders. |
| `src/services/promoCodeService.js` | Add order promo validation/usage helpers. |
| `src/controllers/webhookController.js` | Align `one_time_order` branch only. |
| `src/services/paymentFlowService.js` | Add order-aware redirect/verify application or route verify to `orderPaymentService`. |
| `src/utils/orderState.js` | Final status transitions. |
| `src/services/dashboard/opsActionPolicy.js` | Final order statuses/actions. |
| `src/services/dashboard/opsTransitionService.js` | Final order action behavior. |
| `src/services/dashboard/opsReadService.js` | Include final order DTOs with `source`. |
| `src/services/dashboard/opsSearchService.js` | Search orders with final DTO. |
| `src/services/dashboard/dashboardDtoService.js` | Add `source`, final status labels, fields. |
| `src/controllers/dashboard/opsBoardController.js` | Include orders in kitchen/courier/pickup queues. |
| `src/services/kitchenOperations/KitchenOperationsDataService.js` | Update order query/status fields. |
| `src/services/kitchenOperations/KitchenOperationsMapper.js` | Add `source`, final statuses, item mapping. |
| `src/services/kitchenOperations/KitchenOperationsActionResolver.js` | Final actions for orders. |
| `src/services/kitchenOperations/KitchenOperationsStatusResolver.js` | Final status labels. |
| `src/services/orderNotificationService.js` | Add `in_preparation`, `cancelled`, `expired` templates or aliases. |
| `docs/dashboard-api/postman.dashboard_full_collection.json` | Add one-time order folders. |
| `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` | Add Flutter/dashboard contract. |
| `docs/dashboard-api/endpoint-matrix.md` | Add endpoint rows. |

Do not add seed, maintenance, dry-run, or apply endpoints in this implementation.

# Final Implementation Phases

## Phase 0 - Confirm Architecture and Route Naming

Files touched:

- Documentation only, then implementation branch decision.

Endpoints completed:

- None.

Tests to run:

- None.

Acceptance criteria:

- Team confirms final statuses and whether legacy `/api/orders/checkout` remains temporarily.
- Team confirms `POST /api/orders/quote`.

## Phase 1 - Order Model and Schema Tests

Files touched:

- `src/models/Order.js`
- `src/utils/orderState.js`
- `tests/oneTimeOrders.test.js`

Endpoints completed:

- None.

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrders.test.js`

Acceptance criteria:

- Model validates final statuses.
- No TTL index exists.
- Existing subscription tests still pass.

## Phase 2 - Menu, Pricing, and Quote

Status: implemented in this session.

Files touched:

- `src/services/orders/orderMenuService.js`
- `src/services/orders/orderPricingService.js`
- `src/controllers/orderController.js`
- `src/routes/orders.js`
- `tests/oneTimeOrders.test.js`

Endpoints completed:

- `GET /api/orders/menu`
- `POST /api/orders/quote`

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrders.test.js`
- `node tests/vatInclusivePricing.test.js`

Acceptance criteria:

- Backend prices all carts from catalog.
- Delivery fee uses zone/settings.
- VAT is included.
- Quote does not create order/payment.

Implementation notes:

- `GET /api/orders/menu` is public and registered before authenticated order routes.
- `POST /api/orders/quote` uses mobile `authMiddleware`; it recalculates prices and never creates `Order`, `Payment`, or Moyasar invoice records.
- Menu data comes from active `BuilderProtein`, `BuilderCarb`, `Sandwich`, `SaladIngredient`, `Addon kind=item`, active `Zone`, `delivery_windows`, and `restaurantHoursService`.
- Standard meal pricing uses `one_time_standard_meal_price_halala`, falling back to legacy SAR setting `one_time_meal_price`; if neither exists, quote returns `CONFIG_MISSING`.
- Salad pricing uses `one_time_salad_base_price_halala`, falling back to legacy SAR setting `custom_salad_base_price` and ingredient SAR prices converted to halala.
- Delivery pricing uses active `Zone.deliveryFeeHalala` when `delivery.zoneId` is supplied, then `one_time_delivery_fee_halala`, then legacy SAR setting `one_time_delivery_fee`, then default `1500` halala.
- Promo codes are intentionally not enabled for one-time orders in Phase 2. Supplying `promoCode` returns `PROMO_NOT_SUPPORTED_FOR_ORDERS` until promo eligibility is extended safely.
- Restaurant hours are checked through `restaurantHoursService`; delivery and pickup windows are validated only when their settings exist.

## Phase 3 - Mobile Create/List/Detail/Cancel

Status: implemented in this session.

Files touched:

- `src/controllers/orderController.js`
- `src/services/orders/orderSerializationService.js`
- `src/services/orders/orderExpiryService.js`
- `src/routes/orders.js`
- `tests/oneTimeOrders.test.js`

Endpoints completed:

- `POST /api/orders`
- `GET /api/orders/:orderId`
- `GET /api/orders`
- `DELETE /api/orders/:orderId`

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrders.test.js`

Acceptance criteria:

- Owner-only access.
- Pending order expires lazily.
- Delete only works from `pending_payment`.
- No subscription day documents are created.

Implementation notes:

- `POST /api/orders` is the final mobile create endpoint. It recalculates the cart through `priceOrderCart()`, creates `Order.status = pending_payment`, creates `Payment.type = one_time_order`, initializes a Moyasar invoice, and stores the invoice URL on `Order.paymentUrl` plus `Payment.metadata.paymentUrl`.
- If Moyasar invoice creation fails after local records are created, the order is marked `cancelled` with `paymentStatus = failed`, the initiated payment is marked `failed`, and the API returns `PAYMENT_INIT_ERROR` or `CONFIG_MISSING` for missing provider config.
- Optional `Idempotency-Key` / `X-Idempotency-Key` is supported. The same key and request hash returns the existing pending order; a different request hash returns `IDEMPOTENCY_CONFLICT`. Matching pending request hashes without a key are returned as reused pending checkouts when a payment URL exists.
- `GET /api/orders/:orderId` is owner-only and lazily expires unpaid `pending_payment` orders whose `expiresAt` is in the past, also expiring the related initiated payment.
- `GET /api/orders` returns paginated owner-only history with `page`, `limit`, `status`, `paymentStatus`, `from`, and `to` filters.
- `DELETE /api/orders/:orderId` only cancels unpaid `pending_payment` orders, updates the related initiated payment to `canceled`, and never deletes the order.
- Legacy `/api/orders/checkout`, `/api/orders/:id/verify-payment`, and `/api/orders/:id/payment-status` remain mounted for compatibility. The final contract uses `POST /api/orders`.
- Phase 3 does not implement final payment verify, webhook application, dashboard orders, or ops integration.

## Phase 4 - Moyasar Payment Verify and Webhook

Status: implemented.

Files touched:

- `src/services/orders/orderPaymentService.js`
- `src/controllers/orderController.js`
- `src/controllers/webhookController.js`
- `src/routes/orders.js`
- `tests/oneTimeOrders.test.js`

Implementation notes:

- `POST /api/orders/:orderId/payments/:paymentId/verify` is owner-only and checks that the `Payment` is `type = one_time_order`, belongs to the order, and matches the order's current stored payment.
- Verify fetches the Moyasar invoice with `getInvoice()` using the stored provider invoice id first, with request-body provider ids accepted only when they do not conflict with stored ids.
- Paid provider status sets `Payment.status = paid`, `Payment.applied = true`, `Payment.paidAt`, `Order.status = confirmed`, `Order.paymentStatus = paid`, `Order.confirmedAt`, and clears `Order.expiresAt`.
- Pending/initiated provider status returns `isFinal = false` and leaves the order in `pending_payment`.
- Failed/canceled provider status marks an unpaid pending order `cancelled`; expired provider status marks it `expired`. Confirmed/paid orders are not downgraded by later failed webhooks.
- Payment status mapping: `paid -> paid`, `pending/initiated/authorized/verified/on_hold -> initiated`, `failed -> failed`, `expired -> expired`, `cancelled/voided -> canceled`.
- The Moyasar webhook keeps the existing secret-token verification and existing subscription branches. It adds an order branch for `Payment.type = one_time_order` or order metadata (`source/type = one_time_order`, `orderId`) and returns `200` for already-handled order events.
- Verify and webhook use transaction retry plus `Payment.applied` claiming so repeated verify calls or webhook/verify races do not duplicate order payment side effects or activity logs.
- Legacy `/api/orders/:id/verify-payment` and `/api/orders/:id/payment-status` remain mounted for compatibility.
- Phase 4 did not add dashboard orders, ops integration, seed/maintenance endpoints, or any `SubscriptionDay` / `mealSlots` usage.

Endpoints completed:

- `POST /api/orders/:orderId/payments/:paymentId/verify`
- `POST /api/webhooks/moyasar` order branch

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrders.test.js`
- `node tests/moyasar_retry.test.js`
- Existing payment/subscription verification tests.

Acceptance criteria:

- Paid verify confirms order.
- Webhook is idempotent.
- Mismatch checks reject amount/currency/provider mismatch.
- Subscription webhooks remain unchanged.

## Phase 5 - Dashboard Orders

Status: implemented in this branch.

Files touched:

- `src/controllers/dashboard/orderDashboardController.js`
- `src/routes/dashboardOrders.js`
- `src/routes/index.js`
- `src/services/orders/orderDashboardService.js`
- `src/services/orders/orderOpsTransitionService.js`
- `src/services/orders/orderSerializationService.js`
- `tests/oneTimeOrderOps.test.js`

Endpoints completed:

- `GET /api/dashboard/orders`
- `GET /api/dashboard/orders/:orderId`
- `POST /api/dashboard/orders/:orderId/actions/:action`

Implementation notes:

- Dashboard list/detail return one-time order DTOs with `source: "one_time_order"`, `entityType: "order"`, `entityId`, customer, pricing, and role/status-derived `allowedActions`.
- Detail returns sanitized `items`, `payment`, `delivery`, `pickup`, and recent `ActivityLog` rows. It does not expose `requestHash`, provider metadata, or raw webhook payloads.
- Implemented dashboard order actions: `prepare`, `ready_for_pickup`, `dispatch`, `notify_arrival`, `fulfill`, and `cancel`.
- `reopen` intentionally returns `REOPEN_NOT_SUPPORTED` for launch; no `cancelled -> confirmed` transition is enabled.
- Action roles are enforced in the order transition service. `superadmin`/`admin` can list/detail/action all orders through middleware; kitchen/courier receive only actions valid for their role and the order fulfillment method.
- `pending_payment`, unpaid, `expired`, `cancelled`, and `fulfilled` orders do not expose operational actions.
- Successful actions write `ActivityLog` entries named `dashboard_order_prepare`, `dashboard_order_ready_for_pickup`, `dashboard_order_dispatch`, `dashboard_order_notify_arrival`, `dashboard_order_fulfill`, and `dashboard_order_cancel`.
- Phase 5 does not integrate one-time orders into kitchen/courier/pickup boards or delivery schedule; that remains Phase 6.

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrderOps.test.js`
- `NODE_ENV=test node tests/oneTimeOrders.test.js`
- `npm test`
- `NODE_ENV=test node tests/dashboardAdminEndpoints.test.js`

Acceptance criteria:

- Dashboard list/detail work.
- Action policy is enforced.
- ActivityLog is written for each action.

## Phase 6 - Ops Board Integration (Completed)

Files touched:

- `src/services/dashboard/opsReadService.js`
- `src/services/dashboard/opsSearchService.js`
- `src/services/dashboard/opsActionPolicy.js`
- `src/services/dashboard/opsTransitionService.js`
- `src/services/dashboard/dashboardDtoService.js`
- `src/controllers/dashboard/opsBoardController.js`
- `src/services/kitchenOperations/*`

Endpoints completed:

- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/delivery-schedule`
- `GET /api/dashboard/ops/list`
- `GET /api/dashboard/ops/search`
- `POST /api/dashboard/ops/actions/:action`

Tests to run:

- `NODE_ENV=test node tests/oneTimeOrderOps.test.js`
- `node tests/kitchen_operations_mapper.test.js`
- `NODE_ENV=test node tests/dashboardAdminEndpoints.test.js`

Acceptance criteria:

- Order rows include `source`, `entityType`, `entityId`.
- Subscription rows are unchanged except additive `source`.
- Board filters include correct one-time orders.

## Phase 7 - Postman and Flutter Guide

Files touched:

- `docs/dashboard-api/postman.dashboard_full_collection.json`
- `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md`
- `docs/dashboard-api/endpoint-matrix.md`
- `docs/dashboard-api/openapi.dashboard.json` if maintained manually

Endpoints completed:

- Documentation only.

Tests to run:

- Import Postman collection manually or JSON-parse it.

Acceptance criteria:

- Postman has one-time folders and variables.
- Flutter guide tells mobile not to use subscription endpoints for one-time orders.

## Phase 8 - Full Tests and Graphify Update

Files touched:

- None unless fixes are needed.

Commands:

- `npm test`
- `NODE_ENV=test node tests/oneTimeOrders.test.js`
- `NODE_ENV=test node tests/oneTimeOrderOps.test.js`
- `NODE_ENV=test node tests/dashboardAdminEndpoints.test.js`
- `node tests/moyasar_retry.test.js`
- `graphify update .`

Acceptance criteria:

- New tests pass.
- Existing subscription/dashboard behavior remains intact.
- Graphify is updated after code changes.

# Final Endpoint Summary

## Mobile

- `GET /api/orders/menu`
- `POST /api/orders/quote`
- `POST /api/orders`
- `GET /api/orders/:orderId`
- `GET /api/orders`
- `DELETE /api/orders/:orderId`
- `POST /api/orders/:orderId/payments/:paymentId/verify`

## Dashboard

- `GET /api/dashboard/orders`
- `GET /api/dashboard/orders/:orderId`
- `POST /api/dashboard/orders/:orderId/actions/:action`

## Ops

- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/delivery-schedule`
- `GET /api/dashboard/ops/list`
- `GET /api/dashboard/ops/search`
- `POST /api/dashboard/ops/actions/:action`

## Webhooks

- `POST /api/webhooks/moyasar`

## Endpoint Table

| Endpoint | Auth | Used by | Status |
|---|---|---|---|
| `GET /api/orders/menu` | Public recommended | Flutter | New/final |
| `POST /api/orders/quote` | Mobile auth | Flutter | New/recommended |
| `POST /api/orders` | Mobile auth | Flutter | Replace `/checkout` as final create |
| `GET /api/orders/:orderId` | Mobile auth owner-only | Flutter | Update existing |
| `GET /api/orders` | Mobile auth owner-only | Flutter | Update existing |
| `DELETE /api/orders/:orderId` | Mobile auth owner-only | Flutter | Update existing semantics |
| `POST /api/orders/:orderId/payments/:paymentId/verify` | Mobile auth owner-only | Flutter | New final verify |
| `GET /api/dashboard/orders` | Dashboard auth | Dashboard | New |
| `GET /api/dashboard/orders/:orderId` | Dashboard auth | Dashboard | New |
| `POST /api/dashboard/orders/:orderId/actions/:action` | Dashboard auth | Dashboard | New |
| `GET /api/dashboard/kitchen/queue` | Dashboard auth | Kitchen board | Update |
| `GET /api/dashboard/courier/queue` | Dashboard auth | Courier board | Update |
| `GET /api/dashboard/pickup/queue` | Dashboard auth | Pickup board | Update |
| `GET /api/dashboard/delivery-schedule` | Dashboard auth | Delivery ops | Update |
| `GET /api/dashboard/ops/list` | Dashboard auth | Unified ops | Update |
| `GET /api/dashboard/ops/search` | Dashboard auth | Unified ops | Update |
| `POST /api/dashboard/ops/actions/:action` | Dashboard auth | Unified ops | Update |
| `POST /api/webhooks/moyasar` | Webhook secret | Moyasar | Update order branch only |

# Risks / Product Decisions

| Decision | Recommended default |
|---|---|
| Do one-time orders support custom standard meals from day one? | Yes for builder `standard_meal` with one protein and configured carbs. Do not reuse subscription `mealSlots`. |
| Are drinks/desserts Addon items or new models? | Use `Addon kind=item`; map drinks to `juice`, dessert/snacks to `snack`. |
| Is pickup branch selection required from mobile? | Optional for phase one. Default to main branch if no branch model exists. |
| Should one-time orders support promo codes from day one? | Yes only after extending promo eligibility to orders. If that is risky, launch without promo and keep request field rejected with clear `PROMO_NOT_APPLICABLE_TO_ORDER_TYPE`. |
| Should there be `POST /api/orders/quote`? | Yes. It fits the subscription checkout pattern and avoids creating abandoned pending orders. |
| Should delivery fee come from zone or flat setting? | Zone first. Fallback setting only when product allows delivery without zone. |
| Can dashboard reopen cancelled one-time orders? | Default no for launch unless operations explicitly needs it. If enabled, admin-only from `cancelled` to `confirmed`. |
| Should confirmed orders auto-expire if not prepared? | No. Only `pending_payment` expires. Confirmed orders require dashboard cancel. |
| Should old `/api/orders/checkout` stay? | Keep temporarily as a backward-compatible alias or deprecate after Flutter migrates. Final contract should use `POST /api/orders`. |

# Flutter Contract Additions

Update `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md` with:

- One-Time Order Menu
- Cart
- Quote
- Checkout
- Payment WebView
- Verify
- Order History
- Order Detail
- One-Time Order status lifecycle
- Dashboard Orders if dashboard frontend uses the same guide

Flutter rules:

- Do not use subscription endpoints for one-time orders.
- Do not send `mealSlots`.
- Do not send `SubscriptionDay` IDs.
- Do not calculate final totals manually.
- Use `POST /api/orders/quote` to display final cart totals.
- Use `POST /api/orders` to create the pending payment order.
- Open `paymentUrl` in WebView.
- Call `POST /api/orders/:orderId/payments/:paymentId/verify` after WebView result.
- Use status returned from backend.
- Treat `fulfilled`, `cancelled`, and `expired` as final.

# Postman Plan

Update `docs/dashboard-api/postman.dashboard_full_collection.json`.

Add folders:

- `One-Time Orders - Mobile`
- `One-Time Orders - Payment`
- `One-Time Orders - Dashboard`
- `One-Time Orders - Ops`
- `One-Time Orders - Webhooks`

Expected variables:

- `orderId`
- `orderPaymentId`
- `orderPromoCode`
- `orderItemId`
- `orderProviderInvoiceId`
- `orderProviderPaymentId`

Collection tests should save:

- `orderId` from create response
- `orderPaymentId` from create response
- `paymentUrl` for manual WebView testing

# Tests Plan

## Unit

- order pricing
- menu mapping
- promo discount for orders
- expiry
- status transitions
- order serialization
- delivery fee zone fallback

## API

- create pickup order
- create delivery order
- quote pickup order
- quote delivery order
- order detail owner-only
- order history pagination
- cancel pending
- reject cancel confirmed from mobile
- verify paid
- verify pending
- verify mismatch
- webhook paid idempotent
- webhook failed
- webhook expired

## Dashboard / Ops

- dashboard order list/detail
- kitchen prepare order
- pickup ready/fulfill order
- courier dispatch/fulfill order
- dashboard cancel order
- delivery schedule includes orders
- ops board includes `source` and `entityType`
- ops search finds one-time order by reference/user
- subscription board behavior remains unchanged

# Validation Checklist

- Markdown is readable.
- No TTL deletion is recommended.
- Route paths match current mount style in `src/routes/index.js`.
- No direct subscription dependency is suggested for `/api/orders`.
- Existing subscription/dashboard behavior must not be broken.
- Final endpoint summary is complete.
- Code implementation must run `graphify update .` after code files change.


You are working inside:

/home/hema/Projects/basicdiet145

Main blueprint:

docs/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md

Completed phases:
Phase 1:
- Order model/statuses aligned.

Phase 2:
- GET /api/orders/menu
- POST /api/orders/quote

Phase 3:
- POST /api/orders
- GET /api/orders/:orderId
- GET /api/orders
- DELETE /api/orders/:orderId

Phase 4:
- POST /api/orders/:orderId/payments/:paymentId/verify
- Moyasar webhook order branch

Phase 5:
- GET /api/dashboard/orders
- GET /api/dashboard/orders/:orderId
- POST /api/dashboard/orders/:orderId/actions/:action

Phase 6:
- One-time orders integrated into:
  - kitchen queue
  - courier queue
  - pickup queue
  - delivery schedule
  - ops list/search
  - unified ops actions

Important verification note:
DB-backed ops tests could not complete in the previous environment because MongoDB was unavailable. Do not claim DB tests passed unless they are actually run.

Goal:
Implement Phase 7 only: Postman + Flutter Guide + endpoint documentation.

This is documentation/Postman only.
Do NOT change backend behavior.
Do NOT add endpoints.
Do NOT modify models/controllers/services unless you find a documentation-blocking typo in route names.
Do NOT change subscription logic.
Do NOT add seed, maintenance, dry-run, or apply endpoints.

Files to update:
1. docs/dashboard-api/postman.dashboard_full_collection.json
2. docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md
3. docs/dashboard-api/endpoint-matrix.md if it exists
4. docs/ONE_TIME_ORDER_IMPLEMENTATION_PLAN_REVISED.md only to mark Phase 7 docs status if needed

==================================================
1. Inspect current backend routes first
==================================================

Before editing docs/Postman, inspect exact implemented paths:

Mobile:
- src/routes/orders.js
- src/controllers/orderController.js

Dashboard:
- src/routes/dashboardOrders.js
- src/controllers/dashboard/orderDashboardController.js

Ops:
- src/routes/dashboardBoards.js
- src/routes/dashboardOps.js
- src/controllers/dashboard/opsBoardController.js
- src/controllers/dashboard/opsActionController.js

Webhook:
- src/controllers/webhookController.js
- src/routes/index.js or webhook routes

Confirm exact route paths:
- GET /api/orders/menu
- POST /api/orders/quote
- POST /api/orders
- GET /api/orders/:orderId
- GET /api/orders
- DELETE /api/orders/:orderId
- POST /api/orders/:orderId/payments/:paymentId/verify
- GET /api/dashboard/orders
- GET /api/dashboard/orders/:orderId
- POST /api/dashboard/orders/:orderId/actions/:action
- Existing board/ops routes
- POST /api/webhooks/moyasar

Do not document routes that do not exist.

==================================================
2. Postman collection update
==================================================

Update:

docs/dashboard-api/postman.dashboard_full_collection.json

Add folders:

1. One-Time Orders - Mobile
2. One-Time Orders - Payment
3. One-Time Orders - Dashboard
4. One-Time Orders - Ops
5. One-Time Orders - Webhooks

Keep existing folders unchanged.

Add or ensure collection variables:
- orderId
- orderPaymentId
- orderPromoCode
- orderItemId
- orderProviderInvoiceId
- orderProviderPaymentId
- orderIdempotencyKey
- orderAction

Use existing variables:
- baseUrl
- dashboardToken
- token or mobileToken according to existing Postman style

If mobile auth token variable name exists, reuse it.
Do not invent conflicting token variable names.

==================================================
3. Postman: One-Time Orders - Mobile
==================================================

Include:

GET /api/orders/menu

POST /api/orders/quote

POST /api/orders

GET /api/orders/:orderId

GET /api/orders

DELETE /api/orders/:orderId

For each request:
- Use correct auth.
- Add useful descriptions.
- Add example query params/body.
- Add test scripts to extract:
  - orderId
  - orderPaymentId
  - paymentUrl if useful
- Use robust pickFirstEntity helper style already used in the collection.

Example quote body:
{
  "fulfillmentMethod": "delivery",
  "delivery": {
    "zoneId": "{{zoneId}}",
    "address": {
      "label": "Home",
      "line1": "Street 1",
      "line2": "",
      "district": "North",
      "city": "Riyadh",
      "phone": "+966500000000",
      "notes": ""
    },
    "deliveryWindow": "18:00-20:00"
  },
  "items": [
    {
      "itemType": "sandwich",
      "qty": 1,
      "selections": {
        "sandwichId": "{{sandwichId}}"
      }
    }
  ]
}

Example create body:
Same as quote, plus:
{
  "successUrl": "basicdiet://orders/payment-success",
  "backUrl": "basicdiet://orders/payment-cancel"
}

Add header:
Idempotency-Key: {{orderIdempotencyKey}}

Mention:
- quote does not create Order or Payment
- create recalculates pricing and creates payment invoice
- promoCode currently returns PROMO_NOT_SUPPORTED_FOR_ORDERS

==================================================
4. Postman: One-Time Orders - Payment
==================================================

Include:

POST /api/orders/:orderId/payments/:paymentId/verify

Description:
- Called after Moyasar WebView result.
- Safe to call repeatedly.
- Returns isFinal=false if payment still pending.
- Confirms order when provider invoice is paid.

Example body:
{
  "providerPaymentId": "{{orderProviderPaymentId}}",
  "providerInvoiceId": "{{orderProviderInvoiceId}}"
}

==================================================
5. Postman: One-Time Orders - Dashboard
==================================================

Include:

GET /api/dashboard/orders
GET /api/dashboard/orders/:orderId
POST /api/dashboard/orders/:orderId/actions/:action

Use dashboardToken.

Query examples:
- status
- paymentStatus
- fulfillmentMethod
- page
- limit
- q
- from/to
- zoneId

Action bodies:
prepare:
{
  "reason": "Start preparing one-time order",
  "notes": "From dashboard"
}

ready_for_pickup:
{
  "reason": "Ready for pickup",
  "notes": "Pickup code generated by backend if supported"
}

dispatch:
{
  "reason": "Dispatched with courier",
  "notes": "Courier left branch"
}

notify_arrival:
{
  "reason": "Courier arrived near customer"
}

fulfill:
{
  "reason": "Order fulfilled"
}

cancel:
{
  "reason": "Cancelled by operations",
  "notes": "No refund handled here"
}

reopen:
Document that one-time orders return REOPEN_NOT_SUPPORTED.

Add variable:
orderAction default = prepare

==================================================
6. Postman: One-Time Orders - Ops
==================================================

Add examples showing order-specific ops calls via unified ops endpoint:

POST /api/dashboard/ops/actions/:action

Body:
{
  "entityType": "order",
  "entityId": "{{orderId}}",
  "payload": {
    "reason": "Updated from unified ops",
    "notes": "One-time order ops action"
  }
}

Also add useful filtered board examples if not already present:
- GET /api/dashboard/kitchen/queue?date={{dayDate}}
- GET /api/dashboard/courier/queue?date={{dayDate}}
- GET /api/dashboard/pickup/queue?date={{dayDate}}
- GET /api/dashboard/delivery-schedule?date={{dayDate}}

Descriptions should explain:
- these board responses may now include subscription rows and one-time order rows
- identify rows by source/entityType
- one-time rows use source=one_time_order, entityType=order

Do not duplicate too many existing board requests if they already exist; update descriptions instead if better.

==================================================
7. Postman: One-Time Orders - Webhooks
==================================================

Include:

POST /api/webhooks/moyasar

Important:
- This is mainly for documentation/manual simulation.
- Real webhook requires Moyasar signature/secret header.
- Do not include production secret.
- Use placeholders only.

Example body:
{
  "type": "invoice.paid",
  "data": {
    "id": "{{orderProviderInvoiceId}}",
    "status": "paid",
    "metadata": {
      "source": "one_time_order",
      "type": "one_time_order",
      "orderId": "{{orderId}}"
    }
  }
}

Description:
- webhook has one-time order branch
- subscription webhook behavior unchanged
- unknown events should return 2xx according to existing behavior

==================================================
8. Flutter guide update
==================================================

Update:

docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md

Add a full section:

# One-Time Orders / الطلبات المفردة

Add subsections:

1. الفرق بين One-Time Order والاشتراك
Explain:
- Do not use subscriptions endpoints.
- Do not send mealSlots.
- Do not use SubscriptionDay.
- One-time orders have items[] and orderId.
- No skip/freeze.
- No remainingMeals.

2. Menu Screen
Endpoint:
GET /api/orders/menu
Explain fields:
- standardMeals
- sandwiches
- salad
- addons
- delivery windows/zones
- restaurant hours

3. Cart Screen
Explain:
- local state only
- Flutter may calculate estimated subtotal for display but backend quote is source of truth
- do not trust client prices

4. Quote
Endpoint:
POST /api/orders/quote
Explain:
- use before create
- no Order/Payment created
- shows final pricing
- VAT included
- promo currently not supported unless backend says otherwise

5. Checkout/Create
Endpoint:
POST /api/orders
Explain:
- creates pending_payment order
- creates payment link
- use Idempotency-Key
- opens paymentUrl in WebView

6. Payment WebView and Verify
Endpoint:
POST /api/orders/:orderId/payments/:paymentId/verify
Explain:
- always call after WebView return
- isFinal=false means payment is still pending
- repeated verify is safe
- paid confirms order

7. Order Detail and History
Endpoints:
GET /api/orders/:orderId
GET /api/orders
DELETE /api/orders/:orderId
Explain:
- delete only pending_payment unpaid
- pending orders may expire
- expired orders remain in history

8. Status lifecycle
Document:
pending_payment
confirmed
in_preparation
ready_for_pickup
out_for_delivery
fulfilled
cancelled
expired

Explain final statuses:
fulfilled, cancelled, expired

9. Dashboard Orders
Explain:
- dashboard can list/detail one-time orders
- dashboard actions are operational
- cancel does not imply refund unless backend later adds it

10. Ops Boards
Explain:
- Kitchen/Courier/Pickup/Delivery Schedule may show both subscriptions and one-time orders
- use source/entityType
- source=one_time_order
- entityType=order
- do not assume every row is subscription_day

11. Common mistakes
Include:
- using subscription endpoints
- sending mealSlots
- calculating final total in Flutter
- adding VAT
- ignoring verify
- creating multiple orders without idempotency key
- using delivery actions on pickup orders
- assuming cancel means refund

==================================================
9. Endpoint matrix update
==================================================

If this file exists:

docs/dashboard-api/endpoint-matrix.md

Add one-time order rows for:
- mobile
- dashboard
- ops
- webhook

If the file does not exist, do not create it unless already part of repo docs convention.

==================================================
10. Validate JSON/Markdown
==================================================

Postman:
- Validate JSON parse.
- Preserve Postman schema v2.1.
- No trailing commas.
- No comments in JSON.

Markdown:
- Ensure readable Arabic.
- Do not include secrets.
- Do not include production credentials.

==================================================
11. Final response
==================================================

Summarize:
1. Files changed
2. Postman folders/requests added
3. Variables added
4. Flutter guide sections added
5. Endpoint matrix update status
6. Validation results
7. Confirmation no backend behavior changed