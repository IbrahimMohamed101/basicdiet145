# Fulfillment Logic Audit

## Executive Summary

The backend currently has three overlapping fulfillment surfaces:

- The newer dashboard ops surface: `/api/dashboard/ops/actions/:action`, `/api/dashboard/:screen/actions/:action`, and `/api/dashboard/orders/:orderId/actions/:action`.
- Legacy kitchen/courier routes: `/api/kitchen/...` and `/api/courier/...`.
- Client subscription pickup routes: `/api/subscriptions/:id/days/:date/pickup/...`.

Subscription fulfillment is mostly consistent with `TOTAL_BALANCE_WITHIN_VALIDITY`: reads do not settle past days, `no_show` does not deduct, skip/freeze do not deduct, and `remainingMeals` is deducted only by `fulfillSubscriptionDay()` or cashier/manual consumption. The main safety risk is concurrency around duplicate fulfillment: `fulfillSubscriptionDay()` is idempotent after one caller writes the fulfilled snapshot, but two concurrent fulfillments can both pass the pre-update checks and both call the credit deduction path.

Pickup and delivery share several statuses but not one clean action contract. Subscriptions use `in_preparation`, while older order kitchen/dashboard policy code still references legacy `preparing` in some places. Newer one-time order dashboard routes use `in_preparation` and `cancelled`, but legacy kitchen/courier order routes still use `preparing` and `canceled`; because the `Order` model normalizes legacy values before validation, some legacy writes still work but the route-level checks and queue filters are inconsistent.

One-time orders are not fully pickup-only in backend code. New order quote/create/checkouts reject delivery unless `ONE_TIME_ORDER_DELIVERY_ENABLED=true`, but dashboard order ops, courier order routes, order pricing, dashboard lists, and queue filters still support delivery orders if such records exist. This is an exposed product mismatch unless the frontend hides delivery actions and the backend keeps the feature flag disabled.

Top issues found:

- `/api/dashboard/:screen/actions/:action` sends order actions to the generic `opsTransitionService`, which still writes legacy order statuses (`preparing`, `canceled`) and is incompatible with the current `Order` enum (`in_preparation`, `cancelled`).
- `opsActionPolicy` still lists order `preparing`/`canceled`, so unified DTO allowed actions for orders can disagree with `orderOpsTransitionService`.
- Legacy `/api/kitchen/orders` and `/api/courier/orders` still expose one-time order delivery operations.
- One-time order dashboard `notify_arrival` is allowed for delivery orders but only logs activity; it does not create/update a `Delivery` reminder timestamp.
- `fulfillSubscriptionDay()` can double-deduct under concurrent calls because the day status update and credit deduction are not a single atomic operation.

## Scope

Inspected files/services/routes:

- Models: `src/models/Subscription.js`, `src/models/SubscriptionDay.js`, `src/models/Order.js`, `src/models/Delivery.js`, `src/models/ActivityLog.js`, `src/models/SubscriptionAuditLog.js`
- State/constants: `src/utils/state.js`, `src/utils/orderState.js`, `src/services/deliveryWorkflowService.js`
- Subscription fulfillment: `src/services/fulfillmentService.js`, `src/services/subscription/subscriptionDayConsumptionService.js`, `src/services/subscription/subscriptionDayFulfillmentStateService.js`, `src/services/subscription/subscriptionDayCommercialStateService.js`, `src/services/subscription/subscriptionTimelineService.js`, `src/services/subscription/pastSubscriptionDaySettlementService.js`, `src/services/subscription/subscriptionSelectionService.js`, `src/services/subscription/subscriptionPickupClientService.js`, `src/services/subscription/subscriptionSkipClientService.js`, `src/services/subscription/subscriptionFreezeClientService.js`
- Pickup/kitchen: `src/controllers/kitchenController.js`, `src/controllers/kitchenOperationsController.js`, `src/services/kitchenOperations/KitchenOperationsDataService.js`, `src/services/kitchenOperations/KitchenOperationsMapper.js`, `src/services/kitchenOperations/KitchenOperationsActionResolver.js`, `src/services/kitchenOperations/KitchenOperationsStatusResolver.js`, `src/services/kitchenOperations/KitchenOperationsListService.js`
- Dashboard ops: `src/controllers/dashboard/opsActionController.js`, `src/controllers/dashboard/opsBoardController.js`, `src/services/dashboard/opsReadService.js`, `src/services/dashboard/opsTransitionService.js`, `src/services/dashboard/opsActionPolicy.js`, `src/services/dashboard/dashboardDtoService.js`, `src/services/dashboard/opsSearchService.js`, `src/services/dashboard/cashierConsumptionService.js`
- Delivery/courier: `src/controllers/courierController.js`, `src/controllers/orderCourierController.js`, `src/services/deliveryOperationsService.js`
- One-time orders: `src/controllers/orderController.js`, `src/controllers/orderKitchenController.js`, `src/controllers/dashboard/orderDashboardController.js`, `src/services/orders/orderOpsTransitionService.js`, `src/services/orders/orderDashboardService.js`, `src/services/orders/orderSerializationService.js`, `src/routes/orders.js`, `src/routes/dashboardOrders.js`
- Routes: `src/routes/index.js`, `src/routes/dashboardBoards.js`, `src/routes/dashboardOps.js`, `src/routes/dashboardOrders.js`, `src/routes/orders.js`, `src/routes/subscriptions.js`, `src/routes/kitchen.js`, `src/routes/courier.js`
- Automation: `src/services/automationService.js`
- Tests/docs sampled: `tests/oneTimeOrderOps.test.js`, `tests/subscriptionBalancePolicy.test.js`, `tests/dashboardAdminEndpoints.test.js`, `tests/pastSubscriptionDaySettlement.test.js`, `tests/kitchen_operations_mapper.test.js`, `docs/dashboard-api/DASHBOARD_FRONTEND_INTEGRATION_GUIDE_AR.md`, `docs/one-time-orders/ONE_TIME_ORDER_DASHBOARD_OPS_FLOW.md`, `docs/one-time-orders/ONE_TIME_ORDER_MOBILE_FLOW.md`, `docs/dashboard-api/endpoint-matrix.md`, `docs/dashboard-api/postman.dashboard_full_collection.json`

