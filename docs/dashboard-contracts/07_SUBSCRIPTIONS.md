# Screen Contract: 07_SUBSCRIPTIONS

## 1. Screen Purpose
Provides a detailed view and lifecycle management for client subscriptions. Allows operators to view subscription details, audit wallet invariants, inspect activity timelines, update delivery/pickup default configurations, and adjust addon entitlement allocations.

## 2. Dashboard Route
`/subscriptions`

## 3. Visible UI Requirements
* Search bar (matching client name, phone, or subscription ID).
* Filter bar: Status (Active, Expired, Canceled, Pending Payment).
* Subscriptions summary count cards.
* Subscription detail page:
  * Client profile card.
  * Plan details (Days, meals/day, carb/protein selection).
  * Main balance card (Remaining meals, remaining addons, freeze balance).
  * Subscription days grid (Date, Status e.g. planned/skipped/frozen/fulfilled, delivery mode, meal choices).
  * Addon Entitlements card with limits.
  * Audit panel: mathematical balance validator checks.
  * Lifecycle log: chronological timeline of requests and actions.
  * Edit configurations: edit default delivery zone, window, address, or branch pickup location.

## 4. Backend Endpoints
* `GET /api/dashboard/subscriptions` (lists and filters subscriptions)
* `GET /api/dashboard/subscriptions/summary` (provides status aggregation summary)
* `GET /api/dashboard/subscriptions/:id` (subscription details)
* `GET /api/dashboard/subscriptions/:id/days` (lists subscription days)
* `PUT /api/dashboard/subscriptions/:id/delivery` (updates default delivery/pickup configurations)
* `GET /api/dashboard/subscriptions/:id/addon-entitlements` (gets addon limits)
* `PATCH /api/dashboard/subscriptions/:id/addon-entitlements` (updates addon limits)
* `GET /api/dashboard/subscriptions/:id/audit` (invariant mathematical audit)
* `GET /api/dashboard/subscriptions/:id/lifecycle` (chronological activity log)

## 5. Request Parameters
* List Query:
  * `q` (optional, string)
  * `status` (optional, string)
  * `page` (optional, default 1)
  * `limit` (optional, default 10)
* Audit/Lifecycle:
  * `id` (path, string, ObjectId)

## 6. Response Fields Required
* `status` (boolean): `true` if succeeded.
* `data.audit` (returned by GET `/api/dashboard/subscriptions/:id/audit`):
  * `invariants` (object):
    * `addonsBalanceValid` (boolean): `purchasedQty == remainingQty + usedQty`
    * `noAddonDoubleConsumption` (boolean)
    * `noFulfillmentDoubleConsumption` (boolean)
  * `addonEntitlements.itemAddons` (array of objects):
    * `addonId`, `purchasedQty`, `remainingQty`, `usedQty`, `pickedQty`, `deliveredQty`, `remainingPlannedQty`
  * `auditStatus` (string): `ok`, `warning`, or `error`.
* `data.events` (returned by GET `/api/dashboard/subscriptions/:id/lifecycle`):
  * Array of chronological events.

## 7. Field Dictionary
* `remainingPlannedQty`: Addons planned on subscription days but not yet picked or delivered (`usedQty - pickedQty - deliveredQty`).
* `remainingQty`: Unplanned addon wallet balance.

## 8. Classification
`SUBSCRIPTION_CRITICAL`

## 9. Frontend Restrictions
* **No Balance Calculation**: The frontend must never calculate remaining meals, planned addons, or invalid indicators locally. It must display `remainingPlannedQty`, `remainingQty`, and `invariants` flags directly from the backend.
* **No UI State Transitions**: Any update to subscription days must be made via operations or dedicated adjustment endpoints.

## 10. Backend Acceptance Criteria
* `remainingQty` remains `0` after fulfillment of partial pickup requests (unpicked planned addons are not refunded).
* Audit endpoint correctly computes `pickedQty` from fulfilled pickup requests' `selectedPickupItemIds`.
* `remainingPlannedQty = usedQty - pickedQty - deliveredQty` is always correct.

## Subscription-Critical Invariant Rules
> **These rules are canonical and enforced by the backend. The dashboard must display these values verbatim without recalculation.**

1. **Add-ons are independent entitlements** — They are never counted as base meal slots (`mealSlots[]`). A subscription day with 1 meal slot and 4 add-on selections has exactly 1 meal slot.
2. **Premium upgrades do not create extra meals** — A premium upgrade (`selectionType: "premium_meal"`) upgrades an existing meal slot. It does not add a new slot to `mealSlots[]` or increase `totalMeals`.
3. **`selectedMealSlotIds` must never contain add-ons** — Only slot keys (e.g. `"slot_1"`) belong in this field. Add-on item IDs (e.g. `"addon_<id>_1"`) belong only in `selectedPickupItemIds`.
4. **`selectedPickupItemIds` is the unified pickup item selection field** — It is the single source of truth for what the customer has selected for a given pickup request.
5. **Fulfillment consumes only `selectedPickupItemIds`** — Unselected planned add-ons remain untouched in `day.addonSelections` and available for a future pickup request.
6. **Picked add-ons must not reappear** — After a pickup request is fulfilled, the add-ons in that request's `selectedPickupItemIds` are hidden from future availability responses.
7. **Unpicked planned add-ons remain planned** — `day.addonSelections` is not pruned by fulfillment or cancellation. Only the `selectedPickupItemIds` of the fulfilled/cancelled request controls what is consumed/released.
8. **Flutter remains untouched** — The Flutter client uses the `/api/subscriptions/` mobile endpoints, not these dashboard endpoints. No Flutter changes are needed.

## Verified Partial Pickup Scenario
> See full documentation: [SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md](file:///home/hema/Projects/basicdiet145/docs/SUBSCRIPTION_BACKEND_PARTIAL_PICKUP_VERIFICATION.md)

**Scenario tested and verified (test #18 in `dashboardContracts.test.js`):**
1. Subscription day has 4 planned add-ons + 1 meal slot.
2. Customer creates a pickup request selecting 2 add-ons + 1 meal slot.
3. After pickup request is created: future availability returns exactly 2 add-ons (the unselected ones).
4. The 2 picked add-ons do not reappear in availability.
5. After fulfillment: `addonBalance[].remainingQty` stays `0` (no wallet refund).
6. Audit confirms: `pickedQty: 2`, `remainingPlannedQty: 2`, `addonsBalanceValid: true`.

## 11. Contract Tests Required
* List endpoint returns results.
* Audit endpoint calculates correct balance invariants and reports `addonsBalanceValid: true`.
* Confirm premium upgrades do not create extra meals, and addon selections reject slots.

## 12. Known Risks
* Invariant errors can block client operations if the backend is out of sync. Use `/audit` to verify system health.

## 13. Status
`READY`
