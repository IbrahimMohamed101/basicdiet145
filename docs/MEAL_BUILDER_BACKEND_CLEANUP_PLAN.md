# Meal Builder Backend Cleanup Plan

Date: 2026-06-08

Internal backend reference: YES

## Canonical New Flow

The canonical backend flow for subscription meal planning is:

```txt
Dashboard Meal Builder draft/published config
-> section-aware backend pickers
-> publish/compile
-> plannerCatalog v3
-> Flutter mobile app
```

Canonical runtime surfaces:

- `GET /api/dashboard/meal-builder`
- `GET /api/dashboard/meal-builder/draft/hydrated`
- `GET /api/dashboard/meal-builder/pickers/:sectionKey`
- `POST /api/dashboard/meal-builder/draft`
- `PUT /api/dashboard/meal-builder/draft`
- `POST /api/dashboard/meal-builder/validate`
- `POST /api/dashboard/meal-builder/publish`
- `GET /api/dashboard/meal-builder/readiness`
- `GET /api/dashboard/health/meal-planner`
- `GET /api/subscriptions/meal-planner-menu?lang=ar`

Flutter must consume `plannerCatalog.contractVersion=meal_planner_menu.v3`.

## Legacy Classification

Canonical new flow:

- `MealBuilderConfig` draft/published state.
- `mealBuilderConfigService` section-aware draft, picker, publish, readiness, and compiler behavior.
- `canonicalMealSlotPlannerService` for v3 day write validation against published builder membership.
- `plannerCatalog.sections[].products[].optionGroups[].options[]`.

Legacy but still required:

- `builderCatalog` and `builderCatalogV2` response fields.
- `selections`, `premiumSelections`, `premiumUpgradeSelections`, and legacy projections on `SubscriptionDay`.
- Checkout alias `custom_premium_salad`, normalized to `premium_large_salad`.
- `/api/subscriptions/meal-builder` as a published-layout read model.
- Kitchen/ops read projections that still consume legacy materialized fields.

Legacy and deprecated for new Dashboard/Flutter work:

- `/api/admin/meal-planner-menu`.
- `/api/dashboard/meal-planner`.
- `/api/builder/premium-meals`.
- Dashboard global menu list endpoints as Meal Builder item pickers.

Dead code candidates after separate proof:

- Non-visual `buildDefaultSeedSections` paths.
- v2 planner fallback branches when all supported clients use v3.
- Legacy admin planner mutation paths.

Needs decision:

- When to move `builderCatalog` and `addonCatalog` fully behind `includeLegacy=true`. They remain read-only compatibility fields in this pass.

## Canonical Template

No-body `POST /api/dashboard/meal-builder/draft` creates exactly:

| Key | Type | Source | Sort |
| --- | --- | --- | --- |
| `premium` | `mixed` | `premium_mixed` | 10 |
| `sandwich` | `product_list` | `product_category`, `categoryKey=sandwich` | 20 |
| `chicken` | `option_family` | `groupKey=proteins`, `displayCategoryKey=chicken` | 30 |
| `beef` | `option_family` | `groupKey=proteins`, `displayCategoryKey=beef` | 40 |
| `fish` | `option_family` | `groupKey=proteins`, `displayCategoryKey=fish` | 50 |
| `eggs` | `option_family` | `groupKey=proteins`, `displayCategoryKey=eggs` | 60 |
| `carbs` | `option_group` | `groupKey=carbs` | 70 |

Storage still keeps internal compatibility fields such as `sectionType`, `sourceKind`, `productContextId`, `sourceGroupId`, and `sourceCategoryId`.

## Picker And Validation Rules

- Meal Builder item selection must use `GET /api/dashboard/meal-builder/pickers/:sectionKey`.
- `/api/dashboard/menu/options` and `/api/dashboard/menu/products` are catalog-management APIs only.
- Premium picker returns `beef_steak`, `shrimp`, `salmon`, and `premium_large_salad`; `extra_protein_50g` is excluded.
- Sandwich picker returns only cold sandwich `MenuProduct` rows.
- Protein-family pickers return only their section family and exclude premium and extra/add-on options.
- Carbs picker returns only customer-visible carb options.
- Sandwiches are full meals and do not require carbs.
- Beef standard meals are limited to one slot per day.
- Premium large salad keeps the subscription protein allowlist and rejects `extra_protein_50g`.
- Inactive selected items hydrate in Dashboard with warnings, are excluded from Flutter, and are rejected by v3 submit validation.
