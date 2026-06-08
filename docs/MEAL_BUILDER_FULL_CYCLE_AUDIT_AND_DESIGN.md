# Meal Builder Full Cycle Audit And Design

This document is a backend + Dashboard discovery and design reference for the Meal Builder editing cycle. It is documentation/design only. It does not implement endpoints, refactor code, or change backend/frontend behavior.

Evidence inspected:

- Backend docs: `docs/MEAL_BUILDER_DEFAULT_TEMPLATE.md`, `docs/MEAL_BUILDER_BACKEND_STRUCTURE.md`, `docs/SUBSCRIPTION_MENU_SYSTEM_README.md`, `docs/SUBSCRIPTION_MENU_SYSTEM_SOURCE_OF_TRUTH.md`
- Backend code: `MealBuilderConfig`, canonical menu models, dashboard/public routes, `mealBuilderConfigService`, `CatalogService`, `menuCatalogService`, `dashboardHealthService`
- Backend tests: all requested files exist and were inspected by name/search
- Dashboard repo: `/home/cursor-user/APP/client_dashbourd`, especially `MealBuilderPage`, `MealBuilderCardEditor`, `MealBuilderSectionEditor`, `fetchMealBuilder`, menu hooks, and visual model utilities

## 1. Executive Summary

The current Meal Builder cycle is:

```txt
Dashboard draft editor
  -> MealBuilderConfig draft
  -> validation against canonical catalog + relations
  -> publish MealBuilderConfig
  -> CatalogService compiles published builder into plannerCatalog
  -> Flutter reads plannerCatalog from /api/subscriptions/meal-planner-menu
```

Main endpoints are `/api/dashboard/meal-builder/*` for draft, validation, publish, and readiness; `/api/dashboard/menu/*` for generic catalog lists and product composer data; `/api/subscriptions/meal-planner-menu` for Flutter preview; and `/api/subscriptions/meal-builder` for published builder read/preview compatibility.

Main models are `MealBuilderConfig` for authoring/published config, `MenuProduct`, `MenuCategory`, `MenuOptionGroup`, and `MenuOption` for catalog source data, `ProductOptionGroup` and `ProductGroupOption` for product customization relations, `CatalogItem` for global availability, and `SubscriptionDay` for customer selections. `Meal`, `MealCategory`, `BuilderProtein`, and `BuilderCarb` are legacy compatibility models, not the current Meal Builder source of truth.

Current relation chain:

```txt
MealBuilderConfig.sections[]
  -> selected product/category/group/option ids
  -> MenuProduct / MenuCategory / MenuOptionGroup / MenuOption
  -> ProductOptionGroup product-to-group relation
  -> ProductGroupOption product+group-to-option relation
  -> CatalogItem availability gate
  -> published plannerCatalog.sections[].products[].optionGroups[].options[]
```

Current pain points:

- Dashboard picker data is generic and loaded as broad product/category/group/option lists.
- Dashboard uses client-side heuristics to classify cards and candidates.
- Adding an ID to `MealBuilderConfig` does not create missing catalog relations.
- Admins cannot clearly see "eligible but not linked" vs "linked but unavailable" vs "selected".
- Item reorder inside `selectedOptionIds` is not a hardened backend contract.
- `/api/subscriptions/meal-builder` and `/api/subscriptions/meal-planner-menu` can confuse implementers.

Best recommended future cycle:

```txt
Dashboard opens hydrated draft
  -> backend returns section cards with selected, eligible, linked, not-linked, unavailable state
Admin opens relation-aware picker
  -> backend explains exactly why each candidate can/cannot be added
Admin adds/removes item through section item endpoint
  -> backend updates draft and optionally guides relation fix
Admin validates/publishes
  -> Flutter previews plannerCatalog
```

Implemented backend improvement:

- `GET /api/dashboard/meal-builder/draft/hydrated` returns the current draft with selected items hydrated and annotated with relation/availability/reason-code state.
- `GET /api/dashboard/meal-builder/pickers/:sectionKey` returns section-aware candidates for `premium`, `sandwich`, `chicken`, `beef`, `fish`, `eggs`, and `carbs`.
- Picker defaults now include selected, eligible, and not-linked-but-otherwise-valid candidates; unavailable/inactive/unpublished candidates are excluded unless selected or `includeUnavailable=true`.

Conclusion:

```txt
Current system is usable, but Dashboard editing is hard because picker data is generic and relations are implicit.
Recommended improvement: add relation-aware Meal Builder picker/editor endpoints and hydrated draft responses.
```

## 2. Current End-To-End Cycle