## Current Statuses

### SubscriptionDay statuses

| Status | Meaning in current code | Final? | Consumes remainingMeals? | Appears in kitchen? | Appears in pickup? | Appears in courier? | Notes |
|---|---|---:|---:|---:|---:|---:|---|
| `open` | Day exists and can be planned/locked/prepared by ops policy | No | No | Yes | No by default | No by default | Pickup client prepare changes `open -> locked`. |
| `locked` | Operational snapshot locked; delivery can dispatch or pickup can start prep if pickup requested | No | No | Yes | Yes | No by default | Legacy kitchen lock excludes pickup unless client requested pickup. |
| `in_preparation` | Kitchen started prep | No | No | Yes | Yes | Yes for delivery/courier boards | Subscription canonical prep status. |
| `ready_for_pickup` | Pickup prepared and usually pickup code issued | No | No | Yes | Yes | No | `fulfill` deducts; `no_show` does not. |
| `out_for_delivery` | Delivery dispatched | No | No | Yes | No | Yes | `fulfill`/delivered deducts. |
| `fulfilled` | Actual handover/delivery completed | Yes | Yes | Yes | Yes | Yes | Deduction happens through `fulfillSubscriptionDay()`. |
| `delivery_canceled` | Delivery failed/canceled after dispatch | Final-ish, reopenable | No | Yes | No | Yes | `opsActionPolicy` permits admin `reopen`. |
| `canceled_at_branch` | Pickup canceled at branch | Final-ish, reopenable | No unless legacy restoration path sees old `creditsDeducted` | Yes | Yes | No | Legacy cancel-at-branch can restore credits if old state had already deducted. |
| `no_show` | Pickup customer did not collect | Final-ish, reopenable | No | Yes | Yes | No | Current code explicitly sets `deductedCredits=0`. |
| `skipped` | User/admin skipped day | Final for ops policy except cancel anomaly | No | Excluded from kitchen ops list | No | No | `opsActionPolicy` still returns `cancel` for skipped subscription days. |
| `frozen` | Frozen day | Final for ops policy except cancel anomaly | No | Excluded from kitchen ops list | No | No | `opsActionPolicy` still returns `cancel` for frozen subscription days. |
| `consumed_without_preparation` | Legacy auto-settlement status | Yes | Legacy only if rollback enabled | Some reads include past dates | No default | No default | Auto-settlement is disabled unless env rollback is enabled. |

### One-Time Order statuses

| Status | Meaning in current code | Final? | Pickup-only launch compatible? | Appears in dashboard? | Appears in ops? | Notes |
|---|---|---:|---:|---:|---:|---|
| `pending_payment` | Checkout created; not operational | Terminal by `isFinalOrderStatus()` naming bug? No actions | Yes | Yes | Not in ops default | `isFinalOrderStatus` actually checks terminal set, not this value. |
| `confirmed` | Paid and ready for kitchen prepare | No | Yes | Yes | Yes | Dashboard order service requires `paymentStatus=paid`. |
| `in_preparation` | Current order prep status | No | Yes | Yes | Yes | New order service uses this; some legacy services still expect `preparing`. |
| `ready_for_pickup` | Pickup order ready | No | Yes | Yes | Yes | `fulfill` sets `pickup.pickedUpAt`. |
| `out_for_delivery` | Delivery order dispatched | No | No for launch | Yes | Yes | Product mismatch if exposed. |
| `fulfilled` | Completed | Yes | Yes | Yes | Sometimes in courier views | No subscription balance impact. |
| `cancelled` | Current canceled spelling | Yes | Yes | Yes | Some newer views | Legacy order routes still write/check `canceled`. |
| `expired` | Payment/order expired | Yes | Yes | Yes | No | No ops actions. |
| `preparing` | Legacy status | Not in current enum; normalized to `in_preparation` before validate | Compatible only as alias | Legacy kitchen ops | Legacy kitchen ops | Still appears in action policy/mappers/routes. |
| `canceled` | Legacy status | Normalized to `cancelled` before validate in model | Compatible only as alias | Legacy kitchen/courier code | Legacy kitchen ops | Route checks may compare against `canceled` and miss `cancelled`. |

## Current Action Matrix -- Subscriptions

