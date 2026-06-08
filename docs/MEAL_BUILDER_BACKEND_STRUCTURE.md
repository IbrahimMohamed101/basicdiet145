# Meal Builder Backend Structure

This is a backend-only reference for the current Dashboard Meal Builder implementation. It is based on the current code in `src/models`, `src/routes`, `src/controllers`, `src/services`, and the listed tests. No runtime behavior is changed by this document.

## 1. Executive Summary

The Dashboard Meal Builder screen is powered by `MealBuilderConfig` documents plus the canonical menu catalog models. The Dashboard editor should load and save the editable draft through `/api/dashboard/meal-builder`, use `/api/dashboard/meal-builder/draft/hydrated` for resolved draft item state, use `/api/dashboard/meal-builder/pickers/:sectionKey` for section-aware picker candidates, and validate/publish through the same route family.

The editable source is `MealBuilderConfig.status=draft, isCurrent=true`. Publishing creates a new `MealBuilderConfig.status=published, isCurrent=true`, archives the previous current published config, and lets `CatalogService` compile the published builder into `plannerCatalog.contractVersion = meal_planner_menu.v3`.

Flutter should read `/api/subscriptions/meal-planner-menu` and use `data.plannerCatalog.sections`. `/api/subscriptions/meal-builder` exists as a published builder read/preview/compatibility model; it is not the required Flutter planner contract unless product explicitly chooses that.

The main relation chain is:

```txt
MealBuilderConfig.sections[]
  -> MenuProduct / MenuCategory / MenuOptionGroup / MenuOption
  -> ProductOptionGroup
  -> ProductGroupOption
  -> CatalogItem availability
  -> plannerCatalog.sections[].products[].optionGroups[].options[]
```

| Concern                     | Backend Source |
| --------------------------- | -------------- |
| Dashboard draft state       | `MealBuilderConfig` draft document |
| Published builder state     | `MealBuilderConfig` published current document |
| Section cards               | `MealBuilderConfig.sections[]` |
| Products                    | `MenuProduct` |
| Options                     | `MenuOption` |
| Option groups               | `MenuOptionGroup` |
| Product-to-group relations  | `ProductOptionGroup` |
| Product-to-option relations | `ProductGroupOption` |
| Global availability         | `CatalogItem` plus `isActive/isVisible/isAvailable/publishedAt` |
| Flutter planner catalog     | `GET /api/subscriptions/meal-planner-menu`, `data.plannerCatalog` |
| Preview/read model          | `GET /api/subscriptions/meal-builder` |

## 2. Endpoint Map For The Dashboard Screen

Endpoint count for this screen: 10 primary Meal Builder/planner endpoints plus 10 supporting catalog picker/relation endpoints, for 20 relevant endpoints total.

