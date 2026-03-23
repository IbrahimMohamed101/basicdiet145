# Dashboard & Admin Subscription API Guide

This guide is designed for developers building the internal operational dashboard, admin panel, and customer support interfaces.

> **Important Mount Note**: The admin routes are mounted simultaneously on both `/api/admin` and `/api/dashboard`. Both prefixes resolve to the exact same controllers and exact same behavior. You may use either prefix. The following documentation assumes `/api/admin`.

---

## 1. Overview
The Dashboard API grants high-level operational oversight. It allows staff to:
1. List, inspect, and export customer subscriptions and metrics.
2. Manually provision subscriptions bypassing traditional checkout constraints.
3. Perform operational interventions like canceling, extending, freezing, or skipping days safely.
4. Manually verify stalled provider payments.

---

## 2. Admin Story Flows

### Flow 1: Customer Support & Inspection
*As a support agent, I want to search for a customer, view their subscription details, and verify their day-to-day calendar.*

1. **`GET /api/admin/subscriptions`**: Use the `q` query parameter to search by email, phone, or name.
2. **`GET /api/admin/subscriptions/:id`**: View the absolute details of the subscription, including the canonical `contractSnapshot`.
3. **`GET /api/admin/subscriptions/:id/days`**: View the granular daily records (meals selected, delivery status, etc.).

### Flow 2: Manual Subscription Provisioning
*As an admin, a VIP customer paid via wire transfer, and I need to manually generate a subscription for them.*

1. **`POST /api/admin/subscriptions`**: Construct the subscription using a rigid payload mapping to backend contracts.
   - Bypasses Moyasar checkout completely.
   - Instantly triggers timeline generation and day preparation.

### Flow 3: Operational Interventions
*As an operations manager, I need to force a freeze or cancel a subscription due to a logistics emergency.*

- **Cancel**: `POST /api/admin/subscriptions/:id/cancel`
  - Immediately marks the subscription as terminated. Unfulfilled days are wiped from projections.
- **Extend**: `PUT /api/admin/subscriptions/:id/extend`
  - Directly extends the `validityEndDate` explicitly (e.g., granting free compensation days).
- **Freeze**: `POST /api/admin/subscriptions/:id/freeze`
  - Safely pauses a range of days exactly as the user route would, but bypasses strict user identification authentication.
- **Skip**: `POST /api/admin/subscriptions/:id/days/:date/skip`
  - Safely cancels a specific day's delivery for the customer.

### Flow 4: Payment Remediation
*As a support agent, a customer's webhook dropped, and their payment is hanging in "initiated" status.*

1. **`GET /api/admin/payments`**: Find the pending payment.
2. **`POST /api/admin/payments/:id/verify`**: Trigger a manual sync directly with Moyasar. If the payment is actually paid, this endpoint securely runs the idempotent application layer (e.g., activating the subscription or crediting the wallet) immediately.

---

## 3. Localization Notes

The dashboard/admin subscription surface uses the same backend localization foundation as the app APIs.

### Supported languages

- `ar`
- `en`

### Request language precedence

1. `?lang=...`
2. `Accept-Language`
3. default fallback language

Current fallback: **Arabic (`ar`)**.

### Important behavior

- Dashboard auth and rate-limit errors are localized.
- Shared subscription serializers keep machine-readable fields stable.
- Human-readable companion fields use additive `*Label` naming where applicable.
- `error.code` remains stable and should continue to be used for dashboard logic.
- Localization does not mutate `contractSnapshot`, `lockedSnapshot`, or `fulfilledSnapshot`.

### Known limitation

Older historical/admin records may still contain plain-string display values. When no bilingual source exists, the backend returns the stored string unchanged to preserve historical integrity.

---

## 4. Endpoint Reference

### `GET /api/admin/subscriptions`
- **Who uses this**: Dashboard frontend.
- **Purpose**: Paginated listing of subscriptions globally.
- **Requires auth**: `dashboardBearerAuth` (Admin role required).
- **Important query parameters**: `q` (search string), `status` (active/expired/etc), `page`, `limit`.

### `POST /api/admin/subscriptions`
- **Who uses this**: Dashboard frontend.
- **Purpose**: Direct creation of an active subscription without payment gateways.
- **Requires auth**: Admin.
- **Important body fields**: `userId`, `planId`, `targetStartDate`, `deliveryAddress`, `zoneId`.
- **What happens next**: The subscription is active instantly.

### `GET /api/admin/subscriptions/summary`
- **Who uses this**: Dashboard analytics.
- **Purpose**: Fetches quick metrics (total active, expired vs pending).

### `POST /api/admin/subscriptions/:id/freeze` & `POST /api/admin/subscriptions/:id/unfreeze`
- **Who uses this**: Customer Support.
- **Purpose**: Safe Operational Wrapper to freeze a customer's subscription.
- **Important Warning**: This proxies internally to the customer controller but bypasses `req.userId` possession validations. It **will** observe freeze policies (e.g., max times frozen).

### `POST /api/admin/subscriptions/:id/days/:date/skip`
- **Who uses this**: Operations.
- **Purpose**: Force skips a specific day.
- **Notes**: Deducts automatically from the subscription's internal credit ledger.

### `PUT /api/admin/subscriptions/:id/extend`
- **Who uses this**: Operations.
- **Purpose**: Overrides the subscription's `validityEndDate`.
- **Body parameters**: `daysCount` (amount of days to shift).
- **Safety Note**: This action causes the timeline to mutate and generate extension days implicitly. Use for manual compensation.

### `POST /api/admin/payments/:id/verify`
- **Who uses this**: Dashboard ops.
- **Purpose**: Manual reconciliation of Moyasar transactions.
- **What it returns**: The verified payment object. If successful, triggers background side effects synchronously.

### `POST /api/admin/trigger-cutoff` (Internal)
- **Who uses this**: Superadmins or automation cron jobs.
- **Purpose**: Forces the system to lock tomorrow's days and prepare kitchen batches instantly.
- **Notes**: Returns HTTP 409 if a job is already concurrently processing.
