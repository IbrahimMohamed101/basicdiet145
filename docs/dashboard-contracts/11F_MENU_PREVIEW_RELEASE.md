# 11F — Menu Preview, Validation, Publish, Versions and Rollback

Verified on 2026-06-20. All routes require dashboard bearer auth and role `admin` or `superadmin`. The system does not maintain a separately editable “draft version” document: current database rows are the working catalog; publish stamps active entities, archives the prior published `MenuVersion`, and stores a public plus full dashboard snapshot. There is no release ID distinct from a menu version ID.

Success normally uses `{ "status": true, "data": ... }`; error uses `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`. Version IDs, statuses, snapshots, publish actor/time, audit rows, validation summaries, and diff results are read-only. Only publish `notes` and rollback `confirm` are editable inputs.

## GET /api/dashboard/menu/preview
### Purpose
Render the current working catalog in customer-like hierarchy before publish.
### Used By
Preview screen.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `includeInactive` | boolean | No | `false` | Include inactive/hidden/unavailable entities. |
| `branchId` | string | No | none | **NOT WIRED:** service supports it but controller does not forward it; backend change required. |
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_menu_preview.v1","source":"one_time_order","fulfillmentMethod":"pickup","currency":"SAR","vatIncluded":true,"vatPercentage":15,"includeInactive":false,"warnings":[],"categories":[{"id":"665f1b2e7b9a4d0012a10001","key":"light_options","name":"Light Options","nameI18n":{"ar":"خيارات خفيفة","en":"Light Options"},"products":[{"id":"665f1b2e7b9a4d0012b20001","key":"greek_yogurt","priceHalala":1800,"currency":"SAR","isCustomizable":true,"optionGroups":[]}]}]}}
```
### Error Response
`{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"includeInactive must be boolean"}}`
### Frontend Notes
Entire payload is read-only. Render warnings and hierarchy; edit through 11A–11E.
### Validation
Preview filters entity states and one-time channel; validation failures appear as warnings rather than necessarily failing preview.
### Important Do/Don't
Do show this as working-state preview. Do not label it guaranteed published mobile output.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/preview?includeInactive=false
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/validate
### Purpose
Validate catalog integrity before publish.
### Used By
Pre-publish checks and Validate button.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"ok":true,"errors":[],"warnings":[],"summary":{"categories":8,"products":24,"groups":6,"options":42,"activeProducts":22}}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_INTERNAL_ERROR","message":"Unexpected menu error"}}`
### Frontend Notes
All fields read-only. Disable Publish when `data.ok=false`; render exact errors/warnings.
### Validation
Checks required custom products, positive active prices, per-100g setup, duplicate active keys, relation references, rules, and active-state consistency.
### Important Do/Don't
Do call immediately before publish. Do not convert warnings into backend errors unless product policy requires it.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/validate
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## GET /api/dashboard/menu/diff
### Purpose
Compare current published public output with the most recent published-version snapshot by product keys.
### Used By
Release summary.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"lastVersionId":"665f1b2e7b9a4d0012aa0001","addedProducts":["berry_yogurt"],"removedProducts":["old_yogurt"],"changedCount":2}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_INTERNAL_ERROR","message":"Unexpected menu error"}}`
### Frontend Notes
Read-only and intentionally shallow: price/name/rule edits are not reported as changed.
### Validation
No inputs.
### Important Do/Don't
Do label it “added/removed product keys.” Do not present as a full field-level diff.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/diff
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/publish
### Purpose
Publish all active catalog entities and create a new immutable version snapshot.
### Used By
Release confirmation action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
`notes` optional string.
```json
{"notes":"Summer menu pricing and yogurt options"}
```
### Success Response
```json
{"status":true,"data":{"id":"665f1b2e7b9a4d0012aa0002","status":"published","publishedAt":"2026-06-20T10:00:00.000Z","publishedBy":"665f1b2e7b9a4d0012ab0001","notes":"Summer menu pricing and yogurt options","snapshot":{"source":"one_time_order","dashboardCatalog":{"version":1,"capturedAt":"2026-06-20T10:00:00.000Z","categories":[],"products":[],"optionGroups":[],"options":[],"productGroups":[],"productGroupOptions":[]}},"createdAt":"2026-06-20T10:00:00.000Z"}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_INTERNAL_ERROR","message":"Unexpected menu error"}}`
### Frontend Notes
After success show version ID/time/notes, clear dirty state, and refetch preview/versions. Snapshot and all metadata are read-only.
### Validation
The publish handler does **not** call `validateMenu()` or block on validation errors; frontend should validate first. Notes are stringified; no length limit in service.
### Important Do/Don't
Do require explicit confirmation and validation. Do not imply publish is only one product—it publishes all active entities.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/publish
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"notes":"Summer menu pricing and yogurt options"}
```

## GET /api/dashboard/menu/versions
### Purpose
List published/archived menu snapshots newest first.
### Used By
Release history and rollback picker.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
`page` integer optional; `limit` integer optional, default 20 without pagination and 25 when page-based pagination is enabled, maximum 100.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012aa0002","status":"published","publishedAt":"2026-06-20T10:00:00.000Z","publishedBy":"665f1b2e7b9a4d0012ab0001","notes":"Summer menu pricing and yogurt options","snapshot":{},"createdAt":"2026-06-20T10:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":2,"pages":1}}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_INTERNAL_ERROR","message":"Unexpected menu error"}}`
### Frontend Notes
Without explicit page, `data` is an array capped by `limit` (default 20); with `page` it is paginated. Everything is read-only.
### Validation
Pagination values normalized to valid bounds.
### Important Do/Don't
Do avoid rendering full snapshots in the table. Do not edit version records.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/versions?page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## POST /api/dashboard/menu/rollback/:versionId
### Purpose
Restore a snapshot safely: publish an automatic backup, restore target, then publish a new restored version.
### Used By
Rollback confirmation dialog.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `versionId` | ObjectId | Yes | Target historical menu version. |
### Query Params
None.
### Request Body
Exact boolean `true` required.
```json
{"confirm":true}
```
### Success Response
```json
{"status":true,"success":true,"restoredVersion":"665f1b2e7b9a4d0012aa0004","backupVersion":"665f1b2e7b9a4d0012aa0003","data":{"success":true,"restoredVersion":"665f1b2e7b9a4d0012aa0004","backupVersion":"665f1b2e7b9a4d0012aa0003","rollback":{"ok":true,"versionId":"665f1b2e7b9a4d0012aa0001","restoredFrom":"dashboard_catalog_snapshot","restored":{"categories":8,"products":24,"optionGroups":6,"options":42,"productGroups":12,"productGroupOptions":54}}}}
```
### Error Response
`{"ok":false,"error":{"code":"ROLLBACK_CONFIRMATION_REQUIRED","message":"أرسل confirm: true في الـ body"}}`
### Frontend Notes
Read-only response IDs; show both backup and restored IDs, then refetch every catalog screen. This mutates the full catalog.
### Validation
Exact `confirm:true`; valid existing version; complete snapshot required.
### Important Do/Don't
Do use a destructive confirmation and prevent double submission. Do not call for preview or dry-run.
### Postman
```http
POST {{baseUrl}}/api/dashboard/menu/rollback/{{releaseId}}
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"confirm":true}
```

