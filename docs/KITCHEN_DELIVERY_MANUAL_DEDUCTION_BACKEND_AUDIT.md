# Kitchen / Delivery / Pickup / Manual Deduction Backend Audit

Audit date: 2026-06-11  
Backend path confirmed: `/home/hema/Projects/basicdiet145`

## Files Inspected

- `graphify-out/GRAPH_REPORT.md`
- `src/routes/dashboardBoards.js`
- `src/routes/dashboardOps.js`
- `src/routes/dashboardSubscriptions.js`
- `src/routes/kitchen.js`
- `src/controllers/dashboard/opsBoardController.js`
- `src/controllers/dashboard/opsController.js`
- `src/controllers/dashboard/opsActionController.js`
- `src/controllers/dashboard/subscriptionManualDeductionController.js`
- `src/controllers/kitchenController.js`
- `src/controllers/kitchenOperationsController.js`
- `src/services/dashboard/opsReadService.js`
- `src/services/dashboard/opsSearchService.js`
- `src/services/dashboard/opsTransitionService.js`
- `src/services/dashboard/opsActionPolicy.js`
- `src/services/dashboard/dashboardDtoService.js`
- `src/services/dashboard/manualSubscriptionDeductionService.js`
- `src/services/kitchenOperations/KitchenOperationsDataService.js`
- `src/services/kitchenOperations/KitchenOperationsListService.js`
- `src/services/kitchenOperations/KitchenOperationsMapper.js`
- `src/services/orders/orderDashboardService.js`
- `src/services/orders/orderOpsTransitionService.js`
- `src/services/fulfillmentService.js`
- `src/services/subscription/subscriptionDayExecutionValidationService.js`
- `src/services/subscription/subscriptionFulfillmentPolicyService.js`
- `src/services/subscription/subscriptionPickupRequestClientService.js`
- `src/services/subscription/subscriptionPickupRequestBalanceService.js`
- `src/models/Delivery.js`
- `src/models/Order.js`
- `src/models/Payment.js`
- `src/models/Plan.js`
- `src/models/Subscription.js`
- `src/models/SubscriptionDay.js`
- `src/models/SubscriptionPickupRequest.js`

## Lifecycle Map

### Operations Board Appearance

Primary dashboard board endpoints:

- `GET /api/dashboard/kitchen/queue`, `/courier/queue`, `/pickup/queue` from `src/routes/dashboardBoards.js`, implemented by `opsBoardController.queue`.
- `GET /api/dashboard/kitchen/queue/:dayId`, `/courier/queue/:dayId`, `/pickup/queue/:dayId`, implemented by `opsBoardController.queueDetail`.
- `POST /api/dashboard/*/actions/:action`, implemented by `opsBoardController.action`.
- Older unified ops endpoints: `GET /api/dashboard/ops/list`, `GET /api/dashboard/ops/search`, `POST /api/dashboard/ops/actions/:action`.
- New kitchen operations endpoints: `GET /api/kitchen/operations/summary` and `GET /api/kitchen/operations/list`.

Models feeding boards:

- Subscription days: `SubscriptionDay` joined to `Subscription` and `User`.
- One-time orders: `Order` joined to `User`.
- Pickup reservations: `SubscriptionPickupRequest` joined to `Subscription` and `User`.
- Delivery detail is synced through `Delivery`; the payload fix now attaches existing delivery identity/status fields when a `Delivery` record exists.

Visibility rules observed:

- `opsBoardController.queryBoardDays` filters by date, status, screen, and method. Date defaults to current KSA date if omitted or malformed.
- Subscription day default statuses:
  - kitchen/all: `open`, `locked`, `in_preparation`, `ready_for_pickup`, `out_for_delivery`, `delivery_canceled`, `canceled_at_branch`
  - courier: `in_preparation`, `out_for_delivery`, `fulfilled`, `delivery_canceled`
  - pickup: `locked`, `in_preparation`, `ready_for_pickup`, `fulfilled`, `canceled_at_branch`, `no_show`
- One-time orders are board-visible only with `paymentStatus: "paid"` and active operational statuses.
- Pickup requests are board-visible when status is `locked`, `in_preparation`, or `ready_for_pickup` by default.
- `shouldBlockOneTimeOrderDelivery(order)` excludes one-time orders whose delivery should be blocked.
- Subscription day board reads do not query `Payment` directly. Payment validity is derived from day commercial state and raw pending/superseded metadata, and is now exposed as an additive `paymentValidity` object.

KSA date logic:

- Date formatting/range helpers use `utils/date` and `restaurantHoursService.getRestaurantBusinessDate`.
- Fulfillment policy validates KSA date strings and subscription date range through `subscriptionFulfillmentPolicyService`.

### Kitchen Preparation And Actions

Action routes:

- Dashboard board actions: `POST /api/dashboard/{kitchen|courier|pickup}/actions/:action`.
- Unified ops actions: `POST /api/dashboard/ops/actions/:action`.
- Kitchen legacy routes include `/api/kitchen/subscriptions/:id/days/:date/lock`, `/in-preparation`, `/out-for-delivery`, `/ready-for-pickup`, `/fulfill-pickup`, `/cancel-at-branch`, and pickup verify/no-show.

Action policy:

- `opsActionPolicy.ACTION_REGISTRY` defines `lock`, `prepare`, `dispatch`, `ready_for_pickup`, `notify_arrival`, `fulfill`, `cancel`, `no_show`, `reopen`.
- Roles:
  - prepare/lock/ready/cancel/no_show: admin/superadmin/kitchen depending on action.
  - dispatch: admin/superadmin/kitchen/courier for delivery mode.
  - notify_arrival: admin/superadmin/courier.
  - fulfill: kitchen for pickup, courier for delivery, admin/superadmin for both.
  - reopen: admin/superadmin.
- `opsTransitionService.executeAction` additionally treats `lock`, `prepare`, `cancel`, `no_show`, `reopen`, `notify_arrival` as admin-only today. That means some actions listed as kitchen-allowed in the registry can still be rejected by the transition service. Dashboard should handle `FORBIDDEN`.

Transition behavior:

- `lock`: subscription day only, `open -> locked`, idempotent if already locked.
- `prepare`: subscription day/order/pickup request. Orders require paid state. Pickup subscription days require `pickupRequested`.
- `dispatch`: delivery only, writes or updates `Delivery` and moves to `out_for_delivery`.
- `ready_for_pickup`: pickup mode only.
- `fulfill`: subscription day/order/pickup request. Fulfillment service makes duplicate subscription-day and pickup-request consumption idempotent when credits are already deducted/consumed.
- `cancel`, `no_show`, `reopen`, `notify_arrival`: constrained by action policy and transition service.

### Delivery

- Delivery model has unique indexes on `dayId`, `subscriptionId + date`, and `orderId`.
- Subscription dispatch uses `Delivery.updateOne(..., { upsert: true })` with `subscriptionId`, `dayId`, and `date`, so repeat dispatch reuses the same delivery document.
- Order dispatch/fulfillment/cancel also upserts by `orderId`.
- `fulfillmentService.fulfillSubscriptionDay` returns `alreadyFulfilled` when a fulfilled day already has `creditsDeducted`, preventing double consumption.
- The tested policy confirms one delivery visit per `subscriptionId + date`.

### Pickup

- Client pickup requests are created by `subscriptionPickupRequestClientService.createSubscriptionPickupRequestForClient`.
- It validates:
  - positive `mealCount`
  - subscription exists, is active, owned, and date-valid
  - fulfillment method allows pickup
  - current KSA date only
  - day is not skipped/frozen
  - balance is sufficient
- Pickup request snapshots include `mealSlots`, `materializedMeals`, `addons`, and premium selections from the day.
- `subscriptionPickupRequestBalanceService.reserveSubscriptionMealsForPickupRequest` atomically decrements `Subscription.remainingMeals` with `$gte` guard.
- Branch pickup can reserve any count up to remaining balance. Tests confirm all-remaining pickup is allowed and above-remaining pickup is rejected.
- Home-delivery subscriptions allow day-1 branch pickup exception and reject day-2+ pickup.
- Pickup request fulfillment consumes reserved credits by setting `creditsConsumedAt`; repeated consumption is idempotent or safely rejected depending on state.

### Manual Deduction

Route:

- `POST /api/dashboard/subscriptions/:subscriptionId/manual-deduction`
- Search helper: `GET /api/dashboard/subscriptions/search?phone=...`

Roles:

- Route allows `admin`; service accepts `admin` and `superadmin`.
- Kitchen is explicitly rejected.

Validation and behavior:

- Counts must be non-negative integers and total must be greater than zero.
- Subscription must exist and be `active`.
- Customer must still exist.
- Deduction cannot exceed `remainingMeals`, regular balance, or premium balance.
- Atomic update uses `remainingMeals: { $gte: counts.total }` and premium row array filters, so it should not make balances negative under concurrency.
- Delivery-mode manual deduction is limited to one deduction per business date.
- Pickup-mode manual deductions can happen multiple times per day while balance remains.
- Activity log action `manual_subscription_meal_deduction` records before/after balances, actor, reason, notes, fulfillment method, and business date.
- Manual deduction changes remaining balance only; it does not reconcile or cancel already planned future days.

## Operations Response Contract Summary

### Current Response Shape

Legacy board list/detail (`/api/dashboard/{screen}/queue`):

