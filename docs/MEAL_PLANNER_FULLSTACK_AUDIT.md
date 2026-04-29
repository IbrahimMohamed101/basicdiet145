# Meal Planner Full-Stack Audit

## Executive Summary

The backend has a mostly coherent canonical Meal Planner contract centered on `builderCatalog`, canonical `mealSlots`, server-derived `paymentRequirement`, separate premium and add-on payment flows, and explicit day commercial state. The Flutter implementation is only partially aligned with that contract.

The highest-risk gaps are not cosmetic. The Flutter app still builds and parses several legacy planner shapes:

- write payloads still use `carbId` instead of canonical `carbs[]`
- premium salad still uses `custom_premium_salad` and `customSalad` instead of `premium_large_salad` and `salad.groups`
- premium meal requests are often sent with legacy `standard_combo`, which can fail backend validation for premium proteins
- timeline and day parsing still assume older read models and ignore important backend state such as `commercialState`, `paymentRequirement.blockingReason`, canonical `carbs[]`, and canonical `salad`
- the UI treats `planned` days as read-only even though the backend’s actual editability rules depend on fulfillment mode, same-day timing, and lock policy

Overall risk is high for production planner correctness. Standard meals can appear to work in simple cases, but premium meals, premium large salad, sandwich handling, add-on entitlement/payment, confirm flow, and stale-state refresh behavior are all vulnerable to incorrect UI behavior or invalid backend requests.

## Backend Contract Summary

### Canonical menu endpoint

Endpoint:

- `GET /api/subscriptions/meal-planner-menu`

Actual backend source:

- `src/controllers/menuController.js`
- `src/services/subscription/mealPlannerCatalogService.js`
- `src/config/mealPlannerContract.js`

Canonical response:

- top-level: `status`, `data`
- `data.builderCatalog` is the source of truth
- `data.addonCatalog` is the canonical add-on source of truth
- legacy `regularMeals`, `premiumMeals`, and `addons` are returned only when `includeLegacy=true`

`builderCatalog` currently includes:

- `categories`
- `proteins`
- `premiumProteins`
- `carbs`
- `sandwiches`
- `premiumLargeSalad`
- `rules`

`addonCatalog` currently includes:

- `items`
- `byCategory`
- `totalCount`

Important canonical facts:

- protein planner types are split by `proteins` and `premiumProteins`
- sandwiches come from `builderCatalog.sandwiches`, not from proteins
- premium salad comes from `builderCatalog.premiumLargeSalad`, not `customPremiumSalad`
- planner rules are backend-defined and include beef and carb constraints

### Day read endpoint

Endpoint:

- `GET /api/subscriptions/:id/days/:date`

Actual backend source:

- `src/controllers/subscriptionController.js#getSubscriptionDay`
- `src/services/subscription/subscriptionClientSupportService.js#shapeMealPlannerReadFields`
- `src/services/subscription/subscriptionDayCommercialStateService.js`

Actual response shape includes:

- `status`
- `data.date`
- `data.status`
- `data.plannerState`
- `data.planningState` as legacy mirror
- `data.mealSlots`
- `data.addonSelections`
- `data.plannerMeta`
- `data.planning`
- `data.plannerRevisionHash`
- `data.premiumSummary`
- `data.premiumExtraPayment`
- `data.paymentRequirement`
- `data.commercialState`
- `data.isFulfillable`
- `data.canBePrepared`
- `data.rules`

Canonical `mealSlots[]` read fields include:

- `slotIndex`
- `slotKey`
- `status`
- `selectionType`
- `proteinId`
- `carbs`
- `sandwichId`
- `salad`
- `isPremium`
- `premiumKey`
- `premiumSource`
- `premiumExtraFeeHalala`

Important compatibility behavior:

- backend still mirrors some legacy planner fields for older clients
- backend still normalizes legacy `carbId` to `carbs[]`
- backend still accepts legacy `customSalad` as input alias, but canonical read/write shape is `salad`

### Timeline endpoint

Endpoint:

- `GET /api/subscriptions/:id/timeline`

Actual backend source:

- `src/controllers/subscriptionController.js#getSubscriptionTimeline`
- `src/services/subscription/subscriptionTimelineService.js`
- `src/utils/subscription/subscriptionReadLocalization.js#localizeTimelineReadPayload`

Actual response includes:

- `status`
- `data.subscriptionId`
- `data.dailyMealsRequired`
- `data.premiumMealsRemaining`
- `data.premiumMealsSelected`
- `data.premiumBalanceBreakdown`
- `data.days[]`

Important `days[]` fields:

