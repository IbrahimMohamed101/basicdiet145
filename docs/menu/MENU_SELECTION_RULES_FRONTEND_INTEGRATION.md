# Menu Selection Rules & Frontend Integration Guide

This document provides the final contracts and rules for Flutter to render the one-time menu and subscription meal planner.

## A. Endpoints to use

1. **One-time menu**:
   `GET /api/orders/menu?lang=en`

2. **Subscription meal planner**:
   `GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar`

**Key details**:
- V1 `builderCatalog` still exists for backward compatibility.
- New Flutter work should prefer `data.builderCatalogV2.sections`.
- `addonCatalog` still exists and is unchanged.
- Write payloads (for quote/checkout) are unchanged for now.

## B. One-time menu response contract

`GET /api/orders/menu` returns:

```text
data.categories[]
  products[]
    optionGroups[]
      options[]
```

**Each category includes**:
- `id`, `key`, `name`, `nameI18n`, `description`, `sortOrder`, `ui.cardVariant`

**Each product includes**:
- `id`, `key`, `name`, `nameI18n`, `description`, `imageUrl`, `pricingModel`, `priceHalala`, `currency`, `itemType`, `ui.cardVariant`, `ui.badge`, `ui.ctaLabel`, `ui.imageRatio`, `optionGroups[]`

**Each optionGroup includes**:
- `id`, `key`, `name`, `minSelections`, `maxSelections`, `isRequired`, `sortOrder`, `ui.displayStyle`, `options[]`

**Each option includes**:
- `id`, `key`, `name`, `nameI18n`, `extraPriceHalala`, `extraFeeHalala` if available, `displayCategoryKey` if available, `proteinFamilyKey` if available, `premiumKey` if available, `sortOrder`

Flutter should render by:
- `category.ui.cardVariant`
- `product.ui.cardVariant`
- `optionGroup.ui.displayStyle`

> **Note:** Do not hardcode category rendering based on category keys such as `custom_order`, `light_options`, `cold_sandwiches`, `sourdough`, `desserts`, `juices`, `drinks`, `ice_cream`. Flutter must render category cards using `category.ui.cardVariant`.

## C. Allowed UI values

**Category `cardVariant` allowed values**:
- `meal_builder`
- `light_collection`
- `sandwich_collection`
- `addon_collection`

**Product `cardVariant` allowed values**:
- `standard`
- `premium`
- `large_salad`
- `addon`

**`displayStyle` allowed values**:
- `chips`
- `radio_cards`
- `checkbox_grid`
- `dropdown`
- `stepper`

**Fallback behavior**:
- missing/unknown Category `cardVariant` => `addon_collection`
- missing/unknown Product `cardVariant` => `standard`
- missing/unknown `displayStyle` => `chips`

## D. One-time product behavior

- `basic_meal` and `basic_salad` only include standard proteins:
  - `chicken`, `beef`, `fish`, `eggs`

- Premium proteins should not appear in basic one-time products:
  - `beef_steak`, `shrimp`, `salmon`

If premium proteins appear in future one-time products, frontend must rely on the received `optionGroups`/`options` and backend pricing fields.

## E. Subscription builderCatalogV2 contract

The new shape for `data.builderCatalogV2` is:

```json
{
  "catalogVersion": "meal_planner_menu.v2",
  "currency": "SAR",
  "sections": [],
  "rules": {}
}
```

Sections currently include:
- `standard_meal`
- `premium_meal`
- `sandwich`
- `premium_large_salad`

## F. standard_meal section

- `type`: `meal_builder`
- `selectionType`: `standard_meal`
- Contains a virtual product located inside the section's `products[]` array:
  - `id`: `virtual:standard_meal`
  - `isVirtual`: `true`
  - `optionGroups`: `protein`, `carb`

**Protein options**: `chicken`, `beef`, `fish`, `eggs`
**Carb options**: `white_rice`, `brown_rice`, `potato`, `sweet_potato`, `pasta`

**Frontend rendering**:
- Render a meal builder screen from `optionGroups`.
- Protein group is single select.
- Carb group `maxSelections` is 2.
- Beef rule may be present under `rules`.

**Write payload**:
- Keep the existing payload unchanged.
- Do not send virtual product id as a real `productId`.
- Use the current existing selection write format.

## G. premium_meal section

- `type`: `meal_builder`
- `selectionType`: `premium_meal`
- Contains a virtual product located inside the section's `products[]` array:
  - `id`: `virtual:premium_meal`
  - `isVirtual`: `true`

**Premium protein options**: `beef_steak`, `shrimp`, `salmon`

Each premium option includes:
- `key`, `premiumKey`, `extraFeeHalala`, `isPremium: true`

**Frontend should display premium fee from `extraFeeHalala` where needed.**
Backend remains authoritative for validation and payment.

## H. sandwich section

- `type`: `product_list`
- Products are real `MenuProduct` rows.
- `product.id` is the value compatible with the existing `sandwichId` write payload.
- Do not treat sandwich products as virtual.

