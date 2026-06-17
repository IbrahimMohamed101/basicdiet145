# Subscription Backend — Partial Pickup Verification

**Phase:** Subscription Domain Stabilization  
**Date:** 2026-06-17  
**Status:** ✅ VERIFIED — All invariants pass, 13/13 audit tests pass, full regression suite passes.

---

## 1. The Original Bug

### Scenario That Exposed the Bug

| Step | State |
|------|-------|
| Day planned | 4 add-on items + 1 meal slot |
| Customer creates pickup request | Selects 2 add-ons + 1 meal slot |
| Pickup request fulfilled | — |
| Future availability call (same day) | ❌ Showed 0 or 4 add-ons instead of 2 |

### Root Cause

In a previous implementation pass, `fulfillmentService.js` was modified to "release" unselected planned add-ons back to the subscription wallet balance upon fulfillment of a pickup request. The intent was to prevent balance leakage, but the effect was wrong:

- Unselected planned add-ons were **pruned from `day.addonSelections`** and **refunded to `addonBalance.remainingQty`**.
- This removed the planned items from the day entirely, so no future pickup for the same day could see them.
- Additionally, the refund incorrectly inflated `remainingQty`, which broke the `purchasedQty = remainingQty + usedQty` invariant.

Similarly, in `opsTransitionService.js`, the cancellation handler was modified to prune planned add-ons from `day.addonSelections` and refund them — also incorrect, as cancellation should only release the meal-slot reservations and leave the day's planning intact.

---

## 2. The Corrected Business Rule

### Fulfillment

> **Fulfillment consumes only `selectedPickupItemIds`.**

- Items listed in `selectedPickupItemIds` are marked as fulfilled/consumed.
- All other planned items on the day remain unchanged in `day.addonSelections`.
- No add-ons are refunded to `addonBalance.remainingQty` at fulfillment time.
- No add-ons are pruned from `day.addonSelections` at fulfillment time.

### Cancellation

> **Cancellation releases only the meal-slot reservations of the cancelled request.**

- The existing `releaseReservedPickupMeals` call restores meal counts in the subscription balance.
- `day.addonSelections` is **not mutated** by cancellation.
- Planned add-ons that were part of the cancelled request's `selectedPickupItemIds` automatically become available again because the blocking pickup request no longer exists (status `canceled`).

### Availability Filtering (unchanged, correct)

The `getPickupAvailabilityForClient` service already correctly filters:

- Items whose `itemId` appears in an **active (non-cancelled) pickup request's `selectedPickupItemIds`** → marked `reserved`.
- Items whose `itemId` appears in a **fulfilled pickup request's `selectedPickupItemIds`** → marked `fulfilled` / hidden.
- All other planned items remain `available`.

This means **no changes to availability logic were needed** — the fix was purely removing the incorrect pruning in fulfillment and cancellation.

### Summary Table

| Lifecycle Event | Meal Slots | Add-on Balance (`remainingQty`) | Day's `addonSelections` |
|---|---|---|---|
| Pickup request created | Reserved (deducted from `remainingMeals`) | Unchanged | Unchanged |
| Pickup request fulfilled | Consumed | **Unchanged** ✅ | **Unchanged** ✅ |
| Pickup request cancelled | Released (restored to `remainingMeals`) | **Unchanged** ✅ | **Unchanged** ✅ |

---

## 3. Endpoints Involved

### `GET /api/subscriptions/:subscriptionId/days/:date/pickup-availability`

Returns the list of items available for pickup on a given day.

**Key fields:**
- `summary.availableAddonCount` — count of add-ons available for selection
- `summary.reservedCount` — count reserved by an active pickup request
- `summary.fulfilledCount` — count already fulfilled (hidden from future requests)
- `dayAddons[]` — each add-on with `availability.state` = `available | reserved | fulfilled`
- `pickupItems[]` — flat list of all selectable pickup items

### `POST /api/subscriptions/:subscriptionId/pickup-requests`

Creates a pickup request for the customer, selecting a subset of available items.

**Key fields in response:**
- `selectedPickupItemIds[]` — exact items reserved in this request (e.g. `addon_<addonId>_<index>`, `slot_<slotKey>`)
- `mealCount` — number of meal slots selected

### `GET /api/dashboard/subscriptions/:subscriptionId/audit`

Read-only invariant audit of the full subscription state.

**Key fields in `addonEntitlements.itemAddons[]`:**
```jsonc
{
  "addonId": "<id>",
  "purchasedQty": 4,    // Total purchased in the wallet
  "remainingQty": 0,    // Remaining wallet balance (0 = all planned on days)
  "usedQty": 4,         // Total planned on day selections
  "pickedQty": 2,       // Picked/consumed via fulfilled pickup requests
  "deliveredQty": 0,    // Consumed via home delivery (delivery mode only)
  "remainingPlannedQty": 2,  // Planned but not yet picked/delivered
  "isValid": true
}
```

