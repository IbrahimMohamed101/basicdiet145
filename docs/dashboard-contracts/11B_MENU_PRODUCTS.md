# 11B — Menu Products API Contract

Verified against the dashboard menu route/controller/service/models and contract tests on 2026-06-20. All routes require a dashboard bearer token and role `admin` or `superadmin`.

## Shared product contract

Success: `{ "status": true, "data": ... }`. Error: `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`.

Editable product fields are `categoryId`, `catalogItemId` (only until first non-null assignment), `key` (create only), `name`, `description`, `imageUrl`, `itemType`, `pricingModel`, `priceHalala`, weight fields, `availableFor`, `isCustomizable`, `isActive`, `isVisible`, `isAvailable`, `sortOrder`, `ui`, and `branchAvailability`. Read-only: `id`, `_id`, `currency` (always `SAR`), `versionId`, `publishedAt`, timestamps, `__v`, detail `category`, `groupSummary`, and composer data. Send linked-record IDs, not populated objects. Prices are integer halala; the backend does not return `priceSar` or `priceLabel` from these admin endpoints.

Required on create: valid active `categoryId`, unique lower-case `snake_case` `key`, localized `name` with at least one value, `pricingModel` (`fixed` or `per_100g`; defaults `fixed`), and non-negative integer `priceHalala` (defaults 0 but active catalog validation requires a positive price). Weight fields are non-negative integers; `baseUnitGrams` and `weightStepGrams` coerce 0 to their defaults. `availableFor`: `one_time`, `subscription`. Product UI card sizes: `large`, `medium`, `small`.

## GET /api/dashboard/menu/products

### Purpose
List/filter products for the management table or picker.

### Used By
Products table and linked-record pickers.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
None.

### Query Params
| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `categoryId` | ObjectId | No | all | Exact category filter. |
| `isActive`, `isVisible`, `isAvailable` | boolean | No | active only / all / all | State filters. |
| `includeInactive` | boolean | No | `false` | Removes default active filter. |
| `availableFor` | enum | No | all | `one_time` or `subscription`. |
| `itemType` | string | No | all | Exact item-type filter. |
| `q` / `search` | string | No | none | Key/localized-name search. |
| `published` | boolean | No | all | Published/draft filter. |
| `view` | string | No | full | `picker` returns a small active-only shape. |
| `page` | integer | No | no pagination | Enables pagination; minimum 1. |
| `limit` | integer | No | `25` | 1–100. |

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012b20001","key":"greek_yogurt","categoryId":"665f1b2e7b9a4d0012a10001","name":{"ar":"زبادي يوناني","en":"Greek Yogurt"},"description":{"ar":"","en":""},"imageUrl":"https://cdn.example.com/yogurt.jpg","itemType":"product","pricingModel":"fixed","priceHalala":1800,"currency":"SAR","availableFor":["one_time","subscription"],"isCustomizable":true,"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":3,"ui":{"cardVariant":"compact_builder","cardSize":"medium"},"branchAvailability":[],"publishedAt":"2026-06-20T08:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":1,"pages":1}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_CATEGORY_ID","message":"Invalid categoryId"}}
```

### Frontend Notes
Without `page`/`limit`, `data` is an array. Picker rows contain only `id`, `key`, `name`, `category`, `image`, `isActive`; never submit that display object as an update.

### Validation
Invalid category/channel/boolean filters return 400.

### Important Do/Don't
Do use `priceHalala / 100` only for display. Do not send SAR decimals back as `priceHalala`.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products?categoryId={{categoryId}}&isActive=true&page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/products/:id

### Purpose
Read one product with category and linked-group summary.

### Used By
Product detail/edit page.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_product_detail.v3","product":{"id":"665f1b2e7b9a4d0012b20001","categoryId":"665f1b2e7b9a4d0012a10001","key":"greek_yogurt","priceHalala":1800,"isCustomizable":true},"category":{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","name":{"ar":"خيارات خفيفة","en":"Light Options"}},"groupSummary":{"linkedGroupCount":2,"composerEndpoint":"/api/dashboard/menu/products/665f1b2e7b9a4d0012b20001/composer","linkEndpoint":"/api/dashboard/menu/products/665f1b2e7b9a4d0012b20001/option-groups"}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Product not found"}}
```

### Frontend Notes
Edit only `data.product` editable fields. `category`, summary, endpoints, and computed `isCustomizable` are read-only.

