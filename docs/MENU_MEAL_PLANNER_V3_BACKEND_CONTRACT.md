# Meal Planner v3 Backend Contract

Date: 2026-06-06
Audience: backend, dashboard, mobile

## Read Catalog

Endpoint:

```txt
GET /api/subscriptions/meal-planner-menu
GET /api/subscriptions/meal-planner-menu?contractVersion=v3
```

Response includes:

```json
{
  "status": true,
  "data": {
    "plannerCatalog": {
      "contractVersion": "meal_planner_menu.v3",
      "catalogHash": "sha256:...",
      "currency": "SAR",
      "sections": []
    },
    "builderCatalog": {},
    "builderCatalogV2": {},
    "addonCatalog": {}
  }
}
```

`plannerCatalog.sections[]` follows:

```txt
section -> products -> optionGroups -> options
```

`optionGroups` include relation-level `minSelections`, `maxSelections`, and `isRequired`.

`options` include relation-level prices:

- `extraPriceHalala`
- `extraFeeHalala`
- `extraWeightUnitGrams`
- `extraWeightPriceHalala`

## Legacy Read Compatibility

Endpoint:

```txt
GET /api/subscriptions/meal-planner-menu?includeLegacy=true
```

Adds legacy fields:

- `currency`
- `regularMeals`
- `premiumMeals`
- `addons`

Existing compatibility fields remain available in default responses:

- `builderCatalog`
- `builderCatalogV2`
- `addonCatalog`

## PremiumUpgradeConfig Deployment Rule

`PremiumUpgradeConfig` is the subscription planner premium-upgrade pricing authority once configured.

- If the `PremiumUpgradeConfig` collection is empty, the backend keeps the legacy fallback pricing/catalog behavior.
- Once any `PremiumUpgradeConfig` rows exist, configs become authoritative for new subscription planner premium upgrades.
- Production must avoid partial backfill. Backfill must create all known keys, or no keys, before relying on config-authoritative behavior.
- Known config keys are `beef_steak`, `shrimp`, `salmon`, and `premium_large_salad`.
- Hidden, disabled, or archived configs are hidden from the client planner and rejected for new submissions.
- Backfill creates missing config rows only; it does not rewrite historical records, paid premium selections, premium balances, subscription days, or orders.
- One-time order pricing does not use `PremiumUpgradeConfig`.
- Flutter does not need `PremiumUpgradeConfig` IDs or request changes.

## Canonical Save/Validate Payload

Use request-level contract version:

```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "productId": "MenuProduct id",
      "selectedOptions": [
        {
          "groupId": "MenuOptionGroup id",
          "groupKey": "proteins",
          "optionId": "MenuOption id",
          "optionKey": "grilled_chicken",
          "quantity": 1
        },
        {
          "groupId": "MenuOptionGroup id",
          "groupKey": "carbs",
          "optionId": "MenuOption id",
          "optionKey": "white_rice",
          "quantity": 1,
          "grams": 150
        }
      ]
    }
  ]
}
```

Supported endpoints:

```txt
POST /api/subscriptions/:id/days/:date/selection/validate
PUT  /api/subscriptions/:id/days/:date/selection
POST /api/subscriptions/:id/days/:date/confirm
```

Canonical shape is also detected when a slot includes both `productId` and `selectedOptions`.

## Validation Authority

For v3 writes, validation uses canonical catalog rows only:

- `MenuProduct`
- `ProductOptionGroup`
- `MenuOptionGroup`
- `ProductGroupOption`
- `MenuOption`

A globally active option is not enough. The option must be attached through the selected product/group relation.

## Persistence

v3 saved slots store:

- `contractVersion`
- `productId`
- `productKey`
- `selectedOptions[]`
- `pricingSnapshot`
- `displaySnapshot`
- `fulfillmentSnapshot`

For compatibility, v3 saved slots also project legacy operational fields where needed:

- `proteinId`
- `carbs`
- `sandwichId`
- `salad`
- premium fields

## Confirm Snapshot

Confirm revalidates v3 slots and writes `confirmationSnapshot` per slot.

Snapshot includes:

- product id/key/name/price/currency;
- selected option ids/keys/names;
- group ids/keys/names;
- quantity and grams;
- option unit/total prices;
- pricing totals.

## Error Envelope

Validation errors keep the existing API envelope style:

```json
{
  "ok": false,
  "error": {
    "code": "PLANNER_OPTION_RELATION_INACTIVE",
    "message": "option relation is inactive or unavailable",
    "details": {
      "slotErrors": [
        {
          "slotIndex": 1,
          "code": "PLANNER_OPTION_RELATION_INACTIVE",
          "field": "mealSlots[0].selectedOptions[1].optionId",
          "productId": "...",
          "groupId": "...",
          "optionId": "...",
          "hint": "Refresh planner catalog and retry."
        }
      ]
    }
  }
}
```

## Canonical Error Codes

- `PLANNER_PRODUCT_NOT_FOUND`
- `PLANNER_PRODUCT_INACTIVE`
- `PLANNER_PRODUCT_UNPUBLISHED`
- `PLANNER_PRODUCT_UNAVAILABLE`
- `PLANNER_PRODUCT_NOT_SUBSCRIPTION_ENABLED`
- `PLANNER_GROUP_NOT_FOUND`
- `PLANNER_GROUP_RELATION_NOT_FOUND`
- `PLANNER_GROUP_RELATION_INACTIVE`
- `PLANNER_OPTION_NOT_FOUND`
- `PLANNER_OPTION_INACTIVE`
- `PLANNER_OPTION_UNAVAILABLE`
- `PLANNER_OPTION_RELATION_NOT_FOUND`
- `PLANNER_OPTION_RELATION_INACTIVE`
- `PLANNER_OPTION_GROUP_MISMATCH`
- `PLANNER_MIN_SELECTION_NOT_MET`
- `PLANNER_MAX_SELECTION_EXCEEDED`
- `PLANNER_INVALID_QUANTITY`
- `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`

## Migration Notes

Legacy write payloads remain supported. New clients should use v3 `productId + selectedOptions`.

Incoming v3 slots must not mix legacy write fields such as `proteinId`, `carbs`, `sandwichId`, or `salad` with canonical `productId + selectedOptions`.

Stored v3 slots may include legacy projections generated by the backend for downstream compatibility.

Dashboard planner catalog management should prefer canonical menu/product/group/option relation APIs. Legacy builder admin endpoints remain compatibility surfaces until ownership is fully retired.