- Subscription day response includes `entityId`, `entityType`, `subscriptionDayId`, `subscriptionId`, `user.id/name/phone`, `date`, `status`, `deliveryMethod`, `deliveryMode`, `delivery`, `pickup`, raw `mealSlots`, `materializedMeals`, add-on selections, premium upgrade selections, notes, latest action, allowed actions, timestamps.
- One-time order response uses `dashboardDtoService.mapOrderToDTO` and includes `orderId`, `paymentStatus`, `items`, pricing, delivery/pickup context, and allowed actions.
- Pickup request response includes `requestId`, `subscriptionId`, `subscriptionDayId`, `userId`, `date`, `mealCount`, status, pickup fields, `context.snapshot`, credits state, and allowed actions.

Unified ops list/search (`/api/dashboard/ops/list`, `/search`):

- Uses `opsReadService` and `dashboardDtoService`.
- Subscription day DTO does not include raw meal slots, plan, protein grams, or explicit payment-validity state.

New kitchen operations list (`/api/kitchen/operations/list`):

- Returns sanitized rows: id, entity type, reference, customer, date, mode, time window, display `items`, status/progress/actions, badges, verification, UI, timing, and meta.
- It intentionally converts materialized meals and add-ons into display-oriented item names. This is not enough for kitchen source-of-truth preparation.

### Required Preparation Fields Present Today

Present in at least one current response path:

- Customer id/name/phone: present in legacy board and DTOs, partial in new kitchen list.
- Subscription id/day id/order id/pickup request id: present in legacy board and DTOs; new kitchen row has `meta.subscriptionId`, `meta.dayId`, `meta.orderId`.
- Date/status/fulfillment mode: present.
- Delivery/pickup address/window/location/status: partial. Legacy board has delivery/pickup context; new kitchen rows have mode/time window/branch id but not delivery id/status.
- Raw meal slots: present in legacy board subscription day response only.
- Order items: present in order DTOs, but item completeness depends on order schema payload.
- Pickup request count and snapshot: present in pickup request DTO.

### Missing Or Partial Response Fields

Original blocker before payload fix: Operations response completeness was not sufficient for kitchen accuracy across all dashboard surfaces.

- Fixed: subscription plan/package details are populated and returned through additive `plan` fields.
- Fixed: structured protein portion is returned from `Subscription.selectedGrams` as `plan.proteinGrams` and meal-slot `proteinGrams`.
- Fixed: new kitchen operations rows now preserve structured `kitchenDetails` alongside display item names.
- Fixed: `paymentValidity`, `canPrepare`, and `canFulfill` are explicit for subscription-day payloads.
- Fixed: existing `Delivery` records are attached as additive delivery identity/status fields.
- Manual deduction has search and mutation responses but no dedicated history/detail endpoint. History is in `ActivityLog`.

### Recommended Non-Breaking Backend Additions

Additive fields recommended for all operations item mappers:

- `fulfillmentType`: `home_delivery`, `branch_pickup`, `pickup_request`, `delivery`, or `manual_deduction`.
- `plan`: `{ id, key, name, daysCount, durationDays, totalMeals, remainingMeals, selectedMealsPerDay, deliveryMode, proteinGrams, portionSize }`.
- `kitchenDetails.mealSlots[]`: `{ slotIndex, slotKey, selectionType, productId, productKey, proteinId, proteinGrams, proteinFamilyKey, carbSelections, salad, selectedOptions, sandwichId, isPremium, premiumKey, premiumSource, quantity, notes }`.
- `kitchenDetails.addons[]`: preserve add-ons separately from meal count.
- `paymentValidity`: `{ paymentRequired, paymentStatus, paymentApplied, superseded, revisionMismatch, canPrepare, canFulfill }`.
- `delivery`: include `deliveryId`, date, status, address/window/zone where applicable.
- `pickup`: include `pickupRequestId`, branch/location id, meal count, reserved/consumed/released status, pickup code state.

These are non-breaking additions if appended to existing DTOs/rows without removing or renaming current fields.

## Source Of Truth Mapping

- Customer identity: `User`, populated through `Subscription.userId` or `Order.userId`.
- Subscription identity and balance: `Subscription`.
- Plan/package: `Subscription.planId -> Plan`; selected package option is `Subscription.selectedGrams`, `Subscription.selectedMealsPerDay`, `Subscription.totalMeals`, `Subscription.remainingMeals`, and `Plan.daysCount/durationDays/key/name`.
- 200g protein portion: `Subscription.selectedGrams = 200`; plan availability/options are `Plan.gramsOptions[].grams`.
- Day preparation selections: `SubscriptionDay.mealSlots`, `materializedMeals`, `lockedSnapshot`, `fulfilledSnapshot`, add-on/premium fields.
- Catalog names: `BuilderProtein`, `BuilderCarb`, `Meal`, `Addon`, and menu product/option snapshots on slots.
- Payment state: `Order.paymentStatus/paymentId`, `Payment.status/applied/metadata`, `SubscriptionDay.premiumExtraPayment`, and day commercial state helpers.
- Delivery: `Delivery`.
- Pickup reservation: `SubscriptionPickupRequest`.
- Manual deduction: `ActivityLog` with action `manual_subscription_meal_deduction`.

