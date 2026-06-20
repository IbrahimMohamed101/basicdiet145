# 11A — Menu Categories API Contract

Verified against `src/routes/dashboardMenu.js`, `src/controllers/dashboard/menuController.js`, `src/services/orders/menuCatalogService.js`, the Mongoose models, and dashboard menu tests on 2026-06-20.

All endpoints require `Authorization: Bearer {{dashboardToken}}` and a dashboard role of `admin` or `superadmin`. Successful responses use `{ "status": true, "data": ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`. IDs, timestamps, `_id`, `__v`, `publishedAt`, and computed product counts are read-only.

Category fields: editable `key` (create only), `name.ar`, `name.en`, `description.ar`, `description.en`, `imageUrl`, `sortOrder`, `isActive`, `isVisible`, `isAvailable`, `ui`, and `availability.branchIds`. `key` is required on create, lower-case `snake_case`, globally unique, and immutable. At least one localized name is required. `sortOrder` is an integer >= 0. Do not send `image` or `icon`; the backend field is `imageUrl`. No category product-count field is returned by list/write operations; detail returns a `products` array.

## GET /api/dashboard/menu/categories

### Purpose
List categories for the category table. Default behavior returns active rows only.

### Used By
Category list, filters, and product category picker.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
None.

### Query Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `includeInactive` | boolean | No | `false` | When `true`, do not apply the default `isActive=true` filter. |
| `isActive` | boolean | No | active only | Explicit active filter. |
| `isVisible` | boolean | No | all | Explicit customer-visibility filter. |
| `isAvailable` | boolean | No | all | Explicit operational-availability filter. |
| `published` | boolean | No | all | `true` means `publishedAt != null`; `false` means draft. |
| `q` | string | No | none | Case-insensitive key/Arabic-name/English-name search. |
| `page` | integer | No | no pagination | Supplying `page` or `limit` enables pagination; minimum 1. |
| `limit` | integer | No | `25` | Pagination size, 1–100. |

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012a10001","_id":"665f1b2e7b9a4d0012a10001","key":"light_options","name":{"ar":"خيارات خفيفة","en":"Light Options"},"description":{"ar":"","en":""},"imageUrl":"https://cdn.example.com/light-options.jpg","isActive":true,"isVisible":true,"isAvailable":true,"sortOrder":2,"ui":{"cardVariant":"compact_builder_collection"},"availability":{"branchIds":[]},"publishedAt":"2026-06-20T08:00:00.000Z","createdAt":"2026-06-19T08:00:00.000Z","updatedAt":"2026-06-20T08:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":1,"pages":1}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isActive must be boolean"}}
```

### Frontend Notes
Render `name[locale]` with fallback; use `id` for later calls. Without `page`/`limit`, `data` is an array rather than the paginated object. Read-only: IDs, publish metadata, timestamps. Editable fields are listed above.

### Validation
Boolean query strings accept common true/false spellings. Do not assume `isActive`, `isVisible`, and `isAvailable` mean the same thing.

### Important Do/Don't
Do request `includeInactive=true` for an all-status management table. Do not infer product count from this response.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/categories?includeInactive=true&page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/categories/:id

### Purpose
Get one category plus its products and assignment actions.

### Used By
Category detail/edit drawer.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | ObjectId | Yes | Category ID. |

### Query Params
Supports `contractVersion` (`v3` or `v4`; default current), plus the status/search filters from the list endpoint for the nested products.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_category_detail.v3","category":{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","name":{"ar":"خيارات خفيفة","en":"Light Options"},"isActive":true,"sortOrder":2},"products":[{"id":"665f1b2e7b9a4d0012b20001","categoryId":"665f1b2e7b9a4d0012a10001","key":"greek_yogurt","isCustomizable":true}],"assignment":{"relationOwner":"product.categoryId","bulkAssignmentEndpoint":"/api/dashboard/menu/categories/665f1b2e7b9a4d0012a10001/products"},"actions":{"canBulkAssignProducts":true,"canReorderProducts":true}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"id must be a valid ObjectId"}}
```

### Frontend Notes
Treat `products`, `assignment`, `actions`, `contractVersion`, and all IDs/metadata as read-only. Edit the nested `category` through PATCH; move products through the bulk-assignment endpoint.

