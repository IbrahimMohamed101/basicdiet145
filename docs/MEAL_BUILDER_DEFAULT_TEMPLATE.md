# Meal Builder Default Template

Date: 2026-06-08

Audience: backend, Dashboard, Flutter

## Main Decision

The Dashboard "Create Draft" default template should compile into the existing Flutter-facing `plannerCatalog.sections[].products[].optionGroups[].options[]` shape.

Do not introduce a separate Flutter mobile contract for this template. Dashboard draft data can have authoring fields, but Flutter should keep rendering planner-style sections, products, option groups, and options.

## What Exists Today In Runtime Code

Verified in the current backend code:

- `MealBuilderConfig` exists at `src/models/MealBuilderConfig.js`.
- Dashboard Meal Builder routes exist through `src/routes/index.js` and `src/routes/dashboardMealBuilder.js`:
  - `GET /api/dashboard/meal-builder`
  - `GET /api/dashboard/meal-builder/draft/hydrated`
  - `POST /api/dashboard/meal-builder/draft`
  - `PUT /api/dashboard/meal-builder/draft`
  - `GET /api/dashboard/meal-builder/pickers/:sectionKey`
  - `POST /api/dashboard/meal-builder/validate`
  - `POST /api/dashboard/meal-builder/publish`
  - `GET /api/dashboard/meal-builder/readiness`
- A public builder route exists at `GET /api/subscriptions/meal-builder` through `src/routes/subscriptions.js`.
- The existing planner endpoint `GET /api/subscriptions/meal-planner-menu` returns the catalog layers used by subscription planning:
  - `builderCatalog`
  - `builderCatalogV2`
  - `plannerCatalog`
- `plannerCatalog.contractVersion` is `meal_planner_menu.v3`.
- Current `MealBuilderConfig` publishing builds a separate `subscription_meal_builder.v1` response for `/api/subscriptions/meal-builder`.
- No-body `POST /api/dashboard/meal-builder/draft` initializes the Dashboard draft from the visual family template in this document.
- `GET /api/dashboard/meal-builder/draft/hydrated` resolves selected option/product IDs into item status for Dashboard card editing.
- `GET /api/dashboard/meal-builder/pickers/:sectionKey` returns relation-aware candidates for `premium`, `sandwich`, `chicken`, `beef`, `fish`, `eggs`, and `carbs`.
- When a current published `MealBuilderConfig` exists, `/api/subscriptions/meal-planner-menu` compiles that published builder into `plannerCatalog.sections[].products[].optionGroups[].options[]`.

Important distinction: `/api/subscriptions/meal-builder` exists today, but this README's main design decision is that the new Dashboard default template should compile into the existing `plannerCatalog` shape rather than requiring Flutter to move to a new builder-only mobile contract.

## What Exists In Docs And Tests Only

Existing docs and tests mention Dashboard Meal Builder behavior, seed behavior, route behavior, and catalog contracts. They verify or describe `builderCatalog`, `builderCatalogV2`, `plannerCatalog`, and `/api/subscriptions/meal-builder`.

The visual family template requested here is now the Dashboard Create Draft default. It is still not the same as the opt-in bootstrap seed shape. Bootstrap seed logic creates source sections such as:

- standard proteins
- carbs
- premium proteins
- sandwiches
- premium large salad

The intended template below uses visual sections:

- `premium`
- `sandwich`
- `chicken`
- `beef`
- `fish`
- `eggs`
- `carbs`

The distinction matters: Dashboard Create Draft emits the visual family template, while bootstrap remains source-oriented unless it is changed separately.

## Current Backend Catalog Layers

`builderCatalog` is the legacy compatibility catalog. It keeps older Flutter and backend compatibility fields such as protein arrays, carb arrays, sandwich rows, premium proteins, and premium large salad compatibility data.

`builderCatalogV2` is a newer compatibility/read model. It includes sections and rule metadata while still preserving compatibility with the older builder catalog concepts.

