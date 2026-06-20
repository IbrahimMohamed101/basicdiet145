# 11G — Subscription Planner Upgrades Dashboard API Contract

Verified on 2026-06-20 against `dashboardMealBuilder` routes/controller, `mealBuilderConfigService`, `MealBuilderConfig`, premium-limit service, and dashboard-to-Flutter tests.

## Business meaning and ownership

Premium upgrades replace existing meal slots; they are not extra meals. The hard limit is computed as `maxPremiumUpgrades = totalSubscriptionMeals`, so selected upgrades cannot exceed the subscription's meal count. This limit is read-only and is enforced in subscription quote/selection flows—not configured by the Meal Builder dashboard.

The dashboard decides which subscription catalog options/products are exposed as `premium_meal` and `premium_large_salad`. It stores IDs in Meal Builder sections. Global content and default premium prices still come from menu products/options (11B/11E), and product-specific overrides from 11C. The dashboard must never copy names, hydrated objects, `premiumUpgradeLimit`, selected counts, or calculated prices into the Meal Builder draft.

All endpoints below require dashboard bearer auth and role `admin`/`superadmin`. Success: `{ "status": true, "data": ... }`. Error: `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`.

Editable section fields: `key`, `sectionType`, `sourceKind`, localized `titleOverride`, source/context IDs, `selectedOptionIds`, `selectedProductIds`, `includeMode`, `selectionType`, `sortOrder`, `required`, `minSelections`, `maxSelections`, `multiSelect`, `visible`, `availableFor` (subscription only), `metadata`, `rules`. Read-only: config/section IDs, status/current flags, contract/revision/source/bootstrap metadata, publish/actor/timestamps, hydrated candidates/status/errors/warnings, preview/plannerCatalog, validation/readiness, computed premium prices, and upgrade limits.

Canonical section types: `option_group`, `product_category`, `product_list`. Source kinds: empty string, `visual_family`, `configurable_product`, `product_list`, `premium_visual`. Include modes: `all`, `selected`. An `option_group` requires `productContextId` and `sourceGroupId`; `product_category` requires `sourceCategoryId`; selected `product_list` requires non-empty `selectedProductIds`. Min >= 0; max is null or >= min. Only `availableFor:["subscription"]` is accepted.

## GET /api/dashboard/meal-builder
### Purpose
Return current draft, published config, published preview, Flutter planner read model, and validation.
### Used By
Meal Builder overview/upgrades screen.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
No service query params. `Accept-Language: ar|en` controls hydration labels.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"draft":{"id":"665f1b2e7b9a4d0012ba0001","status":"draft","isCurrent":true,"contractVersion":"subscription_meal_builder.v1","revisionHash":"","source":"dashboard","notes":"Upgrade choices","sections":[{"key":"premium","sectionType":"option_group","sourceKind":"premium_visual","productContextId":"665f1b2e7b9a4d0012b20001","sourceGroupId":"665f1b2e7b9a4d0012c30001","selectedOptionIds":["665f1b2e7b9a4d0012e50001"],"selectedProductIds":[],"includeMode":"selected","selectionType":"premium_meal","sortOrder":5,"required":false,"minSelections":0,"maxSelections":1,"multiSelect":false,"visible":true,"availableFor":["subscription"],"metadata":{},"rules":{}}]},"published":{"id":"665f1b2e7b9a4d0012ba0000","status":"published","revisionHash":"sha256:abc123"},"preview":{"contractVersion":"subscription_meal_builder.v1","sections":[]},"plannerCatalog":{"sections":[]},"validation":{"draft":{"status":"ready","ready":true,"errors":[],"warnings":[]},"published":{"status":"ready","ready":true,"errors":[],"warnings":[]}}}}
```
### Error Response
`{"ok":false,"error":{"code":"MEAL_BUILDER_INTERNAL_ERROR","message":"Unexpected Meal Builder error"}}`
### Frontend Notes
Everything is read-only on this GET. Render draft editor, published status, and validation separately. `plannerCatalog` is the compatibility read model consumed downstream.
### Validation
No request payload.
### Important Do/Don't
Do label premium options as slot upgrades. Do not display them as extra meal quantities.
### Postman
```http
GET {{baseUrl}}/api/dashboard/meal-builder
Authorization: Bearer {{dashboardToken}}
Accept-Language: en
Content-Type: application/json
```

## GET /api/dashboard/meal-builder/draft/hydrated
### Purpose
Load the current draft with selected products/options, availability, pricing, and validation diagnostics hydrated for editing.
### Used By
Upgrade section editor.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None; language comes from `Accept-Language`.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_meal_builder_hydrated_draft.v1","draft":{"id":"665f1b2e7b9a4d0012ba0001","status":"draft","sections":[{"key":"premium","selectionType":"premium_meal","selectedOptions":[{"id":"665f1b2e7b9a4d0012e50001","key":"salmon","selected":true,"errors":[],"warnings":[]}],"selectedProducts":[],"items":[],"hydration":{"selectedOptionCount":1,"selectedProductCount":0,"errorCount":0,"warningCount":0}}]},"ready":true,"errors":[],"warnings":[],"sections":[],"validation":{"status":"ready","ready":true,"errors":[],"warnings":[],"checks":[],"summary":{"sections":1,"errors":0,"warnings":0}}}}
```
### Error Response
```json
{"status":true,"data":{"contractVersion":"dashboard_meal_builder_hydrated_draft.v1","draft":null,"ready":false,"errors":[{"level":"error","code":"MEAL_BUILDER_DRAFT_MISSING","message":"No current Meal Builder draft exists."}],"warnings":[],"sections":[]}}
```
### Frontend Notes
Missing draft is a successful HTTP read with `ready:false`. Hydrated objects and prices are read-only; persist only canonical ID fields through PUT.
### Validation
Existing legacy drafts may be migrated to the canonical template and return migration warnings.
### Important Do/Don't
Do render item-level errors. Do not submit `selectedOptions`, `items`, hydration, errors, or warnings.
### Postman
```http
GET {{baseUrl}}/api/dashboard/meal-builder/draft/hydrated
Authorization: Bearer {{dashboardToken}}
Accept-Language: en
Content-Type: application/json
```

