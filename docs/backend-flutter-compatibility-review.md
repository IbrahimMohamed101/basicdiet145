# Backend ↔ Flutter Compatibility Review

**Review Date:** 2026-07-04  
**Reviewer:** Antigravity (automated deep inspection)  
**Backend path:** `/home/hema/Projects/basicdiet145`  
**Flutter path:** `/home/hema/Projects/full app/mobile_app`

---

## A. Verdict

**PASS WITH RISKS**

Backend contracts are fully implemented. Flutter consumes the vast majority of contracts correctly. Three moderate-risk issues and several informational gaps were found — none are P0 blockers. No backend fixes were required. Flutter changes are documented but not applied (no explicit owner approval received).

---

## B. Scope

### Backend path
`/home/hema/Projects/basicdiet145`

### Flutter path
`/home/hema/Projects/full app/mobile_app`

### Endpoints reviewed
| Method | Endpoint |
|--------|----------|
| POST | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` |
| POST | `/api/subscriptions/checkout` |
| GET | `/api/subscriptions/checkout-drafts/:id` |
| POST | `/api/subscriptions/:id/renew` |
| GET | `/api/subscriptions/:id/renewal-seed` |
| GET | `/api/subscriptions/:id/timeline` |
| GET | `/api/subscriptions/:id/days/:date` |
| PUT | `/api/subscriptions/:id/days/:date/selection` |
| GET | `/api/subscriptions/:id/days/:date/fulfillment/status` |
| GET | `/api/subscriptions/:id/pickup-availability?date=` |
| POST | `/api/subscriptions/:id/pickup-requests` |
| GET | `/api/subscriptions/:id/pickup-requests` |
| GET | `/api/subscriptions/:id/pickup-requests/:requestId/status` |
| POST | `/api/subscriptions/:id/days/:date/payments` |
| POST | `/api/subscriptions/:id/days/:date/payments/:paymentId/verify` |
| POST | `/api/subscriptions/:id/days/:date/one-time-addons/payments` |

### Backend files reviewed
- `src/controllers/subscriptionController.js`
- `src/routes/subscriptions.js`
- `src/services/subscription/subscriptionTimelineService.js`
- `src/services/subscription/subscriptionDayFulfillmentStatusService.js`
- `src/services/subscription/subscriptionPickupRequestClientService.js`
- `src/services/subscription/subscriptionPickupSlotService.js`
- `src/services/subscription/subscriptionPickupPreparationPolicyService.js`
- `src/services/subscription/subscriptionDayModificationPolicyService.js`
- `src/services/subscription/subscriptionDayCommercialStateService.js`
- `src/services/subscription/subscriptionDeliveryUpdateService.js`

### Flutter files reviewed
- `lib/data/network/app_api.dart` + `.g.dart`
- `lib/data/network/dio_factory.dart`
- `lib/data/request/subscription_checkout_request.dart`
- `lib/data/request/pickup_request.dart`
- `lib/data/response/subscription_checkout_response.dart`
- `lib/data/response/timeline_response.dart`
- `lib/data/response/fulfillment_status_response.dart`
- `lib/data/response/pickup_request_response.dart`
- `lib/domain/model/timeline_model.dart`
- `lib/domain/model/fulfillment_status_model.dart`
- `lib/domain/model/pickup_preparation_enums.dart`
- `lib/presentation/plans/timeline/time_line_screen.dart`
- `lib/presentation/plans/fulfillment_status/fulfillment_status_cubit.dart`
- `lib/presentation/plans/widgets/fulfillment/delivery_fulfillment_card.dart`
- `lib/presentation/plans/widgets/fulfillment/pickup_fulfillment_card.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