| Action | Endpoint | Source/entityType | Allowed from | Result status | Role | Deducts remainingMeals? | Logs? | Notes |
|---|---|---|---|---|---|---:|---|---|
| Client pickup prepare | `POST /api/subscriptions/:id/days/:date/pickup/prepare` | subscription day | `open` only | `locked` | client auth | No | `ActivityLog` via `writeLogSafely` | Requires active pickup subscription, current business date, restaurant policy, day execution validation, complete planning/credits. |
| lock | `POST /api/kitchen/subscriptions/:id/days/:date/lock`, `POST /api/kitchen/days/:date/lock` | subscription day | `open` | `locked` | kitchen/admin | No | `ActivityLog` only | Delivery days only in bulk lock; pickup needs client prepare first. |
| prepare | `POST /api/dashboard/ops/actions/prepare`, `POST /api/dashboard/:screen/actions/prepare`, `POST /api/kitchen/subscriptions/:id/days/:date/in-preparation` | `subscription_day` / `subscription` | `open` or `locked` by policy/state; kitchen route uses `locked -> in_preparation` | `in_preparation` | admin/kitchen | No | Dashboard: `ActivityLog`, `SubscriptionAuditLog`, operation audit. Kitchen: `ActivityLog`, operation audit | Dashboard prepare from `open` may bypass locked snapshot for delivery; pickup requires `pickupRequested`. |
| ready_for_pickup | Dashboard ops/actions or `/api/kitchen/subscriptions/:id/days/:date/ready-for-pickup` | subscription day | `in_preparation` | `ready_for_pickup` | admin/kitchen | No | Dashboard: `ActivityLog`, `SubscriptionAuditLog`, operation audit. Kitchen: `ActivityLog`, operation audit + notification | Issues pickup code. Requires pickup mode and pickup request. |
| dispatch | Dashboard ops/actions or `/api/kitchen/subscriptions/:id/days/:date/out-for-delivery` | subscription day | `in_preparation` (state also permits `locked -> out_for_delivery`) | `out_for_delivery` | admin/kitchen/courier | No | Dashboard: `ActivityLog`, `SubscriptionAuditLog`, operation audit + notification. Kitchen: `ActivityLog`, operation audit | Creates/upserts `Delivery`. Dashboard path blocks pickup. |
| notify_arrival | `POST /api/dashboard/ops/actions/notify_arrival`, `PUT /api/courier/deliveries/:id/arriving-soon` | subscription day/delivery | Dashboard policy: `out_for_delivery`; courier delivery status `scheduled` or `out_for_delivery` | No day status change | admin/courier | No | Dashboard writes `ActivityLog`; courier writes delivery `ActivityLog` | Dashboard requires existing `Delivery` and sets `arrivingSoonReminderSentAt`. Courier route is idempotent. |
| fulfill | Dashboard ops/actions, `/api/kitchen/subscriptions/:id/days/:date/fulfill-pickup`, `/api/kitchen/pickups/:dayId/verify`, `PUT /api/courier/deliveries/:id/delivered` | subscription day/delivery | `ready_for_pickup` or `out_for_delivery` | `fulfilled` | pickup: admin/kitchen; delivery: admin/courier | Yes | Dashboard: `ActivityLog`, `SubscriptionAuditLog`, operation audit. Kitchen/courier: `ActivityLog`, operation audit | Calls `fulfillSubscriptionDay()`. Pickup kitchen endpoint requires verification if code exists. |
| cancel | `POST /api/dashboard/ops/actions/cancel` | subscription day | Delivery: `locked`, `in_preparation`, `out_for_delivery`; pickup: `locked`, `in_preparation`, `ready_for_pickup`; policy also exposes some invalid cases | `delivery_canceled` or `canceled_at_branch`; `no_show` if `payload.noShow` | admin/kitchen/courier by policy, with role/mode checks | No | `ActivityLog`, `SubscriptionAuditLog`, operation audit | `payload.reason`, `payload.note(s)` optional in code but action metadata says reason required. |
| cancel at branch | `POST /api/kitchen/subscriptions/:id/days/:date/cancel-at-branch` | subscription day | `locked`, `in_preparation`, `ready_for_pickup` | `canceled_at_branch` | kitchen/admin | No; restores only old deducted credits | `ActivityLog`, operation audit | Requires pickup mode. |
| no_show | `POST /api/kitchen/pickups/:dayId/no-show`; dashboard cancel with `payload.noShow=true` | subscription day | `ready_for_pickup` | `no_show` | kitchen/admin; dashboard admin/kitchen | No | Kitchen: `ActivityLog`, operation audit. Dashboard cancel: `ActivityLog`, `SubscriptionAuditLog` | Kitchen route requires pickup mode and `pickupRequested`; dashboard path does not require explicit no-show action id. |
| reopen | `POST /api/dashboard/ops/actions/reopen`, `POST /api/kitchen/subscriptions/:id/days/:date/reopen` | subscription day | Dashboard: `delivery_canceled`, `canceled_at_branch`, `no_show`; kitchen: `locked` only | Dashboard: `open`; kitchen: `open` | admin only for dashboard; kitchen/admin legacy route | No | Dashboard: `ActivityLog`, `SubscriptionAuditLog`, operation audit. Kitchen: `ActivityLog` | Kitchen reopen deletes deliveries and refuses pickup/credited days. |
| skip | `POST /api/subscriptions/:id/days/skip`, `POST /api/subscriptions/:id/days/:date/skip`, admin route equivalents | subscription day | Future active modifiable day | `skipped` | client/admin depending route | No | `ActivityLog`; skip service may update compensation | Uses skip policy/cutoff; does not reduce `remainingMeals`. |
| unskip | `POST /api/subscriptions/:id/days/:date/unskip`, admin route equivalents | subscription day | `skipped` future day | `open` | client/admin depending route | No | `ActivityLog` | Removes `canonicalDayActionType`. |
| freeze | `POST /api/subscriptions/:id/freeze`, admin route equivalents | subscription/days | Future `open`/already `frozen` dates | `frozen` | client/admin depending route | No | `ActivityLog` on subscription | Enforces freeze max days/blocks and cutoff. |
| unfreeze | `POST /api/subscriptions/:id/unfreeze`, admin route equivalents | subscription/days | `frozen` future dates | `open` | client/admin depending route | No | `ActivityLog` when changed | Syncs validity. |
| cashier/manual consumption | `POST /api/dashboard/ops/cashier/customer-consumption` | subscription | active subscription within validity | subscription status unchanged | admin/kitchen/cashier | Yes | `ActivityLog` + `SubscriptionAuditLog` | Body: `phone`, `mealCount`, optional `subscriptionId`, `note`. |