## POST /api/dashboard/meal-builder/draft
### Purpose
Create a new current draft; old current drafts are demoted. Omitting `sections` creates the backend default visual template.
### Used By
Initialize/reset draft action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
```json
{"notes":"Premium upgrades configuration","sections":[{"key":"premium","sectionType":"option_group","sourceKind":"premium_visual","titleOverride":{"ar":"الترقيات المميزة","en":"Premium Upgrades"},"productContextId":"665f1b2e7b9a4d0012b20001","sourceGroupId":"665f1b2e7b9a4d0012c30001","selectedOptionIds":["665f1b2e7b9a4d0012e50001"],"selectedProductIds":[],"includeMode":"selected","selectionType":"premium_meal","sortOrder":5,"required":false,"minSelections":0,"maxSelections":1,"multiSelect":false,"visible":true,"availableFor":["subscription"],"metadata":{},"rules":{}}]}
```
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012ba0001","status":"draft","isCurrent":true,"contractVersion":"subscription_meal_builder.v1","source":"dashboard","notes":"Premium upgrades configuration","sections":[{"key":"premium","selectionType":"premium_meal","selectedOptionIds":["665f1b2e7b9a4d0012e50001"]}],"publishedAt":null}}`
### Error Response
`{"ok":false,"error":{"code":"MEAL_BUILDER_INVALID_SECTION_REFERENCE","message":"option_group sections require productContextId and sourceGroupId","details":{"index":0}}}`
### Frontend Notes
Send IDs only. Response metadata read-only. Creating does not publish.
### Validation
Canonical section rules above; referenced catalog entities/relations are checked by validation and normalization.
### Important Do/Don't
Do preserve all intended sections in the array. Do not describe premium choices as counts or extras.
### Postman
```http
POST {{baseUrl}}/api/dashboard/meal-builder/draft
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"notes":"Premium upgrades configuration","sections":[{"key":"premium","sectionType":"option_group","sourceKind":"premium_visual","productContextId":"{{productId}}","sourceGroupId":"{{optionGroupId}}","selectedOptionIds":["{{optionId}}"],"includeMode":"selected","selectionType":"premium_meal","sortOrder":5,"required":false,"minSelections":0,"maxSelections":1,"visible":true,"availableFor":["subscription"]}]}
```