| Method | Endpoint | Used For | Called By | Returns | Source Route | Source Service |
| ------ | -------- | -------- | --------- | ------- | ------------ | -------------- |
| GET | `/api/dashboard/meal-builder` | Load draft, published state, preview, validation | Dashboard editor | `{ draft, published, preview, validation }` | `src/routes/dashboardMealBuilder.js` | `mealBuilderConfigService.getDashboardState` |
| GET | `/api/dashboard/meal-builder/draft/hydrated` | Load current draft with selected item status | Dashboard editor/card UI | `{ draft, ready, errors, warnings, sections, validation }` | `src/routes/dashboardMealBuilder.js` | `mealBuilderConfigService.getHydratedDraft` |
| POST | `/api/dashboard/meal-builder/draft` | Create current draft, default visual sections if no sections sent | Dashboard editor | serialized draft | `src/routes/dashboardMealBuilder.js` | `createDraft` |
| PUT | `/api/dashboard/meal-builder/draft` | Replace current draft sections | Dashboard editor | serialized draft | `src/routes/dashboardMealBuilder.js` | `updateDraft` |
| GET | `/api/dashboard/meal-builder/pickers/:sectionKey` | Section-aware relation/availability picker | Dashboard card editor | picker candidates with selected/eligible/not-linked/unavailable state | `src/routes/dashboardMealBuilder.js` | `mealBuilderConfigService.getSectionPicker` |
| POST | `/api/dashboard/meal-builder/validate` | Validate request payload or current draft | Dashboard editor | `{ status, ready, errors, warnings, checks, summary }` | `src/routes/dashboardMealBuilder.js` | `validatePayload` / `getDashboardState` |
| POST | `/api/dashboard/meal-builder/publish` | Publish current valid draft | Dashboard editor | `{ config, validation, contract }` | `src/routes/dashboardMealBuilder.js` | `publishDraft` |
| GET | `/api/dashboard/meal-builder/readiness` | Check draft/published readiness | Dashboard editor / health UI | readiness report | `src/routes/dashboardMealBuilder.js` | `getReadinessReport` |
| GET | `/api/subscriptions/meal-planner-menu` | Flutter planner catalog | Flutter | `{ builderCatalog, addonCatalog, builderCatalogV2?, plannerCatalog? }` | `src/routes/subscriptions.js` | `CatalogService.getSubscriptionBuilderCatalogWithV2` |
| GET | `/api/subscriptions/meal-builder` | Published builder read/preview/compatibility | Preview clients | published builder contract | `src/routes/subscriptions.js` | `buildPublishedContract` |
| GET | `/api/dashboard/menu/categories` | Category picker | Dashboard picker | category list | `src/routes/dashboardMenu.js` | `menuCatalogService.listCategories` |
| GET | `/api/dashboard/menu/products` | Product picker | Dashboard picker | product list, filters include `categoryId`, `availableFor`, `itemType`, `published`, `q/search` | `src/routes/dashboardMenu.js` | `listProducts` |
| GET | `/api/dashboard/menu/options` | Option picker | Dashboard picker | option list, filters include `groupId`, `published`, `q/search` | `src/routes/dashboardMenu.js` | `listOptions` |
| GET | `/api/dashboard/menu/option-groups` | Option group picker | Dashboard picker | option group list | `src/routes/dashboardMenu.js` | `listOptionGroups` |
| GET | `/api/dashboard/menu/option-groups/:groupId/options` | Options by group | Dashboard picker | options in one group | `src/routes/dashboardMenu.js` | `listOptions` |
| GET | `/api/dashboard/menu/products/:productId/composer` | Product relation inspector | Dashboard editor/picker | product, linked groups, linked options, validation | `src/routes/dashboardMenu.js` | `getProductComposer` |
| GET | `/api/dashboard/menu/products/:productId/option-groups` | Product group relations | Dashboard relation UI | `ProductOptionGroup` rows | `src/routes/dashboardMenu.js` | `listProductGroups` |
| GET | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Product option relations | Dashboard relation UI | `ProductGroupOption` rows | `src/routes/dashboardMenu.js` | `listProductGroupOptions` |
| GET | `/api/dashboard/menu/products/:productId/option-groups/:groupId/option-pool` | Add option modal for a product group | Dashboard picker | options with linked status | `src/routes/dashboardMenu.js` | `getProductGroupOptionPool` |
| PUT | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Replace linked options for a group | Dashboard relation editor | composer v4 | `src/routes/dashboardMenu.js` | `replaceProductGroupOptions` |

There are more `/api/dashboard/menu/*` create/update/delete endpoints, but the table above is the picker/relation surface most directly needed by Meal Builder card editing.

## 3. Which Endpoint Should The Editor Use?

### Editable Draft UI

Use:

```http
GET /api/dashboard/meal-builder
GET /api/dashboard/meal-builder/draft/hydrated
POST /api/dashboard/meal-builder/draft
PUT /api/dashboard/meal-builder/draft
GET /api/dashboard/meal-builder/pickers/:sectionKey
```

`GET /meal-builder` returns the current draft and published config. `GET /draft/hydrated` returns the current draft with selected products/options resolved and annotated with relation, availability, and reason-code state. `POST /draft` creates a new current draft and, when `sections` is omitted, builds the default visual template. `PUT /draft` replaces the draft sections array. `GET /pickers/:sectionKey` returns relation-aware picker candidates for `premium`, `sandwich`, `chicken`, `beef`, `fish`, `eggs`, and `carbs`.

### Validation / Readiness

Use:

```http
POST /api/dashboard/meal-builder/validate
GET /api/dashboard/meal-builder/readiness
```

