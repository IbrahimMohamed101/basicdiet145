# Subscription Lifecycle Backend Audit

## 1. Executive Summary

Status: PARTIAL / NOT SAFE TO IMPLEMENT BUSINESS CHANGES YET.

The backend has a strong canonical planner direction: subscription creation stores a contract snapshot, day selection is replace-style, prices are mostly backend-owned, payment verification checks provider amount/currency and planner snapshot, and fulfillment deducts remaining meal balance atomically. However, there are still important lifecycle gaps around global meal planning limits, payment attempt lifecycle naming, and fulfillment mode rules.

BLOCKER: planned meal selections across multiple future days are not proven to be capped by total subscription meal allowance. `remainingMeals` is decremented at fulfillment / pickup reservation time, not when saving future planner selections, so a user can likely plan more future meals than the remaining balance before fulfillment catches it.

Top 5 risks:

1. HIGH: no authoritative `totalAfterSave = outsideAffectedDays + incomingSelections` validation for all planned days.
2. HIGH: pending/initiated payment attempts are not explicitly superseded when a day is edited; stale invoices rely on revision/snapshot mismatch at verify time.
3. HIGH: delivery-vs-pickup first-day exception is not modeled per day; active subscriptions generally cannot change delivery mode.
4. MEDIUM: multiple payment surfaces remain (`day_planning_payment`, `premium_extra_day`, `one_time_addon_day_planning`), increasing drift risk.
5. MEDIUM: dashboard/manual deduction can change balances independently of planned future days, so planner availability can become stale.

## 2. Backend Flow Map

### Create Subscription

Route -> Controller -> Service -> Model:

- `POST /api/subscriptions/checkout` -> `subscriptionController.checkoutSubscription` -> `subscriptionCheckoutService.performSubscriptionCheckout`, `subscriptionContractService.buildPhase1SubscriptionContract` -> `CheckoutDraft`, `Payment`.
- `POST /api/subscriptions/checkout-drafts/:draftId/verify-payment` and webhook -> `subscriptionController.verifyCheckoutDraftPayment`, `webhookController.handleMoyasarWebhook` -> `subscriptionActivationService.finalizeSubscriptionDraftPaymentFlow` / `activateSubscriptionFromCanonicalDraft` -> `Subscription`.
- Evidence: `subscriptionContractService.buildPhase1SubscriptionContract` derives `daysCount`, `mealsPerDay`, and `totalMeals = daysCount * mealsPerDay`; `subscriptionActivationService.buildCanonicalActivationPayload` writes `totalMeals`, `remainingMeals`, `startDate`, `endDate`, `validityEndDate`, `selectedMealsPerDay`, `premiumBalance`, and delivery fields.

### Get Planner/Menu

- `GET /api/subscriptions/meal-planner-menu` -> `menuController.getSubscriptionMealPlannerMenu` -> `mealPlannerCatalogService` / `CatalogService` -> `MenuProduct`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, `CatalogItem`.
- `GET /api/subscriptions/:id/days`, `/:id/days/:date`, `/:id/timeline` -> `subscriptionController` -> `serializeSubscriptionDayForClient`, `shapeMealPlannerReadFields`, `buildSubscriptionTimeline` -> `Subscription`, `SubscriptionDay`.

### Save / Update Meal Selections

- `PUT /api/subscriptions/:id/days/:date/selection` -> `subscriptionController.updateDaySelection` -> `subscriptionPlanningClientService.updateDaySelectionForClient` -> `subscriptionSelectionService.performDaySelectionUpdate` -> `SubscriptionDay`, `Subscription`.
- `POST /api/subscriptions/:id/days/:date/selection/validate` -> same validation path without persistence.
- `POST /api/subscriptions/:id/days/bulk-selection` -> `subscriptionSelectionClientService.updateBulkDaySelectionsForClient` -> loops `performDaySelectionUpdate`.

### Premium/Add-On Payment Required

- Day commercial state: `subscriptionDayCommercialStateService.buildDayCommercialState` and `buildPaymentRequirement`.
- Unified day payment: `POST /api/subscriptions/:id/days/:date/payments` -> `createUnifiedDayPaymentFlow`.
- Legacy/split payment surfaces still exist: `premium-extra/payments` and `one-time-addons/payments`.

### Payment Callback/Webhook

- `POST /api/webhooks/moyasar` -> `webhookController.handleMoyasarWebhook` -> `paymentApplicationService.applyPaymentSideEffects`.
- Manual verify: `verifyUnifiedDayPaymentFlow`, `verifyPremiumExtraDayPaymentFlow`, `verifyOneTimeAddonDayPlanningPaymentFlow`.
- Models: `Payment`, `SubscriptionDay`.