## PUT /api/dashboard/meal-builder/draft
### Purpose
Replace the current draft sections and optionally notes; creates a draft if absent.
### Used By
Save changes button.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
Same canonical full-section-array shape as POST. `sections` omitted becomes an empty array.
```json
{"notes":"Premium meal and premium salad choices","sections":[{"key":"premium","sectionType":"product_list","sourceKind":"product_list","selectedProductIds":["665f1b2e7b9a4d0012b20099"],"includeMode":"selected","selectionType":"premium_large_salad","sortOrder":6,"required":false,"minSelections":0,"maxSelections":1,"multiSelect":false,"visible":true,"availableFor":["subscription"],"metadata":{},"rules":{}}]}
```
### Success Response
`{"status":true,"data":{"id":"665f1b2e7b9a4d0012ba0001","status":"draft","isCurrent":true,"notes":"Premium meal and premium salad choices","sections":[{"key":"premium","selectionType":"premium_large_salad","selectedProductIds":["665f1b2e7b9a4d0012b20099"]}],"updatedAt":"2026-06-20T11:00:00.000Z"}}`
### Error Response
`{"ok":false,"error":{"code":"MEAL_BUILDER_INVALID_CHANNEL","message":"Meal Builder is subscription-only"}}`
### Frontend Notes
This is replacement semantics. Send canonical fields only; response metadata read-only.
### Validation
Same as POST; section IDs normalized and ordering sorted by `sortOrder`.
### Important Do/Don't
Do send every section you want to retain. Do not send one section expecting PATCH semantics.
### Postman
```http
PUT {{baseUrl}}/api/dashboard/meal-builder/draft
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"notes":"Updated upgrades","sections":[{"key":"premium","sectionType":"product_list","sourceKind":"product_list","selectedProductIds":["{{productId}}"],"includeMode":"selected","selectionType":"premium_large_salad","sortOrder":6,"visible":true,"availableFor":["subscription"]}]}
```

## GET /api/dashboard/meal-builder/pickers/:sectionKey
### Purpose
Return eligible catalog candidates for one canonical section.
### Used By
Premium meal/salad selection dialogs.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
`sectionKey` required supported canonical key (including `premium`; unsupported keys return 400).
### Query Params
`q`/`search` string; `include=all`; `includeUnavailable` boolean default false; `includeNotLinked` boolean default true; `diagnostics` boolean default false; `page` integer default 1; `limit` integer bounded by service.
### Request Body
No request body.
### Success Response
```json
{"status":true,"data":{"contractVersion":"dashboard_meal_builder_picker.v1","sectionKey":"premium","candidateType":"mixed","product":{"id":"665f1b2e7b9a4d0012b20001","key":"basic_meal","name":{"ar":"وجبة أساسية","en":"Basic Meal"}},"group":{"id":"665f1b2e7b9a4d0012c30001","key":"proteins","name":{"ar":"البروتين","en":"Protein"}},"rules":{"selectionType":"premium_meal","requiredPremiumKeys":[]},"candidates":[{"id":"665f1b2e7b9a4d0012e50001","key":"salmon","name":{"ar":"سلمون","en":"Salmon"},"priceHalala":3000,"selected":true,"available":true,"errors":[],"warnings":[]}],"meta":{"page":1,"limit":25,"total":1,"pages":1}}}
```
### Error Response
`{"ok":false,"error":{"code":"MEAL_BUILDER_PICKER_SECTION_INVALID","message":"Unsupported Meal Builder picker section","details":{"sectionKey":"unknown"}}}`
### Frontend Notes
Candidates/prices/status are read-only; save selected IDs only. Premium option pricing is effective catalog/relation pricing.
### Validation
Unavailable/unlinked candidates are filtered according to flags; search is server-side.
### Important Do/Don't
Do display why candidates are unavailable. Do not submit candidate objects or price values in draft.
### Postman
```http
GET {{baseUrl}}/api/dashboard/meal-builder/pickers/premium?q=salmon&page=1&limit=20&includeUnavailable=false
Authorization: Bearer {{dashboardToken}}
Accept-Language: en
Content-Type: application/json
```