`POST /validate` validates either the sent `{ sections }` payload or the current draft. `GET /readiness` validates the current published config and requires a current draft to exist.

### Publish

Use:

```http
POST /api/dashboard/meal-builder/publish
```

Publish only succeeds when validation returns `ready: true`.

### Flutter Preview

Use:

```http
GET /api/subscriptions/meal-planner-menu
```

Flutter should display `data.plannerCatalog.sections`.

### Do Not Use As Primary Editor Source

Do not use `/api/subscriptions/meal-planner-menu` to render editable draft cards. It is compiled customer-facing output. Do not use `/api/subscriptions/meal-builder` as the required Flutter contract unless product explicitly decides it.

## 4. Database Models And Ownership

| Model | Role In Meal Builder | Main Fields | Relationship | Dashboard Usage | Flutter Usage |
| ----- | -------------------- | ----------- | ------------ | --------------- | ------------- |
| `MealBuilderConfig` | Draft and published builder state | `status`, `isCurrent`, `contractVersion`, `revisionHash`, `sections[]` | Stores section references to products/groups/categories/options | Edited directly by Meal Builder endpoints | Not read directly; compiled into `plannerCatalog` |
| `MenuProduct` | Canonical product source | `categoryId`, `catalogItemId`, `key`, `itemType`, `pricingModel`, `priceHalala`, `availableFor`, status flags, `publishedAt` | Product context, sandwich products, premium salad product | Picked/referenced; also managed via `/dashboard/menu` | Appears in `plannerCatalog.products[]` |
| `MenuOption` | Canonical option source | `groupId`, `catalogItemId`, `key`, `proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, `extraPriceHalala`, `availableForSubscription`, status flags, `publishedAt` | Selected section items and product group options | Picked/referenced; managed via `/dashboard/menu` | Appears in `optionGroups[].options[]` |
| `MenuOptionGroup` | Canonical group source | `key`, `name`, status flags, `ui`, `publishedAt` | Source group for options; product customization group | Picked/referenced | Appears as option groups |
| `ProductOptionGroup` | Product-to-group relation | `productId`, `groupId`, `minSelections`, `maxSelections`, `isRequired`, status flags, `sortOrder` | Defines group availability/rules for a product | Managed by product composer endpoints | Compiled into product `optionGroups[]` |
| `ProductGroupOption` | Product-to-group-to-option relation | `productId`, `groupId`, `optionId`, override pricing, status flags, `sortOrder` | Defines eligible options for a product group | Managed by relation endpoints | Compiled into options and validated on selection |
| `CatalogItem` | Global availability gate | `key`, `itemKind`, `isActive`, `isAvailable` | Linked by `catalogItemId` on products/options | Not directly edited by Meal Builder | Filters/invalidates products/options |
| `MealCategory` | Legacy meal category | `key`, `name`, `isActive`, `sortOrder` | Used by legacy meal endpoints, not canonical Meal Builder sections | Not edited by Meal Builder | Legacy fields only |
| `Meal` | Legacy ready meal/slot projection | `name`, `categoryId`, `type`, subscription/order flags | Still referenced by legacy `SubscriptionDay.selections`/sandwich legacy fields | Not Meal Builder source | Legacy response/projection only |
| `BuilderProtein` | Legacy builder protein | `key`, `proteinFamilyKey`, `selectionType`, `isPremium`, `premiumKey` | Legacy planner model | Not current Meal Builder source | Legacy projection compatibility |
| `BuilderCarb` | Legacy builder carb | `key`, `displayCategoryKey`, `legacyMappings` | Legacy planner model | Not current Meal Builder source | Legacy projection compatibility |
| `SubscriptionDay` | Stored user selections | `mealSlots[]`, `selectedOptions[]`, `productId`, `contractVersion`, legacy projections | Persists canonical v3 selections and legacy fields | Not edited by Meal Builder screen | Flutter writes selections against planner catalog |

## 5. Relation Chain Explanation

```txt
MealBuilderConfig.sections[]
  references visual section key, sourceKind, product/group/category ids, selected ids, metadata, rules
MenuProduct / MenuOption rows
  define actual catalog records
MenuOptionGroup
  groups options such as proteins and carbs
