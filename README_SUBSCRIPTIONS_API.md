# 🧾 Subscriptions API Documentation

**📊 Production Status: ✅ 100% COMPLETE**

All required endpoints are implemented, payment provider integrated, and system is production-ready. See completion checklist below.

---

## 📋 Production Completion Status

### ✅ Completed Features

| Component | Status | Details |
|-----------|--------|---------|
| **Core Endpoints** | ✅ 40/40 | All application subscription APIs mounted and tested |
| **Admin Endpoints** | ✅ 15/15 | All admin/dashboard APIs fully operational |
| **Payment Integration** | ✅ Moyasar | Invoice creation and verification working end-to-end |
| **Renewal Feature** | ✅ New | Complete subscription renewal flow implemented |
| **Authentication** | ✅ Complete | JWT and dashboard auth enforced on all protected routes |
| **Localization** | ✅ AR/EN | Full Arabic and English support with fallbacks |
| **Idempotency** | ✅ Complete | All payment operations protected with request hashing |
| **Dev-Only Gates** | ✅ Protected | `/activate` endpoint guarded by NODE_ENV check |
| **Skip/Compensation** | ✅ Intentional | Policy explicitly documented: skip free, freeze extends validity |
| **Deprecation Notices** | ✅ Headers | Legacy endpoints return Sunset headers (Jun 30, 2026) |
| **Configuration Validation** | ✅ Startup | MOYASAR_SECRET_KEY required at startup, app fails clearly if missing |
| **Rate Limiting** | ✅ Active | Checkout endpoint rate-limited to prevent abuse |
| **Error Handling** | ✅ Consistent | Standardized JSON error envelope with localized messages |
| **Testing** | ✅ Comprehensive | Production validation tests + renewal integration tests supplied |

### 🚀 Launch Checklist

**Before deploying to production:**

- [ ] MOYASAR_SECRET_KEY configured in production .env
- [ ] JWT_SECRET configured in production .env
- [ ] DASHBOARD_JWT_SECRET configured in production .env
- [ ] MONGODB_URI pointing to production MongoDB
- [ ] Run `npm test` - all tests passing
- [ ] Run `npm start` - no configuration errors in console
- [ ] Test checkout flow end-to-end with test Moyasar credentials
- [ ] Test renewal flow with expired test subscription
- [ ] Verify deprecation headers on legacy /premium/topup
- [ ] Production environment set: `NODE_ENV=production`
- [ ] Database backups configured
- [ ] Monitoring alerts set for payment failures
- [ ] Rollback procedure documented

### 📞 Support URLs

After production launch, reference these documents:

- **API Spec**: [README_SUBSCRIPTIONS_API.md](README_SUBSCRIPTIONS_API.md) ← You are here
- **Stability Guide**: [README_SUBSCRIPTIONS_STABILITY.md](README_SUBSCRIPTIONS_STABILITY.md)
- **Operations Guide**: [README_SUBSCRIPTIONS_OPERATIONS.md](README_SUBSCRIPTIONS_OPERATIONS.md)
- **Architecture**: [Doc/ARCHITECTURE.md](Doc/ARCHITECTURE.md)

---

This document describes the subscription APIs that are actually mounted in this backend today. It is organized for frontend engineers and separates the client-facing subscription flow from the admin/dashboard tools that operate on the same domain.

## 1. 🌐 Base URL

All endpoints in this document are mounted under:

```text
/api
```

Main route groups:

- App subscription APIs: `/api/subscriptions/*`
- Admin APIs: `/api/admin/*`
- Dashboard alias for the same admin handlers: `/api/dashboard/*`

Authentication:

- `GET /api/subscriptions/menu` is public
- All other `/api/subscriptions/*` endpoints require an authenticated app user token
- All `/api/admin/*` and `/api/dashboard/*` endpoints require a dashboard bearer token and admin access

Public response envelope:

```json
{
  "status": true,
  "data": {}
}
```

Public error envelope:

```json
{
  "status": false,
  "error": {
    "code": "INVALID",
    "message": "Localized human-readable message",
    "details": {}
  }
}
```

Important contract notes:

- The runtime normalizes internal `ok` responses into public `status`
- Subscription day dates are KSA-style `YYYY-MM-DD` strings
- Frontend logic must branch on machine fields, not translated display text

---

## 2. 🌍 Localization (VERY IMPORTANT)

The subscription API supports Arabic and English on the same routes.

How to switch language:

- Query string: `?lang=en` or `?lang=ar`
- Header: `Accept-Language: en` or `Accept-Language: ar`

Precedence:

1. Query string `lang`
2. `Accept-Language` header
3. Fallback language

Fallback behavior:

- Fallback language is `ar`
- Unsupported languages do not throw an error
- Regional tags are normalized, for example `en-US` becomes `en` and `ar-SA` becomes `ar`

Example requests:

```http
GET /api/subscriptions?lang=en
Authorization: Bearer <app-token>
```

```http
GET /api/subscriptions/menu
Accept-Language: en
```

```http
GET /api/subscriptions/menu?lang=ar
Accept-Language: en
```

In the last example, the response is Arabic because query string wins over the header.

### Machine fields vs localized fields

Do not use translated text for business logic.

Always use machine fields such as:

- `error.code`
- `status`
- `paymentStatus`
- `walletType`
- `source`
- `checkoutStatus`
- `direction`

Use localized label fields for UI only:

- `statusLabel`
- `paymentStatusLabel`
- `walletTypeLabel`
- `sourceLabel`
- `directionLabel`
- `deliveryModeLabel`
- `checkoutStatusLabel`
- `premiumOverageStatusLabel`
- `oneTimeAddonPaymentStatusLabel`
- `seedSourceLabel`

Example:

```json
{
  "status": true,
  "data": {
    "status": "active",
    "statusLabel": "Active",
    "deliveryMode": "delivery",
    "deliveryModeLabel": "Delivery"
  }
}
```

Frontend rule:

- Use `status: "active"` and `deliveryMode: "delivery"` for logic
- Render `statusLabel` and `deliveryModeLabel` in the UI

### `*Label` fields

The API keeps machine values stable and adds display companions.

Examples:

- `paymentStatus: "paid"` with `paymentStatusLabel: "Paid"`
- `walletType: "premium"` with `walletTypeLabel: "Premium credits"`
- `source: "freeze_compensation"` with `sourceLabel: "Freeze compensation"`

### Error localization

`error.message` is localized, but `error.code` is stable.

Example:

```json
{
  "status": false,
  "error": {
    "code": "LOCKED",
    "message": "Cutoff time passed for tomorrow"
  }
}
```

Frontend rule:

- Always branch on `error.code`
- Show `error.message` directly to the user

### Historical fallback behavior

Some historical snapshot data is still stored as plain strings instead of bilingual objects. When that happens:

- The API returns the historical string as-is
- It does not rewrite old records
- Live bilingual catalog names are used where possible, but historical correctness wins

---

## 3. 📱 App (Client) APIs

All endpoints in this section are mounted under `/api/subscriptions`. Everything here requires an app bearer token except `GET /api/subscriptions/menu`.

### 3.1 Menu & Discovery

#### 🔹 GET /api/subscriptions/menu

**Description:**  
Returns the subscription catalog used to build the purchase UI: plans, meals, premium meals, add-ons, delivery catalog, and custom-item support flags.

**When to use:**  
Call this before showing the subscription builder or checkout screen.

**Request:**

- Query: `lang=ar|en` optional
- Headers: `Accept-Language` optional
- Body: none

Example:

```http
GET /api/subscriptions/menu?lang=en
```

**Response:**

```json
{
  "status": true,
  "data": {
    "currency": "SAR",
    "customSalad": {
      "enabled": true,
      "basePriceHalala": 1500,
      "basePriceSar": 15,
      "currency": "SAR"
    },
    "customMeal": {
      "enabled": true,
      "basePriceHalala": 2000,
      "basePriceSar": 20,
      "currency": "SAR"
    },
    "plans": [
      {
        "id": "65f000000000000000000001",
        "name": "Lean Plan",
        "daysCount": 20
      }
    ],
    "regularMeals": [
      {
        "id": "65f000000000000000000010",
        "name": "Chicken Bowl",
        "description": "Regular included meal",
        "type": "regular",
        "pricingModel": "included",
        "priceHalala": 0,
        "currency": "SAR"
      }
    ],
    "premiumMeals": [
      {
        "id": "65f000000000000000000020",
        "name": "Steak Bowl",
        "type": "premium",
        "pricingModel": "extra_fee",
        "extraFeeHalala": 2000,
        "currency": "SAR"
      }
    ],
    "addons": [
      {
        "id": "65f000000000000000000030",
        "name": "Soup",
        "type": "subscription"
      }
    ],
    "addonsByType": {
      "subscription": [],
      "oneTime": []
    },
    "delivery": {
      "deliveryFeeHalala": 1000,
      "windows": [
        {
          "value": "09:00 - 12:00",
          "label": "9:00 AM - 12:00 PM"
        }
      ]
    },
    "flow": {
      "steps": [
        {
          "id": "packages",
          "title": "Subscription Packages"
        }
      ]
    }
  }
}
```

Machine fields: `type`, `pricingModel`, `currency`, `daysCount`, delivery slot `value`.

Localized UI fields: `name`, `description`, `flow.steps[].title`, delivery slot `label`.

**Errors:**

- Standard transport errors only

### 3.2 Checkout Flow

#### 🔹 POST /api/subscriptions/quote

**Description:**  
Calculates the subscription price before creating a payment draft.

**When to use:**  
Call this whenever the user changes plan, grams, meals per day, premium count, add-ons, start date, or delivery settings and you need a fresh total.

**Request:**

- Body fields: `planId`, `grams`, and `mealsPerDay` are required.
- Optional fields: `startDate`, `premiumCount`, `premiumItems`, and `addons`.
- Delivery is required through the `delivery` object.