## Current Action Matrix -- One-Time Orders

| Action | Endpoint | Source/entityType | Allowed from | Result status | Role | Pickup-only compatible? | Logs? | Notes |
|---|---|---|---|---|---|---:|---|---|
| prepare | `POST /api/dashboard/orders/:orderId/actions/prepare`, `POST /api/dashboard/ops/actions/prepare` with `entityType=order` | `one_time_order`/`order` | `confirmed` and `paymentStatus=paid` | `in_preparation` | admin/kitchen | Yes | `ActivityLog` | Order-specific service is current and authoritative. |
| ready_for_pickup | dashboard order/ops order actions | order | pickup `in_preparation` | `ready_for_pickup` | admin/kitchen | Yes | `ActivityLog` | Generates/accepts pickup code. |
| dispatch | dashboard order/ops order actions | order | delivery `in_preparation` | `out_for_delivery` | admin/kitchen/courier | No | `ActivityLog` | Exposed for delivery orders despite pickup-only launch. Does not create a `Delivery` document in order-specific service. |
| notify_arrival | dashboard order/ops order actions | order | delivery `out_for_delivery` | `out_for_delivery` | admin/courier | No | `ActivityLog` | Does not update `Delivery.arrivingSoonReminderSentAt`; unlike courier route. |
| fulfill | dashboard order/ops order actions | order | pickup `ready_for_pickup`; delivery `out_for_delivery` | `fulfilled` | pickup: admin/kitchen; delivery: admin/courier | Pickup yes; delivery no | `ActivityLog` | Sets `fulfilledAt`; pickup also sets `pickup.pickedUpAt`. |
| cancel | dashboard order/ops order actions | order | `confirmed`, `in_preparation`, `ready_for_pickup`, `out_for_delivery` depending mode | `cancelled` | admin only in order service | Yes for pickup; delivery no | `ActivityLog` | Reason optional in code. |
| reopen | dashboard order/ops order actions | order | unsupported | none | none | Yes | No | Returns `REOPEN_NOT_SUPPORTED`. |
| legacy kitchen order preparing | `POST /api/kitchen/orders/:id/preparing` | order | legacy `confirmed -> preparing` | normalized to `in_preparation` on save | kitchen/admin | Yes | `ActivityLog` | Uses legacy status name in route. |
| legacy kitchen order out-for-delivery | `POST /api/kitchen/orders/:id/out-for-delivery` | order | `in_preparation` via normalization | `out_for_delivery` | kitchen/admin | No | `ActivityLog` + `Delivery` upsert | Product mismatch. |
| legacy courier order delivered/cancel | `PUT /api/courier/orders/:id/delivered`, `/cancel` | order/delivery | `out_for_delivery` | `fulfilled` or legacy `canceled` normalized to `cancelled` | courier/admin | No | `ActivityLog` + notifications | Product mismatch and spelling inconsistency. |

## Subscription Pickup Flow -- Current Behavior

1. A pickup subscription day enters operational flow only after the client calls `POST /api/subscriptions/:id/days/:date/pickup/prepare`.
2. The day must be `open`, belong to the authenticated user, be in a pickup subscription, be the current restaurant business date, pass restaurant/pickup policy, and pass day execution validation.
3. Client prepare sets `pickupRequested=true`, `pickupRequestedAt`, `status=locked`, clears `dayEndConsumptionReason`, creates/locks a snapshot, and logs `pickup_prepare`. It does not deduct meals.
4. Kitchen/dashboard prepare changes `locked -> in_preparation`; dashboard policy also says `open -> prepare` is allowed, but pickup handling requires `pickupRequested`.
5. `ready_for_pickup` requires pickup mode, `pickupRequested`, and `in_preparation`. It sets `pickupPreparedAt`, issues a pickup code, logs, and notifies the user on the legacy kitchen route.
6. Fulfillment can happen by verifying the pickup code at `POST /api/kitchen/pickups/:dayId/verify`, by `POST /api/kitchen/subscriptions/:id/days/:date/fulfill-pickup` after verification, or by dashboard `fulfill` with optional `payload.pickupCode`.
7. `fulfillSubscriptionDay()` sets `fulfilled`, `fulfilledAt`, `pickupRequested=false`, stores `fulfilledSnapshot`, and deducts `remainingMeals`.
8. `no_show` is `POST /api/kitchen/pickups/:dayId/no-show` from `ready_for_pickup`. It sets `status=no_show`, `pickupRequested=false`, `pickupNoShowAt`, logs, and explicitly deducts zero meals.
9. `cancel_at_branch` is allowed from `locked`, `in_preparation`, or `ready_for_pickup`, sets `canceled_at_branch`, and does not deduct meals. It only restores credits if an old record already had `creditsDeducted=true`.
10. If the customer does not collect and staff mark no-show, the meal balance remains unchanged under the current policy.

