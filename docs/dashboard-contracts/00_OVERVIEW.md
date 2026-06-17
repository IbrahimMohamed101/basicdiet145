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
10. **Menu Catalog** (`/menu?tab=catalog`): Item library, categories, and customization groups.
11. **Promo Codes** (`/promo-codes`): Discount codes, validation rules, and usage metrics.
12. **Settings** (`/settings`): CUTOFF times, skip allowances, and global VAT rules.
13. **Restaurant Hours** (`/restaurant-hours`): Operating hours and instant open/close controls.
14. **Delivery Zones** (`/zones`): Zone fees, boundaries, and sorting.

### Phase 3: Administrative Support
15. **Dashboard Home** (`/dashboard`): General summary statistics, active count cards, and recent history logs.
16. **App Users** (`/users`): Customer profile status, activation toggles, and subscription histories.
17. **Dashboard Users** (`/dashboard-users`): Access roles, emails, and permissions for admin, kitchen, courier, and cashier accounts.
18. **One-time Orders** (`/one-time-orders`): Non-subscription order flows, timeline events, and status updates.

---

## Global System Design Rules

### 1. VAT and Currency
* **Global Standard**: All monetary values are handled in Halalas (1/100 of Currency, e.g. SAR).
* **VAT Logic**: A flat 16% inclusive VAT structure is enforced. The formula to extract VAT from an inclusive total is:
  $$\text{VAT Amount} = \text{Total Inclusive} - \text{Round}\left(\frac{\text{Total Inclusive}}{1.16}\right)$$
* Displayed totals to customers must exactly match their paid totals.

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

| # | Screen | Dashboard Route | Backend Endpoint(s) | Risk Level | Status | Test Coverage | Notes |
|---|--------|-----------------|---------------------|------------|--------|---------------|-------|
| 01 | Dashboard Home | `/dashboard` | `GET /api/dashboard/overview` | LOW | ✅ READY | Test #1 — checks `stats` and `recentSubscriptions` array | Read-only aggregation |
| 02 | Payments | `/payments` | `GET /api/dashboard/payments`, `GET .../payments/:id`, `POST .../payments/:id/verify` | HIGH | ✅ READY | Test #2 — checks array shape, detail ID, verify transitions to `paid` | Moyasar mock required for verify |
| 03 | Accounting | `/accounting` | `GET /api/dashboard/accounting/daily-report`, `GET .../daily-report/export` | HIGH | ✅ READY | Test #3 — checks `summary` and `reconciliation` nodes, CSV export 200 | Inclusive VAT formula enforced server-side |
| 04 | Promo Codes | `/promo-codes` | `GET /api/dashboard/promo-codes`, `PATCH .../toggle`, `POST .../validate` | MEDIUM | ✅ READY | Test #4 — list, validate (checks `valid: true`), toggle (checks `isActive: false`) | Validate must run before toggle |
| 05 | Add-ons | `/addons` | `GET /api/dashboard/addons`, `PATCH .../toggle` | LOW | ✅ READY | Test #5 — list + toggle (HTTP 200 only) | ⚠️ No field assertions on list response |
| 06 | Packages | `/packages` | `GET /api/dashboard/plans` | LOW | ✅ READY | Test #6 — checks `data` is an array | Plans are read-only in contract tests |
| 07 | Subscriptions | `/subscriptions` | `GET /api/dashboard/subscriptions`, `GET .../audit`, `GET .../lifecycle` | CRITICAL | ✅ READY | Test #7 — list, audit checks `invariants`, lifecycle 200 | Partial pickup invariants fully documented |
| 08 | One-time Orders | `/one-time-orders` | `GET /api/dashboard/orders` | MEDIUM | ✅ READY | ⚠️ No dedicated test in dashboardContracts.test.js | Covered by existing `oneTimeOrders.test.js` suite |
| 09 | Operations | `/operations` | `GET /api/dashboard/ops/list`, `GET /api/dashboard/ops/search` | HIGH | ✅ READY | Test #8 — list + search (HTTP 200 only) | ⚠️ No field assertions; action transitions not tested here |
| 10 | Manual Deduction | `/manual-deduction` | `GET /api/dashboard/ops/cashier/customer-lookup`, `POST /api/dashboard/ops/cashier/customer-consumption` | HIGH | ✅ READY | Test #9 — lookup + consumption (HTTP 200) | Correct route prefix documented (was previously wrong) |
| 11 | Menu Catalog | `/menu?tab=catalog` | `GET /api/dashboard/menu/preview`, `GET /api/dashboard/menu/versions` | LOW | ✅ READY | Test #10 — preview + versions (HTTP 200) | Publish/diff endpoints not tested |
| 12 | Delivery | `/delivery` | `GET /api/courier/deliveries/today` | HIGH | ⚠️ NEEDS_TESTS | Test #11 — list (HTTP 200 only) | No E2E fulfillment flow tested. Route prefix is `/api/courier/` not `/api/dashboard/courier/` |
| 13 | Delivery Zones | `/zones` | `GET /api/dashboard/zones`, `GET .../zones/:id` | LOW | ✅ READY | Test #12 — list + detail (HTTP 200) | ⚠️ No field assertions on zone response body |
| 14 | App Users | `/users` | `GET /api/dashboard/users`, `GET .../users/:id` | MEDIUM | ✅ READY | Test #13 — list + detail (HTTP 200) | ⚠️ No field assertions on user response body |
| 15 | Dashboard Users | `/dashboard-users` | `GET /api/dashboard/dashboard-users` | HIGH | ✅ READY | Test #14 — list (HTTP 200 only) | ⚠️ Create/update/delete not tested |
| 16 | Settings | `/settings` | `GET /api/dashboard/settings`, `GET .../settings/restaurant-hours`, `PATCH /api/dashboard/settings` | HIGH | ✅ READY | Test #15 — get settings, restaurant hours, patch settings | |
| 17 | Restaurant Hours | `/restaurant-hours` | `GET /api/dashboard/settings/restaurant-hours` | MEDIUM | ✅ READY | Test #15 (shared) — restaurant-hours GET (HTTP 200) | Part of combined settings test |
| 18 | Pickup Branches | `/pickup-branches` | `GET /api/dashboard/settings` (read), `PATCH /api/dashboard/settings` (write validated) | HIGH | ✅ READY | Test #15 (shared) — settings list and PATCH update | `pickup_locations` fully validated and supported via settings patch |

### Status Legend
| Symbol | Meaning |
|--------|---------|
| ✅ READY | Endpoint documented, tested, backend verified |
| ⚠️ NEEDS_TESTS | Endpoint exists, partially tested, gaps remain |
| 🔴 NEEDS_BACKEND_FIX | Backend bug or missing feature confirmed |

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
