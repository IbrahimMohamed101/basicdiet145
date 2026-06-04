# Canonical CatalogItem Architecture

## Overview

`CatalogItem` represents the real menu item identity and global availability state. `MenuProduct` remains the way an item is sold as a standalone product, and `MenuOption` remains the way an item is selected inside a builder. `ProductGroupOption` keeps product-specific allowance and extra pricing.

## Ownership

- `CatalogItem`: key, localized name/description, image, item kind, nutrition, `isActive`, and `isAvailable`.
- `MenuProduct`: category placement, standalone price, pricing model, builder behavior, local visibility, and product UI metadata.
- `MenuOption`: option group placement, option-level extra prices/fees, local visibility, subscription flags, protein/carb metadata, and option identity metadata.
- `ProductGroupOption`: whether a `MenuOption` is allowed inside a specific `MenuProduct`, relation availability, sort order, and product-specific extra price overrides.

`CatalogItem` never owns prices, category placement, builder rules, subscription rules, or product-specific relation pricing.

## Availability

Effective availability is local availability plus global catalog availability:

- A linked `MenuProduct` is customer-available only when its `CatalogItem` is active and available, and the product/category/version/channel checks already pass.
- A linked `MenuOption` is customer-available only when its `CatalogItem` is active and available, and the option/group/relation/product/channel checks already pass.
- Records without `catalogItemId` use the legacy behavior unchanged.

Local disable still affects only one usage. Global disable hides all linked new usages without deleting or mutating historical order/subscription snapshots.

## Compatibility

Legacy compatibility models such as builder proteins, carbs, salad ingredients, and sandwiches are not deleted and do not become the source of truth. Current compatibility rows without a safe catalog link keep legacy behavior. New canonical menu paths should prefer `MenuProduct` and `MenuOption` links to `CatalogItem`.

## Historical Data

Disabling a `CatalogItem` blocks new menu display, quote, add-on, and subscription selection usage. It must not break reading old orders, subscriptions, day selections, payments, or kitchen history because those flows read persisted snapshots and historical records.