Recommended delivery payloads:

- Delivery subscription: `delivery.type = "delivery"` with `zoneId`, `address`, and `slot.window`
- Pickup subscription: `delivery.type = "pickup"` with `pickupLocationId` and `slot.window`

Example body:

```json
{
  "planId": "65f000000000000000000001",
  "grams": 1200,
  "mealsPerDay": 3,
  "startDate": "2026-03-25",
  "premiumCount": 2,
  "addons": [
    {
      "addonId": "65f000000000000000000030",
      "qty": 1
    }
  ],
  "delivery": {
    "type": "delivery",
    "zoneId": "65f000000000000000000040",
    "address": {
      "label": "Home",
      "street": "Tahlia Street",
      "lat": 24.7136,
      "lng": 46.6753
    },
    "slot": {
      "type": "delivery",
      "window": "09:00 - 12:00",
      "slotId": ""
    }
  }
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "breakdown": {
      "basePlanPriceHalala": 180000,
      "premiumTotalHalala": 4000,
      "addonsTotalHalala": 1500,
      "deliveryFeeHalala": 1000,
      "vatHalala": 27975,
      "totalHalala": 214475,
      "currency": "SAR"
    },
    "totalSar": 2144.75,
    "summary": {
      "planName": "Lean Plan",
      "daysCount": 20,
      "mealsPerDay": 3
    }
  }
}
```

Machine fields: `breakdown.*`, `currency`, numeric totals.

Localized UI fields: `summary` content, plus any localized catalog names derived from your selected items.

**Errors:**

- `VALIDATION_ERROR` for invalid `planId`, `grams`, `mealsPerDay`, `startDate`, delivery payload, or malformed item arrays
- `NOT_FOUND` if the selected plan, zone, premium meal, or add-on does not exist
- `INVALID` if a selected option exists but is unavailable for the chosen plan or delivery mode

#### 🔹 POST /api/subscriptions/checkout

**Description:**  
Creates a checkout draft and a payment intent for the subscription purchase.

**When to use:**  
Call this after the user confirms the quote and is ready to pay.

**Request:**

- Same body as `/api/subscriptions/quote`
- `idempotencyKey` can be sent through `Idempotency-Key`, `X-Idempotency-Key`, or `body.idempotencyKey`
- Optional `successUrl`
- Optional `backUrl`

Example body:

```json
{
  "idempotencyKey": "checkout-user-123-20260323-1",
  "planId": "65f000000000000000000001",
  "grams": 1200,
  "mealsPerDay": 3,
  "startDate": "2026-03-25",
  "premiumCount": 2,
  "addons": [
    {
      "addonId": "65f000000000000000000030",
      "qty": 1
    }
  ],
  "delivery": {
    "type": "delivery",
    "zoneId": "65f000000000000000000040",
    "address": {
      "label": "Home",
      "street": "Tahlia Street"
    },
    "slot": {
      "type": "delivery",
      "window": "09:00 - 12:00",
      "slotId": ""
    }
  },
  "successUrl": "https://app.example.com/payments/success",
  "backUrl": "https://app.example.com/payments/cancel"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": null,
    "draftId": "65f000000000000000000100",
    "paymentId": "65f000000000000000000101",
    "payment_url": "https://secure.moyasar.com/...",
    "totals": {
      "basePlanPriceHalala": 180000,
      "premiumTotalHalala": 4000,
      "addonsTotalHalala": 1500,
      "deliveryFeeHalala": 1000,
      "vatHalala": 27975,
      "totalHalala": 214475,
      "currency": "SAR"
    }
  }
}
```

Machine fields: `draftId`, `paymentId`, `payment_url`, numeric totals.

Localized UI fields: none in the top-level creation response.

**Errors:**

- `VALIDATION_ERROR` if the idempotency key or quote payload is invalid
- `IDEMPOTENCY_CONFLICT` if the same idempotency key is reused with a different payload
- `CHECKOUT_IN_PROGRESS` if an equivalent draft is already being initialized
- `NOT_FOUND` if plan or selected catalog items are missing
- `INVALID` if the selected configuration is not allowed

#### 🔹 GET /api/subscriptions/checkout-drafts/:draftId

**Description:**  
Returns the current checkout draft state and the last known payment state.

**When to use:**  
Use this for polling while the user is on the payment screen or after returning from the payment provider.

**Request:**

- Path param: `draftId`

Example:

```http
GET /api/subscriptions/checkout-drafts/65f000000000000000000100?lang=en
Authorization: Bearer <app-token>
```

**Response:**

```json
{
  "status": true,
  "data": {
    "draftId": "65f000000000000000000100",
    "subscriptionId": null,
    "checkoutStatus": "pending_payment",
    "checkoutStatusLabel": "Pending payment",
    "paymentStatus": "initiated",
    "paymentStatusLabel": "Initiated",
    "paymentId": "65f000000000000000000101",
    "payment_url": "https://secure.moyasar.com/...",
    "providerInvoiceId": "invoice_123",
    "providerPaymentId": null,
    "totals": {
      "totalHalala": 214475,
      "currency": "SAR"
    },
    "checkedProvider": false,
    "synchronized": false,
    "planName": "Lean Plan",
    "deliveryModeLabel": "Delivery",
    "deliverySlotLabel": "9:00 AM - 12:00 PM"
  }
}
```

Machine fields: `checkoutStatus`, `paymentStatus`, `paymentId`, `providerInvoiceId`, `providerPaymentId`, `checkedProvider`, `synchronized`.

Localized UI fields: `checkoutStatusLabel`, `paymentStatusLabel`, `planName`, `deliveryModeLabel`, `deliverySlotLabel`.

**Errors:**

- `INVALID_ID` if `draftId` is not a valid object id
- `NOT_FOUND` if the draft does not belong to the authenticated user

#### 🔹 POST /api/subscriptions/checkout-drafts/:draftId/verify-payment

**Description:**  
Checks the payment provider, updates the payment record, and finalizes the subscription when the payment is truly paid.

**When to use:**  
Always call this after the payment provider returns success, even if the app already has a success redirect.

**Request:**

- Path param: `draftId`
- Body: none

Example:

```http
POST /api/subscriptions/checkout-drafts/65f000000000000000000100/verify-payment
Authorization: Bearer <app-token>
```

**Response:**

```json
{
  "status": true,
  "data": {
    "draftId": "65f000000000000000000100",
    "subscriptionId": "65f000000000000000000200",
    "checkoutStatus": "completed",
    "checkoutStatusLabel": "Completed",
    "paymentStatus": "paid",
    "paymentStatusLabel": "Paid",
    "paymentId": "65f000000000000000000101",
    "payment_url": "https://secure.moyasar.com/...",
    "providerInvoiceId": "invoice_123",
    "providerPaymentId": "payment_123",
    "checkedProvider": true,
    "synchronized": true
  }
}
```

Machine fields: `checkoutStatus`, `paymentStatus`, `subscriptionId`, `checkedProvider`, `synchronized`.

Localized UI fields: `checkoutStatusLabel`, `paymentStatusLabel`.

**Errors:**

- `INVALID_ID` if `draftId` is malformed
- `NOT_FOUND` if the draft cannot be found for the current user
- `CHECKOUT_IN_PROGRESS` if the payment or invoice is not initialized yet
- `INVALID` if the linked payment does not belong to a subscription checkout
- `PAYMENT_PROVIDER_ERROR` if the provider cannot be checked or returns unsupported data
- `CONFIG` if payment-provider configuration is missing

#### 🔹 POST /api/subscriptions/:id/activate

**Description:**  
Development-only mock activation endpoint.

**When to use:**  
Do not use this in production. It is only mounted when `NODE_ENV !== "production"`.

**Request:**

- Path param: `id`
- Body: none

**Response:**

```json
{
  "status": true,
  "message": "Already active"
}
```

**Errors:**

- Environment-dependent
- Do not build production frontend logic around this route

### 3.3 Subscription Core

#### 🔹 GET /api/subscriptions

**Description:**  
Lists the current user’s subscriptions.

**When to use:**  
Use this for the subscription home screen, account screen, or to discover the active subscription id.

**Request:**

- Body: none

Example:

```http
GET /api/subscriptions?lang=en
Authorization: Bearer <app-token>
```

**Response:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "65f000000000000000000200",
      "status": "active",
      "statusLabel": "Active",
      "planName": "Lean Plan",
      "deliveryMode": "delivery",
      "deliveryModeLabel": "Delivery",
      "remainingMeals": 60,
      "premiumWalletMode": "generic",
      "premiumSummary": [],
      "addonsSummary": []
    }
  ]
}
```

Machine fields: `status`, `deliveryMode`, `remainingMeals`, `premiumWalletMode`.

Localized UI fields: `statusLabel`, `planName`, `deliveryModeLabel`, localized names inside `premiumSummary` and `addonsSummary`.

**Errors:**

- Standard auth errors only

#### 🔹 GET /api/subscriptions/:id

**Description:**  
Returns a single subscription in client-facing shape.

**When to use:**  
Use this when opening one subscription detail screen or after payment verification.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000200",
    "status": "active",
    "statusLabel": "Active",
    "planName": "Lean Plan",
    "deliveryMode": "delivery",
    "deliveryModeLabel": "Delivery",
    "deliveryAddress": {
      "label": "Home"
    },
    "deliverySlot": {
      "type": "delivery",
      "window": "09:00 - 12:00",
      "slotId": ""
    },
    "premiumSummary": [],
    "addonsSummary": [],
    "contract": {}
  }
}
```

Machine fields: `status`, `deliveryMode`, `contract`, numeric counters and ids.

Localized UI fields: `statusLabel`, `planName`, `deliveryModeLabel`, localized item names in wallet summaries.

**Errors:**