**Invariant flags in `invariants`:**
```jsonc
{
  "addonsBalanceValid": true,           // purchasedQty == remainingQty + usedQty
  "noAddonDoubleConsumption": true,     // No addon exceeds purchasedQty
  "noFulfillmentDoubleConsumption": true
}
```

### `GET /api/dashboard/subscriptions/:subscriptionId/lifecycle`

Returns a chronological timeline of subscription events (creation, plan changes, pickup requests, fulfillments). Relevant for auditing which pickup requests were fulfilled and in what order.

---

## 4. Files Changed

### Core Logic

| File | Change |
|------|--------|
| `src/services/fulfillmentService.js` | **Removed** the block that refunded/pruned unselected planned add-ons on fulfillment. Fulfillment now only sets `pickupRequest.status = "fulfilled"` and calls `consumeReservedPickupMeals`. |
| `src/services/dashboard/opsTransitionService.js` | **Removed** the block that refunded/pruned selected add-ons from `day.addonSelections` on cancellation. Cancellation now only calls `releaseReservedPickupMeals`. |

### Audit Controller

| File | Change |
|------|--------|
| `src/controllers/dashboard/subscriptionAuditController.js` | **Refactored** add-on audit calculation to derive `pickedQty` from fulfilled pickup requests' `selectedPickupItemIds` (not from day fulfillment status). Added `remainingPlannedQty = usedQty - pickedQty - deliveredQty`. Fixed variable scoping: `prsActive` and `fulfilledPRs` are now defined once at the top of the function. `pickedAddonsCount` in pickupFulfillment section now counts only add-on item IDs from the request, not all day add-ons. |

### Tests

| File | Change |
|------|--------|
| `tests/subscriptionAuditDashboard.test.js` | **Updated** the 4-addon regression test to assert the corrected behavior: wallet `remainingQty` stays `0` after fulfillment; post-fulfillment availability returns exactly 2 add-ons; picked add-ons do not reappear; audit reports `pickedQty: 2`, `remainingPlannedQty: 2`, `addonsBalanceValid: true`. |

### Previously Exported Helpers (from prior session, unchanged)

| File | Export Added |
|------|-------------|
| `src/services/subscription/subscriptionPickupSlotService.js` | `expandDayAddonPickupItems` |
| `src/services/subscription/subscriptionSelectionService.js` | `consumeAddonBalanceAtomically`, `releaseAddonBalanceAtomically` |

> **Note:** These exports remain in place but are no longer called from `fulfillmentService.js` or `opsTransitionService.js` for the unselected-addon use case. They may still be used by other flows (e.g. intentional full-day add-on release by an operator).

---

## 5. Final Verified JSON Summary

### Before Pickup

```json
{
  "summary": {
    "availableAddonCount": 4,
    "availableMealSlotCount": 1,
    "availableCount": 5,
    "canCreatePickupRequest": true
  },
  "dayAddons": [
    { "itemId": "addon_<id>_1", "availability": { "state": "available" } },
    { "itemId": "addon_<id>_2", "availability": { "state": "available" } },
    { "itemId": "addon_<id>_3", "availability": { "state": "available" } },
    { "itemId": "addon_<id>_4", "availability": { "state": "available" } }
  ]
}
```

### After Picking 2 Add-ons (Request Created)

```json
{
  "selectedPickupItemIds": [
    "addon_<id>_1",
    "addon_<id>_2",
    "slot_1"
  ],
  "mealCount": 1,
  "status": "locked",
  "creditsReserved": true
}
```

Add-ons `_1` and `_2` are reserved (blocked from appearing in a second concurrent request). Add-ons `_3` and `_4` remain available.

### After Fulfillment — Audit Response

```json
{
  "addonEntitlements": {
    "itemAddons": [
      {
        "addonId": "<id>",
        "purchasedQty": 4,
        "remainingQty": 0,
        "usedQty": 4,
        "pickedQty": 2,
        "deliveredQty": 0,
        "remainingPlannedQty": 2,
        "isValid": true
      }
    ],
    "reappearedAfterFulfillment": false
  },
  "pickupFulfillment": {
    "totalPickupRequests": 1,
    "fulfilledPickupRequests": 1,
    "pickedMealSlotsCount": 1,
    "pickedAddonsCount": 2
  },
  "invariants": {
    "baseMealsCountValid": true,
    "addonsBalanceValid": true,
    "noAddonDoubleConsumption": true,
    "noFulfillmentDoubleConsumption": true
  },
  "warnings": [],
  "auditStatus": "ok"
}
```

### After Fulfillment — Pickup Availability (Same Day)

```json
{
  "summary": {
    "availableAddonCount": 2,
    "availableMealSlotCount": 0,
    "availableCount": 2,
    "hiddenUnavailableCount": 3,
    "canCreatePickupRequest": true
  },
  "dayAddons": [
    { "itemId": "addon_<id>_3", "availability": { "state": "available", "available": true } },
    { "itemId": "addon_<id>_4", "availability": { "state": "available", "available": true } }
  ]
}
```

