# Flutter Subscription Add-ons Changes

## Required Catalog Calls

Subscription creation uses subscription plans from `Addon`:

```text
GET /api/addons?type=subscription
```

This returns only plan rows for:

- `juice`
- `snack`
- `small_salad`

Daily add-on item selection uses one-time menu products from `MenuProduct`:

```text
GET /api/subscriptions/addon-choices
GET /api/subscriptions/addon-choices?category=juice
GET /api/subscriptions/addon-choices?category=snack
GET /api/subscriptions/addon-choices?category=small_salad
```

Daily choices are not `Addon` documents. They are active, visible, available, published `MenuProduct` rows from the one-time menu.

Subscription creation add-ons use `Addon` plan ids from `GET /api/addons?type=subscription`.
Daily add-on selections use `MenuProduct` ids from `GET /api/subscriptions/addon-choices`.

## Daily Choice Mapping

- `juice` entitlement choices come from one-time categories `juices` and `drinks`.
- `snack` entitlement choices come from one-time category `desserts`.
- `small_salad` entitlement choices come from `light_options`, currently limited to product keys `green_salad` and `fruit_salad` when present.

Flutter must use technical ids and keys from the response. Do not depend on Arabic or English names.

## Response Shape

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
          "priceHalala": 1100,
          "priceSar": 11,
          "currency": "SAR",
          "calories": 150,
          "prepTimeMinutes": null,
          "categoryKey": "juices",
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

## Submission Rules

- Checkout add-ons: submit subscription plan ids from `GET /api/addons?type=subscription`.
- Daily add-on choices: submit the selected `MenuProduct` id from `GET /api/subscriptions/addon-choices`.
- Do not submit `Addon` item ids for daily selections. Daily selected item ids must be `MenuProduct` ids from `GET /api/subscriptions/addon-choices`.
- If the customer already has the matching subscription entitlement, daily choice `priceHalala` must not be added to the payable total. Backend quote/payment remains the source of truth.
- `priceHalala` on a daily choice is display/reference pricing or overage pricing only when backend payment rules require it.
- Flutter must not calculate the final payable total locally.
- `calories` and `prepTimeMinutes` may be `null`. Flutter must handle null values gracefully and hide these labels when missing.
- Delivery is not an add-on.

## Migration Steps

1. Use `GET /api/addons?type=subscription` only for subscription creation.
2. Stop using `GET /api/addons?type=one_time` for subscription daily add-on choices.
3. Use `GET /api/subscriptions/addon-choices` in day-selection screens.
4. Filter visible groups by subscribed entitlement category.
5. Submit `MenuProduct` id/key for the selected daily item according to the day-planning contract.