## POST /api/dashboard/meal-builder/validate
### Purpose
Validate either supplied unsaved sections or the current saved draft.
### Used By
Live validation and pre-publish validation.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
Send `{ "sections": [...] }` to validate unsaved canonical sections, or `{}` to validate current draft.
```json
{"sections":[{"key":"premium","sectionType":"option_group","sourceKind":"premium_visual","productContextId":"665f1b2e7b9a4d0012b20001","sourceGroupId":"665f1b2e7b9a4d0012c30001","selectedOptionIds":["665f1b2e7b9a4d0012e50001"],"includeMode":"selected","selectionType":"premium_meal","sortOrder":5,"visible":true,"availableFor":["subscription"]}]}
```
### Success Response
`{"status":true,"data":{"status":"ready","ready":true,"errors":[],"warnings":[],"checks":[],"summary":{"sections":1,"errors":0,"warnings":0}}}`
### Error Response
With no draft this remains HTTP 200: `{"status":true,"data":{"status":"error","ready":false,"errors":[{"level":"error","code":"MEAL_BUILDER_DRAFT_NOT_FOUND","message":"No current Meal Builder draft found"}],"warnings":[],"checks":[],"summary":{"sections":0,"errors":1,"warnings":0}}}`.
### Frontend Notes
All result fields read-only. Disable publish unless `ready=true`.
### Validation
Checks references, global/relation state, subscription channel, premium identity/pricing, and premium-large-salad relations.
### Important Do/Don't
Do validate the exact unsaved payload before saving/publishing. Do not treat HTTP 200 alone as readiness.
### Postman
```http
POST {{baseUrl}}/api/dashboard/meal-builder/validate
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{}
```

## POST /api/dashboard/meal-builder/publish
### Purpose
Validate and publish the current draft as a new immutable current config/read contract.
### Used By
Publish Meal Builder action.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
Optional notes only.
```json
{"notes":"Enable salmon and premium large salad upgrades"}
```
### Success Response
```json
{"status":true,"data":{"config":{"id":"665f1b2e7b9a4d0012ba0002","status":"published","isCurrent":true,"contractVersion":"subscription_meal_builder.v1","revisionHash":"sha256:abc123","source":"dashboard","publishedAt":"2026-06-20T12:00:00.000Z","notes":"Enable salmon and premium large salad upgrades","sections":[]},"validation":{"status":"ready","ready":true,"errors":[],"warnings":[]},"contract":{"contractVersion":"subscription_meal_builder.v1","revisionHash":"sha256:abc123","sections":[]}}}
```
### Error Response
`{"ok":false,"error":{"code":"MEAL_BUILDER_VALIDATION_FAILED","message":"Meal Builder draft is not publishable","details":{"ready":false,"errors":[{"code":"MEAL_BUILDER_PREMIUM_PRICE_INVALID"}]}}}`
### Frontend Notes
Show revision hash/time and refetch dashboard state. All output read-only. Unlike menu publish, this endpoint enforces validation.
### Validation
Current draft required; must be publishable; old published config becomes archived.
### Important Do/Don't
Do explicitly confirm. Do not publish menu catalog and Meal Builder interchangeably—they are separate release actions.
### Postman
```http
POST {{baseUrl}}/api/dashboard/meal-builder/publish
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json

{"notes":"Enable premium upgrades"}
```

## GET /api/dashboard/meal-builder/readiness
### Purpose
Return deployment/QA readiness for draft and published config.
### Used By
Health banner and release gate.
### Auth
Dashboard `admin`/`superadmin` required.
### Path Params
None.
### Query Params
None.
### Request Body
No request body.
### Success Response
`{"status":true,"data":{"status":"ready","ready":true,"errors":[],"warnings":[],"checks":[],"summary":{"draft":true,"published":true,"sections":6,"errors":0,"warnings":0,"revisionHash":"sha256:abc123","route":"/api/dashboard/meal-builder/readiness"}}}`
### Error Response
Not-ready is HTTP 200: `{"status":true,"data":{"status":"error","ready":false,"errors":[{"level":"error","code":"MEAL_BUILDER_NOT_PUBLISHED","message":"No published Meal Builder config exists"}],"warnings":[],"checks":[],"summary":{"draft":true,"published":false,"sections":0,"errors":1,"warnings":0}}}`.
### Frontend Notes
Read-only; gate release based on `ready`, not HTTP status.
### Validation
Requires both a current draft and valid published config to report ready.
### Important Do/Don't
Do expose errors/checks to QA. Do not use readiness as a save endpoint.
### Postman
```http
GET {{baseUrl}}/api/dashboard/meal-builder/readiness
Authorization: Bearer {{dashboardToken}}
Content-Type: application/json
```

## NOT IMPLEMENTED / Do not guess

There is no dashboard endpoint to edit `premiumUpgradeLimit`, total/remaining upgrade counts, or per-subscription upgrade usage. There is no dedicated “premium price configuration” endpoint; edit the underlying product/option halala values via 11B/11E or product-specific overrides via 11C, then validate and publish both the menu and Meal Builder as appropriate. There is no Meal Builder rollback endpoint. Backend implementation is required for any of those dashboard features.