- `date`
- `day`
- `month`
- `dayNumber`
- `status`
- `statusLabel`
- `selectedMeals`
- `requiredMeals`
- `commercialState`
- `commercialStateLabel`
- `isFulfillable`
- `canBePrepared`
- `paymentRequirement`
- `fulfillmentMode`
- `consumptionState`
- `planningReady`
- `fulfillmentReady`
- `selectedMealIds`
- `mealSlots`

Key semantics:

- `status` is timeline display state such as `open`, `planned`, `locked`, `delivered`, `frozen`, `skipped`, `extension`
- `commercialState` is backend planner/payment state such as `draft`, `payment_required`, `ready_to_confirm`, `confirmed`
- the backend does not use timeline `status` alone to decide whether the day is editable

### Save day selection

Endpoint:

- `PUT /api/subscriptions/:id/days/:date/selection`

Actual backend source:

- `src/controllers/subscriptionController.js#updateDaySelection`
- `src/services/subscription/subscriptionPlanningClientService.js#updateDaySelectionForClient`
- `src/services/subscription/subscriptionSelectionService.js#performDaySelectionUpdate`
- `src/services/subscription/mealSlotPlannerService.js#buildMealSlotDraft`

Canonical request:

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "proteinId": "protein_id",
      "carbs": [
        { "carbId": "carb_id", "grams": 150 }
      ]
    }
  ],
  "addonsOneTime": ["addon_id"]
}
```

Canonical rules:

- `mealSlots` is required
- legacy `selections` and `premiumSelections` are no longer supported as write payload
- legacy `oneTimeAddonSelections` is still accepted as an alias for `addonsOneTime`
- day must be modifiable according to same-day policy
- day must still be `open`
- confirmed planner days are rejected

Canonical meal rules:

- `standard_meal`: regular protein + `carbs[]`
- `premium_meal`: premium protein + `carbs[]`
- `sandwich`: `sandwichId` only
- `premium_large_salad`: `salad.groups.protein` exactly one, `salad.groups.sauce` exactly one, no carbs, no sandwich

Validation and save errors observed in code:

- `400 INVALID`
- `400 INVALID_ONE_TIME_ADDON_SELECTION`
- `400 ONE_TIME_ADDON_CATEGORY_CONFLICT`
- `400 INVALID_DATE`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 LOCKED`
- `409 DATA_INTEGRITY_ERROR`
- `422 LEGACY_DAY_SELECTION_UNSUPPORTED`
- `422 INVALID_MEAL_PLAN`
- `422 BEEF_LIMIT_EXCEEDED`
- `422 DAY_OUT_OF_SUBSCRIPTION_RANGE`
- `422 SUB_EXPIRED`
- `400 DAY_LOCKED_BEFORE_DELIVERY`
- `400 DELIVERY_TIME_UNAVAILABLE`

Save response:

- returns full shaped day payload, not just success

### Validate day selection

Endpoint:

- `POST /api/subscriptions/:id/days/:date/selection/validate`

Actual backend source:

- `src/controllers/subscriptionController.js#validateDaySelection`
- `src/services/subscription/subscriptionPlanningClientService.js#validateDaySelectionForClient`
- `src/services/subscription/subscriptionSelectionService.js#performDaySelectionValidation`

Request:

- same canonical request shape as save

Actual response:

- wrapped as `{ status: true, data: ... }`
- `data.valid`
- `data.mealSlots`
- `data.plannerMeta`
- `data.addonSelections`
- `data.plannerRevisionHash`
- `data.premiumSummary`
- `data.premiumExtraPayment`
- `data.paymentRequirement`
- `data.commercialState`
- `data.isFulfillable`
- `data.canBePrepared`
- `data.rules`

Important note:

- this is not a flat top-level `{ valid, mealSlots, ... }` payload

### Confirm day endpoint

Endpoint:

- `POST /api/subscriptions/:id/days/:date/confirm`

Actual backend source:

- `src/controllers/subscriptionController.js#confirmDayPlanning`
- `src/services/subscription/subscriptionPlanningClientService.js#confirmDayPlanningForClient`
- `src/services/subscription/subscriptionSelectionService.js#performDayPlanningConfirmation`

Actual behavior:

- reconfirms planner validity from stored `mealSlots`
- blocks if planner incomplete
- blocks if premium payment pending
- blocks if add-on payment pending
- blocks if day locked or already confirmed

Observed confirm blocker codes:

- `PLANNING_INCOMPLETE`
- `PREMIUM_PAYMENT_REQUIRED`
- `ADDON_PAYMENT_REQUIRED`
- `PAYMENT_REQUIRED`
- `LOCKED`
- `DAY_ALREADY_CONFIRMED`