> **Confirmed:**
> - `addon_<id>_1` and `addon_<id>_2` do **not** appear.
> - `addon_<id>_3` and `addon_<id>_4` appear as `available`.
> - No duplicates.
> - No wallet refund occurred.

---

## 6. Tests Run

### Primary Audit & Lifecycle Suite

```bash
MONGO_URI="$MONGO_URI" node tests/subscriptionAuditDashboard.test.js
```

**Result: 13/13 passed, 0 failed**

```
✅ GET /api/dashboard/subscriptions/:id/audit returns 404 for non-existent subscription
✅ GET /api/dashboard/subscriptions/:id/audit returns 403 for forbidden roles
✅ GET /api/dashboard/subscriptions/:id/audit compiles clean audit state for active pickup sub
✅ GET /api/dashboard/subscriptions/:id/lifecycle compiles chronological timeline of events
✅ Test: premium upgrades cannot exceed meal slots
✅ Test: premium does not create extra meals
✅ Test: add-ons are not counted as meal slots
✅ Test: partially picked add-ons reduce future availability
✅ Test: delivered add-ons reduce future availability
✅ Test: selectedMealSlotIds rejects add-ons
✅ Test: selectedPickupItemIds supports meal slot items and add-on items
✅ Test: kitchen queue contains exact selected fulfillment items
✅ Test: 4 add-ons available -> pickup 2 add-ons -> future availability must return only 2 add-ons

RESULTS: 13 passed, 0 failed
```

### Subscription Balance, Day Modification, and Concurrency Regression Suite

```bash
MONGO_URI="$MONGO_URI" npm run test:subscriptions
```

Which runs in sequence:
1. `tests/subscriptionBalancePolicy.test.js`
2. `tests/subscriptionDayModificationPolicy.test.js`
3. `tests/subscriptionFulfillmentConcurrency.test.js`

**Result: All passed**

```
All subscription balance policy automated tests passed perfectly.
subscriptionDayModificationPolicy.test.js: 12/12 checks passed
subscriptionFulfillmentConcurrency.test.js passed

Exit code: 0
```

---

## 7. Remaining Risks

### 7a. Pickup Mode Only — Delivery Mode Not Re-verified

This session's changes and verifications were performed exclusively against `deliveryMode: "pickup"` subscriptions. The delivery path (`deliveryMode: "delivery"`) uses a different fulfillment flow (delivery documents, not pickup requests) and was not re-run end-to-end in this session.

**Risk:** Low. The delivery audit path is separate (`deliveryFulfillment` section in the audit controller) and was not modified. However, the add-on audit calculation now branches on `subscription.deliveryMode`, so a full delivery flow re-run should be included in the next regression cycle.

**Mitigation:** The existing test `Test: delivered add-ons reduce future availability` covers this path and passed ✅.

### 7b. Dashboard UI Integration Not Started

The backend subscription audit and lifecycle endpoints are complete and verified. The **dashboard UI** (React/Next.js dashboard) has not been integrated to consume:

- `GET /api/dashboard/subscriptions/:id/audit`
- `GET /api/dashboard/subscriptions/:id/lifecycle`

The `addonEntitlements.itemAddons[].remainingPlannedQty` field is new and not yet surfaced in any UI component. **This is a pending integration task.**

### 7c. One-Time Order Flow — Not Touched, Not Re-Verified

All changes in this session were scoped to the subscription domain. One-time order creation, fulfillment, and payment flows were **not modified**. No one-time order tests were run.

**Risk:** Negligible. No shared services were modified in a way that would affect one-time orders. `fulfillmentService.js` changes were guarded by `if (pickupRequest.subscriptionDayId)` logic which is specific to subscription pickup requests.

---

## 8. Next Recommended Dashboard Integration Steps

When the dashboard UI integration begins:

1. **Addon Entitlements Panel** — Consume `addonEntitlements.itemAddons[]` to display per-addon:
   - Total purchased (`purchasedQty`)
   - Total planned on day selections (`usedQty`)
   - Already picked (`pickedQty`)
   - Remaining available for pickup (`remainingPlannedQty`)
   - Wallet balance remaining (`remainingQty`)

2. **Invariant Badge** — Display `auditStatus` (`ok` / `warning` / `error`) as a health indicator on the subscription detail card.

3. **Warnings List** — Surface `warnings[]` as expandable alerts for ops staff.

4. **Lifecycle Timeline** — Use `GET .../lifecycle` response `events[]` to render a chronological activity log on the subscription detail page.

5. **Flutter Client** — No changes required. The pickup availability response contract is unchanged. The `availableAddonCount` field in `summary` and the `dayAddons[]` items are the only fields the Flutter client needs to show remaining pickups.

---

*This document was produced as part of the Subscription Domain Stabilization phase. Do not modify without re-running the full test suite.*
