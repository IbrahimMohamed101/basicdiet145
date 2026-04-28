# Frontend Subscription Add-Ons Integration

## Overview

Subscription add-ons are now split into two frontend contexts:

- Checkout / subscription creation shows only add-on plans.
- Meal planner shows only add-on items.

The backend intentionally separates them:

- Checkout sells recurring category subscriptions.
- Meal planner lets the user pick real products inside those categories.

There is no parent-child relation in the database. Plans and items are linked only by `category`.

## Data Model Summary

Frontend-relevant add-on fields:

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

- `kind: "plan"`
  - purchasable subscription add-on in checkout
- `kind: "item"`
  - selectable add-on product in meal planner
- `category`
  - grouping key used to link plans and items
  - values:
    - `juice`
    - `snack`
    - `small_salad`
- `billingMode`
  - `per_day` for checkout plans
  - `flat_once` for meal-planner items

## Checkout Integration

### Endpoint

- `GET /api/subscriptions/menu`

### Current backend behavior

This response now has two separate add-on areas:

1. Checkout add-ons:

- `data.addons`
- `data.addonsByType`
- contain only active add-on plans:
  - `kind = "plan"`
  - `billingMode = "per_day"`

2. Nested meal planner add-ons inside the same response:

- `data.mealPlanner.addons.items`
- `data.mealPlanner.addons.byType`
- contain only active add-on items:
  - `kind = "item"`
  - `billingMode = "flat_once"`

Frontend checkout must use only:

- `data.addons`
- or `data.addonsByType`

Do not use:

- `data.mealPlanner.addons.items` for checkout

### Checkout-visible plans

The expected checkout plans are:

- `Juice Subscription`
- `Snack Subscription`
- `Small Salad Subscription`

### Submission

Send selected plan add-on IDs into the existing quote / checkout flow.

### Checkout pricing

- Checkout uses `plan.priceHalala`
- Backend total is:
  - `plan.priceHalala * subscriptionDaysCount`
- Frontend may show:
  - price per day
  - estimated total
- Backend quote remains the source of truth

### Example checkout add-on shape

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

## Meal Planner Integration

### Endpoints

- `GET /api/subscriptions/meal-planner-menu`
- Also note:
  - `GET /api/subscriptions/menu` contains `data.mealPlanner.addons.items` with the same item-only planner catalog behavior

### Current backend behavior

Meal planner add-on catalogs now return only active add-on items:

- `kind = "item"`
- `billingMode = "flat_once"`

They do not return checkout plans.

### Important rule

Catalog availability and selection entitlement are different concerns:

- Catalog endpoints return item add-ons.
- Actual selection rules depend on the current subscription's `addonSubscriptions`.

Linkage is category-based only.

## Meal Planner Selection Rules

The current backend selection behavior is:

### If the user has entitlement for a category

Example: user subscribed to `Juice Subscription`

- first selected juice item on that day:
  - included
  - backend stores it with `source: "subscription"`
  - effective charge `0`
- second and later juice items on the same day:
  - charged
  - backend stores them as `pending_payment`
  - each one uses that selected item's own `priceHalala`

### If the user does not have entitlement for a category

Example: user subscribed to `juice` only, then selects `Small Salad`

- selection is accepted
- it is not included
- it becomes paid immediately
- backend stores it as `pending_payment`
- charge uses `Small Salad.priceHalala`

### If the user has no add-on subscriptions at all

- selecting any valid item is still allowed
- it becomes paid
- charge uses that item's own `priceHalala`

### Invalid planner selections

- `kind="plan"` is rejected in meal planner
- inactive items are rejected

## Frontend Grouping

Frontend should group planner items by `category`:

- `juice`
- `snack`
- `small_salad`

Recommended UI behavior:

- Show only categories the current subscription is entitled to
- Optionally keep non-entitled categories hidden if the product UX wants planner to feel subscription-scoped
- If non-entitled category selection is intentionally exposed in UI, expect backend to treat it as paid overage, not included

Example:

If the user bought `Juice Subscription`, show juice items such as:

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

## Pricing Behavior

### Checkout pricing

- Uses `plan.priceHalala`
- Formula:
  - `plan.priceHalala * subscriptionDaysCount`
- Never use item prices in initial checkout pricing

### Meal planner pricing

- Uses the selected item's own `item.priceHalala`
- Never use plan price to charge an item

### Included vs paid in meal planner

- Included item:
  - returned as included / free
  - typically `source: "subscription"`
  - effective price `0`
- Paid overage or non-entitled category:
  - typically `source: "pending_payment"`
  - charge uses selected item's `priceHalala`

## Expected UX

### Checkout screen

- Show only 3 add-on subscription choices
- Display each as price per day
- Optionally display estimated total:
  - `price per day x selected subscription days`

### Meal planner screen

- Show only actual selectable products, not plans
- Group by category
- Use backend `priceLabel` for item display
- First entitled item/day should appear as included in the final state returned from backend
- Additional items in the same category/day should appear as paid overage
- Non-entitled category items, if selectable in product UX, should appear as paid

## Validation and Error Handling

Backend protections currently enforced:

- Checkout rejects direct purchase of `kind="item"`
- Checkout accepts `kind="plan"` only
- `GET /api/subscriptions/menu`
  - top-level add-ons are plans only
  - nested `mealPlanner.addons.items` are items only
- `GET /api/subscriptions/meal-planner-menu`
  - add-ons are items only
- Meal planner rejects `kind="plan"` selections
- Meal planner rejects inactive items
- Meal planner accepts non-entitled category items as paid overage

Frontend guidance:

- Surface backend validation errors directly when possible
- Treat backend as source of truth for:
  - allowed checkout plans
  - planner item validity
  - included vs paid state
  - final pricing

## Example Data

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

### Juice Items

```json
{
  "name": "Berry Blast",
  "category": "juice",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 11
}
```

```json
{
  "name": "Berry Brute",
  "category": "juice",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 13
}
```

```json
{
  "name": "Classic Green",
  "category": "juice",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 11
}
```

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

### Snack Items

```json
{
  "name": "Cinnamon Apple Muffin (2 pieces)",
  "category": "snack",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 12
}
```

```json
{
  "name": "Protein Bar",
  "category": "snack",
  "kind": "item",
  "billingMode": "flat_once",
  "priceSar": 15
}
```

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

## Seed Notes

There is now a standalone add-ons seed script:

- `npm run seed:subscription-addons`

This script seeds only:

- checkout plans
- meal planner items

for categories:

- `juice`
- `snack`
- `small_salad`

## Developer Notes

- No backend grouping object was added specifically for parent-child add-ons
- No `parentId` exists
- `category` is the grouping key
- Dashboard will later manage create / update / delete
- Frontend should not hardcode item lists long-term
- Frontend should always rely on API responses

## Frontend Checklist

- Checkout does not show item add-ons
- `/api/subscriptions/menu` top-level add-ons show only plans
- `/api/subscriptions/menu` nested `mealPlanner.addons.items` shows only items
- `/api/subscriptions/meal-planner-menu` shows only items
- Selecting `Juice Subscription` unlocks included juice behavior
- Selecting `Snack Subscription` unlocks included snack behavior
- Selecting `Small Salad Subscription` unlocks included small salad behavior
- First entitled item per category per day is included
- Second item in the same entitled category per day is charged using item price
- Non-entitled category item is charged using item price
- Checkout estimated total matches backend quote
- Item price labels match backend response
- Backend validation and payment states are displayed clearly
