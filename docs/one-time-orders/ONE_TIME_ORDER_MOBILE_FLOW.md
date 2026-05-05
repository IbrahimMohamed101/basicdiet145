# One-Time Order Mobile Flow

## Scope

This guide documents the final mobile customer lifecycle for One-Time Orders.

One-Time Orders are pickup-only for launch. A customer creates a one-time order from the mobile app, pays online, waits while the kitchen prepares the order, picks it up from the selected branch, and the order becomes fulfilled.

User story:

> As a customer, I want to order meals once, pay online, and pick them up from the branch without creating a subscription.

This guide is for Flutter/mobile developers implementing menu browsing, local cart state, quote, checkout, payment verification, tracking, history, and cancellation for pickup-only one-time orders.

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

- As a customer, I can browse the one-time order menu without having a subscription.
- As a customer, I can build a cart locally before checkout.
- As a customer, I can request a backend quote for my pickup order.
- As a customer, I can create a pickup order and receive a payment invoice URL.
- As a customer, I can return from payment and verify the payment result.
- As a customer, I can track the order until it is ready for pickup.
- As a customer, I can see fulfilled, cancelled, and expired orders in history.
- As a customer, I can cancel an unpaid pending payment order.

## Status Lifecycle

Normal pickup-only lifecycle:

```text
pending_payment -> confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Other possible final states:

- `cancelled`
- `expired`

Statuses such as `out_for_delivery`, `dispatch`, and `notify_arrival` may exist in backend code for generic compatibility, but they are not used in the pickup-only one-time order flow.

### Mobile Status Meanings

| Status | Meaning | Mobile UI |
| --- | --- | --- |
| `pending_payment` | Order was created, but payment is not confirmed yet. | Show payment pending, retry verify/payment if allowed, allow unpaid cancellation. |
| `confirmed` | Payment is confirmed and the order is waiting for kitchen handling. | Show "Order confirmed" or "Waiting for kitchen". |
| `in_preparation` | Kitchen has started preparing the order. | Show "Being prepared". |
| `ready_for_pickup` | Order is ready at the selected branch. | Show pickup branch/window and pickup instructions. |
| `fulfilled` | Customer picked up the order successfully. | Show completed order in history. |
| `cancelled` | Order was cancelled. | Show as final; no normal actions. |
| `expired` | Payment was not completed before expiry. | Show as final in history; do not delete locally. |

Final statuses:

- `fulfilled`
- `cancelled`
- `expired`

## Step-by-Step Flow

## Step 1 - Load One-Time Order Menu

Endpoint:

```http
GET /api/orders/menu
```

Auth:

Public or optional auth depending on backend configuration.

Example response:

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "itemTypes": ["standard_meal", "sandwich", "salad", "addon_item"],
    "standardMeals": [],
    "sandwiches": [],
    "salad": {
      "ingredients": [],
      "rules": {}
    },
    "addons": {
      "items": [],
      "byCategory": {}
    },
    "restaurantHours": {}
  }
}
```

UI behavior:

- Build the menu from the backend response.
- Use `currency` from the response.
- Render only item types returned by the backend.
- Do not use subscription menu endpoints.
- Do not use `mealSlots`.
- Hide delivery-specific UI.
- Hide delivery address, delivery zone, delivery window, and courier text.

Error handling:

- If the menu request fails, show a retry state.
- If a menu section is empty, show the other available sections instead of blocking the full screen.
- If the restaurant is closed according to backend data, allow browsing but block checkout if the quote/create endpoint returns `RESTAURANT_CLOSED`.

## Step 2 - Build Cart Locally

The Flutter app may keep cart state locally, but final pricing must come from the backend quote. Local totals can be used only as a non-authoritative preview if product chooses to show them. The checkout total must always use the backend quote/create response.

Cart item example:

```json
{
  "itemType": "standard_meal",
  "qty": 1,
  "selections": {
    "proteinId": "...",
    "carbs": [
      { "carbId": "...", "grams": 150 }
    ]
  }
}
```

Supported item types:

- `standard_meal`
- `sandwich`
- `salad`
- `addon_item`

Example sandwich item:

```json
{
  "itemType": "sandwich",
  "qty": 1,
  "selections": {
    "sandwichId": "...",
    "addons": ["..."]
  }
}
```

Example salad item:

```json
{
  "itemType": "salad",
  "qty": 1,
  "selections": {
    "ingredients": [
      { "ingredientId": "...", "qty": 1 }
    ],
    "dressingId": "..."
  }
}
```

Example addon item:

```json
{
  "itemType": "addon_item",
  "qty": 2,
  "selections": {
    "addonItemId": "..."
  }
}
```

UI behavior:

