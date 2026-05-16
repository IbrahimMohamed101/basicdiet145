> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Weekly Custom Menu Dashboard Support Audit

This document audits the current support for weekly menu changes in the dashboard/backend, focusing on the four custom menu items and fixed products.

## Audit Answers

1.  **Can dashboard edit the 4 custom products?**
    *   Yes. `PATCH /api/dashboard/menu/products/:id` allows updating all product fields including `itemType` (basic_salad, basic_meal, fruit_salad, greek_yogurt).
2.  **Can dashboard add/remove/disable options per product?**
    *   Yes. `PUT /api/dashboard/menu/products/:productId/groups/:groupId/options` allows replacing the set of options available for a specific product group relation.
    *   `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId/availability` allows toggling availability of a specific option for a specific product.
3.  **Can dashboard edit maxSelections per group?**
    *   Yes. `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/selection-rules` allows updating `minSelections`, `maxSelections`, and `isRequired`.
4.  **Can dashboard edit option extraPriceHalala per product?**
    *   Yes. `PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId/options/:optionId` allows overriding `extraPriceHalala`.
5.  **Can dashboard edit extraWeightUnitGrams and extraWeightPriceHalala?**
    *   `extraWeightPriceHalala` can be overridden per product.
    *   **GAP**: `extraWeightUnitGrams` is currently only on the global `MenuOption` model and cannot be overridden per product in the `ProductGroupOption` relation.
6.  **Can dashboard toggle availability without deleting?**
    *   Yes. All entities (Category, Product, Group, Option, and Relations) have `isActive`, `isVisible`, and `isAvailable` flags with dedicated PATCH endpoints.
7.  **Can dashboard manage fixed products separately?**
    *   Yes. Fixed products are simply `MenuProduct` entries with `pricingModel: "fixed"` and (usually) no option groups linked.
8.  **Can dashboard publish menu changes safely?**
    *   Yes. `POST /api/dashboard/menu/publish` creates a new `MenuVersion`, snapshots the current state, and updates the `publishedAt` timestamps.
9.  **Are audit logs recorded?**
    *   Yes. `MenuAuditLog` captures create, update, delete, reorder, and publish actions.
10. **What exact API gaps remain?**
    *   `extraWeightUnitGrams` override in `ProductGroupOption`.
    *   Validation endpoint `POST /api/dashboard/menu/validate` is missing.

## Recommendations

1.  **Enhance Overrides**: Add `extraWeightUnitGrams` to `ProductGroupOption` model and update `menuCatalogService.js` to handle its override logic.
2.  **Implement Validation**: Create a robust validation endpoint that checks for all consistency rules (required groups, minimum options, valid prices, etc.) before publishing.
3.  **Refine Dashboard Controller**: Add the validation endpoint and ensure all override fields are correctly handled in the payload normalization logic.