Representative response shapes:

- Client pickup prepare: `{ status: true, data: { subscriptionId, date, currentStep, status: "locked", pickupRequested: true, nextAction: "poll_pickup_status" } }`
- Pickup verify: `{ status: true, data: <SubscriptionDay>, verified: true, alreadyFulfilled: <boolean> }`
- No-show: `{ status: true, data: <SubscriptionDay>, deductedCredits: 0, restoreCreditsPolicy: false }`

## Subscription Delivery Flow -- Current Behavior

1. Delivery subscription days are commonly locked by `POST /api/kitchen/days/:date/lock` or individual `POST /api/kitchen/subscriptions/:id/days/:date/lock`, which creates a locked snapshot.
2. Kitchen/dashboard prepare changes the day to `in_preparation`.
3. Dispatch changes `in_preparation -> out_for_delivery`, creates/upserts a `Delivery` record, and sends a delivery notification in the dashboard path.
4. `notify_arrival` sets `Delivery.arrivingSoonReminderSentAt` and sends/logs a reminder. The day status remains `out_for_delivery`.
5. Fulfillment via dashboard `fulfill` or courier `PUT /api/courier/deliveries/:id/delivered` calls `fulfillSubscriptionDay()` and sets `Delivery.status=delivered`.
6. Cancellation via dashboard cancel sets the day to `delivery_canceled`; courier `PUT /api/courier/deliveries/:id/cancel` requires day status `out_for_delivery`, writes cancellation fields on both day and delivery, and notifies.
7. `remainingMeals` is deducted only when `fulfillSubscriptionDay()` succeeds.
8. Failed/canceled delivery does not deduct meals.

## One-Time Order Pickup Flow -- Current Behavior

1. A paid pickup order with `status=confirmed` and `paymentStatus=paid` appears in `/api/dashboard/orders`, dashboard boards, and kitchen operations/order tabs depending the route/filter.
2. `prepare` changes `confirmed -> in_preparation`, sets `preparationStartedAt`, and writes `ActivityLog` action `dashboard_order_prepare`.
3. `ready_for_pickup` requires pickup mode and `in_preparation`, sets `readyAt`, `pickup.readyAt`, and `pickup.pickupCode`, then logs.
4. `fulfill` requires pickup `ready_for_pickup`, sets `fulfilled`, `fulfilledAt`, and `pickup.pickedUpAt`, then logs.
5. `cancel` is admin-only in the order-specific dashboard service and sets `cancelled`, cancellation fields, and logs.
6. One-time orders never touch subscription `remainingMeals`.

## One-Time Order Delivery Flow -- Current Code Behavior

Delivery code is still present:

- Order pricing supports `fulfillmentMethod=delivery`.
- New quote/create/checkout paths reject delivery unless `ONE_TIME_ORDER_DELIVERY_ENABLED=true`.
- Dashboard order actions support delivery `dispatch`, `notify_arrival`, `fulfill`, and `cancel`.
- Dashboard courier views include delivery one-time orders.
- Legacy `/api/kitchen/orders/:id/out-for-delivery` creates a `Delivery` record for order delivery.
- Legacy `/api/courier/orders/:id/arriving-soon|delivered|cancel` operates order deliveries.

Can dashboard show dispatch/notify-arrival for one-time orders? Yes, for delivery orders. Dedicated `/api/dashboard/orders` uses `orderOpsTransitionService` and returns delivery actions when `fulfillmentMethod=delivery`. The unified board DTO uses `opsActionPolicy`, which can also expose delivery actions, but uses stale order statuses in some branches.

This is a product mismatch for launch. Frontend should hide delivery/courier one-time order controls. Backend should keep creation blocked and should ideally block order delivery ops unless/ until delivery launch is explicitly enabled.

## Queue Inclusion Rules

### Kitchen Queue

- `/api/dashboard/kitchen/queue` default subscription statuses: `open`, `locked`, `in_preparation`, `ready_for_pickup`, `out_for_delivery`, `delivery_canceled`, `canceled_at_branch`; past date additionally includes `consumed_without_preparation`, `no_show`.
- `/api/dashboard/kitchen/queue` default order statuses: `confirmed`, `in_preparation`.
- Method defaults to `all`; filters can restrict `delivery` or `pickup`.
- `/api/kitchen/operations/list?tab=subscriptions` includes subscription days for date where status is not `skipped` or `frozen`.
- `/api/kitchen/operations/list?tab=orders` includes all orders for `deliveryDate` regardless payment status in `KitchenOperationsDataService`.
- Legacy `/api/kitchen/days/:date` returns all subscription days for a date and enriches them.
- Legacy `/api/kitchen/orders/:date` returns all orders for `deliveryDate`.

### Pickup Queue

