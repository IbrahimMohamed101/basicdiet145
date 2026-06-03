# Dashboard Subscription Add-ons Changes

## Subscription Creation

Subscription creation/edit screens use subscription plan rows from:

```text
GET /api/addons?type=subscription
```

Show only subscription plan categories:

- `juice`
- `snack`
- `small_salad`

Do not show daily products such as Classic Green, Berry Blast, Dark Brownies, or Berry Cheesecake as subscription plans. Delivery is not an add-on.

## Daily Choices

Daily selected add-on items come from `MenuProduct` through:

```text
GET /api/subscriptions/addon-choices
```

Mapping:

- `juice` choices: one-time categories `juices` and `drinks`.
- `snack` choices: one-time category `desserts`.
- `small_salad` choices: `light_options` product keys `green_salad` and `fruit_salad` when present.

If a small salad product is not available in the published one-time menu, show the entitlement without choices and ask for business mapping/product setup.

Do not treat `Addon` item ids as daily selected items. Daily selected item ids are `MenuProduct` ids from `GET /api/subscriptions/addon-choices`.
`calories` and `prepTimeMinutes` may be `null`. Dashboard/Kitchen must handle null values gracefully and hide these labels when missing.

## Kitchen / Day Detail

Kitchen/day detail must show add-on entitlement even when no daily item is selected, including when `selectedItem` is `null`.
Prefer backend-provided `addonEntitlements` when available. If the dashboard derives status locally, it must follow the same backend contract.

Example:

```json
{
  "addonEntitlements": {
    "juice": {
      "subscribed": true,
      "selectedItem": null,
      "status": "pending_selection"
    },
    "snack": {
      "subscribed": true,
      "selectedItem": {
        "id": "menu_product_id",
        "name": "Dark Brownies"
      },
      "status": "selected"
    },
    "small_salad": {
      "subscribed": false,
      "selectedItem": null,
      "status": "not_subscribed"
    }
  }
}
```

Derived dashboard status:

- `selected` when a daily item exists for the entitlement category.
- `pending_selection` when subscribed but no daily item is selected.
- `not_subscribed` when there is no entitlement for the category.

Use technical ids, keys, and category codes. Do not depend on Arabic or English names.

Contract summary:

- Subscription plan rows come from `GET /api/addons?type=subscription`.
- Daily products come from `GET /api/subscriptions/addon-choices`.
- Daily selected item ids are `MenuProduct` ids, not `Addon` item ids.
- Delivery is not an add-on.
- Kitchen/day detail must show entitlement even if `selectedItem` is `null`.