`plannerCatalog` is the canonical Flutter v3 planner contract. Its shape is:

```txt
plannerCatalog.sections[].products[].optionGroups[].options[]
```

`plannerCatalog` is the target shape for Flutter rendering and for save/validate flows that use `productId`, `selectionType`, and `selectedOptions`.

## Why Planner Catalog Is Canonical

Flutter should render planner-style sections, products, option groups, and options from `plannerCatalog`.

Planner save and validation should continue using:

- `productId`
- `selectionType`
- `selectedOptions`

Flutter should not rely on draft-only Dashboard fields. Draft-only fields are for admin editing, publish readiness, and backend compilation. The published result should remain compatible with the existing v3 planner contract.

## Intended Default Dashboard Draft Template

When a Dashboard admin clicks "Create Draft" without providing explicit sections, the backend initializes the draft with the following visual family layout.

### Premium

Key: `premium`

Label:

- Arabic: `مميز`
- English: `Premium`

Includes:

- `beef_steak`
- `shrimp`
- `salmon`
- `premium_large_salad`

Rules:

- `beef_steak`, `shrimp`, and `salmon` are premium meal choices.
- `premium_large_salad` appears visually in the Premium section.
- `premium_large_salad` remains its own configurable product with `selectionType=premium_large_salad`.
- Premium large salad keeps the existing backend allowlist validation.
- Premium large salad rejects `extra_protein_50g`.

### Sandwich

Key: `sandwich`

Label:

- Arabic: `ساندوتشات`
- English: `Sandwiches`

Includes cold sandwich `MenuProduct` rows.

Rules:

- `selectionType=sandwich`
- `requiresBuilder=false`
- `treatAsFullMeal=true`
- Sandwiches are complete meal slots.
- Sandwiches do not require carbs.
- Sandwiches should render as product rows, not configurable plate builders.

### Chicken

Key: `chicken`

Label:

- Arabic: `دجاج`
- English: `Chicken`

Includes chicken-family protein options, such as:

- `chicken`
- `chicken_fajita`
- `spicy_chicken`
- `italian_spiced_chicken`
- `chicken_tikka`
- `asian_chicken`
- `chicken_strips`
- `grilled_chicken`
- `mexican_chicken`

### Beef

Key: `beef`

Label:

- Arabic: `لحم`
- English: `Beef`

Includes beef-family protein options, such as:

- `beef`
- `meatballs`
- `beef_stroganoff`

Rules:

- Beef can be selected at most once per day.
- Flutter should disable other beef choices after one beef selection.
- Backend remains the final enforcement authority.
- Reuse existing `beef_daily_limit` / `maxSlotsPerDay` behavior if present.

### Fish

Key: `fish`

Label:

- Arabic: `سمك`
- English: `Fish`

Includes fish-family protein options, such as:

- `fish`
- `tuna`
- `fish_fillet`

### Eggs

Key: `eggs`

Label:

- Arabic: `بيض`
- English: `Eggs`

Includes egg-family protein options, such as:

- `eggs`
- `boiled_eggs`

### Carbs

Key: `carbs`

Label:

- Arabic: `نشويات`
- English: `Carbs`

Includes carb options such as:

- `white_rice`
- `turmeric_rice`
- `alfredo_pasta`
- `red_sauce_pasta`
- `roasted_potato`
- `sweet_potato`
- `grilled_mixed_vegetables`

Rules:

- Carbs apply only to configurable plate meals.
- Carbs do not apply to sandwiches.
- Max carb types: 2.
- Max total carbs: 300 grams.
- Selection is grams-based.

## Section Types

A configurable product section represents a `MenuProduct` that has `optionGroups`. Plate meals and premium large salad validate through product-option-group and product-group-option relations.

A product list section represents direct `MenuProduct` rows. Sandwiches belong here because they are complete meal selections and do not need protein/carb builder steps.