- `/api/dashboard/pickup/queue` default subscription statuses: `in_preparation`, `ready_for_pickup`, `fulfilled`, `canceled_at_branch`, `no_show`.
- `/api/dashboard/pickup/queue` default order statuses: `in_preparation`, `ready_for_pickup`.
- Method defaults to `pickup`, so only pickup subscription/order rows remain.
- `/api/kitchen/pickups/:date` includes subscription days with statuses `locked`, `in_preparation`, `ready_for_pickup`, `fulfilled`, `canceled_at_branch`, `no_show`, then filters to pickup mode and operational pickup days with a locked/fulfilled snapshot.
- `/api/kitchen/operations/list?tab=branch_pickup` includes subscription days not `skipped`/`frozen`, then filters to pickup rows.

### Courier Queue

- `/api/dashboard/courier/queue` default subscription statuses: `in_preparation`, `out_for_delivery`, `fulfilled`, `delivery_canceled`.
- `/api/dashboard/courier/queue` default order statuses: `in_preparation`, `out_for_delivery`.
- Method defaults to `delivery`, so only delivery subscription/order rows remain.
- `/api/courier/deliveries/today` lists `Delivery` documents whose `dayId` belongs to today's subscription days.
- `/api/courier/orders/today` lists delivery-mode orders for today in legacy statuses `out_for_delivery`, `fulfilled`, `canceled`; because current status is `cancelled`, canceled orders may be missed.

### Delivery Schedule

- `GET /api/dashboard/delivery-schedule` delegates to courier queue with `method=delivery`.
- It groups returned rows by `context.window`/`delivery.deliveryWindow` and by `delivery.zoneId`.
- It includes both subscription delivery rows and delivery one-time order rows if present.
- Summary buckets count pending prep, ready, out-for-delivery, fulfilled, and canceled.

## Response DTO Rules

Unified dashboard DTOs (`dashboardDtoService`) include:

- `source`: `subscription` or `one_time_order`
- `entityType`: `subscription_day` or `order`
- `entityId`, `id`, `type`
- `status`, `statusLabel`, `ui`
- `mode` / `fulfillmentMethod`
- `customer`
- `context.date`, `context.window`, `context.address`, `context.branch`
- `allowedActions`
- subscription context: pickup code, required/specified/unspecified meals, fulfillment mode/state
- order detail DTO: `items`, `pricing`, `payment`, `activity`, `delivery`, `pickup`

Inconsistencies:

- Dedicated `/api/dashboard/orders` returns `allowedActions` as string ids. Unified dashboard DTOs return action objects from `opsActionPolicy`.
- Kitchen operations rows use `entityType`, `meta.orderId/dayId`, `actions`, and `rawStatus`, but sanitized rows omit `rawStatus`, `operationFlags`, and `branchId`.
- `opsReadService.listOperations()` queries orders by `deliveryDate` only, while other services query `deliveryDate` or `fulfillmentDate`.
- `dashboardDtoService.mapOrderToDTO()` still uses `opsActionPolicy`, so order allowed actions can be wrong for current `in_preparation`/`cancelled` statuses.
- `/api/dashboard/:screen/actions/:action` returns `{ action: "dispatched" }` for order actions rather than an updated order DTO.

## RemainingMeals and Consumption Rules

1. Actions that deduct `remainingMeals`: subscription `fulfill` through `fulfillSubscriptionDay()` and cashier/manual consumption through `consumeSubscriptionMealBalance()`.
2. Actions that must not deduct and currently do not under default env: reads, prepare, ready_for_pickup, dispatch, notify_arrival, cancel, no_show, skip, unskip, freeze, unfreeze.
3. `fulfill` deducts by `resolveDayMealsToDeduct()`, preferring `lockedSnapshot.mealsPerDay` or `fulfilledSnapshot.deductedCredits`, then falling back to subscription meals per day.
4. `no_show` does not deduct.
5. `ready_for_pickup` does not deduct.
6. `dispatch` does not deduct.
7. `cancel` does not deduct; legacy cancel-at-branch can restore if old data had already deducted.
8. `skip`/`freeze` do not deduct.
9. `cashier` deducts a raw `mealCount`, not meals per day.
10. Deductions use atomic `$inc` with `remainingMeals: { $gte: amount }`, but audit before/after reads are separate.
11. Duplicate fulfillment is partially idempotent but not fully race-safe. `day.creditsDeducted` is checked on a loaded document and `fulfillSubscriptionDay()` first updates the day to `fulfilled`, then deducts and saves. A concurrent caller that loaded the day before the first commit can also deduct unless Mongo transaction conflicts reliably abort one writer.

Potential violation of `TOTAL_BALANCE_WITHIN_VALIDITY`:

- Default code complies on no-show/reads/skip/freeze.
- Emergency rollback env `SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED=true` would restore old auto-settlement that deducts meals for past days; this must remain off for the current policy.

## Logging / Audit Rules

- `ActivityLog` is written by dashboard ops side effects (`dashboard_<action>`), order dashboard actions (`dashboard_order_*`), legacy kitchen/courier routes, cashier consumption, client pickup prepare, skip/freeze flows, and delivery reminders/cancellations.
- `SubscriptionAuditLog` is written by dashboard subscription ops and cashier consumption. Legacy kitchen/courier subscription routes generally do not write `SubscriptionAuditLog` except old settlement rollback code.
- `operationAuditLog` exists on `SubscriptionDay` and is appended by dashboard subscription ops and legacy kitchen/courier subscription actions.
- One-time orders do not have `operationAuditLog`; they rely on `ActivityLog`.
- Repeated idempotent actions often avoid duplicate state changes, but not all avoid duplicate logs. Order `notify_arrival` logs every call because it is a no-status-change allowed action.