### Fulfillment / Delivery / Pickup

- Client pickup request: `POST /api/subscriptions/:id/pickup-requests` -> `subscriptionPickupRequestClientService.createSubscriptionPickupRequestForClient` -> `subscriptionPickupRequestBalanceService.reserveSubscriptionMealsForPickupRequest` -> `SubscriptionPickupRequest`, `Subscription`.
- Legacy pickup prepare/status: `/:id/days/:date/pickup/prepare`, `pickup/status`.
- Dashboard/kitchen operations: `src/routes/kitchen.js`, `dashboard/opsTransitionService.js`, `fulfillmentService.fulfillSubscriptionDay`, `fulfillSubscriptionPickupRequest`.
- Manual dashboard deduction: `POST /api/dashboard/subscriptions/:subscriptionId/manual-deduction` -> `manualSubscriptionDeductionService.manualDeduction`.

## 3. Current Source of Truth

- `totalAllowedMeals`: `Subscription.totalMeals`; derived from `daysCount * mealsPerDay` in `subscriptionContractService.buildPhase1SubscriptionContract` and persisted in `subscriptionActivationService.buildCanonicalActivationPayload`.
- `usedMealsCount`: no single persisted planner-wide value. Read models derive consumed as `totalMeals - remainingMeals` in `subscriptionClientSupportService.buildMealBalance` and `subscriptionOperationsReadService`.
- `remainingMealsCount`: `Subscription.remainingMeals`; decremented by `subscriptionDayConsumptionService.consumeSubscriptionDayCredits`, `consumeSubscriptionMealBalance`, `subscriptionPickupRequestBalanceService.reserveSubscriptionMealsForPickupRequest`, and dashboard manual deduction.
- `amountDue`: day-level derived value from `subscriptionDayCommercialStateService.buildPaymentRequirement.pendingAmountHalala` / `amountHalala`; payment row amount is `Payment.amount`.
- `payment status`: `Payment.status` enum is `initiated`, `paid`, `failed`, `canceled`, `expired`, `refunded`; day premium status is `SubscriptionDay.premiumExtraPayment.status` enum `none`, `pending`, `paid`, `failed`, `expired`, `revision_mismatch`.
- `fulfillment type`: subscription-level `Subscription.deliveryMode`; day overrides hold address/window, not a separate per-day delivery mode. Pickup requests use `SubscriptionPickupRequest`.
- `day/date lock status`: `SubscriptionDay.status`, `plannerState`, `planningState`, `lockedAt`, `lockedSnapshot`, `pickupRequested`, and `creditsDeducted`.

## 4. Problem-by-Problem Findings

### 1. إجمالي الوجبات عبر الاشتراك كله

Status: PRESENT

Evidence: `subscriptionSelectionService.performDaySelectionUpdate` validates only the incoming day against `maxSlotCount`; `buildMealBalance` uses current `remainingMeals`, and `remainingMeals` is consumed later. I found premium-upgrade global counting via `premiumUpgradeLimitService.countPersistedPremiumUpgradesForSubscription`, but no equivalent count of all planned meal slots outside the affected date.

Risk level: HIGH

Recommended fix approach: add a shared planner balance service that counts complete planned slots outside affected dates plus incoming complete slots, compares with `Subscription.remainingMeals` or an explicit planning allowance, and runs inside the write transaction for single and bulk saves.

Required tests: `tests/subscriptionPlannerGlobalMealBalance.test.js` covering 10 total meals, Day 9 = 5, Day 10 > 5 rejected; edit Day 9 down then Day 10 accepted; bulk dates atomic/consistent.

### 2. تعديل يوم محفوظ وعدم احتسابه مرتين

Status: PARTIAL

Evidence: `performDaySelectionUpdate` writes `SubscriptionDay.findOneAndUpdate({ subscriptionId, date }, { $set: update }, { upsert: true })`, so the day itself is replace-style. It filters `subInSession.premiumSelections` and `addonSelections` by `date` before pushing current day projections. It does not maintain a global used-meal counter, so the correct formula exists only implicitly for premium upgrades, not total meals.

Risk level: MEDIUM

Recommended fix approach: keep replace semantics, but make affected dates explicit and route all single/bulk saves through one `computeTotalAfterSave` helper.

Required tests: idempotent same payload does not duplicate `mealSlots`, `premiumSelections`, `addonSelections`; edit 5 slots to 3 lowers planned total.

### 3. Premium Meals ليست وجبات إضافية