## GET /api/dashboard/menu/audit-logs
### Purpose
List menu mutation audit records.
### Used By
Audit/history panel.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
`page`, `limit` optional pagination. Although generic controller filters are accepted, the service's audit query should be treated as pagination-only unless tests establish otherwise.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"items":[{"id":"665f1b2e7b9a4d0012ac0001","entityType":"menu_version","entityId":"665f1b2e7b9a4d0012aa0002","action":"publish","actorId":"665f1b2e7b9a4d0012ab0001","actorRole":"admin","meta":{},"createdAt":"2026-06-20T10:00:00.000Z"}],"pagination":{"page":1,"limit":20,"total":1,"pages":1}}}
```
### Error Response
`{"ok":false,"error":{"code":"MENU_INTERNAL_ERROR","message":"Unexpected menu error"}}`
### Frontend Notes
All audit fields read-only. Handle array vs pagination according to request.
### Validation
Pagination bounds as above.
### Important Do/Don't
Do use audit for traceability. Do not treat it as a version snapshot.
### Postman
```http
GET {{baseUrl}}/api/dashboard/menu/audit-logs?page=1&limit=20
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED / Important limitations

No draft-version CRUD, publish dry-run, field-level diff, rollback preview, or separate release entity exists. `branchId` preview filtering exists in the service signature but is not forwarded by the controller, so it is currently not usable through HTTP. Publish does not enforce validation. These require backend implementation if the dashboard needs them.
