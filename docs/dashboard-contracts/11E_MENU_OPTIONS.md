# 11E — Global Menu Options API Contract

Verified on 2026-06-20. All routes require dashboard bearer auth and role `admin`/`superadmin`. Success uses `{ "status": true, "data": ... }`; errors use `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`.

Editable fields: `groupId`, `catalogItemId` (only until first non-null assignment), `key` (create only), localized `name`/`description`, `imageUrl`, `extraPriceHalala` (alias synchronized with `extraFeeHalala`), `extraWeightUnitGrams`, `extraWeightPriceHalala`, `availableFor`, `isActive`, `isVisible`, `isAvailable`, and `sortOrder`. Read-only: IDs, `currency` (`SAR`), `availableForSubscription`, `nutrition`, `proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, `ruleTags`, `selectionType`, publish metadata, timestamps, and `__v`. Those legacy/domain fields are returned for compatibility but the current normalizer ignores them on create/update; do not build an editor for them here. There is no `priceDeltaHalala`; the backend name is `extraPriceHalala`. Admin endpoints do not return SAR display strings.

## GET /api/dashboard/menu/options
### Purpose
List/filter global options.
### Used By
Options table and pickers.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
`groupId` optional ObjectId; `includeInactive` boolean default false; `isActive`, `isVisible`, `isAvailable`, `published` booleans; `q` search; optional `page`, `limit` (1–100, default 25 once enabled).
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012e50001","_id":"665f1b2e7b9a4d0012e50001","groupId":"665f1b2e7b9a4d0012c30001","catalogItemId":null,"key":"grilled_chicken","name":{"ar":"دجاج مشوي","en":"Grilled Chicken"},"description":{"ar":"","en":""},"imageUrl":"https://cdn.example.com/chicken.jpg","extraPriceHalala":500,"extraWeightUnitGrams":0,"extraWeightPriceHalala":0,"currency":"SAR","availableFor":["one_time","subscription"],"availableForSubscription":true,"nutrition":{"calories":165,"proteinGrams":31,"carbGrams":0,"fatGrams":4},"proteinFamilyKey":"","displayCategoryKey":"","premiumKey":"","ruleTags":[],"selectionType":"","extraFeeHalala":500,"isVisible":true,"isAvailable":true,"isActive":true,"sortOrder":0,"publishedAt":"2026-06-20T08:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":1,"pages":1}}}
```
### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"groupId must be a valid ObjectId"}}`
### Frontend Notes
Without pagination data is array. Use ID for links; show price as `extraPriceHalala / 100` SAR but send halala.
### Validation
Standard list filters; group ID valid.
### Important Do/Don't
Do treat nutrition/domain tags as read-only. Do not send response objects back wholesale.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/options?groupId={{optionGroupId}}&includeInactive=true&page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/options/:id
### Purpose
Read one option with parent group and usage count.
### Used By
Option detail/editor.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
`contractVersion` optional `v3`/`v4`.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_option_detail.v3","option":{"id":"665f1b2e7b9a4d0012e50001","groupId":"665f1b2e7b9a4d0012c30001","key":"grilled_chicken","name":{"ar":"دجاج مشوي","en":"Grilled Chicken"},"extraPriceHalala":500,"currency":"SAR"},"optionGroup":{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"}},"usage":{"linkedProductsCount":4}}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Menu entity not found"}}`
### Frontend Notes
Edit only editable fields from `option`; group and usage are read-only.
### Validation
Valid existing ID; v1/v2 return 410.
### Important Do/Don't
Do warn when globally used. Do not send detail envelope to PATCH.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/options/{{optionId}}?contractVersion=v3
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/options
### Purpose
Create a global option.
### Used By
Create-option form.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
Required: active `groupId`, unique-in-group snake-case `key`, and localized name.
```json
{"groupId":"665f1b2e7b9a4d0012c30003","key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Sauce"},"description":{"ar":"","en":"Creamy garlic sauce"},"imageUrl":"https://cdn.example.com/garlic.jpg","extraPriceHalala":200,"extraWeightUnitGrams":0,"extraWeightPriceHalala":0,"availableFor":["one_time","subscription"],"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":2}
```
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","groupId":"665f1b2e7b9a4d0012c30003","key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Sauce"},"extraPriceHalala":200,"extraFeeHalala":200,"currency":"SAR","publishedAt":null}}`
### Error Response
`{"ok":false,"error":{"code":"MENU_CONFLICT","message":"Duplicate menu key","details":{"groupId":"665f1b2e7b9a4d0012c30003","key":"garlic_sauce"}}}`
### Frontend Notes
Send only editable fields. `extraFeeHalala` may be sent as a compatibility alias but prefer `extraPriceHalala`.
### Validation
Prices/weights/order integer >=0; `availableFor` values `one_time`/`subscription`; group active; CatalogItem link globally available.
### Important Do/Don't
Do use halala and `imageUrl`. Do not send `priceDeltaHalala`, SAR decimal, nutrition, tags, IDs, or timestamps.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/options
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"groupId":"{{optionGroupId}}","key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Sauce"},"extraPriceHalala":200}
```

## PATCH /api/dashboard/menu/options/:id
### Purpose
Partially update global option/default pricing or move it to another active group.
### Used By
Option edit form.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"name":{"ar":"صلصة الثوم","en":"Garlic Dip"},"extraPriceHalala":250,"sortOrder":3}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Dip"},"extraPriceHalala":250,"extraFeeHalala":250,"sortOrder":3}}`
### Error Response
`{"ok":false,"error":{"code":"IMMUTABLE_KEY","message":"key is immutable"}}`
### Frontend Notes
All create-editable fields except key; existing CatalogItem link immutable. Product-specific overrides are unaffected.
### Validation
Same as create; target group active; key immutable.
### Important Do/Don't
Do distinguish global default from product override. Do not expect changing default to overwrite explicit overrides.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/options/{{optionId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"name":{"ar":"صلصة الثوم","en":"Garlic Dip"},"extraPriceHalala":250}
```

## PATCH /api/dashboard/menu/options/:id/visibility
### Purpose
Set global customer visibility.
### Used By
Option visibility switch.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"isVisible":false}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","isVisible":false}}`
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}`
### Frontend Notes
Only global visibility editable; affects every product link.
### Validation
Boolean; existing ID.
### Important Do/Don't
Do warn about global effect. Do not use for a single product.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/options/{{optionId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/options/:id/availability
### Purpose
Set global operational availability.
### Used By
Option availability switch.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"isAvailable":false}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","isAvailable":false}}`
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isAvailable must be boolean"}}`
### Frontend Notes
Only global availability editable; response otherwise read-only.
### Validation
Boolean; existing ID.
### Important Do/Don't
Do distinguish availability/visibility/activity. Do not assume publish is automatic.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/options/{{optionId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isAvailable":false}
```

## PATCH /api/dashboard/menu/options/:id/toggle
### Purpose
Toggle `isActive` to the inverse current value.
### Used By
Quick active/inactive action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
No request body.
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","key":"garlic_sauce","isActive":false}}`
### Error Response
`{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Menu entity not found"}}`
### Frontend Notes
Returned state is authoritative and read-only. Toggle also changes no visibility/availability flags.
### Validation
Existing ID.
### Important Do/Don't
Do disable repeated clicks until response. Do not optimistically derive state after concurrent edits.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/options/{{optionId}}/toggle
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## PATCH /api/dashboard/menu/options/reorder
### Purpose
Persist global option sort order.
### Used By
Option drag-and-drop list.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
`{"items":[{"id":"665f1b2e7b9a4d0012e50001","sortOrder":0},{"id":"665f1b2e7b9a4d0012e50003","sortOrder":1}]}`
### Success Response
`{"status":true,"data":{"updated":2}}`
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"items[].sortOrder must be an integer >= 0"}}`
### Frontend Notes
Only sort order editable; count read-only. Bare array accepted.
### Validation
Array; valid IDs; non-negative integer order.
### Important Do/Don't
Do send explicit order. Do not use this for product-specific option order.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/options/reorder
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"items":[{"id":"{{optionId}}","sortOrder":0}]}
```

## DELETE /api/dashboard/menu/options/:id
### Purpose
Soft-delete an option and deactivate all product-specific links.
### Used By
Archive-option action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
No request body.
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","key":"garlic_sauce","isActive":false}}`
### Error Response
`{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Menu entity not found"}}`
### Frontend Notes
Archive only; global option remains stored; links become inactive.
### Validation
Existing valid ID.
### Important Do/Don't
Do warn about all product links. Do not promise hard delete.
### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/options/{{optionId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## Linking and NOT IMPLEMENTED

Link/unlink is product-specific, not global: use POST/PUT/DELETE under `/products/:productId/option-groups/:groupId/options` from 11C. There is no direct global “link option to group” relation endpoint because `MenuOption.groupId` owns that membership; create with the group ID or PATCH `groupId`. No hard-delete or image-upload endpoint exists. Backend implementation is needed if either is required.
