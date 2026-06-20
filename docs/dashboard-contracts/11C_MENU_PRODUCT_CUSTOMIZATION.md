# 11C — Product Customization API Contract

Verified on 2026-06-20 against the product-centered dashboard routes, controller, `menuCatalogService`, relation models, and `dashboardMenuProductCenteredContract.test.js`. Every route requires dashboard bearer auth and role `admin` or `superadmin`.

## How customization works

A product is customizable when `MenuProduct.isCustomizable=true`. Attaching a group sets it true automatically. A `ProductOptionGroup` links a global `MenuOptionGroup` to a product and owns `minSelections`, `maxSelections`, `isRequired`, relation status, and sort order. A `ProductGroupOption` links a global `MenuOption` to that product/group pair and can override price/weight values. Global group/option content is edited through 11D/11E; product-specific rules and overrides are edited here.

Required means `isRequired=true` and therefore `minSelections > 0`. `maxSelections` may be null (no explicit maximum) or >= minimum. Product-specific price values are integer halala; null means inherit the global option value. `effective*` fields are read-only resolved values.

Shared success wrapper: `{ "status": true, "data": ... }`. Shared error wrapper: `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`. Read-only everywhere: relation `id`/`_id`, `productId`, populated `group`/`option`, computed summary/status/validation/effective pricing, endpoints, timestamps, and version labels.

## GET /api/dashboard/menu/products/:productId/composer

### Purpose
Load the complete product customization editor.

### Used By
Product composer screen.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `productId` | ObjectId | Yes | Product to compose. |

### Query Params
| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `contractVersion` | enum | No | `v3` | Use `v4` for the normalized composer shape below; v1/v2 return 410. |

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_product_composer.v4","product":{"id":"665f1b2e7b9a4d0012b20001","key":"basic_meal","name":{"ar":"وجبة أساسية","en":"Basic Meal"},"categoryId":"665f1b2e7b9a4d0012a10001","isCustomizable":true,"isActive":true,"isVisible":true,"isAvailable":true},"category":{"id":"665f1b2e7b9a4d0012a10001","key":"custom_order","name":{"ar":"طلب مخصص","en":"Custom Order"}},"customization":{"enabled":true,"summary":{"linkedGroupCount":1,"linkedOptionCount":2,"requiredGroupCount":1},"groups":[{"productGroupId":"665f1b2e7b9a4d0012d40001","groupId":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"},"displayStyle":"radio_cards","rules":{"minSelections":1,"maxSelections":1,"isRequired":true},"status":{"isActive":true,"isVisible":true,"isAvailable":true},"sortOrder":0,"options":[],"optionPool":{"linkedCount":2,"availableCount":12,"endpoint":"/api/dashboard/menu/products/665f1b2e7b9a4d0012b20001/option-groups/665f1b2e7b9a4d0012c30001/option-pool"}}]},"availableActions":{"canEnableCustomization":true,"canDisableCustomization":true,"canAttachGroup":true,"canDetachGroup":true,"canReplaceGroupOptions":true,"canPatchOptionOverride":true},"validation":{"ok":true,"errors":[],"warnings":[]}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Product not found"}}
```

### Frontend Notes
Render groups/options and validation from this response; mutate through endpoints below, then refetch. All composer response fields are read-only.

### Validation
Valid existing product; only v3/v4 supported.

### Important Do/Don't
Do request `contractVersion=v4`. Do not PUT this hydrated envelope back.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products/{{productId}}/composer?contractVersion=v4
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## PATCH /api/dashboard/menu/products/:productId/customization

### Purpose
Enable/disable customization and optionally clear all relations.

### Used By
Composer master switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`productId` (required ObjectId).

### Query Params
None.

### Request Body
Editable: `isCustomizable`, `clearRelations`.
```json
{"isCustomizable":false,"clearRelations":true}
```

### Success Response
Returns the v4 composer; example: `{"status":true,"data":{"contractVersion":"dashboard_product_composer.v4","product":{"id":"665f1b2e7b9a4d0012b20001","isCustomizable":false},"customization":{"enabled":false,"summary":{"linkedGroupCount":0,"linkedOptionCount":0,"requiredGroupCount":0},"groups":[]},"validation":{"ok":true,"errors":[],"warnings":[]}}}`.

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isCustomizable must be boolean"}}
```

### Frontend Notes
Disabling without `clearRelations:true` preserves relations. Clearing is destructive and returned IDs/summary are read-only.

### Validation
Boolean values; product must exist.