An option family section is a Dashboard visual grouping of options, such as chicken, beef, fish, eggs, or carbs. It should still compile into canonical product option groups and options in `plannerCatalog`.

A premium visual section is a visual grouping that contains different backend concepts: premium protein choices and the premium large salad product. Premium large salad can appear visually under Premium while still validating as `selectionType=premium_large_salad`.

## Dashboard View

Dashboard should show ordered editable draft sections with:

- localized labels
- item membership
- validation status
- inactive/global availability warnings
- publish readiness

Dashboard should show premium large salad visually inside Premium, but the backend should validate it as its own configurable product.

Dashboard should show sandwiches as product rows, not as configurable builders.

## Flutter View

Flutter should render planner-style sections, products, option groups, and options.

Flutter save/validate payloads should use:

- `productId`
- `selectionType`
- `selectedOptions`

Flutter should not rely on draft-only fields such as Dashboard-only section authoring metadata. The backend compiles published visual family sections into the existing `plannerCatalog.sections[].products[].optionGroups[].options[]` contract for `/api/subscriptions/meal-planner-menu`.

## Backend Enforcement

Backend validation must remain authoritative.

The backend must enforce:

- global inactive, unavailable, or unpublished items must not be publishable or renderable
- stale selections must be rejected
- product-option relations remain required
- premium large salad allowlist rules remain enforced
- premium large salad rejects `extra_protein_50g`
- sandwiches do not require carbs
- carb split rules apply only to configurable plate meals
- beef daily limit remains enforced server-side

## Old Shape vs New Draft Template

Old/current backend:

- Backend builds `plannerCatalog` from seed/config/runtime catalog logic.
- Flutter consumes `plannerCatalog`.
- Dashboard may already have composer pieces and Meal Builder routes.
- The opt-in bootstrap seed shape is source-oriented and does not necessarily match the visual family template in this document.
- Current `/api/subscriptions/meal-builder` returns a separate published `subscription_meal_builder.v1` builder layout.

New idea:

- Dashboard "Create Draft" initializes from the default visual family template when no explicit sections are supplied.
- Admin edits the draft.
- Backend validates the draft.
- Backend publishes the draft.
- Published draft compiles into the existing `plannerCatalog.sections[].products[].optionGroups[].options[]` shape.
- Flutter contract does not change.

## Remaining Backend Gaps

Implemented:

- Dynamic "Create Draft" initialization for the requested visual family template.
- Published builder compilation into `plannerCatalog.sections[].products[].optionGroups[].options[]` for `/api/subscriptions/meal-planner-menu`.
- Visual family sections map to existing `MenuProduct`, `MenuOptionGroup`, `MenuOption`, and relation rows.
- Existing validation remains in place for premium large salad, beef daily limit, carb split, sandwiches, stale selections, and global availability.

Still open:

- Decide whether `/api/subscriptions/meal-builder` should remain a Dashboard preview/read model or become explicitly compatibility-only.
- Consider changing bootstrap seed output to the same visual family template if bootstrap-owned configs should match Dashboard Create Draft exactly.
- Decide how the existing `/api/subscriptions/meal-builder` endpoint relates to the canonical `plannerCatalog` contract.

## Already Supported By Current Backend

Current runtime code already has reusable support for:

- catalog products through `MenuProduct`
- option groups through `MenuOptionGroup`
- options through `MenuOption`
- product-to-group relations through `ProductOptionGroup`
- product/group-to-option relations through `ProductGroupOption`
- global active, visible, available, published, subscription channel, and linked `CatalogItem` checks
- premium large salad allowlist and `extra_protein_50g` protections
- draft, validate, publish, and readiness routes for `MealBuilderConfig`
- canonical v3 planner save/validate fields based on `productId`, `selectionType`, and `selectedOptions`
- visual family default draft creation for Dashboard
- published builder compilation into canonical `plannerCatalog`

The remaining decisions are endpoint ownership and whether bootstrap should adopt the same visual family default.
