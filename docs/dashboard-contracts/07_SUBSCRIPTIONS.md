# Screen Contract: Subscriptions

## 1. Status

Status: `BACKEND_READY_DASHBOARD_PENDING`

Backend-only Phase 1 is complete. Dashboard integration/rendering is pending; this document does not claim Dashboard readiness. Flutter/mobile contracts are unchanged.

## 2. Screen ownership

Owns subscription list/detail, quote/create, days, delivery defaults, separate regular/premium/add-on balances, add-on entitlements, audit/lifecycle, and lifecycle actions. Manual deduction remains a separate screen/workflow.

## 3. Frontend implementation status

Pending. Use `freeze`/`unfreeze`; `pause`/`resume` do not exist. Both PUT and POST extend are active; PUT is canonical and POST is a compatibility alias.

## 4. Backend authority rules

- Backend pricing, eligibility, balance math, `allowedActions`, and transitions are authoritative.
- Premium upgrades upgrade existing meal slots; they never create extra meals.
- Add-ons are separate and never consume regular/premium meal balance.
- Render regular, premium, and add-on balances separately.
- All calls use `Authorization: Bearer <dashboardToken>`.
- `superadmin` passes every role middleware. Cashier access is limited to endpoints explicitly listed below.
- Error envelope: `{"ok":false,"error":{"code":"...","message":"...","details":{}}}`.

## 5. Active endpoints

| Method/path | Roles | Purpose |
|---|---|---|
| `GET /api/dashboard/subscriptions` | admin, superadmin, cashier | List |
| `GET /api/dashboard/subscriptions/summary` | admin, superadmin, cashier | Counts |
| `GET /api/dashboard/subscriptions/:id` | admin, superadmin, cashier | Detail |
| `POST /api/dashboard/subscriptions/quote` | admin, superadmin | Quote |
| `POST /api/dashboard/subscriptions` | admin, superadmin | Create |
| `GET /api/dashboard/subscriptions/:id/days` | admin, superadmin, cashier | Days |
| `PUT /api/dashboard/subscriptions/:id/delivery` | admin, superadmin | Delivery defaults |
| `GET /api/dashboard/subscriptions/:id/addon-entitlements` | admin, superadmin, cashier | Entitlements |
| `PATCH /api/dashboard/subscriptions/:id/addon-entitlements` | admin, superadmin | Edit entitlements |
| `GET /api/dashboard/subscriptions/:id/balances` | admin, superadmin, cashier | Balances |
| `PATCH /api/dashboard/subscriptions/:id/balances` | superadmin | Edit balances |
| `GET /api/dashboard/subscriptions/:id/audit` | admin, superadmin | Invariant audit |
| `GET /api/dashboard/subscriptions/:id/lifecycle` | admin, superadmin | Timeline |
| `POST /api/dashboard/subscriptions/:id/cancel` | admin, superadmin | Cancel |
| `PUT /api/dashboard/subscriptions/:id/extend` | admin, superadmin | Extend |
| `POST /api/dashboard/subscriptions/:id/extend` | admin, superadmin | Extend alias |
| `POST /api/dashboard/subscriptions/:id/freeze` | admin, superadmin | Freeze range |
| `POST /api/dashboard/subscriptions/:id/unfreeze` | admin, superadmin | Unfreeze range |
| `POST /api/dashboard/subscriptions/:id/days/:date/skip` | admin, superadmin | Skip day |
| `POST /api/dashboard/subscriptions/:id/days/:date/unskip` | admin, superadmin | Unskip day |
| `GET /api/dashboard/subscriptions/search` | admin, superadmin, cashier | Manual screen phone search |
| `POST /api/dashboard/subscriptions/:id/manual-deduction` | admin, superadmin, cashier | Deduct |
| `GET /api/dashboard/subscriptions/:id/manual-deductions` | admin, superadmin, cashier | Deduction history |

## 6. Endpoint details

All `:id`/`:subscriptionId` values are readonly backend ObjectIds. All `:date`, `startDate`, `from`, and `to` values are KSA business dates in `YYYY-MM-DD`; timestamps are ISO datetimes displayed in `Asia/Riyadh`.

### GET /api/dashboard/subscriptions

#### Purpose
Paginated subscription table, newest first.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params