Actual response shape:

- `{ status: true, success: true, plannerState, data }`
- `data` is a full shaped day payload

### Add-on payment endpoints

Endpoints:

- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/verify`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify`

Actual backend source:

- `src/services/subscription/oneTimeAddonDayPlanningPaymentService.js`

Create payment behavior:

- allowed only when day is modifiable
- requires actual pending add-ons with `source = pending_payment`
- create response returns:
  - `payment_url`
  - `invoice_id`
  - `payment_id`
  - `totalHalala`

Verify behavior:

- accepts either path param `paymentId` or latest payment lookup through `/verify`
- verifies provider invoice
- applies payment side effects
- returns payment status payload including:
  - `addonSelections`
  - `pendingCount`
  - `paymentStatus`
  - `applied`
  - `isFinal`
  - `payment`
  - `providerInvoice`

Observed add-on payment errors:

- `NOT_FOUND`
- `FORBIDDEN`
- `NO_PENDING_ONE_TIME_ADDONS`
- `ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED`
- `CHECKOUT_IN_PROGRESS`
- `MISMATCH`
- `PAYMENT_PROVIDER_ERROR`

### Premium payment endpoints

Current exposed canonical premium day payment endpoints:

- `POST /api/subscriptions/:id/days/:date/premium-extra/payments`
- `POST /api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`

Actual backend source:

- `src/services/subscription/premiumExtraDayPaymentService.js`

Create payment behavior:

- day must be modifiable
- day must be `open`
- premium payment must actually be required
- uses current `plannerRevisionHash`
- response includes:
  - `paymentId`
  - `payment_id`
  - `payment_url`
  - `providerInvoiceId`
  - `invoice_id`
  - `amountHalala`
  - `totalHalala`
  - `currency`
  - `reused`
  - `plannerRevisionHash`
  - `premiumExtraPayment`
  - `premiumSummary`
  - `paymentRequirement`
  - `commercialState`

Verify behavior:

- verifies provider invoice
- settles premium slots from `pending_payment` to `paid_extra`
- can fail with revision mismatch if planner changed after payment creation
- returns payload including:
  - `plannerRevisionHash`
  - `premiumSummary`
  - `premiumExtraPayment`
  - `paymentRequirement`
  - `commercialState`
  - `paymentStatus`
  - `applied`
  - `isFinal`
  - `payment`
  - `providerInvoice`

Observed premium payment errors:

- `PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED`
- `PREMIUM_EXTRA_ALREADY_PAID`
- `PREMIUM_EXTRA_PAYMENT_REUSE_INVALID`
- `PREMIUM_EXTRA_REVISION_MISMATCH`
- `NO_PENDING_PREMIUM_EXTRA`
- `LOCKED`
- `MISMATCH`
- `CHECKOUT_IN_PROGRESS`

### Premium overage payment endpoint status

Backend code contains:

- `createPremiumOverageDayPaymentFlow`
- `verifyPremiumOverageDayPaymentFlow`

But no active route is registered in `src/routes/subscriptions.js`.

This looks like dormant or partially retired backend functionality rather than current exposed planner API.

### Bulk selection endpoint

Endpoint:

- `PUT /api/subscriptions/:id/days/selections/bulk`

Actual backend source:

- `src/controllers/subscriptionController.js#updateBulkDaySelections`
- `src/services/subscription/subscriptionSelectionClientService.js#updateBulkDaySelectionsForClient`

Accepted request shapes:

- `{ dates, mealSlots, addonsOneTime? }`
- `{ days: [{ date, mealSlots, addonsOneTime? }] }`

Legacy bulk payloads without canonical `mealSlots` are rejected.

### Same-day modification policy

Actual backend source:

- `src/services/subscription/subscriptionDayModificationPolicyService.js`
- `tests/subscriptionDayModificationPolicy.test.js`

Current rules:

- future day: editable
- same-day pickup: editable
- same-day delivery: editable only until one hour before delivery time
- after lock threshold: `DAY_LOCKED_BEFORE_DELIVERY`
- if delivery window is missing for same-day delivery: `DELIVERY_TIME_UNAVAILABLE`

## Frontend Implementation Summary

Main Flutter implementation areas:

- API layer: `lib/data/network/app_api.dart`
- requests: `lib/data/request/day_selection_request.dart`
- menu parsing: `lib/data/response/meal_planner_menu_response.dart`, `lib/data/mappers/meal_planner_menu_mapper.dart`
- day parsing: `lib/data/response/subscription_day_response.dart`, `lib/data/mappers/subscription_day_mapper.dart`
- timeline parsing: `lib/data/response/timeline_response.dart`, `lib/data/mappers/timeline_mapper.dart`
- planner state and orchestration: `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`, `meal_planner_state.dart`
- planner UI: `meal_planner_screen.dart`, `meal_planner_bottom_action.dart`, `protein_picker_sheet.dart`, `custom_premium_meal_builder_screen.dart`, `daily_addon_selection_card.dart`, `addon_selection_bottom_sheet.dart`

Current Flutter design pattern:

- load timeline
- open planner screen with timeline-derived draft state
- fetch selected day detail
- locally maintain slot and add-on draft state
- save day via `PUT /selection`
- if local/frontend thinks payment is needed, create payment
- open WebView
- verify payment
- refresh current day
- auto-confirm day

The main problem is that the Flutter planner still carries a legacy mental model:

- one carb per meal through `carbId`
- premium salad represented as `custom_premium_salad` plus flat ingredient groups
- sandwich inferred from protein category instead of menu sandwich catalog
- premium pending payment derived locally from selected proteins
- planner editability derived from timeline `status`, not backend policy and commercial state

## Critical Issues

| ID | Area | Severity | Backend expected | Frontend current behavior | Impact | Recommended fix | Files involved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Save payload | Critical | Plate meals must send `carbs: [{ carbId, grams }]` | Flutter sends single `carbId` only | Canonical standard/premium meal saves can fail or be silently normalized incorrectly | Replace `carbId` request model with canonical `carbs[]` builder | `lib/data/request/day_selection_request.dart`, `meal_planner_bloc.dart` |
| C2 | Premium meal write | Critical | Premium protein slot must use `selectionType = premium_meal` | Flutter often sends legacy `standard_combo` even for premium proteins | Premium protein saves can fail with invalid protein type | Build selection type from actual slot type, not legacy default | `meal_planner_state.dart`, `meal_planner_bloc.dart` |
| C3 | Premium salad write | Critical | `selectionType = premium_large_salad` and `salad.groups.*` | Flutter sends `custom_premium_salad`, `customSalad`, and `carbId` | Premium large salad flow is not aligned with current backend contract | Implement canonical salad request object and remove identity carb from write payload | `day_selection_request.dart`, `custom_premium_meal_builder_screen.dart`, `meal_planner_bloc.dart` |
| C4 | Premium salad menu parsing | Critical | Menu exposes `builderCatalog.premiumLargeSalad` | Flutter expects `builderCatalog.customPremiumSalad` | Premium large salad config can fail to load entirely | Parse `premiumLargeSalad` and rename domain model accordingly | `meal_planner_menu_response.dart`, `meal_planner_menu_mapper.dart`, `meal_planner_menu_model.dart` |
| C5 | Sandwich support | Critical | Sandwich options come from `builderCatalog.sandwiches` | Flutter has no sandwich catalog parsing and guesses sandwich from protein category | Sandwich UI can never be correct against backend catalog | Add canonical sandwich model and use `sandwichId` from menu catalog | `meal_planner_menu_response.dart`, `meal_planner_menu_model.dart`, `protein_picker_sheet.dart`, `meal_planner_bloc.dart` |
| C6 | Day read parsing | Critical | Day payload uses canonical `carbs[]` and `salad` | Flutter reads only `carbId` and `customSalad` | Saved backend state is partially dropped when reloaded | Parse `carbs[]`, `salad`, premium metadata, and canonical slot types | `subscription_day_response.dart`, `subscription_day_mapper.dart`, `subscription_day_model.dart` |
| C7 | Timeline parsing and UI gating | Critical | Timeline day includes `commercialState`, `paymentRequirement`, canonical `mealSlots` | Flutter ignores most of these fields and treats `planned` as read-only | Users can be blocked from editing valid days or shown stale workflow state | Update timeline models and gate UI using backend commercial state and modifiable-day reload | `timeline_response.dart`, `timeline_mapper.dart`, `timeline_model.dart`, `time_line_screen.dart` |
| C8 | Payment orchestration | Critical | Use backend `paymentRequirement.blockingReason` to choose correct payment CTA | Flutter computes pending premium/add-on state locally and chains payment flows heuristically | Wrong CTA and wrong payment order are possible | Drive payment CTA from backend `paymentRequirement` only | `meal_planner_state.dart`, `meal_planner_bloc.dart`, `meal_planner_bottom_action.dart` |
| C9 | Confirm flow refresh | High | After save/verify/confirm, frontend should replace local day with backend state | Flutter ignores confirm response payload and does not refresh after confirm before pop | UI can show stale planner or stale blockers | Parse confirm response into day model or immediately refetch day before closing | `app_api.dart`, `repository.dart`, `meal_planner_bloc.dart` |
| C10 | Same-day edit lock UX | High | Delivery same-day lock returns `DAY_LOCKED_BEFORE_DELIVERY` with user-meaningful details | Flutter uses timeline status for editability and collapses lock handling into generic `DAY_LOCKED` snackbars | Users get poor UX and misleading lock reasons | Surface backend policy errors directly and stop inferring editability from timeline status | `meal_planner_state.dart`, `meal_planner_screen.dart`, `time_line_screen.dart` |

