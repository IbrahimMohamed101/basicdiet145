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
npm run bootstrap:data -- --dry-run
```

## Safety

- Default mode creates missing catalog, subscription plan, addon, pickup, setting, and compatibility rows only.
- Sync mode requires `BOOTSTRAP_SYNC=true` and `--sync`; it may update existing bootstrap-owned catalog and plan rows.
- Account bootstrap is skipped unless `ALLOW_ACCOUNT_BOOTSTRAP=true`.
- Account sync requires `ACCOUNT_BOOTSTRAP_SYNC=true`; it updates default dashboard/mobile test account hashes and profile fields.
- Catalog reset requires `--reset` plus `ALLOW_CATALOG_RESET=true` and is refused in production.

## Modules

- `seed-catalog.js`: canonical `MenuCategory`, `MenuProduct`, `MenuOptionGroup`, `MenuOption`, `ProductOptionGroup`, `ProductGroupOption`, `MenuVersion`, `CatalogItem`, compatibility mirror models, subscription addon rows, and settings/pickup data.
- `seed-subscription-plans.js`: nested subscription `Plan` rows and guarded wrong-flat-plan cleanup in sync mode.
- `seed-default-accounts.js`: default `DashboardUser`, mobile core `User`, and `AppUser` rows when explicitly allowed.
- `fixtures/subscription-demo-data.js`: shared bootstrap fixture values for settings and pickup locations.

## Verified Contracts

The catalog seed smoke-checks:

- public one-time menu v2
- builderCatalogV2
- plannerCatalog v3

Dashboard one-time v3/product composer coverage lives in the dashboard menu contract tests. Root scripts such as `scripts/seed-catalog.js`, `scripts/seed-subscription-plans.js`, and `scripts/create_default_accounts.js` are compatibility wrappers.

## Rollback Notes

Create-missing-only mode should not require rollback because it does not overwrite existing rows. Sync mode changes bootstrap-owned rows; use database backups or targeted Mongo restores for rollback. Reset mode is local/test-only and intentionally blocked from production.