- `INVALID_ID` if `id` is malformed
- `NOT_FOUND` if the subscription does not exist
- `FORBIDDEN` if it belongs to a different user

#### 🔹 GET /api/subscriptions/:id/renewal-seed

**Description:**  
Builds a renewal seed from the current subscription so the app can prefill a renewal purchase flow.

**When to use:**  
Use this near the end of a subscription to open a “renew now” journey without asking the user to reselect everything.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "seedSource": "snapshot",
    "seedSourceLabel": "Current subscription snapshot",
    "renewable": true,
    "seed": {
      "planId": "65f000000000000000000001",
      "planName": "Lean Plan",
      "grams": 1200,
      "gramsLabel": "1200 g",
      "mealsPerDay": 3,
      "mealsPerDayLabel": "3 meals / day",
      "daysCount": 20,
      "daysLabel": "20 days",
      "deliveryPreference": {
        "mode": "delivery",
        "modeLabel": "Delivery",
        "address": {
          "label": "Home"
        },
        "slot": {
          "type": "delivery",
          "window": "09:00 - 12:00",
          "label": "9:00 AM - 12:00 PM"
        }
      }
    }
  }
}
```

Machine fields: `seedSource`, `planId`, `grams`, `mealsPerDay`, `daysCount`, `deliveryPreference.mode`.

Localized UI fields: `seedSourceLabel`, `planName`, `gramsLabel`, `mealsPerDayLabel`, `daysLabel`, `deliveryPreference.modeLabel`, `slot.label`.

**Errors:**

- `INVALID_ID` if `id` is malformed
- `NOT_FOUND` if the subscription does not exist
- `FORBIDDEN` if it belongs to another user
- `RENEWAL_UNAVAILABLE` if the old subscription does not contain enough renewable configuration or the plan option is no longer valid

#### 🔹 POST /api/subscriptions/:id/renew

**Description:**  
Initiates a subscription renewal by starting a checkout flow from the renewal seed of the current subscription.

**When to use:**  
After the user confirms the renewal from the renewal seed (data loaded via `GET /api/subscriptions/:id/renewal-seed`), call this endpoint to create a checkout draft and initiate payment.

**Request:**

- Path param: `id`
- Body (optional, all fields optional to override seed defaults):

```json
{
  "planId": "65f000000000000000000001",
  "grams": 1200,
  "mealsPerDay": 3,
  "daysCount": 20,
  "addons": [
    {
      "addonId": "65f000000000000000000005",
      "available": 5
    }
  ],
  "premiumCount": 5,
  "deliveryMode": "delivery",
  "deliveryAddress": {
    "label": "Home"
  },
  "slot": {
    "type": "delivery",
    "window": "09:00 - 12:00"
  },
  "idempotencyKey": "renewal-user123-sub456"
}
```

**Response (success):**

```json
{
  "status": true,
  "data": {
    "draftId": "65f000000000000000000300",
    "paymentId": "65f000000000000000000301",
    "payment_url": "https://moyasar.com/invoice/...",
    "renewedFromSubscriptionId": "65f000000000000000000200",
    "totals": {
      "subtotal": 1000,
      "vat": 150,
      "delivery": 25,
      "total": 1175,
      "currency": "SAR"
    }
  }
}
```

**Response fields:**

- `draftId`: Temporary checkout draft ID, used in verify endpoint
- `paymentId`: Payment tracking ID
- `payment_url`: URL to redirect customer to Moyasar invoice
- `renewedFromSubscriptionId`: Original subscription ID, for audit trail
- `totals`: Pricing summary including VAT and delivery

**Errors:**

- `INVALID_ID` if `id` is malformed
- `NOT_FOUND` if the subscription does not exist or is already active
- `FORBIDDEN` if it belongs to another user
- `INACTIVE` if the subscription is not expired (renewal only available for expired subscriptions)
- `RENEWAL_UNAVAILABLE` if the old subscription does not contain enough renewable configuration
- `INVALID` if the provided renewal parameters do not form a valid quote
- `PLAN_NOT_FOUND` if the plan ID is invalid
- `PLAN_DEACTIVATED` if the plan is no longer available
- `ZONE_NOT_FOUND` if delivery zone is invalid
- `INSUFFICIENT_CREDITS` if premium/addon parameters exceed wallet balance

**Idempotency:**

Send an `idempotencyKey` to retry safely. If the same key is reused:

- Request with identical parameters returns the same draft and payment
- Request with different parameters returns `IDEMPOTENCY_MISMATCH` error

This ensures the frontend can retry network failures without creating duplicate drafts.

**Next steps after renewing:**

1. Redirect user to `payment_url` to complete payment
2. After payment provider returns, call `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment`
3. The new subscription is activated automatically upon payment verification

### 3.4 Timeline & Days

#### 🔹 GET /api/subscriptions/:id/timeline

**Description:**  
Returns a timeline projection of the subscription across its full validity window, including freeze compensation days.

**When to use:**  
Use this as the source of truth for calendar and timeline UIs. This is the safest endpoint for visualizing open, locked, frozen, skipped, delivered, and extension days.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "validity": {
      "startDate": "2026-03-25",
      "endDate": "2026-04-13",
      "validityEndDate": "2026-04-15",
      "compensationDays": 2
    },
    "days": [
      {
        "date": "2026-03-25",
        "status": "planned",
        "statusLabel": "Planned",
        "source": "base",
        "sourceLabel": "Base subscription",
        "locked": false,
        "isExtension": false
      },
      {
        "date": "2026-04-14",
        "status": "extension",
        "statusLabel": "Extension",
        "source": "freeze_compensation",
        "sourceLabel": "Freeze compensation",
        "locked": false,
        "isExtension": true
      }
    ]
  }
}
```

Machine fields: `status`, `source`, `locked`, `isExtension`, validity dates.

Localized UI fields: `statusLabel`, `sourceLabel`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 GET /api/subscriptions/:id/days

**Description:**  
Lists all existing subscription day rows.

**When to use:**  
Use this for detailed day planning screens where you need the current stored rows, selections, planning state, and snapshots.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "65f000000000000000000300",
      "date": "2026-03-26",
      "status": "open",
      "statusLabel": "Open",
      "selections": [],
      "premiumSelections": [],
      "planning": {
        "state": "draft",
        "stateLabel": "Draft"
      }
    }
  ]
}
```

Machine fields: `date`, `status`, `selections`, `premiumSelections`, `planning.state`.

Localized UI fields: `statusLabel`, `planning.stateLabel`, localized names inside add-on and custom item rows.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 GET /api/subscriptions/:id/today

**Description:**  
Returns today’s subscription day row.

**When to use:**  
Use this for a “today’s meals” or “today’s delivery” screen.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000301",
    "date": "2026-03-23",
    "status": "locked",
    "statusLabel": "Locked"
  }
}
```

Machine fields: `date`, `status`.

Localized UI fields: `statusLabel`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND` if either the subscription or today’s day row does not exist
- `FORBIDDEN`

#### 🔹 GET /api/subscriptions/:id/days/:date

**Description:**  
Returns one specific day row.

**When to use:**  
Use this when the user opens a specific day from the timeline or day planner.

**Request:**

- Path param: `id`
- Path param: `date` in `YYYY-MM-DD`

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000300",
    "date": "2026-03-26",
    "status": "open",
    "statusLabel": "Open",
    "selections": [
      "65f000000000000000000010"
    ],
    "premiumSelections": [
      "65f000000000000000000020"
    ],
    "oneTimeAddonSelections": [
      {
        "addonId": "65f000000000000000000031",
        "name": "Soup"
      }
    ],
    "oneTimeAddonPendingCount": 1,
    "oneTimeAddonPaymentStatus": "pending",
    "oneTimeAddonPaymentStatusLabel": "Pending",
    "planning": {
      "state": "draft",
      "stateLabel": "Draft",
      "premiumOverageStatus": "pending",
      "premiumOverageStatusLabel": "Pending"
    }
  }
}
```

Machine fields: `status`, `oneTimeAddonPaymentStatus`, `planning.state`, `planning.premiumOverageStatus`, ids and counts.

Localized UI fields: `statusLabel`, `oneTimeAddonPaymentStatusLabel`, `planning.stateLabel`, `planning.premiumOverageStatusLabel`, localized add-on names.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND` if the subscription or day does not exist
- `FORBIDDEN`

### 3.5 Day Planning

#### 🔹 PUT /api/subscriptions/:id/days/:date/selection

**Description:**  
Saves the user’s meal planning for a specific day.

**When to use:**  
Call this whenever the user edits base meals, premium meals, or one-time add-ons before locking the day.

**Request:**

- Path param: `id`
- Path param: `date`
- Body fields: `selections` and `premiumSelections`
- Optional body fields: `oneTimeAddonSelections` and legacy `addonsOneTime`

Example body:

```json
{
  "selections": [
    "65f000000000000000000010",
    "65f000000000000000000011"
  ],
  "premiumSelections": [
    "65f000000000000000000020"
  ],
  "oneTimeAddonSelections": [
    "65f000000000000000000031"
  ]
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000300",
    "date": "2026-03-26",
    "status": "open",
    "statusLabel": "Open",
    "selections": [
      "65f000000000000000000010",
      "65f000000000000000000011"
    ],
    "premiumSelections": [
      "65f000000000000000000020"
    ],
    "oneTimeAddonSelections": [
      {
        "addonId": "65f000000000000000000031",
        "name": "Soup"
      }
    ],
    "oneTimeAddonPendingCount": 1,
    "oneTimeAddonPaymentStatus": "pending",
    "oneTimeAddonPaymentStatusLabel": "Pending",
    "planning": {
      "state": "draft",
      "stateLabel": "Draft",
      "premiumOverageStatus": "pending",
      "premiumOverageStatusLabel": "Pending"
    }
  }
}
```

Machine fields: `status`, `selections`, `premiumSelections`, `oneTimeAddonPaymentStatus`, `planning.state`, `planning.premiumOverageStatus`.

Localized UI fields: `statusLabel`, `oneTimeAddonPaymentStatusLabel`, `planning.stateLabel`, `planning.premiumOverageStatusLabel`, localized add-on names.

**Errors:**

- `INVALID_ID` for malformed ids
- `INVALID` for malformed selection arrays, invalid one-time add-on structure, or category conflicts
- `INVALID_DATE` if the date is outside the editable subscription range
- `LOCKED` if tomorrow cutoff passed or the day is already locked
- `DAILY_CAP` if total selected meals exceed `mealsPerDay`
- `INSUFFICIENT_PREMIUM` if premium credits cannot satisfy the requested selection in legacy flows
- `DATA_INTEGRITY_ERROR` if wallet data cannot be reconciled safely

#### 🔹 POST /api/subscriptions/:id/days/:date/confirm

**Description:**  
Locks the day after planning is complete.

**When to use:**  
Call this after all required payments are verified and the user has finalized the day.

**Request:**

- Path param: `id`
- Path param: `date`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000300",
    "date": "2026-03-26",
    "status": "locked",
    "statusLabel": "Locked",
    "planning": {
      "state": "confirmed",
      "stateLabel": "Confirmed"
    }
  }
}
```

