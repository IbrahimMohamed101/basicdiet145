# Data Bootstrap

Active bootstrap entry point:

```sh
npm run bootstrap:data
```

This runs create-missing-only data bootstrap by default. It preserves existing rows unless a focused sync flag is provided.

## Commands

```sh
npm run bootstrap:data
BOOTSTRAP_SYNC=true npm run bootstrap:data -- --sync
ALLOW_ACCOUNT_BOOTSTRAP=true npm run bootstrap:data
ALLOW_ACCOUNT_BOOTSTRAP=true ACCOUNT_BOOTSTRAP_SYNC=true npm run bootstrap:data
MEAL_BUILDER_BOOTSTRAP=true npm run bootstrap:data -- --dry-run
NODE_ENV=test MEAL_BUILDER_BOOTSTRAP=true MEAL_BUILDER_BOOTSTRAP_SYNC=true BOOTSTRAP_SYNC=true npm run bootstrap:data -- --sync
npm run bootstrap:data -- --dry-run
```

## Safety

- Default mode creates missing catalog, subscription plan, addon, pickup, setting, and compatibility rows only.
- Sync mode requires `BOOTSTRAP_SYNC=true` and `--sync`; it may update existing bootstrap-owned catalog and plan rows.
- Meal Builder bootstrap is skipped unless `MEAL_BUILDER_BOOTSTRAP=true`.
- Meal Builder sync requires `MEAL_BUILDER_BOOTSTRAP_SYNC=true` plus `--sync`; it updates only configs with `source=bootstrap`, `createdBySystem=true`, and `bootstrapKey=initial_subscription_meal_builder`.
- Account bootstrap is skipped unless `ALLOW_ACCOUNT_BOOTSTRAP=true`.
- Account sync requires `ACCOUNT_BOOTSTRAP_SYNC=true`; it updates default dashboard/mobile test account hashes and profile fields.
- Catalog reset requires `--reset` plus `ALLOW_CATALOG_RESET=true` and is refused in production.

## Modules

- `seed-catalog.js`: canonical `MenuCategory`, `MenuProduct`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, `MenuVersion`, `CatalogItem`, compatibility mirror models, subscription addon rows, and settings/pickup data.
- `seed-subscription-plans.js`: nested subscription `Plan` rows and guarded wrong-flat-plan cleanup in sync mode.
- `seed-meal-builder.js`: opt-in initial `MealBuilderConfig` draft/published layout generated from existing catalog products, option groups, options, categories, and product relations.
- `seed-default-accounts.js`: default `DashboardUser`, mobile core `User`, and `AppUser` rows when explicitly allowed.
- `fixtures/subscription-demo-data.js`: shared bootstrap fixture values for settings and pickup locations.

## Meal Builder Seed / Bootstrap

The Meal Builder seed runs after catalog and subscription plans. It creates a current draft and current published `subscription_meal_builder.v1` config only when missing. By default it never overwrites existing Dashboard-authored drafts or published layouts.

Seeded sections:

- Standard meal proteins from `basic_meal` + `proteins`, excluding premium proteins.
- Standard meal carbs from `basic_meal` + `carbs`, preserving existing carb validation.
- Premium proteins from `basic_meal` + `proteins`, only when premium keys have positive relation/default pricing.
- Sandwiches from selected active subscription `cold_sandwiches` products.
- Premium large salad from `premium_large_salad` when the product, pricing, and relations are valid.

Premium protections:

- Premium proteins stay `selectionType=premium_meal` and continue to use canonical premium balance/payment logic.
- Premium large salad stays `selectionType=premium_large_salad`; pricing comes from `premiumLargeSaladPricingService`.
- Catalog bootstrap creates the eligible sources for `beef_steak`, `shrimp`, `salmon`, and `premium_large_salad`, but deliberately does not create `PremiumUpgradeConfig` rows. An empty config collection therefore keeps legacy fallback active; use the explicit backfill workflow when all known keys can be migrated together.
- Disallowed salad proteins and `extra_protein_50g` make the seed fail instead of publishing an unsafe builder.
- Missing optional premium large salad data logs a warning and still allows the standard builder sections to seed.

## Verified Contracts

The catalog seed smoke-checks:

- public one-time menu v2
- builderCatalogV2
- plannerCatalog v3

Dashboard one-time v3/product composer coverage lives in the dashboard menu contract tests. Root scripts such as `scripts/seed-catalog.js`, `scripts/seed-subscription-plans.js`, and `scripts/create_default_accounts.js` are compatibility wrappers.

## Rollback Notes

Create-missing-only mode should not require rollback because it does not overwrite existing rows. Sync mode changes bootstrap-owned rows; use database backups or targeted Mongo restores for rollback. Reset mode is local/test-only and intentionally blocked from production.
