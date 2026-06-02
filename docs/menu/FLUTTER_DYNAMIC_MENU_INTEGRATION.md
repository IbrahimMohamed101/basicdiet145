# Flutter Dynamic Menu Integration

## 1. Purpose

This guide defines how Flutter consumes the backend-driven menu and subscription planner.

Production API base URL:

```text
https://basicdiet145.onrender.com
```

Flutter must render the catalog returned by the backend. It must not infer behavior from Arabic or English labels, hardcode category/product keys for card layouts, or calculate the final payable price without the quote API.

This document describes backend code. It does not prove the current production database contents.

## 2. One-Time Menu Endpoint

Fetch:

```http
GET /api/orders/menu?lang=ar
GET /api/orders/menu?lang=en
```

This endpoint is public. The canonical response is returned when at least one published `one_time` `MenuProduct` exists.

Canonical hierarchy:

```text
data
  source
  fulfillmentMethod
  currency
  vatIncluded
  vatPercentage
  itemTypes[]
  restaurantHours
  categories[]
    products[]
      optionGroups[]
        options[]
```

Minimal example:

```json
{
  "status": true,
  "data": {
    "source": "one_time_order",
    "fulfillmentMethod": "pickup",
    "currency": "SAR",
    "vatIncluded": true,
    "categories": [
      {
        "id": "CATEGORY_OBJECT_ID",
        "key": "meals",
        "name": "Meals",
        "nameI18n": { "ar": "الوجبات", "en": "Meals" },
        "ui": { "cardVariant": "light_collection" },
        "products": [
          {
            "id": "PRODUCT_OBJECT_ID",
            "key": "basic_meal",
            "categoryId": "CATEGORY_OBJECT_ID",
            "name": "Basic Meal",
            "pricingModel": "per_100g",
            "priceHalala": 1900,
            "baseUnitGrams": 100,
            "requiresBuilder": true,
            "canAddDirectly": false,
            "ui": {
              "cardVariant": "standard",
              "badge": "",
              "ctaLabel": "",
              "imageRatio": "square"
            },
            "optionGroups": [
              {
                "groupId": "GROUP_OBJECT_ID",
                "key": "proteins",
                "minSelections": 1,
                "maxSelections": 1,
                "isRequired": true,
                "ui": { "displayStyle": "radio_cards" },
                "options": [
                  {
                    "optionId": "OPTION_OBJECT_ID",
                    "groupId": "GROUP_OBJECT_ID",
                    "key": "chicken",
                    "name": "Chicken",
                    "extraPriceHalala": 0,
                    "extraWeightUnitGrams": 0,
                    "extraWeightPriceHalala": 0
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## 3. Recommended Dart Models

```text
MenuResponse
MenuDataDto
MenuCategoryDto
MenuProductDto
MenuOptionGroupDto
MenuOptionDto
CategoryUiDto
ProductUiDto
OptionGroupUiDto
OrderQuoteRequest
OrderQuoteItemRequest
SelectedOptionRequest
OrderQuoteResponse
```

Use nullable parsing for optional fields and preserve unknown backend fields where practical. Treat IDs as opaque strings.

Important types:

```dart
class MenuOptionGroupDto {
  final String groupId;
  final int minSelections;
  final int? maxSelections; // null means unlimited
  final bool isRequired;
}
```

## 4. Rendering Rules

### Category Layout

Render `category.ui.cardVariant`:

| Value | Suggested Flutter layout |
| --- | --- |
| `meal_builder` | Builder-oriented entry or collection |
| `light_collection` | Light collection |
| `sandwich_collection` | Sandwich collection |
| `addon_collection` | Add-on style collection |

Fallback for an unknown value:

```text
normal list/grid
```

### Product Card

Render `product.ui.cardVariant`:

| Value | Suggested Flutter layout |
| --- | --- |
| `standard` | Standard card |
| `premium` | Premium-emphasis card |
| `large_salad` | Large configurable salad card |
| `addon` | Compact add-on card |

Fallback:

```text
standard
```

Also render backend-provided `ui.badge`, `ui.ctaLabel`, and `ui.imageRatio` when supported.

### Option Group Widget

Render `optionGroup.ui.displayStyle`:

| Value | Suggested widget |
| --- | --- |
| `chips` | Chips |
| `radio_cards` | Single-select cards |
| `checkbox_grid` | Multi-select grid |
| `dropdown` | Dropdown |
| `stepper` | Quantity stepper |

Fallback for an unknown value should use the selection rules:

| Selection rule | Safe fallback widget |
| --- | --- |
| `maxSelections == 1` | Radio/select style |
| `maxSelections > 1` | Checkbox style |
| `maxSelections == null` | Checkbox or multi-select safe style |
| Otherwise | Safe standard selector |

Use metadata only for presentation. `displayStyle` does not change validation. Pricing, eligibility, and selection validation stay backend-owned.

## 5. Product Interaction

Use the product fields directly:

| Field | Flutter behavior |
| --- | --- |
| `canAddDirectly: true` | Product is fixed-price and has no option groups. It may be added without opening a builder. |
| `requiresBuilder: true` | Open the builder. The product has option groups or uses `per_100g`. |
| `pricingModel: "fixed"` | Display the fixed catalog price. |
| `pricingModel: "per_100g"` | Ask for `weightGrams` and display the backend unit price. |
| `imageUrl` | Render the backend image URL. |

Do not derive product behavior from `name`, `description`, or hardcoded key lists.

## 6. Local Selection Validation

Provide immediate UX feedback before calling quote:

- Sum selected quantities per `groupId`.
- Require total quantity to be at least `minSelections`.
- Reject totals greater than `maxSelections` when it is not `null`.
- Preserve `maxSelections: 0`; do not treat it as missing.
- Treat `maxSelections: null` as unlimited.
- Submit the exact returned `groupId` and `optionId`.

Backend validation remains authoritative.

## 7. Quote Contract

Quote and create-order endpoints require app authentication:

```http
POST /api/orders/quote
POST /api/orders
GET  /api/orders/:id
```

Canonical one-time menu orders are pickup-only. Use:

```json
{
  "fulfillmentMethod": "pickup",
  "pickup": { "branchId": "main" },
  "fulfillmentDate": "2026-06-03",
  "items": [
    {
      "productId": "PRODUCT_OBJECT_ID",
      "qty": 1
    }
  ]
}
```

For weighted products:

```json
{
  "productId": "PRODUCT_OBJECT_ID",
  "qty": 1,
  "weightGrams": 200,
  "selectedOptions": [
    {
      "groupId": "GROUP_OBJECT_ID",
      "optionId": "OPTION_OBJECT_ID",
      "qty": 1
    }
  ]
}
```

For an option that supports extra weight:

```json
{
  "groupId": "GROUP_OBJECT_ID",
  "optionId": "OPTION_OBJECT_ID",
  "qty": 1,
  "extraWeightGrams": 50
}
```

The backend computes weighted product base pricing as:

```text
ceil(weightGrams / baseUnitGrams) * priceHalala
```

The backend computes option pricing from the product-specific relation override first, then falls back to the global option price.

Display catalog prices optimistically, but replace totals with the quote response before checkout.

Product-specific option surcharges are stored by the backend in `ProductGroupOption.extraPriceHalala`. Flutter should render the returned option price and treat the quote API as the final payable-price authority.

## 8. Quote Errors To Surface

Map backend errors to clear UI messages:

| Code | Meaning |
| --- | --- |
| `INVALID_WEIGHT_GRAMS` | Missing, invalid, out-of-range, or wrong-step product weight. |
| `INVALID_WEIGHT` | Invalid optional extra-weight quantity. |
| `MIN_SELECTIONS_NOT_MET` | Required option selections are missing. |
| `MAX_SELECTIONS_EXCEEDED` | Too many selections were submitted. |
| `OPTION_NOT_ALLOWED` | Group or option is not linked to this product. |
| `OPTION_NOT_AVAILABLE` | Option exists but is unavailable. |
| `OPTION_GROUP_NOT_AVAILABLE` | Group relation exists but is unavailable. |
| `PRODUCT_NOT_AVAILABLE` | Product, category, or branch is unavailable. |
| `DELIVERY_NOT_SUPPORTED` | One-time canonical orders currently support pickup only. |
| `UNSUPPORTED_ONE_TIME_ORDER_FIELD` | Subscription or delivery fields leaked into a one-time request. |

Do not silently recalculate after a quote error. Preserve the user's selections and show the server message.

## 9. Create Order

`POST /api/orders` prices the cart again. It requires an idempotency key through:

```text
Idempotency-Key header
X-Idempotency-Key header
body.idempotencyKey
```

Reuse the same key for retries of the same order payload. Do not reuse it for a changed cart.

## 10. Legacy One-Time Fallback

If the backend has no published one-time `MenuProduct`, `GET /api/orders/menu` returns a legacy compatibility shape with fields such as:

```text
standardMeals
sandwiches
salad
addons
```

The target Flutter implementation is the canonical nested `categories[].products[]` hierarchy.

Recommended client behavior:

1. Detect `data.categories` as the canonical contract.
2. Keep a bounded legacy adapter only if uninitialized environments must remain usable.
3. Log fallback usage so deployment gaps are visible.
4. Do not mix canonical and legacy cart item formats in one quote.

## 11. Subscription Planner

Fetch:

```http
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar
GET /api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en
```

This endpoint is public.

Prefer:

```text
data.builderCatalogV2
```

Keep V1 parsing only during migration:

```text
data.builderCatalog
```

When `includeLegacy=true`, the response additionally exposes legacy planner fields:

```text
data.currency
data.regularMeals
data.premiumMeals
data.addons
```

### builderCatalogV2

```json
{
  "catalogVersion": "meal_planner_menu.v2",
  "currency": "SAR",
  "sections": [],
  "rules": {}
}
```

Expected sections:

| Section key | Type | Notes |
| --- | --- | --- |
| `standard_meal` | `meal_builder` | Contains a virtual builder product. |
| `premium_meal` | `meal_builder` | Contains a virtual builder product. |
| `sandwich` | `product_list` | Contains real canonical sandwich products. |
| `premium_large_salad` | `configurable_product` | Contains a real product when available and a virtual fallback otherwise. |

Virtual IDs look like:

```text
virtual:standard_meal
virtual:premium_meal
virtual:premium_large_salad
```

Do not submit virtual IDs as canonical one-time `MenuProduct` IDs. Keep the existing subscription write payload format until the backend subscription write contract is deliberately migrated.

Render planner rules from `builderCatalogV2.rules`, including carb constraints and the daily beef limit. Do not infer planner rules from text labels.

## 12. Subscription Timeline

When rendering planned subscription days, use backend timeline fields:

```text
timelineStatus
canShowAsPlanned
```

Possible `timelineStatus` values:

```text
empty
draft
pending_payment
planned
failed
```

Do not mark a day as planned merely because selected meal counts are non-zero. The backend requires confirmed planner state, confirmed commercial state, no outstanding payment requirement, and an active subscription before returning `canShowAsPlanned: true`.

## 13. Flutter Guardrails

- Do not use localized names for branching.
- Do not use technical keys to select visual layouts.
- Do not calculate final totals locally.
- Do not submit virtual planner product IDs as canonical menu product IDs.
- Do not assume empty arrays mean missing data.
- Do not convert nullable selection limits into non-null defaults.
- Do not merge subscription payload fields into one-time order payloads.
- Do not assume the production database matches bootstrap definitions without checking the read-only APIs.
- Do not run seed, bootstrap, reset, or direct DB-write operations as part of Flutter integration or QA.

## 14. QA Checklist

Use read-only catalog checks plus authenticated quote calls in a safe QA environment:

- Render Arabic and English one-time menus in backend order.
- Verify category, product, and group UI metadata fallbacks.
- Verify direct fixed products and configurable products.
- Verify weighted product validation.
- Verify optional add-ons with `minSelections: 0`.
- Verify relation-specific option pricing.
- Verify planner `builderCatalogV2` sections.
- Verify canonical seven planner carbs and six cold sandwiches where seeded data is expected.
- Verify `small_salad` is absent from the public one-time menu.
- Verify timeline UI uses `timelineStatus` and `canShowAsPlanned`.

Do not execute write QA against production.

## 15. Known Gaps And TODOs

1. Decide whether Flutter needs advanced one-time option metadata such as `extraFeeHalala`, `displayCategoryKey`, `proteinFamilyKey`, `premiumKey`, and `ruleTags`. The current one-time public serializer does not expose them.
2. Add canonical product nutrition and preparation-time fields if mobile designs require them.
3. Keep the legacy one-time fallback adapter only as long as uninitialized environments require it.
4. Confirm the subscription write migration plan before using `builderCatalogV2` virtual products for submissions.
5. Treat production catalog contents as an environment verification task; code inspection alone cannot prove published rows.

## 16. Backend References

```text
src/routes/orders.js
src/routes/subscriptions.js
src/controllers/orderController.js
src/controllers/menuController.js
src/services/orders/orderMenuService.js
src/services/orders/menuCatalogService.js
src/services/orders/menuPricingService.js
src/services/orders/orderPricingService.js
src/services/catalog/CatalogService.js
src/services/subscription/mealPlannerCatalogService.js
src/services/subscription/subscriptionTimelineService.js
src/services/catalog/catalogKeyUiHelpers.js
src/config/mealPlannerContract.js
```
