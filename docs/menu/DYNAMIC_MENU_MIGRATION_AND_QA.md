# Dynamic Menu Migration And QA

## Dry-Run Migration

Use `scripts/migrations/link-catalog-items.js` to inspect possible links. The default mode is read-only and prints a JSON report with proposed catalog items, proposed `MenuProduct` links, proposed `MenuOption` links, old/new values, match reasons, confidence, manual-review cases, and rollback notes.

The script does not match by display name alone. It only uses stable keys and marks unclear cases as `manualReviewRequired`.

## Apply Mode

Apply mode exists for a future controlled operation only:

```bash
node scripts/migrations/link-catalog-items.js --apply --confirm-catalog-link-apply
```

It also requires `ALLOW_CATALOG_LINK_APPLY=true`. Production apply is refused unless an additional production-specific guard is supplied. Do not run apply mode during normal QA.

## Safety

Do not run commands that create default data, synchronize data, reset data, or overwrite catalog/menu state during this migration QA. Do not write to Production. Do not print or reuse API tokens, database connection strings, payment secrets, Cloudinary secrets, or JWTs.

The migration is additive: it links currently unlinked records only, does not delete records, does not change IDs, does not change prices, does not change names/images, does not change sort order, and does not disable any row.

## QA Checklist

- `CatalogItem.key` is backend-generated and immutable.
- `MenuProduct.catalogItemId` and `MenuOption.catalogItemId` are optional.
- Linked available catalog items remain visible and selectable.
- Linked unavailable or inactive catalog items are hidden from public menus and add-on choices.
- Quotes and subscription selections reject linked unavailable products/options.
- Unlinked legacy records continue to behave as before.
- Product and option local disable only hides that local usage.
- Global disable hides all linked new usages.
- Prices are unchanged after linking.
- Historical orders, subscriptions, day selections, payments, and kitchen records remain readable.
- `light_collection` is stored and returned unchanged by backend menu APIs.