| Param | Type | Required | Frontend control | Options | Default | Notes |
|---|---|---:|---|---|---|---|
| `q` | string | No | text | name, phone, email, exact ID, display ID, plan name | empty | Arabic `بحث` |
| `status` | string | No | select | `active`, `pending_payment`/`pending`, `expired`, `canceled`/`cancelled`, `ended`, `all` | all | `ended` = expired+canceled |
| `page` | integer | No | hidden/computed | >=1 | 1 | pagination |
| `limit` | integer | No | select/hidden | backend pagination limit | 10 | `VERIFY_IN_BACKEND_BEFORE_USE` for maximum |
| `from`, `to` | string | No | date | `YYYY-MM-DD` | empty | KSA date filter |

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions?q=050&status=active&page=1&limit=10
Authorization: Bearer <dashboardToken>
```

#### Success response example
```json
{"status":true,"data":[{"id":"665000000000000000000101","displayId":"SUB-0101","status":"active","user":{"id":"665000000000000000000102","name":"Ahmed","phone":"0500000000"},"plan":{"id":"665000000000000000000103","name":"20 Days"},"remainingMeals":18}],"meta":{"page":1,"limit":10,"total":1,"totalPages":1},"filters":{"q":"050","status":"active","from":null,"to":null}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data` | SubscriptionDTO[] | No | rows | Empty state `لا توجد اشتراكات مطابقة.` |
| `meta` | object | No | paginator | `page`, `limit`, `total`, `totalPages` |
| `filters` | object | No | filter state | normalized backend filters |

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"status must be one of: active, pending_payment, pending, expired, canceled, ended, all"}}
```

#### Frontend notes
Do not locally infer effective status or balances.

### GET /api/dashboard/subscriptions/summary

#### Purpose
Summary cards using the list's `q`, `status`, `from`, and `to` filters.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
Same filters as list except pagination.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/summary?status=active
```

#### Success response example
```json
{"status":true,"data":{"filters":{"q":"","status":"active","from":null,"to":null},"summary":{"totalSubscriptions":25,"activeSubscriptions":20,"pendingSubscriptions":2,"expiredSubscriptions":2,"canceledSubscriptions":1,"endedSubscriptions":3,"selectedStatusCount":20,"totalRemainingMeals":430}}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data.filters` | object | No | hidden | normalized filters |
| `data.summary.*Subscriptions` | integer | No | count cards | backend-owned counts |
| `selectedStatusCount` | integer | Yes | selected card | null without status |
| `totalRemainingMeals` | number | No | readonly count | never recalculate |

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Invalid filter"}}
```

#### Frontend notes
Arabic cards: `إجمالي الاشتراكات`, `نشطة`, `بانتظار الدفع`, `منتهية`, `ملغاة`, `الوجبات المتبقية`.

### GET /api/dashboard/subscriptions/:id

#### Purpose
Hydrate detail and action permissions.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101","status":"active","balances":{"regularMeals":{"total":20,"remaining":16,"consumed":4},"premiumMeals":{"total":3,"remaining":2,"consumed":1},"addons":[]},"premiumSummary":{"total":3,"remaining":2,"consumed":1,"items":[]},"addonsSummary":{"total":0,"remaining":0,"consumed":0,"items":[]},"allowedActions":{"cancel":true,"extend":true,"freeze":true,"unfreeze":false,"skipDay":true,"unskipDay":false,"updateDelivery":true,"editBalances":false}}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data` | SubscriptionDTO | No | detail | Full DTO; section 9 |
| `balances` | object | No | three balance panels | backend-owned |
| `premiumSummary`, `addonsSummary` | object | No | separate summaries | additive Phase 1 fields |
| `allowedActions` | object<boolean> | No | enable/disable actions | advisory; backend revalidates |

#### Error responses
```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Cashier detail is read-only except separate verified manual deduction actions.

### POST /api/dashboard/subscriptions/quote

#### Purpose
Resolve selections and authoritative halala pricing before create.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `userId` | string | Yes | select | active client ID | — | `665...102` | Arabic `العميل` |
| `planId` | string | Yes | select | active plan ID | — | `665...103` | Arabic `الخطة` |
| `grams` | number | Yes | select | plan options | grams | `150` | verified by quote |
| `mealsPerDay` | integer | Yes | select | plan options | meals/day | `1` | verified by quote |
| `startDate` | string | No | date | `YYYY-MM-DD` | KSA date | `2026-07-01` | backend resolves default |
| `delivery.type` | string | Yes | select | `delivery`, `pickup` | — | `delivery` | aliases `deliveryMode`, `deliveryMethod` |
| `delivery.zoneId` | string | Conditional | select | active zone ID | — | `665...104` | delivery; alias `deliveryZoneId`/`zoneId` |
| `delivery.address` | object | Conditional | object-editor | address object | — | `{"line1":"Riyadh"}` | delivery; alias `deliveryAddress`; exact subfields depend on current address DTO |
| `delivery.window` | string | No | select | configured windows | `HH:mm-HH:mm` | `12:00-14:00` | alias `deliveryWindow` |
| `delivery.pickupLocationId` | string | Conditional | select | active location ID | — | `main` | pickup; alias top-level field |
| `premiumItems` | array | No | multi-select | `{premiumKey,qty}` or legacy `{premiumMealId,qty}` | count | `[{"premiumKey":"salmon","qty":2}]` | upgrades only; alias `premiumSelections` |
| `addons` | array | No | multi-select | add-on selection DTO | count | `[{"addonId":"665...105","qty":2}]` | separate; alias `addonPlans` |

#### Request example
```json
{"userId":"665000000000000000000102","planId":"665000000000000000000103","grams":150,"mealsPerDay":1,"startDate":"2026-07-01","delivery":{"type":"delivery","zoneId":"665000000000000000000104","address":{"line1":"Riyadh"},"window":"12:00-14:00"},"premiumItems":[{"premiumKey":"salmon","qty":2}],"addons":[{"addonId":"665000000000000000000105","qty":2}]}
```

#### Success response example
```json
{"status":true,"data":{"plan":{"id":"665000000000000000000103","name":"20 Days","daysCount":20,"currency":"SAR"},"selectedOptions":{"grams":150,"mealsPerDay":1,"startDate":"2026-07-01"},"delivery":{"type":"delivery"},"premiumItems":[{"proteinId":null,"premiumKey":"salmon","name":"Salmon","qty":2,"unitExtraFeeHalala":1000,"totalHalala":2000,"currency":"SAR"}],"addonPlans":[{"addonId":"665000000000000000000105","name":"Drink","category":"drink","unitPriceHalala":500,"totalHalala":1000,"currency":"SAR"}],"breakdown":{"basePlanPriceHalala":100000,"totalHalala":104500,"currency":"SAR"},"pricingSummary":{"totalPriceHalala":104500,"currency":"SAR"},"validation":{"status":true}}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `plan`, `selectedOptions`, `delivery` | object | Conditional | quote summary | resolved values |
| `premiumItems`, `addonPlans` | array | No | line items | separate arrays |
| `breakdown`, `pricingSummary` | object | No | readonly money rows | all `*Halala` /100 for SAR |
| `validation.status` | boolean | No | badge | backend-owned |

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Subscription quote is invalid"}}
```

#### Frontend notes
`premiumKey` is canonical; `premiumMealId` is legacy only when available in the current catalog. Never turn premium qty into meal count.

### POST /api/dashboard/subscriptions

#### Purpose
Create from the same selection payload as quote.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body
Same fields/control mapping as quote. Quote immediately before create; the create endpoint requotes and remains authoritative.

#### Request example
```json
{"userId":"665000000000000000000102","planId":"665000000000000000000103","grams":150,"mealsPerDay":1,"startDate":"2026-07-01","delivery":{"type":"pickup","pickupLocationId":"main"},"premiumItems":[{"premiumKey":"salmon","qty":2}],"addons":[]}
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101","status":"active","userId":"665000000000000000000102","totalMeals":20,"remainingMeals":20},"meta":{"createdByAdmin":true}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data` | SubscriptionDTO | No | created detail | complete serializer output |
| `meta.createdByAdmin` | boolean | No | hidden | true |

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"App user is inactive"}}
```

#### Frontend notes
HTTP 201. Disable double submission.

### GET /api/dashboard/subscriptions/:id/days

#### Purpose
List persisted subscription days in date order.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/days
```

#### Success response example
```json
{"status":true,"data":[{"_id":"665000000000000000000106","subscriptionId":"665000000000000000000101","date":"2026-07-01","status":"open","mealSlots":[],"addonSelections":[]}]}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data` | SubscriptionDay[] | No | day grid | empty array allowed |
| `date` | string | No | date | `YYYY-MM-DD` |
| `status` | string | No | badge | persisted backend value |
| `mealSlots`, `addonSelections` | array | No | detail | never merge them |

#### Error responses
```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Do not consume meals merely because a date passed; reads do not settle days.

### PUT /api/dashboard/subscriptions/:id/delivery

#### Purpose
Change future delivery/pickup defaults.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `deliveryMode` | string | Yes | select | `delivery`, `pickup` | — | `delivery` | Arabic `طريقة الاستلام` |
| `deliveryZoneId` | string | Conditional | select | active zone ID | — | `665...104` | delivery |
| `deliveryAddress` | object | Conditional | object-editor | address DTO | — | `{"line1":"Riyadh"}` | delivery |
| `deliveryWindow` | string | No | select | configured window | `HH:mm-HH:mm` | `12:00-14:00` | delivery |
| `pickupLocationId` | string | Conditional | select | active branch ID | — | `main` | pickup |
| `reason` | string | No | textarea | text | — | `Customer request` | audit note |

#### Request example
```json
{"deliveryMode":"delivery","deliveryZoneId":"665000000000000000000104","deliveryAddress":{"line1":"Riyadh"},"deliveryWindow":"12:00-14:00","reason":"Customer request"}
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101","deliveryMode":"delivery","deliveryZoneId":"665000000000000000000104","deliveryFeeHalala":1500,"deliveryWindow":"12:00-14:00"}}
```

#### Response fields
`data` is the complete SubscriptionDTO. `deliveryFeeHalala` is readonly/backend-owned: 1500 → `15.00 ر.س`.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Subscription delivery update failed"}}
```

#### Frontend notes
Clear mutually exclusive delivery/pickup inputs when mode changes.

### GET /api/dashboard/subscriptions/:id/addon-entitlements

#### Purpose
Read recurring plan add-on limits.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/addon-entitlements
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","addonEntitlements":[{"addonId":"665000000000000000000105","name":"Drink","category":"drink","maxPerDay":1}]}}
```

#### Response fields
`subscriptionId:string`; `addonEntitlements:array`; each row has `addonId`, `name`, `category`, and positive integer `maxPerDay`. Empty array is valid.

#### Error responses
```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Cashier readonly.

### PATCH /api/dashboard/subscriptions/:id/addon-entitlements

#### Purpose
Replace recurring plan add-on entitlements.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `addonSubscriptions` | array | Yes | array-editor | `{addonId,maxPerDay}` | per day | see example | aliases `entitlements`, `addonEntitlements`; replace-all; add/remove rows |
| `reason` | string | Yes | textarea | non-empty | — | `Correction` | required audit reason |

#### Request example
```json
{"addonSubscriptions":[{"addonId":"665000000000000000000105","maxPerDay":1}],"reason":"Correction"}
```

#### Success response example
```json
{"status":true,"data":{"addonSubscriptions":[{"addonId":"665000000000000000000105","name":"Drink","category":"drink","maxPerDay":1}]}}
```

#### Response fields
`data.addonSubscriptions` is the normalized replacement array. Category comes from backend add-on catalog.

#### Error responses
```json
{"ok":false,"error":{"code":"CONFLICT","message":"Duplicate addon entitlement category drink"}}
```

#### Frontend notes
Only add-ons of kind `plan` and billing mode `per_day`/`per_meal` qualify.

### GET /api/dashboard/subscriptions/:id/balances

#### Purpose
Read premium and item-add-on wallet rows.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/balances
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","balances":{"premiumBalance":[{"premiumKey":"salmon","proteinId":null,"purchasedQty":3,"remainingQty":2,"unitExtraFeeHalala":1000,"currency":"SAR"}],"addonBalance":[{"addonId":"665000000000000000000105","purchasedQty":2,"remainingQty":1,"unitPriceHalala":500,"currency":"SAR"}]},"premiumBalance":[],"addonBalance":[]}}
```

#### Response fields
Canonical grouping is `data.balances`; duplicated top-level balance arrays are compatibility fields. Quantities are counts. Unit prices are halalas displayed `/100` SAR.

#### Error responses
```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Never combine premium and add-on rows.

### PATCH /api/dashboard/subscriptions/:id/balances

#### Purpose
Superadmin replace-all correction of one or both balance arrays.

#### Auth
Roles: superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `premiumBalance` | array | Conditional | array-editor | premium rows | counts/halala | see example | at least one balance array required |
| `addonBalance` | array | Conditional | array-editor | add-on rows | counts/halala | see example | validated add-on IDs |
| `reason` | string | Yes | textarea | non-empty | — | `Ledger correction` | required |

#### Request example
```json
{"premiumBalance":[{"premiumKey":"salmon","proteinId":null,"purchasedQty":3,"remainingQty":2,"unitExtraFeeHalala":1000,"currency":"SAR"}],"addonBalance":[{"addonId":"665000000000000000000105","purchasedQty":2,"remainingQty":1,"unitPriceHalala":500,"currency":"SAR"}],"reason":"Ledger correction"}
```

#### Success response example
```json
{"status":true,"data":{"premiumBalance":[{"premiumKey":"salmon","purchasedQty":3,"remainingQty":2}],"addonBalance":[{"addonId":"665000000000000000000105","purchasedQty":2,"remainingQty":1}]}}
```

#### Response fields
Returned normalized persisted arrays. All quantity fields are nonnegative integers; `purchasedAt` is ISO datetime and backend-defaulted when omitted.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"At least one of premiumBalance or addonBalance is required"}}
```

#### Frontend notes
High-risk operation: show before/after confirmation and require reason.

### GET /api/dashboard/subscriptions/:id/audit

#### Purpose
Read-only mathematical and fulfillment invariant audit.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/audit
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","auditStatus":"ok","severity":"info","invariants":{"baseMealsCountValid":true,"premiumUpgradeLimitValid":true,"addonsBalanceValid":true,"noAddonDoubleConsumption":true,"noFulfillmentDoubleConsumption":true},"warnings":[],"premiumUpgrades":{"totalPurchased":3,"totalRemaining":2,"totalConsumed":1,"items":[]},"addonEntitlements":{"itemAddons":[],"planAddons":[]}}}
```