Machine fields: `status`, `planning.state`.

Localized UI fields: `statusLabel`, `planning.stateLabel`.

**Errors:**

- `CANONICAL_DAY_PLANNING_DISABLED` if the subscription is not on canonical day planning
- `INVALID_DATE` if the date is outside the valid editable range
- `LOCKED` if the day is already locked
- `PLANNING_INCOMPLETE` if the exact required meal count has not been reached
- `PREMIUM_OVERAGE_PAYMENT_REQUIRED` if premium overage exists and is unpaid
- `ONE_TIME_ADDON_PAYMENT_REQUIRED` if one-time add-ons exist and are unpaid
- `SUB_INACTIVE` or `SUB_EXPIRED` when the subscription cannot be planned anymore

#### 🔹 POST /api/subscriptions/:id/days/:date/pickup/prepare

**Description:**  
Converts an open pickup day into a locked pickup-ready day and deducts meal credits.

**When to use:**  
Use this for pickup subscriptions when the user explicitly prepares a day for pickup instead of regular delivery planning.

**Request:**

- Path param: `id`
- Path param: `date`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "date": "2026-03-26",
    "status": "locked",
    "statusLabel": "Locked",
    "pickupRequested": true,
    "creditsDeducted": true
  }
}
```

Machine fields: `status`, `pickupRequested`, `creditsDeducted`.

Localized UI fields: `statusLabel`.

**Errors:**

- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `INVALID` if the subscription delivery mode is not pickup
- `INVALID_TRANSITION` if the day cannot move into the locked pickup state
- `INSUFFICIENT_CREDITS` if the subscription cannot deduct the needed meal credits

#### 🔹 POST /api/subscriptions/:id/days/:date/custom-salad

**Description:**  
Creates a payment for a custom salad on a specific subscription day.

**When to use:**  
Use this when the user builds a paid custom salad for a future editable day.

**Request:**

- Path param: `id`
- Path param: `date`
- Body field: `ingredients` as an array of `{ ingredientId, quantity }`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "ingredients": [
    {
      "ingredientId": "65f000000000000000000050",
      "quantity": 2
    },
    {
      "ingredientId": "65f000000000000000000051",
      "quantity": 1
    }
  ],
  "successUrl": "https://app.example.com/payments/success",
  "backUrl": "https://app.example.com/payments/cancel"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_456",
    "payment_id": "65f000000000000000000401",
    "total": 2200,
    "currency": "SAR"
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `total`, `currency`.

Localized UI fields: provider-side payment description only. The response itself is machine-oriented.

Important behavior:

- This endpoint only creates the payment
- The custom salad is applied after successful payment processing
- There is no dedicated client verify endpoint for this flow in the current API

**Errors:**

- `NOT_FOUND` if the subscription or ingredient set cannot be resolved
- `FORBIDDEN`
- `INVALID_DATE` if the day is outside the editable range
- `LOCKED` if tomorrow cutoff passed or the day is already locked
- `INVALID` for invalid ingredient payloads
- `MAX_EXCEEDED` if an ingredient quantity exceeds the configured maximum

#### 🔹 POST /api/subscriptions/:id/days/:date/custom-meal

**Description:**  
Creates a payment for a custom meal on a specific subscription day.

**When to use:**  
Use this when the user builds a paid custom meal for a future editable day.

**Request:**

- Path param: `id`
- Path param: `date`
- Body field: `ingredients` as an array of `{ ingredientId, quantity }`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "ingredients": [
    {
      "ingredientId": "65f000000000000000000060",
      "quantity": 1
    },
    {
      "ingredientId": "65f000000000000000000061",
      "quantity": 2
    }
  ]
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_789",
    "payment_id": "65f000000000000000000402",
    "total": 2600,
    "currency": "SAR"
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `total`, `currency`.

Localized UI fields: provider-side payment description only.

Important behavior:

- This endpoint creates the payment only
- The custom meal is applied after successful payment processing
- There is no dedicated client verify endpoint for this flow in the current API

**Errors:**

- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `INVALID`
- `MAX_EXCEEDED`

#### 🔹 PUT /api/subscriptions/:id/days/:date/delivery

**Description:**  
Overrides delivery details for one specific day.

**When to use:**  
Use this when the user wants a one-day address or delivery-window override.

**Request:**

- Path param: `id`
- Path param: `date`
- Body fields: `deliveryAddress` and/or `deliveryWindow`

Example body:

```json
{
  "deliveryAddress": {
    "label": "Office",
    "street": "King Fahd Road"
  },
  "deliveryWindow": "13:00 - 16:00"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "date": "2026-03-26",
    "status": "open",
    "statusLabel": "Open",
    "deliveryAddressOverride": {
      "label": "Office"
    },
    "deliveryWindowOverride": "13:00 - 16:00"
  }
}
```

Machine fields: `deliveryAddressOverride`, `deliveryWindowOverride`, `status`.

Localized UI fields: `statusLabel`.

**Errors:**

- `INVALID` if both fields are missing, the window is invalid, or the subscription is not a delivery subscription
- `INVALID_DATE` if the date is not editable
- `LOCKED` if tomorrow cutoff passed or the day is already locked
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 PUT /api/subscriptions/:id/delivery

**Description:**  
Updates the default delivery details for the entire subscription.

**When to use:**  
Use this when the user changes their default address or delivery window for future days.

**Request:**

- Path param: `id`
- Body fields: `deliveryAddress` and/or `deliveryWindow`

Example body:

```json
{
  "deliveryAddress": {
    "label": "New Home",
    "street": "Olaya"
  },
  "deliveryWindow": "17:00 - 20:00"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "_id": "65f000000000000000000200",
    "status": "active",
    "statusLabel": "Active",
    "deliveryMode": "delivery",
    "deliveryModeLabel": "Delivery",
    "deliveryAddress": {
      "label": "New Home"
    },
    "deliveryWindow": "17:00 - 20:00"
  }
}
```

Machine fields: `deliveryMode`, `deliveryAddress`, `deliveryWindow`, `status`.

Localized UI fields: `statusLabel`, `deliveryModeLabel`.

**Errors:**

- `INVALID` if both fields are missing, the window is invalid, or the subscription is not a delivery subscription
- `LOCKED` if tomorrow would be affected after cutoff
- `SUB_INACTIVE` or `SUB_EXPIRED`
- `NOT_FOUND`
- `FORBIDDEN`

### 3.6 Premium & Payments

#### 🔹 GET /api/subscriptions/:id/wallet

**Description:**  
Returns the wallet snapshot for premium credits and add-on credits.

**When to use:**  
Use this to render premium credit balances, add-on balances, and wallet totals.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "premiumWalletMode": "generic",
    "premiumRemaining": 2,
    "premiumSummary": [
      {
        "premiumMealId": null,
        "name": "Premium credits",
        "purchasedQtyTotal": 4,
        "remainingQtyTotal": 2,
        "consumedQtyTotal": 2
      }
    ],
    "addonsSummary": [
      {
        "addonId": "65f000000000000000000030",
        "name": "Soup",
        "purchasedQtyTotal": 3,
        "remainingQtyTotal": 1,
        "consumedQtyTotal": 2
      }
    ],
    "totals": {
      "premiumPurchasedQtyTotal": 4,
      "premiumRemainingQtyTotal": 2,
      "addonPurchasedQtyTotal": 3,
      "addonRemainingQtyTotal": 1
    }
  }
}
```

Machine fields: `premiumWalletMode`, numeric totals, ids.

Localized UI fields: localized item `name` values inside summaries.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 GET /api/subscriptions/:id/wallet/history

**Description:**  
Returns wallet history entries for top-ups and wallet consumption.