### Important Do/Don't
Do require confirmation before clearing. Do not assume disabling deletes relations.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/customization
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isCustomizable":true,"clearRelations":false}
```

## GET /api/dashboard/menu/customization-library

### Purpose
Load all global groups/options available to the composer library.

### Used By
Attach-group and option-pool dialogs.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
None.

### Query Params
Supports `isActive`, `isVisible`, `isAvailable`, `q`, `published`; inactive records are included by design unless explicitly filtered.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_customization_library.v1","groups":[{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"},"status":{"isActive":true,"isVisible":true,"isAvailable":true}}],"options":[{"id":"665f1b2e7b9a4d0012e50001","groupId":"665f1b2e7b9a4d0012c30001","key":"grilled_chicken","name":{"ar":"دجاج مشوي","en":"Grilled Chicken"}}]}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"published must be boolean"}}
```

### Frontend Notes
Library data is read-only here; global edits use 11D/11E.

### Validation
Same list-filter validation as other menu lists.

### Important Do/Don't
Do show disabled badges. Do not attach populated objects; send IDs.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/customization-library?isActive=true
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/products/:productId/option-groups

### Purpose
List raw product/group relations.

### Used By
Composer relation table and diagnostics.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`productId` (required ObjectId).

### Query Params
Standard state/search/published filters; optional `page`, `limit` (1–100).

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":[{"id":"665f1b2e7b9a4d0012d40001","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","minSelections":1,"maxSelections":1,"isRequired":true,"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":0}]}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"productId must be a valid ObjectId"}}
```

### Frontend Notes
Without pagination data is array; with it data is `{items,pagination}`. IDs/metadata read-only; rules/status/order editable through PATCH routes.

### Validation
Product ID format is validated; this list does not separately assert product existence.

### Important Do/Don't
Do use composer for hydrated display. Do not expect group names here.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups?includeInactive=true
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/products/:productId/option-groups

### Purpose
Attach/reactivate a global group and optionally link initial options.

### Used By
Attach-group dialog.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`productId` (required ObjectId).

### Query Params
None.

### Request Body
Required `groupId`; editable rules/status/order; choose either `initialOptionIds` or `linkAllOptions`.
```json
{"groupId":"665f1b2e7b9a4d0012c30001","minSelections":1,"maxSelections":1,"isRequired":true,"sortOrder":0,"initialOptionIds":["665f1b2e7b9a4d0012e50001"]}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012d40001","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","minSelections":1,"maxSelections":1,"isRequired":true,"isActive":true,"sortOrder":0}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_SELECTION_RULES","message":"minSelections must be > 0 when isRequired=true"}}
```

### Frontend Notes
Send IDs only. Attaching makes the product customizable. Inactive/unavailable CatalogItem-linked options are filtered out of initial linking.

### Validation
Product/group must exist; selection rules valid; IDs valid; duplicate attachment reactivates/updates existing relation.

### Important Do/Don't
Do inspect the refreshed composer. Do not send `group` or `options` objects.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"groupId":"{{optionGroupId}}","minSelections":1,"maxSelections":1,"isRequired":true,"linkAllOptions":false}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId

### Purpose
Update all editable fields on a product/group relation.

### Used By
Group settings drawer.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
```json
{"minSelections":0,"maxSelections":2,"isRequired":false,"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":1}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012d40001","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","minSelections":0,"maxSelections":2,"isRequired":false,"sortOrder":1}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_SELECTION_RULES","message":"maxSelections must be null or >= minSelections"}}
```

### Frontend Notes
Editable fields are those in the body; relation IDs/timestamps read-only.

### Validation
Relation must exist; non-negative integers; required implies min > 0.

### Important Do/Don't
Do use dedicated routes below for isolated switches/rules. Do not change `groupId`.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"minSelections":0,"maxSelections":2,"isRequired":false,"sortOrder":1}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules

### Purpose
Update only required/min/max rules.

### Used By
Selection-rules form.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
```json
{"minSelections":1,"maxSelections":3,"isRequired":true}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012d40001","minSelections":1,"maxSelections":3,"isRequired":true}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_SELECTION_RULES","message":"maxSelections must be null or >= minSelections"}}
```

### Frontend Notes
Only the three rule fields are editable; IDs/status read-only.

### Validation
Min >= 0; max null or >= min; required => min > 0.

### Important Do/Don't
Do allow null max. Do not use 0 as “unlimited”; use null.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/selection-rules
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"minSelections":1,"maxSelections":3,"isRequired":true}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/visibility

### Purpose
Change product-specific group visibility.

### Used By
Linked-group visibility switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
`{"isVisible":false}`

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012d40001","isVisible":false}}`

### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}`

### Frontend Notes
Only relation `isVisible` editable; global group visibility may still suppress it.

### Validation
Relation must exist; boolean.

### Important Do/Don't
Do distinguish relation vs global state. Do not reactivate a globally hidden group here.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/availability

### Purpose
Change product-specific group availability.

### Used By
Linked-group availability switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
`{"isAvailable":false}`

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012d40001","isAvailable":false}}`

### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isAvailable must be boolean"}}`

### Frontend Notes
Only relation availability editable; global status is read-only here.

### Validation
Relation exists; boolean.

### Important Do/Don't
Do refetch validation. Do not confuse with visibility.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isAvailable":false}
```

## DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId

### Purpose
Detach a group and all its product-specific option links.

### Used By
Remove-group action.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
No request body.

### Success Response
`{"status":true,"data":{"deleted":1}}`

### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"id must be a valid ObjectId"}}`

### Frontend Notes
`deleted` is read-only; 0 means there was no relation. Product `isCustomizable` is recalculated after relation deletion by service behavior.

### Validation
Valid IDs.

### Important Do/Don't
Do confirm and refresh composer. Do not expect global group/options to be deleted.

### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/products/:productId/option-groups/:groupId/option-pool

### Purpose
List candidate global options with linked/default/override/effective state.

### Used By
Option-pool modal.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
`includeDisabled` boolean (default false), `onlySuggested` boolean (default false), `suggestedGroupId` ObjectId (default current group), `search`/`q` string.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_product_group_option_pool.v4","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","group":{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"}},"options":[{"optionId":"665f1b2e7b9a4d0012e50001","key":"grilled_chicken","name":{"ar":"دجاج مشوي","en":"Grilled Chicken"},"isLinked":true,"productOptionId":"665f1b2e7b9a4d0012f60001","suggestedGroupId":"665f1b2e7b9a4d0012c30001","defaultPricing":{"extraPriceHalala":0,"currency":"SAR"},"overridePricing":{"extraPriceHalala":500,"currency":"SAR"},"effectivePricing":{"extraPriceHalala":500,"currency":"SAR"},"nutrition":{"calories":165},"status":{"isActive":true,"isVisible":true,"isAvailable":true}}]}}
```

### Error Response
`{"ok":false,"error":{"code":"RELATION_NOT_FOUND","message":"Product group relation does not exist"}}`

### Frontend Notes
All pool fields read-only; select `optionId`s and save via PUT or POST.

### Validation
Product/group/relation must exist; query booleans and IDs valid.

### Important Do/Don't
Do display effective pricing. Do not submit effective/default objects.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/option-pool?onlySuggested=true&includeDisabled=false
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/products/:productId/option-groups/:groupId/options

### Purpose
List raw product/group/option relations.

### Used By
Linked-option table/diagnostics.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
Standard state filters and optional `page`, `limit`.

### Request Body
No request body.

### Success Response
`{"status":true,"data":[{"id":"665f1b2e7b9a4d0012f60001","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","optionId":"665f1b2e7b9a4d0012e50001","extraPriceHalala":500,"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":0}]}`

### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"groupId must be a valid ObjectId"}}`

### Frontend Notes
Use option-pool/composer for labels. Overrides/status/order editable; IDs read-only.

### Validation
Valid IDs; pagination 1–100.

### Important Do/Don't
Do handle array vs paginated envelope. Do not expect populated options.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options?page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/products/:productId/option-groups/:groupId/options

### Purpose
Attach/reactivate one option with optional product-specific overrides.

### Used By
Add-option action.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
```json
{"optionId":"665f1b2e7b9a4d0012e50001","extraPriceHalala":500,"extraWeightUnitGrams":null,"extraWeightPriceHalala":null,"sortOrder":0,"isActive":true,"isVisible":true,"isAvailable":true}
```

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012f60001","productId":"665f1b2e7b9a4d0012b20001","groupId":"665f1b2e7b9a4d0012c30001","optionId":"665f1b2e7b9a4d0012e50001","extraPriceHalala":500,"isActive":true}}`

### Error Response
`{"ok":false,"error":{"code":"OPTION_NOT_ALLOWED","message":"Option does not exist or is globally disabled"}}`

### Frontend Notes
Send `optionId`, not option object. Null override inherits global value.

### Validation
Parent relation exists; option exists and is globally active; overrides null or non-negative integers.