- Keep selected item IDs exactly as returned by `GET /api/orders/menu`.
- Validate obvious client-side issues such as empty cart or `qty < 1`.
- Let the backend validate meal composition rules, availability, and prices.
- Do not attach subscription day data to cart lines.

## Step 3 - Quote Order

Endpoint:

```http
POST /api/orders/quote
```

Auth:

Mobile user auth required.

Request body for pickup-only:

```json
{
  "fulfillmentMethod": "pickup",
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
        "carbs": [
          { "carbId": "...", "grams": 150 }
        ]
      }
    }
  ]
}
```

Important:

- Do not send a `delivery` object.
- Do not send delivery zone.
- Do not send delivery address.
- Do not send delivery window.
- Do not send subscription fields.
- Do not send `mealSlots`.

Response example:

```json
{
  "status": true,
  "data": {
    "quoteId": null,
    "currency": "SAR",
    "items": [],
    "pricing": {
      "subtotalHalala": 5000,
      "deliveryFeeHalala": 0,
      "discountHalala": 0,
      "totalHalala": 5000,
      "vatPercentage": 15,
      "vatHalala": 652,
      "vatIncluded": true
    },
    "appliedPromo": null,
    "expiresInSeconds": 0
  }
}
```

UI behavior:

- Show the backend final total from `pricing.totalHalala`.
- Display VAT as included when `pricing.vatIncluded = true`.
- Do not add VAT.
- Show delivery fee as `0` or hide the delivery fee row for pickup.
- Use backend-normalized `items` if returned.
- If `appliedPromo` is `null`, show no promo discount.

## Step 4 - Create Order and Payment Invoice

Endpoint:

```http
POST /api/orders
```

Headers:

```http
Authorization: Bearer <mobileToken>
Idempotency-Key: <stable-key-per-checkout-attempt>
```

Request body:

```json
{
  "fulfillmentMethod": "pickup",
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
        "carbs": [
          { "carbId": "...", "grams": 150 }
        ]
      }
    }
  ],
  "successUrl": "basicdiet://orders/payment-success",
  "backUrl": "basicdiet://orders/payment-cancel"
}
```

Response example:

```json
{
  "status": true,
  "data": {
    "orderId": "...",
    "paymentId": "...",
    "paymentUrl": "https://moyasar.com/...",
    "invoiceId": "...",
    "status": "pending_payment",
    "paymentStatus": "initiated",
    "expiresAt": "2026-05-03T12:30:00.000Z",
    "pricing": {},
    "items": []
  }
}
```

UI behavior:

- Store `orderId` and `paymentId`.
- Store `expiresAt` to display payment expiry.
- Open `paymentUrl` in WebView or the approved payment browser flow.
- Reuse the same `Idempotency-Key` for retries of the same checkout attempt.
- Do not create another order when retrying the same checkout.
- Generate a new `Idempotency-Key` only when the customer intentionally starts a new checkout attempt.

## Step 5 - Verify Payment After WebView

Endpoint:

```http
POST /api/orders/:orderId/payments/:paymentId/verify
```

Request body:

```json
{
  "providerPaymentId": "optional_moyasar_payment_id",
  "providerInvoiceId": "optional_moyasar_invoice_id"
}
```

Response when paid:

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

Response when still pending:

```json
{
  "status": true,
  "data": {
    "orderId": "...",
    "paymentId": "...",
    "orderStatus": "pending_payment",
    "paymentStatus": "initiated",
    "applied": false,
    "providerInvoiceStatus": "pending",
    "isFinal": false
  }
}
```

UI behavior:

- Always call verify after WebView return.
- If `isFinal = false`, show that payment is still processing and allow the customer to retry verification.
- If `orderStatus = confirmed`, navigate to the order tracking screen.
- If payment expired, show the expired final state and keep the order visible in history.
- Do not mark the order confirmed locally without backend verification.

## Step 6 - Order Tracking

Endpoint:

```http
GET /api/orders/:orderId
```

Use the returned status to drive the tracking UI:

| Status | Tracking label |
| --- | --- |
| `confirmed` | Waiting for kitchen |
| `in_preparation` | Being prepared |
| `ready_for_pickup` | Ready at branch |
| `fulfilled` | Completed |
| `cancelled` | Cancelled |
| `expired` | Expired |

UI behavior:

- Show the selected pickup branch and pickup window.
- For `ready_for_pickup`, highlight pickup instructions and any pickup code if returned by the backend.
- Do not show courier tracking, delivery maps, address cards, dispatch status, or arrival notification controls.
- Poll or refresh according to product requirements; do not invent client-only statuses.

Example response shape:

```json
{
  "status": true,
  "data": {
    "id": "...",
    "orderNumber": "OT-1001",
    "status": "ready_for_pickup",
    "paymentStatus": "paid",
    "fulfillmentMethod": "pickup",
    "pickup": {
      "branchId": "main",
      "pickupWindow": "18:00-20:00"
    },
    "pricing": {
      "currency": "SAR",
      "totalHalala": 5000,
      "vatIncluded": true
    },
    "items": []
  }
}
```

## Step 7 - Order History

Endpoint:

```http
GET /api/orders?page=1&limit=20
```

UI behavior:

- Show active and final one-time orders.
- Include final statuses: `fulfilled`, `cancelled`, and `expired`.
- Do not delete or hide expired orders by default.
- Clearly tag one-time orders if the app also has subscription history screens.
- Do not mix subscription day actions into one-time order rows.

Example response shape:

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "...",
        "orderNumber": "OT-1001",
        "status": "fulfilled",
        "paymentStatus": "paid",
        "fulfillmentMethod": "pickup",
        "pricing": {},
        "items": [],
        "createdAt": "2026-05-03T12:00:00.000Z"
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

## Step 8 - Cancel Unpaid Order

Endpoint:

```http
DELETE /api/orders/:orderId
```

Allowed only when:

- `status = pending_payment`
- payment is not paid

Response example:

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

UI behavior:

- Allow cancel only for pending payment orders.
- Do not allow cancel after `confirmed`.
- After successful cancellation, update the order detail/history row to `cancelled`.
- Do not call refund behavior from the mobile app for this cancellation flow.

## Endpoint Per Step

| Step | Purpose | Endpoint |
| --- | --- | --- |
| 1 | Load one-time order menu | `GET /api/orders/menu` |
| 3 | Quote pickup order | `POST /api/orders/quote` |
| 4 | Create order and invoice | `POST /api/orders` |
| 5 | Verify payment | `POST /api/orders/:orderId/payments/:paymentId/verify` |
| 6 | Track one order | `GET /api/orders/:orderId` |
| 7 | List order history | `GET /api/orders?page=1&limit=20` |
| 8 | Cancel unpaid order | `DELETE /api/orders/:orderId` |

## Error Handling

Use backend error codes to choose user-facing behavior. Do not parse English messages as logic.

| Error code | Meaning | Mobile behavior |
| --- | --- | --- |
| `INVALID_REQUEST` | Request body, query, or params are malformed. | Show a generic validation message; log details for developers. |
| `INVALID_SELECTION` | Item selection is not valid or no longer available. | Ask customer to update cart; reload menu if needed. |
| `INVALID_REDIRECT_URL` | `successUrl` or `backUrl` is invalid. | Block checkout and report a configuration issue. |
| `RESTAURANT_CLOSED` | Checkout is not available for the selected time/window. | Show closed message and allow selecting another valid time if available. |
| `PAYMENT_PROVIDER_ERROR` | Payment provider could not create or verify invoice/payment. | Show retry option; do not duplicate order without idempotency. |
| `PAYMENT_EXPIRED` | Pending payment exceeded the allowed 30-minute window. | Show expired final state; allow starting a new checkout. |
| `ORDER_NOT_PAYABLE` | Order cannot currently be paid. | Refresh order and show current state. |
| `INVALID_TRANSITION` | Requested state change is not valid. | Refresh order; do not force local state. |
| `RATE_LIMIT` | Too many requests. | Back off and show retry later. |
| `PROMO_NOT_SUPPORTED_FOR_ORDERS` | Promo is not valid for one-time orders. | Remove promo and re-quote. |

Example error response shape:

```json
{
  "status": false,
  "code": "INVALID_SELECTION",
  "message": "Selected item is not available"
}
```

## Final States

Final states are terminal for the normal mobile flow:

- `fulfilled`: customer picked up the order.
- `cancelled`: order was cancelled.
- `expired`: payment was not completed within 30 minutes.

Mobile UI should not show operational actions for final states. Final orders remain visible in history.

## Notes / Common Mistakes

- Do not send delivery fields.
- Do not send a `delivery` object.
- Do not send delivery zone, delivery address, or delivery window.
- Do not call subscription endpoints.
- Do not send `SubscriptionDay` IDs.
- Do not send `mealSlots`.
- Do not consume subscription `remainingMeals`.
- Do not use skip/freeze.
- Do not calculate the final total on the frontend.
- Do not add VAT again; VAT is already included.
- Do not skip payment verification after WebView return.
- Do not recreate orders repeatedly without `Idempotency-Key`.
- Do not show `out_for_delivery`, `dispatch`, or `notify_arrival` as normal one-time order steps.
- Do not build courier UI for One-Time Orders in this launch cycle.