### Commands run
```bash
# Auth / API base
grep -R "baseUrl|/api|Authorization|Bearer|auth/login|token" -n "/mobile_app/lib"

# Checkout
grep -R "SubscriptionCheckout|checkout|firstDayFulfillmentOverride|fulfillmentOptions|..." -n lib

# Renewal
grep -R "renew|Renewal|firstDayFulfillmentOverride|..." -n lib

# Timeline
grep -R "timeline|Timeline|dayStatus|statusLabel|canEdit|..." -n lib

# Fulfillment status
grep -R "fulfillment/status|FulfillmentStatus|effectiveFulfillmentMode|..." -n lib

# Pickup
grep -R "pickup-availability|pickup-requests|selectedPickupItemIds|..." -n lib

# Errors
grep -R "INVALID_DELIVERY_MODE|DAY_SKIPPED|LOCKED|DELIVERY_SELECTION_CUTOFF_PASSED|..." -n lib

# Backend contract field presence
grep -R "effectiveFulfillmentMode|fulfillmentModeOverride|firstDayFulfillmentOverride|..." src tests docs
grep -R "DELIVERY_SELECTION_CUTOFF_PASSED|PLANNING_UNCONFIRMED|PREMIUM_PAYMENT_REQUIRED|..." src
```

---

## C. Backend Contract Status

- **Backend ready:** ✅ YES
- **Backend fixes applied:** NO — no backend code was changed
- **Tests run:** NOT run during this review (no QA data required; review was static code inspection)

### Backend contract summary

| Contract | Status |
|----------|--------|
| `POST /api/subscriptions/checkout` returns `draftId`, `payment_url`, `totals`, `fulfillmentOptions` | ✅ Implemented |
| `fulfillmentOptions.*` (all sub-fields) | ✅ Implemented |
| `GET /api/subscriptions/:id/timeline` returns `days[].status`, `dayStatus`, `canEdit`, `fulfillmentMode`, `effectiveFulfillmentMode`, `lockedReason`, `lockedMessage` | ✅ Implemented |
| `GET /api/subscriptions/:id/days/:date/fulfillment/status` returns full fulfillment contract | ✅ Implemented |
| `DELIVERY_SELECTION_CUTOFF_PASSED` emitted by `subscriptionDayModificationPolicyService.js` | ✅ Confirmed |
| `INVALID_DELIVERY_MODE` thrown by `subscriptionPickupRequestClientService.js` on delivery days | ✅ Confirmed |
| `effectiveFulfillmentMode` used in fulfillment status service | ✅ Confirmed |
| `selectedPickupItemIds` supported in pickup requests | ✅ Confirmed |
| `POST /api/subscriptions/:id/renew` exists | ✅ Route registered (`router.post("/:id/renew", ...)`) |
| Premium items as `premiumItems[{premiumKey, qty}]` in checkout | ✅ Confirmed |
| `PREMIUM_PAYMENT_REQUIRED` error code | ✅ Emitted |
| `pollingIntervalSeconds` in fulfillment status | ✅ Emitted |
| `isTerminal` in fulfillment status | ✅ Emitted |
| `pickupCode` gated to `effectiveFulfillmentMode === "pickup" && status === "ready_for_pickup"` | ✅ Confirmed |

---

## D. Flutter Compatibility Status

- **Flutter compatible:** ✅ YES (with documented risks)
- **Flutter fixes required:** ⚠️ RECOMMENDED for P1/P2 items below
- **Risky areas:** Timeline badge source, renewal endpoint absence, `PLANNING_UNCONFIRMED` enum mismatch

---

## E. Compatibility Matrix

