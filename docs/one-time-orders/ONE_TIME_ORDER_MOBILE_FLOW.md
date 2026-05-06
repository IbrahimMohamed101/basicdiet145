# One-Time Order Mobile Flow

## Scope

This is the official mobile reference for One-Time Orders after the dynamic Menu Catalog launch.

One-Time Orders are pickup-only for this launch. The mobile app reads the customer menu from the backend, builds a local cart using catalog IDs, requests a backend quote, creates an order, opens the Moyasar invoice URL, verifies payment, and tracks pickup status.

Out of scope for this flow:

- delivery
- courier dispatch
- courier tracking
- notify arrival
- subscriptions
- `SubscriptionDay`
- `mealSlots`
- `remainingMeals`
- skip/freeze
- delivery address, delivery zone, or delivery window

Pricing rules:

- All prices are Halala.
- `1 SAR = 100 Halala`.
- VAT is included.
- Do not add VAT again.
- The backend is the only source of final pricing.
- Mobile must not calculate the checkout final total.
- Client-sent price fields are not trusted and must not be sent.

## Customer Lifecycle

Normal pickup lifecycle:

```text
pending_payment -> confirmed -> in_preparation -> ready_for_pickup -> fulfilled
```

Final states:

- `fulfilled`
- `cancelled`
- `expired`

Mobile status meanings:

| Status | Meaning | Mobile UI |
| --- | --- | --- |
| `pending_payment` | Order exists but Moyasar payment is not confirmed. | Show payment pending, expiry, retry payment/verify when possible, allow unpaid cancel. |
| `confirmed` | Payment is paid and the order is waiting for kitchen. | Show order confirmed / waiting for kitchen. |
| `in_preparation` | Kitchen started preparation. | Show being prepared. |
| `ready_for_pickup` | Order is ready at the branch. | Show pickup branch/window and pickup code if returned. |
| `fulfilled` | Customer picked up the order. | Show completed in history. |
| `cancelled` | Order was cancelled. | Show final state. |
| `expired` | Payment was not completed within the pending-payment window. | Show final state and keep in history. |

Do not show `out_for_delivery`, `dispatch`, courier tracking, or notify-arrival steps in the One-Time Order mobile UI.

## Step 1 - Load Menu

Endpoint:

```http
GET /api/orders/menu
```

Auth:

Public route in `src/routes/orders.js`.

Current behavior:

- `src/services/orders/orderMenuService.js` returns the dynamic catalog when at least one active published `MenuProduct` exists.
- If no published catalog exists, the endpoint falls back to the legacy one-time menu shape.
- The dynamic catalog response is built by `src/services/orders/menuCatalogService.js`.
- Customer menu is always `fulfillmentMethod = "pickup"`.
- Delivery fields are not part of the customer menu contract.

Dynamic catalog fields:

- top level: `source`, `fulfillmentMethod`, `currency`, `vatIncluded`, `vatPercentage`, `itemTypes`, `categories`
- category: `id`, `key`, localized `name`, `nameI18n`, `description`, `imageUrl`, `sortOrder`, `products`
- product: `id`, `key`, `categoryId`, localized `name`, `nameI18n`, `itemType`, `pricingModel`, `priceHalala`, `baseUnitGrams`, `defaultWeightGrams`, `minWeightGrams`, `maxWeightGrams`, `weightStepGrams`, `optionGroups`
- option group: `id`, `groupId`, `key`, localized `name`, `nameI18n`, `minSelections`, `maxSelections`, `isRequired`, `sortOrder`, `options`
- option: `id`, `optionId`, `groupId`, `key`, localized `name`, `nameI18n`, `extraPriceHalala`, `extraWeightUnitGrams`, `extraWeightPriceHalala`, `sortOrder`

Important localization note:

The current code returns `name` as a localized string for the request language and `nameI18n` as `{ "ar": "...", "en": "..." }`. Mobile should use `name` for display and keep IDs/keys for logic.