ProductOptionGroup
  links a product to a group and owns min/max/required/sort/availability
ProductGroupOption
  links a product+group to an option and owns override price/sort/availability
CatalogItem
  globally disables linked products/options when inactive/unavailable
plannerCatalog.sections[].products[].optionGroups[].options[]
  customer-facing compiled output
```

### A. Section To Products

`product_list` sections use `selectedProductIds`. `product_category` sections use `sourceCategoryId`; if `includeMode` is `selected`, only `selectedProductIds` inside that category are returned, otherwise all products in the category are resolved. The `sandwich` section is a `product_category` section backed by the `cold_sandwiches` category and selected cold sandwich products.

Products are not embedded in `MealBuilderConfig`; only IDs and section metadata are stored.

### B. Section To Options

`option_group` sections use `productContextId` plus `sourceGroupId`, then filter that product/group's `ProductGroupOption` rows by `selectedOptionIds`. The visual protein families use `MenuOption.proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, option key, and `resolveProteinVisualFamilyKey()` conventions from `mealPlannerContract`.

Premium options are identified by `PREMIUM_MEAL_PROTEIN_KEYS` (`beef_steak`, `shrimp`, `salmon`) using option `key` or `premiumKey`. Carbs are filtered by `CUSTOMER_VISIBLE_CARB_KEYS`.

### C. Product To Option Groups

`ProductOptionGroup` stores the relation. Its important fields are `productId`, `groupId`, `minSelections`, `maxSelections`, `isRequired`, `isActive`, `isVisible`, `isAvailable`, and `sortOrder`.

### D. Option Group To Options

`ProductGroupOption` stores the option relation for a product's group. Its important fields are `productId`, `groupId`, `optionId`, `extraPriceHalala`, `extraWeightUnitGrams`, `extraWeightPriceHalala`, `isActive`, `isVisible`, `isAvailable`, and `sortOrder`.

### E. Global Availability

Products, groups, options, and categories must be active/visible/available and published where checked. Products/options also pass `CatalogItem` availability when `catalogItemId` is linked. If an item is selected in a draft but later becomes inactive, unpublished, unavailable, not subscription-enabled, or globally unavailable through `CatalogItem`, validation reports errors and publish is blocked.

## 6. Current Draft Shape

`POST /api/dashboard/meal-builder/draft` returns a serialized draft. `GET /api/dashboard/meal-builder` returns the same draft shape under `data.draft`.

Example shape:

```json
{
  "id": "CONFIG_ID",
  "status": "draft",
  "isCurrent": true,
  "contractVersion": "subscription_meal_builder.v1",
  "revisionHash": "",
  "source": "dashboard",
  "createdBySystem": false,
  "bootstrapKey": "",
  "publishedAt": null,
  "publishedBy": null,
  "notes": "",
  "sections": [
    {
      "id": "SECTION_ID",
      "key": "chicken",
      "sectionType": "option_group",
      "sourceKind": "visual_family",
      "titleOverride": { "ar": "دجاج", "en": "Chicken" },
      "productContextId": "BASIC_MEAL_PRODUCT_ID",
      "sourceGroupId": "PROTEINS_GROUP_ID",
      "sourceCategoryId": null,
      "selectedOptionIds": ["OPTION_ID"],
      "selectedProductIds": [],
      "includeMode": "selected",
      "selectionType": "standard_meal",
      "sortOrder": 3,
      "required": true,
      "minSelections": 1,
      "maxSelections": 1,
      "multiSelect": false,
      "visible": true,
      "availableFor": ["subscription"],
      "metadata": {
        "visualRole": "protein_family",
        "proteinFamilyKey": "chicken"
      },
      "rules": {}
    }
  ],
  "createdAt": "DATE",
  "updatedAt": "DATE"
}
```

`revisionHash` is normally populated for published configs. Draft revision/version semantics need backend contract hardening if the UI wants optimistic concurrency.

## 7. Default Visual Sections

