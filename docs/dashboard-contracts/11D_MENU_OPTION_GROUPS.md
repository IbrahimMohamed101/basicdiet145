# 11D — Global Menu Option Groups API Contract

Verified on 2026-06-20. All routes require dashboard bearer auth and `admin`/`superadmin`. Success is `{ "status": true, "data": ... }`; error is `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`.

Global group fields are `key`, localized `name`/`description`, `isActive`, `isVisible`, `isAvailable`, `sortOrder`, and `ui.displayStyle`. Selection rules (`minSelections`, `maxSelections`, `isRequired`) do **not** belong here; they belong to each product/group relation in 11C. Likewise, the backend has no `type`, `selectionMode`, or `optionIds` fields on `MenuOptionGroup`. Read-only: IDs, publish metadata, timestamps, `__v`, detail `options`, usage counts, and actions. Required on create: unique immutable lower-case `snake_case` `key`, and at least one localized name. Display styles: `chips`, `radio_cards`, `checkbox_grid`, `dropdown`, `stepper`.

## GET /api/dashboard/menu/option-groups
### Purpose
List global groups for management/pickers.
### Used By
Option-group table and composer library.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
`includeInactive` boolean default false; `isActive`, `isVisible`, `isAvailable`, `published` optional booleans; `q` optional search; `page`/`limit` optional pagination (defaults 1/25, limit max 100 once enabled).
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"},"description":{"ar":"","en":"Choose protein"},"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":0,"ui":{"displayStyle":"radio_cards"},"publishedAt":"2026-06-20T08:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":1,"pages":1}}}
```
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isActive must be boolean"}}`
### Frontend Notes
Without page/limit, `data` is an array. Render localized name; send `id` to relation endpoints. Editable/read-only fields are defined above.
### Validation
Filters use boolean parsing; search covers key/names.
### Important Do/Don't
Do request inactive rows for management. Do not infer product-specific rules.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/option-groups?includeInactive=true&page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/option-groups/:id
### Purpose
Get group, its global options, and product usage count.
### Used By
Group detail/editor.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
`contractVersion` optional `v3`/`v4`; state filters apply to nested options.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_option_group_detail.v3","optionGroup":{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"},"ui":{"displayStyle":"radio_cards"}},"options":[{"id":"665f1b2e7b9a4d0012e50001","groupId":"665f1b2e7b9a4d0012c30001","key":"grilled_chicken"}],"usage":{"linkedProductsCount":4},"actions":{"canAddOptions":true,"canReorderOptions":true}}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Menu entity not found"}}`
### Frontend Notes
Edit only `optionGroup`; options/usage/actions/version are read-only here.
### Validation
Valid existing ID; v1/v2 return 410.
### Important Do/Don't
Do use usage count before archive. Do not send the detail envelope to PATCH.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}?contractVersion=v3&includeInactive=true
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/option-groups
### Purpose
Create a global group.
### Used By
Create-group form.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
```json
{"key":"sauces","name":{"ar":"الصلصات","en":"Sauces"},"description":{"ar":"","en":"Choose a sauce"},"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":3,"ui":{"displayStyle":"chips"}}
```
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012c30003","key":"sauces","name":{"ar":"الصلصات","en":"Sauces"},"sortOrder":3,"ui":{"displayStyle":"chips"},"publishedAt":null}}`
### Error Response
`{"ok":false,"error":{"code":"MENU_CONFLICT","message":"Duplicate menu key","details":{"key":"sauces"}}}`
### Frontend Notes
Send only editable fields; publish later. Do not include selection rules or options.
### Validation
Key/name required; unique key; allowed display style; sort integer >=0.
### Important Do/Don't
Do create options separately. Do not send `type`, `selectionMode`, `optionIds`, or populated options.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/option-groups
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"key":"sauces","name":{"ar":"الصلصات","en":"Sauces"},"ui":{"displayStyle":"chips"}}
```

## PATCH /api/dashboard/menu/option-groups/:id
### Purpose
Partially update global group content/status/order.
### Used By
Group edit form.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"name":{"ar":"الصلصات","en":"Sauces & Dips"},"sortOrder":4,"ui":{"displayStyle":"checkbox_grid"}}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012c30003","key":"sauces","name":{"ar":"الصلصات","en":"Sauces & Dips"},"sortOrder":4,"ui":{"displayStyle":"checkbox_grid"}}}`
### Error Response
`{"ok":false,"error":{"code":"IMMUTABLE_KEY","message":"key is immutable"}}`
### Frontend Notes
All create fields except key editable; omitted fields preserved.
### Validation
Same as create; key immutable.
### Important Do/Don't
Do use product relation endpoint for min/max. Do not update linked products here.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"name":{"ar":"الصلصات","en":"Sauces & Dips"},"ui":{"displayStyle":"checkbox_grid"}}
```

## PATCH /api/dashboard/menu/option-groups/:id/visibility
### Purpose
Set global customer visibility.
### Used By
Group visibility switch.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"isVisible":false}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012c30003","isVisible":false}}`
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}`
### Frontend Notes
Only `isVisible` editable; hiding globally suppresses it for all products.
### Validation
Boolean; existing ID.
### Important Do/Don't
Do warn about global effect. Do not confuse with one product relation.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/option-groups/:id/availability
### Purpose
Set global operational availability.
### Used By
Group availability switch.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
`{"isAvailable":false}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012c30003","isAvailable":false}}`
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isAvailable must be boolean"}}`
### Frontend Notes
Only availability editable; applies globally.
### Validation
Boolean; existing ID.
### Important Do/Don't
Do display affected-product warning. Do not call it visibility.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isAvailable":false}
```

## PATCH /api/dashboard/menu/option-groups/reorder
### Purpose
Persist global group order.
### Used By
Group drag-and-drop table.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
`{"items":[{"id":"665f1b2e7b9a4d0012c30001","sortOrder":0},{"id":"665f1b2e7b9a4d0012c30003","sortOrder":1}]}`
### Success Response
`{"status":true,"data":{"updated":2}}`
### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"items[].id must be a valid ObjectId"}}`
### Frontend Notes
`sortOrder` editable; updated count read-only. Bare array also accepted.
### Validation
Array; valid IDs; integer order >=0.
### Important Do/Don't
Do send explicit orders. Do not use this to reorder product-linked relations.
### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/option-groups/reorder
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"items":[{"id":"{{optionGroupId}}","sortOrder":0}]}
```

## GET /api/dashboard/menu/option-groups/:groupId/options
### Purpose
List global options belonging to a group.
### Used By
Group options tab.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`groupId` required ObjectId.
### Query Params
Standard state/search/published filters and optional `page`, `limit`.
### Request Body
No request body.
### Success Response
`{"status":true,"data":[{"id":"665f1b2e7b9a4d0012e50001","groupId":"665f1b2e7b9a4d0012c30001","key":"grilled_chicken","name":{"ar":"دجاج مشوي","en":"Grilled Chicken"},"extraPriceHalala":0,"currency":"SAR","isActive":true}]}`
### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"groupId must be a valid ObjectId"}}`
### Frontend Notes
Option response fields follow 11E; this is list/read, not relation linking.
### Validation
Valid group ID format; list does not separately assert group existence.
### Important Do/Don't
Do use option IDs. Do not confuse global membership with product linking.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}/options?includeInactive=true
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/option-groups/:groupId/options
### Purpose
Create a global option with group ID supplied by path.
### Used By
Add-option-from-group form.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`groupId` required ObjectId.
### Query Params
None.
### Request Body
`{"key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Sauce"},"extraPriceHalala":200,"sortOrder":2}`
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012e50003","groupId":"665f1b2e7b9a4d0012c30003","key":"garlic_sauce","extraPriceHalala":200,"currency":"SAR"}}`
### Error Response
`{"ok":false,"error":{"code":"MENU_CONFLICT","message":"Duplicate menu key"}}`
### Frontend Notes
Same editable/read-only fields as option create in 11E; path wins for `groupId`.
### Validation
Group active; option key unique within group; 11E validation.
### Important Do/Don't
Do omit `groupId` from body. Do not assume it attaches to products.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}/options
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"key":"garlic_sauce","name":{"ar":"صلصة الثوم","en":"Garlic Sauce"},"extraPriceHalala":200}
```

## DELETE /api/dashboard/menu/option-groups/:id
### Purpose
Soft-delete a global group (`isActive=false`).
### Used By
Archive-group action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`id` required ObjectId.
### Query Params
None.
### Request Body
No request body.
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012c30003","key":"sauces","isActive":false}}`
### Error Response
`{"ok":false,"error":{"code":"GROUP_IN_USE","message":"Cannot delete option group currently linked to 2 products","details":{"relationCount":2}}}`
### Frontend Notes
Archive only; response read-only.
### Validation
Blocked while active product/group relations exist.
### Important Do/Don't
Do detach it from products first. Do not promise hard deletion.
### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/option-groups/{{optionGroupId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED

No global group hard-delete, global group active-toggle, or group-owned selection-mode/min/max endpoint exists. PATCH `isActive` for status; configure selection rules per product through 11C. A dedicated global “selectionMode” feature would require backend implementation.