## Backend Issues

### 1. Contract documentation is more canonical than some live compatibility behavior

The backend still supports legacy compatibility fields in several places:

- `slot.carbId` is normalized into canonical `carbs[]`
- `slot.customSalad` is normalized into canonical `salad`
- request `oneTimeAddonSelections` is still accepted as alias for `addonsOneTime`

This is helpful operationally, but it also makes the real contract ambiguous for clients unless frontend teams strictly follow canonical docs.

Files:

- `src/services/subscription/mealSlotPlannerService.js`
- `src/services/subscription/subscriptionPlanningClientService.js`
- `src/utils/subscription/subscriptionReadLocalization.js`

### 2. OpenAPI coverage is incomplete or stale for planner write/read responses

Examples:

- confirm endpoint docs do not reflect actual `{ success, plannerState, data }` payload
- validate endpoint docs do not show actual wrapped `data` payload
- timeline docs are much thinner than the actual response

Impact:

- external consumers can build incorrect parsers even when backend behavior is correct

Files:

- `src/routes/subscriptions.js`

### 3. Premium overage payment service exists without active route exposure

There is backend code for premium overage create/verify, but no route registration in current subscriptions router.

Impact:

- dead or half-retired flow increases maintenance risk and can confuse frontend teams reviewing backend code

Files:

- `src/controllers/subscriptionController.js`
- `src/services/subscription/premiumOverageDayPaymentService.js`
- `src/routes/subscriptions.js`

## Frontend Issues

### 1. Canonical plate-meal carb split is not implemented

Flutter still models one carb per slot:

- request uses `carbId`
- response uses `carbId`
- state uses `carbId`
- UI exposes a single carb picker

This is incompatible with backend canonical `carbs[]`, split quantities, and total gram rules.

Files:

- `lib/data/request/day_selection_request.dart`
- `lib/data/response/subscription_day_response.dart`
- `lib/domain/model/subscription_day_model.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/carb_picker_sheet.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

### 2. Premium meal selection type is built incorrectly

Default slot type is legacy `standard_combo`, and protein selection keeps using that type for non-sandwich selections.

Because backend only upgrades legacy `standard_combo` to `premium_meal` when `slot.isPremium` is already present in the request, premium protein selections can reach the backend as `standard_meal` and fail validation.

Files:

- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

### 3. Premium large salad implementation is still legacy

Flutter currently:

- expects `customPremiumSalad`
- sends `custom_premium_salad`
- sends `customSalad`
- sends `carbId` identity carb
- models groups as `vegetables`, `addons`, `fruits`, `nuts`, `sauce`
- only allows premium proteins in the salad builder

Backend expects:

- `premiumLargeSalad`
- `selectionType = premium_large_salad`
- `salad.groups.leafy_greens`
- `salad.groups.vegetables`
- `salad.groups.protein`
- `salad.groups.cheese_nuts`
- `salad.groups.fruits`
- `salad.groups.sauce`
- salad protein may be regular or premium
- no carbs in request

Files:

- `lib/data/response/meal_planner_menu_response.dart`
- `lib/data/request/day_selection_request.dart`
- `lib/data/response/subscription_day_response.dart`
- `lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart`

### 4. Sandwich flow is effectively unsupported

Backend provides canonical sandwich options in `builderCatalog.sandwiches`, but Flutter does not parse them and instead tries to infer sandwich behavior from a protein category key containing `sandwich`.

Files:

- `lib/data/response/meal_planner_menu_response.dart`
- `lib/domain/model/meal_planner_menu_model.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`
- `lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart`

### 5. Timeline contract is materially outdated in Flutter

Flutter timeline models ignore:

- `commercialState`
- `paymentRequirement`
- `selectedMealIds`
- canonical `mealSlots` details
- fulfillment mode and payment blockers

The UI then uses only old `status` and count fields to decide clickability and read-only behavior.

Files:

- `lib/data/response/timeline_response.dart`
- `lib/data/mappers/timeline_mapper.dart`
- `lib/domain/model/timeline_model.dart`
- `lib/presentation/plans/timeline/time_line_screen.dart`

### 6. Add-on UI hardcodes categories

Category order is hardcoded as:

- `juice`
- `snack`
- `small_salad`

Backend `addonCatalog.byCategory` is dynamic, and Flutter is not using it directly.

Impact:

- new backend categories can render poorly or be partially hidden

Files:

- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/addon_selection_bottom_sheet.dart`

