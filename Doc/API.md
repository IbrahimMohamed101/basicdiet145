# API Documentation (Code-Inspected)

## Route Inventory (paths + methods + tags)

Base mount behavior from code:
- App root endpoints: `/`, `/health`, `/api-docs`, `/api-docs/swagger.yaml`
- API prefix for route modules: `/api`

### Route files + handlers (complete)

| Source | Method | Runtime path | Handler |
|---|---|---|---|
| `src/app.js` | GET | `/` | inline handler (root status) |
| `src/app.js` | GET | `/health` | inline handler (DB ping) |
| `src/app.js` | GET | `/api-docs/swagger.yaml` | inline handler (serves file) |
| `src/app.js` | GET | `/api-docs` | `swaggerUi.setup(...)` |
| `src/routes/index.js` | GET | `/api/settings` | `settingsController.getSettings` |
| `src/routes/webhooks.js` | POST | `/api/webhooks/moyasar` | `webhookController.handleMoyasarWebhook` |
| `src/routes/auth.js` | POST | `/api/auth/otp/request` | `authController.requestOtp` (`otpLimiter`) |
| `src/routes/auth.js` | POST | `/api/auth/otp/verify` | `authController.verifyOtp` |
| `src/routes/auth.js` | POST | `/api/auth/device-token` | `authController.updateDeviceToken` (`authMiddleware`) |
| `src/routes/appAuth.js` | POST | `/api/app/login` | `appAuthController.login` (`otpLimiter`) |
| `src/routes/appAuth.js` | POST | `/api/app/register` | `appAuthController.register` (`authMiddleware`) |
| `src/routes/plans.js` | GET | `/api/plans` | `planController.listPlans` (`authMiddleware`) |
| `src/routes/plans.js` | GET | `/api/plans/:id` | `planController.getPlan` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/preview` | `subscriptionController.previewSubscription` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/checkout` | `subscriptionController.checkoutSubscription` (`authMiddleware`, `checkoutLimiter`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/activate` | `subscriptionController.activateSubscription` (`authMiddleware`) |
| `src/routes/subscriptions.js` | GET | `/api/subscriptions/:id` | `subscriptionController.getSubscription` (`authMiddleware`) |
| `src/routes/subscriptions.js` | GET | `/api/subscriptions/:id/days` | `subscriptionController.getSubscriptionDays` (`authMiddleware`) |
| `src/routes/subscriptions.js` | GET | `/api/subscriptions/:id/today` | `subscriptionController.getSubscriptionToday` (`authMiddleware`) |
| `src/routes/subscriptions.js` | GET | `/api/subscriptions/:id/days/:date` | `subscriptionController.getSubscriptionDay` (`authMiddleware`) |
| `src/routes/subscriptions.js` | PUT | `/api/subscriptions/:id/days/:date/selection` | `subscriptionController.updateDaySelection` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/days/:date/skip` | `subscriptionController.skipDay` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/skip-range` | `subscriptionController.skipRange` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/days/:date/pickup/prepare` | `subscriptionController.preparePickup` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/days/:date/custom-salad` | `customSaladController.addCustomSaladToSubscriptionDay` (`authMiddleware`) |
| `src/routes/subscriptions.js` | PUT | `/api/subscriptions/:id/days/:date/delivery` | `subscriptionController.updateDeliveryDetailsForDate` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/premium/topup` | `subscriptionController.topupPremium` (`authMiddleware`) |
| `src/routes/subscriptions.js` | POST | `/api/subscriptions/:id/addons/one-time` | `subscriptionController.addOneTimeAddon` (`authMiddleware`) |
| `src/routes/subscriptions.js` | PUT | `/api/subscriptions/:id/delivery` | `subscriptionController.updateDeliveryDetails` (`authMiddleware`) |
| `src/routes/orders.js` | POST | `/api/orders/checkout` | `orderController.checkoutOrder` (`authMiddleware`, `checkoutLimiter`) |
| `src/routes/orders.js` | POST | `/api/orders/:id/confirm` | `orderController.confirmOrder` (`authMiddleware`) |
| `src/routes/orders.js` | POST | `/api/orders/:id/items/custom-salad` | `customSaladController.addCustomSaladToOrder` (`authMiddleware`) |
| `src/routes/orders.js` | GET | `/api/orders` | `orderController.listOrders` (`authMiddleware`) |
| `src/routes/orders.js` | GET | `/api/orders/:id` | `orderController.getOrder` (`authMiddleware`) |
| `src/routes/saladIngredients.js` | GET | `/api/salad-ingredients` | `saladIngredientController.listActiveIngredients` |
| `src/routes/customSalads.js` | POST | `/api/custom-salads/price` | `customSaladController.previewCustomSaladPrice` (`authMiddleware`) |
| `src/routes/courier.js` | GET | `/api/courier/deliveries/today` | `courierController.listTodayDeliveries` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | PUT | `/api/courier/deliveries/:id/arriving-soon` | `courierController.markArrivingSoon` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | PUT | `/api/courier/deliveries/:id/delivered` | `courierController.markDelivered` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | PUT | `/api/courier/deliveries/:id/cancel` | `courierController.markCancelled` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | GET | `/api/courier/orders/today` | `orderCourierController.listTodayOrders` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | PUT | `/api/courier/orders/:id/delivered` | `orderCourierController.markDelivered` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/courier.js` | PUT | `/api/courier/orders/:id/cancel` | `orderCourierController.markCancelled` (`authMiddleware`, `roleMiddleware[courier,admin]`) |
| `src/routes/kitchen.js` | GET | `/api/kitchen/days/:date` | `kitchenController.listDailyOrders` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | PUT | `/api/kitchen/subscriptions/:id/days/:date/assign` | `kitchenController.assignMeals` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/subscriptions/:id/days/:date/lock` | `kitchenController.transitionDay(..., \"locked\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/subscriptions/:id/days/:date/in-preparation` | `kitchenController.transitionDay(..., \"in_preparation\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery` | `kitchenController.transitionDay(..., \"out_for_delivery\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/subscriptions/:id/days/:date/ready-for-pickup` | `kitchenController.transitionDay(..., \"ready_for_pickup\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | `kitchenController.fulfillPickup` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | GET | `/api/kitchen/orders/:date` | `orderKitchenController.listOrdersByDate` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/orders/:id/preparing` | `orderKitchenController.transitionOrder(..., \"preparing\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/orders/:id/out-for-delivery` | `orderKitchenController.transitionOrder(..., \"out_for_delivery\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/kitchen.js` | POST | `/api/kitchen/orders/:id/ready-for-pickup` | `orderKitchenController.transitionOrder(..., \"ready_for_pickup\")` (`authMiddleware`, `roleMiddleware[kitchen,admin]`) |
| `src/routes/admin.js` | POST | `/api/dashboard/plans` and `/api/admin/plans` | `adminController.createPlan` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PUT | `/api/dashboard/settings/cutoff` and `/api/admin/settings/cutoff` | `adminController.updateCutoff` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PUT | `/api/dashboard/settings/delivery-windows` and `/api/admin/settings/delivery-windows` | `adminController.updateDeliveryWindows` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PUT | `/api/dashboard/settings/skip-allowance` and `/api/admin/settings/skip-allowance` | `adminController.updateSkipAllowance` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PUT | `/api/dashboard/settings/premium-price` and `/api/admin/settings/premium-price` | `adminController.updatePremiumPrice` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | GET | `/api/dashboard/dashboard-users` and `/api/admin/dashboard-users` | `adminController.listDashboardUsers` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | POST | `/api/dashboard/dashboard-users` and `/api/admin/dashboard-users` | `adminController.createDashboardUser` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | GET | `/api/dashboard/logs` and `/api/admin/logs` | `adminController.listActivityLogs` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | GET | `/api/dashboard/notification-logs` and `/api/admin/notification-logs` | `adminController.listNotificationLogs` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | POST | `/api/dashboard/trigger-cutoff` and `/api/admin/trigger-cutoff` | `adminController.triggerDailyCutoff` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | POST | `/api/dashboard/salad-ingredients` and `/api/admin/salad-ingredients` | `saladIngredientController.createIngredient` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PATCH | `/api/dashboard/salad-ingredients/:id` and `/api/admin/salad-ingredients/:id` | `saladIngredientController.updateIngredient` (`authMiddleware`, `roleMiddleware[admin]`) |
| `src/routes/admin.js` | PATCH | `/api/dashboard/salad-ingredients/:id/toggle` and `/api/admin/salad-ingredients/:id/toggle` | `saladIngredientController.toggleIngredient` (`authMiddleware`, `roleMiddleware[admin]`) |

### System

| Method | Path | Tag |
|---|---|---|
| GET | `/` | System |
| GET | `/health` | System |
| GET | `/api-docs` | System |
| GET | `/api-docs/swagger.yaml` | System |
| GET | `/api/settings` | System |

### Auth (App)

| Method | Path | Tag |
|---|---|---|
| POST | `/api/auth/otp/request` | Auth (App) |
| POST | `/api/auth/otp/verify` | Auth (App) |
| POST | `/api/auth/device-token` | Auth (App), Users |
| POST | `/api/app/login` | Auth (App) |
| POST | `/api/app/register` | Auth (App) |

### Plans / Menu

| Method | Path | Tag |
|---|---|---|
| GET | `/api/plans` | Plans |
| GET | `/api/plans/:id` | Plans |
| GET | `/api/salad-ingredients` | Meals / Menu |
| POST | `/api/custom-salads/price` | Meals / Menu |

### Subscriptions

| Method | Path | Tag |
|---|---|---|
| POST | `/api/subscriptions/preview` | Subscriptions |
| POST | `/api/subscriptions/checkout` | Subscriptions |
| POST | `/api/subscriptions/:id/activate` | Subscriptions |
| GET | `/api/subscriptions/:id` | Subscriptions |
| GET | `/api/subscriptions/:id/days` | Subscriptions |
| GET | `/api/subscriptions/:id/today` | Subscriptions |
| GET | `/api/subscriptions/:id/days/:date` | Subscriptions |
| PUT | `/api/subscriptions/:id/days/:date/selection` | Subscriptions |
| POST | `/api/subscriptions/:id/days/:date/skip` | Subscriptions |
| POST | `/api/subscriptions/:id/skip-range` | Subscriptions |
| POST | `/api/subscriptions/:id/days/:date/pickup/prepare` | Subscriptions |
| POST | `/api/subscriptions/:id/days/:date/custom-salad` | Subscriptions, Meals / Menu |
| PUT | `/api/subscriptions/:id/days/:date/delivery` | Subscriptions |
| POST | `/api/subscriptions/:id/premium/topup` | Subscriptions |
| POST | `/api/subscriptions/:id/addons/one-time` | Subscriptions |
| PUT | `/api/subscriptions/:id/delivery` | Subscriptions |

### Orders

| Method | Path | Tag |
|---|---|---|
| POST | `/api/orders/checkout` | Orders |
| POST | `/api/orders/:id/confirm` | Orders |
| POST | `/api/orders/:id/items/custom-salad` | Orders, Meals / Menu |
| GET | `/api/orders` | Orders |
| GET | `/api/orders/:id` | Orders |

### Webhooks

| Method | Path | Tag |
|---|---|---|
| POST | `/api/webhooks/moyasar` | Webhooks |

### Deliveries / Courier

| Method | Path | Tag |
|---|---|---|
| GET | `/api/courier/deliveries/today` | Deliveries / Courier |
| PUT | `/api/courier/deliveries/:id/arriving-soon` | Deliveries / Courier |
| PUT | `/api/courier/deliveries/:id/delivered` | Deliveries / Courier |
| PUT | `/api/courier/deliveries/:id/cancel` | Deliveries / Courier |
| GET | `/api/courier/orders/today` | Deliveries / Courier, Orders |
| PUT | `/api/courier/orders/:id/delivered` | Deliveries / Courier, Orders |
| PUT | `/api/courier/orders/:id/cancel` | Deliveries / Courier, Orders |

### Kitchen

| Method | Path | Tag |
|---|---|---|
| GET | `/api/kitchen/days/:date` | Kitchen |
| PUT | `/api/kitchen/subscriptions/:id/days/:date/assign` | Kitchen |
| POST | `/api/kitchen/subscriptions/:id/days/:date/lock` | Kitchen |
| POST | `/api/kitchen/subscriptions/:id/days/:date/in-preparation` | Kitchen |
| POST | `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery` | Kitchen |
| POST | `/api/kitchen/subscriptions/:id/days/:date/ready-for-pickup` | Kitchen |
| POST | `/api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` | Kitchen |
| GET | `/api/kitchen/orders/:date` | Kitchen, Orders |
| POST | `/api/kitchen/orders/:id/preparing` | Kitchen, Orders |
| POST | `/api/kitchen/orders/:id/out-for-delivery` | Kitchen, Orders |
| POST | `/api/kitchen/orders/:id/ready-for-pickup` | Kitchen, Orders |

### Admin (Dashboard base path)

| Method | Path | Tag |
|---|---|---|
| POST | `/api/dashboard/plans` | Admin (Dashboard), Plans |
| PUT | `/api/dashboard/settings/cutoff` | Admin (Dashboard) |
| PUT | `/api/dashboard/settings/delivery-windows` | Admin (Dashboard) |
| PUT | `/api/dashboard/settings/skip-allowance` | Admin (Dashboard) |
| PUT | `/api/dashboard/settings/premium-price` | Admin (Dashboard) |
| GET | `/api/dashboard/dashboard-users` | Admin (Dashboard), Users |
| POST | `/api/dashboard/dashboard-users` | Admin (Dashboard), Users |
| GET | `/api/dashboard/logs` | Admin (Dashboard) |
| GET | `/api/dashboard/notification-logs` | Notifications, Admin (Dashboard) |
| POST | `/api/dashboard/trigger-cutoff` | Admin (Dashboard) |
| POST | `/api/dashboard/salad-ingredients` | Admin (Dashboard), Meals / Menu |
| PATCH | `/api/dashboard/salad-ingredients/:id` | Admin (Dashboard), Meals / Menu |
| PATCH | `/api/dashboard/salad-ingredients/:id/toggle` | Admin (Dashboard), Meals / Menu |

### Admin (Admin base path alias)

All 13 endpoints above are also mounted under `/api/admin/*` with identical behavior.

---

## Overview

- Base URL: `http://localhost:{PORT}` (default `3000`)
- API prefix: `/api`
- Auth header: `Authorization: Bearer <jwt>`
- Content type: `application/json`
- Localized endpoints may use `Accept-Language: ar` or `Accept-Language: en`

### Standard error format

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "Human-readable message",
    "details": {}
  }
}
```

`details` is optional and appears on some errors (for example OTP cooldown/attempts metadata).

---

## Authentication

### App OTP flow

1. Request OTP
- `POST /api/auth/otp/request`
- Body: `{"phoneE164":"+9665XXXXXXXX"}`

2. Verify OTP
- `POST /api/auth/otp/verify`
- Body: `{"phoneE164":"+9665XXXXXXXX","otp":"123456"}`
- Returns app access token (`tokenType=app_access`) and user profile.

3. Optional profile completion
- `POST /api/app/register` (requires bearer token from step 2)
- Body: `{"fullName":"...","email":"..."}`

4. Save device token
- `POST /api/auth/device-token` (requires bearer token)
- Body: `{"token":"<fcm-token>"}`

Example:

```bash
curl -X POST http://localhost:3000/api/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phoneE164":"+966501234567","otp":"123456"}'
```

### Dashboard auth flow

There is no dedicated dashboard login endpoint wired in this codebase.

Dashboard/admin/kitchen/courier routes use the same JWT middleware and require appropriate `role` claim:
- `admin` for admin routes
- `kitchen` or `admin` for kitchen routes
- `courier` or `admin` for courier routes

### DEV_AUTH_BYPASS behavior (dev-only)

When `DEV_AUTH_BYPASS=true`, middleware accepts the exact `DEV_STATIC_TOKEN` and injects:
- `req.userId = DEV_STATIC_USER_ID`
- `req.userRole = DEV_STATIC_ROLE`

Use this only in non-production environments.

---

## Module usage examples

### Plans & Menu

Get plans in English:

```bash
curl http://localhost:3000/api/plans \
  -H 'Authorization: Bearer <APP_TOKEN>' \
  -H 'Accept-Language: en'
