# Dashboard API Guide

## 1. Overview

This package documents Dashboard/Admin APIs only. Canonical dashboard paths use `/api/dashboard/*`; catalog management used by the dashboard meal planner lives under `/api/admin/meal-planner-menu/*`.

The backend currently uses two success styles: `{ "status": true, "data": ... }` and some legacy `{ "ok": true, ... }` shapes. Error responses usually follow `{ "ok": false, "error": { "code", "message", "details" } }`; meal planner catalog validation can return `{ "status": false, "error": "Validation failed", "details": [] }`.

## 2. Authentication

Use `POST /api/dashboard/auth/login` to get a dashboard JWT. This dashboard token is separate from mobile app tokens.

Send it on every protected request:

`Authorization: Bearer {{dashboardToken}}`

Roles in code are `superadmin`, `admin`, `kitchen`, and `courier`. Most `/api/dashboard` admin routes require `admin`; `/api/dashboard/subscriptions/:id/balances` adds `superadmin`; operations board allows `admin`, `kitchen`, and `courier` with action policy checks.

## 3. Endpoint Groups

Primary groups: auth, overview/reports, subscriptions, subscription management, subscription days, plans, addons, addon plans, users, dashboard users, payments, settings/content, delivery zones, health diagnostics, meal planner catalog, and operations board.

## 4. Key Business Flows

### Create subscription from dashboard

1. Create/find the app user.
2. Call `POST /api/dashboard/subscriptions/quote` with `userId`, `planId`, `grams`, `mealsPerDay`, delivery data, addon plans, and premium selections.
3. Show the quote to the admin/user.
4. Call `POST /api/dashboard/subscriptions` with the same body. The backend re-runs quote logic, builds the canonical contract, activates the subscription, and writes activity/audit logs.

### Quote before create

Quote is not optional for UI design. The create endpoint internally uses quote resolution; frontend should call quote first to avoid surprises in totals, VAT, delivery fees, addon plans, or premium selections.

### Update delivery

Use `PUT /api/dashboard/subscriptions/{id}/delivery`. Include a human reason. The controller captures before/after delivery mode, address, zone, fee, pickup location, and delivery slot/window in audit metadata.

### Add/remove addon entitlement

Use `PATCH /api/dashboard/subscriptions/{id}/addon-entitlements` with `reason` and a complete replacement array such as `addonSubscriptions`. Current code validates addon IDs, requires `kind=plan`, rejects duplicate categories, and writes audit/activity logs.

### Adjust balances with audit

Use `PATCH /api/dashboard/subscriptions/{id}/balances` as `superadmin`. A reason is required. Current implementation replaces `premiumBalance` and/or `addonBalance` arrays; it does not apply delta objects even though delta-style examples are useful for product discussion.

### Manage addon plans/items

`/api/dashboard/addons` manages shared Addon rows. `kind=plan` is a checkout entitlement/addon plan; `kind=item` is a one-time meal planner addon item. `/api/dashboard/addon-plans` is an alias that forces `kind=plan`. Delete is soft delete via `isActive=false`.

### Manage zones

`/api/dashboard/zones` supports `q` and `isActive` filters. Zones provide delivery options and fees for subscription delivery. Delete is soft delete.

### Use health diagnostics

`/api/dashboard/health/catalog`, `subscription-menu`, `meal-planner`, and `indexes` are read-only diagnostics. They are intended for dashboard launch checks and should not be used as migrations or cleanup tools.

## 5. Error Handling

Handle `400` validation errors, `401` missing/invalid dashboard token, `403` role rejection, `404` missing documents, `409` state conflicts, duplicate addon entitlement categories, or payment mismatches, and `502/500` provider/server failures where documented.

## 6. Audit Logging

Subscription management endpoints write audit records for create, delivery update, addon entitlement replacement, balance replacement, cancel, extend, freeze/unfreeze, skip/unskip, and payment verification when tied to a subscription. Audit metadata usually includes actor, role, before/after state, and reason/note when supplied.

## 7. Soft Delete Policy

Plans, addons, zones, and meal planner catalog rows are deactivated instead of hard deleted. Do not hard delete rows used historically by subscriptions, days, payments, or previous order selections.

## 8. Production Safety Notes

Avoid editing active paid subscriptions without an explicit reason and audit trail. Dashboard payment verification synchronizes with Moyasar and may apply side effects only when the payment is paid and unapplied. `plannerRevisionHash` belongs to mobile day payment/planning safety; dashboard APIs should not bypass revision safety when acting on subscription days.

## 9. Related But Not Primary Dashboard Endpoint

Unified day payment exists under `/api/subscriptions` for mobile/client flows, not under dashboard. It is intentionally not included as a primary dashboard endpoint in the OpenAPI document.

## 10. Ambiguous / Excluded Dashboard-Mounted Routes

The router also mounts older admin utilities under `/api/dashboard`, including uploads, promo codes, orders, legacy meals/meal-categories/salad-ingredients/meal-ingredients, builder-premium-meals, logs, notification logs, and `trigger-cutoff`. They are not documented as primary dashboard API contract here because the requested scope prioritizes subscription administration, dashboard catalog management, delivery zones, payments, health, meal planner catalog, and operations board. Maintenance-style APIs remain intentionally excluded.

## 11. Known Gaps / Future Work

- Dashboard UI is not implemented in this backend docs package.
- Granular permissions can be improved beyond current role gates.
- Maintenance APIs such as daily cutoff trigger and legacy admin routes remain intentionally excluded from primary docs.
- Health endpoints are read-only and do not repair data.
- Some older `/api/dashboard` catalog/order/log routes exist in the router but are not primary dashboard API contract areas here.