Status: PARTIAL

Evidence: `MealSlotSchema` stores premium as one slot with `isPremium`, `premiumKey`, `premiumSource`, and `premiumExtraFeeHalala`. `projectMaterializedAndLegacyFromSlots` materializes premium meals as normal complete slots and also records premium upgrade selections. `premiumUpgradeLimitService` prevents premium upgrades from exceeding `Subscription.totalMeals`. Missing piece: all meals can still over-plan globally if finding 1 is true.

Risk level: MEDIUM

Recommended fix approach: after global meal cap is added, keep premium counting as an overlay on complete slots. Keep exact premium keys (`premium_meal`, `premium_large_salad`) and forbid loose matching in writes.

Required tests: 10 standard + 4 premium on 14 total accepted; 14 standard + 4 premium rejected by global meal cap; premium count cannot exceed total meals.

### 4. حساب السعر من Backend فقط

Status: NOT PRESENT

Evidence: day payment creation calculates premium amount from pending slots in `unifiedDayPaymentService.buildPendingPremiumSnapshot`; add-on amount from persisted day `addonSelections`; `reconcileAddonInclusions` resolves add-on choices server-side and uses catalog price. Canonical v3 selected options normalize unit price from option/product relations in `canonicalMealSlotPlannerService`.

Risk level: LOW

Recommended fix approach: keep rejecting client amount fields for planner writes; document server-owned pricing. Add tamper tests if not present.

Required tests: client-sent `amountHalala`, `priceHalala`, or altered option price is ignored/rejected; payment amount equals backend catalog.

### 5. Pending Payment لا يقفل اليوم

Status: NOT PRESENT

Evidence: `createUnifiedDayPaymentFlow` sets `premiumExtraPayment.status = pending` only for premium amount and does not change `SubscriptionDay.status`; `performDaySelectionUpdate` blocks non-open status or confirmed planner, not pending payment. Editing a day recomputes commercial state.

Risk level: LOW

Recommended fix approach: preserve this behavior and add tests proving pending payment can be removed by saving non-premium selections.

Required tests: create premium pending payment, save normal slots, day remains open, `paymentRequirement.requiresPayment=false`.

### 6. إعادة حساب الدفع بعد كل تعديل

Status: PARTIAL

Evidence: `buildDayCommercialState` recalculates `paymentRequirement.amountHalala` and `plannerRevisionHash` from current slots/add-ons. Existing initiated `Payment` rows are not explicitly canceled/superseded; stale payment verification is rejected by `applyUnifiedDayPlanningPayment` through revision/snapshot mismatch.

Risk level: HIGH

Recommended fix approach: introduce explicit `superseded` semantics in metadata or a new status-compatible field, and mark old initiated day payments superseded when planner revision changes.

Required tests: 30 -> 50 -> 15 -> 0 recalculates; old invoice verify returns `DAY_PAYMENT_REVISION_MISMATCH`; latest invoice applies.

### 7. Lifecycle واضح لمحاولات الدفع

Status: PARTIAL

Evidence: `Payment.status` has `initiated`, `paid`, `failed`, `canceled`, `expired`, `refunded`; day premium status has `none`, `pending`, `paid`, `failed`, `expired`, `revision_mismatch`. There is no `superseded` enum. `webhookController.handleMoyasarWebhook` updates non-paid terminal statuses and shared dispatcher applies paid side effects.

Risk level: MEDIUM

Recommended fix approach: do not break API contract; add internal metadata such as `supersededByRevisionHash` / `supersededAt`, and map public response to existing statuses unless Flutter needs optional detail.

Required tests: payment required/pending/paid/failed/canceled/expired/revision-mismatch cases; multiple initiated payments for one day only latest revision can apply.

### 8. Home Delivery: توصيل واحد فقط في اليوم

Status: UNKNOWN

Evidence: `SubscriptionDay` is unique by `{ subscriptionId, date }`, and delivery fulfillment appears day-based, not an Order-per-meal model. `dashboard/opsTransitionService` syncs `Delivery` records for subscription days, but this audit did not find a clear unique index on a `Delivery` record scoped to subscription day.

Risk level: MEDIUM

Recommended fix approach: verify `Delivery` model/indexes and all transition upserts; enforce one delivery visit per subscription/day if not already indexed.

Required tests: repeated out-for-delivery transitions create/update exactly one delivery record; same day multiple meal slots remain one delivery visit.

### 9. Home Delivery: أول يوم يمكن استلامه من الفرع

Status: PRESENT