#### Response fields
`auditStatus`: `ok` or `mismatch`; additive `severity`: `info` or `high`; `invariants` booleans and `warnings[]` are backend-owned. Detailed balance rows expose `remainingPlannedQty`, `remainingQty`, `pickedQty`, and `deliveredQty`.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID_SUBSCRIPTION_ID","message":"Invalid subscriptionId"}}
```

#### Frontend notes
Never recompute invariant flags. Empty warnings = healthy empty state.

### GET /api/dashboard/subscriptions/:id/lifecycle

#### Purpose
Chronological subscription actions/events.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/lifecycle
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","events":[{"id":"665000000000000000000107","action":"subscription_created_by_admin","actorRole":"admin","note":null,"createdAt":"2026-06-01T10:00:00.000Z"}]}}
```

#### Response fields
`events` is an array of backend audit/activity events. Event fields may vary by source; render `action`, actor, note, status transition, metadata, and ISO `createdAt` defensively. Empty: `لا توجد أحداث مسجلة.`

#### Error responses
```json
{"ok":false,"error":{"code":"SUBSCRIPTION_NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Unknown action names should render as raw values, not disappear.

### POST /api/dashboard/subscriptions/:id/cancel

#### Purpose
Cancel through lifecycle service.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `reason` | string | Yes | textarea | non-empty | — | `Customer request` | verified required by admin controller |

#### Request example
```json
{"reason":"Customer request"}
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101","status":"canceled"}}
```

#### Response fields
Lifecycle outcome/SubscriptionDTO; use returned status and refetch detail.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"reason is required"}}
```