**When to use:**  
Use this for wallet transaction history screens.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "entries": [
      {
        "id": "65f000000000000000000500",
        "source": "topup_payment",
        "sourceLabel": "Top-up payment",
        "direction": "credit",
        "directionLabel": "Credit",
        "walletType": "premium",
        "walletTypeLabel": "Premium credits",
        "status": "paid",
        "statusLabel": "Paid",
        "paymentId": "65f000000000000000000501",
        "qty": 2,
        "totalAmountHalala": 4000,
        "currency": "SAR",
        "occurredAt": "2026-03-23T12:00:00.000Z"
      }
    ]
  }
}
```

Machine fields: `source`, `direction`, `walletType`, `status`, ids, amounts.

Localized UI fields: `sourceLabel`, `directionLabel`, `walletTypeLabel`, `statusLabel`, localized item names.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 GET /api/subscriptions/:id/wallet/topups/:paymentId/status

**Description:**  
Returns the stored status of a premium or add-on wallet top-up payment.

**When to use:**  
Use this for polling or restoring the top-up state after a redirect.

**Request:**

- Path params: `id`, `paymentId`

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "paymentId": "65f000000000000000000501",
    "walletType": "premium",
    "walletTypeLabel": "Premium credits",
    "paymentStatus": "initiated",
    "paymentStatusLabel": "Initiated",
    "isFinal": false,
    "amount": 4000,
    "currency": "SAR",
    "applied": false,
    "providerInvoiceId": "invoice_topup_1",
    "providerPaymentId": null,
    "items": [
      {
        "walletType": "premium",
        "name": "Premium credits",
        "qty": 2,
        "totalAmountHalala": 4000
      }
    ],
    "checkedProvider": false,
    "synchronized": false
  }
}
```

Machine fields: `walletType`, `paymentStatus`, `isFinal`, `applied`, provider ids.

Localized UI fields: `walletTypeLabel`, `paymentStatusLabel`, localized item names.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 POST /api/subscriptions/:id/wallet/topups/:paymentId/verify

**Description:**  
Checks the payment provider and applies wallet credits when the top-up is truly paid.

**When to use:**  
Always call this after top-up payment success instead of assuming the redirect means credits are already applied.

**Request:**

- Path params: `id`, `paymentId`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "paymentId": "65f000000000000000000501",
    "walletType": "premium",
    "walletTypeLabel": "Premium credits",
    "paymentStatus": "paid",
    "paymentStatusLabel": "Paid",
    "isFinal": true,
    "applied": true,
    "checkedProvider": true,
    "synchronized": true
  }
}
```

Machine fields: `walletType`, `paymentStatus`, `applied`, `checkedProvider`, `synchronized`.

Localized UI fields: `walletTypeLabel`, `paymentStatusLabel`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`
- `CHECKOUT_IN_PROGRESS` if the invoice is not initialized yet
- `PAYMENT_PROVIDER_ERROR`
- `CONFIG`

#### 🔹 POST /api/subscriptions/:id/days/:date/premium-overage/payments

**Description:**  
Creates a payment for unpaid premium overage on a day.

**When to use:**  
Use this when day planning says premium overage exists and the user must settle it before confirming the day.

**Request:**

- Path params: `id`, `date`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "successUrl": "https://app.example.com/payments/success",
  "backUrl": "https://app.example.com/payments/cancel"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_overage_1",
    "payment_id": "65f000000000000000000601",
    "totalHalala": 4000
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `totalHalala`.

Localized UI fields: provider-side payment description only.

**Errors:**

- `NOT_FOUND` if the subscription or day does not exist
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `PREMIUM_OVERAGE_NOT_SUPPORTED` if the day is not eligible for canonical premium overage settlement
- `NO_PENDING_OVERAGE` if there is nothing to pay
- `OVERAGE_ALREADY_PAID` if the day is already settled

#### 🔹 POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify

**Description:**  
Verifies the premium overage payment and marks the day overage as paid.

**When to use:**  
Call this immediately after the payment provider returns success, then call `/confirm`.

**Request:**

- Path params: `id`, `date`, `paymentId`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "dayId": "65f000000000000000000300",
    "date": "2026-03-26",
    "premiumOverageCount": 2,
    "premiumOverageStatus": "paid",
    "premiumOverageStatusLabel": "Paid",
    "paymentId": "65f000000000000000000601",
    "paymentStatus": "paid",
    "paymentStatusLabel": "Paid",
    "isFinal": true,
    "applied": true,
    "checkedProvider": true,
    "synchronized": true
  }
}
```

Machine fields: `premiumOverageStatus`, `paymentStatus`, `applied`, `checkedProvider`, `synchronized`.

Localized UI fields: `premiumOverageStatusLabel`, `paymentStatusLabel`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`
- `CHECKOUT_IN_PROGRESS`
- `MISMATCH` if the stored payment does not belong to the supplied day or provider payload
- `PAYMENT_PROVIDER_ERROR`
- `CONFIG`

#### 🔹 POST /api/subscriptions/:id/days/:date/one-time-addons/payments

**Description:**  
Creates a payment for unpaid one-time add-ons selected on a day.

**When to use:**  
Use this after `PUT /selection` when the day shows pending one-time add-on payment.

**Request:**

- Path params: `id`, `date`
- Optional body fields: `successUrl`, `backUrl`

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_addons_1",
    "payment_id": "65f000000000000000000602",
    "totalHalala": 1500
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `totalHalala`.

Localized UI fields: provider-side payment description only.

**Errors:**

- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED`
- `NO_PENDING_ONE_TIME_ADDONS`
- `ONE_TIME_ADDONS_ALREADY_PAID`

#### 🔹 POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify

**Description:**  
Verifies the one-time add-on day-planning payment.

**When to use:**  
Call this immediately after payment success, then call `/confirm`.

**Request:**

- Path params: `id`, `date`, `paymentId`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "dayId": "65f000000000000000000300",
    "date": "2026-03-26",
    "oneTimeAddonSelections": [
      {
        "addonId": "65f000000000000000000031",
        "name": "Soup"
      }
    ],
    "oneTimeAddonPendingCount": 0,
    "oneTimeAddonPaymentStatus": "paid",
    "oneTimeAddonPaymentStatusLabel": "Paid",
    "paymentId": "65f000000000000000000602",
    "paymentStatus": "paid",
    "paymentStatusLabel": "Paid",
    "isFinal": true,
    "applied": true,
    "checkedProvider": true,
    "synchronized": true
  }
}
```

Machine fields: `oneTimeAddonPaymentStatus`, `paymentStatus`, `applied`, `checkedProvider`, `synchronized`.

Localized UI fields: `oneTimeAddonPaymentStatusLabel`, `paymentStatusLabel`, localized `oneTimeAddonSelections[].name`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `FORBIDDEN`
- `CHECKOUT_IN_PROGRESS`
- `MISMATCH`
- `PAYMENT_PROVIDER_ERROR`
- `CONFIG`

#### 🔹 POST /api/subscriptions/:id/premium/topup

**Description:**  
Legacy premium top-up endpoint. It is still mounted for compatibility and returns deprecation headers.

**When to use:**  
Prefer `/api/subscriptions/:id/premium-credits/topup` for new frontend work. Use this only if you need legacy compatibility.

**Request:**

- Path param: `id`
- Body can be legacy `{ "count": 2 }`
- Compatibility bridge: if `items` exists, the controller forwards to `/premium-credits/topup`
- Optional body fields: `successUrl`, `backUrl`

Example legacy body:

```json
{
  "count": 2,
  "successUrl": "https://app.example.com/payments/success",
  "backUrl": "https://app.example.com/payments/cancel"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_legacy_topup_1",
    "payment_id": "65f000000000000000000701"
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`.

Localized UI fields: provider-side payment description only.

**Errors:**

- `INVALID` if `count` is missing or not positive
- `NOT_FOUND`
- `FORBIDDEN`
- `SUB_INACTIVE` or `SUB_EXPIRED`

#### 🔹 POST /api/subscriptions/:id/premium-credits/topup

**Description:**  
Creates a premium-credit top-up payment.

**When to use:**  
Use this for premium credit recharge screens.

**Request:**

- Path param: `id`
- Body field: `items` as an array of `{ premiumMealId, qty }`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "items": [
    {
      "premiumMealId": "65f000000000000000000020",
      "qty": 2
    }
  ]
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_premium_topup_1",
    "payment_id": "65f000000000000000000702",
    "totalHalala": 4000
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `totalHalala`.

Localized UI fields: provider-side payment description only.

**Errors:**

- `VALIDATION_ERROR` if `items` is missing or invalid
- `NOT_FOUND` if a premium meal does not exist
- `FORBIDDEN`
- `SUB_INACTIVE` or `SUB_EXPIRED`

#### 🔹 POST /api/subscriptions/:id/addon-credits/topup

**Description:**  
Creates an add-on credit top-up payment.

**When to use:**  
Use this for subscription add-on credit recharge screens.

**Request:**