Evidence: `Subscription.deliveryMode` is subscription-level. `subscriptionDeliveryUpdateService.resolveSubscriptionDeliveryDefaultsUpdate` rejects active mode change unless `allowModeChange` is true; day delivery update handles address/window overrides, not per-day fulfillment type. No first-day-specific pickup exception was found.

Risk level: HIGH

Recommended fix approach: add per-day fulfillment method only if business confirms the rule. Prefer non-breaking optional request field for first day, with backend default preserving current subscription mode.

Required tests: delivery subscription Day 1 pickup allowed, Day 2 pickup rejected; startDate timezone/date edge cases.

### 10. Branch Pickup: يستلم أي عدد من وجباته المتاحة

Status: PARTIAL

Evidence: `buildMealBalance` sets `dailyMealLimitEnforced: false` and `maxConsumableMealsNow = remainingMeals`; pickup request creation accepts arbitrary positive `mealCount` and reserves against `remainingMeals`. However planner `resolveMealSlotPlanningLimits` may still use the same max for all canonical subscriptions and does not distinguish pickup business rules from delivery.

Risk level: MEDIUM

Recommended fix approach: explicitly encode fulfillment policy: pickup can request/reserve any count up to remaining balance; planner save should use global cap, not `mealsPerDay`, for pickup.

Required tests: pickup same-day 10 of 10 accepted; 11 rejected; multiple same-day pickup deductions/reservations do not exceed balance.

### 11. قواعد التواريخ والأيام

Status: PARTIAL

Evidence: `validateSelectionDateRangeOrThrow` rejects invalid KSA date strings, before `startDate`, and after `validityEndDate/endDate`. `buildCanonicalActivationPayload` computes `end = addDays(start, daysCount - 1)`. There is no shared dayIndex abstraction, and some services compare string KSA dates while activation uses Date objects.

Risk level: MEDIUM

Recommended fix approach: centralize date range/day-index calculation in one helper and use it for planner, pickup, delivery updates, and dashboard overrides.

Required tests: start day inclusive, end day inclusive, before/after rejected, KSA timezone boundary around midnight.

### 12. منع التكرار والـ double booking

Status: PARTIAL

Evidence: `SubscriptionDay` has unique `{ subscriptionId, date }`; meal slot validation rejects duplicate `slotIndex` and `slotKey`; pickup request has idempotency key unique index. Without an idempotency key, multiple pickup requests for the same subscription/date are allowed as long as balance remains. Multiple initiated payment rows can exist for revised payloads.

Risk level: MEDIUM

Recommended fix approach: require idempotency for pickup request creation or add active-request uniqueness if business wants one active pickup request per day; add payment supersede state.

Required tests: duplicate slot key rejected; same save retry idempotent; two concurrent saves cannot exceed total planned meal cap; pickup request retry with/without idempotency behavior documented.

### 13. صلاحيات وحالة الاشتراك

Status: PARTIAL

Evidence: client selection, validation, payment, pickup request, and delivery update paths check `String(sub.userId) === String(userId)`. `ensureActive` rejects non-active and date-expired operations. `assertSubscriptionDayModifiable` is used before edits/payments. Dashboard/admin routes have override powers: manual deduction checks admin role and active status; admin delivery update uses `allowModeChange: true`.

Risk level: MEDIUM

Recommended fix approach: keep admin overrides, but document and test each one. Ensure admin day edits cannot silently bypass payment/balance invariants.

Required tests: wrong user forbidden; canceled/expired rejected; locked/fulfilled rejected; admin override audited and constrained.

## 5. Additional Logical Issues Found

### Issue A: Planned meals and consumed balance are different sources of truth

Evidence: `Subscription.remainingMeals` changes at fulfillment/reservation/manual deduction, while planner saves write `SubscriptionDay.mealSlots`. There is no persisted `plannedMealsCount`.

Risk: HIGH

Recommended fix: introduce a read/write helper that counts planned complete slots and compares against remaining/allowed balance before writes.

Required tests: manual dashboard deduction after future planning makes additional planning fail or marks days needing adjustment.

### Issue B: `premiumExtraPayment.status = pending` is only linked for premium amount

Evidence: `createUnifiedDayPaymentFlow` updates `day.premiumExtraPayment` only when `premiumAmountHalala > 0`; add-on-only pending payment lives in `Payment` and `addonSelections.source`.

Risk: MEDIUM

Recommended fix: keep public contract, but internally name this `dayPaymentAttempt` or document that `premiumExtraPayment` is not the unified payment state.

Required tests: add-on-only payment status readback after initiation/failure/paid.