| Area | Backend Contract | Flutter Consumption | Status | Notes |
|------|-----------------|--------------------|----|------|
| Auth / base URL | `/api` prefix, Bearer token, refresh via `TOKEN_EXPIRED` | ✅ `DioFactory` auto-attaches `Bearer`, auto-refresh on 401+TOKEN_EXPIRED, `/api/*` used everywhere | ✅ PASS | |
| Checkout request | `planId`, `grams`, `mealsPerDay`, `startDate`, `delivery.*`, `firstDayFulfillmentOverride`, `premiumItems`, `addons`, `promoCode`, `idempotencyKey` | ✅ `SubscriptionCheckoutRequest` models all required fields including `firstDayFulfillmentOverride` | ✅ PASS | `slotId` vs `slot` both modelled |
| Checkout response | `draftId`, `payment_url` (snake_case), `totals`, `fulfillmentOptions.*` | ⚠️ Flutter maps `payment_url` → `paymentUrl` ✅. Maps `totals` not `breakdown` (backend calls it `totals`). `fulfillmentOptions` fully parsed. | ⚠️ PASS WITH NOTE | Backend field is `totals` in checkout draft status; Flutter `SubscriptionCheckoutTotalsResponse` field names differ from `pricingSummary` sub-fields (INFO) |
| Renewal endpoint | `POST /api/subscriptions/:id/renew` | ❌ **NOT CALLED** — no Retrofit method for `/api/subscriptions/{id}/renew` exists in `app_api.dart` | ❌ **P1 MISSING** | Flutter has no renewal flow wired |
| Timeline `days[].status` | Badge/card status source of truth | ✅ `time_line_screen.dart:194` switches on `day.normalizedStatus` (maps to `days[].status`) | ✅ PASS | |
| Timeline `days[].dayStatus` | Operational detail (in_preparation, out_for_delivery…) | ✅ Field parsed in `TimelineDayResponse` and propagated to `TimelineDayModel.dayStatus` | ⚠️ PASS WITH RISK | **Not rendered in timeline card UI** — `time_line_screen.dart` never displays `dayStatus` in the card body. Only `status` drives the displayed label. In-prep/out-for-delivery distinction is invisible to the user from the timeline view. |
| Timeline `days[].canEdit` | Gate for edit controls | ✅ `_isReadOnlyDay()` returns `!day.canEdit`; `readOnly` propagated to planner | ✅ PASS | |
| Timeline `days[].fulfillmentMode` | Pickup vs delivery UI | ✅ Field parsed in `TimelineDayResponse.fulfillmentMode` and `TimelineDayModel.fulfillmentMode` | ✅ PASS | |
| Timeline `days[].effectiveFulfillmentMode` | Canonical fulfillment mode (overrides) | ✅ Parsed in `TimelineDayResponse.effectiveFulfillmentMode` | ✅ PASS | |
| Timeline `days[].firstDayFulfillmentOverride` | Day-1 pickup override flag | ✅ Parsed as `bool?` in both response and model | ✅ PASS | |
| Timeline `days[].lockedReason` / `lockedMessage` | Backend lock messaging | ✅ Parsed in `TimelineDayResponse` and model | ✅ PASS | Rendering from `delivery_fulfillment_card.dart` uses `fulfillmentSummary.lockedMessage` and `fulfillmentDay.lockedMessage` with fallbacks |
| Timeline `days[].mealSlots` | Slot data for meal planner | ✅ `List<TimelineMealSlotResponse>` fully parsed with normalization | ✅ PASS | |
| `timelineStatus` field | Backend legacy field | ⚠️ Flutter model stores it and uses it in `showPlanned`/`showDraft`/`displayStatus` logic | ⚠️ **P2 RISK** | `displayStatus` is primarily `timelineStatus`-driven. If backend removes `timelineStatus`, display logic may regress. However `normalizedStatus` (from `status`) is used as final fallback. |
| Fulfillment status contract | All fields in spec | ✅ `FulfillmentStatusDataResponse` maps all required fields. `effectiveFulfillmentMode` read via `_readFulfillmentMode` using `effectiveFulfillmentMode ?? fulfillmentMode` priority. | ✅ PASS | |
| Fulfillment status polling | `pollingIntervalSeconds`, `isTerminal` | ✅ `FulfillmentStatusCubit` uses `data.pollingIntervalSeconds` to set timer; stops on `data.isTerminal` | ✅ PASS | |
| Pickup availability | `GET /api/subscriptions/:id/pickup-availability?date=` | ✅ Called with `date` query param | ✅ PASS | |
| Pickup availability `pickupItems` | Item-based pickup flow | ✅ `PickupAvailabilityDataResponse.pickupItems` parsed as `List<PickupAvailabilityItemResponse>` | ✅ PASS | |
| Pickup request creation | Prefers `selectedPickupItemIds` | ✅ `CreatePickupRequest` models `selectedPickupItemIds`, `selectedMealSlotIds`, `mealCount` as separate nullable fields | ✅ PASS | Correct priority must be enforced at call-site |
| Pickup request status | `pickupCode` gating | ⚠️ `PickupRequestDataResponse.pickupCode` parsed but **not explicitly gated to `status == "ready_for_pickup"`** in the model layer | ⚠️ P2 | Gating should happen in presentation; needs confirmation |
| Pickup requests polling | Terminal states stop polling | ✅ Pickup cubit handles terminal check via `isCompleted`/`isReady` flags | ✅ PASS | |
| Delivery cutoff | `DELIVERY_SELECTION_CUTOFF_PASSED` → `canEdit=false` | ✅ Flutter respects `canEdit` from backend; `lockedReason` is parsed. Meal planner bloc handles `DELIVERY_SELECTION_CUTOFF_PASSED`/`DAY_LOCKED_BEFORE_DELIVERY` error codes | ✅ PASS | |
| Chef Choice / locked slots | Read-only after cutoff | ✅ `canEdit=false` drives `readOnly` flag in planner | ✅ PASS | |
| Meal selection | `mealSlots`, `selectedMealIds`, `premiumItems`, `addons` | ✅ `day_selection_request.dart` separates premium and addon payloads | ✅ PASS | |
| Add-ons | Not mixed with premium or meal slot IDs | ✅ `CreatePickupRequest` has separate `selectedPickupItemIds` field | ✅ PASS | |
| Premium upgrades | `premiumItems[{premiumKey, qty}]` | ✅ `SubscriptionCheckoutPremiumItemRequest` sends `{premiumKey, qty}` | ✅ PASS | |
| Premium balance | `premiumMealsRemaining` in timeline | ✅ `TimelineDataResponse.premiumMealsRemaining` parsed and passed to planner | ✅ PASS | |
| `addonBalances` | Overview response | ✅ `CurrentSubscriptionOverviewResponse.addonBalances` parsed | ✅ PASS | |
| Error codes | `INVALID_DELIVERY_MODE`, `INSUFFICIENT_CREDITS`, `SUB_INACTIVE`, `SUB_EXPIRED`, `PREMIUM_PAYMENT_REQUIRED`, `DAY_SKIPPED`, `LOCKED` | ✅ All handled in `meal_planner_bloc.dart` | ✅ PASS | |
| `PLANNING_UNCONFIRMED` error code | Backend emits `PLANNING_UNCONFIRMED` | ⚠️ Flutter `PickupBlockedReason` enum maps `PLANNER_UNCONFIRMED` but NOT `PLANNING_UNCONFIRMED` | ⚠️ **P1 RISK** | Backend may emit either depending on code path. Flutter will fall to `unknown` for `PLANNING_UNCONFIRMED` |
| Operational states mapping | `in_preparation`, `out_for_delivery` → `dayStatus` | ✅ Fields parsed. Pickup preparation view uses `PickupDayStatus` from pickup status endpoint | ⚠️ P2 | Timeline card UI only shows `status` label, not `dayStatus` progress text |