#### Frontend notes
Destructive action; confirm and do not offer when `allowedActions.cancel` is false.

### PUT /api/dashboard/subscriptions/:id/extend

#### Purpose
Canonical extension.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `days` | integer | Yes | number | positive integer | days | `5` | Arabic `عدد الأيام` |
| `reason` | string | Yes | textarea | non-empty | — | `Compensation` | required audit reason |

#### Request example
```json
{"days":5,"reason":"Compensation"}
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101","endDate":"2026-07-25","validityEndDate":"2026-07-25"},"meta":{"days":5,"addedMeals":5,"endDate":"2026-07-25","validityEndDate":"2026-07-25"}}
```

#### Response fields
`data` complete DTO; `meta.days`, `meta.addedMeals` counts; end dates `YYYY-MM-DD`.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"days must be a positive integer"}}
```

#### Frontend notes
Do not calculate added meals/end date locally.

### POST /api/dashboard/subscriptions/:id/extend

#### Purpose
Compatibility alias for canonical PUT extend.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body
Same `days` number + required `reason` textarea as PUT.

#### Request example
```json
{"days":5,"reason":"Compensation"}
```

#### Success response example
```json
{"status":true,"data":{"id":"665000000000000000000101"},"meta":{"days":5,"addedMeals":5,"endDate":"2026-07-25","validityEndDate":"2026-07-25"}}
```

#### Response fields
Same as PUT.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"reason is required"}}
```

