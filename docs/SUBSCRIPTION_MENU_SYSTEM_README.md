# Subscription Menu / Meal Planner Backend README

Status: READY FOR DASHBOARD/FLUTTER CONTRACT REVIEW

This document is the backend reference for the subscription menu and meal planner contract. It is not a production-launch certificate; production readiness still depends on deployment environment, secrets rotation, and real payment-provider staging verification.

## Scope

- Subscription planner catalog read: `GET /api/subscriptions/meal-planner-menu`
- Daily add-on choices read: `GET /api/subscriptions/addon-choices`
- Day read/save/validate/confirm under `GET|PUT|POST /api/subscriptions/:id/days/:date/...`
- Unified day payment:
  - `POST /api/subscriptions/:id/days/:date/payments`
  - `POST /api/subscriptions/:id/days/:date/payments/:paymentId/verify`
- Dashboard readiness check: `GET /api/dashboard/health/meal-planner`

## Route Alias Policy

Keep current public routes and aliases. Do not remove legacy subscription day routes or dashboard menu aliases while Flutter/Dashboard contracts are being reviewed.

Canonical Dashboard readiness route:

```http
GET /api/dashboard/health/meal-planner
```

Canonical Flutter planner catalog routes:

```http
GET /api/subscriptions/meal-planner-menu
GET /api/subscriptions/addon-choices
```

## Addon vs Daily Extras

- `addon-choices` are daily add-ons backed by active, visible, available, published `MenuProduct` rows in mapped menu categories.
- Planner day payment uses `ADDON_PAYMENT_REQUIRED` for unpaid daily add-ons.
- Do not use `ONE_TIME_ADDON_PAYMENT_REQUIRED` for the day planner payment CTA. That legacy wording can still exist in older one-time add-on paths, but it is not the v3 planner CTA contract.

## Premium Large Salad v3

The backend enforces the subscription premium large salad protein allowlist even when Dashboard relations expose extra options.

Required behavior:

- Allowed subscription salad proteins are accepted.
- Disallowed regular proteins are rejected even if a `ProductGroupOption` relation exists.
- Premium proteins outside the salad allowlist are rejected.
- `extra_protein_50g` is rejected for subscription premium large salad.
- Legacy premium large salad validation is not weakened.

Stable rejection codes:

- `SALAD_PROTEIN_NOT_ALLOWED`
- `PLANNER_OPTION_GROUP_UNAVAILABLE` for `extra_protein_50g`

## Unified Day Payment Response

Create and verify responses consistently expose safe contract fields:

```json
{
  "paymentId": "payment object id",
  "payment_id": "payment object id",
  "status": "initiated|paid|...",
  "requiresPayment": true,
  "premiumAmountHalala": 3000,
  "addonsAmountHalala": 1000,
  "totalHalala": 4000,
  "plannerRevisionHash": "sha256",
  "paymentUrl": "https://provider-checkout",
  "payment_url": "https://provider-checkout"
}
```

Additional day/payment state fields already returned by the backend remain available, including `paymentRequirement`, `commercialState`, `premiumSummary`, `premiumExtraPayment`, `addonSelections`, `providerInvoice`, and `payment`.

Important variants covered by tests:

- premium-only amount
- add-on-only amount
- combined premium plus add-on amount
- no-payment-required state
- reusable initiated payment
- revision hash mismatch with `DAY_PAYMENT_REVISION_MISMATCH`
- provider/config failure without secret values in response fields

## Dashboard Readiness Endpoint

`GET /api/dashboard/health/meal-planner` returns:

```json
{
  "status": "ok|warning|error",
  "ready": true,
  "errors": [],
  "warnings": [],
  "checks": [],
  "summary": {}
}
```

It validates required planner products, keys, option groups, product-group relations, product-option relations, active/visible/available/published state, linked `CatalogItem` availability, premium large salad allowlist safety, `extra_protein_50g` exclusion, daily add-on mapped products, and standard/premium protein exposure warnings.

## Stale Catalog Refresh Matrix

Flutter should refresh the planner catalog and retry when it receives stale catalog errors with the refresh hint.

Stable backend codes include:

- `PLANNER_PRODUCT_NOT_FOUND`
- `PLANNER_PRODUCT_INACTIVE`
- `PLANNER_PRODUCT_UNPUBLISHED`
- `PLANNER_PRODUCT_UNAVAILABLE`
- `PLANNER_OPTION_GROUP_NOT_FOUND`
- `PLANNER_OPTION_GROUP_UNAVAILABLE`
- `PLANNER_OPTION_GROUP_RELATION_NOT_FOUND`
- `PLANNER_OPTION_GROUP_RELATION_UNAVAILABLE`
- `PLANNER_OPTION_NOT_FOUND`
- `PLANNER_OPTION_UNAVAILABLE`
- `PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND`
- `PLANNER_PRODUCT_OPTION_RELATION_UNAVAILABLE`
- `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`
- `LEGACY_DAY_SELECTION_UNSUPPORTED`
- `DAY_PAYMENT_REVISION_MISMATCH`

## E2E Validation