## Error Codes and Validation

| Action | Error code | When returned | Current behavior | Recommendation |
|---|---|---|---|---|
| Any dashboard order action | `INVALID_ORDER_ID` | Bad ObjectId | 400 from order service | Standardize with `INVALID_OBJECT_ID`. |
| Any dashboard order action | `ORDER_NOT_FOUND` | Missing order | 404 | OK. |
| Any dashboard order action | `PAYMENT_NOT_PAID` | Not paid or pending payment | 409 | OK. |
| Any dashboard order action | `FORBIDDEN` | Role not allowed | 403 | OK. |
| Any dashboard order action | `FINAL_STATUS` | Terminal order status | 409 | Docs call this `ORDER_FINAL`; align naming. |
| Order reopen | `REOPEN_NOT_SUPPORTED` | Reopen requested | 409 | OK. |
| Order transition | `INVALID_TRANSITION` | Action not valid for status/mode | 409 | OK. |
| Order delivery action | `INVALID_FULFILLMENT_METHOD` | Pickup action on delivery or vice versa | 409 | OK; use to block product-mismatch delivery actions too. |
| Subscription dashboard action | `INVALID_REQUEST` | Missing `entityId`/`entityType` | 400 | OK. |
| Subscription dashboard action | `INVALID_ENTITY_TYPE` | Unsupported entity type | 400 | OK. |
| Subscription dashboard action | `NOT_FOUND` | Missing day | 404 | OK. |
| Subscription dashboard action | `INSUFFICIENT_PERMISSIONS` | Role not in action registry | 409 from controller validation | Should be 403 `FORBIDDEN`. |
| Subscription dashboard action | `INVALID_STATE_TRANSITION` | Policy rejects or state util rejects | 409 | OK, but code also uses `INVALID_TRANSITION` elsewhere. |
| Pickup prepare/action | `PICKUP_PREPARE_REQUIRED` | Pickup day not client-requested | 409 | OK. |
| Pickup verify | `INVALID_PICKUP_CODE`, `PICKUP_CODE_MISMATCH` | Missing/invalid code | 400/422 depending route | Normalize one code. |
| Fulfillment | `INSUFFICIENT_CREDITS` | Remaining meals too low | 400 in controllers | OK. |
| Courier cancel | `CANCELLATION_REASON_REQUIRED`, `INVALID_CANCELLATION_REASON` | Bad cancellation body | 400 | OK. |
| Read endpoints | none for settlement | Reads intentionally no-op on settlement | Complies | Keep tests. |

## Inconsistencies / Bugs Found

| Severity | Flow | Finding | Evidence/File | Risk | Recommended Fix |
|---|---|---|---|---|---|
| Critical | One-time order board actions | `/api/dashboard/:screen/actions/:action` sends orders to generic `opsTransitionService`, which uses legacy `preparing`/`canceled` and can fail model validation or produce stale DTOs | `opsBoardController.action`, `opsTransitionService.handlePrepare/handleCancel` | Broken order actions from board endpoints | Route all order actions to `orderOpsTransitionService`. |
| High | One-time order statuses | `opsActionPolicy` uses `preparing` and `canceled`, not current `in_preparation`/`cancelled` | `opsActionPolicy` | Allowed actions disagree with actual order service | Update policy or delegate order action resolution to `getAllowedOrderActions()`. |
| High | Product scope | Delivery order ops still exposed if delivery orders exist | `orderOpsTransitionService`, `orderCourierController`, `orderKitchenController`, board queues | Pickup-only launch mismatch | Backend block delivery order ops behind same feature flag. |
| High | Subscription fulfillment | Potential concurrent `fulfillSubscriptionDay()` double deduction | `fulfillmentService`, `subscriptionDayConsumptionService` | Remaining balance can be decremented twice | Make status transition and credit deduction atomic/idempotent with guarded update or transaction retry. |
| Medium | One-time order delivery notify | Dashboard `notify_arrival` for orders logs activity but does not update/create `Delivery` reminder timestamp | `orderOpsTransitionService` | Courier/customer state inconsistent | Either block for launch or implement delivery state sync. |
| Medium | Legacy order spelling | Legacy courier/kitchen order routes compare/write `canceled`; model normalizes to `cancelled` | `orderCourierController`, `orderKitchenController` | Canceled orders missed in queues/idempotency | Migrate legacy routes to current constants. |
| Medium | Queue reads | Kitchen operations order list includes all orders by date, not payment-paid only | `KitchenOperationsDataService.fetchOrdersByDate` | Unpaid orders may appear in ops | Add `paymentStatus=paid` and launch pickup filter. |
| Medium | Dashboard read query | `opsReadService.listOperations()` fetches orders by `deliveryDate` only | `opsReadService` | Orders using only `fulfillmentDate` can be missed | Query both date fields consistently. |
| Medium | Audit trail | Legacy kitchen/courier subscription routes write `ActivityLog` but not `SubscriptionAuditLog` | `kitchenController`, `courierController` | Incomplete audit trail | Add subscription audit logs or deprecate legacy writes. |
| Low | Policy/actions | `opsActionPolicy` exposes `cancel` for `skipped` and `frozen`, but state transitions do not support cancel from those statuses | `opsActionPolicy`, `state.js` | Buttons that fail on click | Remove invalid actions. |
| Low | DTO shape | Dedicated order dashboard actions use string `allowedActions`; unified ops uses action objects | `orderSerializationService`, `dashboardDtoService` | Frontend conditional complexity | Normalize DTO contract. |