### Validation
`id` must be a Mongo ObjectId. Contract versions v1/v2 return HTTP 410.

### Important Do/Don't
Do use `products.length` as the detail-screen count. Do not PUT the detail envelope back.

### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}?contractVersion=v3&includeInactive=true
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/categories

### Purpose
Create a draft category.

### Used By
Create-category form.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
None.

### Query Params
None.

### Request Body
Required: `key`, and `name` with at least one non-empty locale.
```json
{"key":"healthy_snacks","name":{"ar":"وجبات خفيفة صحية","en":"Healthy Snacks"},"description":{"ar":"","en":"Quick add-ons"},"imageUrl":"https://cdn.example.com/healthy-snacks.jpg","sortOrder":8,"isActive":true,"isVisible":true,"isAvailable":true,"ui":{"cardVariant":"addon_collection"},"availability":{"branchIds":["riyadh-north"]}}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012a10008","key":"healthy_snacks","name":{"ar":"وجبات خفيفة صحية","en":"Healthy Snacks"},"description":{"ar":"","en":"Quick add-ons"},"imageUrl":"https://cdn.example.com/healthy-snacks.jpg","sortOrder":8,"isActive":true,"isVisible":true,"isAvailable":true,"availability":{"branchIds":["riyadh-north"]},"publishedAt":null}}
```

### Error Response
```json
{"ok":false,"error":{"code":"MENU_CONFLICT","message":"Duplicate menu key","details":{"key":"healthy_snacks"}}}
```

### Frontend Notes
Send only editable fields. The returned category is not customer-live until publish.

### Validation
Allowed `ui.cardVariant`: `meal_builder`, `light_collection`, `hero_builder_collection`, `compact_builder_collection`, `meal_collection`, `compact_product_collection`, `sandwich_collection`, `addon_collection`.

### Important Do/Don't
Do send the image URL after the existing upload flow gives one. Do not send `id`, `_id`, timestamps, `publishedAt`, or products.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/categories
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"key":"healthy_snacks","name":{"ar":"وجبات خفيفة صحية","en":"Healthy Snacks"},"sortOrder":8}
```

## PATCH /api/dashboard/menu/categories/:id

### Purpose
Partially update category content and settings.

### Used By
Category edit form.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
`id` (required ObjectId): category ID.

### Query Params
None.

### Request Body
```json
{"name":{"ar":"خيارات خفيفة","en":"Light Choices"},"description":{"ar":"","en":"Fresh light choices"},"imageUrl":"https://cdn.example.com/light-v2.jpg","sortOrder":3}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","name":{"ar":"خيارات خفيفة","en":"Light Choices"},"sortOrder":3,"updatedAt":"2026-06-20T09:00:00.000Z"}}
```

### Error Response
```json
{"ok":false,"error":{"code":"IMMUTABLE_KEY","message":"key is immutable","details":{"fieldName":"key"}}}
```

### Frontend Notes
All create-editable fields remain editable except `key`. Omitted fields retain current values.

### Validation
Same field validation as create; `key` cannot change.

### Important Do/Don't
Do PATCH only changed fields. Do not use this endpoint as the dedicated visibility/availability action when those switches are presented separately.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"name":{"ar":"خيارات خفيفة","en":"Light Choices"},"sortOrder":3}
```

## PATCH /api/dashboard/menu/categories/:id/visibility

### Purpose
Show or hide a category from customers without deleting it.

### Used By
Category visibility switch.

