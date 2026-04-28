# Frontend Subscription Add-Ons Integration

## 1. Overview

Subscription add-ons now exist in two separate frontend contexts:

- Checkout / subscription creation shows only add-on plans.
- Meal planner shows only selectable add-on items after the user has subscribed to the matching add-on category.

This split is intentional:

- Checkout is for purchasing recurring add-on categories.
- Meal planner is for choosing actual daily products inside those categories.

## 2. Backend Data Model Summary

The frontend will receive add-ons from the existing `Addon` model in a catalog-friendly shape.

Relevant fields:

- `id`
- `name`
- `description`
- `imageUrl`
- `currency`
- `priceHalala`
- `priceSar`
- `priceLabel`
- `kind`
- `category`
- `type`
- `billingMode`
- `pricingModel`
- `billingUnit`
- `ui`

Important meanings:

- `kind: "plan"` means purchasable subscription add-on during checkout.
- `kind: "item"` means selectable daily add-on item in meal planner.
- `category` is the link between plans and items:
  - `juice`
  - `snack`
  - `small_salad`
- `billingMode`:
  - `per_day` for checkout plans
  - `flat_once` for meal-planner items

## 3. Checkout Integration

Endpoint:

- `GET /api/subscriptions/menu`

Behavior:

- This endpoint now returns only active add-ons where:
  - `kind = "plan"`
  - `billingMode = "per_day"`
- Frontend should show only these add-ons during checkout:
  - `Juice Subscription`
  - `Snack Subscription`
  - `Small Salad Subscription`
- Do not show `kind: "item"` add-ons in checkout.
- User selection should send selected plan add-on IDs into the existing quote / checkout flow.

Pricing:

- `plan.priceHalala` is the daily add-on plan price.
- Backend calculates total as:
  - `plan.priceHalala * subscriptionDurationDays`
- Frontend may display:
  - daily price
  - estimated total
- Backend quote remains the source of truth.

Example checkout add-on response shape:

```json
{
  "id": "681000000000000000000001",
  "name": "Juice Subscription",
  "description": "A daily add-on plan for the juice category.",
  "imageUrl": "",
  "currency": "SAR",
  "priceHalala": 1100,
  "priceSar": 11,
  "priceLabel": "11 SAR / day",
  "kind": "plan",
  "category": "juice",
  "type": "subscription",
  "billingMode": "per_day",
  "pricingModel": "daily_recurring",
  "billingUnit": "day",
  "ui": {
    "title": "Juice Subscription",
    "subtitle": "A daily add-on plan for the juice category.",
    "ctaLabel": "Add",
    "badge": "Subscription add-on"
  }
}
```

## 4. Meal Planner Integration

Endpoint:

- `GET /api/subscriptions/meal-planner-menu`

Behavior:

- This endpoint now returns only active add-ons where:
  - `kind = "item"`
  - `billingMode = "flat_once"`
- It must not show checkout plan add-ons.
- Items are selectable only if the current subscription has a matching entitlement in `subscription.addonSubscriptions`.
- Linkage is by `category`, not `parentId`.

Frontend grouping:

- Group planner items by `category`.
- Use categories:
  - `juice`
  - `snack`
  - `small_salad`
- Show a category section only if the current subscription has entitlement for that category.

Example:

If the user bought `Juice Subscription`, show only juice items such as:

- `Berry Blast`
- `Berry Brute`
- `Classic Green`
- `Beet Punch`
- `Orange Carrot`
- `Watermelon Mint`
- `Protein Drink`
- `Diet Iced Tea`
- `Diet Soda`
- `Water`

## 5. Important Pricing Behavior

- Checkout price uses `plan.priceHalala`.
- Meal planner item price uses `item.priceHalala`.
- These prices are intentionally separate.
- Covered item selections can be returned / treated as `0` by backend entitlement logic.
- Overage or additional selections in the same category use the item's own `priceHalala`.
- Do not use item prices to calculate the initial checkout total.
- Do not use plan prices to price individual meal planner items.

## 6. Expected UX Behavior

Checkout screen:

- Show only 3 add-on subscription choices.
- Each choice displays price per day.
- Optionally display estimated total:
  - `price per day x selected subscription days`

Meal planner screen:

- Show actual selectable products only.
- Hide categories the user did not subscribe to.
- Show item `priceLabel` from backend.
- Do not allow selection of items from unavailable categories.

## 7. Validation and Error Handling

Backend protections:

- Checkout rejects direct purchase of `kind="item"`.
- Checkout accepts `kind="plan"` only.
- Meal planner rejects `kind="plan"` selection.
- Meal planner rejects item categories when the user has no entitlement.

Frontend guidance:

- Surface backend validation messages directly when possible.
- Treat backend as the source of truth for:
  - purchasable checkout add-ons
  - planner-eligible categories
  - final pricing

## 8. Example Data

### Juice Plan

```json
{
  "name": "Juice Subscription",
  "category": "juice",
  "kind": "plan",
  "billingMode": "per_day",
  "priceSar": 11
}
```

### Juice Item

```json
{
  "name": "Berry Blast",
  "category": "juice",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 11
}
```

Other juice examples:

- `Berry Brute` - `13 SAR`
- `Classic Green` - `11 SAR`

### Snack Plan

```json
{
  "name": "Snack Subscription",
  "category": "snack",
  "kind": "plan",
  "billingMode": "per_day",
  "priceSar": 12
}
```

### Snack Item

```json
{
  "name": "Cinnamon Apple Muffin (2 pieces)",
  "category": "snack",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 12
}
```

Other snack example:

- `Protein Bar` - `15 SAR`

### Small Salad Plan

```json
{
  "name": "Small Salad Subscription",
  "category": "small_salad",
  "kind": "plan",
  "billingMode": "per_day",
  "priceSar": 12
}
```

### Small Salad Item

```json
{
  "name": "Small Salad",
  "category": "small_salad",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 12
}
```

## 9. Developer Notes

- No backend grouping is currently added.
- No parent-child relationship exists between plans and items.
- `category` is the grouping key.
- Dashboard will later manage create / update / delete for these add-ons.
- Frontend should not hardcode item lists long-term.
- Frontend should rely on API responses.

## 10. Testing Checklist

- Checkout does not show item add-ons.
- Meal planner does not show plan add-ons.
- Selecting `Juice Subscription` unlocks only juice items.
- Selecting `Snack Subscription` unlocks only snack items.
- Selecting `Small Salad Subscription` unlocks only small salad items.
- Checkout estimated total matches backend quote.
- Item price labels match backend response.
- Backend errors are displayed clearly.