```

Preview custom salad price:

```bash
curl -X POST http://localhost:3000/api/custom-salads/price \
  -H 'Authorization: Bearer <APP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"ingredients":[{"ingredientId":"<id>","quantity":2}]}'
```

### Subscriptions

Checkout a subscription:

```bash
curl -X POST http://localhost:3000/api/subscriptions/checkout \
  -H 'Authorization: Bearer <APP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "planId":"<planId>",
    "premiumCount":2,
    "deliveryMode":"delivery",
    "deliveryAddress":{"line1":"Street","city":"Riyadh"},
    "deliveryWindow":"08:00-11:00"
  }'
```

Update day selections:

```bash
curl -X PUT http://localhost:3000/api/subscriptions/<subId>/days/2026-03-01/selection \
  -H 'Authorization: Bearer <APP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"selections":["<meal1>"],"premiumSelections":["<meal2>"]}'
```

### Orders

Checkout one-time order:

```bash
curl -X POST http://localhost:3000/api/orders/checkout \
  -H 'Authorization: Bearer <APP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "deliveryMode":"pickup",
    "deliveryDate":"2026-03-02",
    "meals":[{"mealId":"<mealId>","quantity":2}]
  }'
```

### Deliveries / Courier

```bash
curl -X PUT http://localhost:3000/api/courier/deliveries/<deliveryId>/delivered \
  -H 'Authorization: Bearer <COURIER_OR_ADMIN_TOKEN>'
