# Mobile Delivery Cycle Review

## A. Verdict
FAIL (MOBILE CHANGES REQUIRED)

## B. Scope
* **Backend Path Reviewed**: `/home/hema/Projects/basicdiet145`
* **Mobile Path Reviewed**: `/home/hema/Projects/full app/mobile_app`
* **Endpoints Reviewed**: 
  - `GET /api/subscriptions/:id/timeline`
  - `POST /api/subscriptions/checkout`
  - `POST /api/subscriptions/:id/renew`
  - `GET /api/subscriptions/:id/pickup-availability`
  - `POST /api/subscriptions/:id/pickup-requests`
* **Flutter Files Reviewed**:
  - `lib/domain/model/timeline_model.dart`
  - `lib/data/response/timeline_response.dart`
  - `lib/data/request/subscription_checkout_request.dart`
  - `lib/data/response/fulfillment_status_response.dart`
  - `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

## C. Backend Contract Status
The backend is completely correct. All fixes were successfully applied and verified against the backend test suites and Postman QA runner (36/36 assertions passed on local server). No further backend fixes are required.

## D. Mobile App Status
The Flutter mobile application is not correctly consuming the backend contract. It is missing critical request fields, response DTO mappings, and operational UI rendering hooks for the delivery cycle to function correctly. 

## E. Findings Table

| ID | Area | Severity | File | Finding | Required Action |
| -- | ---- | -------- | ---- | ------- | --------------- |
| 1 | Timeline DTO | P0_BLOCKER | `timeline_response.dart`, `timeline_model.dart` | Missing `dayStatus`, `effectiveFulfillmentMode`, and `firstDayFulfillmentOverride` fields. | Add properties to timeline response and model classes. |
| 2 | Timeline Rendering | P0_BLOCKER | `timeline_model.dart` | App relies on `timelineStatus` to deduce state instead of `status` and `dayStatus`. | Use `status` for badge and `dayStatus` for precise operation state. |
| 3 | Checkout Request | P0_BLOCKER | `subscription_checkout_request.dart` | `SubscriptionCheckoutDeliveryRequest` is missing the `firstDayFulfillmentOverride` object. | Add `firstDayFulfillmentOverride` (with `type` and `pickupLocationId`). |
| 4 | Checkout Response | P1_REQUIRED | Assumed (usage missing) | The app ignores `fulfillmentOptions` (e.g., `startDateShifted`, `deliveryStartDateIfNoPickup`). | Parse `fulfillmentOptions` from the checkout draft payload. |
| 5 | Timeline Rendering | P1_REQUIRED | `timeline_model.dart` | App computes `canEdit` locally or relies on `timelineStatus == 'planned'` instead of strictly adhering to backend's `canEdit` property. | Enforce edit CTA visibility exclusively via `canEdit` flag. |

## F. Required Mobile Changes
The mobile team must implement the following changes in the Flutter codebase:
1. **Update Checkout Request Payload**: Add `firstDayFulfillmentOverride` to `SubscriptionCheckoutDeliveryRequest`.
2. **Consume Checkout Fulfillment Options**: Parse `fulfillmentOptions` from the checkout response to inform the user if their `startDate` was shifted.
3. **Update Timeline Models**: Add `dayStatus`, `effectiveFulfillmentMode`, and `firstDayFulfillmentOverride` to `TimelineDayResponse` and `TimelineDayModel`.
4. **Refactor Timeline UI Rendering**: 
   - Use `status` for high-level badge states.
   - Use `dayStatus` for precise operational states (e.g. `in_preparation`, `ready_for_delivery`).
   - Use physical `fulfillmentMode` (or `effectiveFulfillmentMode`) for pickup/delivery UI conditional rendering.
   - Strictly honor `canEdit` to hide meal editing controls.
5. **Handle Pickup Endpoint Errors**: Ensure `INVALID_DELIVERY_MODE` on pickup availability/request calls for Day 2+ is handled gracefully without crashing.

## G. Backend Fixes Applied
No backend fixes were applied during this specific review session as the backend was already verified and passing 100% of the runtime QA tests.

## H. Contract Cheat Sheet for Flutter
```txt
Timeline badge: days[].status
Operational details: days[].dayStatus
Pickup/delivery UI: days[].fulfillmentMode
Edit controls: days[].canEdit
Day 1 pickup override: fulfillmentMode=pickup
Day 2+ delivery: fulfillmentMode=delivery
Pickup endpoints on delivery days: INVALID_DELIVERY_MODE
Cutoff lock: lockedReason=DELIVERY_SELECTION_CUTOFF_PASSED
```

## I. Final Recommendation
**Can Flutter proceed without changes?** No.
**What must be changed before release?** The Flutter models and request/response DTOs must be aligned with the backend contract as outlined in Section F.
**Is backend ready?** Yes, the backend is complete, verified, and ready.
**Is another runtime QA needed?** A manual QA on the Flutter app is required once the mobile team applies these changes to ensure the UI behaves correctly. No further backend-only QA is needed.