#### Frontend notes
New UI should use PUT.

### POST /api/dashboard/subscriptions/:id/freeze

#### Purpose
Freeze a future date range.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `startDate` | string | Yes | date | future `YYYY-MM-DD` | KSA date | `2026-07-05` | Arabic `بداية التجميد` |
| `days` | integer | Yes | number | positive integer | days | `3` | Arabic `مدة التجميد` |
| `reason` | string | No | textarea | text | — | `Travel` | audit note |

#### Request example
```json
{"startDate":"2026-07-05","days":3,"reason":"Travel"}
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","startDate":"2026-07-05","days":3}}
```

#### Response fields
Service lifecycle outcome; dates/counts are backend-owned. Refetch days/detail.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Invalid freeze range"}}
```

#### Frontend notes
Allowed range is policy-controlled; do not infer it.

### POST /api/dashboard/subscriptions/:id/unfreeze

#### Purpose
Unfreeze a previously frozen range.

#### Auth
Roles: admin, superadmin.

#### Query params
None.

#### Request body
Same `startDate` date, positive `days` number, and optional `reason` textarea as freeze.

#### Request example
```json
{"startDate":"2026-07-05","days":3,"reason":"Returned early"}
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","startDate":"2026-07-05","days":3}}
```

#### Response fields
Service lifecycle outcome. Refetch days/detail.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Invalid unfreeze range"}}
```