### Validation
Valid ObjectId and existing product required.

### Important Do/Don't
Do open composer for relationships. Do not send the detail envelope to PATCH.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/products/{{productId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/products

### Purpose
Create a draft product.

### Used By
Create-product form.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
None.

### Query Params
None.

### Request Body
```json
{"categoryId":"665f1b2e7b9a4d0012a10001","key":"berry_yogurt","name":{"ar":"زبادي بالتوت","en":"Berry Yogurt"},"description":{"ar":"","en":"Greek yogurt with berries"},"imageUrl":"https://cdn.example.com/berry-yogurt.jpg","itemType":"product","pricingModel":"fixed","priceHalala":2200,"availableFor":["one_time","subscription"],"isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":4,"ui":{"cardVariant":"compact_builder","cardSize":"medium"},"branchAvailability":[]}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","categoryId":"665f1b2e7b9a4d0012a10001","key":"berry_yogurt","name":{"ar":"زبادي بالتوت","en":"Berry Yogurt"},"priceHalala":2200,"currency":"SAR","pricingModel":"fixed","isCustomizable":false,"publishedAt":null}}
```

### Error Response
```json
{"ok":false,"error":{"code":"MENU_CONFLICT","message":"Duplicate menu key","details":{"key":"berry_yogurt"}}}
```

### Frontend Notes
Use category/catalog IDs. `catalogItemId` may be null; once a non-null link exists it cannot be changed.

### Validation
The category must exist and be active; linked CatalogItem, when supplied, must be globally available. Key is unique and immutable.

### Important Do/Don't
Do send integer halala. Do not send populated category, calculated SAR labels, nutrition, option groups, IDs, or timestamps.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/products
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"categoryId":"{{categoryId}}","key":"berry_yogurt","name":{"ar":"زبادي بالتوت","en":"Berry Yogurt"},"pricingModel":"fixed","priceHalala":2200}
```

## PATCH /api/dashboard/menu/products/:id

### Purpose
Partially update product fields, including category assignment.

### Used By
Product edit form and category move.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
```json
{"categoryId":"665f1b2e7b9a4d0012a10002","name":{"ar":"زبادي بالتوت","en":"Berry Greek Yogurt"},"priceHalala":2400,"ui":{"cardSize":"large"}}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","key":"berry_yogurt","categoryId":"665f1b2e7b9a4d0012a10002","priceHalala":2400,"currency":"SAR","ui":{"cardVariant":"standard","cardSize":"large"}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"IMMUTABLE_KEY","message":"key is immutable","details":{"fieldName":"key"}}}
```

### Frontend Notes
Omitted fields are preserved. UI is merged with existing UI. `PATCH /products/:id/category` is an alias to this same handler and accepts the same body; prefer this canonical path.

### Validation
Same rules as create; linked category active; `key` and existing CatalogItem link immutable.

### Important Do/Don't
Do PATCH the changed fields. Do not treat `/category` as a different payload contract.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"priceHalala":2400,"ui":{"cardSize":"large"}}
```

## PATCH /api/dashboard/menu/products/:id/category

### Purpose
Compatibility alias for updating a product, commonly its `categoryId`.

### Used By
Legacy category-move UI.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
```json
{"categoryId":"665f1b2e7b9a4d0012a10002"}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","categoryId":"665f1b2e7b9a4d0012a10002","key":"berry_yogurt"}}
```

### Error Response
```json
{"ok":false,"error":{"code":"CATEGORY_NOT_FOUND","message":"categoryId does not reference an active category"}}
```

### Frontend Notes
Editable/read-only fields and validation exactly match PATCH product.

### Validation
Valid active category required.

### Important Do/Don't
Do prefer the canonical PATCH endpoint in new code. Do not send a category object.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/category
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"categoryId":"{{categoryId}}"}
```

## PATCH /api/dashboard/menu/products/:id/visibility

### Purpose
Change customer visibility independently of activity/availability.

### Used By
Visibility switch.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
```json
{"isVisible":false}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","isVisible":false}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}
```

### Frontend Notes
Only `isVisible` is editable here; response metadata is read-only.

### Validation
Boolean value.

### Important Do/Don't
Do label accurately. Do not use as archive.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/products/:productId/availability

### Purpose
Change global availability or branch availability.

### Used By
Product availability controls.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`productId` (required ObjectId).

### Query Params
None.

### Request Body
Global state: `{"isAvailable":false}`. Branch mode: `{"branchAvailability":["riyadh-north"]}`.

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","isAvailable":true,"branchAvailability":["riyadh-north"]}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"branchAvailability must be an array"}}
```