Example dynamic response:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "currency": "SAR",
    "vatIncluded": true,
    "vatPercentage": 15,
    "fulfillmentMethod": "pickup",
    "itemTypes": ["basic_salad", "basic_meal", "cold_sandwich", "dessert", "juice", "drink"],
    "categories": [
      {
        "id": "663000000000000000000001",
        "key": "salads",
        "name": "Salads",
        "nameI18n": { "ar": "السلطات", "en": "Salads" },
        "products": [
          {
            "id": "663000000000000000000101",
            "key": "basic_salad",
            "name": "Basic Salad",
            "nameI18n": { "ar": "سلطة بيسك", "en": "Basic Salad" },
            "itemType": "basic_salad",
            "pricingModel": "per_100g",
            "priceHalala": 2900,
            "baseUnitGrams": 100,
            "defaultWeightGrams": 100,
            "minWeightGrams": 100,
            "maxWeightGrams": 0,
            "weightStepGrams": 50,
            "optionGroups": [
              {
                "id": "663000000000000000000201",
                "groupId": "663000000000000000000201",
                "key": "proteins",
                "name": "Proteins",
                "nameI18n": { "ar": "بروتينات", "en": "Proteins" },
                "minSelections": 0,
                "maxSelections": 1,
                "options": [
                  {
                    "id": "663000000000000000000301",
                    "optionId": "663000000000000000000301",
                    "groupId": "663000000000000000000201",
                    "key": "proteins_13",
                    "name": "Steak",
                    "nameI18n": { "ar": "ستيك لحم", "en": "Steak" },
                    "extraPriceHalala": 1600,
                    "extraWeightUnitGrams": 50,
                    "extraWeightPriceHalala": 1000
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Mobile behavior:

- Render categories/products from the backend response.
- Use IDs from the response, not display names.
- Do not depend on item order; use IDs, keys, and `sortOrder`.
- Do not render inactive items if any appear unexpectedly.
- Check each product's `pricingModel`; not every product is fixed price.
- Hide delivery address, delivery zone, delivery window, courier tracking, and notify-arrival UI.

## Step 2 - Build Cart Locally

Mobile may store the cart locally, but the cart must use catalog IDs from `GET /api/orders/menu`.

Fixed-price catalog item:

```json
{
  "productId": "663000000000000000000501",
  "qty": 2
}
```

Per-100g catalog item:

```json
{
  "productId": "663000000000000000000101",
  "qty": 1,
  "weightGrams": 200,
  "selectedOptions": [
    {
      "groupId": "663000000000000000000201",
      "optionId": "663000000000000000000301"
    }
  ]
}
```

Extra-weight option:

```json
{
  "groupId": "663000000000000000000201",
  "optionId": "663000000000000000000301",
  "extraWeightGrams": 50
}
```

Client-side validation should only catch obvious UX errors such as empty cart, missing required local selection, invalid integer quantity, or weight step hints. Backend validation remains authoritative for availability, min/max selections, option relations, and pricing.

## Step 3 - Quote

Endpoint:

```http
POST /api/orders/quote
```

Auth:

Mobile user auth required.

Request:

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": {
    "branchId": "main",
    "pickupWindow": "18:00-20:00"
  },
  "items": [
    {
      "productId": "663000000000000000000101",
      "qty": 1,
      "weightGrams": 200,
      "selectedOptions": [
        {
          "groupId": "663000000000000000000201",
          "optionId": "663000000000000000000301"
        }
      ]
    }
  ]
}
```

Do not send:

- `price`, `unitPrice`, `total`, or any client-calculated final pricing
- `delivery`
- `deliveryAddress`
- `deliveryWindow`
- `mealSlots`
- `subscriptionDayId`
- `subscriptionId`
- `remainingMeals`
- `skip`
- `freeze`

Backend behavior:

- `orderPricingService.priceOrderCart()` detects catalog items by `productId` or `menuProductId`.
- `menuPricingService.priceMenuCart()` enforces pickup-only.
- Products/categories/options must be active and published.
- `pricingModel = "fixed"` uses `priceHalala`.
- `pricingModel = "per_100g"` uses `weightGrams`, `baseUnitGrams`, and `priceHalala`.
- Option selection is validated against `ProductOptionGroup` and `ProductGroupOption`.
- `minSelections`, `maxSelections`, option allow-list, extra price, and extra-weight pricing are enforced by backend.

Response:

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "items": [
      {
        "itemType": "basic_salad",
        "productId": "663000000000000000000101",
        "menuVersionId": "663000000000000000000901",
        "qty": 1,
        "weightGrams": 200,
        "unitPriceHalala": 7400,
        "lineTotalHalala": 7400,
        "productSnapshot": {},
        "selectedOptions": [],
        "pricingSnapshot": {}
      }
    ],
    "pricing": {
      "subtotalHalala": 7400,
      "deliveryFeeHalala": 0,
      "discountHalala": 0,
      "totalHalala": 7400,
      "vatPercentage": 15,
      "vatHalala": 965,
      "vatIncluded": true,
      "currency": "SAR"
    },
    "appliedPromo": null
  }
}
```

Mobile must display `pricing.totalHalala` as the checkout total and `pricing.vatIncluded = true` as VAT included.

## Step 4 - Create Order

Endpoint:

```http
POST /api/orders
```

Headers:

```http
Authorization: Bearer <mobileToken>
Idempotency-Key: <stable-key-per-checkout-attempt>
```

Request:

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": {
    "branchId": "main",
    "pickupWindow": "18:00-20:00"
  },
  "items": [
    {
      "productId": "663000000000000000000101",
      "qty": 1,
      "weightGrams": 200,
      "selectedOptions": [
        {
          "groupId": "663000000000000000000201",
          "optionId": "663000000000000000000301",
          "extraWeightGrams": 50
        }
      ]
    }
  ],
  "successUrl": "basicdiet://orders/payment-success",
  "backUrl": "basicdiet://orders/payment-cancel"
}
```

Create behavior:

- Re-prices the cart on the backend.
- Creates an `Order` with `status = "pending_payment"` and `paymentStatus = "initiated"`.
- Creates a `Payment` with `type = "one_time_order"`.
- Creates a Moyasar invoice and returns `paymentUrl`.
- Stores catalog snapshots on each order item:
  - `productSnapshot`
  - `selectedOptions`
  - `pricingSnapshot`
  - `menuVersionId`

Response:

```json
{
  "status": true,
  "data": {
    "orderId": "663000000000000000001001",
    "paymentId": "663000000000000000001002",
    "paymentUrl": "https://moyasar.com/...",
    "invoiceId": "inv_123",
    "status": "pending_payment",
    "paymentStatus": "initiated",
    "expiresAt": "2026-05-06T18:30:00.000Z",
    "pricing": {},
    "items": []
  }
}
```

Retry rule:

Reuse the same `Idempotency-Key` when retrying the same checkout attempt. Do not create a new order for the same cart/payment retry. Generate a new key only when the customer intentionally starts a new checkout.

## Step 5 - Verify Payment

Endpoint:

```http
POST /api/orders/:orderId/payments/:paymentId/verify
```

Request:

```json
{
  "providerPaymentId": "optional_moyasar_payment_id",
  "providerInvoiceId": "optional_moyasar_invoice_id"
}
```

Paid response:

```json
{
  "status": true,
  "data": {
    "orderId": "663000000000000000001001",
    "paymentId": "663000000000000000001002",
    "orderStatus": "confirmed",
    "paymentStatus": "paid",
    "applied": true,
    "providerInvoiceStatus": "paid",
    "isFinal": true
  }
}
```

Mobile behavior:

- Always call verify after WebView return.
- Do not mark an order confirmed locally without backend verification.
- If `isFinal = false`, show processing/pending and allow retry verify.
- If payment expired, show `expired` as final and keep the order in history.

## Step 6 - Tracking

Endpoint:

```http
GET /api/orders/:orderId
```

Use backend `status` for the tracking UI. Do not invent client-only statuses.

Example response shape:

```json
{
  "status": true,
  "data": {
    "id": "663000000000000000001001",
    "orderNumber": "ORD-ABC12345",
    "source": "one_time_order",
    "status": "ready_for_pickup",
    "paymentStatus": "paid",
    "fulfillmentMethod": "pickup",
    "pickup": {
      "branchId": "main",
      "pickupWindow": "18:00-20:00",
      "pickupCode": "123456"
    },
    "pricing": {
      "currency": "SAR",
      "totalHalala": 7400,
      "vatIncluded": true
    },
    "items": []
  }
}
```

Hide delivery maps, delivery address cards, courier status, dispatch controls, and notify-arrival controls.

## Step 7 - History

Endpoint:

```http
GET /api/orders?page=1&limit=20
```

Mobile behavior:

- Show active and final One-Time Orders.
- Include `fulfilled`, `cancelled`, and `expired`.
- Do not delete or hide expired orders by default.
- Do not mix subscription-day actions into one-time order rows.

## Step 8 - Cancel Unpaid Order

Endpoint:

```http
DELETE /api/orders/:orderId
```

Allowed only for unpaid pending-payment cancellation. Mobile must not trigger refunds from this flow.

## Endpoint Summary

| Purpose | Endpoint |
| --- | --- |
| Load menu | `GET /api/orders/menu` |
| Quote pickup order | `POST /api/orders/quote` |
| Create order and invoice | `POST /api/orders` |
| Verify payment | `POST /api/orders/:orderId/payments/:paymentId/verify` |
| Track order | `GET /api/orders/:orderId` |
| Order history | `GET /api/orders?page=1&limit=20` |
| Cancel unpaid order | `DELETE /api/orders/:orderId` |

## Error Handling

Use backend error codes for logic. Do not parse English messages.

| Error code | Meaning | Mobile behavior |
| --- | --- | --- |
| `DELIVERY_NOT_SUPPORTED` | Delivery was requested for a pickup-only one-time order. | Remove delivery fields and retry as pickup. |
| `INVALID_REQUEST` | Request body, query, date, redirect URL, or params are malformed. | Show validation/configuration failure. |
| `INVALID_SELECTION` | Item or option selection is malformed. | Ask customer to update cart; reload menu if needed. |
| `OPTION_NOT_ALLOWED` | Option group/option is not allowed for the selected product. | Remove invalid option and reload menu. |
| `MAX_SELECTIONS_EXCEEDED` | Selected more than group max. | Show group max and adjust selection. |
| `MIN_SELECTIONS_NOT_MET` | Required group minimum is missing. | Ask customer to complete required selections. |
| `PRODUCT_NOT_AVAILABLE` / `ITEM_UNAVAILABLE` | Product/category/item is inactive, unpublished, or branch-unavailable. | Remove item and reload menu. |
| `ITEM_NOT_FOUND` | Referenced product/item no longer exists. | Remove stale cart item. |
| `INVALID_WEIGHT` | Product/option weight is missing or violates min/max/step. | Ask customer to adjust weight. |
| `EMPTY_ORDER` | No valid items were sent. | Block checkout until cart has items. |
| `UNSUPPORTED_ONE_TIME_ORDER_FIELD` | Subscription or delivery-only fields were sent. | Fix client payload. |
| `PAYMENT_PROVIDER_ERROR` / `PAYMENT_INIT_ERROR` | Moyasar invoice/payment failed. | Show retry; keep idempotency key. |
| `PAYMENT_EXPIRED` | Payment window expired. | Show expired final state; allow new checkout. |
| `ORDER_NOT_PAYABLE` | Order cannot currently be paid. | Refresh order and show current state. |
| `INVALID_TRANSITION` | Requested state change is invalid. | Refresh order; do not force local state. |
| `RATE_LIMIT` | Too many checkout/verify requests. | Back off and retry later. |

Example error:

```json
{
  "status": false,
  "code": "INVALID_SELECTION",
  "message": "Selected item is not available"
}
```

## Common Mistakes

- Do not use option names instead of IDs.
- Do not depend on item order in the menu response.
- Do not display inactive items if they appear accidentally.
- Do not calculate the final total on mobile.
- Do not add VAT again.
- Do not send `delivery`.
- Do not send delivery address, zone, or window.
- Do not send `mealSlots` or `subscriptionDayId`.
- Do not call subscription endpoints.
- Do not use `remainingMeals`, skip, or freeze.
- Do not assume every product is fixed price; check `pricingModel`.
- Do not create a new order when retrying the same checkout; reuse `Idempotency-Key`.
- Do not show courier dispatch, courier tracking, or notify-arrival UI.
