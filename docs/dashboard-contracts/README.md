# Dashboard Backend Contract Pack

Welcome to the Dashboard Backend Contract Pack for the BasicDiet145 admin/operator dashboard. This directory contains API specifications, data expectations, and lifecycle constraints for all dashboard screens.

---

## 1. What This Folder Is
This directory is a **live, tested contract pack** between the BasicDiet145 backend services and the react‑based admin dashboard. It details the exact endpoints, request payloads, response bodies, validation constraints, and operational invariants enforced by the server.

## 2. How the Dashboard Team Should Use It
The dashboard development team can reference each `.md` file in this folder to understand:
* What endpoints to call for lists, detail views, mutations, and status transitions.
* The expected structure of JSON request payloads and server responses.
* The required permissions/roles and validation rules for each input field.
* Critical business logic rules (e.g. VAT computation, daily cutoff times, and branch pickup limits).

## 3. Route Map vs. Ground Truth
* **`DASAHBOARD_SCREEN_AND_ROUTES_MAP.md`**: A frontend-only guide summarizing the React routing structure, TanStack Query hooks, and API routes currently fetched/referenced in the UI code. **It is not the source of truth.**
* **Backend Source of Truth**: The Express routers, Mongoose models, controllers, services, and associated integration tests in this repository represent the **final source of truth** for API signatures and data payloads.
* Mismatches between the UI route map and actual backend endpoints are documented in the overview contract as either `NEEDS_BACKEND_FIX` or `LEGACY_OR_UNCLEAR`.

## 4. Screen Status Classification
Every contract file in this pack is classified using one of the following 6 standardized status tags:
1. **`READY`**: Fully implemented, verified, and backed by comprehensive tests.
2. **`READY_WITH_LIMITATIONS`**: Implemented and functional, but has limited test coverage or specific business assumptions.
3. **`NEEDS_TESTS`**: Implemented, but lacks automated test validation.
4. **`NEEDS_BACKEND_FIX`**: Endpoint exists but has bugs or misses key capabilities required by the dashboard.
5. **`LEGACY_OR_UNCLEAR`**: Deprecated or legacy behavior.
6. **`OUT_OF_SCOPE`**: Intentionally excluded from the contract pack.

---

## 5. Critical Backend Rules
All dashboard consumers must adhere to the following core system design invariants enforced by the backend:

### A. VAT and Currency
* All monetary values are handled in **Halalas** (1/100 of Currency, e.g. 1 SAR = 100 Halalas).
* Pricing and VAT behavior must follow backend settings/accounting contracts only.

### B. Unified Branch Pickup & Partial Fulfillment
* **Unified Selection**: The single source of truth for items requested for pickup is the `selectedPickupItemIds` array (containing slots like `"slot_1"` or addons like `"addon_<addonId>_<unit>"`).
* **Fulfillment**: Fulfilling a pickup request consumes **only** the items specified in `selectedPickupItemIds`.
* **No Wallet Refund**: Unselected planned add-ons are **not** refunded to `addonBalance.remainingQty` upon fulfillment. They remain planned on the day and available for future pickup requests.
* **Premium Upgrades**: Premium upgrades are applied to existing meal slots and **never** create extra meal slots or increment the `totalMeals` count.

---

## 6. Running Contract Verification
To prove the correctness of these contracts, run the following automated test suites:
```bash
# Run the contract pack integration tests
NODE_ENV=test node tests/dashboardContracts.test.js

# Run the subscription audit dashboard tests
NODE_ENV=test node tests/subscriptionAuditDashboard.test.js

# Run core subscription rules and policies
npm run test:subscriptions
```
