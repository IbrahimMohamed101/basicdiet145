# Dashboard Backend Contract Pack — Overview

This document provides a system-wide overview of the Backend Contract Pack for the BasicDiet145 admin/operator dashboard. The goal of this pack is to map every dashboard screen to its corresponding backend API contract, document data expectations, and establish rigorous tests to verify that the backend behaves correctly under all operational circumstances.

---

## Screen Priority Classification

The dashboard screens are divided into three phases based on operational and financial criticality:

### Phase 1: Critical Core Operations & Finance
1. **Subscriptions** (`/subscriptions`): Lifecycle and state tracking, invariant auditing.
2. **Operations** (`/operations`): Kitchen and branch pickup queue workflow.
3. **Manual Deduction** (`/manual-deduction`): Customer lookup and manual subscription meal/addon wallet deduction.
4. **Add-ons** (`/addons`): Addon catalog definitions (plans and items).
5. **Packages** (`/packages`): Main subscription plans, pricing options, and carb/protein choices.
6. **Delivery** (`/delivery`): Driver schedule and home delivery fulfillment queue.
7. **Pickup Branches** (`/pickup-branches`): Configuration for self-pickup locations.
8. **Payments** (`/payments`): Transaction logs and payment verification.
9. **Accounting** (`/accounting`): Daily report generation, financial metrics, and export features.

### Phase 2: Configuration & Menu Catalog
10. **Menu Catalog** (`/menu`): Sub-categorized into specific areas:
    * **11A: Menu Categories**: Reusable category folders.
    * **11B: Menu Products**: Menu items, prices, duplication, and reordering.
    * **11C: Menu Product Customization**: Per-product option group and option relationships, min/max rules, and price overrides.
    * **11D: Menu Option Groups**: Global customization option groups (proteins, carbs, add-ons).
    * **11E: Menu Options**: Global customization options and toggle statuses.
    * **11F: Menu Preview & Release**: Catalog preview, validation, publishing, and rollback history.
11. **Promo Codes** (`/promo-codes`): Discount codes, validation rules, and usage metrics.
12. **Settings** (`/settings`): CUTOFF times, skip allowances, and global VAT rules.
13. **Restaurant Hours** (`/restaurant-hours`): Operating hours and instant open/close controls.
14. **Delivery Zones** (`/zones`): Zone fees, boundaries, and sorting.

### Phase 3: Administrative Support
15. **Dashboard Home** (`/dashboard`): General summary statistics, active count cards, and recent history logs.
16. **App Users** (`/users`): Customer profile status, activation toggles, and subscription histories.
17. **Dashboard Users** (`/dashboard-users`): Access roles, emails, and permissions for admin, kitchen, courier, and cashier accounts.
18. **One-time Orders** (`/one-time-orders`): Non-subscription order flows, timeline events, and status updates.
19. **Notifications** (`/notifications`): Push notification stats and sent history logs.
20. **Profile** (`/profile`): Active admin profile view.

---

## Global System Design Rules

### 1. VAT and Currency
* **Global Standard**: All monetary values are handled in Halalas (1/100 of Currency, e.g. SAR).
* **VAT Logic**: Pricing and VAT behavior must follow backend settings/accounting contracts only.