#### Frontend notes
This is not “resume”; retain freeze terminology.

### POST /api/dashboard/subscriptions/:id/days/:date/skip

#### Purpose
Skip one future subscription day.

#### Auth
Roles: admin, superadmin.

#### Query params
None; `:date` is `YYYY-MM-DD`.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `reason` | string | No | textarea | text | — | `Customer request` | audit note |

#### Request example
```json
{"reason":"Customer request"}
```

#### Success response example
```json
{"status":true,"data":{"date":"2026-07-10","status":"skipped"}}
```

#### Response fields
Returned day/action outcome; use backend `status` and refetch days.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Day cannot be skipped"}}
```

#### Frontend notes
Row action; respect `allowedActions.skipDay` and backend policy.

### POST /api/dashboard/subscriptions/:id/days/:date/unskip

#### Purpose
Restore a skipped future day.

#### Auth
Roles: admin, superadmin.

#### Query params
None; `:date` is `YYYY-MM-DD`.

#### Request body
Optional `reason` textarea.

#### Request example
```json
{"reason":"Customer changed request"}
```

#### Success response example
```json
{"status":true,"data":{"date":"2026-07-10","status":"open"}}
```

#### Response fields
Returned day/action outcome; final status can depend on backend planner state.

#### Error responses
```json
{"ok":false,"error":{"code":"INVALID","message":"Day cannot be unskipped"}}
```

#### Frontend notes
Respect `allowedActions.unskipDay`; do not assume final status.

### GET /api/dashboard/subscriptions/search

#### Purpose
Manual-deduction screen lookup by exact customer phone.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params

| Param | Type | Required | Frontend control | Options | Default | Notes |
|---|---|---:|---|---|---|---|
| `phone` | string | Yes | text | customer phone | — | Arabic `رقم الجوال`; exact normalized lookup |

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/search?phone=0500000000
```

#### Success response example
```json
{"status":true,"data":{"customer":{"id":"665000000000000000000102","name":"Ahmed","phone":"0500000000"},"subscription":{"id":"665000000000000000000101","planName":"20 Days","status":"active","fulfillmentMethod":"pickup","totalMeals":20,"consumedMeals":4,"remainingMeals":16,"remainingRegularMeals":14,"remainingPremiumMeals":2,"addonBalances":[]},"subscriptions":[],"today":{"businessDate":"2026-06-24","hasDeliveryDeductionToday":false,"lastDeductionAt":null}}}
```

