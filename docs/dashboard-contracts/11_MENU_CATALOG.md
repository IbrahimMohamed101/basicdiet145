# 11 — Menu Catalog Dashboard Contract Index

## Screen purpose

This module lets `admin`/`superadmin` users manage the one-time menu catalog, product customization, global option library, menu releases, and the subscription Meal Builder projection. The detailed files are Postman-ready and reflect the backend as of 2026-06-20.

## Route/module overview

| Concern | HTTP base | Backend owner | Detailed contract | Endpoint count |
| --- | --- | --- | --- | ---: |
| Categories | `/api/dashboard/menu/categories` | `dashboardMenu` + `menuCatalogService` | [11A categories](./11A_MENU_CATEGORIES.md) | 9 |
| Products | `/api/dashboard/menu/products` | `dashboardMenu` + `menuCatalogService` | [11B products](./11B_MENU_PRODUCTS.md) | 11 |
| Product customization | `/api/dashboard/menu/products/:productId/...` | relation models + `menuCatalogService` | [11C customization](./11C_MENU_PRODUCT_CUSTOMIZATION.md) | 18 |
| Global option groups | `/api/dashboard/menu/option-groups` | `MenuOptionGroup` | [11D option groups](./11D_MENU_OPTION_GROUPS.md) | 10 |
| Global options | `/api/dashboard/menu/options` | `MenuOption` | [11E options](./11E_MENU_OPTIONS.md) | 9 |
| Preview/release | `/api/dashboard/menu` | `MenuVersion` + audit log | [11F preview/release](./11F_MENU_PREVIEW_RELEASE.md) | 7 |
| Subscription planner | `/api/dashboard/meal-builder` | `MealBuilderConfig` + catalog projection | [11G planner upgrades](./11G_SUBSCRIPTION_PLANNER_UPGRADES_DASHBOARD_README.md) | 8 |

The counts include compatibility aliases that are real routes. Unsupported ideas are listed as `NOT IMPLEMENTED` in their owning file and are not counted.

## Endpoint index

| File | Endpoints |
| --- | --- |
| 11A | `GET/POST /categories`; `GET/PATCH/DELETE /categories/:id`; `PATCH .../:id/visibility`; `PATCH .../:id/availability`; `POST .../:id/products`; `PATCH /categories/reorder` |
| 11B | `GET/POST /products`; `GET/PATCH/DELETE /products/:id`; `PATCH /products/bulk`; `PATCH /products/reorder`; `POST .../:id/duplicate`; `PATCH .../:id/category`; `PATCH .../:id/visibility`; `PATCH .../:productId/availability` |
| 11C | composer, customization switch, library, product/group CRUD/rules/status, option pool, and product/group/option CRUD/replace/override/status |
| 11D | group list/create/detail/update/status/reorder/delete plus nested option list/create |
| 11E | option list/create/detail/update/status/toggle/reorder/delete |
| 11F | preview, validate, diff, publish, versions, rollback, audit logs |
| 11G | dashboard state, hydrated draft, create/update/validate/publish draft, section picker, readiness |

## Data flow

```text
MenuCategory
  └── MenuProduct (categoryId; base price in halala)
        └── ProductOptionGroup ──> MenuOptionGroup
              └── ProductGroupOption ──> MenuOption
                    (nullable product-specific price/weight override)

working catalog ──validate/preview──> dashboard review
working catalog ──publish───────────> MenuVersion snapshot ──> one-time menu

published catalog IDs ──selected by MealBuilderConfig draft
MealBuilderConfig draft ──validate/publish──> subscription builder/planner catalog
planner premium selection ──replaces an existing meal slot; never adds a meal
```

## Ownership rules

- Category owns presentation/grouping; product owns `categoryId`.
- Product owns base price, channel availability, and whether customization is enabled.
- Global option group owns label/display style, not min/max selection rules.
- Product/group relation owns required/min/max/status/order.
- Global option owns content and default extra price.
- Product/group/option relation owns nullable per-product override and local status/order.
- Menu publish and Meal Builder publish are separate operations.
- Subscription upgrade counts/limits are runtime read models and are not dashboard-editable.

## Frontend implementation order

1. Implement auth/error wrapper and array-vs-pagination handling.
2. Build categories and products (11A/11B), always storing linked IDs.
3. Build global groups/options (11D/11E).
4. Build product composer from v4 read model and focused writes (11C).
5. Add menu validate, preview, publish, history, and guarded rollback (11F).
6. Add Meal Builder draft/pickers/validation/publish; label premiums as slot upgrades (11G).

## Shared response conventions

```json
{"status":true,"data":{}}
```

```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","message":"...","details":{}}}
```

- Create routes return 201; most reads/writes return 200.
- List routes return an array when neither `page` nor `limit` is supplied, and `{items,pagination}` when pagination is enabled.
- Mongo documents commonly expose both `id` and `_id`; frontend should use `id` and never send either on create/update.
- Money inputs are non-negative integer halala; `currency` is system-owned `SAR`.
- Localized values use `{ "ar": "...", "en": "..." }`.
- `isActive`, `isVisible`, and `isAvailable` are distinct.
- `publishedAt:null` means not in the published catalog; saving does not publish.

## Shared validation conventions

- IDs are Mongo ObjectIds; invalid IDs normally return 400, missing records 404.
- Keys are lower-case `snake_case`, unique in their model scope, and immutable after creation.
- Sort orders and price/weight values are integers >= 0.
- `availableFor` on menu items accepts `one_time`/`subscription`; Meal Builder accepts only `subscription`.
- Relationship writes send IDs only. Populated display objects and computed fields are read-only.
- Global disabled state can suppress a relation even when its local state is enabled.
- Menu publish should be preceded by `/menu/validate` because publish itself does not enforce validation. Meal Builder publish does enforce validation.

## Shared do/don't checklist

- Do use `{{baseUrl}}`, `{{dashboardToken}}`, and ID variables from the detailed Postman blocks.
- Do format halala for display locally and send integer halala back.
- Do refetch composer/preview after relationship changes.
- Do clearly distinguish archive, visibility, availability, draft, and publish.
- Do show validation warnings/errors verbatim enough for operators to fix them.
- Don't invent image-upload, hard-delete, whole-composer-save, draft-version, field-level-diff, or upgrade-limit-edit endpoints.
- Don't send `_id`, `id`, `__v`, timestamps, publish/version metadata, computed SAR labels, hydration, validation, usage counts, or populated relationships.
- Don't model premium upgrades as extra meal counts.