### 2. Unified Branch Pickup & Partial Fulfillment
The backend enforces a strict item-based reservation model for branch pickup subscription days, detailed in [BRANCH_PICKUP_FLUTTER_PICKUP_ITEMS_README.md](file:///home/hema/Projects/basicdiet145/docs/BRANCH_PICKUP_FLUTTER_PICKUP_ITEMS_README.md).
* **Unified Field**: `selectedPickupItemIds` is the single source of truth for items requested for pickup (e.g. `["slot_1", "addon_64f000000000000000000001_1"]`).
* **Fulfillment**: Fulfillment consumes **only** items in `selectedPickupItemIds`. No other planned items on the day are pruned or mutated.
* **Wallet Refund Rules**:
  * Unselected planned add-ons are **not** refunded to `addonBalance.remainingQty` at fulfillment. They remain planned on the day and available for a future pickup request.
  * Picked add-ons must not reappear in default availability once a pickup request is created or fulfilled.
* **Upgrade Rules**:
  * Add-ons are independent entitlements and are **never** counted as base meal slots.
  * Premium upgrades are applied to existing meal slots (e.g., protein extra fee) and **do not** create extra meal slots.
  * `selectedMealSlotIds` must never contain add-ons.
  * Flutter remains untouched during backend optimization.

### 3. Partial Pickup Verification Reference
> The canonical partial pickup scenario (4 add-ons planned → pick 2 → future availability returns exactly 2) is fully documented and verified. See:
> [SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md](file:///home/hema/Projects/basicdiet145/docs/SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md)

---

## Summary Matrix

| # | Screen | Dashboard Route | Backend Endpoint(s) | Status | Test Coverage | Notes |
|---|--------|-----------------|---------------------|--------|---------------|-------|
| 01 | Dashboard Home | `/dashboard` | `GET /api/dashboard/overview` | `READY` | Test #1 | |
| 02 | Payments | `/payments` | `GET /api/dashboard/payments`, `POST .../payments/:id/verify` | `READY` | Test #2 | |
| 03 | Accounting | `/accounting` | `GET /api/dashboard/accounting/daily-report`, `GET .../export` | `READY` | Test #3 | |
| 04 | Promo Codes | `/promo-codes` | `GET /api/dashboard/promo-codes`, `PATCH .../toggle` | `READY` | Test #4 | |
| 05 | Add-ons | `/addons` | `GET /api/dashboard/addons`, `PATCH .../toggle` | `READY_WITH_LIMITATIONS` | Test #5 | Smoke tests only |
| 06 | Packages | `/packages` | `GET /api/dashboard/plans` | `READY_WITH_LIMITATIONS` | Test #6 | Smoke tests only |
| 07 | Subscriptions | `/subscriptions` | `GET /api/dashboard/subscriptions`, `GET .../:id/audit`, `GET .../:id/lifecycle` | `READY` | Test #7, #18 | |
| 08 | One-time Orders | `/one-time-orders` | `GET /api/dashboard/orders` | `READY_WITH_LIMITATIONS` | Integration Suite | Tested in `oneTimeOrders.test.js` |
| 09 | Operations | `/operations` | `GET /api/dashboard/ops/list`, `GET /api/dashboard/ops/search` | `READY_WITH_LIMITATIONS` | Test #8 | Smoke tests only |
| 10 | Manual Deduction | `/manual-deduction` | `GET /api/dashboard/ops/cashier/customer-lookup`, `POST .../customer-consumption` | `READY` | Test #9 | |
| 11A | Menu Categories | `/menu` (Categories) | `GET /api/dashboard/menu/categories`, `POST .../categories` | `READY_WITH_LIMITATIONS` | Test #10 | |
| 11B | Menu Products | `/menu` (Products) | `GET /api/dashboard/menu/products`, `POST .../products` | `READY_WITH_LIMITATIONS` | Test #10 | |
| 11C | Menu Product Customization | `/menu` (Customization) | `GET /api/dashboard/menu/products/:productId/composer?contractVersion=v4` | `READY_WITH_LIMITATIONS` | Test #10 | |
| 11D | Menu Option Groups | `/menu` (Groups) | `GET /api/dashboard/menu/option-groups`, `POST .../option-groups` | `READY_WITH_LIMITATIONS` | Test #10 | |
| 11E | Menu Options | `/menu` (Options) | `GET /api/dashboard/menu/options`, `POST .../options` | `READY_WITH_LIMITATIONS` | Test #10 | |
| 11F | Menu Preview/Release | `/menu` (Preview/Release) | `GET /api/dashboard/menu/preview`, `POST .../publish`, `POST .../rollback/:versionId`, `POST .../validate` | `READY_WITH_LIMITATIONS` | Test #10 | ⚠️ Mismatch: Frontend references `/validation` but backend has `/validate` |
| 12 | Delivery | `/delivery` | `GET /api/courier/deliveries/today` | `NEEDS_TESTS` | Test #11 (Smoke) | No E2E fulfillment flow tests |
| 13 | Delivery Zones | `/zones` | `GET /api/dashboard/zones` | `READY_WITH_LIMITATIONS` | Test #12 | Smoke tests only |
| 14 | App Users | `/users` | `GET /api/dashboard/users` | `READY_WITH_LIMITATIONS` | Test #13 | Smoke tests only |
| 15 | Dashboard Users | `/dashboard-users` | `GET /api/dashboard/dashboard-users` | `READY_WITH_LIMITATIONS` | Test #14 | Smoke tests only |
| 16 | Settings | `/settings` | `GET /api/dashboard/settings`, `PATCH /api/dashboard/settings` | `READY` | Test #15 | |
| 17 | Restaurant Hours | `/restaurant-hours` | `GET /api/dashboard/settings/restaurant-hours` | `READY` | Test #15 | |
| 18 | Pickup Branches | `/pickup-branches` | `GET /api/dashboard/settings`, `PATCH /api/dashboard/settings` | `READY` | Test #15 | Validated via `pickup_locations` in settings |
| 19 | Notifications | `/notifications` | `GET /api/dashboard/notifications/summary`, `GET /api/dashboard/notification-logs` | `NEEDS_TESTS` | None | Endpoints verified in backend code |
| 20 | Profile | `/profile` | `GET /api/dashboard/auth/me`, `POST /api/dashboard/auth/logout` | `NEEDS_TESTS` | None | Endpoints verified in backend code |

---

## Screen Status Tag definitions

* **`READY`**: Fully implemented, verified, and backed by comprehensive tests.
* **`READY_WITH_LIMITATIONS`**: Implemented and functional, but has limited test coverage or specific business assumptions.
* **`NEEDS_TESTS`**: Implemented on the backend, but lacks automated test validation.
* **`NEEDS_BACKEND_FIX`**: Endpoint exists but has bugs or misses key capabilities required by the dashboard.
* **`LEGACY_OR_UNCLEAR`**: Deprecated or legacy behavior.
* **`OUT_OF_SCOPE`**: Intentionally excluded from the contract pack.

---

## Test Cross-Reference Table

| Test # | Test Name | What It Verifies |
|--------|-----------|------------------|
| #1 | Dashboard Home: GET /api/dashboard/overview | `stats` object exists; `recentSubscriptions` is array |
| #2 | Payments: List, Detail, and Verification | Payments array, detail ID match, verify → `payment.status === "paid"` |
| #3 | Accounting: Daily report and inclusive VAT checks | `summary` and `reconciliation` nodes present; CSV export 200 |
| #4 | Promo Codes: CRUD, toggle and validate | Validate returns `valid: true`; toggle returns `isActive: false` |
| #5 | Add-ons: CRUD and toggle | List 200; toggle 200 |
| #6 | Packages (Plans): List packages | `data` is an array |
| #7 | Subscriptions: List, Audit, Lifecycle | Audit returns `invariants` node; lifecycle 200 |
| #8 | Operations Queue: List and cashier search | Ops list 200; cashier search 200 |
| #9 | Manual Deduction: cashier-lookup and deduction execute | Lookup 200; consumption 200 |
| #10 | Menu Catalog: preview draft and list versions | Preview 200; versions 200 |
| #11 | Courier / Delivery Queue: list deliveries | `GET /api/courier/deliveries/today` returns 200 |
| #12 | Delivery Zones: List and get zones | List 200; detail 200 |
| #13 | App Users: List and details | List 200; detail 200 |
| #14 | Dashboard Users: CRUD and list | List 200 |
| #15 | Settings: general and restaurant hours settings | GET settings 200; restaurant hours 200; PATCH restaurant_is_open 200; PATCH pickup_locations validation checks (valid/invalid/unauthorized) |
| #16 | Forbidden Role checks block courier/cashier from settings | Courier GET settings → 403 |
| #17 | Resource 404: Returns NOT_FOUND for missing ObjectId | `GET /payments/:missingId` → 404 |
| #18 | Subscription Invariant: 4 planned addons → pick 2 → future availability returns exactly 2 | Partial pickup scenario, no wallet refund |
| #19 | Subscription Invariant: Premium upgrades do not create extra meals | `totalMeals` unchanged, slot count invariant |
| #20 | Subscription Invariant: Add-ons are independent entitlements | `mealSlots.length === 1`, `addonSelections.length === 1` |