## Kitchen Queue Response Cleanup Result

Cleanup date: 2026-06-13  
Backend path confirmed: `/home/hema/Projects/basicdiet145`

### Files Changed

- `src/controllers/dashboard/opsBoardController.js`
- `src/controllers/dashboard/subscriptionManualDeductionController.js`
- `src/services/dashboard/kitchenQueueContractService.js`
- `src/services/dashboard/opsPayloadService.js`
- `src/services/dashboard/manualSubscriptionDeductionService.js`
- `src/routes/dashboardSubscriptions.js`
- `tests/opsPayloadService.test.js`
- `docs/KITCHEN_QUEUE_DASHBOARD_RESPONSE_CONTRACT.md`
- `docs/KITCHEN_DELIVERY_MANUAL_DEDUCTION_BACKEND_AUDIT.md`

### Endpoints Affected

- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/kitchen/queue/:dayId`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/pickup/queue/:dayId`
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/courier/queue/:dayId`
- `GET /api/dashboard/subscriptions/:subscriptionId/manual-deductions`

Kitchen, pickup, and courier queue endpoints now use the same clean v2 contract by default. Legacy board DTOs remain available through `view=legacy`.

### Response Fields Added / Organized

The kitchen, pickup, and courier queue default responses now return:

- `contractVersion: "dashboard_kitchen_queue.v2"`
- `date`, `businessDate`, `count`, `filters`
- `items[].ids`
- `items[].customer`
- `items[].source`
- `items[].subscription.plan`
- `items[].orderSummary`
- `items[].kitchen.meals`
- `items[].kitchen.addons`
- `items[].fulfillment.delivery`
- `items[].fulfillment.pickup`
- `items[].payment`
- `items[].actions`
- `items[].timestamps`

The response preserves lightweight compatibility aliases such as `entityId`, `entityType`, `subscriptionDayId`, `status`, and `allowedActions`. Heavy legacy/internal data is excluded from the default response.

Manual deduction history is not injected into queue responses. A compact manual deduction history endpoint returns `dashboard_manual_deductions.v1` with deduction counts, balances before/after, actor summary, reason, notes, and timestamps.

### Clean Mode

Default kitchen, pickup, and courier queue responses are clean v2.

- Use `includeRaw=true` to attach the legacy DTO under `items[].raw`.
- Use `view=legacy` to return the pre-v2 board DTO.

### Tests Run

Passed:

- `NODE_ENV=test node tests/opsPayloadService.test.js`
- `NODE_ENV=test node tests/kitchen_operations_mapper.test.js`
- `NODE_ENV=test node tests/subscriptionFulfillmentPolicy.test.js`
- `NODE_ENV=test node tests/subscriptionDateLockPermissionsHardening.test.js`
- `NODE_ENV=test node tests/subscriptionPlannerPaymentLifecycle.test.js`
- `npm run test:subscriptions`
- `NODE_ENV=test node -e "require('./src/controllers/dashboard/opsBoardController'); require('./src/services/dashboard/kitchenQueueContractService')"`

DB-backed tests could not run locally because MongoDB was unavailable:

- Attempted `MONGO_URI=mongodb://localhost:27017/basicdiet_test NODE_ENV=test node tests/dashboardKitchenQueueActions.test.js`
- Result: `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`

### Remaining Risks

- Action endpoints still rely on existing transition validators; dashboard must handle action rejection even when an action appears in the allowed list.
- One-time order protein grams may be `null` when the order item did not capture grams in its selections.
- The v2 clean response intentionally hides raw snapshots by default. Internal debugging should use `includeRaw=true` or `view=legacy`.

## Kitchen Queue Arabic Display Readiness Fix

Fix date: 2026-06-13

### What Was Broken

- v2 had a clean structure but some kitchen-critical display fields were empty.
- Sandwich rows could say `mealType: "sandwich"` without identifying which sandwich.
- Protein and carb rows could contain ids/keys while Arabic/English display names were empty.
- Default v2 still exposed deprecated root aliases duplicated from `ids`, `source`, and `actions`.
- Empty canceled rows could appear like normal kitchen workload.
- Missing names were silent instead of visible to dashboard QA.

### Files Changed

- `src/controllers/dashboard/opsBoardController.js`
- `src/services/dashboard/opsPayloadService.js`
- `src/services/dashboard/kitchenQueueContractService.js`
- `tests/opsPayloadService.test.js`
- `docs/KITCHEN_QUEUE_DASHBOARD_RESPONSE_CONTRACT.md`
- `docs/KITCHEN_DELIVERY_MANUAL_DEDUCTION_BACKEND_AUDIT.md`