## Recommended Corrected Lifecycle

### Recommended Subscription Pickup Lifecycle

`open -> locked(client pickup prepare) -> in_preparation -> ready_for_pickup -> fulfilled`

Optional non-consuming terminal states: `canceled_at_branch`, `no_show`, `skipped`, `frozen`.

Deduct `remainingMeals` only on `fulfilled` or cashier/manual consumption. `no_show`, `canceled_at_branch`, skip, freeze, and all reads must not deduct.

### Recommended Subscription Delivery Lifecycle

`open -> locked -> in_preparation -> out_for_delivery -> fulfilled`

Optional non-consuming terminal state: `delivery_canceled`; admin may reopen back to `open` only if no credits were deducted.

Deduct `remainingMeals` only on `fulfilled` or cashier/manual consumption.

### Recommended One-Time Order Pickup Lifecycle

`pending_payment -> confirmed -> in_preparation -> ready_for_pickup -> fulfilled`

Optional: `cancelled`, `expired`.

No delivery/courier actions for launch. One-time orders must never affect subscription `remainingMeals`.

## Prioritized Fix Plan

### Phase 1 -- Must fix before production

| Item | Affected files | Exact behavior to change | Tests | Frontend impact |
|---|---|---|---|---|
| Block one-time order delivery ops for launch | `orderOpsTransitionService`, `orderDashboardService`, `opsBoardController`, `orderCourierController`, `orderKitchenController` | Hide/reject `dispatch`, `notify_arrival`, delivery `fulfill` for one-time orders unless feature flag enabled | Add tests that delivery order ops return 409/disabled when flag off | Frontend can safely not render delivery controls. |
| Fix board order action routing | `opsBoardController` | Use `executeOrderAction()` for `entityType=order`, return updated DTO | Add `/api/dashboard/kitchen/actions/prepare` order test | Board buttons stop failing. |
| Align order statuses | `opsActionPolicy`, `KitchenOperationsStatusResolver`, `KitchenOperationsActionResolver`, legacy controllers | Replace `preparing`/`canceled` with constants `in_preparation`/`cancelled`, keep read-only legacy aliases | Update one-time order ops and kitchen mapper tests | Fewer status aliases in UI. |
| Make subscription fulfillment deduction idempotent under concurrency | `fulfillmentService`, `subscriptionDayConsumptionService` | Guard deduction on persisted `creditsDeducted:false` atomically or use findOneAndUpdate transaction pattern | Add concurrent fulfill test | No UI impact except safer retries. |

### Phase 2 -- Should fix before scaling ops

| Item | Affected files | Exact behavior to change | Tests | Frontend impact |
|---|---|---|---|---|
| Normalize allowedActions DTOs | `dashboardDtoService`, `orderSerializationService` | Return a consistent action shape or document separate contracts | DTO snapshot tests | Simpler UI action rendering. |
| Add subscription audit logs to legacy routes or disable legacy writes | `kitchenController`, `courierController` | Write `SubscriptionAuditLog` for state changes or redirect to dashboard ops service | Audit log tests | Better audit screens. |
| Fix order queue filters | `KitchenOperationsDataService`, `opsReadService`, `opsBoardController` | Require paid operational orders and query both `fulfillmentDate`/`deliveryDate` | Queue inclusion tests | No unpaid/missing rows. |
| Normalize error code naming | controllers/services/docs | Use `INVALID_TRANSITION`, `FORBIDDEN`, `ORDER_FINAL` or document actual codes | Error contract tests | Fewer frontend mappings. |

### Phase 3 -- Cleanup / docs / monitoring

| Item | Affected files | Exact behavior to change | Tests | Frontend impact |
|---|---|---|---|---|
| Retire legacy `/api/kitchen/orders` and `/api/courier/orders` for one-time orders | `routes/kitchen.js`, `routes/courier.js` | Mark deprecated or remove once frontend migrates | Route deprecation tests | Use dashboard order endpoints only. |
| Remove emergency auto-settlement rollback or guard it harder | `pastSubscriptionDaySettlementService` | Prevent accidental enablement in production | Env guard test | No visible impact. |
| Update API docs/postman | docs files | Match current fixed lifecycle | Docs validation | Cleaner frontend integration. |

## Final Conclusion

Current subscription fulfillment is directionally safe with the new meal-balance policy: normal reads, no-show, skip, freeze, dispatch, and ready-for-pickup do not deduct `remainingMeals`. The policy is not fully production-safe until duplicate fulfillment/deduction is made concurrency-safe.

Pickup fulfillment is usable but split across client prepare, dashboard ops, and legacy kitchen routes. It is safe with respect to meal balance, but not cleanly unified.

Delivery fulfillment is usable for subscriptions, but route surfaces and audit logs are inconsistent. It is acceptable for controlled operations, but should be tightened before production scale.

One-time order pickup-only launch is not fully enforced across backend ops. Creation is feature-gated for delivery, but existing delivery actions and queues still support delivery orders. Backend should block or hide delivery order ops before launch.
