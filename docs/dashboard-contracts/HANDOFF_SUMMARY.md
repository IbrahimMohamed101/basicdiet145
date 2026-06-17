# Dashboard Backend Contract Pack — Handoff Summary

> **Freeze date**: 2026-06-18
> **Status**: Reconciliation complete. No further changes unless a backend contract update is issued.

---

## 1. Purpose

The `docs/dashboard-contracts/` folder is the **backend source-of-truth contract pack** for every screen and route in the BasicDiet145 admin dashboard. It documents:

- The exact backend API endpoints available to each screen.
- Request parameter schemas and required response fields.
- Business-logic invariants the frontend must never circumvent.
- Known limitations and outstanding test coverage gaps.

The dashboard development team must use this pack — not the frontend route map — as the authoritative API reference when building, modifying, or debugging any screen.

---

## 2. Inputs Used During Reconciliation

The following sources were consulted and cross-referenced to produce the contract pack:

| Source | Role |
|--------|------|
| `src/routes/` (Express routers) | Authoritative list of real backend endpoints |
| `src/controllers/` | Exact request/response shapes and validation logic |
| `src/services/` | Business logic rules and invariant enforcement |
| `src/models/` | Mongoose schemas and field definitions |
| `tests/dashboardContracts.test.js` | Primary integration contract verification suite |
| `tests/subscriptionAuditDashboard.test.js` | Subscription invariant and audit contract verification |
| `npm run test:subscriptions` | Core subscription balance and fulfillment policy tests |
| `docs/dashboard-contracts/DASAHBOARD_SCREEN_AND_ROUTES_MAP.md` | Frontend route map (context only, not authoritative) |
| `docs/SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md` | Verified partial-pickup scenario documentation |

---

## 3. Source-of-Truth Rule

> [!IMPORTANT]
> The following precedence rule is absolute and must be followed by the dashboard team.

1. **`DASAHBOARD_SCREEN_AND_ROUTES_MAP.md`** describes what the current dashboard frontend *appears to fetch*. It is frontend context only.
2. **Backend Express routes + controllers + services + tests** define the **final contract**. These are the source of truth.
3. If the frontend route map lists an endpoint that does not exist in the backend, it must be marked as not available — not invented or computed on the frontend.
4. If the frontend route map conflicts with a contract file, the **contract file wins**.
5. If a response field is missing from a backend response, the frontend must **escalate a backend contract update request**. It must never compute, infer, or fabricate missing fields locally.

---

## 4. Final Status Counts

Status values are read directly from the current contract files. No values are estimated.

| Status | Count | Files |
|--------|-------|-------|
| `READY` | 13 | `01_DASHBOARD_HOME`, `02_PAYMENTS`, `03_ACCOUNTING`, `04_PROMO_CODES`, `05_ADDONS`, `06_PACKAGES`, `07_SUBSCRIPTIONS`, `09_OPERATIONS`, `10_MANUAL_DEDUCTION`, `11_MENU_CATALOG`, `13_DELIVERY_ZONES`, `15_DASHBOARD_USERS`, `16_SETTINGS`, `17_RESTAURANT_HOURS`, `18_PICKUP_BRANCHES` |
| `READY_WITH_LIMITATIONS` | 8 | `08_ONE_TIME_ORDERS`, `14_APP_USERS`, `11A_MENU_CATEGORIES`, `11B_MENU_PRODUCTS`, `11C_MENU_PRODUCT_CUSTOMIZATION`, `11D_MENU_OPTION_GROUPS`, `11E_MENU_OPTIONS`, `11F_MENU_PREVIEW_RELEASE` |
| `NEEDS_TESTS` | 3 | `12_DELIVERY`, `19_NOTIFICATIONS`, `20_PROFILE` |
| `NEEDS_BACKEND_FIX` | 0 | — |
| `LEGACY_OR_UNCLEAR` | 0 | — |
| `OUT_OF_SCOPE` | 0 | — |