| Section | Source Kind | Data Source | Items Type | Expected Items | Rules | Where Resolved |
| ------- | ----------- | ----------- | ---------- | -------------- | ----- | -------------- |
| `premium` | `premium_visual` | `basic_meal` + `proteins` group, plus selected `premium_large_salad` product | options + product | `beef_steak`, `shrimp`, `salmon`, `premium_large_salad` | required, max 1, premium salad excludes `extra_protein_50g` | `buildDefaultVisualTemplateSections`, `buildOptionGroupSection` |
| `sandwich` | `product_list` | `cold_sandwiches` category | products | keys in `SUBSCRIPTION_COLD_SANDWICH_KEYS` | full meal, no carbs | `buildDefaultVisualTemplateSections`, `buildProductSection` |
| `chicken` | `visual_family` | `basic_meal` + `proteins` group | options | standard chicken family options | required, max 1 | `resolveProteinVisualFamilyKey` |
| `beef` | `visual_family` | `basic_meal` + `proteins` group | options | standard beef family options | beef daily limit metadata | `resolveProteinVisualFamilyKey` |
| `fish` | `visual_family` | `basic_meal` + `proteins` group | options | standard fish family options | required, max 1 | `resolveProteinVisualFamilyKey` |
| `eggs` | `visual_family` | `basic_meal` + `proteins` group | options | standard egg family options | required, max 1 | `resolveProteinVisualFamilyKey` |
| `carbs` | `visual_family` | `basic_meal` + `carbs` group | options | keys in `CUSTOMER_VISIBLE_CARB_KEYS` | max 2 types, 300 grams | `buildDefaultVisualTemplateSections` |

`premium_large_salad` appears visually inside Premium, but compiles and validates separately as `selectionType=premium_large_salad`.

## 8. How Add/Remove Inside A Card Should Work

### Premium

Add/remove `beef_steak`, `shrimp`, and `salmon` by editing the Premium section's `selectedOptionIds`. Use options from the `basic_meal` + `proteins` relation; the option must be a premium key, subscription-enabled, published, available, and have positive premium price through relation or option pricing. Removing any required premium key causes `MEAL_BUILDER_PREMIUM_OPTION_MISSING`.

Include/remove `premium_large_salad` through the Premium section's `selectedProductIds`. Removing it causes `MEAL_BUILDER_PREMIUM_LARGE_SALAD_MISSING`. The salad product must also have valid product option relations and must not expose `extra_protein_50g`.

### Sandwich

Add/remove sandwiches by editing the `sandwich` section's `selectedProductIds`. Eligible products are `MenuProduct` rows in the `cold_sandwiches` category with `itemType=cold_sandwich`, `availableFor` including `subscription`, active/visible/available, published, and globally available through `CatalogItem` when linked. The default seed further restricts to `SUBSCRIPTION_COLD_SANDWICH_KEYS`.

### Chicken / Beef / Fish / Eggs

Add/remove options by editing the section's `selectedOptionIds`. Eligible options must already be linked to `basic_meal` + `proteins` through `ProductGroupOption`, and the product must already be linked to the `proteins` group through `ProductOptionGroup`.

Adding an option to a visual section alone is not enough if the relation does not exist. The relation is required for validation and for `plannerCatalog`.

### Carbs

Add/remove carbs by editing the `carbs` section's `selectedOptionIds`. Eligible carbs must already be linked to `basic_meal` + `carbs` through `ProductGroupOption`, and the product must have an active `ProductOptionGroup` relation to the `carbs` group. Preserve `maxSelections=2` and `rules.maxTotalGrams=300`; changing those causes `MEAL_BUILDER_CARBS_RULE_INVALID`.

Adding a carb to `MealBuilderConfig` alone is not enough. The carb must exist as a `MenuOption`, be linked to `basic_meal`/`carbs`, and be catalog-available.

## 9. Catalog Picker Endpoints

