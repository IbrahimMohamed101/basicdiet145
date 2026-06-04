# Flutter Subscription Add-ons Contract

Status: FINAL. The `mealSlots + addonsOneTime` save/read-back flow has been verified with a DB-backed integration test, including day detail, kitchen output, clear-selection behavior, and entitlement pricing.

## Subscription Checkout Plans

Fetch subscription add-on entitlement plans from:

```text
GET /api/addons?type=subscription
```

Use only the returned `Addon` plan `id` values during subscription quote/checkout:

```json
{
  "planId": "plan_id",
  "addons": ["addon_plan_id"]
}
```

The subscription plan catalog is filtered to active plan rows for `juice`, `snack`, and `small_salad`. Delivery is not an add-on.

## Daily Choice Catalog

Fetch daily selectable products from:

```text
GET /api/subscriptions/addon-choices
GET /api/subscriptions/addon-choices?category=juice
GET /api/subscriptions/addon-choices?category=snack
GET /api/subscriptions/addon-choices?category=small_salad
```

Daily choices are active, visible, available, published one-time `MenuProduct` rows. They are not `Addon` documents.

Mapping:

- `juice`: one-time categories `juices` and `drinks`
- `snack`: one-time category `desserts`
- `small_salad`: one-time category `light_options`, limited to product keys `green_salad` and `fruit_salad`

Use technical `id`, `key`, and category fields. Do not depend on Arabic or English names.

## Daily Choice Response

```json
{
  "status": true,
  "data": {
    "juice": {
      "category": "juice",
      "sourceCategories": ["juices", "drinks"],
      "choices": [
        {
          "id": "menu_product_id",
          "key": "berry_blast",
          "name": "Berry Blast",
          "nameAr": "بيري بلاست",
          "nameI18n": { "ar": "بيري بلاست", "en": "Berry Blast" },
          "priceHalala": 1100,
          "priceSar": 11,
          "currency": "SAR",
          "calories": 150,
          "prepTimeMinutes": null,
          "categoryKey": "juices",
          "itemType": "juice",
          "type": "menu_product",
          "available": true,
          "active": true,
          "ui": {}
        }
      ]
    }
  }
}
```

`calories` and `prepTimeMinutes` may be `null`; hide those labels when missing.

## Validate And Save Daily Selection

Daily add-on selection is part of the canonical day planner payload.

Validate without saving:

```text
POST /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}/selection/validate
```

Save:

```text
PUT /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}/selection
```

Submit `MenuProduct` IDs from `GET /api/subscriptions/addon-choices` in `addonsOneTime`. Each `addonsOneTime` element is a string `MenuProduct` ID; no category field is required in the request body. The legacy alias `oneTimeAddonSelections` is also accepted.

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

Clear daily selections by saving the same day planner payload with:

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

Preserve the current `mealSlots` when clearing only the add-on item.

## Validation Rules

- A daily selected add-on value must be a valid allowed `MenuProduct` ID.
- Do not submit `Addon` plan or item IDs for daily choices.
- The selected product category must match a subscription entitlement.
- A subscription without the matching entitlement is rejected with API error code `ADDON_ENTITLEMENT_REQUIRED`.
- Unknown, inactive, unpublished, unavailable, hidden, or disallowed products are rejected by the API with error code `INVALID`.
- An `Addon` plan ID submitted in `addonsOneTime` is rejected by the API with error code `INVALID`.
- Invalid category filters on the choice catalog return `400 INVALID`.
- Locked, confirmed, out-of-range, or inactive subscription days return the existing day-planner error codes.

## Day Detail Response

Read day detail from:

```text
GET /api/subscriptions/{subscriptionId}/days/{yyyy-mm-dd}
```

Dashboard/Kitchen reads the same entitlement state from:

```text
GET /api/kitchen/days/{yyyy-mm-dd}
```

Relevant fields:

```json
{
  "status": true,
  "data": {
    "addonSelections": [
      {
        "addonId": "menu_product_id",
        "name": "Berry Blast",
        "category": "juice",
        "source": "subscription",
        "priceHalala": 0,
        "currency": "SAR"
      }
    ],
    "addonEntitlements": {
      "juice": {
        "category": "juice",
        "subscribed": true,
        "addonPlanId": "addon_plan_id",
        "name": "Daily Juice",
        "maxPerDay": 1,
        "selectedItem": {
          "id": "menu_product_id",
          "menuProductId": "menu_product_id",
          "name": "Berry Blast",
          "category": "juice",
          "source": "subscription",
          "priceHalala": 0,
          "currency": "SAR"
        },
        "status": "selected"
      },
      "snack": {
        "category": "snack",
        "subscribed": false,
        "addonPlanId": null,
        "selectedItem": null,
        "status": "not_subscribed"
      },
      "small_salad": {
        "category": "small_salad",
        "subscribed": true,
        "selectedItem": null,
        "status": "pending_selection"
      }
    }
  }
}
```

Status meanings:

- `selected`: subscribed and a daily product is selected.
- `pending_selection`: subscribed but no daily product is selected.
- `not_subscribed`: no entitlement for the category.

## Payment Rules

Flutter must not calculate the final payable total locally. Backend quote/payment endpoints are the source of truth.

If a daily choice is covered by entitlement, the saved selection has `source: "subscription"` and `priceHalala: 0`, so it is not charged twice. Pending overage/additional payments are represented by backend payment fields such as `paymentRequirement` and `addonSummary`.