#### Response fields
`customer`, selected `subscription`, all active `subscriptions[]`, and backend-owned `today`. Empty is represented by 404, not an empty list.

#### Error responses
```json
{"ok":false,"error":{"code":"CUSTOMER_NOT_FOUND","message":"Customer not found"}}
```

#### Frontend notes
This is a separate screen, not the general list `q` search.

### POST /api/dashboard/subscriptions/:id/manual-deduction

#### Purpose
Atomically deduct regular meals, premium meals, and optional add-on wallet quantities.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params
None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `regularMeals` | integer | Yes | number | >=0 | meals | `1` | Arabic `الوجبات العادية` |
| `premiumMeals` | integer | Yes | number | >=0 | meals | `0` | Arabic `الوجبات المميزة` |
| `addons` | array | No | array-editor | `{addonId,qty}` | items | `[{"addonId":"665...105","qty":1}]` | add/remove rows; qty positive |
| `reason` | string | Yes | textarea | non-empty | — | `Counter pickup` | Arabic `سبب الخصم` |
| `notes` | string | No | textarea | text | — | `ID checked` | Arabic `ملاحظات` |

#### Request example
```json
{"regularMeals":1,"premiumMeals":0,"addons":[{"addonId":"665000000000000000000105","qty":1}],"reason":"Counter pickup","notes":"ID checked"}
```

#### Success response example
```json
{"status":true,"data":{"subscriptionId":"665000000000000000000101","deducted":{"regularMeals":1,"premiumMeals":0,"total":1,"addons":[{"addonId":"665000000000000000000105","qty":1}]},"remaining":{"regularMeals":13,"premiumMeals":2,"totalMeals":15,"addons":[{"addonId":"665000000000000000000105","remainingQty":0}]},"businessDate":"2026-06-24","fulfillmentMethod":"pickup"}}
```

#### Response fields
`deducted` and `remaining` contain separate regular/premium/add-on quantities; `businessDate` is KSA `YYYY-MM-DD`; `fulfillmentMethod` is `pickup` or `delivery`.

#### Error responses
```json
{"ok":false,"error":{"code":"DELIVERY_ALREADY_DEDUCTED_TODAY","message":"Delivery subscription already deducted today"}}
```

#### Frontend notes
Never decrement locally before success. Backend prevents overspend and restricts delivery subscriptions to one deduction per business day.

### GET /api/dashboard/subscriptions/:id/manual-deductions

#### Purpose
List manual deduction history.

#### Auth
Roles: admin, superadmin, cashier.

#### Query params

| Param | Type | Required | Frontend control | Options | Default | Notes |
|---|---|---:|---|---|---|---|
| `limit` | integer | No | select | 1–100 | 50 | backend clamps |

#### Request body
None.

#### Request example
```http
GET {{baseUrl}}/api/dashboard/subscriptions/665000000000000000000101/manual-deductions?limit=50
```

#### Success response example
```json
{"status":true,"data":{"contractVersion":"dashboard_manual_deductions.v1","subscriptionId":"665000000000000000000101","count":1,"items":[{"id":"665000000000000000000108","subscriptionId":"665000000000000000000101","customerId":"665000000000000000000102","businessDate":"2026-06-24","deducted":{"regularMeals":1,"premiumMeals":0,"total":1,"addons":[]},"before":{"remainingRegularMeals":14,"remainingPremiumMeals":2,"remainingMeals":16},"after":{"remainingRegularMeals":13,"remainingPremiumMeals":2,"remainingMeals":15},"fulfillmentMethod":"pickup","actor":{"id":"665000000000000000000109","role":"cashier"},"reason":"Counter pickup","notes":"","createdAt":"2026-06-24T12:00:00.000Z"}]}}
```

#### Response fields
`contractVersion` readonly; `count` integer; `items[]` contains before/after, actor, reason/notes, business date, and ISO created time. Empty `items` is valid.

#### Error responses
```json
{"ok":false,"error":{"code":"SUBSCRIPTION_NOT_FOUND","message":"Subscription not found"}}
```

#### Frontend notes
Empty: `لا توجد عمليات خصم يدوية.`

## 7. Forms and UI controls