| Picker | Endpoint | Filters Needed | Returned IDs To Store | Notes |
| ------ | -------- | -------------- | --------------------- | ----- |
| Premium picker | `/api/dashboard/menu/products/:basicMealId/option-groups/:proteinsGroupId/option-pool` | `onlySuggested=true` or filter client-side by premium keys | `optionId` into `selectedOptionIds` | Missing clean Meal Builder premium picker endpoint |
| Premium large salad picker | `/api/dashboard/menu/products?itemType=premium_large_salad&availableFor=subscription&published=true` | key should be `premium_large_salad` | product `id` into `selectedProductIds` | Missing clean singleton endpoint |
| Sandwich picker | `/api/dashboard/menu/products?categoryId=COLD_SANDWICHES_ID&itemType=cold_sandwich&availableFor=subscription&published=true` | client may restrict to subscription sandwich keys | product `id` into `selectedProductIds` | Existing endpoint is generic |
| Protein option picker | `/api/dashboard/menu/products/:basicMealId/option-groups/:proteinsGroupId/option-pool` | filter by family using `key`, `proteinFamilyKey`, `displayCategoryKey` | `optionId` into `selectedOptionIds` | Missing clean family filter endpoint |
| Carb option picker | `/api/dashboard/menu/products/:basicMealId/option-groups/:carbsGroupId/option-pool` | filter by carb keys or group | `optionId` into `selectedOptionIds` | Existing endpoint returns pool for relation |
| Product category picker | `/api/dashboard/menu/categories` | `published=true`, `q` as needed | category `id` into `sourceCategoryId` | Used for product-category sections |
| Option group picker | `/api/dashboard/menu/option-groups` | `published=true`, `q` as needed | group `id` into `sourceGroupId` | Product relation must also exist |

## 10. Save Draft Payload

`PUT /api/dashboard/meal-builder/draft` expects:

```json
{
  "sections": [],
  "notes": "optional"
}
```

Required per section: `sectionType`, valid source IDs for that type, `sortOrder`, and any selected IDs needed by `includeMode=selected`. Optional but important: `key`, `sourceKind`, `titleOverride`, `includeMode`, `selectionType`, `required`, `minSelections`, `maxSelections`, `multiSelect`, `visible`, `availableFor`, `metadata`, `rules`.

Do not send hydrated product/option objects as draft state. Store IDs in `selectedOptionIds` and `selectedProductIds`. Reorder by changing `sortOrder` or the selected ID order if the UI preserves item order; relation sort still controls compiled option order. Exact item order inside `selectedOptionIds` needs backend contract hardening because `baseConfigPayload` sorts selected IDs for the revision hash and compiled output sorts by relation/record sort order.

Remove chicken item:

```json
{
  "sections": [
    {
      "key": "chicken",
      "sectionType": "option_group",
      "sourceKind": "visual_family",
      "productContextId": "BASIC_MEAL_PRODUCT_ID",
      "sourceGroupId": "PROTEINS_GROUP_ID",
      "selectedOptionIds": ["REMAINING_CHICKEN_OPTION_ID"],
      "selectionType": "standard_meal",
      "sortOrder": 3,
      "required": true,
      "minSelections": 1,
      "maxSelections": 1,
      "metadata": { "visualRole": "protein_family", "proteinFamilyKey": "chicken" },
      "rules": {}
    }
  ]
}
```

Add sandwich product:

```json
{
  "sections": [
    {
      "key": "sandwich",
      "sectionType": "product_category",
      "sourceKind": "product_list",
      "sourceCategoryId": "COLD_SANDWICHES_CATEGORY_ID",
      "includeMode": "selected",
      "selectedProductIds": ["EXISTING_SANDWICH_ID", "NEW_SANDWICH_ID"],
      "selectionType": "sandwich",
      "metadata": { "requiresBuilder": false, "treatAsFullMeal": true },
      "rules": { "carbsRequired": false },
      "sortOrder": 2
    }
  ]
}
```

Reorder carbs:

```json
{
  "sections": [
    {
      "key": "carbs",
      "sectionType": "option_group",
      "sourceKind": "visual_family",
      "productContextId": "BASIC_MEAL_PRODUCT_ID",
      "sourceGroupId": "CARBS_GROUP_ID",
      "selectedOptionIds": ["CARB_ID_A", "CARB_ID_B"],
      "selectionType": "standard_meal",
      "sortOrder": 7,
      "required": true,
      "minSelections": 1,
      "maxSelections": 2,
      "multiSelect": true,
      "metadata": { "visualRole": "carbs", "appliesTo": ["configurable_plate_meal"], "excludesSelectionTypes": ["sandwich"] },
      "rules": { "ruleKey": "carb_split", "maxTypes": 2, "maxTotalGrams": 300, "unit": "grams" }
    }
  ]
}
```