### 7. Validate endpoint integration exists but is not used in planner flow

The app defines:

- `validateDaySelection` API
- validation response model
- validation use case

But planner orchestration does not use it before save/payment/confirm.

Impact:

- weaker UX
- avoids backend-provided dry-run payment state and slot error details

Files:

- `lib/data/network/app_api.dart`
- `lib/data/response/validation_response.dart`
- `lib/domain/usecase/validate_day_selection_usecase.dart`
- planner flow code does not call it in `meal_planner_bloc.dart`

## Contract Mismatches

### Menu mismatches

- Backend canonical field is `data.addonCatalog`; Flutter reads it indirectly into `addons`, which is acceptable.
- Backend canonical field is `builderCatalog.premiumLargeSalad`; Flutter expects `builderCatalog.customPremiumSalad`.
- Backend canonical field is `builderCatalog.sandwiches`; Flutter does not parse sandwiches at all.
- Backend `builderCatalog.rules` includes more than beef, but Flutter domain model only keeps beef.

### Day read mismatches

- Backend returns `mealSlots[].carbs`; Flutter reads `mealSlots[].carbId`.
- Backend returns `mealSlots[].salad`; Flutter reads `mealSlots[].customSalad`.
- Backend returns `mealSlots[].premiumKey`, `premiumExtraFeeHalala`, canonical premium metadata; Flutter drops some of this.
- Backend returns `commercialState`, `premiumExtraPayment`, `rules`; Flutter day model does not represent them.

### Timeline mismatches

- Backend returns `commercialState`; Flutter timeline model ignores it.
- Backend returns `paymentRequirement`; Flutter timeline model ignores it.
- Backend returns canonical `mealSlots[]` with `selectionType`, `carbs`, `salad`, `sandwichId`; Flutter timeline slot model only keeps `slotIndex`, `proteinId`, `carbId`.
- Backend returns `selectedMealIds`; Flutter expects `selections` and `premiumSelections`.

### Write payload mismatches

- Backend expects `carbs[]`; Flutter sends `carbId`.
- Backend expects `salad`; Flutter sends `customSalad`.
- Backend expects `premium_large_salad`; Flutter sends `custom_premium_salad`.
- Backend expects `standard_meal` and `premium_meal`; Flutter defaults to `standard_combo`.
- Backend expects `sandwichId` from sandwich catalog; Flutter guesses sandwich via protein category.

### Validate response mismatch

- Backend returns `{ status: true, data: { valid, ... } }`
- Flutter `ValidationResponse` expects flat top-level `valid`, `mealSlots`, `plannerMeta`, `paymentRequirement`

### Confirm response mismatch

- Backend returns full confirmed day payload in `data`
- Flutter treats confirm as generic `BaseResponse` and discards returned day state

## Payment Flow Issues

### Add-on payments

- Backend correctly distinguishes add-on blockers via `paymentRequirement.blockingReason = addons_pending_payment`.
- Flutter derives add-on pending state locally from entitlement heuristics instead of trusting backend as source of truth.
- Flutter create-add-on-payment flow is only triggered after save and only if frontend believes add-ons are pending.
- Flutter verify-add-on response model captures only `paymentStatus`, `message`, `applied`, `isFinal`, even though backend returns richer payment/day data.

Files:

- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`
- `lib/data/response/premium_payment_response.dart`

### Premium payments

- Backend premium flow is revision-hash aware and tied to actual premium pending slots.
- Flutter computes premium pending count locally from premium selections and generic credit logic.
- If Flutter local premium inference diverges from backend `paymentRequirement`, the app can present the wrong CTA or wrong pending amount.

Files:

- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart`

### Verify flow

- Backend verify endpoints already return status payloads.
- Flutter always performs a follow-up `GET /days/:date`, which is acceptable, but it still does not parse the richer verify payload.
- Add-on verify uses `/payments/verify` with body `{ paymentId }`; backend supports it, but the app does not use the simpler `/:paymentId/verify` route.

### Confirm flow