---

## F. Findings

| ID | Area | Severity | Project | File | Finding | Required Action |
|----|------|----------|---------|------|---------|-----------------|
| F-01 | Renewal | **P1_REQUIRED** | Flutter | `lib/data/network/app_api.dart` | **Renewal endpoint is not wired.** `POST /api/subscriptions/:id/renew` has no Retrofit method. The backend route is registered at `router.post("/:id/renew", ...)`. There is a `renewal-seed` endpoint also without a Flutter call. | Add `@GET("/api/subscriptions/{id}/renewal-seed")` and `@POST("/api/subscriptions/{id}/renew")` Retrofit methods with appropriate request/response types. |
| F-02 | Error handling | **P1_REQUIRED** | Flutter | `lib/domain/model/pickup_preparation_enums.dart:63` | **`PLANNING_UNCONFIRMED` not mapped.** Flutter maps `PLANNER_UNCONFIRMED` → `plannerUnconfirmed` but backend's canonical pickup preparation policy can emit `PLANNING_UNCONFIRMED` as a separate code path (see `subscriptionPickupPreparationPolicyService.js:13,47`). Flutter will fall through to `unknown`. | Add `'PLANNING_UNCONFIRMED' => PickupBlockedReason.plannerUnconfirmed,` in the `fromString` switch. |
| F-03 | Timeline UI | **P2_RECOMMENDED** | Flutter | `lib/presentation/plans/timeline/time_line_screen.dart:194-294` | **`dayStatus` not rendered in timeline card.** The timeline card switch uses only `day.normalizedStatus` to pick label and color. Active states like `in_preparation`, `ready_for_delivery`, `out_for_delivery` map to `status=locked`, so they all show as "Locked" with identical styling. Customers cannot distinguish operational progress from the timeline. | Add sub-label text below the status label using `day.dayStatus` when `day.status == 'locked'`. Display backend `statusLabel` if available as the primary human-readable string. |
| F-04 | Timeline | **P2_RECOMMENDED** | Flutter | `lib/domain/model/timeline_model.dart:149-170` | **`displayStatus` is `timelineStatus`-primary.** The model derives `displayStatus` primarily from `timelineStatus` (a legacy/auxiliary field). If backend deprecates `timelineStatus`, the UI will fall back to raw `status`. This is acceptable today but creates fragility. | Refactor `displayStatus` to use `status` as primary source and `timelineStatus` only as a supplement for `planned`/`draft`/`pending_payment` sub-states, with explicit fallback to `status`. |
| F-05 | Checkout response | **P2_RECOMMENDED** | Flutter | `lib/data/response/subscription_checkout_response.dart:32` | **`totals` field name vs backend `breakdown`.** The checkout draft status payload at `buildSubscriptionCheckoutStatusPayload()` emits `totals: draft.breakdown`. Flutter maps `@JsonKey(name: 'totals')` correctly to receive it. However the `pricingSummary` sub-fields (with richer breakdown) are **not** parsed by Flutter. Pricing display is limited. | INFO only — `totals` mapping is correct. Optionally parse `pricingSummary` fields for richer pricing display. |
| F-06 | Pickup code | **P2_RECOMMENDED** | Flutter | Pickup presentation layer | **`pickupCode` display gating.** The DTO parses `pickupCode` correctly. Backend only emits it when `status === "ready_for_pickup"`. However, the presentation-layer gating must be verified at call-site that `pickupCode` is only shown when pickup status is `ready_for_pickup`. | Confirm pickup code UI is gated behind `status == 'ready_for_pickup'` check in the pickup preparation view. |
| F-07 | Fulfillment | **INFO** | Flutter | `lib/presentation/plans/fulfillment_status/fulfillment_status_cubit.dart:74-75` | **Fallback polling interval hardcoded to 60s.** On failure, the cubit falls back to a 60-second polling interval. This is acceptable but not driven by `pollingIntervalSeconds`. | Acceptable. Document as known behavior. |
| F-08 | Auth | **INFO** | Flutter | `lib/data/network/dio_factory.dart:98` | **Refresh token gated to `TOKEN_EXPIRED` code only.** Other 401 causes (e.g. `INVALID_TOKEN`, `SESSION_REVOKED`) will not trigger refresh, falling to error. | Confirm backend always emits `TOKEN_EXPIRED` for expired tokens. This is consistent with current backend behavior. |
| F-09 | Checkout | **INFO** | Flutter | `lib/data/request/subscription_checkout_request.dart:79` | **`slotId` field present alongside `slot` object.** Flutter checkout request has both `slotId: String?` and `slot: SubscriptionCheckoutSlotRequest?`. Backend may accept either, but redundancy should be clarified. | Confirm with backend which field is canonical for slot selection and deprecate the other. |