The examples show only the changed section for readability; the real `PUT` replaces the entire draft sections array.

## 11. Validation And Readiness

`POST /api/dashboard/meal-builder/validate` accepts either `{ sections }` or no section payload. With sections, it validates the payload. Without sections, it validates the current draft.

`GET /api/dashboard/meal-builder/readiness` validates the current published config and also requires a current draft.

Response shape:

```json
{
  "status": "ok|warning|error",
  "ready": true,
  "errors": [],
  "warnings": [],
  "checks": [],
  "summary": {
    "sections": 7,
    "errors": 0,
    "warnings": 0,
    "published": false
  }
}
```

Blocking errors include missing products/groups/categories/options, inactive/unavailable/unpublished docs, missing product-group or product-option relations, subscription-disabled docs, unavailable linked `CatalogItem`, standard sections exposing premium proteins, premium sections missing premium proteins, missing premium salad, invalid carbs rules, invalid sandwich selection type, and premium salad relation issues.

Warnings include hidden subscription sections, changed default visual order, incomplete sandwich metadata, missing beef daily limit metadata, and empty visual protein families.

Dashboard should display errors as publish blockers, warnings as non-blocking attention states, and item-specific states using the `sectionKey`, `productId`, `groupId`, and `optionId` details when present.

Important codes:

| Case | Code |
| ---- | ---- |
| globally inactive/unavailable item | `MEAL_BUILDER_PRODUCT_*`, `MEAL_BUILDER_OPTION_*`, `MEAL_BUILDER_*_CATALOG_ITEM_UNAVAILABLE` |
| missing premium required key | `MEAL_BUILDER_PREMIUM_OPTION_MISSING` |
| empty family warning | `MEAL_BUILDER_PROTEIN_FAMILY_EMPTY` |
| invalid carbs rules | `MEAL_BUILDER_CARBS_RULE_INVALID` |
| invalid sandwich metadata | `MEAL_BUILDER_SANDWICH_METADATA_INCOMPLETE` |
| premium salad extra protein issue | `PREMIUM_LARGE_SALAD_EXTRA_PROTEIN_EXPOSED` |

## 12. Publish And PlannerCatalog Compilation

Publish flow:

```txt
Draft
↓
Validate
↓
Publish
↓
Published MealBuilderConfig
↓
CatalogService
↓
plannerCatalog
↓
Flutter
```

`POST /api/dashboard/meal-builder/publish` loads the current draft, validates it, builds a published payload, computes `revisionHash`, archives previous current published configs, and creates a new published `MealBuilderConfig`. It returns the published `config`, validation result, and published builder `contract`.

`GET /api/subscriptions/meal-planner-menu` calls `getMealPlannerCatalog({ includeV3 })`, which calls `CatalogService.getSubscriptionBuilderCatalogWithV2`. When v3 is included, `CatalogService` first builds the default canonical v3 planner catalog and then tries `mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder`. If a published builder exists, that builder-derived `plannerCatalog` replaces the default v3 catalog. If no published builder exists, the default canonical planner catalog remains.

Flutter sees `plannerCatalog.contractVersion = "meal_planner_menu.v3"`, `currency`, `sections`, `rules`, `catalogHash`, `publishedVersionId`, and `builderRevisionHash`.

## 13. What Flutter Actually Sees

Flutter-facing route:

```http
GET /api/subscriptions/meal-planner-menu
```

Relevant response:

```json
{
  "data": {
    "plannerCatalog": {
      "contractVersion": "meal_planner_menu.v3",
      "currency": "SAR",
      "sections": [
        {
          "id": "section:chicken",
          "key": "chicken",
          "type": "configurable_product",
          "name": "Chicken",
          "sortOrder": 3,
          "ui": {},
          "rules": {},
          "products": [
            {
              "id": "BASIC_MEAL_PRODUCT_ID",
              "productId": "BASIC_MEAL_PRODUCT_ID",
              "key": "basic_meal",
              "selectionType": "standard_meal",
              "pricing": {},
              "action": { "type": "open_builder", "requiresBuilder": true },
              "optionGroups": [
                {
                  "id": "PROTEINS_GROUP_ID",
                  "groupId": "PROTEINS_GROUP_ID",
                  "key": "proteins",
                  "sourceKey": "proteins",
                  "minSelections": 1,
                  "maxSelections": 1,
                  "required": true,
                  "options": []
                }
              ]
            }
          ]
        }
      ],
      "rules": {
        "source": "meal_builder_config",
        "builderRevisionHash": "sha256:..."
      }
    }
  }
}
```