### Frontend Notes
If `branchAvailability` or `branchIds` is present, the controller updates only the branch list; otherwise it updates `isAvailable`.

### Validation
Branch values are strings; empty list means all branches.

### Important Do/Don't
Do make global and branch actions explicit. Do not expect both to update in one request containing branch fields.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/{{productId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"branchAvailability":["riyadh-north"]}
```

## PATCH /api/dashboard/menu/products/bulk

### Purpose
Apply allowed changes to several active products.

### Used By
Bulk product toolbar.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
None.

### Query Params
None.

### Request Body
```json
{"productIds":["665f1b2e7b9a4d0012b20001","665f1b2e7b9a4d0012b20002"],"changes":{"isVisible":false}}
```

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_product_bulk_update.v1","updatedCount":2,"products":[{"id":"665f1b2e7b9a4d0012b20001","isVisible":false}]}}
```

### Error Response
```json
{"ok":false,"error":{"code":"PRODUCT_NOT_FOUND","message":"One or more products do not exist or are inactive"}}
```

### Frontend Notes
IDs and result counts are read-only. Send the same intended editable changes for all selected products.

### Validation
Non-empty unique valid IDs; products active; `changes` object uses product update validation.

### Important Do/Don't
Do refresh rows after success. Do not send per-product populated objects.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/bulk
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"productIds":["{{productId}}"],"changes":{"isVisible":false}}
```

## PATCH /api/dashboard/menu/products/reorder

### Purpose
Persist product sort orders.

### Used By
Product drag-and-drop list.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
None.

### Query Params
None.

### Request Body
```json
{"items":[{"id":"665f1b2e7b9a4d0012b20001","sortOrder":0},{"id":"665f1b2e7b9a4d0012b20002","sortOrder":1}]}
```

### Success Response
```json
{"status":true,"data":{"updated":2}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"items[].sortOrder must be an integer >= 0"}}
```

### Frontend Notes
Only sort order is editable; result count read-only. Bare array is accepted, object preferred.

### Validation
Array, valid IDs, non-negative integer order.

### Important Do/Don't
Do send explicit orders. Do not infer order from request array position.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/products/reorder
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"items":[{"id":"{{productId}}","sortOrder":0}]}
```

## POST /api/dashboard/menu/products/:id/duplicate

### Purpose
Clone a product and all product/group and product/group/option relations as an inactive draft.

### Used By
Duplicate-product action.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20010","key":"berry_yogurt_copy","name":{"ar":"زبادي بالتوت","en":"Berry Yogurt"},"isActive":false,"publishedAt":null}}
```

### Error Response
```json
{"ok":false,"error":{"code":"DUPLICATE_KEY","message":"Conflict: A product with this key already exists"}}
```

### Frontend Notes
Entire response is read-only until opened in the edit form; the generated key is immutable.

### Validation
Source must exist; generated key must be unique.

### Important Do/Don't
Do route to the new ID and let the user edit/activate it. Do not assume the clone is published or active.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/products/{{productId}}/duplicate
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## DELETE /api/dashboard/menu/products/:id

### Purpose
Soft-delete a product and deactivate all its customization relations.

### Used By
Archive-product action.

### Auth
Dashboard `admin`/`superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012b20009","key":"berry_yogurt","isActive":false}}
```

### Error Response
```json
{"ok":false,"error":{"code":"MENU_ENTITY_NOT_FOUND","message":"Menu entity not found"}}
```

### Frontend Notes
This is archive, not physical deletion. Response is read-only.

### Validation
Valid existing ID. Route is additionally guarded as admin/superadmin (same as router-wide guard).

### Important Do/Don't
Do warn that linked customization becomes inactive. Do not promise undo restores relation states automatically.

### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/products/{{productId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED / Deprecated

No dedicated product image-upload endpoint, hard-delete endpoint, nutrition/macros fields on `MenuProduct`, or standalone active-toggle route exists. Obtain `imageUrl` through the existing upload workflow; PATCH `isActive`; use the customization API for linked groups. `/products/:id/category` is a compatibility alias, not a separate service contract.