### Important Do/Don't
Do use halala. Do not edit global option content here.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"optionId":"{{optionId}}","extraPriceHalala":500,"sortOrder":0}
```

## PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options

### Purpose
Replace the entire linked-option set atomically at API level.

### Used By
Option-pool Save button.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`.

### Query Params
None.

### Request Body
```json
{"optionIds":["665f1b2e7b9a4d0012e50001","665f1b2e7b9a4d0012e50002"],"preserveOverrides":true}
```

### Success Response
Returns the v4 composer: `{"status":true,"data":{"contractVersion":"dashboard_product_composer.v4","customization":{"groups":[{"groupId":"665f1b2e7b9a4d0012c30001","options":[{"optionId":"665f1b2e7b9a4d0012e50001"}]}]}}}`.

### Error Response
`{"ok":false,"error":{"code":"OPTION_NOT_AVAILABLE","message":"One or more options are linked to unavailable catalog items"}}`

### Frontend Notes
Editable: exact `optionIds` set and preserve flag. Omitted existing IDs are deleted. Returned composer read-only.

### Validation
All options active and globally available; parent relation exists; duplicates deduplicated.

### Important Do/Don't
Do send the complete desired set. Do not use PUT as “add one.”

### Postman
```http
PUT {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"optionIds":["{{optionId}}"],"preserveOverrides":true}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId

### Purpose
Update product-specific price/weight overrides, status, or sort order.

### Used By
Linked-option override editor.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`, `optionId`.

### Query Params
None.

### Request Body
Allowed fields only: `extraPriceHalala`, `extraWeightPriceHalala`, `extraWeightUnitGrams`, `sortOrder`, `isActive`, `isVisible`, `isAvailable`.
```json
{"extraPriceHalala":700,"sortOrder":1}
```

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012f60001","optionId":"665f1b2e7b9a4d0012e50001","extraPriceHalala":700,"sortOrder":1}}`

### Error Response
`{"ok":false,"error":{"code":"MENU_VALIDATION_ERROR","message":"الحقول [name] غير مسموح بتعديلها هنا. استخدمPATCH /menu/options/:optionId للقيم العامة.","details":{"invalidFields":["name"]}}}`

### Frontend Notes
Only allowlisted relation fields editable. Use global option PATCH for name/image/default pricing.

### Validation
Overrides null or integer >= 0; sort >= 0; booleans valid; relation exists.

### Important Do/Don't
Do send null to remove an override. Do not send `optionId`, names, nutrition, or global price fields.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options/{{optionId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"extraPriceHalala":700,"sortOrder":1}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/visibility

### Purpose
Set product-specific option visibility.

### Used By
Linked-option visibility switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`, `optionId`.

### Query Params
None.

### Request Body
`{"isVisible":false}`

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012f60001","isVisible":false}}`

### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}`

### Frontend Notes
Relation switch only; global option can still suppress display.

### Validation
Boolean; relation exists.

### Important Do/Don't
Do show global and local status. Do not call this global visibility.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options/{{optionId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability

### Purpose
Set product-specific option availability.

### Used By
Linked-option availability switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`, `optionId`.

### Query Params
None.

### Request Body
`{"isAvailable":false}`

### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012f60001","isAvailable":false}}`

### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isAvailable must be boolean"}}`

### Frontend Notes
Relation switch only; other fields read-only.

### Validation
Boolean; relation exists.

### Important Do/Don't
Do refresh composer warnings. Do not confuse with active or visible.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options/{{optionId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isAvailable":false}
```

## DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId

### Purpose
Unlink one option from this product/group only.

### Used By
Remove-option action.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
Required ObjectIds: `productId`, `groupId`, `optionId`.

### Query Params
None.

### Request Body
No request body.

### Success Response
`{"status":true,"data":{"deleted":1}}`

### Error Response
`{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"id must be a valid ObjectId"}}`

### Frontend Notes
Global option is untouched. `deleted` read-only; 0 means already absent.

### Validation
Valid IDs.

### Important Do/Don't
Do recheck required-group minimums. Do not delete the global option unless intended everywhere.

### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/products/{{productId}}/option-groups/{{optionGroupId}}/options/{{optionId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED

There is no single endpoint that accepts the entire hydrated composer for saving, no separate group reorder endpoint within a product, and no automatic repair endpoint for composer validation errors. Save through the focused endpoints above; use relation `sortOrder` PATCHes for ordering. Backend work is required for a transactional whole-composer save or dedicated relation reorder operation.
