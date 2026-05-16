# Meal Planner Canonical Contract

## Slot Types

Canonical `mealSlots[].selectionType` values:

- `standard_meal`
- `premium_meal`
- `sandwich`
- `premium_large_salad`

Legacy write aliases still normalized on input:

- `standard_combo` -> `standard_meal`
- `custom_premium_salad` -> `premium_large_salad`

## Canonical Request Shape

`PUT /api/subscriptions/:id/days/:date/selection`

`POST /api/subscriptions/:id/days/:date/selection/validate`

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "proteinId": "builder_protein_id",
      "carbs": [
        { "carbId": "builder_carb_id", "grams": 150 }
      ]
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "premium_large_salad",
      "proteinId": "optional_compatibility_only",
      "salad": {
        "presetKey": "large_salad",
        "groups": {
          "leafy_greens": ["ingredient_id"],
          "vegetables": ["ingredient_id"],
          "protein": ["builder_protein_id"],
          "cheese_nuts": ["ingredient_id"],
          "fruits": ["ingredient_id"],
          "sauce": ["ingredient_id"]
        }
      }
    }
  ],
  "addonsOneTime": ["addon_item_id"]
}
```

## Validation Rules

### `standard_meal`

- Requires exactly one regular `proteinId`
- Requires `carbs` with 1 or 2 entries
- Every carb must have a valid `carbId`
- `grams` must be a positive integer
- Total carb grams must be `<= 300`
- Duplicate carb IDs are rejected
- `sandwichId` and `salad` are rejected

### `premium_meal`

- Requires exactly one premium `proteinId`
- Uses the same carb rules as `standard_meal`
- `sandwichId` and `salad` are rejected
- Premium balance / pending payment behavior is unchanged

### `sandwich`

- Requires `sandwichId`
- Rejects `proteinId`, `carbs`, and `salad`

### `premium_large_salad`

- Treated as premium for entitlement / payment
- Rejects `carbs` and `sandwichId`
- Requires exactly one protein through `salad.groups.protein`
- Salad protein may be regular or premium
- Optional top-level `proteinId` is compatibility-only and must match `salad.groups.protein[0]`
- Rejects unknown salad group keys
- Enforces canonical group min/max dynamically
- Rejects duplicate ingredient IDs within a group
- Validates every ingredient against its submitted group
- Sauce is required through `salad.groups.sauce`
- Uses fixed premium salad pricing regardless of protein type

## Canonical Salad Groups

Stored `SaladIngredient.groupKey` values:

- `leafy_greens`
- `vegetables`
- `cheese_nuts`
- `fruits`
- `sauce`

Runtime `premium_large_salad` selection groups:

- `leafy_greens`
- `vegetables`
- `protein`
- `cheese_nuts`
- `fruits`
- `sauce`

`protein` is virtual for salad selection and is sourced from `BuilderProtein`, not `SaladIngredient`.

## Builder Catalog Contract

`GET /api/subscriptions/meal-planner-menu`

`data.builderCatalog` is the planner source of truth and contains:

- `categories`
- `proteins`
- `premiumProteins`
- `carbs`
- `sandwiches`
- `premiumLargeSalad`
- `rules`

Protein display groups are stable:

- `chicken`
- `beef`
- `fish`
- `eggs`
- `premium`
- `other`

`builderCatalog.premiumLargeSalad` includes:

- `id = "premium_large_salad"`
- `selectionType = "premium_large_salad"`
- `premiumKey = "custom_premium_salad"`
- `carbId` for the `large_salad` identity carb
- `presetKey = "large_salad"`
- `preset.groups` and top-level `groups`
- `ingredients`, including both salad ingredients and protein options

## Add-On Dry Run

`/selection/validate` accepts optional `addonsOneTime` and returns dry-run `addonSelections` plus payment state using the same rules as save:

- included entitlement remains free with `source = "subscription"`
- excess or non-entitled items remain `pending_payment`
- overage price uses `Addon.priceHalala`

## Migration / Seed Commands

Run these before using the canonical planner contract against existing data:

```bash
node scripts/migrate-builder-protein-groups.js
node scripts/migrate-salad-ingredient-groups.js
node scripts/seedBuilderCatalogData.js
node scripts/seedPremiumCatalog.js
```