| Step | Endpoint | Model/Service | Request | Response | What Can Fail | Dashboard Should Show |
| ---- | -------- | ------------- | ------- | -------- | ------------- | --------------------- |
| Dashboard opens Meal Builder | `GET /api/dashboard/meal-builder` | `MealBuilderConfig`, `mealBuilderConfigService.getDashboardState` | none | current `draft`, `published`, `preview`, `validation` | no draft, invalid published config, preview build issues | editable draft state, published status, validation badges |
| Dashboard opens hydrated draft | `GET /api/dashboard/meal-builder/draft/hydrated` | `MealBuilderConfig`, catalog and relation models, `mealBuilderConfigService.getHydratedDraft` | none | current draft with hydrated selected items, readiness, validation | no draft, missing refs, inactive/unpublished/unlinked selected items | card item status, missing placeholders, reason codes |
| Dashboard checks readiness | `GET /api/dashboard/meal-builder/readiness` | `MealBuilderConfig`, `getReadinessReport` | none | readiness report | no draft, no published config, invalid catalog references | global ready/error/warning panel |
| Admin creates draft | `POST /api/dashboard/meal-builder/draft` | `MealBuilderConfig`, `buildDefaultVisualTemplateSections` | optional `{ sections, notes }`; no body creates default visual template | serialized draft | missing `basic_meal`, groups, category, or invalid section payload | draft cards or seed errors |
| Admin opens card | no dedicated backend endpoint today | Dashboard `MealBuilderCardEditor` + broad catalog lists | local state | local visual card | card has no primary section; relation state unknown | card editor with selected IDs and broad candidate list |
| Admin opens section-aware picker | `GET /api/dashboard/meal-builder/pickers/:sectionKey` | catalog and relation models, `mealBuilderConfigService.getSectionPicker` | `q`, `includeUnavailable`, `includeNotLinked`, `page`, `limit` | selected/eligible/not-linked/unavailable candidates | unsupported section key, unavailable catalog state, missing required premium records | relation-aware candidates and fix prompts |
| Dashboard fetches catalog picker data | `GET /api/dashboard/menu/products`, `/categories`, `/option-groups`, `/options`, sometimes product composer | `menuCatalogService` | list query params | generic catalog lists | inactive/unpublished data mixed in, missing relation visibility | picker candidates and warnings |
| Admin adds/removes item | no current item mutation endpoint; local state change | Dashboard rewrites `sections[]` | local selection toggle | local draft sections | selected ID may not be related to product/group | dirty state and later validation errors |
| Dashboard saves draft | `PUT /api/dashboard/meal-builder/draft` | `MealBuilderConfig`, `updateDraft` | `{ sections, notes }` full replacement | serialized draft | invalid ObjectId, invalid section type/sourceKind/includeMode, required section source missing | save success or field-level backend error |
| Dashboard validates draft | `POST /api/dashboard/meal-builder/validate` | `validatePayload` / `validateConfigObject` | `{ sections }` or `{}` | validation report | missing docs, missing relations, unavailable items, invalid premium/salad/carb rules | blocking errors, warnings, item-level state |
| Dashboard publishes | `POST /api/dashboard/meal-builder/publish` | `publishDraft`, `buildPublishedContract` | `{ notes }` | `{ config, validation, contract }` | no draft, validation not ready, duplicate/DB errors | publish success, published hash, or blockers |
| Dashboard/Flutter previews planner | `GET /api/subscriptions/meal-planner-menu` | `CatalogService.getSubscriptionBuilderCatalogWithV2` | optional `lang`, `contractVersion` | `builderCatalog`, `builderCatalogV2`, `plannerCatalog` | published builder compile warning falls back to default v3 catalog | planner preview from `plannerCatalog.sections` |
| Flutter reads planner | `GET /api/subscriptions/meal-planner-menu` | same | public request | canonical planner catalog | stale catalog after publish | render planner and refresh on stale errors |

Important current Dashboard behavior from `/home/cursor-user/APP/client_dashbourd`:

- `MealBuilderPage` calls `useMealBuilderQuery`, `useMealBuilderReadinessQuery`, `useMealPlannerMenuPreviewQuery`, `useMenuProductsQuery`, `useMenuCategoriesQuery`, `useMenuOptionGroupsQuery`, and `useMenuOptionsQuery`.
- `MealBuilderCardEditor` adds/removes by mutating local `selectedOptionIds`/`selectedProductIds` and later saving the whole draft.
- `MealBuilderVisualModel` classifies options/products client-side using keys, names, `proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, `itemType`, and category key.
- `MealBuilderSectionEditor` is more relation-aware for option groups because it fetches product composer data for the selected `productContextId`.

## 3. Endpoint Inventory

Current real endpoints:

| Endpoint | Consumer | Purpose | Data Source | Returns | Current Problems |
| -------- | -------- | ------- | ----------- | ------- | ---------------- |
| `GET /api/dashboard/meal-builder` | Dashboard | Load editable state | `MealBuilderConfig`, service validation | draft, published, preview, validation | Not hydrated with candidate/eligibility state |
| `GET /api/dashboard/meal-builder/draft/hydrated` | Dashboard | Load resolved editable draft state | `MealBuilderConfig`, catalog + relations | draft, ready, errors, warnings, hydrated sections | New implemented endpoint; Dashboard still needs to adopt it |
| `POST /api/dashboard/meal-builder/draft` | Dashboard | Create draft | `MealBuilderConfig`, catalog seed resolver | serialized draft | No-body seed depends on catalog relations; errors are not picker-specific |
| `PUT /api/dashboard/meal-builder/draft` | Dashboard | Save draft | `MealBuilderConfig` | serialized draft | Full array replacement; adding IDs does not create relations |
| `GET /api/dashboard/meal-builder/pickers/:sectionKey` | Dashboard picker | Section-aware picker for visual cards | `MenuProduct`, `MenuOption`, relations, availability | candidates with selected/eligible/not-linked/unavailable/invalid state | New implemented endpoint; no mutation or relation fix action yet |
| `POST /api/dashboard/meal-builder/validate` | Dashboard | Validate draft/payload | catalog + relations | errors/warnings/checks/summary | Reactive; user discovers relation issues after adding |
| `POST /api/dashboard/meal-builder/publish` | Dashboard | Publish draft | `MealBuilderConfig` | published config, validation, builder contract | Blocks on validation; no guided fix action |
| `GET /api/dashboard/meal-builder/readiness` | Dashboard | Published/draft readiness | `MealBuilderConfig`, catalog + relations | readiness report | Not section-picker specific |
| `GET /api/dashboard/menu/products` | Dashboard picker | Product list | `MenuProduct` | products, optionally paginated | Generic; caller must know category/itemType/key rules |
| `GET /api/dashboard/menu/categories` | Dashboard picker | Category list | `MenuCategory` | categories | Generic; no Meal Builder role metadata |
| `GET /api/dashboard/menu/option-groups` | Dashboard picker | Option group list | `MenuOptionGroup` | groups | Generic; caller must choose correct product relation |
| `GET /api/dashboard/menu/options` | Dashboard picker | Option list | `MenuOption` | options | Generic; not scoped to product/group relation unless filtered by `groupId` |
| `GET /api/dashboard/menu/option-groups/:groupId/options` | Dashboard picker | Options in a group | `MenuOption` | options | Does not tell whether option is linked to a product |
| `GET /api/dashboard/menu/products/:productId/composer` | Dashboard relation UI | Hydrate product customization | product + group/option relations | product, groups, options, validation | Helpful but product-centered, not section/card-centered |
| `GET /api/dashboard/menu/products/:productId/option-groups` | Dashboard relation UI | Product group relations | `ProductOptionGroup` | relation rows | Generic relation list |
| `GET /api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Dashboard relation UI | Product option relations | `ProductGroupOption` | relation rows | Generic relation list |
| `GET /api/dashboard/menu/products/:productId/option-groups/:groupId/option-pool` | Dashboard picker | Relation-aware option pool for one product group | `MenuOption`, `ProductGroupOption` | options with `isLinked` state | Good primitive, but not wired to Meal Builder card semantics |
| `PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Dashboard relation editor | Replace relation options | `ProductGroupOption` | composer v4 | Dangerous for casual card edits; replaces full relation set |
| `POST /api/dashboard/menu/products/:productId/option-groups` | Dashboard relation editor | Attach group to product | `ProductOptionGroup` | relation | Not Meal Builder-specific |
| `POST /api/dashboard/menu/products/:productId/option-groups/:groupId/options` | Dashboard relation editor | Attach option to product group | `ProductGroupOption` | relation | Not Meal Builder-specific |
| `GET /api/subscriptions/meal-planner-menu` | Flutter/Dashboard preview | Canonical planner catalog | `CatalogService`, published builder if any | `plannerCatalog` | Should not be used to edit draft |
| `GET /api/subscriptions/meal-builder` | Preview/compatibility | Published builder read model | published `MealBuilderConfig` | `subscription_meal_builder.v1` contract | Not canonical Flutter planner source unless product decides |

Dashboard contract risk found: `src/utils/fetchMenuProductGroups.ts` contains comments and helper URLs for `/api/dashboard/menu/products/:productId/groups` and `/groups/:groupId/options`, but current backend route names use `/option-groups`. If those helpers are used later, they need correction. The active Meal Builder page primarily uses catalog lists and product composer hooks.

## 4. Database Model Map

| Model | Stores | Example Records | Used For | Edited By | Read By |
| ----- | ------ | --------------- | -------- | --------- | ------- |
| `MealBuilderConfig` | draft/published/archived builder authoring config | visual sections: `premium`, `sandwich`, `chicken`, `carbs` | draft authoring data and published config data | `/api/dashboard/meal-builder/*` | Dashboard state, publish compiler |
| `MenuProduct` | canonical product rows | `basic_meal`, `premium_large_salad`, `grilled_chicken_cold_sandwich`, possible `pizza` | source catalog data | `/api/dashboard/menu/products*` | Meal Builder, planner compiler, order/menu systems |
| `MenuOption` | canonical option rows | `grilled_chicken`, `chicken_fajita`, `white_rice`, `garlic_sauce`, `mozzarella` | source catalog data | `/api/dashboard/menu/options*` | Meal Builder, product composer, planner compiler |
| `MenuOptionGroup` | option group definitions | `proteins`, `carbs`, proposed `sauces`, `cheese` | source catalog data | `/api/dashboard/menu/option-groups*` | relation compiler and Dashboard pickers |
| `ProductOptionGroup` | product-to-group relation | `basic_meal -> proteins`, `basic_meal -> carbs`, `pizza -> sauces` | relation data | `/api/dashboard/menu/products/:productId/option-groups*` | validation/compiler/composer |
| `ProductGroupOption` | product+group-to-option relation | `basic_meal/proteins -> chicken_fajita` | relation data | `/api/dashboard/menu/products/:productId/option-groups/:groupId/options*` | validation/compiler/composer |
| `CatalogItem` | global catalog identity/availability | item kind `protein`, `carb`, `sandwich`, `product` | availability source | catalog item endpoints/seed | validation/readiness/compiler |
| `MenuCategory` | canonical product categories | `custom_order`, `cold_sandwiches`, possible `pizza` | source catalog data | `/api/dashboard/menu/categories*` | product lists and sections |
| `MealCategory` | legacy meal categories | regular meal category | legacy compatibility data | legacy meal category routes | older meal endpoints |
| `Meal` | legacy ready meal rows and legacy selection refs | regular meal, old sandwich refs | legacy compatibility data | legacy meal routes | subscription legacy projections |
| `BuilderProtein` | legacy builder protein rows | old chicken/premium protein | legacy compatibility data | admin meal planner legacy routes | legacy projection/compatibility |
| `BuilderCarb` | legacy builder carb rows | old rice/carb rows | legacy compatibility data | admin meal planner legacy routes | legacy projection/compatibility |
| `SubscriptionDay` | user day selections | `mealSlots[]` with `productId`, `selectedOptions`, `contractVersion=meal_planner_menu.v3` | user selection data | subscription day save/confirm endpoints | Flutter, operations, validation |

Current source of truth for Meal Builder editing is the canonical menu family: `MenuProduct`, `MenuCategory`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, and `CatalogItem`.

## 5. Relation Map

Plate meal:

```txt
MenuProduct basic_meal
  -> ProductOptionGroup proteins
    -> ProductGroupOption chicken
    -> ProductGroupOption chicken_fajita
    -> ProductGroupOption spicy_chicken
  -> ProductOptionGroup carbs
    -> ProductGroupOption white_rice
    -> ProductGroupOption sweet_potato
```

Premium large salad:

```txt
MenuProduct premium_large_salad
  -> ProductOptionGroup proteins
    -> ProductGroupOption allowed salad proteins
  -> other salad groups
  -/-> extra_protein_50g is rejected for subscription premium large salad
```

Potential pizza:

```txt
MenuCategory pizza
  -> MenuProduct margherita_pizza
    -> ProductOptionGroup sauces
      -> ProductGroupOption pizza_sauce
    -> ProductOptionGroup cheese
      -> ProductGroupOption mozzarella
```

Relationship meanings:

- Product to category: `MenuProduct.categoryId -> MenuCategory._id`.
- Option to default group: `MenuOption.groupId -> MenuOptionGroup._id`.
- Product to option group: `ProductOptionGroup(productId, groupId)` owns rules (`minSelections`, `maxSelections`, `isRequired`) and relation availability.
- Product + group to option: `ProductGroupOption(productId, groupId, optionId)` owns relation-specific option eligibility, sort, availability, and override pricing.
- Option to family: for proteins, `MenuOption.proteinFamilyKey`, `displayCategoryKey`, `premiumKey`, and configured key mapping in `mealPlannerContract`.
- Product to type: `MenuProduct.itemType`, `key`, `categoryId`, and category key. Sandwiches use `itemType=cold_sandwich` and category `cold_sandwiches`; premium salad uses key/itemType `premium_large_salad`; basic plate meal uses key `basic_meal`.
- Catalog availability: if product/option has `catalogItemId`, linked `CatalogItem.isActive` and `isAvailable` can block readiness/output.
- MealBuilderConfig selected IDs: `selectedOptionIds` and `selectedProductIds` choose which linked items appear in a section.
- Planner output: published builder sections compile into `plannerCatalog.sections[].products[].optionGroups[].options[]`.

## 6. How Each Card Gets Its Items

### Premium

Current data source: an `option_group` section with `sourceKind=premium_visual`, `productContextId=basic_meal`, `sourceGroupId=proteins`, and premium `selectedOptionIds`, plus `selectedProductIds` containing `premium_large_salad`.

Models: `MenuOption` for `beef_steak`, `shrimp`, `salmon`; `MenuProduct` for `premium_large_salad`; `ProductOptionGroup`/`ProductGroupOption` for eligibility.

Keys: `PREMIUM_MEAL_PROTEIN_KEYS = beef_steak, shrimp, salmon`; `premium_large_salad`.

Add premium protein: create/update `MenuOption` in `proteins`, set `premiumKey` and positive price, ensure it is linked to `basic_meal/proteins` through `ProductGroupOption`, then add its ID to the Premium section. Current validation expects all three existing premium keys, so a new premium protein strategy needs backend contract hardening if product wants more than the required set.

Add premium large salad: create/update `MenuProduct premium_large_salad`, make it subscription-enabled and published, ensure salad relations are valid, then include product ID in Premium `selectedProductIds`.

Validation: missing required premium keys, non-premium options in premium meal, missing salad, unavailable CatalogItem, invalid salad allowlist, or `extra_protein_50g` exposure can block publish.

### Sandwich

Current data source: `product_category` section backed by `MenuCategory.key=cold_sandwiches`, `includeMode=selected`, and `selectedProductIds`.

Model: `MenuProduct`.

Category/itemType: `categoryId` points to `cold_sandwiches`, `itemType=cold_sandwich`, `availableFor` includes `subscription`.

Add sandwich: create/update a `MenuProduct` in `cold_sandwiches`, publish it, ensure availability, then add product ID to the Sandwich section.

Validation: category ready, product ready, subscription-enabled, global CatalogItem available when linked.

### Chicken

Current data source: `option_group` section for `basic_meal/proteins`, `selectionType=standard_meal`, selected chicken-family option IDs.

Classification: `MenuOption.proteinFamilyKey=chicken`, `displayCategoryKey=chicken`, or configured key mapping such as `chicken_fajita`, `spicy_chicken`, `italian_spiced_chicken`, `grilled_chicken`.

Required relation: `ProductOptionGroup(basic_meal, proteins)` and `ProductGroupOption(basic_meal, proteins, option)`.

Add chicken variant: create `MenuOption` under proteins, set family/display category to chicken, publish/enable, link to `basic_meal/proteins`, add ID to chicken section.

### Beef

Same as chicken, but family is `beef`; examples include `beef`, `meatballs`, `beef_stroganoff`. The beef section should preserve `rules.ruleKey=beef_daily_limit` and `maxSlotsPerDay=1`.

### Fish

Same as chicken, but family is `fish`; examples include `fish`, `fish_fillet`, `tuna`. Premium fish-like options such as `salmon` and `shrimp` are treated as premium when `premiumKey`/premium keys apply.

### Eggs

Same as chicken, but family is `eggs`; examples include `eggs`, `boiled_eggs`.

### Carbs

Current data source: `option_group` section for `basic_meal/carbs`, `selectionType=standard_meal`, selected carb IDs.

Classification: options in `MenuOptionGroup.key=carbs`; default visibility is additionally constrained by `CUSTOMER_VISIBLE_CARB_KEYS`.

Required relation: `ProductOptionGroup(basic_meal, carbs)` and `ProductGroupOption(basic_meal, carbs, option)`.

Add carb: create `MenuOption` under carbs, publish/enable, link to `basic_meal/carbs`, add ID to carbs section, preserve max 2 / 300g rules.

### Sauces

Sauces are not part of the current default visual template. They should not be added to chicken/beef/fish/eggs/cards unless product decides sauces are global meal-builder sections.

Recommended model: `MenuOptionGroup key=sauces`, `MenuOption` rows such as `garlic_sauce`, `spicy_sauce`, `ranch`, `pizza_sauce`, and `ProductOptionGroup`/`ProductGroupOption` links only for products that support sauces. For pizza, sauces likely belong inside the pizza product builder. For standard meals, product must decide whether sauces are global options on `basic_meal` or product-specific add-ons.

Needs backend contract hardening: if sauces become a visual section, define section key, selection rules, Flutter rendering expectations, and whether sauce selection is required/optional.

### Cheese

Cheese is not part of the current default template. Recommended model: `MenuOptionGroup key=cheese` or `toppings`, `MenuOption` rows such as `mozzarella`, `halloumi`, `cheddar`, linked to sandwich/pizza products that support them. Do not automatically attach cheese to `basic_meal` unless product wants cheese in standard plate meals.

Needs backend contract hardening: decide whether cheese is a product-specific group, a global section, or a topping group for specific categories only.

### Pizza / Special Products

Recommended model depends on UX:

- Direct product: `MenuCategory key=pizza`, `MenuProduct itemType=pizza`, product list section, no builder.
- Configurable product: `MenuCategory key=pizza`, `MenuProduct itemType=pizza`, `isCustomizable=true`, linked groups such as `sauces`, `cheese`, `toppings`, and `ProductGroupOption` rows.

If pizza should appear as a Meal Builder card, use a `product_category` or `product_list` section. If pizza should open a builder in Flutter, compile it as a configurable product with option groups.

## 7. Eligibility Rules

For a `MenuOption` to appear in a card:

- It exists in `MenuOption`.
- `isActive`, `isVisible`, and `isAvailable` are not false.
- `publishedAt` is set.
- It is subscription-enabled (`availableForSubscription !== false` and/or `availableFor` includes `subscription`).
- Its `groupId` and/or intended `sourceGroupId` classification exists.
- Family classification exists if the card is family-based.
- It is linked to the section product/group through `ProductGroupOption`.
- The product is linked to the group through `ProductOptionGroup`.
- Linked `CatalogItem` is active/available if `catalogItemId` exists.
- `MealBuilderConfig.sections[].selectedOptionIds` includes it, unless the section includes all relation options.

For a `MenuProduct` to appear in a card:

- It exists in `MenuProduct`.
- `isActive`, `isVisible`, and `isAvailable` are not false.
- `publishedAt` is set.
- `availableFor` includes `subscription`.
- Category and/or `itemType` match the intended card.
- Linked `CatalogItem` is active/available if `catalogItemId` exists.
- If configurable, required product-group and product-option relations exist.
- `MealBuilderConfig.sections[].selectedProductIds` includes it, or product-category section uses `includeMode=all`.

For `MealBuilderConfig`:

- Section type/source IDs are valid.
- `selectedOptionIds` or `selectedProductIds` include the item when needed.
- Section rules remain valid.
- `POST /validate` passes.
- `POST /publish` passes.

Editing `MealBuilderConfig` alone is enough only when the catalog row and required relations already exist. Otherwise it saves an ID that validation/publish will reject or planner compile will omit.

## 8. Current Dashboard Editing Problems

| Problem | Why It Happens | User Impact | Backend Fix | Dashboard Fix |
| ------- | -------------- | ----------- | ----------- | ------------- |
| Picker data is too generic | Dashboard loads broad `/dashboard/menu` lists | Admin sees items that may not be eligible | Add section-aware picker endpoints | Replace client filtering with backend eligibility states |
| Admin must understand relations manually | Product/group/option relation is separate from selected IDs | Item added to card can fail validation | Return linked/not-linked state per candidate | Show "link relation" CTA |
| Draft stores IDs but does not create relations | `PUT /draft` only updates `MealBuilderConfig` | Save succeeds, publish fails | Add item mutation endpoint that checks relations | Add guided add flow |
| Unclear why item does not appear | Compile filters by availability and relation state | Confusing hidden items | Hydrated draft with per-item reason codes | Inline item status |
| No one-click relation action | Existing relation endpoints are product-composer oriented | Admin must leave Meal Builder | Proposed safe link endpoint | Fix-in-place action |
| Reorder is not hardened | Backend sorts compile by relation/record sort; revision hash sorts IDs | UI reorder may not affect Flutter | Define item sort contract | Disable reorder or map reorder to relation sort |
| `/meal-builder` vs `plannerCatalog` confusion | Both endpoints expose builder-like data | Wrong Flutter integration target | Keep docs and response labels clear | Preview `plannerCatalog` as canonical |
| Sauces/cheese/pizza have no current visual strategy | Default template only covers premium/sandwich/protein/carbs | UI may bolt special items into wrong cards | Decide model and section semantics | Add product-specific builder UI |
| Dashboard family matching is heuristic | `mealBuilderVisualModel` uses keys/names/family fields | New item may land in wrong card | Backend picker should classify | Trust backend `sectionKey` |

## 9. Improved Backend Cycle

The first two endpoints in this table are implemented. The remaining mutation, relation-fix, and draft-preview endpoints are still proposed future work.

| Endpoint | Status | Purpose | Request | Response | Why It Helps Dashboard | Models Touched | Validation |
| -------- | ------ | ------- | ------- | -------- | ---------------------- | -------------- | ---------- |
| `GET /api/dashboard/meal-builder/draft/hydrated` | Implemented | Return draft with hydrated sections/items and issue state | none | draft sections with selected items, missing refs, relation status, availability status | Removes client-side hydration and guesswork | read `MealBuilderConfig`, catalog, relations | same as `validateConfigObject`, item-scoped |
| `GET /api/dashboard/meal-builder/pickers/:sectionKey` | Implemented | Section-aware picker | query `q`, `includeUnavailable`, `includeNotLinked`, `page`, `limit` | candidates with `state=selected|eligible|not_linked|unavailable|invalid`, reasons, suggested action | Admin sees exactly what can be added | read catalog + relations | section-specific eligibility |
| `POST /api/dashboard/meal-builder/draft/sections/:sectionKey/items` | Proposed | Add item to section | `{ itemType, itemId, createRelation?: false }` | hydrated section/draft | Avoid full section replacement | update `MealBuilderConfig`; optionally relations only if explicit | reject/warn on not-linked |
| `DELETE /api/dashboard/meal-builder/draft/sections/:sectionKey/items/:itemId` | Proposed | Remove item | item type in query/body | hydrated section/draft | Safer removal than whole-array patch | update `MealBuilderConfig` | can block locked required removals or return validation error |
| `PATCH /api/dashboard/meal-builder/draft/sections/:sectionKey` | Proposed | Edit section metadata/rules safely | allowed fields only | hydrated section | Prevent accidental rule corruption | update `MealBuilderConfig` | section-specific rule validation |
| `POST /api/dashboard/meal-builder/draft/sections/:sectionKey/items/:itemId/link-relation` | Proposed | Link missing relation from card context | `{ productId, groupId, optionId, rules?, pricing? }` | relation + hydrated picker state | Fix eligible-not-linked items in place | `ProductOptionGroup`, `ProductGroupOption` | product/group/option existence, permissions, safety rules |
| `GET /api/dashboard/meal-builder/preview/planner-catalog` | Proposed | Preview compiled planner from current draft without publishing | optional `{ sections }` or current draft | draft-derived `plannerCatalog` preview | Shows Flutter result before publish | read draft/catalog | compile with warnings; do not publish |

Design notes:

- `pickers/:sectionKey` should be section-card aware, not just model aware.
- Candidates should include `reasonCodes`, such as `NOT_LINKED_TO_PRODUCT_GROUP`, `UNPUBLISHED`, `CATALOG_ITEM_UNAVAILABLE`, `WRONG_FAMILY`, `PREMIUM_PRICE_MISSING`.
- Link actions should be explicit and safe. Do not silently create relations when adding a selected ID unless product chooses that behavior.

## 10. Recommended Improved Dashboard Cycle

Improved UX:

```txt
Admin opens card
  -> Dashboard calls GET /api/dashboard/meal-builder/pickers/:sectionKey
  -> picker shows selected, eligible, not-linked, unavailable, invalid
Admin selects item
  -> backend adds item or explains missing relation
  -> Dashboard shows hydrated card
Admin validates
  -> backend returns section/item errors
Admin publishes
  -> Dashboard previews plannerCatalog
```

Adding chicken curry:

1. Admin opens Chicken card.
2. Picker shows `chicken_curry` as eligible if linked, or not-linked if catalog row exists but relation is missing.
3. If not linked, Dashboard offers "Link to basic_meal/proteins".
4. Add item updates draft and returns hydrated Chicken card.

Adding sauce:

1. Admin opens product-specific builder for a product that supports sauces.
2. Picker for `sauces` group shows sauce options with relation state.
3. If product wants global sauce section, Dashboard uses a new section key only after backend contract hardening.

Adding cheese:

1. Admin chooses the product context, such as pizza or sandwich.
2. Picker uses group `cheese`/`toppings`.
3. Backend validates product supports that group.

Adding pizza product:

1. Admin creates/chooses `MenuCategory pizza`.
2. Admin creates/chooses `MenuProduct` pizza.
3. If configurable, attach groups/options in product composer or relation-aware Meal Builder flow.
4. Add product to a `product_category`/`product_list` section.

Removing invalid item:

- Dashboard should show the invalid reason and allow remove from draft without touching catalog.

Fixing relation:

- Dashboard should show "item exists but is not linked to `basic_meal/proteins`" and call proposed link endpoint only after admin confirms.

Seeing why item is hidden:

- Picker and hydrated draft should expose hidden reasons before publish, not only in validation after save.

## 11. Recommended Data Modeling For New Item Types

### Chicken Curry

Recommended:

- `MenuOption`
- `groupId = proteins`
- `proteinFamilyKey = chicken`
- `displayCategoryKey = chicken`
- subscription-enabled, active, visible, available, published
- linked through `ProductGroupOption(basic_meal, proteins, chicken_curry)`
- selected in the `chicken` section

Pros: follows existing protein/card model. Cons: depends on relation-aware picker to avoid missed linking.

### Sauce

Recommended:

- `MenuOption`
- `MenuOptionGroup key=sauces`
- linked only to products that support sauces
- optional `ProductOptionGroup` rules such as `minSelections=0`, `maxSelections=1`
- product-specific option group by default

Pros: avoids forcing sauces into all meal cards. Cons: needs product-specific UI and Flutter handling of additional groups.

### Cheese

Recommended:

- `MenuOption`
- `MenuOptionGroup key=cheese` or `toppings`
- linked to sandwich/pizza products if applicable
- not part of standard meal unless product decides

Pros: clean product-specific customization. Cons: needs category/product policy so cheese does not appear in unrelated meals.

### Pizza

Option 1: direct product.

- `MenuProduct itemType=pizza`
- `MenuCategory key=pizza`
- product list/category section
- no option groups

Pros: simple. Cons: no sauce/cheese customization.

Option 2: configurable product.

- `MenuProduct itemType=pizza`, `isCustomizable=true`
- `MenuCategory key=pizza`
- `ProductOptionGroup` rows for sauces/cheese/toppings
- `ProductGroupOption` rows for allowed options

Pros: matches special-product builder UX. Cons: more relations and Flutter UI complexity.

Recommendation: use configurable product if pizza needs sauce/cheese/toppings; use direct product if pizza is fixed.

## 12. Backend Decision Points

| Decision | Recommendation |
| -------- | -------------- |
| Should sauces/cheese be global sections or product-specific option groups? | Product-specific groups first. Add global sections only if product explicitly wants every meal to expose them. |
| Should pizza be complete product or configurable builder? | Configurable if sauce/cheese/toppings matter; direct product if fixed. |
| Should Dashboard auto-create missing relations? | Do not auto-create silently. Offer explicit relation fix action with previewed effect. |
| Should item reorder update `MealBuilderConfig` only or relation `sortOrder`? | Define this before implementation. For Flutter output, relation `sortOrder` is the stronger current ordering source. |
| Should `/api/subscriptions/meal-builder` remain preview-only? | Yes. Keep Flutter canonical on `/api/subscriptions/meal-planner-menu` and `plannerCatalog`. |
| Should pickers include inactive items with warnings or hide them? | Include when `includeUnavailable=true`; default show eligible + selected + not-linked, with clear filters. |
| Should required premium keys be removable? | Allow removal only if UI clearly shows publish-blocking error, or lock them with admin override. Recommended: lock by default with advanced override. |
| Should a new premium protein beyond steak/shrimp/salmon be supported? | Needs backend contract hardening because current validation expects required fixed keys. |
| Should `MealBuilderConfig` support stable item order? | Yes, if card reorder is a user-facing feature. Add explicit item order or map to relation sort order. |

## 13. Suggested Phased Implementation Plan

### Phase 1: Better Documentation And Debugging

Backend tasks: keep current structure docs, add endpoint examples, document validation codes.

Dashboard tasks: log current API responses in development, document current broad list queries and visual mapping.

Tests: none required beyond docs review.

Exit criteria: team agrees on source of truth and planner endpoint.

### Phase 2: Hydrated Draft Response

Backend tasks: implemented `GET /api/dashboard/meal-builder/draft/hydrated`.

Dashboard tasks: replace client hydration of selected IDs with backend hydrated items.

Tests: `tests/dashboardMealBuilderHydratedDraft.test.js` added.

Exit criteria: every selected item shows resolved record, relation state, and validation state.

### Phase 3: Relation-Aware Pickers

Backend tasks: implemented `GET /api/dashboard/meal-builder/pickers/:sectionKey`.

Dashboard tasks: card editor uses picker endpoint instead of broad lists.

Tests: `tests/dashboardMealBuilderPickers.test.js` added.

Exit criteria: picker shows selected, eligible, not-linked, unavailable, invalid with reason codes.

### Phase 4: Section Item Mutation APIs

Backend tasks: add proposed `POST`/`DELETE` item endpoints and `PATCH` section endpoint.

Dashboard tasks: stop replacing full `sections[]` for item-level changes.

Tests: `tests/dashboardMealBuilderSectionItemMutations.test.js`.

Exit criteria: add/remove/edit returns hydrated draft and preserves unrelated sections.

### Phase 5: Relation Fix Actions

Backend tasks: add proposed link relation endpoint with strict validation.

Dashboard tasks: add "Fix relation" CTA for not-linked candidates.

Tests: `tests/dashboardMealBuilderRelationFixActions.test.js`.

Exit criteria: admin can safely link `basic_meal/proteins -> chicken_curry` from card flow.

### Phase 6: New Item Type Support

Backend tasks: define sauce/cheese/pizza section/product strategy and update compiler only if needed.

Dashboard tasks: add product-specific group editing UX for sauces/cheese/pizza.

Tests: chicken curry, sauce, cheese, and pizza flow tests.

Exit criteria: new item types appear in picker, validate, publish, and compile correctly.

### Phase 7: Flutter Integration

Backend tasks: stabilize `plannerCatalog` shape and stale catalog errors.

Dashboard tasks: preview exactly what Flutter will render.

Flutter tasks: render `plannerCatalog.sections[].products[].optionGroups[].options[]`.

Tests: dashboard-to-Flutter E2E.

Exit criteria: published Dashboard changes appear in Flutter preview and selection save/validate passes.

## 14. Test Plan Recommendations

Suggested backend tests:

- `tests/dashboardMealBuilderHydratedDraft.test.js`
- `tests/dashboardMealBuilderPickers.test.js`
- `tests/dashboardMealBuilderSectionItemMutations.test.js`
- `tests/dashboardMealBuilderRelationFixActions.test.js`
- `tests/dashboardMealBuilderChickenCurryFlow.test.js`
- `tests/dashboardMealBuilderSauceFlow.test.js`
- `tests/dashboardMealBuilderCheeseFlow.test.js`
- `tests/dashboardMealBuilderPizzaFlow.test.js`
- `tests/subscriptionMealBuilderPlannerCatalogCompile.test.js` expansion
- `tests/dashboardMealBuilderReadinessErrors.test.js`
- `tests/subscriptionPlannerDashboardToFlutter.e2e.test.js` expansion

Suggested dashboard tests:

- `tests/mealBuilderApiContract.test.ts`
- `tests/mealBuilderHydratedDraftAdapter.test.ts`
- `tests/mealBuilderPickerStates.test.ts`
- `tests/mealBuilderCardEditorMutations.test.tsx`
- `tests/mealBuilderPlannerPreview.test.ts`

Coverage goals:

- picker endpoint returns selected/eligible/not-linked/unavailable states
- hydrated draft returns item status and reason codes
- add/remove item endpoint preserves unrelated draft data
- relation fix action creates only intended relation
- chicken curry appears under Chicken only after relation exists
- sauces/cheese appear only for products that support them
- pizza direct/configurable paths compile correctly
- `plannerCatalog` output matches Flutter v3 expectations
- readiness errors are specific enough for Dashboard UI

## 15. Final Recommendation

```txt
Do not continue adding complex UI logic on top of generic picker endpoints.
First add relation-aware picker and hydrated draft endpoints, then finish Dashboard editor, then move to Flutter.
```

Why:

- The hard part is not drawing cards. The hard part is knowing whether a catalog item is eligible, linked, available, selected, publishable, and visible in `plannerCatalog`.
- The backend already owns the real rules through catalog relations, availability, premium validation, and planner compilation.
- Dashboard should not duplicate those rules with key/name heuristics.
- Hydrated draft + section-aware picker endpoints will turn the editor from a guess-and-validate flow into a guided authoring flow.
- Flutter integration should wait until the Dashboard can produce a valid published builder consistently, because Flutter should only consume `plannerCatalog`, not raw draft state.