### Response Changes

- `kitchen.meals[].product`, `sandwich`, `protein`, `carbs`, options, add-ons, and `subscription.plan` now expose `{ ar, en }` names plus `displayName`.
- `kitchen.meals[].mealTypeLabel`, `fulfillment.typeLabel`, `source.statusLabel`, and payment labels are included.
- `kitchen.meals[].display` and `orderSummary.display` provide Arabic-ready render text.
- `orderSummary` now includes `addonCount`, Arabic count text, and explicit item count semantics.
- Default v2 hides deprecated root aliases. `includeLegacyAliases=true` or `includeRaw=true` restores them with a deprecation note.
- Default kitchen v2 filters archived canceled empty rows; `includeCanceled=true` or explicit status filters can include them.
- `dataQuality` warns about missing product/sandwich/protein/carb/customer/plan data instead of returning silent empty display strings.

### Tests Added

- Sandwich item resolves id/key/Arabic/English names and displayName.
- Protein and carb Arabic names are preserved.
- Protein grams still come from `Subscription.selectedGrams`.
- Meal and card Arabic display summaries are present.
- Add-ons are Arabic-ready and separate from meals.
- Default v2 hides root aliases.
- `includeRaw=true` exposes raw/debug data and temporary aliases.
- Missing display-critical fields produce `dataQuality.warnings`.
- Archived canceled empty rows are hidden by default and marked when included.

### Tests Run

- `NODE_ENV=test node tests/opsPayloadService.test.js`

### Remaining Risks

- If neither snapshots nor catalog lookups contain a real name, v2 returns a fallback displayName from key/id and emits `dataQuality.warnings`.
- One-time order items depend on the persisted order snapshot/selections for Arabic-ready names unless expanded with more catalog hydration later.

## Critical Backend Rules

| # | Rule | Status | Evidence / Gap |
|---|---|---|---|
| 1 | Ops board does not expose unpaid/stale/superseded payment items as fulfillable | PASS | One-time orders require `paymentStatus: paid`; subscription days now expose explicit `paymentValidity` fields derived from commercial state and raw pending/superseded metadata. |
| 2 | Pending unpaid day-planning payment does not lock planner edit, but cannot be fulfilled as paid | PARTIAL | Planner tests pass; ops response/action needs explicit payment validity for dashboard. |
| 3 | Superseded payment attempts cannot be fulfilled or counted as paid | PASS | Payment lifecycle tests pass for superseding; ops response now exposes `paymentValidity.superseded` when metadata is present. |
| 4 | Delivered/fulfilled day cannot be prepared/dispatched/fulfilled again incorrectly | PASS | Fulfillment service returns already fulfilled when credits deducted; concurrency test passed. |
| 5 | Cancelled/expired/inactive subscription cannot be fulfilled by ops | PARTIAL | Client write/payment/pickup paths reject inactive/cancelled/out-of-range. Ops board queries do not populate parent status, so visibility/action gating for subscription days is not explicit. |
| 6 | Wrong role cannot perform admin-only transitions | PASS | Route middleware and transition service enforce roles; tests cover role restrictions where DB is available/transaction-capable. |
| 7 | Courier can only perform allowed courier operations | PASS | Action policy restricts role/mode; courier queue route is role-gated. |
| 8 | Home Delivery has at most one Delivery record per subscription/date | PASS | Unique index on `subscriptionId,date`; tests passed. |
| 9 | Dispatch/update reuses existing delivery instead of creating duplicates | PASS | Dispatch uses upsert; tests passed. |
| 10 | Branch Pickup can consume any count up to remainingMeals | PASS | Fulfillment policy test passed. |
| 11 | Pickup cannot exceed remainingMeals | PASS | Reservation uses atomic `$gte`; tests passed. |
| 12 | Manual deduction cannot exceed remainingMeals | PASS | Service validates and atomic update guards. DB-backed dashboard test could not run locally due MongoDB unavailable. |
| 13 | Manual deduction cannot make remainingMeals negative | PASS | Atomic `$gte` update and concurrency test behavior in code; DB-backed test blocked locally. |
| 14 | Manual deduction requires admin/superadmin | PASS | Route requires admin; service accepts admin/superadmin. |
| 15 | Manual deduction cannot silently bypass payment/balance invariants | PARTIAL | It enforces balance invariants but is independent of payment/planned-day reconciliation by design. |
| 16 | Fulfillment and manual deduction cannot double-consume same meals | PARTIAL | Atomic balance guards prevent negative balance, but manual deduction can make future planned days stale; no reconciliation endpoint observed. |
| 17 | Date validation uses KSA date rules | PASS | KSA date helpers and tests pass. |
| 18 | Out-of-range day cannot be fulfilled/picked up/deducted unless explicit override exists | PARTIAL | Pickup/client paths enforce range. Manual deduction chooses active subscriptions in search but direct deduction does not explicitly check date range because it is balance-only. |
| 19 | Important operations are idempotent or safely reject duplicate execution | PASS | Fulfillment/pickup reservation paths are idempotent or guarded; tests passed. |
| 20 | Errors are explicit enough for Dashboard UI | PARTIAL | Error codes exist, but some surfaces map generic transition failures. |
| 21 | Operations response includes subscription plan/package details | PASS | Added `plan` payload from `Subscription.planId` and `Plan`. |
| 22 | Operations response includes structured protein grams/portion | PASS | Added `plan.proteinGrams` and slot `proteinGrams` from `Subscription.selectedGrams`. |
| 23 | Operations response includes complete meal selections | PARTIAL | Legacy board returns raw `mealSlots`; new kitchen list collapses to display item names. |
| 24 | Operations response includes payment validity/fulfillable state | PASS | Added additive `paymentValidity` payload for subscription days and orders. |
| 25 | Operations response includes delivery/pickup identity and status | PARTIAL | Pickup request ids are present; delivery id/status are not consistently returned. |