The backend now has a focused dashboard-to-Flutter integration test covering Dashboard readiness, Flutter menu reads, daily add-on reads, pure v3 save, unified payment create, payment verify, confirmation, and final day read.

Needs backend contract hardening: none currently blocking Dashboard/Flutter contract review. Production checks remain separate.

## Dashboard Meal Builder Canonical Flow

The backend canonical source for subscription meal planning is now Dashboard Meal Builder draft/published config compiled into `plannerCatalog v3`.

New Dashboard endpoints:

- `GET /api/dashboard/meal-builder`
- `GET /api/dashboard/meal-builder/draft/hydrated`
- `GET /api/dashboard/meal-builder/pickers/:sectionKey`
- `POST /api/dashboard/meal-builder/draft`
- `PUT /api/dashboard/meal-builder/draft`
- `POST /api/dashboard/meal-builder/validate`
- `POST /api/dashboard/meal-builder/publish`
- `GET /api/dashboard/meal-builder/readiness`

Flutter endpoint:

- `GET /api/subscriptions/meal-planner-menu?lang=ar`

Flutter consumes `plannerCatalog.contractVersion=meal_planner_menu.v3`. When a published builder exists, `/api/subscriptions/meal-planner-menu` compiles it into `plannerCatalog.sections[].products[].optionGroups[].options[]`. `builderCatalog` and `builderCatalogV2` are read-only compatibility fields and are not the source for new Dashboard or Flutter work.

When Dashboard creates a draft without explicit sections, the backend initializes the default visual family template in this order:

- `premium`
- `sandwich`
- `chicken`
- `beef`
- `fish`
- `eggs`
- `carbs`

Meal Builder sections reference existing catalog rows only:

- `option_group` references a `MenuProduct` context, `MenuOptionGroup`, and optional selected `MenuOption` ids.
- `product_category` references a `MenuCategory` and can include all or selected products.
- `product_list` references selected `MenuProduct` ids.

The public Dashboard section shape also exposes canonical authoring metadata:

- `premium`: `type=mixed`, `source.kind=premium_mixed`, `sortOrder=10`
- `sandwich`: `type=product_list`, `source.kind=product_category`, `source.categoryKey=sandwich`, `sortOrder=20`
- `chicken`, `beef`, `fish`, `eggs`: `type=option_family`, `source.kind=option_family`, `source.groupKey=proteins`
- `carbs`: `type=option_group`, `source.kind=option_group`, `source.groupKey=carbs`, max 2 types and 300 grams

Dashboard Meal Builder item selection must use `GET /api/dashboard/meal-builder/pickers/:sectionKey`. Global Dashboard menu endpoints such as `/api/dashboard/menu/options` and `/api/dashboard/menu/products` are catalog-management APIs, not Meal Builder pickers.

Premium upgrade behavior remains backend-owned. Premium proteins and premium large salad expose display metadata in the builder response, but day planning still uses canonical v3 validation, `premiumBalance`, `premiumSource`, `premiumExtraFeeHalala`, `paymentRequirement`, `plannerRevisionHash`, and unified day payment create/verify. The builder cannot make premium proteins or premium large salad free.

Builder publish/readiness validation checks active/visible/available/published state, subscription channel eligibility, linked `CatalogItem` availability, product-option relations, premium protein split rules, premium large salad allowed proteins, and `extra_protein_50g` exclusion.

When a published builder exists, day selection validation also rejects stale selections not included in that published layout with refreshable errors:

- `PLANNER_BUILDER_PRODUCT_NOT_INCLUDED`
- `PLANNER_BUILDER_GROUP_NOT_INCLUDED`
- `PLANNER_BUILDER_OPTION_NOT_INCLUDED`

Focused tests:

```bash
NODE_ENV=test node tests/dashboardMealBuilderComposer.test.js
NODE_ENV=test node tests/subscriptionMealBuilderContract.test.js
NODE_ENV=test node tests/subscriptionMealBuilderValidation.test.js
```

## Meal Builder Seed / Bootstrap

Initial Dashboard Meal Builder data is opt-in during bootstrap:

```bash
MEAL_BUILDER_BOOTSTRAP=true npm run bootstrap:data -- --dry-run
NODE_ENV=test MEAL_BUILDER_BOOTSTRAP=true MEAL_BUILDER_BOOTSTRAP_SYNC=true BOOTSTRAP_SYNC=true npm run bootstrap:data -- --sync
```

The seed runs after catalog and plan bootstrap and creates a current draft plus current published `MealBuilderConfig` only when missing. Sync updates only bootstrap-owned configs marked with `source: "bootstrap"`, `createdBySystem: true`, and `bootstrapKey: "initial_subscription_meal_builder"`.

Default seeded sections are standard proteins, carbs, premium proteins, cold sandwiches, and premium large salad when the catalog supports them. Premium proteins and premium large salad remain display-only premium upgrades; canonical v3 validation and unified day payment still own premium balance, fees, and payment requirements. Missing optional premium large salad data produces a warning, while disallowed salad proteins or `extra_protein_50g` prevent publishing an unsafe seed.