| Backend field | Arabic label | Control | Required | Options/format | Ownership |
|---|---|---|---:|---|---|
| `q` | بحث | text | No | free text | editable |
| `status` | حالة الاشتراك | select | No | list options above | editable |
| `page` | الصفحة | hidden/computed | No | integer | computed |
| `limit` | عدد النتائج | select/hidden | No | positive integer | editable/computed |
| `userId` | العميل | select/search | Yes create | client ID | editable |
| `planId` | الخطة | select | Yes create | plan ID | editable |
| `delivery.type` | طريقة الاستلام | select | Yes create | `delivery`, `pickup` | editable |
| zone/branch IDs | المنطقة/الفرع | select | Conditional | backend IDs | editable |
| `startDate` | تاريخ البداية | date | No | `YYYY-MM-DD` | editable |
| `premiumItems` | الترقيات المميزة | multi-select | No | quantity rows | editable |
| `addons` | الإضافات | multi-select/array-editor | No | quantity rows | editable |
| balance/audit fields | الأرصدة/التدقيق | readonly | — | backend values | backend-owned |

## 8. Tables and detail views

List columns: display ID, customer, plan, status, fulfillment mode, start/end dates, separate remaining balances, created time, actions. Detail panels: client, plan, pricing (halala `/100` SAR), delivery/pickup, day grid, regular balance, premium balance, add-on balance, audit, lifecycle. Disable actions using `allowedActions`, but always handle 4xx revalidation.

## 9. Response DTO reference

Additive Phase 1 shape:

```json
{"balances":{"regularMeals":{"total":0,"remaining":0,"consumed":0},"premiumMeals":{"total":0,"remaining":0,"consumed":0},"addons":[]},"premiumSummary":{"total":0,"remaining":0,"consumed":0,"items":[]},"addonsSummary":{"total":0,"remaining":0,"consumed":0,"items":[]},"allowedActions":{"cancel":false,"extend":false,"freeze":false,"unfreeze":false,"skipDay":false,"unskipDay":false,"updateDelivery":false,"editBalances":false}}
```

All counts are nonnegative numbers. IDs are strings. Nullable catalog/user relations must render with stored IDs/fallback labels. Money fields ending `Halala` are integer minor units; display SAR = halala/100. `premiumSummary` and `addonsSummary` are objects in the additive contract; preserve any legacy fields returned alongside them.

## 10. Error responses

Handle 400 invalid payload/date/ID, 401/403 auth, 404 missing entity, 409 lifecycle/balance conflict, and 500 unexpected failures. Show localized backend message when present. Never treat `ok:false` as a success merely because HTTP client parsing succeeded.

## 11. Business rules

- Add-ons are independent entitlements and never meal slots.
- Premium upgrades attach to base slots and never increase `totalMeals`.
- `selectedMealSlotIds` contains only slot keys; add-on item IDs belong in `selectedPickupItemIds`.
- Fulfillment consumes selected pickup item IDs; picked add-ons must not reappear.
- Unpicked planned add-ons remain planned; wallet `remainingQty` is distinct from `remainingPlannedQty`.
- Audit real values: `auditStatus` = `ok|mismatch`; severity = `info|high`.
- Flutter uses mobile endpoints and is unchanged.

## 12. Frontend checklist

- [ ] Keep status `BACKEND_READY_DASHBOARD_PENDING` until integration ships.
- [ ] Quote before create and display returned halala pricing as SAR.
- [ ] Render three balance domains separately.
- [ ] Use canonical `premiumKey`; keep legacy `premiumMealId` compatibility only when catalog supplies it.
- [ ] Use freeze/unfreeze and PUT extend.
- [ ] Put manual deduction on its separate phone-search screen.
- [ ] Require reason wherever documented.
- [ ] Refetch after every mutation.

## 13. Examples

Money: `104500` halala → `1,045.00 ر.س`. Date: send `2026-07-01`; timestamp display converts an ISO instant to `Asia/Riyadh` without changing business-date strings.

## 14. Unsupported / future features

- Dashboard implementation is pending.
- Pause/resume endpoints.
- Frontend-computed pricing, remaining balances, or audit flags.
- Treating add-ons or premium upgrades as extra meals.
- One generic balance pool.
- Unverified address subfields beyond the currently supplied address object: `VERIFY_IN_BACKEND_BEFORE_USE`.