Sandwiches appear as products with `selectionType=sandwich`, `action.type=direct_add`, `action.requiresBuilder=false`, and no option groups. Carbs appear as an option group under the `basic_meal` product with max selections from the section/relation. `premium_large_salad` appears as a product with `selectionType=premium_large_salad`, `premiumKey=premium_large_salad`, and its own compiled option groups.

Flutter should not rely on Dashboard draft-only fields, raw authoring fields from `MealBuilderConfig`, or `/api/subscriptions/meal-builder` as the required planner contract.

## 14. Current Gaps And Risks

| Gap | Impact | Recommended Fix | Priority |
| --- | ------ | --------------- | -------- |
| Editing `MealBuilderConfig` can reference IDs without catalog relations | Draft may save but validation/publish fails, or compiled planner omits items | Add relation-aware picker/validation before save | High |
| Picker endpoints are generic | UI must know keys/categories/families and filter client-side | Add small Meal Builder picker endpoints or typed query filters | Medium |
| Family classification depends on key/metadata conventions | New options can land in wrong visual family | Require explicit `proteinFamilyKey`/`displayCategoryKey` and validate them in picker | High |
| `/meal-builder` vs `plannerCatalog` contract can confuse clients | Flutter may read preview model instead of canonical planner output | Document and enforce Flutter source as `/meal-planner-menu` | High |
| Existing draft can contain inactive/unpublished references | Publish blockers and confusing card states | Show validation state inline and offer remove/fix actions | Medium |
| Draft item order is not a stable contract | Reorder inside cards may not compile as user expects | Store explicit per-section item order or update relation `sortOrder` | Medium |
| `premium_large_salad` validation is relation-sensitive | Salad can expose disallowed proteins or `extra_protein_50g` | Keep readiness checks and add picker constraints | High |

## 15. Recommended Correct Extension Path

1. Create or update the catalog record first: `MenuOption` for proteins/carbs, `MenuProduct` for products/sandwiches/salad.
2. Ensure the record is subscription-enabled, active, visible, available, published, and has a valid linked `CatalogItem` if `catalogItemId` is used.
3. Attach the required `ProductOptionGroup` if the product does not already have the option group.
4. Attach the `ProductGroupOption` relation for every option that should be selectable inside that product/group.
5. Set classification metadata: protein `proteinFamilyKey`/`displayCategoryKey`, premium `premiumKey` and positive price, carb key in the allowed customer-visible set when needed.
6. Update `MealBuilderConfig.sections[]` with the selected product/option ID and preserve section rules/metadata.
7. Run `POST /api/dashboard/meal-builder/validate` and `GET /api/dashboard/meal-builder/readiness`.
8. Publish with `POST /api/dashboard/meal-builder/publish`.
9. Verify `/api/subscriptions/meal-planner-menu` and inspect `data.plannerCatalog.sections`.
10. Flutter reads `plannerCatalog`; it should not read draft config.

Do not add data to `MealBuilderConfig` only unless the catalog relations already exist. The safe order is: catalog first, relations second, MealBuilderConfig third, publish fourth, Flutter planner catalog fifth.

## 16. Final Backend Mental Model

```txt
Global Catalog
  MenuProduct
  MenuOptionGroup
  MenuOption
  Relations
  CatalogItem availability

Dashboard Draft
  MealBuilderConfig draft sections
  visual arrangement and selected item references

Publish
  MealBuilderConfig published version

Flutter
  /api/subscriptions/meal-planner-menu
  plannerCatalog compiled from published builder + catalog relations
```

In plain language: the Dashboard draft decides what the visual Meal Builder should include, but the catalog decides whether those items really exist and are selectable. Publishing freezes the current valid draft into the customer-facing builder. Flutter then reads the compiled planner catalog, not the editor draft.