```

### Kitchen

```bash
curl -X POST http://localhost:3000/api/kitchen/subscriptions/<subId>/days/2026-03-01/out-for-delivery \
  -H 'Authorization: Bearer <KITCHEN_OR_ADMIN_TOKEN>'
```

### Admin

List notification logs:

```bash
curl 'http://localhost:3000/api/dashboard/notification-logs?page=1&limit=50' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>'
```

Trigger cutoff job:

```bash
curl -X POST http://localhost:3000/api/admin/trigger-cutoff \
  -H 'Authorization: Bearer <ADMIN_TOKEN>'
```

### Webhooks

```bash
curl -X POST http://localhost:3000/api/webhooks/moyasar \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"payment_paid",
    "secret_token":"<MOYASAR_WEBHOOK_SECRET if configured>",
    "data":{"id":"pay_x","invoice_id":"iv_x","status":"paid","metadata":{"type":"one_time_order","orderId":"<orderId>"}}
  }'
```

---

## Data localization behavior

The backend stores many names as multilingual objects (for example `{ ar, en }`) in MongoDB.

On app-facing endpoints that resolve names (`/api/plans`, `/api/plans/:id`, `/api/salad-ingredients`), runtime logic:
1. Parses `Accept-Language` (supports RFC-style lists too).
2. Resolves to `ar` or `en`.
3. Fallbacks in this order: requested language -> other supported language -> empty string.

Some write endpoints still accept legacy flat fields (`name_ar`, `name_en`) for backward compatibility (notably salad ingredient admin endpoints).

---

## Pagination / filtering / search

Explicit query parameters found in code:

1. `GET /api/admin/logs` and `GET /api/dashboard/logs`
- Filters: `entityType`, `entityId`, `action`, `from`, `to`, `byRole`
- Pagination: `page` (default 1), `limit` (default 50, max 200)

2. `GET /api/admin/notification-logs` and `GET /api/dashboard/notification-logs`
- Filters: `userId`, `from`, `to`
- Pagination: `page` (default 1), `limit` (default 50, max 200)

No explicit text search parameter is implemented in route/controller code.

---

## Environment variables

### Required at startup

From `validateEnv()`:
- `JWT_SECRET`
- `MONGO_URI` or `MONGODB_URI` (must start with `mongodb://` or `mongodb+srv://`)