> [!NOTE]
> `11_MENU_CATALOG.md` is the legacy single-file menu contract. The authoritative detail is now split across `11A` through `11F`. Both files currently exist; the 11A–11F sub-contracts are preferred for per-area implementation.

---

## 5. Files Added During Reconciliation Pass

All of the following files were **newly created** during this reconciliation:

| File | Purpose |
|------|---------|
| `README.md` | Introduction guide for the dashboard team: rules, status legend, and test commands |
| `11A_MENU_CATEGORIES.md` | Menu Categories CRUD, reorder, and visibility endpoints |
| `11B_MENU_PRODUCTS.md` | Menu Products CRUD, duplication, bulk update, and reorder endpoints |
| `11C_MENU_PRODUCT_CUSTOMIZATION.md` | Per-product option group and option assignment, min/max rules, price overrides |
| `11D_MENU_OPTION_GROUPS.md` | Global Option Groups CRUD and reorder endpoints |
| `11E_MENU_OPTIONS.md` | Global Options CRUD, toggle active, and reorder endpoints |
| `11F_MENU_PREVIEW_RELEASE.md` | Menu preview, validate, publish, rollback, diff, and version history endpoints |
| `19_NOTIFICATIONS.md` | Notification summary counts and notification execution logs endpoints |
| `20_PROFILE.md` | Active admin profile (`/auth/me`) and logout endpoints |
| `HANDOFF_SUMMARY.md` | This file |

---

## 6. Files Updated During Reconciliation Pass

| File | Change |
|------|--------|
| `00_OVERVIEW.md` | Rebuilt the complete screen/route status matrix; added 11A–11F, 19, 20 rows; added status tag definitions; documented `/validate` vs `/validation` route mismatch |
| `08_ONE_TIME_ORDERS.md` | Status changed from `READY` → `READY_WITH_LIMITATIONS` (no deep E2E inside `dashboardContracts.test.js`) |
| `14_APP_USERS.md` | Status changed from `READY` → `READY_WITH_LIMITATIONS` (smoke tests only, no field assertions) |
| `tests/dashboardContracts.test.js` | Test #18 fixed: replaced hardcoded `"2026-06-17"` date with `dateUtils.getTodayKSADate()` to prevent KSA timezone rollover failures |
| `tests/subscriptionAuditDashboard.test.js` | Test #13 fixed: same timezone fix applied |

---

## 7. Critical Dashboard Rules

These invariants are enforced by the backend. The dashboard must display backend-provided values verbatim and must never circumvent them.

### Subscription Balance Rules
- **Dashboard must not calculate subscription balances.** Display `remainingQty`, `usedQty`, `pickedQty`, `deliveredQty`, and `remainingPlannedQty` directly from the backend audit response.
- **Dashboard must not treat add-ons as meal slots.** A subscription day with 1 meal slot and 4 add-on selections has exactly `mealSlots.length === 1`. Add-ons are independent entitlements.
- **Dashboard must not treat premium upgrades as extra meals.** A premium upgrade upgrades an existing meal slot. It does not increment `totalMeals` or add a new entry to `mealSlots[]`.

### Branch Pickup Selection Rules
- **`selectedMealSlotIds` must never contain add-ons.** Only slot keys (e.g. `"slot_1"`) belong in this field.
- **`selectedPickupItemIds` is the unified branch pickup selection field.** It is the single source of truth for what the customer has selected for a given pickup request (e.g. `["slot_1", "addon_<id>_1"]`).
- **Fulfillment consumes only `selectedPickupItemIds`.** No other planned items on the day are pruned or mutated by fulfillment.
- **Picked add-ons must not reappear.** After a pickup request is created or fulfilled, add-ons in `selectedPickupItemIds` must not appear in future availability responses.
- **Unpicked planned add-ons remain planned and available.** `day.addonSelections` is not pruned by fulfillment. Only the `selectedPickupItemIds` of the fulfilled request controls what is consumed.