---

## G. Backend Fixes Applied

**None.** No backend code was modified during this review. All backend contracts are correctly implemented.

---

## H. Required Flutter Changes

### H-1 · Renewal endpoint (P1)
**File:** `lib/data/network/app_api.dart`  
**Missing:** Two Retrofit method declarations.

```dart
// Renewal seed (pre-fill renewal form with prior subscription config)
@GET("/api/subscriptions/{id}/renewal-seed")
Future<SubscriptionRenewalSeedResponse> getSubscriptionRenewalSeed(
  @Path("id") String id,
);

// Renewal checkout (same payload shape as checkout: delivery, premiumItems, addons, idempotencyKey)
@POST("/api/subscriptions/{id}/renew")
Future<SubscriptionCheckoutResponse> renewSubscription(
  @Path("id") String id,
  @Body() SubscriptionCheckoutRequest request,
);
```

Also required: DTO `SubscriptionRenewalSeedResponse` that parses the renewal seed payload (plan details, prior delivery config including `firstDayFulfillmentOverride`).

**Critical rule to enforce at call-site:** Renewal must preserve `delivery.firstDayFulfillmentOverride` from the renewal seed or user selection. Never strip it before sending.

---

### H-2 · `PLANNING_UNCONFIRMED` enum mapping (P1)
**File:** `lib/domain/model/pickup_preparation_enums.dart`  
**Line:** after line 63