Products currently include examples: `chicken_sandwich`, `tuna_sandwich`, `sourdough_turkey`.

## I. premium_large_salad section

- `type`: `configurable_product`
- `selectionType`: `premium_large_salad`
- Contains a single real `MenuProduct` located inside the section's `products[]` array:
  - `key`: `premium_large_salad`
  - `priceHalala`: 2900
  - `ui.cardVariant`: `large_salad`

**Option groups**: `leafy_greens`, `vegetables`, `protein`, `cheese_nuts`, `fruits`, `sauce`

**Rules**:
- `protein`: minSelections 1 / maxSelections 1
- `sauce`: minSelections 1 / maxSelections 1
- other groups: maxSelections 99

**Frontend should render it from `product.optionGroups`.**
Write payload remains the existing `salad.groups` shape. Do not change checkout/write payloads yet.

## J. Important frontend migration notes

### Read migration
- Prefer `builderCatalogV2.sections` for new screens.
- Keep `builderCatalog` V1 fallback during transition.
- Render generically from sections/products/optionGroups/options.
- Do not hardcode category keys for UI layout.

### Write migration
- Do not change write payloads yet.
- Continue using current selection payloads:
  - `selectionType`
  - `proteinId`
  - `carbs[]`
  - `sandwichId`
  - `salad.groups`

### Virtual products
- `standard_meal` and `premium_meal` are virtual.
- Do not submit their id as `productId`.

### Rules
- UI metadata is display-only.
- Business validation is still backend-owned.
- Do not use `ui.cardVariant` or `ui.displayStyle` for pricing, validation, entitlement, beef limits, carb limits, or premium fees.

## K. Concise example snippets

### 1. One-time product with ui
```json
{
  "id": "prod_123",
  "name": "Basic Meal",
  "ui": {
    "cardVariant": "standard",
    "badge": "Popular"
  },
  "optionGroups": [
    {
      "id": "grp_456",
      "name": "Protein",
      "minSelections": 1,
      "maxSelections": 1,
      "ui": { "displayStyle": "radio_cards" },
      "options": []
    }
  ]
}
```

### 2. Category ui examples
```json
{
  "key": "custom_order",
  "ui": { "cardVariant": "meal_builder" }
}
```

```json
{
  "key": "light_options",
  "ui": { "cardVariant": "light_collection" }
}
```

```json
{
  "key": "cold_sandwiches",
  "ui": { "cardVariant": "sandwich_collection" }
}
```

```json
{
  "key": "desserts",
  "ui": { "cardVariant": "addon_collection" }
}
```

### 3. builderCatalogV2 standard_meal
```json
{
  "key": "standard_meal",
  "type": "meal_builder",
  "selectionType": "standard_meal",
  "products": [
    {
      "id": "virtual:standard_meal",
      "isVirtual": true,
      "optionGroups": [
        { "key": "protein", "minSelections": 1, "maxSelections": 1, "options": [...] },
        { "key": "carb", "minSelections": 0, "maxSelections": 2, "options": [...] }
      ]
    }
  ]
}
```

### 4. builderCatalogV2 premium_large_salad
```json
{
  "key": "premium_large_salad",
  "type": "configurable_product",
  "selectionType": "premium_large_salad",
  "products": [
    {
      "key": "premium_large_salad",
      "priceHalala": 2900,
      "isVirtual": false,
      "ui": { "cardVariant": "large_salad" },
      "optionGroups": [
        { "key": "leafy_greens", "maxSelections": 99, "options": [...] },
        { "key": "vegetables", "maxSelections": 99, "options": [...] },
        { "key": "protein", "minSelections": 1, "maxSelections": 1, "options": [...] },
        { "key": "cheese_nuts", "maxSelections": 99, "options": [...] },
        { "key": "fruits", "maxSelections": 99, "options": [...] },
        { "key": "sauce", "minSelections": 1, "maxSelections": 1, "options": [...] }
      ]
    }
  ]
}
```

### 5. sandwich product
```json
{
  "key": "sandwich",
  "type": "product_list",
  "products": [
    {
      "id": "prod_789",
      "key": "chicken_sandwich",
      "name": "Chicken Sandwich"
    }
  ]
}
```

## L. Subscription plan pricing

Subscription plan pricing is not part of `builderCatalogV2`.

The subscription plans API should expose 3 top-level plans only:
- `subscription_7_days`
- `subscription_26_days`
- `subscription_30_days`

Each plan contains:
- `gramsOptions[]`
  - `grams`: 100 / 150 / 200
  - `mealsOptions[]`
    - `mealsPerDay`: 1 / 2 / 3
    - `priceHalala`

Important:
Flutter must not treat each grams/meals combination as a separate plan card.
The UI should render:
Plan duration -> grams -> meals per day -> price.

Prices are stored in halala.
Display SAR by dividing `priceHalala` by 100.

## M. Checkout and pickup behavior

One-time quote/create order pickup behavior is documented in:
`docs/one-time-orders/ONE_TIME_ORDER_FRONTEND_INTEGRATION.md`

Do not duplicate the full order contract here.
