# Dashboard Subscription Add-ons Contract

Status: FINAL. The `mealSlots + addonsOneTime` save/read-back flow has been verified with a DB-backed integration test, including day detail, kitchen output, clear-selection behavior, and entitlement pricing.

## Subscription Plans

Subscription creation/edit screens fetch entitlement plan rows from:

```text
GET /api/addons?type=subscription
```

Show only returned `Addon` plan rows for:

- `juice`
- `snack`
- `small_salad`

Do not show daily products such as juices, desserts, or light-option salads as subscription plans. Delivery is not an add-on.

## Daily MenuProduct Choices

Daily selected add-on items come from one-time `MenuProduct` rows:

```text
GET /api/subscriptions/addon-choices
GET /api/subscriptions/addon-choices?category=juice
GET /api/subscriptions/addon-choices?category=snack
GET /api/subscriptions/addon-choices?category=small_salad
```

Mapping:

- `juice`: one-time categories `juices` and `drinks`
- `snack`: one-time category `desserts`
- `small_salad`: one-time category `light_options`, limited to product keys `green_salad` and `fruit_salad`

Daily selected item IDs are `MenuProduct` IDs. Do not use `Addon` plan or item IDs for daily selections.

## Day Detail And Kitchen Fields

Client day detail:

```text
GET /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}
```

Kitchen list responses also expose the same `addonEntitlements` read model.

```json
{
  "addonEntitlements": {
    "juice": {
      "category": "juice",
      "subscribed": true,
      "addonPlanId": "addon_plan_id",
      "name": "Daily Juice",
      "maxPerDay": 1,
      "selectedItem": null,
      "status": "pending_selection"
    },
    "snack": {
      "category": "snack",
      "subscribed": true,
      "addonPlanId": "addon_plan_id",
      "name": "Daily Snack",
      "maxPerDay": 1,
      "selectedItem": {
        "id": "menu_product_id",
        "menuProductId": "menu_product_id",
        "name": "Dark Brownies",
        "category": "snack",
        "source": "subscription",
        "priceHalala": 0,
        "currency": "SAR"
      },
      "status": "selected"
    },
    "small_salad": {
      "category": "small_salad",
      "subscribed": false,
      "addonPlanId": null,
      "name": "",
      "maxPerDay": 0,
      "selectedItem": null,
      "status": "not_subscribed"
    }
  }
}
```

Display states:

- `selected`: show the selected daily `MenuProduct`.
- `pending_selection`: show the entitlement/category as subscribed, but no product selected yet.
- `not_subscribed`: show no active entitlement for that category.

Kitchen must show an entitlement even when `selectedItem` is `null`. Do not hide a subscribed category just because no daily product was selected.

## Save/Clear Contract

Daily selections are saved through the canonical day planner:

```text
POST /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}/selection/validate
PUT /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}/selection
```

Request body:

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "proteinId": "protein_id",
      "carbs": [{ "carbId": "carb_id", "grams": 150 }]
    }
  ],
  "addonsOneTime": ["menu_product_id"]
}
```

Each `addonsOneTime` element is a string `MenuProduct` ID. No category field is required in the save request.

Clear selected daily add-ons with `addonsOneTime: []` while preserving the entitlement. Keep existing `mealSlots` when clearing only the add-on item.

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "proteinId": "protein_id",
      "carbs": [{ "carbId": "carb_id", "grams": 150 }]
    }
  ],
  "addonsOneTime": []
}
```

Error codes:

- Missing matching entitlement: `ADDON_ENTITLEMENT_REQUIRED`
- Addon plan ID submitted as a daily product: `INVALID`
- Unknown, inactive, unpublished, unavailable, hidden, or disallowed product: `INVALID`

## Pricing Display

Dashboard must not recalculate payable totals locally. Use backend quote/payment/read fields.

Entitled daily choices are saved with `source: "subscription"` and `priceHalala: 0`, so they are not charged twice. Pending additional charges are represented by backend commercial/payment fields.

Use technical IDs, keys, and categories. Do not depend on Arabic or English names. `calories` and `prepTimeMinutes` may be `null`; hide those labels when missing.