```dart
// Existing:
'PLANNER_UNCONFIRMED' => PickupBlockedReason.plannerUnconfirmed,
// Add:
'PLANNING_UNCONFIRMED' => PickupBlockedReason.plannerUnconfirmed,
```

---

### H-3 · Timeline card dayStatus sub-label (P2)
**File:** `lib/presentation/plans/timeline/time_line_screen.dart`  
**After line 381** (the main `statusText` label), add a sub-label when status is `locked` and `dayStatus` is informative:

```dart
// Inside _buildDayItem, after the statusText Text widget:
if (day.status == 'locked' && day.dayStatus.isNotEmpty) ...[
  Gap(AppSize.s2.h),
  Text(
    day.statusLabel.isNotEmpty ? day.statusLabel : day.dayStatus,
    style: getRegularTextStyle(
      color: ColorManager.textMuted,
      fontSize: FontSizeManager.s12.sp,
    ),
  ),
],
```

---

## I. Contract Cheat Sheet

```
Timeline badge (card color/label):     days[].status
Operational sub-detail (in-prep etc):  days[].dayStatus
Pickup vs delivery UI decision:        days[].fulfillmentMode
  (overridden by):                     days[].effectiveFulfillmentMode
Edit controls gate:                    days[].canEdit == true
Day 1 pickup override flag:            days[].firstDayFulfillmentOverride == true
Day 1 fulfillment mode:                days[].fulfillmentMode == 'pickup'
Day 2+ normal delivery:                days[].fulfillmentMode == 'delivery'
Delivery-only today:                   starts next service day (resolvedStartDate > today)
Lock after cutoff:                     days[].lockedReason == 'DELIVERY_SELECTION_CUTOFF_PASSED'
Lock message to display:               days[].lockedMessage (backend-provided, localized)
Pickup endpoint on delivery days:      Returns INVALID_DELIVERY_MODE (handle gracefully)
Fulfillment polling source:            pollingIntervalSeconds (not a fixed client timer)
Stop polling:                          isTerminal == true
Show pickupCode:                       status == 'ready_for_pickup' only
Pickup request preferred payload:      selectedPickupItemIds[itemId1, itemId2, ...]
Add-ons in pickup:                     Send add-on itemIds inside selectedPickupItemIds (NOT selectedMealSlotIds)
Premium upgrades payload:              premiumItems[{premiumKey, qty}]
Premium upgrades NOT as:               add-ons, meal slot IDs, or raw config IDs
Checkout totals field:                 totals (snake: breakdown field name in draft)
Checkout paymentUrl field:             payment_url (snake_case JSON key)
Renewal endpoint:                      POST /api/subscriptions/:id/renew
Renewal seed:                          GET /api/subscriptions/:id/renewal-seed
```