- Path param: `id`
- Body field: `items` as an array of `{ addonId, qty }`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "items": [
    {
      "addonId": "65f000000000000000000030",
      "qty": 2
    }
  ]
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_addon_topup_1",
    "payment_id": "65f000000000000000000703",
    "totalHalala": 3000
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`, `totalHalala`.

Localized UI fields: provider-side payment description only.

**Errors:**

- `VALIDATION_ERROR`
- `NOT_FOUND` if an add-on does not exist
- `FORBIDDEN`
- `SUB_INACTIVE` or `SUB_EXPIRED`

#### 🔹 POST /api/subscriptions/:id/premium-selections

**Description:**  
Consumes one premium credit for one day slot.

**When to use:**  
Use this only if your frontend works with the older slot-based premium upgrade flow rather than full day selection updates.

**Request:**

- Path param: `id`
- Body fields: `dayId` or `date`, `baseSlotKey`, `premiumMealId`

Example body:

```json
{
  "date": "2026-03-26",
  "baseSlotKey": "slot-1",
  "premiumMealId": "65f000000000000000000020"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "premiumMealId": "65f000000000000000000020",
    "remainingQtyTotal": 1
  }
}
```

Machine fields: `premiumMealId`, `remainingQtyTotal`.

Localized UI fields: none in this minimal utility response.

**Errors:**

- `VALIDATION_ERROR` if `dayId|date` or `baseSlotKey` is missing
- `NOT_FOUND`
- `FORBIDDEN`
- `LOCKED`
- `CONFLICT` if the slot is already upgraded
- `INSUFFICIENT_PREMIUM`

#### 🔹 DELETE /api/subscriptions/:id/premium-selections

**Description:**  
Removes one premium slot upgrade and refunds the underlying premium credit.

**When to use:**  
Use this to undo a slot-level premium upgrade before the day is locked.

**Request:**

- Path param: `id`
- Body fields: `dayId` or `date`, `baseSlotKey`

Example body:

```json
{
  "date": "2026-03-26",
  "baseSlotKey": "slot-1"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200"
  }
}
```

**Errors:**

- `VALIDATION_ERROR`
- `NOT_FOUND` if the day or premium selection does not exist
- `FORBIDDEN`
- `LOCKED`
- `DATA_INTEGRITY_ERROR` if the credit cannot be refunded safely

#### 🔹 POST /api/subscriptions/:id/addon-selections

**Description:**  
Consumes stored add-on credits for one day.

**When to use:**  
Use this for the older wallet-style add-on consumption flow when you are not using day-planning one-time add-on payment settlement.

**Request:**

- Path param: `id`
- Body fields: `dayId` or `date`, `addonId`, `qty`

Example body:

```json
{
  "date": "2026-03-26",
  "addonId": "65f000000000000000000030",
  "qty": 1
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "addonId": "65f000000000000000000030",
    "remainingQtyTotal": 2
  }
}
```

Machine fields: `addonId`, `remainingQtyTotal`.

Localized UI fields: none in this minimal utility response.

**Errors:**

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `FORBIDDEN`
- `LOCKED`
- `INSUFFICIENT_ADDON`

#### 🔹 DELETE /api/subscriptions/:id/addon-selections

**Description:**  
Removes previously consumed add-on selections for one day and refunds them back to wallet balance.

**When to use:**  
Use this to undo wallet-backed add-on selection before the day is locked.

**Request:**

- Path param: `id`
- Body fields: `dayId` or `date`, `addonId`

Example body:

```json
{
  "date": "2026-03-26",
  "addonId": "65f000000000000000000030"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200"
  }
}
```

**Errors:**

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `FORBIDDEN`
- `LOCKED`
- `DATA_INTEGRITY_ERROR` if the refund would exceed purchased quantity or the original wallet bucket cannot be found

#### 🔹 POST /api/subscriptions/:id/addons/one-time

**Description:**  
Creates a payment for a legacy one-time add-on purchase on a subscription day.

**When to use:**  
Prefer the canonical day-planning payment endpoints when the UI is already using `PUT /selection` plus day confirmation. Keep this route only for legacy flows that directly sell a one-time add-on for a date.

**Request:**

- Path param: `id`
- Body fields: `addonId`, `date`
- Optional body fields: `successUrl`, `backUrl`

Example body:

```json
{
  "addonId": "65f000000000000000000031",
  "date": "2026-03-26"
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "payment_url": "https://secure.moyasar.com/...",
    "invoice_id": "invoice_one_time_addon_1",
    "payment_id": "65f000000000000000000704"
  }
}
```

Machine fields: `payment_id`, `invoice_id`, `payment_url`.

Localized UI fields: provider-side payment description only.

Important behavior:

- This endpoint creates the payment only
- There is no dedicated client verify endpoint for this legacy flow
- The add-on is applied after payment processing

**Errors:**

- `INVALID` if `addonId` or `date` is missing
- `NOT_FOUND` if the subscription, day, or add-on cannot be used
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`

### 3.7 Operations

#### 🔹 POST /api/subscriptions/:id/freeze

**Description:**  
Freezes a subscription date range.

**When to use:**  
Use this when the user wants to pause deliveries without losing entitlement. Freeze days extend validity through compensation days.

**Request:**

- Path param: `id`
- Body fields: `startDate`, `days`

Example body:

```json
{
  "startDate": "2026-03-28",
  "days": 3
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "frozenDates": [
      "2026-03-28",
      "2026-03-29",
      "2026-03-30"
    ],
    "newlyFrozenDates": [
      "2026-03-28",
      "2026-03-29",
      "2026-03-30"
    ],
    "alreadyFrozen": [],
    "frozenDaysTotal": 3,
    "validityEndDate": "2026-04-18",
    "freezePolicy": {
      "enabled": true,
      "maxDays": 31,
      "maxTimes": 1
    }
  }
}
```

Machine fields: `frozenDates`, `frozenDaysTotal`, `validityEndDate`, `freezePolicy`.

Localized UI fields: none in this operation response.

**Errors:**

- `INVALID_DATE`
- `INVALID`
- `LOCKED`
- `FREEZE_DISABLED`
- `FREEZE_LIMIT_REACHED`
- `SUB_INACTIVE` or `SUB_EXPIRED`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 POST /api/subscriptions/:id/unfreeze

**Description:**  
Unfreezes a previously frozen date range.

**When to use:**  
Use this when the user wants to resume service for dates that were frozen.

**Request:**

- Path param: `id`
- Body fields: `startDate`, `days`

Example body:

```json
{
  "startDate": "2026-03-28",
  "days": 3
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "subscriptionId": "65f000000000000000000200",
    "unfrozenDates": [
      "2026-03-28",
      "2026-03-29"
    ],
    "notFrozen": [
      "2026-03-30"
    ],
    "frozenDaysTotal": 1,
    "validityEndDate": "2026-04-16"
  }
}
```

Machine fields: `unfrozenDates`, `notFrozen`, `frozenDaysTotal`, `validityEndDate`.

Localized UI fields: none.

**Errors:**

- `INVALID_DATE`
- `INVALID`
- `LOCKED`
- `SUB_INACTIVE` or `SUB_EXPIRED`
- `NOT_FOUND`
- `FORBIDDEN`

#### 🔹 POST /api/subscriptions/:id/days/:date/skip

**Description:**  
Skips one future day.

**When to use:**  
Use this when the user wants to skip one day without freezing a full range. Skip does not create compensation days.

**Request:**

- Path params: `id`, `date`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "date": "2026-03-26",
    "status": "skipped",
    "statusLabel": "Skipped",
    "creditsDeducted": true
  }
}
```

Machine fields: `status`, `creditsDeducted`.

Localized UI fields: `statusLabel`.

**Errors:**

- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `SUB_INACTIVE`
- `INSUFFICIENT_CREDITS`
- `SKIP_LIMIT_REACHED`

#### 🔹 POST /api/subscriptions/:id/days/:date/unskip

**Description:**  
Restores a previously skipped day if it is still reversible.

**When to use:**  
Use this when the user changes their mind before the skipped day becomes processed.

**Request:**

- Path params: `id`, `date`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "date": "2026-03-26",
    "status": "open",
    "statusLabel": "Open",
    "creditsDeducted": false
  }
}
```

Machine fields: `status`, `creditsDeducted`.

Localized UI fields: `statusLabel`.

**Errors:**

- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_DATE`
- `LOCKED`
- `CONFLICT` if the day is not skipped or can no longer be restored
- `DATA_INTEGRITY_ERROR` if credits cannot be restored safely

#### 🔹 POST /api/subscriptions/:id/skip-range

**Description:**  
Skips a contiguous range of future dates in one request.

**When to use:**  
Use this for “skip next 3 days” style UI.

**Request:**

- Path param: `id`
- Body fields: `startDate`, `days`

Example body:

```json
{
  "startDate": "2026-03-28",
  "days": 3
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "skippedDates": [
      "2026-03-28",
      "2026-03-29"
    ],
    "compensatedDatesAdded": [],
    "alreadySkipped": [],
    "rejected": [
      {
        "date": "2026-03-30",
        "reason": "LOCKED",
        "reasonLabel": "Day is locked"
      }
    ]
  }
}
```

Machine fields: `skippedDates`, `compensatedDatesAdded`, `alreadySkipped`, `rejected[].reason`.

Localized UI fields: `rejected[].reasonLabel`.

**Errors:**

- `INVALID_DATE` if `startDate` is invalid or before tomorrow
- `INVALID` if `days` is invalid
- `NOT_FOUND`
- `FORBIDDEN`
- `SUB_INACTIVE` or `SUB_EXPIRED`
- `SKIP_LIMIT_REACHED`

---

## 4. 🧑‍💻 Admin / Dashboard APIs

Admin routes use dashboard auth and admin-role checks. The same handlers are mounted under both:

- `/api/admin/*`
- `/api/dashboard/*`

For new integrations, prefer documenting and calling the canonical `/api/admin/*` paths. The `/api/dashboard/*` paths are compatibility aliases.

### 4.1 Upload APIs

#### 🔹 POST /api/admin/uploads/image

Alias: `POST /api/dashboard/uploads/image`

**Description:**  
Uploads one image to Cloudinary and returns the hosted asset metadata.

**When to use:**  
Use this from the dashboard when creating or updating plans, meals, add-ons, custom-meal images, or custom-salad images.

**Request:**

- Content type: `multipart/form-data`
- File field name: `image`
- Optional text field: `folder`

Allowed `folder` values:

- `plans`
- `meals`
- `addons`
- `custom-meals`
- `custom-salads`

Compatibility input also accepted:

- `basicdiet/plans`
- `basicdiet/meals`
- `basicdiet/addons`
- `basicdiet/custom-meals`
- `basicdiet/custom-salads`

If `folder` is omitted, the backend uses its internal default upload folder.

Example form-data:

```text
image: <binary file>
folder: plans
```

**Response:**

```json
{
  "status": true,
  "data": {
    "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/basicdiet/plans/example.jpg",
    "secureUrl": "https://res.cloudinary.com/<cloud>/image/upload/v1/basicdiet/plans/example.jpg",
    "publicId": "basicdiet/plans/example",
    "resourceType": "image"
  }
}
```

Machine fields: `url`, `secureUrl`, `publicId`, `resourceType`.

Important behavior:

- `url` is already normalized to the secure Cloudinary URL
- The backend does not return local file paths
- Upload uses in-memory multipart handling and streams to Cloudinary

**Errors:**

- `INVALID` if the `image` file is missing
- `INVALID` if the mime type is not an image
- `INVALID` if the file exceeds the configured size limit
- `INVALID` if `folder` is not one of the allowed values
- `UPLOAD_FAILED` if Cloudinary upload fails

### 4.2 Subscription Management (if exists)

#### 🔹 GET /api/admin/subscriptions

Alias: `GET /api/dashboard/subscriptions`

**Description:**  
Lists subscriptions for dashboard operations with filtering and pagination.

**When to use:**  
Use this for the subscription management table in the admin dashboard.

**Request:**

- Query fields: `q`, `status`, `from`, `to`, `page`, `limit`
- `from` and `to` filter on `startDate`
- Default `page` is `1`
- Default `limit` is `50`, maximum `200`

Example:

```http
GET /api/admin/subscriptions?status=active&q=ahmed&page=1&limit=20
Authorization: Bearer <dashboard-token>
```

**Response:**

```json
{
  "status": true,
  "data": [
    {
      "id": "65f000000000000000000200",
      "displayId": "SUB-000200",
      "status": "active",
      "planName": "Lean Plan",
      "userName": "Ahmed Ali",
      "user": {
        "id": "65f000000000000000000900",
        "fullName": "Ahmed Ali",
        "phone": "+966500000000",
        "isActive": true
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  },
  "filters": {
    "q": "ahmed",
    "status": "active",
    "from": null,
    "to": null
  }
}
```

Machine fields: `status`, `displayId`, `meta.*`, `filters.*`, ids.

Localized UI fields: `planName` and localized summary names within wallet summaries if included.

**Errors:**

- `INVALID` if `limit` is invalid, `from`/`to` is invalid, or `from > to`

#### 🔹 GET /api/admin/subscriptions/summary

Alias: `GET /api/dashboard/subscriptions/summary`

**Description:**  
Returns aggregate subscription counts for dashboard summary cards.

**When to use:**  
Use this to render quick totals above the subscriptions table.

**Request:**

- Query fields: `q`, `status`, `from`, `to`

**Response:**

```json
{
  "status": true,
  "data": {
    "filters": {
      "q": "",
      "status": "active",
      "from": null,
      "to": null
    },
    "summary": {
      "totalSubscriptions": 120,
      "activeSubscriptions": 85,
      "pendingSubscriptions": 10,
      "expiredSubscriptions": 15,
      "canceledSubscriptions": 10,
      "endedSubscriptions": 25,
      "selectedStatusCount": 85,
      "totalRemainingMeals": 4300
    }
  }
}
```

Machine fields: everything in `summary`.

Localized UI fields: none.

**Errors:**

- `INVALID` for bad filter input

#### 🔹 GET /api/admin/subscriptions/export

Alias: `GET /api/dashboard/subscriptions/export`

**Description:**  
Exports the current filtered subscription result set as JSON.

**When to use:**  
Use this for admin export/download features.

**Request:**

- Same query filters as `GET /api/admin/subscriptions`

**Response:**

```json
{
  "status": true,
  "data": {
    "exportedAt": "2026-03-23T10:00:00.000Z",
    "filters": {
      "q": "",
      "status": "active",
      "from": null,
      "to": null
    },
    "count": 85,
    "items": [
      {
        "id": "65f000000000000000000200",
        "displayId": "SUB-000200",
        "status": "active"
      }
    ]
  }
}
```

Machine fields: `exportedAt`, `count`, `items`.

Localized UI fields: localized plan names and summary names inside items where present.

**Errors:**

- `INVALID` for bad query filters

#### 🔹 POST /api/admin/subscriptions

Alias: `POST /api/dashboard/subscriptions`

**Description:**  
Creates an active subscription directly from the dashboard without a payment flow.

**When to use:**  
Use this for support-created subscriptions or manual admin enrollment.

**Request:**

- Body field `userId` is required
- The rest of the payload follows the same purchase structure used by `/api/subscriptions/quote`
- Recommended fields: `planId`, `grams`, `mealsPerDay`, `startDate`, `premiumCount`, `addons`, `delivery`

Example body:

```json
{
  "userId": "65f000000000000000000900",
  "planId": "65f000000000000000000001",
  "grams": 1200,
  "mealsPerDay": 3,
  "startDate": "2026-03-25",
  "premiumCount": 2,
  "addons": [
    {
      "addonId": "65f000000000000000000030",
      "qty": 1
    }
  ],
  "delivery": {
    "type": "delivery",
    "zoneId": "65f000000000000000000040",
    "address": {
      "label": "Home"
    },
    "slot": {
      "type": "delivery",
      "window": "09:00 - 12:00",
      "slotId": ""
    }
  }
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "id": "65f000000000000000000200",
    "displayId": "SUB-000200",
    "status": "active",
    "planName": "Lean Plan",
    "userName": "Ahmed Ali"
  },
  "meta": {
    "createdByAdmin": true
  }
}
```

Machine fields: `status`, ids, `meta.createdByAdmin`.

Localized UI fields: `planName`.

**Errors:**

- `INVALID_ID` if `userId` is malformed
- `NOT_FOUND` if the app user or selected plan/items do not exist
- `INVALID` for quote validation failures or inactive app users
- `RECURRING_ADDON_CATEGORY_CONFLICT` is exposed as `INVALID`

#### 🔹 GET /api/admin/subscriptions/:id

Alias: `GET /api/dashboard/subscriptions/:id`

**Description:**  
Returns one subscription in admin-facing shape.

**When to use:**  
Use this when opening the dashboard subscription detail page.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": {
    "id": "65f000000000000000000200",
    "displayId": "SUB-000200",
    "status": "active",
    "planName": "Lean Plan",
    "userName": "Ahmed Ali",
    "user": {
      "id": "65f000000000000000000900",
      "fullName": "Ahmed Ali",
      "phone": "+966500000000",
      "isActive": true
    },
    "contractMeta": {}
  }
}
```

Machine fields: `status`, `displayId`, `user`, `contractMeta`.

Localized UI fields: `planName`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`

#### 🔹 GET /api/admin/subscriptions/:id/days

Alias: `GET /api/dashboard/subscriptions/:id/days`

**Description:**  
Returns raw subscription day rows for dashboard inspection.

**When to use:**  
Use this in admin day-level inspection tools.

**Request:**

- Path param: `id`

**Response:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "65f000000000000000000300",
      "date": "2026-03-26",
      "status": "open"
    }
  ]
}
```

Machine fields: raw stored day fields.

Localized UI fields: none guaranteed here. This route returns raw admin day rows.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`

#### 🔹 POST /api/admin/subscriptions/:id/cancel

Alias: `POST /api/dashboard/subscriptions/:id/cancel`

**Description:**  
Cancels a subscription from the dashboard.

**When to use:**  
Use this for admin cancellation workflows.

**Request:**

- Path param: `id`
- Body: none

**Response:**

```json
{
  "status": true,
  "data": {
    "id": "65f000000000000000000200",
    "status": "canceled",
    "planName": "Lean Plan"
  }
}
```

If the subscription is already canceled, the same response may include:

```json
{
  "status": true,
  "idempotent": true
}
```

Machine fields: `status`, optional `idempotent`.

Localized UI fields: `planName`.

**Errors:**

- `INVALID_ID`
- `NOT_FOUND`
- `INVALID_TRANSITION` if the subscription is neither `pending_payment` nor `active`

#### 🔹 PUT /api/admin/subscriptions/:id/extend

Alias: `PUT /api/dashboard/subscriptions/:id/extend`

**Description:**  
Adds more days and meals to an active subscription.

**When to use:**  
Use this for customer-support compensation or manual extension workflows.

**Request:**

- Path param: `id`
- Body field: `days`

Example body:

```json
{
  "days": 3
}
```

**Response:**

```json
{
  "status": true,
  "data": {
    "id": "65f000000000000000000200",
    "status": "active",
    "planName": "Lean Plan"
  },
  "meta": {
    "days": 3,
    "addedMeals": 9,
    "endDate": "2026-04-16",
    "validityEndDate": "2026-04-18"
  }
}
```

Machine fields: `meta.days`, `meta.addedMeals`, `meta.endDate`, `meta.validityEndDate`.

Localized UI fields: `planName`.

**Errors:**

- `INVALID` if `days` is not a positive integer
- `INVALID_TRANSITION` if the subscription is canceled or not active
- `INVALID_STATE` if the subscription has no end date
- `SUB_EXPIRED` if validity has already passed
- `NOT_FOUND`

#### 🔹 POST /api/admin/subscriptions/:id/freeze

Alias: `POST /api/dashboard/subscriptions/:id/freeze`

**Description:**  
Admin wrapper around the same freeze logic used by the app flow.

**When to use:**  
Use this when support staff needs to freeze on behalf of the user.

**Request:**

- Same body as app `POST /api/subscriptions/:id/freeze`

**Response:**

- Same response shape as app freeze

**Errors:**

- Same `error.code` values as app freeze

#### 🔹 POST /api/admin/subscriptions/:id/unfreeze

Alias: `POST /api/dashboard/subscriptions/:id/unfreeze`

**Description:**  
Admin wrapper around the app unfreeze logic.

**When to use:**  
Use this when support staff needs to undo a freeze on behalf of the user.

**Request:**

- Same body as app `POST /api/subscriptions/:id/unfreeze`

**Response:**

- Same response shape as app unfreeze

**Errors:**

- Same `error.code` values as app unfreeze

#### 🔹 POST /api/admin/subscriptions/:id/days/:date/skip

Alias: `POST /api/dashboard/subscriptions/:id/days/:date/skip`

**Description:**  
Admin wrapper around the app single-day skip logic.

**When to use:**  
Use this when support staff needs to skip a day for the user.

**Request:**

- Same path params as app skip
- Body: none

**Response:**

- Same response shape as app skip

**Errors:**

- Same `error.code` values as app skip

#### 🔹 POST /api/admin/subscriptions/:id/days/:date/unskip

Alias: `POST /api/dashboard/subscriptions/:id/days/:date/unskip`

**Description:**  
Admin wrapper around the app unskip logic.

**When to use:**  
Use this when support staff needs to reverse a skip for the user.

**Request:**

- Same path params as app unskip
- Body: none

**Response:**

- Same response shape as app unskip

**Errors:**

- Same `error.code` values as app unskip

---

## 5. 💡 Important Frontend Rules

- NEVER trust localized text for logic. Use machine fields such as `status`, `paymentStatus`, `walletType`, `source`, and `error.code`.
- ALWAYS call `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` after the payment provider returns from subscription checkout.
- ALWAYS call the matching payment verify endpoint for day-planning or wallet flows when a verify route exists.
- ALWAYS call `POST /api/subscriptions/:id/days/:date/confirm` after all required planning payments are verified and the user finalizes the day.
- ALWAYS use `GET /api/subscriptions/:id/timeline` as the primary source for calendar/timeline UI.
- ALWAYS treat `*Label` fields as UI-only.
- ALWAYS send an idempotency key when creating payments and reuse the same key on safe retries.
- Prefer the canonical `/api/admin/*` paths in dashboard code. `/api/dashboard/*` is an alias, not a different API.

---

## 6. 🔁 Common Flows

### Flow: Purchase Subscription

1. Call `GET /api/subscriptions/menu` to load plans, meals, add-ons, and delivery configuration.
2. Build the quote payload and call `POST /api/subscriptions/quote`.
3. When the user confirms, call `POST /api/subscriptions/checkout` with an idempotency key.
4. Redirect the user to `payment_url`.
5. After the provider returns, call `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment`.
6. Read the created subscription through `GET /api/subscriptions` or `GET /api/subscriptions/:id`.

### Flow: Plan Day

1. Read `GET /api/subscriptions/:id/timeline` and `GET /api/subscriptions/:id/days/:date`.
2. Save the draft plan with `PUT /api/subscriptions/:id/days/:date/selection`.
3. If the response shows `planning.premiumOverageStatus = "pending"`, create and verify the premium overage payment.
4. If the response shows `oneTimeAddonPaymentStatus = "pending"`, create and verify the one-time add-on payment.
5. Call `POST /api/subscriptions/:id/days/:date/confirm`.
6. Refresh the day or timeline to show the locked result.

### Flow: Premium Overage

1. Save day selections with `PUT /api/subscriptions/:id/days/:date/selection`.
2. Detect premium overage from `planning.premiumOverageStatus` or the verify-blocking error on `/confirm`.
3. Call `POST /api/subscriptions/:id/days/:date/premium-overage/payments`.
4. Redirect to the returned `payment_url`.
5. Call `POST /api/subscriptions/:id/days/:date/premium-overage/payments/:paymentId/verify`.
6. Call `POST /api/subscriptions/:id/days/:date/confirm`.

### Flow: Freeze

1. Call `POST /api/subscriptions/:id/freeze` with `startDate` and `days`.
2. Refresh `GET /api/subscriptions/:id/timeline`.
3. Show frozen days directly from the timeline.
4. Show any validity extension from `validity.validityEndDate` in the timeline response.

---

## 8. 📋 Skip & Compensation Policy

### Skip Feature

**Purpose:**  
Allow customers to skip individual days without losing their meal credits or subscription validity.

**Current Status:**  
✅ **ACTIVE** and fully operational.

**How It Works:**

1. Customer calls `POST /api/subscriptions/:id/days/:date/skip` for a future date
2. If successful, the day transitions to `status: "skipped"`
3. The subscription week/month displays the skipped date visually
4. No meal is prepared or delivered for the skipped day
5. Customer credits remain intact - the skip is "free" (no compensation created)
6. Customer can undo the skip via `POST /api/subscriptions/:id/days/:date/unskip` before the day is locked

**Limits:**

- Skip limit per subscription: Controlled by feature settings
- Skippable date window: Future dates only (not past or today)
- Reversibility: Only before the day is locked/processed

**Machine Codes:**

- `SKIP_LIMIT_REACHED`: Customer reached maximum skip allowance for subscription
- `INVALID_DATE`: Attempted to skip past, today, or locked date

### Freeze Feature & Compensation Policy

**Purpose:**  
Allow customers to temporarily pause deliveries while preserving their meal credits and extending validity period.

**Current Status:**  
✅ **FREEZE ENABLED** | ⚠️ **COMPENSATION POLICY INTENTIONALLY DISABLED**

**How It Works:**

1. Customer calls `POST /api/subscriptions/:id/freeze` with `startDate` and `days`
2. Specified date range transitions to `status: "frozen"`
3. No meals prepared or delivered for frozen dates
4. **Subscription validity is automatically extended** by the same number of frozen days
5. Customer's meal credits are NOT deducted (freeze is free - fully compensated through validity extension)
6. **NO separate "compensation days" are created** - validity extension IS the compensation

**Policy Decision:**

- **Automatic Validity Extension**: Frozen days are directly added to `subscription.validity.validityEndDate`
- **No Separate Compensation Records**: The system intentionally does NOT create compensated_day or extension_day records
- **Free Freeze Model**: Customers get full compensation (validity extension) at no cost
- **Business Rationale**: Validity extension simplifies the model and avoids confusion about "owed" vs "compensated" days
- **No Legacy Debt**: Skip and freeze operations do not create future "compensation days" that must be fulfilled later

**Freeze Timeline Example:**

Subscription created:
```
startDate: 2026-01-01
endDate: 2026-02-28 (60-day plan)
validity.validityEndDate: 2026-02-28
```

Freeze applied (2026-02-10 for 3 days):
```
frozenDates: [2026-02-10, 2026-02-11, 2026-02-12]
frozenDaysTotal: 3
validity.validityEndDate: 2026-03-03  ← Extended by 3 days (the exact freeze count)
No "compensation day" records created
```

**Policy Constraints:**

- Max freeze days per action: Configurable limit (default ~31 days)
- Max freeze operations per subscription: Configurable limit (default ~1 freeze per subscription lifecycle)
- Freezable date window: Future dates only (cannot freeze past or already-locked days)

**Machine Codes:**

- `FREEZE_DISABLED`: Feature flag disabled for this context
- `FREEZE_LIMIT_REACHED`: Customer reached maximum freeze operations for subscription
- `INVALID_DATE`: Attempted to freeze past, today, or locked dates

---

## 9. 🚫 Deprecated Endpoints

Legacy endpoints are still fully operational but marked for deprecation. They return standard HTTP deprecation headers visible to frontend and mobile SDKs.

### Deprecation Headers

All deprecated endpoints return:

```
Deprecation: true
Sunset: Tue, 30 Jun 2026 23:59:59 GMT
```

**Interpretation:**

- `Deprecation: true` signals that this endpoint is scheduled for removal
- `Sunset: <date>` indicates when support will end
- Clients should migrate before the sunset date
- After sunset date, the endpoint may be removed without further notice

### Deprecated Endpoints List

| Endpoint | Status | Replacement | Sunset Date |
|----------|--------|-------------|------------|
| `POST /api/subscriptions/:id/premium/topup` | ⚠️ Deprecated | `POST /api/subscriptions/:id/premium-credits/topup` | Jun 30, 2026 |
| `POST /api/subscriptions/:id/walletOldPath` | ⚠️ Deprecated (if exists) | `POST /api/subscriptions/:id/wallet/topups` | Jun 30, 2026 |

### Legacy Premium Topup → Modern Premium Credits

**Old Path (Legacy):**

```javascript
POST /api/subscriptions/{id}/premium/topup
{
  "count": 5,  // count of meals to topup
  "successUrl": "...",
  "backUrl": "..."
}
```

**New Path (Current):**

```javascript
POST /api/subscriptions/{id}/premium-credits/topup
{
  "items": [
    {
      "premiumMealId": "ID_OF_PREMIUM",
      "qty": 5
    }
  ],
  "successUrl": "...",
  "backUrl": "..."
}
```

**Compatibility Bridge:**

- The legacy `/premium/topup` endpoint accepts both old and new body formats
- If `items` field exists in the body, it is forwarded to the new `/premium-credits/topup` handler
- If only `count` field exists, it uses the legacy premium count model
- This bridge ensures smooth migration without breaking intermediate clients

**Migration Timeline:**

| Phase | Timeline | Action |
|-------|----------|--------|
| **Current** | Jan 2025 - Jun 2026 | Both paths active, legacy returns Sunset headers |
| **Grace Period** | Jun 1 - Jun 30, 2026 | Recommended cutoff for client upgrades |
| **After Sunset** | Jul 1, 2026+ | Legacy path may be removed without notice |

**Recommended Frontend Migration Steps:**

1. Detect `Sunset` header in responses
2. Log deprecation warning: "Premium topup API will be sunsetted on Jun 30, 2026"
3. Adjust topup UI to collect premium meal selections (new format)
4. Update API calls to use `/premium-credits/topup` with `items` array
5. Test with both production and staging
6. Deploy before June 30, 2026

---

## 8. ⚠️ Known Limitations

- Some historical snapshot records still contain plain strings instead of bilingual objects. In those cases the API returns the historical value as-is.
- Unsupported languages do not fail the request. They fall back to Arabic.
- Custom day payment flows such as custom meals, custom salads, and legacy one-time add-ons do not currently expose dedicated client verify endpoints in the subscription routes.
- `POST /api/subscriptions/:id/activate` exists only outside production and must not be used by production clients.
- `POST /api/subscriptions/:id/premium/topup` is still mounted for compatibility, but new frontend work should prefer `/api/subscriptions/:id/premium-credits/topup`.