### General Frontend Rules
- **Dashboard must consume backend read models only.** No balance calculations, status transitions, or invariant checks belong in the frontend.
- **Flutter must remain untouched.** The Flutter mobile client uses `/api/subscriptions/` endpoints, not dashboard endpoints. No Flutter changes are required or permitted as part of dashboard work.

---

## 8. Known Limitations

| Area | Limitation |
|------|-----------|
| **Delivery** (`12_DELIVERY`) | Status: `NEEDS_TESTS`. Courier queue list is smoke-tested (HTTP 200), but no end-to-end fulfillment flow is verified. Route prefix is `/api/courier/deliveries/today`, not `/api/dashboard/courier/`. |
| **One-Time Orders** (`08_ONE_TIME_ORDERS`) | Status: `READY_WITH_LIMITATIONS`. Covered by `oneTimeOrders.test.js` integration suite, but has no dedicated detail field assertions inside `dashboardContracts.test.js`. |
| **App Users** (`14_APP_USERS`) | Status: `READY_WITH_LIMITATIONS`. List and detail are smoke-tested only. Create-subscription subflows and field-level assertions are not covered. |
| **Notifications** (`19_NOTIFICATIONS`) | Status: `NEEDS_TESTS`. Both `/notifications/summary` and `/notification-logs` endpoints exist in the backend and were verified in source code, but no automated contract tests exist yet. |
| **Profile** (`20_PROFILE`) | Status: `NEEDS_TESTS`. `GET /api/dashboard/auth/me` exists and was verified in source code, but has no test coverage in the contract test suite. |
| **Menu Validate vs Validation** (`11F_MENU_PREVIEW_RELEASE`) | The frontend route map references `/api/dashboard/menu/validation`, but the backend route is `POST /api/dashboard/menu/validate`. The frontend must call the correct `/validate` path. |
| **Menu sub-contracts** (`11A`–`11F`) | Status: `READY_WITH_LIMITATIONS`. Basic read/write integration is tested via Test #10. Comprehensive field-level assertions on every endpoint are not yet present. |

---

## 9. Verification Commands

Run the following to confirm the backend contract pack is valid against the current codebase:

```bash
# Dashboard contract integration tests (20 tests)
NODE_ENV=test node tests/dashboardContracts.test.js

# Subscription audit and invariant tests (13 tests)
NODE_ENV=test node tests/subscriptionAuditDashboard.test.js

# Core subscription balance, modification, and concurrency policy tests
npm run test:subscriptions

# Rebuild AST codebase graph after any code changes
graphify update .
```

**Last verified result (2026-06-18):**
- `dashboardContracts.test.js`: 20 passed, 0 failed
- `subscriptionAuditDashboard.test.js`: 13 passed, 0 failed
- `npm run test:subscriptions`: All balance, modification, and concurrency tests passed

---

## 10. Instructions for the Dashboard Team

Follow this order when implementing any dashboard screen:

1. **Read `README.md` first.** It explains the folder structure, status tags, and global rules.
2. **Open `00_OVERVIEW.md`.** Find the row for your screen in the status matrix to get the current status and test coverage summary.
3. **Open the specific contract file** for your screen (e.g. `07_SUBSCRIPTIONS.md`, `11A_MENU_CATEGORIES.md`). This file contains the exact endpoints, request schemas, and response fields you must consume.
4. **Do not use `DASAHBOARD_SCREEN_AND_ROUTES_MAP.md` as your final contract.** Treat it as frontend route context only. It describes what the current UI appears to call — not what the backend guarantees.
5. **If a field is missing from a backend response**, do not compute it on the frontend. File a backend contract update request.
6. **If an endpoint listed in the route map is not in any contract file**, assume it does not exist in its described form. Verify in backend source or request a backend contract update.
7. **Any addition to the backend API** (new endpoint, new response field, status change) requires a corresponding update to the matching contract `.md` file before it can be considered released.