## Blockers Found

Original blockers fixed in this pass:

1. Operations/kitchen responses now include plan/package details and structured protein grams from `Subscription.selectedGrams`.
2. New kitchen operations list now includes structured `kitchenDetails` alongside display rows.
3. Subscription-day operations responses now include explicit `paymentValidity`.

No manual deduction business logic was changed.

## Error Codes

Observed codes and where they occur:

- `FORBIDDEN`: dashboard role middleware, manual deduction role check, action policy role failures.
- `INVALID_REQUEST`: missing `entityId` or `entityType` in ops board action.
- `INVALID_ENTITY_ID`: malformed action entity id.
- `INVALID_ENTITY_TYPE`: unsupported action entity type.
- `NOT_FOUND`: subscription day, pickup request, subscription, customer, or order not found depending on route.
- `INVALID_TRANSITION`: state transition rejected.
- `INVALID_PICKUP_CODE`: pickup verification mismatch.
- `ORDER_PAYMENT_REQUIRED`: unpaid one-time order prepare/fulfill path.
- `INVALID_DATE`: invalid date format, pickup not current day, or invalid operation date.
- `SUBSCRIPTION_DATE_OUT_OF_RANGE`: date before start or after validity/end date.
- `INVALID_FULFILLMENT_METHOD`: fulfillment method is not delivery/pickup.
- `FULFILLMENT_METHOD_NOT_ALLOWED`: fulfillment method not allowed for subscription date.
- `INVALID_DELIVERY_MODE`: day-2+ pickup request for delivery subscription path maps method-not-allowed to this code.
- `INVALID_MEAL_COUNT`: pickup/manual deduction meal count validation.
- `INSUFFICIENT_CREDITS`: pickup reservation or fulfillment balance failure.
- `INSUFFICIENT_REMAINING_MEALS`, `INSUFFICIENT_REGULAR_MEALS`, `INSUFFICIENT_PREMIUM_MEALS`: manual deduction balance failures.
- `SUBSCRIPTION_NOT_FOUND`, `SUBSCRIPTION_NOT_ACTIVE`, `CUSTOMER_NOT_FOUND`: manual deduction/search failures.
- `DELIVERY_ALREADY_DEDUCTED_TODAY`: second manual deduction on delivery-mode subscription in same business date.
- `CREDITS_RELEASED`, `CREDITS_CONSUMED`, `CREDITS_NOT_RESERVED`, `INVALID_PICKUP_REQUEST_STATE`: pickup reservation/settlement state failures.
- `PREMIUM_PAYMENT_REQUIRED`, `PREMIUM_OVERAGE_PAYMENT_REQUIRED`, `ONE_TIME_ADDON_PAYMENT_REQUIRED`, `PLANNER_UNCONFIRMED`, `PLANNING_INCOMPLETE`, `LOCKED`: day execution/planner validation failures.

Dashboard should show these as actionable messages and refresh the item after `INVALID_TRANSITION`, payment, or credit errors.

## Dashboard Team Contract

Recommended endpoint usage:

- Use `/api/dashboard/kitchen/queue` and `/api/dashboard/kitchen/queue/:dayId` for legacy board item/detail; these now include the additive structured fields.
- Use `/api/dashboard/pickup/queue` for pickup board and `/api/dashboard/courier/queue` or `/api/dashboard/delivery-schedule` for courier/delivery.
- Treat `/api/kitchen/operations/list` as summary/list UI data only today; it is not a complete kitchen preparation contract.

Identity fields:

- Subscription days: `entityType`, `entityId`, `subscriptionDayId`, `subscriptionId`, `user/customer`, `date`, `status`.
- Orders: `entityType: "order"`, `orderId`, `customer`, `date`, `status`, `paymentStatus`.
- Pickup requests: `entityType: "subscription_pickup_request"`, `requestId`, `subscriptionId`, `subscriptionDayId`, `mealCount`, `status`, pickup code fields.

Preparation fields:

- Current safest source is legacy board detail `mealSlots`, `materializedMeals`, add-ons, and premium selections.
- Do not infer protein grams from plan name. Use `plan.proteinGrams` and meal-slot `proteinGrams`.
- Add-ons must be displayed separately from meal count.
- Premium meals should use `isPremium`, `premiumKey`, and `premiumSource` from meal slots/materialized meals when present.

Payment and action fields:

- For orders, require `paymentStatus === "paid"` and non-empty allowed actions.
- For subscription days, do not assume payment-validity from display text. Use additive `paymentValidity`.
- Use `allowedActions` as operational affordances, but be prepared for backend rejection on stale status, role, payment, or credit state.

Actions and roles:

- Admin/superadmin: full operational/admin actions including reopen/manual deduction.
- Kitchen: prepare/ready/fulfill pickup where allowed by final service checks.
- Courier: delivery dispatch/notify/fulfill where allowed.
- Manual deduction: admin only.

Optional/future additions:

- `plan`, `kitchenDetails`, `paymentValidity`, `delivery.deliveryId`, and richer pickup branch/location details are additive backend fields. Older clients can ignore them.

## Tests Run

Passed:

- `NODE_ENV=test node tests/subscriptionFulfillmentPolicy.test.js`
- `NODE_ENV=test node tests/subscriptionDateLockPermissionsHardening.test.js`
- `NODE_ENV=test node tests/subscriptionPlannerPaymentLifecycle.test.js`
- `npm run test:subscriptions`
- `NODE_ENV=test node tests/kitchen_operations_mapper.test.js`

Blocked locally:

- `NODE_ENV=test node tests/dashboardManualDeductionAndOrderPickup.test.js`
- `NODE_ENV=test node tests/dashboardKitchenQueueActions.test.js`
- `NODE_ENV=test node tests/subscriptionPickupRequestOps.test.js`
- `NODE_ENV=test node tests/orderDeliveryLifecycleFixes.test.js`
- `NODE_ENV=test node tests/oneTimeOrderOps.test.js`

Blocker reason: MongoDB was not listening on `127.0.0.1:27017`. An initial run was also blocked by the repo DB safety guard because the environment pointed at database `basicdiet145`; rerunning with `MONGO_URI=mongodb://localhost:27017/basicdiet_test` then failed with `ECONNREFUSED`.

Discovered relevant tests:

- `tests/orderDeliveryLifecycleFixes.test.js`
- `tests/fulfillmentStatusEndpoint.test.js`
- `tests/subscriptionPickupRequestRoutes.test.js`
- `tests/subscriptionPickupRequestBalanceService.test.js`
- `tests/subscriptionFulfillmentPolicy.test.js`
- `tests/opsSearchService.test.js`
- `tests/dashboardManualDeductionAndOrderPickup.test.js`
- `tests/subscriptionPlannerPaymentLifecycle.test.js`
- `tests/subscriptionDateLockPermissionsHardening.test.js`
- `tests/fulfillmentContract.test.js`
- `tests/subscriptionPickupRequestOps.test.js`
- `tests/oneTimeOrderOps.test.js`
- `tests/subscriptionPickupRequestSettlement.test.js`
- `tests/subscriptionFulfillmentConcurrency.test.js`

## Required Future Backend Tests

Additional integration tests to add when MongoDB-backed dashboard tests are available:

1. Operations board response includes plan/package details.
2. A 200g protein subscription appears with structured `proteinGrams = 200`.
3. Operations detail includes full meal slot selections with product/protein/carb/salad/options.
4. Premium meal appears as premium but still counts as one meal.
5. Add-ons appear in kitchen details but do not count as extra subscription meals.
6. Pending unpaid payment item is not fulfillable.
7. Superseded/stale payment item is not fulfillable.
8. Paid/applied item is fulfillable when other transition rules pass.
9. Delivery item includes delivery id/date/type/status.
10. Pickup item includes branch/count/reserved/remaining-balance context.
11. Manual deduction history/detail exposes count, before/after balance, admin actor, reason, and notes.
12. Manual deduction plus fulfillment cannot double-consume balance.

## Remaining Risks

- There are multiple operations surfaces with different response contracts. Dashboard teams can accidentally use the display-oriented kitchen list for preparation and miss source-of-truth details.
- Plan/protein grams are now returned in the updated operations responses through additive `plan` and `kitchenDetails` fields.
- Subscription-day payment validity is now exposed through additive `paymentValidity` fields, while existing action validators remain authoritative.
- Manual deduction intentionally bypasses day planning and changes only balance; future planned days can become stale after admin/cashier deductions.
- DB-backed integration tests could not be run in this environment because MongoDB was unavailable.