### Commonly used / optional (feature-dependent)

From `.env.example` and runtime code:
- `PORT`
- OTP: `OTP_TTL_MINUTES`, `OTP_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_HASH_SECRET`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
- Moyasar: `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`
- URLs: `APP_URL`
- Auth dev bypass: `DEV_AUTH_BYPASS`, `DEV_STATIC_TOKEN`, `DEV_STATIC_USER_ID`, `DEV_STATIC_ROLE`
- Rate limit: `RATE_LIMIT_OTP_WINDOW_MS`, `RATE_LIMIT_OTP_MAX`, `RATE_LIMIT_CHECKOUT_WINDOW_MS`, `RATE_LIMIT_CHECKOUT_MAX`
- Infra/security: `TRUST_PROXY`, `CORS_ORIGINS`
- Token TTL: `APP_ACCESS_TOKEN_TTL`

---

## Not wired / dead endpoints

Controller functions exported but not routed by `src/routes`:

1. `subscriptionController.transitionDay` in `src/controllers/subscriptionController.js`
2. `subscriptionController.fulfillDay` in `src/controllers/subscriptionController.js`

They are intentionally listed as **Not wired** and are not documented as active HTTP routes.

---

## Known limitations / TODOs discovered

1. No dedicated dashboard auth endpoint is wired.
- Dashboard routes rely on generic JWT role claims but no login route exists for these roles.

2. Moyasar webhook verification is body-token based, not signature-header based.
- Only `payload.secret_token` is checked when `MOYASAR_WEBHOOK_SECRET` is set.

3. Subscription ownership checks are not enforced in several subscription controllers.
- Many subscription endpoints query by subscription id without additionally constraining `userId == req.userId`.

4. One-time order delivery creation in kitchen flow appears schema-inconsistent.
- `orderKitchenController` upserts delivery using `orderId` and `subscriptionId: null`, while `Delivery` model requires `subscriptionId` and `dayId`.