### Issue C: Legacy custom salad/custom meal day payment endpoints can append snapshots

Evidence: `paymentApplicationService.applyCustomSaladDayPayment` and `applyCustomMealDayPayment` append snapshots to `customSalads` / `customMeals` on open days. These are outside canonical `mealSlots`.

Risk: MEDIUM

Recommended fix: decide whether these legacy paths are still supported for subscriptions. If yes, include them in global meal balance; if no, disable for canonical planner subscriptions.

Required tests: custom salad/day payment cannot exceed remaining meal balance or bypass canonical planner count.

### Issue D: Active pickup requests reserve balance but do not map back to planned slot count

Evidence: `SubscriptionPickupRequest` reserves `mealCount` against `remainingMeals` and stores a snapshot of day mealSlots, but the day can contain fewer/more selected slots.

Risk: MEDIUM

Recommended fix: define whether pickup request `mealCount` is independent quantity-only fulfillment or must match selected slots. Enforce it consistently.

Required tests: pickup request mealCount > selected slots; selected slots > mealCount; quantity-only pickup with no slots.

## 6. Proposed Backend Fix Plan

### Phase 1: counting and idempotency

- Add `subscriptionPlanningBalanceService`.
- Compute `existingCompleteSlotsOutsideAffectedDates + incomingCompleteSlots`.
- Use it in single and bulk save inside transaction.
- Add concurrent save tests.

### Phase 2: premium/addon pricing

- Lock all premium and add-on amount derivation behind backend catalog helpers.
- Add tamper tests for client-sent price/amount fields.
- Verify `premium_large_salad` exact keys stay enforced.

### Phase 3: pending payment lifecycle

- Add internal supersede metadata for initiated day payments.
- Mark old initiated day payments superseded when planner revision changes.
- Keep public API non-breaking.

### Phase 4: fulfillment rules

- Decide and encode delivery subscription Day 1 pickup exception.
- Verify one subscription delivery visit per day.
- Clarify pickup request mealCount vs planned slot semantics.

### Phase 5: date/lock/permissions hardening

- Centralize date range/day-index helpers.
- Add admin override audit tests.
- Expand `assertSubscriptionDayModifiable` coverage tests.

### Phase 6: regression tests and docs

- Add lifecycle regression suite.
- Update docs with current contract and optional response fields only.

## 7. Test Plan

- `tests/subscriptionPlannerGlobalMealBalance.test.js`: global cap, edit replacement, bulk save, concurrency.
- `tests/subscriptionPlannerPaymentLifecycle.test.js`: pending payment editable, amount recalculation, stale invoice mismatch, supersede metadata.
- `tests/subscriptionPremiumUpgradeOverlay.test.js`: premium is counted as a meal slot, premium cap, premium salad exact key/allowlist.
- `tests/subscriptionFulfillmentPolicy.test.js`: delivery one visit per day, pickup any count up to balance, first-day pickup exception if implemented.
- `tests/subscriptionDateRangeAndLockPolicy.test.js`: start/end inclusive, KSA boundaries, locked/confirmed/fulfilled/canceled/expired rejection.
- `tests/subscriptionAdminOverrideLifecycle.test.js`: manual deduction, admin delivery mode update, audit logs, invariants preserved.
- `tests/subscriptionLegacyCustomDayPaymentGuard.test.js`: custom salad/meal legacy paths cannot bypass meal balance.

## 8. Contract Impact

Recommended default: no breaking Flutter request/response contract changes.

Optional non-breaking response additions:

- `mealBalance.plannedMealsCount`
- `mealBalance.remainingPlannableMealsCount`
- `paymentRequirement.paymentAttemptStatus`
- `paymentRequirement.supersededPaymentId`
- `fulfillmentPolicy.allowedMethodsForDate`

Potential contract change requiring business approval:

- first-day pickup for delivery subscriptions needs either a per-day fulfillment method in write payload or a dedicated first-day pickup endpoint. Prefer an optional field accepted only for eligible Day 1.

## 9. Final Recommendation

Start implementation after Phase 1 design is approved.

Begin with:

- `src/services/subscription/subscriptionSelectionService.js`
- new `src/services/subscription/subscriptionPlanningBalanceService.js`
- `src/services/subscription/subscriptionClientSupportService.js`
- focused tests under `tests/subscriptionPlannerGlobalMealBalance.test.js`

Do not touch Flutter, Dashboard frontend, seed/bootstrap, or public contracts in Phase 1.

Do not start payment lifecycle refactoring until global meal counting is fixed and covered. Payment integrity depends on the planner revision representing a valid, non-overbooked plan.