### Auth
Dashboard `admin` or `superadmin` required.

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
{"status":true,"data":{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","isVisible":false}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"isVisible must be boolean"}}
```

### Frontend Notes
Only `isVisible` is editable here; all response fields are display/read-only.

### Validation
Boolean required in practice; omission falls back to the current value.

### Important Do/Don't
Do label this “Customer visibility.” Do not call it delete or active status.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}/visibility
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isVisible":false}
```

## PATCH /api/dashboard/menu/categories/:id/availability

### Purpose
Enable/disable operational availability or set branch IDs.

### Used By
Availability controls.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
```json
{"isAvailable":true,"branchIds":["riyadh-north","riyadh-east"]}
```

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012a10001","isAvailable":true,"availability":{"branchIds":["riyadh-north","riyadh-east"]}}}
```

### Error Response
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"branchIds must be an array"}}
```

### Frontend Notes
Editable: `isAvailable`, `branchIds` (or `availability.branchIds`). Keep visibility as a separate switch.

### Validation
Branch IDs are trimmed strings; empty array means all branches.

### Important Do/Don't
Do send the complete desired branch list. Do not send product branch settings here.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}/availability
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"isAvailable":true,"branchIds":["riyadh-north"]}
```

## POST /api/dashboard/menu/categories/:id/products

### Purpose
Bulk move active products into this category; ownership is `product.categoryId`.

### Used By
Category product assignment modal.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
`id` (required ObjectId): destination category.

### Query Params
None.

### Request Body
Required: non-empty `productIds`; optional `mode`, whose only supported value is `assign`.
```json
{"mode":"assign","productIds":["665f1b2e7b9a4d0012b20001","665f1b2e7b9a4d0012b20002"]}
```

### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_category_assignment.v1","categoryId":"665f1b2e7b9a4d0012a10001","assignedCount":2,"products":[{"id":"665f1b2e7b9a4d0012b20001","categoryId":"665f1b2e7b9a4d0012a10001"}]}}
```

### Error Response
```json
{"ok":false,"error":{"code":"PRODUCT_NOT_FOUND","message":"One or more products do not exist or are inactive"}}
```

### Frontend Notes
Send IDs only, never populated product objects. The response and count are read-only.

### Validation
Destination and every product must exist and be active; IDs must be valid and list non-empty; duplicate IDs are deduplicated.

### Important Do/Don't
Do refresh both affected category views. Do not send `unassign`; it is unsupported—assign the product to another category instead.

### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}/products
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"mode":"assign","productIds":["665f1b2e7b9a4d0012b20001"]}
```

## PATCH /api/dashboard/menu/categories/reorder

### Purpose
Persist category sort order.

### Used By
Category drag-and-drop list.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
None.

### Query Params
None.

### Request Body
```json
{"items":[{"id":"665f1b2e7b9a4d0012a10001","sortOrder":0},{"id":"665f1b2e7b9a4d0012a10002","sortOrder":1}]}
```

### Success Response
```json
{"status":true,"data":{"updated":2}}
```

### Error Response
```json
{"ok":false,"error":{"code":"INVALID_OBJECT_ID","message":"items[].id must be a valid ObjectId"}}
```

### Frontend Notes
Editable: each `sortOrder`; `updated` is read-only. The endpoint also accepts a bare array, but the object shape is preferred.

### Validation
`items` must be an array; IDs valid; sort orders integers >= 0. The service does not reject duplicate sort numbers.

### Important Do/Don't
Do send every reordered row. Do not rely on array position without explicit `sortOrder`.

### Postman
```http
PATCH {{baseUrl}}/api/dashboard/menu/categories/reorder
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"items":[{"id":"665f1b2e7b9a4d0012a10001","sortOrder":0}]}
```

## DELETE /api/dashboard/menu/categories/:id

### Purpose
Soft-delete a category by setting `isActive=false`.

### Used By
Category archive action.

### Auth
Dashboard `admin` or `superadmin` required.

### Path Params
`id` (required ObjectId).

### Query Params
None.

### Request Body
No request body.

### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","isActive":false}}
```

### Error Response
```json
{"ok":false,"error":{"code":"CATEGORY_IN_USE","message":"Cannot delete category with 3 active products","details":{"productCount":3}}}
```

### Frontend Notes
Present as archive/deactivate, not permanent deletion. Response fields are read-only.

### Validation
Blocked while any active products reference the category.

### Important Do/Don't
Do move/archive active products first. Do not promise hard deletion or ID reuse.

### Postman
```http
DELETE {{baseUrl}}/api/dashboard/menu/categories/{{categoryId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED

There is no category hard-delete endpoint, image-upload endpoint, standalone activate/deactivate endpoint, or product-count endpoint. Use PATCH for `isActive`, the visibility/availability routes for their specific states, and the existing media upload workflow to obtain `imageUrl`. Backend implementation is required if a dedicated upload or hard-delete workflow is desired.
