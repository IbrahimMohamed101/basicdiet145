# Timeline Status Consistency Review

## A. Verdict
**PASS**

## B. Root cause
Under specific circumstances—such as a day being in the past (`date < businessDate`), the subscription being inactive, or the day's planner state being operationally confirmed—the backend correctly evaluated `canEdit = false`, meaning the day was unmodifiable. However, it still mapped the generic timeline status as `status="open"`. 

Simultaneously, a bug in the Flutter frontend (`MealPlannerDateSelector`) mapped the top timeline chip using `day.normalizedStatus` (which looks directly at the `status` field) instead of the calculated `day.displayStatus`. This resulted in the top chip incorrectly rendering as `"مفتوح / Open"`. However, the add-ons section in the same view correctly read the `canEdit` boolean flag (`isReadOnly` / `canChangeAddons`) and displayed the locked message (`"هذا اليوم مقفل، ولا يمكن تعديل الإضافات الآن."`), creating a direct visual contradiction.

## C. Backend fix
**Modified File:** `src/services/subscription/subscriptionTimelineService.js` (around line 660).
**Logic Changed:** Added a synchronization guard inside `buildSubscriptionTimeline`. If a day's `resolvedStatus === "open"` but `!planningContract.canEdit`, the backend forcefully coerces both `resolvedStatus` and `resolvedDayStatus` to `"locked"`. A default `cutoffLockedReason` (`"LOCKED_FOR_EDITING"`) and message (`"هذا اليوم مقفل"`) are also injected if not already present by the cutoff logic. This ensures contradictory payloads are never dispatched to the frontend.

## D. Flutter
* Flutter was **not modified**.
* Flutter still strictly relies on its internal day status display logic (`normalizedStatus` in the date selector). Since the backend now structurally guarantees an uneditable "open" day is sent as `status: "locked"`, the Flutter frontend gracefully handles it and now consistently renders the chip as "Locked" (مقفل), effectively masking the frontend bug.
* **UX Recommendation (Report-Only):** The Flutter codebase team should still ideally refactor `MealPlannerDateSelector` (in `lib/presentation/plans/timeline/meal_planner/widgets/meal_planner_date_selector.dart`) to use `day.displayStatus` instead of `day.normalizedStatus`. This ensures proper badge visibility for other states (e.g., `planned`, `draft`, `pending_payment`) across all views.

## E. Tests
Run commands:
```bash
node tests/deliverySelectionCutoffContract.test.js
NODE_ENV=test node tests/firstDayFulfillmentOverride.test.js
NODE_ENV=test node tests/dashboardContracts.test.js
NODE_ENV=test node tests/operationsDeliveryFlowContract.test.js
```

**Results:**
* `deliverySelectionCutoffContract.test.js`: Passed 20/20. (Added Test 15 to explicitly test the `status=open` and `canEdit=false` contradiction fix).
* `firstDayFulfillmentOverride.test.js`: Passed 8/8.
* `dashboardContracts.test.js`: Passed.
* `operationsDeliveryFlowContract.test.js`: Passed.

No operational states or delivery queues were impacted.

## F. State mapping
| Case | Expected | Status |
| :--- | :--- | :--- |
| `status=open`, `canEdit=true` | remains `open` | **PASS** |
| `status=open`, `canEdit=false` | becomes `locked` or clearly read-only with locked reason | **PASS** |
| `status=locked`, `dayStatus=locked` | remains locked | **PASS** |
| `status=locked`, `dayStatus=in_preparation` | remains locked + in_preparation | **PASS** |
| `status=locked`, `dayStatus=ready_for_delivery` | remains locked + ready_for_delivery | **PASS** |
| `status=locked`, `dayStatus=out_for_delivery` | remains locked + out_for_delivery | **PASS** |
| `status=locked`, `dayStatus=ready_for_pickup` | remains locked + ready_for_pickup | **PASS** |
| `status=delivered`, `dayStatus=fulfilled` | remains delivered + fulfilled | **PASS** |
| `status=delivery_canceled`, `dayStatus=delivery_canceled`| remains delivery_canceled | **PASS** |
| `status=skipped` | remains skipped | **PASS** |
| `status=frozen` | remains frozen | **PASS** |
| `status=pending_payment` | remains pending_payment | **PASS** |
| `status=draft` | remains draft | **PASS** |

## G. Final recommendation
* **Backend ready:** Yes
* **Flutter changes required now:** No (The timeline contradiction is mitigated by the backend enforcing strict `status` rules).
* **Timeline contradiction fixed:** Yes
* **Can proceed to QA:** Yes