---

## J. Final Recommendation

### Can Flutter proceed to QA?
**Yes, with the following conditions:**

1. **P1-F01 (Renewal):** The renewal flow is missing entirely in Flutter networking. If renewal UX is in scope for the current QA cycle, the Retrofit methods and renewal DTO must be added before QA.
2. **P1-F02 (`PLANNING_UNCONFIRMED`):** One-line fix to add the missing enum mapping. Should be applied before QA to avoid silent `unknown` errors on pickup planning failures.

### Can backend be considered complete?
**Yes.** All backend contracts are implemented, including:
- Checkout with `fulfillmentOptions` and `firstDayFulfillmentOverride`
- Timeline with `dayStatus`, `canEdit`, `effectiveFulfillmentMode`, `lockedReason/Message`
- Fulfillment status with `pollingIntervalSeconds`, `isTerminal`, `effectiveFulfillmentMode`
- Pickup availability with `pickupItems` (item-based flow)
- `DELIVERY_SELECTION_CUTOFF_PASSED` in timeline service
- `INVALID_DELIVERY_MODE` for pickup requests on delivery days
- `PREMIUM_PAYMENT_REQUIRED` in pickup and day payment flows

### Are any changes required before release?
| Item | Blocking? | Owner |
|------|-----------|-------|
| F-01: Renewal endpoint missing in Flutter | Yes — if renewal is in release scope | Flutter team |
| F-02: `PLANNING_UNCONFIRMED` enum | Yes — safe 1-line change | Flutter team |
| F-03: `dayStatus` sub-label in timeline card | No — UX improvement | Flutter team |
| F-04: `displayStatus` refactor | No — risk mitigation | Flutter team |

### Is runtime QA needed?
**Yes, recommended** for:
- Day-1 pickup + Day-2 delivery scenario end-to-end
- Cutoff lock rendering in timeline (`in_preparation` / `out_for_delivery` badge)
- Pickup code visibility gate (confirm only shows at `ready_for_pickup`)
- Renewal flow (once implemented in Flutter)

### What should be tested manually?
1. Subscribe today with `firstDayFulfillmentOverride.type=pickup` → confirm Day 1 shows pickup mode, Day 2+ shows delivery mode
2. Subscribe today delivery-only → confirm `resolvedStartDate` is next service day
3. Let delivery cutoff pass → confirm timeline day shows locked with `lockedMessage` (not just generic "Locked")
4. Trigger `in_preparation` → confirm timeline shows more than just "Locked" label (requires F-03 fix)
5. Pickup on a delivery day → confirm `INVALID_DELIVERY_MODE` is shown gracefully
6. `PLANNING_UNCONFIRMED` pickup block → confirm friendly UI (requires F-02 fix)
7. Premium upgrade checkout → confirm `premiumItems[{premiumKey, qty}]` sent correctly
8. Add-on subscription checkout → confirm add-on IDs in `addons[]`, not in `premiumItems`

---

> **Note on Flutter analyze:** Static analysis was not run as part of this review (no Flutter toolchain available in the review environment). The findings above are based on code inspection only. Running `flutter analyze` on the mobile_app is recommended to catch any additional type mismatches.

> **No secrets, credentials, JWT values, DB URLs, or `.env` content were read or exposed during this review.**
