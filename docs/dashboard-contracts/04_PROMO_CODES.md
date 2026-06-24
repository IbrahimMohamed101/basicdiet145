# Screen Contract: Promo Codes

<<<<<<< HEAD
## Status

`READY_WITH_LIMITATIONS`

The Dashboard, backend routes, list query, canonical write payload, Arabic actions, and DTO are aligned. The limitation is intentional: promo redemption is implemented for subscription checkout only. One-time orders reject promo codes, and an `addon_plans`-only code can be stored but is not accepted by the subscription validation endpoint.

## Dashboard

- Route: `/promo-codes`
- Required language: all visible labels, messages, buttons, errors, and empty states are Arabic.
- Pricing authority: the Dashboard displays stored values only. The backend validation/quote services decide eligibility and final discount amounts.
- Fixed values: `discountValue` is expressed in halalas when `discountType` is `fixed`.

## Authentication and roles

All routes use Dashboard bearer authentication. Promo-code routes are mounted after `dashboardRoleMiddleware(["admin"])`, so `admin` and the middleware's `superadmin` bypass are allowed. `cashier` is rejected.

## Active endpoints

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/dashboard/promo-codes` | Search/list promo codes | Query below | `{ status, data: PromoCodeAdminDTO[], meta }` |
| GET | `/api/dashboard/promo-codes/:id` | Detail and latest 25 usages | Path `id` | `{ status, data: PromoCodeAdminDTO & { recentUsage } }` |
| POST | `/api/dashboard/promo-codes` | Create | Canonical write payload | `201 { status, data: PromoCodeAdminDTO }` |
| PUT | `/api/dashboard/promo-codes/:id` | Update | Canonical write payload | `{ status, data: PromoCodeAdminDTO }` |
| PATCH | `/api/dashboard/promo-codes/:id/toggle` | Invert `isActive` | No body | `{ status, data: PromoCodeAdminDTO }` |
| DELETE | `/api/dashboard/promo-codes/:id` | Soft archive unused code | No body | `{ status, data: PromoCodeAdminDTO }` |
| POST | `/api/dashboard/promo-codes/validate` | Validate against a subscription quote | Validation payload below | `{ status, data: { valid, promo, breakdown } }` |

These are active Dashboard endpoints, not legacy aliases.

## List query

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `q` | string | empty | Case-insensitive literal search in code, title, description, and Arabic/English metadata name |
| `page` | positive integer | `1` | Enables pagination when `page` or `limit` is supplied |
| `limit` | integer `1..100` | `20` | Page size |
| `includeDeleted` | boolean string | `false` | Includes soft-archived rows when `true` |

For compatibility, a request without `page` and `limit` still returns the complete filtered `data` array. `meta` is additive:

```json
{
  "total": 42,
  "page": 2,
  "currentPage": 2,
  "limit": 10,
  "totalPages": 5,
  "lastPage": 5
}
```

## Canonical create/update payload

```json
{
  "code": "WELCOME10",
  "name": {
    "ar": "خصم الترحيب",
    "en": "Welcome Discount"
  },
  "discountType": "percentage",
  "discountValue": 10,
  "usageLimitTotal": 100,
  "usageLimitPerUser": 1,
  "startsAt": "2026-06-24T00:00:00.000Z",
  "expiresAt": "2026-07-24T00:00:00.000Z",
  "appliesTo": "subscription",
  "isActive": true
}
```

Canonical `discountType` values are `percentage` and `fixed`. Backend compatibility aliases remain accepted: `fixed_amount` normalizes to `fixed`, `endsAt` normalizes to `expiresAt`, and `usageLimit` normalizes to `usageLimitTotal`. The Dashboard sends only canonical fields.

Other supported backend fields, not currently edited by the lightweight Dashboard form, are `title`, `description`, `maxDiscountAmountHalala`, `minimumSubscriptionAmountHalala`, `eligiblePlanIds`, `eligiblePlanDaysCounts`, `firstPurchaseOnly`, `allowedUserIds`, `currency`, and `metadata`.

## Admin DTO

`PromoCodeAdminDTO` contains:

```text
id, code, name { ar, en }, title, description,
isActive, appliesTo, appliesToList,
discountType, discountValue,
maxDiscountAmountHalala, minimumSubscriptionAmountHalala,
startsAt, expiresAt,
usageLimitTotal, usageLimitPerUser, currentUsageCount, usedCount,
eligiblePlanIds, planIds, eligiblePlanDaysCounts,
firstPurchaseOnly, allowedUserIds,
currency, metadata, deletedAt, createdAt, updatedAt,
state { isExpired, isStarted, isDeleted, isUsageExhausted, isCurrentlyValid }
```

Detail `recentUsage[]` contains `id`, `userId`, `checkoutDraftId`, `subscriptionId`, `paymentId`, `discountAmountHalala`, `status`, `reservedAt`, `consumedAt`, `cancelledAt`, and `createdAt`. User names are not populated; the Dashboard shows the returned ID safely.

## Validation payload and scope

The endpoint accepts `promoCode` or `code`, `userId`, `planId`, `daysCount`, and either a quote/breakdown object or `subtotalHalala`/`totalHalala` plus optional `vatPercentage`.

The backend owns active state, start/end dates, minimum amount, plan/day restrictions, allowed users, first-purchase restriction, total usage, per-user usage, percentage validity, and final quote calculation.

Supported stored `appliesTo` values are `subscription`, `addon_plans`, and `all`. The subscription validator accepts `subscription` and `all`. `addon_plans`-only redemption has no verified consumer in this contract. One-time order checkout explicitly returns `PROMO_NOT_APPLICABLE_TO_ORDER_TYPE` when a promo is supplied.

## Toggle and archive

- Toggle flips `isActive`; it does not change usage data.
- DELETE is a soft archive: it sets `deletedAt` and `isActive=false`.
- Archive is blocked with `409 PROMO_IN_USE` when `currentUsageCount > 0`.
- The Dashboard therefore uses Arabic archive wording and never describes the action as permanent deletion.

## Compatibility

- Mobile subscription promo validation continues through the existing shared backend service.
- Flutter/mobile code is unchanged.
- One-time checkout behavior is unchanged and unsupported.
- No endpoint or backend DTO field was renamed or removed.
=======
## 1. Status

Status: `BACKEND_DASHBOARD_CONTRACT_ALIGNED`

## 2. Screen ownership

Owns subscription promo configuration, activation, archive, validation previews, and recent usage display.

## 3. Frontend implementation status

Backend, Dashboard, and contract are aligned. The list controller currently returns all matching nondeleted rows and does not implement server pagination or text search.

## 4. Backend authority rules

- Backend validation/quote is the final discount authority; never finalize discounts in the Dashboard.
- Fixed `discountValue` is halalas; percentage `discountValue` is a numeric percent.
- `fixed_amount` is accepted and normalized to `fixed`; `endsAt` is accepted and normalized to `expiresAt`.
- One-time orders are not a verified redemption consumer and are unsupported.
- Delete archives (`deletedAt` + `isActive:false`). A code with usage cannot be archived by this endpoint.
- Auth header: `Authorization: Bearer <dashboardToken>`. Verified role: `admin`.

## 5. Active endpoints

| Method | Path | Use |
|---|---|---|
| GET | `/api/dashboard/promo-codes` | List |
| GET | `/api/dashboard/promo-codes/:id` | Detail/recent usage |
| POST | `/api/dashboard/promo-codes` | Create |
| PUT | `/api/dashboard/promo-codes/:id` | Update |
| PATCH | `/api/dashboard/promo-codes/:id/toggle` | Toggle active |
| DELETE | `/api/dashboard/promo-codes/:id` | Archive |
| POST | `/api/dashboard/promo-codes/validate` | Backend validation preview |

## 6. Endpoint details

### GET /api/dashboard/promo-codes

#### Purpose
List promo codes, newest first.

#### Auth
Roles:
- admin

#### Query params

| Param | Type | Required | Frontend control | Options | Default | Notes |
|---|---|---:|---|---|---|---|
| `includeDeleted` | boolean | No | switch | `true`, `false` | `false` | Implemented; only lowercase-insensitive `true` includes archived rows |
| `q` | string | No | text | free text | empty | `VERIFY_IN_BACKEND_BEFORE_USE`: currently ignored; filter locally if needed |
| `page` | integer | No | hidden/computed | integer >= 1 | — | `VERIFY_IN_BACKEND_BEFORE_USE`: currently ignored |
| `limit` | integer | No | select/hidden | positive integer | — | `VERIFY_IN_BACKEND_BEFORE_USE`: currently ignored |

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/promo-codes?includeDeleted=false
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":[{"id":"665000000000000000000010","code":"WELCOME10","name":{"ar":"خصم الترحيب","en":"Welcome discount"},"title":"Welcome discount","description":"","discountType":"percentage","discountValue":10,"isActive":true,"appliesTo":"subscription","appliesToList":["subscriptions"],"maxDiscountAmountHalala":5000,"minimumSubscriptionAmountHalala":null,"startsAt":"2026-06-01T00:00:00.000Z","expiresAt":"2026-12-31T23:59:59.000Z","usageLimitTotal":100,"usageLimitPerUser":1,"currentUsageCount":2,"usedCount":2,"eligiblePlanIds":[],"planIds":[],"eligiblePlanDaysCounts":[],"firstPurchaseOnly":false,"allowedUserIds":[],"currency":"SAR","metadata":{},"deletedAt":null,"createdAt":"2026-06-01T00:00:00.000Z","updatedAt":"2026-06-01T00:00:00.000Z","state":{"isExpired":false,"isStarted":true,"isDeleted":false,"isCurrentlyValid":true}}]}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `status` | boolean | No | hidden | Success envelope |
| `data` | PromoCode[] | No | table | Empty array empty state; no `meta` pagination object |

#### Error responses

```json
{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Unauthorized"}}
```

#### Frontend notes
Empty state: `لا توجد أكواد خصم.` Any current search/pagination must be local because the backend ignores `q/page/limit`.

### GET /api/dashboard/promo-codes/:id

#### Purpose
Return one active/non-archived promo plus its latest 25 usage rows.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
GET {{baseUrl}}/api/dashboard/promo-codes/665000000000000000000010
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000010","code":"WELCOME10","name":{"ar":"خصم الترحيب","en":"Welcome discount"},"discountType":"percentage","discountValue":10,"isActive":true,"appliesTo":"subscription","startsAt":null,"expiresAt":null,"usageLimitTotal":100,"usageLimitPerUser":1,"currentUsageCount":2,"currency":"SAR","deletedAt":null,"state":{"isExpired":false,"isStarted":true,"isDeleted":false,"isCurrentlyValid":true},"recentUsage":[{"id":"665000000000000000000011","userId":"665000000000000000000012","checkoutDraftId":null,"subscriptionId":"665000000000000000000013","paymentId":null,"discountAmountHalala":2500,"status":"consumed","reservedAt":"2026-06-20T12:00:00.000Z","consumedAt":"2026-06-20T12:05:00.000Z","cancelledAt":null,"createdAt":"2026-06-20T12:00:00.000Z"}]}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data` | PromoCode | No | detail/form | See section 9 |
| `data.recentUsage` | PromoUsage[] | No | usage table | Up to 25 newest rows |
| `recentUsage[].userId` | string | Yes | ID/fallback user | User name is not populated; safely show ID |
| `recentUsage[].discountAmountHalala` | integer | No | money-sar-display | Divide by 100 |
| `recentUsage[].status` | string | No | badge | Persisted usage status; verified examples include `reserved`, `consumed`, `cancelled` |
| `recentUsage[].reservedAt` | ISO datetime | Yes | datetime | Display Asia/Riyadh |
| `recentUsage[].consumedAt` | ISO datetime | Yes | datetime | Display Asia/Riyadh |
| `recentUsage[].cancelledAt` | ISO datetime | Yes | datetime | Display Asia/Riyadh |

#### Error responses

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Promo code not found"}}
```

#### Frontend notes
Archived records return 404 even if their ID exists.

### POST /api/dashboard/promo-codes

#### Purpose
Create a promo code.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `code` | string | Yes | text | non-empty | — | `WELCOME10` | Arabic `الكود`; trimmed/uppercased; unique among nondeleted promos |
| `name.ar` | string | No | text | text | — | `خصم الترحيب` | Arabic `الاسم بالعربية`; stored in metadata |
| `name.en` | string | No | text | text | — | `Welcome discount` | Arabic `الاسم بالإنجليزية`; title falls back from name |
| `discountType` | string | Yes | select | `percentage`, `fixed` | — | `percentage` | Alias `fixed_amount` accepted |
| `discountValue` | number | Yes | number / money-halala | >= 0 | percent or halala | `10` | Control/unit changes with type; fixed 2500 = 25 SAR |
| `usageLimitTotal` | integer/null | No | number | integer >=0 or empty | uses | `100` | Empty becomes null/unlimited |
| `usageLimitPerUser` | integer/null | No | number | integer >=0 or empty | uses/user | `1` | Empty becomes null/unlimited |
| `startsAt` | string/null | No | datetime | valid ISO datetime | ISO, UTC payload | `2026-06-01T00:00:00.000Z` | Display Asia/Riyadh |
| `expiresAt` | string/null | No | datetime | valid ISO datetime | ISO, UTC payload | `2026-12-31T23:59:59.000Z` | Alias `endsAt` accepted |
| `appliesTo` | string | No | select | `subscription`, `addon_plans`, `all` | — | `subscription` | Default `subscription`; addon/all redemption limited as below |
| `isActive` | boolean | No | switch | `true`, `false` | — | `true` | Default true |

#### Request example

```json
{"code":"WELCOME10","name":{"ar":"خصم الترحيب","en":"Welcome discount"},"discountType":"percentage","discountValue":10,"usageLimitTotal":100,"usageLimitPerUser":1,"startsAt":"2026-06-01T00:00:00.000Z","expiresAt":"2026-12-31T23:59:59.000Z","appliesTo":"subscription","isActive":true}
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000010","code":"WELCOME10","name":{"ar":"خصم الترحيب","en":"Welcome discount"},"title":"Welcome discount","description":"","discountType":"percentage","discountValue":10,"isActive":true,"appliesTo":"subscription","appliesToList":["subscriptions"],"maxDiscountAmountHalala":null,"minimumSubscriptionAmountHalala":null,"startsAt":"2026-06-01T00:00:00.000Z","expiresAt":"2026-12-31T23:59:59.000Z","usageLimitTotal":100,"usageLimitPerUser":1,"currentUsageCount":0,"usedCount":0,"eligiblePlanIds":[],"planIds":[],"eligiblePlanDaysCounts":[],"firstPurchaseOnly":false,"allowedUserIds":[],"currency":"SAR","metadata":{"name":{"ar":"خصم الترحيب","en":"Welcome discount"},"sortOrder":0},"deletedAt":null,"state":{"isExpired":false,"isStarted":true,"isDeleted":false,"isCurrentlyValid":true}}}
```

#### Response fields

See section 9. HTTP status 201.

#### Error responses

```json
{"ok":false,"error":{"code":"PROMO_INVALID_CONFIGURATION","message":"discountType must be percentage or fixed_amount"}}
```

#### Frontend notes
For fixed discount: payload `discountValue=2500`, display `25.00 ر.س`, rule `halala/100`. For percentage: payload/display `10` = `10%`.

### PUT /api/dashboard/promo-codes/:id

#### Purpose
Update a non-archived promo.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

Same editable fields and controls as POST. The controller merges omitted fields with the existing document, then normalizes the full result.

#### Request example

```json
{"name":{"ar":"خصم ترحيبي محدث","en":"Updated welcome discount"},"discountType":"fixed","discountValue":2500,"expiresAt":"2027-01-01T00:00:00.000Z","appliesTo":"subscription","isActive":true}
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000010","code":"WELCOME10","name":{"ar":"خصم ترحيبي محدث","en":"Updated welcome discount"},"discountType":"fixed","discountValue":2500,"isActive":true,"appliesTo":"subscription","expiresAt":"2027-01-01T00:00:00.000Z","currency":"SAR","deletedAt":null,"state":{"isExpired":false,"isStarted":true,"isDeleted":false,"isCurrentlyValid":true}}}
```

#### Response fields

See section 9; response contains the complete serialized DTO even where this example is abbreviated.

#### Error responses

```json
{"ok":false,"error":{"code":"CONFLICT","message":"Promo code already exists"}}
```

#### Frontend notes
The code may be submitted; it remains uniqueness-controlled.

### PATCH /api/dashboard/promo-codes/:id/toggle

#### Purpose
Invert active status.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

No body.

#### Request example

```json
{}
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000010","code":"WELCOME10","discountType":"percentage","discountValue":10,"isActive":false,"appliesTo":"subscription","deletedAt":null,"state":{"isExpired":false,"isStarted":true,"isDeleted":false,"isCurrentlyValid":false}}}
```

#### Response fields

Complete PromoCode DTO; use returned `isActive` and `state`.

#### Error responses

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Promo code not found"}}
```

#### Frontend notes
Disable repeated clicks; do not optimistically invert twice.

### DELETE /api/dashboard/promo-codes/:id

#### Purpose
Archive an unused promo.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

None.

#### Request example

```http
DELETE {{baseUrl}}/api/dashboard/promo-codes/665000000000000000000010
Authorization: Bearer <dashboardToken>
```

#### Success response example

```json
{"status":true,"data":{"id":"665000000000000000000010","code":"WELCOME10","isActive":false,"deletedAt":"2026-06-24T12:00:00.000Z","state":{"isExpired":false,"isStarted":true,"isDeleted":true,"isCurrentlyValid":false}}}
```

#### Response fields

Complete PromoCode DTO; `deletedAt` becomes ISO datetime and `state.isDeleted` true.

#### Error responses

```json
{"ok":false,"error":{"code":"PROMO_IN_USE","message":"Promo code has active or consumed usages and cannot be hard removed"}}
```

#### Frontend notes
Confirmation: `سيتم أرشفة كود الخصم وتعطيله. هل تريد المتابعة؟`

### POST /api/dashboard/promo-codes/validate

#### Purpose
Ask the backend to validate and price a subscription promo preview.

#### Auth
Roles:
- admin

#### Query params

None.

#### Request body

| Field | Type | Required | Frontend control | Options | Unit | Example | Notes |
|---|---|---:|---|---|---|---|---|
| `promoCode` | string | Yes | text | code | — | `WELCOME10` | Alias `code` |
| `userId` | string | No | hidden/user select | ObjectId | — | `665...012` | Defaults to dashboard user ID; for customer preview send customer ID |
| `planId` | string | No | select | plan ID | — | `665...020` | May be nested in `quote.planId` |
| `daysCount` | integer | No | number | integer | days | `20` | May be nested in `quote.daysCount` |
| `breakdown` | object | No | object-editor | quote breakdown | halala fields | see example | Preferred authoritative quote input |
| `subtotalHalala` | number | No | money-halala | >=0 | halala | `100000` | Fallback base price when breakdown absent |

#### Request example

```json
{"promoCode":"WELCOME10","userId":"665000000000000000000012","planId":"665000000000000000000020","daysCount":20,"breakdown":{"basePlanPriceHalala":100000,"premiumTotalHalala":5000,"addonsTotalHalala":2000,"deliveryFeeHalala":1500,"vatPercentage":15}}
```

#### Success response example

```json
{"status":true,"data":{"valid":true,"promo":{"code":"WELCOME10","discountType":"percentage","discountValue":10,"discountAmountHalala":10850,"isApplied":true},"breakdown":{"basePlanPriceHalala":100000,"premiumTotalHalala":5000,"addonsTotalHalala":2000,"deliveryFeeHalala":1500,"discountAmountHalala":10850,"vatPercentage":15}}}
```

#### Response fields

| Field | Type | Nullable | Frontend display | Notes |
|---|---|---:|---|---|
| `data.valid` | boolean | No | success badge | Success responses set true; invalid promos use error response |
| `data.promo` | object | No | preview card | Applied promo snapshot |
| `data.breakdown` | object | No | readonly money rows | Backend-owned quote breakdown; halala money fields |

#### Error responses

```json
{"ok":false,"error":{"code":"PROMO_EXPIRED","message":"Promo code has expired"}}
```

#### Frontend notes
Render returned amounts; never duplicate eligibility, caps, usage, or final-discount logic locally.

## 7. Forms and UI controls

The POST table is the canonical form dictionary. Also returned/read-only: `id`, `currentUsageCount`, `usedCount`, `currency`, `deletedAt`, timestamps, `state.*` (all readonly/backend-owned). Advanced request fields supported by backend but not required by the named basic form: `maxDiscountAmountHalala`, `minimumSubscriptionAmountHalala` (money-halala), `eligiblePlanIds` and `allowedUserIds` (multi-select), `eligiblePlanDaysCounts` (array-editor numbers), `firstPurchaseOnly` (switch). If surfaced, preserve these exact fields and validations.

Select options:

- `discountType`: `percentage` (نسبة مئوية), `fixed` (مبلغ ثابت).
- `appliesTo`: `subscription` (اشتراك); `addon_plans` (خطط الإضافات، configuration-only unless its redemption consumer is verified); `all` (accepted by backend, but does not add one-time-order support).

## 8. Tables and detail views

Columns: code, localized name/title, type, value, applies-to, usage (`currentUsageCount` / limit), start, expiry, active/current-valid badges, actions. Use ISO datetimes and display in `Asia/Riyadh`. Recent usage shows IDs when names are unavailable. Empty usage: `لا يوجد استخدام حديث لهذا الكود.`

## 9. Response DTO reference

`PromoCode` fields: `id:string`; `code:string`; `name:{ar:string,en:string}`; `title:string`; `description:string`; `discountType:"percentage"|"fixed"`; `discountValue:number`; `isActive:boolean`; `appliesTo:"subscription"|"addon_plans"|"all"`; `appliesToList:string[]`; nullable halala integers `maxDiscountAmountHalala`, `minimumSubscriptionAmountHalala`; nullable ISO dates `startsAt`, `expiresAt`, `deletedAt`, `createdAt`, `updatedAt`; nullable nonnegative integers `usageLimitTotal`, `usageLimitPerUser`; counts `currentUsageCount`, `usedCount`; string arrays `eligiblePlanIds`, `planIds`, `allowedUserIds`; integer array `eligiblePlanDaysCounts`; `firstPurchaseOnly:boolean`; `currency:string`; `metadata:object|null`; and readonly `state:{isExpired,isStarted,isDeleted,isCurrentlyValid}`.

## 10. Error responses

The verified shared error envelope is `{ "ok": false, "error": { "code": string, "message": string, "details"?: any } }`, not the success envelope. Handle 400/422 promo validation, 401/403 auth, 404 missing/archived, 409 duplicate/in-use, and 500 unexpected errors.

## 11. Business rules

- Promo codes normalize to uppercase.
- A null usage limit means unlimited.
- Dates are optional; backend current-valid state reflects start/expiry.
- Premium, addon, delivery, caps, and VAT-aware discount computation belongs to backend quote logic.
- One-time orders are unsupported.

## 12. Frontend checklist

- [ ] Switch fixed/percentage control and unit correctly.
- [ ] Convert/display fixed values as halala/SAR.
- [ ] Send ISO datetimes; display Asia/Riyadh.
- [ ] Use backend validation result and quote breakdown.
- [ ] Treat `q/page/limit` as unsupported until verified.
- [ ] Do not expect populated user names in recent usage.

## 13. Examples

Fixed example: payload `discountValue: 2500`; UI `25.00 ر.س`. Percentage example: payload `discountValue: 10`; UI `10%`.

## 14. Unsupported / future features

- One-time order redemption.
- Verified redemption for `addon_plans` (`VERIFY_IN_BACKEND_BEFORE_USE`).
- Server-side `q`, `page`, and `limit` (`VERIFY_IN_BACKEND_BEFORE_USE`).
- Hard delete or restoring archived promos through these endpoints.
>>>>>>> c9532d8f (04_PROMO_CODES.md)