- Backend confirm is a separate step and returns updated day payload.
- Flutter auto-confirms immediately after save if it thinks no payment is pending.
- Flutter does not replace local day state using the confirm response.
- Timeline refresh only happens after navigator pop, not before local planner state is finalized.

### Stale state after payment

- Flutter refreshes the day after verify, which is good.
- Flutter does not refresh timeline until the screen closes.
- `TimeLineScreen` still marks `planned` as read-only, so even a refreshed timeline can still drive the wrong UX if the planner is actually editable.

## Add-On Flow Issues

Backend expectation:

- add-on items come from `addonCatalog.items`
- save using `addonsOneTime`
- backend assigns `source = subscription`, `pending_payment`, or `paid`
- add-on payment is required only when backend says so

Flutter issues:

- local entitlement math can override backend status in `addonSelectionStatusFor`
- category handling is UI-hardcoded instead of catalog-driven
- add-on state is partially driven by current overview entitlements instead of always by the day payload

Files:

- `lib/data/mappers/meal_planner_menu_mapper.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/daily_addon_selection_card.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/addon_selection_bottom_sheet.dart`

## Premium Meal Flow Issues

Backend expectation:

- premium plate meal uses `selectionType = premium_meal`
- premium balance consumption and pending payment are backend-derived
- confirm is blocked by backend when premium pending payment remains

Flutter issues:

- premium meals are often still written as legacy `standard_combo`
- premium coverage is recomputed locally from overview summaries
- fallback generic credit logic is used when `premiumSummaries` is empty

Files:

- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`
- `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`

## Premium Large Salad Flow Issues

Backend expectation:

- menu field: `builderCatalog.premiumLargeSalad`
- write field: `selectionType = premium_large_salad`
- write body: `salad.groups`
- salad protein can be regular or premium
- sauce required
- no carbs
- fixed price comes from backend salad config

Flutter current behavior:

- menu field expected: `customPremiumSalad`
- write field: `custom_premium_salad`
- write body: `customSalad` flat legacy groups
- identity `carbId` is included
- only premium proteins are offered in builder flow

Files:

- `lib/data/response/meal_planner_menu_response.dart`
- `lib/data/mappers/meal_planner_menu_mapper.dart`
- `lib/data/request/day_selection_request.dart`
- `lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart`
- `lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart`

## Recommended Canonical Flutter Flow

1. Load `GET /api/subscriptions/meal-planner-menu`.
2. Build planner choices from `data.builderCatalog`.
3. Build day add-on choices from `data.addonCatalog.items`.
4. Load `GET /api/subscriptions/:id/timeline` and use backend `commercialState`, `paymentRequirement`, and canonical `mealSlots` for calendar state.
5. Load `GET /api/subscriptions/:id/days/:date` when entering a day and treat that payload as the authoritative editable day model.
6. Build local draft state using canonical slot structures:
   - plate meals use `carbs[]`
   - sandwiches use `sandwichId`
   - premium salad uses `salad.groups`
7. Before save, optionally call `POST /selection/validate` for dry-run UX, slot errors, and payment preview.
8. Save using `PUT /selection` with canonical `mealSlots` and `addonsOneTime`.
9. After save, inspect returned `paymentRequirement`.
10. If `paymentRequirement.requiresPayment == false` and backend day is confirmable, call `POST /confirm`.
11. If `blockingReason == premium_pending_payment`, create premium payment only.
12. If `blockingReason == addons_pending_payment`, create add-on payment only.
13. Open returned `payment_url`.
14. Verify payment using the corresponding verify endpoint.
15. Replace local day state from the verify result or immediately reload `GET /days/:date`.
16. Re-check `paymentRequirement` after verify.
17. Only confirm after the backend-reloaded day no longer requires payment.
18. Refresh timeline after confirm so timeline `status`, `commercialState`, and payment blockers stay consistent.

## Required Backend Fixes

Only if the team wants to reduce ambiguity:

1. Update OpenAPI docs for validate, confirm, day read, and timeline to match live response shapes.
2. Decide whether legacy compatibility aliases should remain or be removed on a scheduled deprecation path.
3. Either expose or delete the dormant premium overage day payment flow to avoid confusion.

## Required Flutter Fixes

### Data models and parsing

1. Replace legacy day write model with canonical request structures.
   Files:
   - `lib/data/request/day_selection_request.dart`

2. Parse canonical day read model.
   Files:
   - `lib/data/response/subscription_day_response.dart`
   - `lib/data/mappers/subscription_day_mapper.dart`
   - `lib/domain/model/subscription_day_model.dart`

3. Parse canonical menu fields including sandwiches and `premiumLargeSalad`.
   Files:
   - `lib/data/response/meal_planner_menu_response.dart`
   - `lib/data/mappers/meal_planner_menu_mapper.dart`
   - `lib/domain/model/meal_planner_menu_model.dart`

4. Update timeline models to include `commercialState`, `paymentRequirement`, canonical meal slots, and selected IDs.
   Files:
   - `lib/data/response/timeline_response.dart`
   - `lib/data/mappers/timeline_mapper.dart`
   - `lib/domain/model/timeline_model.dart`

### Planner orchestration

5. Rebuild `MealPlannerSlotSelection` around canonical slot shape.
   Files:
   - `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart`

6. Rebuild save/payment/confirm orchestration to trust backend `paymentRequirement` instead of local premium/add-on heuristics.
   Files:
   - `lib/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart`
   - `lib/presentation/plans/timeline/meal_planner/widgets/meal_planner_bottom_action.dart`

7. Stop using timeline `status == planned` as read-only rule.
   Files:
   - `lib/presentation/plans/timeline/time_line_screen.dart`
   - `lib/presentation/plans/timeline/meal_planner/meal_planner_screen.dart`

### UI

8. Replace one-carb UI with canonical carb split UI.
   Files:
   - `lib/presentation/plans/timeline/meal_planner/widgets/carb_picker_sheet.dart`
   - `lib/presentation/plans/timeline/meal_planner/widgets/meal_slot_card.dart`

9. Replace legacy premium salad builder with canonical `salad.groups` UI and allow regular or premium salad protein.
   Files:
   - `lib/presentation/plans/timeline/meal_planner/custom_premium_meal_builder_screen.dart`
   - `lib/presentation/plans/timeline/meal_planner/widgets/protein_picker_sheet.dart`

10. Make add-on UI category-driven from backend catalog instead of hardcoded buckets.
   Files:
   - `lib/presentation/plans/timeline/meal_planner/widgets/daily_addon_selection_card.dart`
   - `lib/presentation/plans/timeline/meal_planner/widgets/addon_selection_bottom_sheet.dart`

## Suggested Implementation Order

1. Stabilize API models.
2. Fix menu parsing.
3. Fix selection payload builder.
4. Fix add-ons.
5. Fix payments.
6. Fix confirm.
7. Add regression tests.

## Test Plan

### Backend tests

- Add endpoint-level integration coverage for:
  - canonical standard meal with one carb
  - canonical standard meal with split carbs and grams
  - premium meal with `selectionType = premium_meal`
  - sandwich save/read cycle
  - premium large salad save/read cycle
  - add-on entitlement vs pending payment
  - add-on payment create and verify
  - premium payment create and verify
  - confirm blocked by premium pending payment
  - confirm blocked by add-on pending payment
  - same-day pickup allowed
  - same-day delivery locked within one hour

Relevant existing backend test files:

- `tests/mealPlanner.integration.test.js`
- `tests/meal_planner_types.test.js`
- `tests/subscriptionDayModificationPolicy.test.js`

### Flutter manual QA

1. Load planner menu and verify:
   - proteins render from `builderCatalog.proteins`
   - premium proteins render from `builderCatalog.premiumProteins`
   - sandwiches render from `builderCatalog.sandwiches`
   - premium large salad renders from `builderCatalog.premiumLargeSalad`
   - add-ons render from `addonCatalog.items`
2. Save standard meal with one carb and with split carbs.
3. Save premium meal using premium protein and confirm correct premium blocker behavior.
4. Save sandwich and confirm no protein/carb payload is sent.
5. Save premium large salad and confirm payload uses canonical `salad.groups`.
6. Select included add-ons and confirm they return as `source = subscription`.
7. Select excess add-ons and confirm payment CTA is add-on-only.
8. Create add-on payment, complete payment, verify payment, reload day, confirm day.
9. Create premium payment, complete payment, verify payment, reload day, confirm day.
10. Change planner after premium payment creation and confirm revision mismatch is handled.
11. Same-day pickup: edit/save/pay still allowed.
12. Same-day delivery inside lock window: save blocked with user-friendly message.
13. Confirm that after any save, verify, or confirm, local state matches backend-reloaded day.

## Open Questions

1. Should Flutter keep any backward compatibility for legacy planner fields, or can it fully migrate to canonical-only parsing and writing?
2. Is premium overage payment intentionally retired from the client planner flow, or should it be surfaced as a supported endpoint?
3. Should the backend eventually stop mirroring legacy `planningState`, `planningMeta`, `carbId`, and `customSalad` fields once Flutter is migrated?
4. Should timeline read-model clickability be driven entirely from backend state, or does product still want additional client-side constraints for UX?