## Backend Ops Payload Fix Result

Implementation date: 2026-06-11

Endpoints updated with non-breaking additive fields:

- `GET /api/dashboard/kitchen/queue`
- `GET /api/dashboard/kitchen/queue/:dayId`
- `GET /api/dashboard/courier/queue`
- `GET /api/dashboard/courier/queue/:dayId`
- `GET /api/dashboard/pickup/queue`
- `GET /api/dashboard/pickup/queue/:dayId`
- `GET /api/dashboard/ops/list`
- `GET /api/dashboard/ops/search`
- `GET /api/kitchen/operations/list`

Fields added:

- `fulfillmentType`
- `plan`
- `kitchenDetails`
- `paymentValidity`
- expanded `delivery` identity fields: `deliveryId`, `date`, `status`, `address`, `window`, `zoneId`, `courierId`
- expanded `pickup` identity fields: `pickupRequestId`, `branchId`, `locationId`, `mealCount`, `reserved`, `consumed`, `released`, `pickupCodeState`, `remainingMeals`

Source of truth for `proteinGrams`:

- `plan.proteinGrams` and `kitchenDetails.mealSlots[].proteinGrams` come from `Subscription.selectedGrams`.
- Example: when `Subscription.selectedGrams = 200`, the operations payload exposes `plan.proteinGrams = 200` and `plan.portionSize = "200g"`.
- The backend does not parse or infer grams from plan display text.

How `kitchenDetails` is built:

- Subscription day meal slots are mapped from `SubscriptionDay.mealSlots`.
- Slot product/protein display fields prefer slot snapshots such as `confirmationSnapshot`, `displaySnapshot`, and `fulfillmentSnapshot` when present.
- Carb selections come from `carbSelections`, `carbs`, or legacy `carbId`.
- Sauce and sides are derived from structured selected option group keys.
- Add-ons are emitted separately under `kitchenDetails.addons` from `addonSelections`, `oneTimeAddonSelections`, and `recurringAddons`.
- Premium state remains slot metadata through `isPremium`, `premiumKey`, and `premiumSource`; it is not counted as another meal slot.

How `paymentValidity` is derived:

- Subscription-day payment validity uses `subscriptionDayCommercialStateService.buildDayCommercialState`.
- It also inspects raw slot/add-on sources for `pending_payment` so locked or ready days still expose unpaid states.
- Superseded and revision mismatch states are surfaced from payment/commercial metadata when present.
- `canPrepare` and `canFulfill` are read-side booleans derived from payment validity plus current status. They do not bypass existing action validators.

Tests added/updated:

- Added `tests/opsPayloadService.test.js`.
- Updated `tests/kitchen_operations_mapper.test.js` to assert `plan`, `kitchenDetails`, `paymentValidity`, and `delivery` survive kitchen row mapping and sanitization.

Example response snippet:

```json
{
  "entityType": "subscription_day",
  "subscriptionId": "sub1",
  "subscriptionDayId": "day1",
  "fulfillmentType": "home_delivery",
  "plan": {
    "id": "plan1",
    "key": "monthly_fit",
    "name": "Monthly Fit",
    "daysCount": 28,
    "durationDays": 28,
    "totalMeals": 56,
    "remainingMeals": 42,
    "selectedMealsPerDay": 2,
    "deliveryMode": "delivery",
    "proteinGrams": 200,
    "portionSize": "200g"
  },
  "kitchenDetails": {
    "mealSlots": [
      {
        "slotIndex": 1,
        "slotKey": "slot_1",
        "selectionType": "premium_meal",
        "productId": "product1",
        "productKey": "basic_meal",
        "productName": "Basic Meal",
        "proteinId": "protein1",
        "proteinName": "Beef",
        "proteinGrams": 200,
        "carbSelections": [{ "carbId": "carb1", "grams": 150 }],
        "isPremium": true,
        "premiumKey": "beef_premium",
        "premiumSource": "paid",
        "quantity": 1
      }
    ],
    "addons": [{ "id": "addon1", "name": "Protein Bar", "quantity": 2, "priceHalala": 1200 }]
  },
  "paymentValidity": {
    "paymentRequired": false,
    "paymentStatus": "not_required",
    "paymentApplied": false,
    "pendingUnpaid": false,
    "superseded": false,
    "revisionMismatch": false,
    "canPrepare": false,
    "canFulfill": true,
    "reason": null
  }
}
```

Remaining risks after fix:

- One-time order `kitchenDetails` is normalized from existing `Order.items`; subscription plan fields intentionally remain `null` for one-time orders.
- DB-backed dashboard integration tests still require a running local MongoDB.
- Manual deduction history remains in `ActivityLog`; no new manual-deduction history route was added.
