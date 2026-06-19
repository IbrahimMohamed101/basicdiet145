# Dashboard Add-ons Contract

This contract defines how the Dashboard frontend should render and manage add-on items, add-on subscription plans, linked menu products, and plan-based add-on pricing.

This document is a Dashboard Frontend handoff. It describes request payloads, response shapes, validation rules, and UI usage rules. It does not require the frontend team to inspect backend implementation files.

## Authentication

All endpoints in this document are Dashboard endpoints and must be called with the existing Dashboard authentication/authorization headers used by the admin dashboard.

```http
Authorization: Bearer <dashboard_admin_token>
Content-Type: application/json
```

## Core Concepts

### 1. Add-on Item

An Add-on Item is a one-time sellable add-on item.

Key rules:

* Appears under `data.items`.
* Uses `kind: "item"`.
* Backend derives `type: "one_time"`.
* Has direct price fields:
  * `priceHalala`
  * `priceSar`
  * `priceLabel`
* `priceHalala` is the editable canonical price field.
* `priceSar` and `priceLabel` are read-only display fields.

Example items:

* Mango Juice
* Apple Juice
* Orange Juice
* Protein Snack
* Healthy Dessert
* Snack Box

### 2. Add-on Subscription Plan

An Add-on Subscription Plan is a subscription add-on sold with a base subscription plan.

Key rules:

* Appears under `data.plans`.
* Uses `kind: "plan"`.
* Backend derives `type: "subscription"`.
* Does not use a top-level direct price as the source of truth.
* Uses `planPrices[]` for pricing by base subscription plan.
* Uses `menuProducts[]` to define the products the customer can select later.
* `pricingMode` should be `"base_plan_matrix"`.

Example plans:

* Juice Subscription
* Snack Subscription
* Small Salad Subscription

### 3. Linked Menu Products

Linked Menu Products are the actual catalog products attached to an Add-on Subscription Plan.

Key rules:

* Nested under each add-on subscription plan as `menuProducts[]`.
* Submitted by the Dashboard frontend as `menuProductIds[]`.
* They are not top-level add-on purchase cards.
* They define what the customer can select later under the purchased add-on entitlement.

Examples:

* Juice Subscription can include Orange Juice, Apple Juice, Mango Juice.
* Small Salad Subscription can include Green Salad - 100g.
* Snack Subscription can include Protein Snack, Healthy Dessert, Snack Box.

### 4. Plan Prices

Plan Prices are the add-on subscription pricing matrix rows.

Key rules:

* Nested under each add-on subscription plan as `planPrices[]`.
* Each row maps one add-on plan to one base subscription plan.
* Each row uses:
  * `basePlanId`
  * `priceHalala`
  * `isActive`
* Price is a flat package price for that base plan.
* Frontend must not multiply this price by days.
* Frontend must not multiply this price by meals.
* Frontend must not calculate customer quote totals from this page.

## Primary Dashboard Read Endpoint

```http
GET /api/dashboard/addons
```

### Purpose

Loads the full Add-ons dashboard screen.

The Dashboard frontend must use this endpoint as the main source of truth for:

* one-time add-on items
* subscription add-on plans
* linked menu products
* pricing matrix rows
* category select options
* summary counts

The Dashboard Add-ons screen must not call `/api/dashboard/addon-prices` to render the main screen.

### Response Shape

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "item_id_example",
        "_id": "item_id_example",
        "kind": "item",
        "type": "one_time",
        "name": {
          "ar": "مانجو",
          "en": "Mango Juice"
        },
        "category": "juice",
        "priceHalala": 1100,
        "priceSar": 11,
        "priceLabel": "11 SAR",
        "currency": "SAR",
        "isActive": true
      }
    ],
    "plans": [
      {
        "id": "addon_plan_id_example",
        "_id": "addon_plan_id_example",
        "kind": "plan",
        "type": "subscription",
        "name": {
          "ar": "اشتراك العصير",
          "en": "Juice Subscription"
        },
        "category": "juice",
        "maxPerDay": 1,
        "pricingMode": "base_plan_matrix",
        "isActive": true,
        "menuProductIds": [
          "orange_juice_product_id_example",
          "apple_juice_product_id_example",
          "mango_juice_product_id_example"
        ],
        "menuProductsCount": 3,
        "menuProducts": [
          {
            "id": "orange_juice_product_id_example",
            "_id": "orange_juice_product_id_example",
            "key": "orange_juice",
            "name": {
              "ar": "عصير برتقال",
              "en": "Orange Juice"
            },
            "image": "",
            "category": "drinks",
            "isActive": true
          }
        ],
        "planPricesCount": 3,
        "planPrices": [
          {
            "id": "price_row_id_example",
            "_id": "price_row_id_example",
            "addonPlanId": "addon_plan_id_example",
            "basePlanId": "base_plan_id_example",
            "basePlanName": {
              "ar": "اشتراك 7 أيام",
              "en": "7-Day Meal Subscription"
            },
            "daysCount": 7,
            "mealsCount": 14,
            "basePlanPriceHalala": 34800,
            "priceHalala": 10000,
            "priceSar": 100,
            "priceLabel": "100 SAR",
            "currency": "SAR",
            "isActive": true
          }
        ]
      }
    ],
    "meta": {
      "addonPlanCategories": [
        {
          "key": "juice",
          "label": {
            "ar": "اشتراك العصير",
            "en": "Juice Subscription"
          },
          "description": {
            "ar": "اختيارات العصائر والمشروبات",
            "en": "Juice and drink entitlement"
          }
        },
        {
          "key": "small_salad",
          "label": {
            "ar": "اشتراك السلطة الصغيرة",
            "en": "Small Salad Subscription"
          },
          "description": {
            "ar": "اختيارات السلطة الصغيرة",
            "en": "Small salad entitlement"
          }
        },
        {
          "key": "snack",
          "label": {
            "ar": "اشتراك السناك",
            "en": "Snack Subscription"
          },
          "description": {
            "ar": "اختيارات السناك والحلويات الصحية",
            "en": "Snack and healthy dessert entitlement"
          }
        }
      ]
    },
    "summary": {
      "itemsCount": 6,
      "plansCount": 3,
      "matrixRowsCount": 9,
      "currency": "SAR"
    }
  }
}
```

### ID Source Note

All IDs in examples are placeholders. The Dashboard frontend must use IDs returned by the relevant read/picker endpoints:

* add-on item/plan IDs from `GET /api/dashboard/addons`
* menu product IDs from `GET /api/dashboard/menu/products`
* base subscription plan IDs from `GET /api/dashboard/plans`

## Field Reference

### `data.items[]`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Add-on item ID | Use for update, toggle, delete | Read-only |
| `kind` | string | Always `"item"` | Distinguish item from plan | Read-only |
| `type` | string | Always `"one_time"` | Display/debug context | Read-only |
| `name` | object | Localized `{ ar, en }` name | Display/edit | Writable |
| `category` | string | Item category | Display/edit | Writable |
| `priceHalala` | number | Canonical price in halala | Form input | Writable |
| `priceSar` | number | Price in SAR | Display only | Read-only |
| `priceLabel` | string | Formatted price | Display only | Read-only |
| `currency` | string | Currency code | Display context | Read-only |
| `isActive` | boolean | Active/disabled status | Status badge/toggle | Writable |

### `data.plans[]`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Add-on plan ID | Use for update, toggle, delete | Read-only |
| `kind` | string | Always `"plan"` | Distinguish plan from item | Read-only |
| `type` | string | Always `"subscription"` | Display/debug context | Read-only |
| `name` | object | Localized `{ ar, en }` name | Display/edit | Writable |
| `category` | string | Add-on plan entitlement category | Select input | Writable |
| `maxPerDay` | number | Daily entitlement limit | Form input | Writable |
| `pricingMode` | string | Usually `"base_plan_matrix"` | Display/debug context | Read-only |
| `menuProductIds` | string[] | Linked menu product IDs | Multi-select value | Writable |
| `menuProductsCount` | number | Number of linked products | Summary display | Read-only |
| `menuProducts` | array | Linked menu product details | Preview/display | Read-only |
| `planPricesCount` | number | Number of matrix rows | Summary display | Read-only |
| `planPrices` | array | Matrix price rows | Price matrix display/edit | Writable via payload |
| `isActive` | boolean | Active/disabled status | Status badge/toggle | Writable |

### `data.plans[].menuProducts[]`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Menu product ID | Matches `menuProductIds[]` | Read-only |
| `key` | string | Product key | Debug/context | Read-only |
| `name` | object | Localized `{ ar, en }` name | Product label | Read-only |
| `image` | string | Product image URL | Thumbnail | Read-only |
| `category` | string | Menu catalog category | Group/filter display | Read-only |
| `isActive` | boolean | Product active status | Warning/filter display | Read-only |

### `data.plans[].planPrices[]`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Matrix row ID | Display/debug context | Read-only |
| `addonPlanId` | string | Parent add-on plan ID | Context | Read-only |
| `basePlanId` | string | Base subscription plan ID | Payload value | Writable |
| `basePlanName` | object | Localized base plan name | Matrix row label | Read-only |
| `daysCount` | number | Base plan days | Context only | Read-only |
| `mealsCount` | number | Base plan meals | Context only | Read-only |
| `basePlanPriceHalala` | number | Base plan price in halala | Context only | Read-only |
| `priceHalala` | number | Flat add-on package price | Price input | Writable |
| `priceSar` | number | Price in SAR | Display only | Read-only |
| `priceLabel` | string | Formatted price | Display only | Read-only |
| `currency` | string | Currency code | Context | Read-only |
| `isActive` | boolean | Matrix row status | Price row toggle | Writable |

### `data.meta.addonPlanCategories[]`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `key` | string | Strict category value | Select value | Read-only |
| `label` | object | Localized `{ ar, en }` label | Select option text | Read-only |
| `description` | object | Localized `{ ar, en }` description | Select subtext/helper | Read-only |

### `data.summary`

| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `itemsCount` | number | Number of displayed one-time items | Summary card | Read-only |
| `plansCount` | number | Number of displayed subscription plans | Summary card | Read-only |
| `matrixRowsCount` | number | Total displayed matrix rows | Summary card | Read-only |
| `currency` | string | Default currency | Display context | Read-only |

## Category Rules

For add-on subscription plans, `category` is a strict backend-defined enum.

Allowed plan category values:

* `juice`
* `small_salad`
* `snack`

The Dashboard frontend must render the plan category field as a Select using:

```txt
data.meta.addonPlanCategories
```

Important distinction:

* `plan.category` is the add-on entitlement category.
* `menuProducts[].category` is the menu product catalog category.
* These are different concepts and must not be mixed.

Do not hardcode add-on plan category labels if `data.meta.addonPlanCategories` is available.

Invalid plan category examples:

* `proteins`
* `sandwiches`
* `addons`
* `salads`
* `desert`

These values must not be submitted as add-on subscription plan categories.

## Menu Products Picker Source

```http
GET /api/dashboard/menu/products
```

### Purpose

Fetches menu products for the multi-select used when linking products to add-on subscription plans.

### Minimal Response Shape

```json
{
  "status": true,
  "data": [
    {
      "id": "menu_product_id_example",
      "_id": "menu_product_id_example",
      "key": "orange_juice",
      "name": {
        "ar": "عصير برتقال",
        "en": "Orange Juice"
      },
      "category": "drinks",
      "isActive": true
    }
  ]
}
```

### Frontend Usage

* Render a multi-select using `name` and `category`.
* Use `data[].id` as the selected value.
* Submit selected IDs as `menuProductIds[]` in:
  * `POST /api/dashboard/addons`
  * `PUT /api/dashboard/addons/:id`

## Base Plans Picker Source

```http
GET /api/dashboard/plans
```

### Purpose

Fetches base subscription plans for the add-on pricing matrix.

### Minimal Response Shape

```json
{
  "status": true,
  "data": [
    {
      "id": "base_plan_id_example",
      "_id": "base_plan_id_example",
      "name": {
        "ar": "اشتراك 7 أيام",
        "en": "7-Day Meal Subscription"
      },
      "isActive": true
    }
  ]
}
```

### Frontend Usage

* Render one matrix row per active/sellable base subscription plan.
* Use `data[].id` as `planPrices[].basePlanId`.
* Each row submitted to `POST`/`PUT /api/dashboard/addons` should include:
  * `basePlanId`
  * `priceHalala`
  * `isActive`

## Create Add-on Item

```http
POST /api/dashboard/addons
```

Use this endpoint to create a one-time add-on item.

### Payload

```json
{
  "kind": "item",
  "name": {
    "ar": "عصير مانجو",
    "en": "Mango Juice"
  },
  "category": "juice",
  "priceHalala": 1100,
  "isActive": true
}
```

### Payload Rules

* `kind` is required.
* `kind` must be `"item"`.
* `name.ar` is required.
* `name.en` is required.
* `priceHalala` is required.
* `priceHalala` must be an integer halala amount.
* `priceSar` is read-only and must not be submitted.
* `priceLabel` is read-only and must not be submitted.
* Backend derives `type: "one_time"`.

### Success Response

```json
{
  "status": true,
  "data": {
    "id": "new_item_id_example",
    "_id": "new_item_id_example",
    "kind": "item",
    "type": "one_time",
    "name": {
      "ar": "عصير مانجو",
      "en": "Mango Juice"
    },
    "category": "juice",
    "priceHalala": 1100,
    "priceSar": 11,
    "priceLabel": "11 SAR",
    "currency": "SAR",
    "isActive": true
  }
}
```

## Create Add-on Subscription Plan

```http
POST /api/dashboard/addons
```

Use this endpoint to create a subscription add-on plan with linked menu products and pricing matrix rows in one request.

### Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "اشتراك العصير",
    "en": "Juice Subscription"
  },
  "category": "juice",
  "maxPerDay": 1,
  "pricingMode": "base_plan_matrix",
  "menuProductIds": [
    "orange_juice_product_id",
    "apple_juice_product_id",
    "mango_juice_product_id"
  ],
  "planPrices": [
    {
      "basePlanId": "seven_day_base_plan_id",
      "priceHalala": 10000,
      "isActive": true
    },
    {
      "basePlanId": "twenty_six_day_base_plan_id",
      "priceHalala": 18000,
      "isActive": true
    },
    {
      "basePlanId": "thirty_day_base_plan_id",
      "priceHalala": 30000,
      "isActive": true
    }
  ],
  "isActive": true
}
```

### Payload Rules

* `kind` is required.
* `kind` must be `"plan"`.
* `name.ar` is required.
* `name.en` is required.
* `category` is required.
* `category` must be one of:
  * `juice`
  * `small_salad`
  * `snack`
* `menuProductIds` is required by the Dashboard contract.
* `menuProductIds` must be a non-empty array.
* `planPrices` is required by the Dashboard contract.
* `planPrices` must be a non-empty array.
* `planPrices[].basePlanId` is required.
* `planPrices[].priceHalala` is required.
* `planPrices[].priceHalala` must be an integer halala amount.
* `planPrices[].isActive` is optional; default UI value should be `true`.
* Top-level `priceHalala` is not the pricing source for `kind: "plan"`.
* Frontend must not multiply add-on plan prices by days or meals.
* Backend derives `type: "subscription"`.

### Frontend Submit Blocking Rules

The Dashboard frontend must block submit before calling the API if:

* `menuProductIds` is missing.
* `menuProductIds` is empty.
* `planPrices` is missing.
* `planPrices` is empty.
* any `planPrices[].basePlanId` is missing.
* any `planPrices[].priceHalala` is missing or not an integer.

Backend compatibility behavior must not be used as Dashboard behavior. Even if a permissive backend accepts an incomplete payload, the Dashboard UI must treat incomplete add-on plans as invalid.

### Success Response

```json
{
  "status": true,
  "data": {
    "id": "new_plan_id_example",
    "_id": "new_plan_id_example",
    "kind": "plan",
    "type": "subscription",
    "name": {
      "ar": "اشتراك العصير",
      "en": "Juice Subscription"
    },
    "category": "juice",
    "maxPerDay": 1,
    "pricingMode": "base_plan_matrix",
    "menuProductIds": [
      "orange_juice_product_id",
      "apple_juice_product_id",
      "mango_juice_product_id"
    ],
    "isActive": true,
    "menuProductsCount": 3,
    "menuProducts": [
      {
        "id": "orange_juice_product_id",
        "_id": "orange_juice_product_id",
        "key": "orange_juice",
        "name": {
          "ar": "عصير برتقال",
          "en": "Orange Juice"
        },
        "image": "",
        "category": "drinks",
        "isActive": true
      }
    ],
    "planPricesCount": 3,
    "planPrices": [
      {
        "id": "price_row_id_1",
        "_id": "price_row_id_1",
        "addonPlanId": "new_plan_id_example",
        "basePlanId": "seven_day_base_plan_id",
        "basePlanName": {
          "ar": "اشتراك 7 أيام",
          "en": "7-Day Meal Subscription"
        },
        "daysCount": 7,
        "mealsCount": 14,
        "basePlanPriceHalala": 34800,
        "priceHalala": 10000,
        "priceSar": 100,
        "priceLabel": "100 SAR",
        "currency": "SAR",
        "isActive": true
      }
    ]
  }
}
```

## Update Add-on Item

```http
PUT /api/dashboard/addons/:id
```

Use this endpoint to update a one-time add-on item.

### Payload

```json
{
  "kind": "item",
  "name": {
    "ar": "عصير مانجو",
    "en": "Mango Juice"
  },
  "category": "juice",
  "priceHalala": 1200,
  "isActive": true
}
```

### Payload Rules

* Send the full current editable item state.
* `kind` must be `"item"`.
* `priceHalala` remains the direct item price.
* `priceSar` and `priceLabel` are read-only and must not be submitted.
* Response returns the updated item.

### Success Response

```json
{
  "status": true,
  "data": {
    "id": "item_id_example",
    "_id": "item_id_example",
    "kind": "item",
    "type": "one_time",
    "name": {
      "ar": "عصير مانجو",
      "en": "Mango Juice"
    },
    "category": "juice",
    "priceHalala": 1200,
    "priceSar": 12,
    "priceLabel": "12 SAR",
    "currency": "SAR",
    "isActive": true
  }
}
```

## Update Add-on Subscription Plan

```http
PUT /api/dashboard/addons/:id
```

Use this endpoint to update a subscription add-on plan and its aggregate relations in one request.

### Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "اشتراك العصير",
    "en": "Juice Subscription"
  },
  "category": "juice",
  "maxPerDay": 1,
  "pricingMode": "base_plan_matrix",
  "menuProductIds": [
    "orange_juice_product_id",
    "apple_juice_product_id",
    "mango_juice_product_id"
  ],
  "planPrices": [
    {
      "basePlanId": "seven_day_base_plan_id",
      "priceHalala": 10000,
      "isActive": true
    },
    {
      "basePlanId": "twenty_six_day_base_plan_id",
      "priceHalala": 18000,
      "isActive": true
    },
    {
      "basePlanId": "thirty_day_base_plan_id",
      "priceHalala": 30000,
      "isActive": true
    }
  ],
  "isActive": true
}
```

### Payload Rules

* Send the full current editable plan state.
* `kind` must be `"plan"`.
* This request updates:
  * plan metadata
  * linked menu products
  * plan price matrix rows
  * active status
* `menuProductIds` must be a non-empty array.
* `planPrices` must be a non-empty array.
* Frontend should not call separate pricing-row endpoints for normal plan editing.
* Response returns the updated full plan with nested `menuProducts` and `planPrices`.

### Success Response

```json
{
  "status": true,
  "data": {
    "id": "addon_plan_id_example",
    "_id": "addon_plan_id_example",
    "kind": "plan",
    "type": "subscription",
    "name": {
      "ar": "اشتراك العصير",
      "en": "Juice Subscription"
    },
    "category": "juice",
    "maxPerDay": 1,
    "pricingMode": "base_plan_matrix",
    "menuProductIds": [
      "orange_juice_product_id",
      "apple_juice_product_id",
      "mango_juice_product_id"
    ],
    "isActive": true,
    "menuProductsCount": 3,
    "menuProducts": [
      {
        "id": "orange_juice_product_id",
        "_id": "orange_juice_product_id",
        "key": "orange_juice",
        "name": {
          "ar": "عصير برتقال",
          "en": "Orange Juice"
        },
        "image": "",
        "category": "drinks",
        "isActive": true
      }
    ],
    "planPricesCount": 3,
    "planPrices": [
      {
        "id": "price_row_id_1",
        "_id": "price_row_id_1",
        "addonPlanId": "addon_plan_id_example",
        "basePlanId": "seven_day_base_plan_id",
        "basePlanName": {
          "ar": "اشتراك 7 أيام",
          "en": "7-Day Meal Subscription"
        },
        "daysCount": 7,
        "mealsCount": 14,
        "basePlanPriceHalala": 34800,
        "priceHalala": 10000,
        "priceSar": 100,
        "priceLabel": "100 SAR",
        "currency": "SAR",
        "isActive": true
      }
    ]
  }
}
```

## Toggle / Delete / Status

### Toggle Add-on Status

```http
PATCH /api/dashboard/addons/:id/toggle
```

#### Purpose

Toggles the `isActive` status of an add-on item or add-on subscription plan.

#### Payload

No JSON body is required.

#### Success Response

```json
{
  "status": true,
  "data": {
    "id": "addon_id_example",
    "_id": "addon_id_example",
    "isActive": false
  }
}
```

#### Frontend Behavior

* Update the status badge from the returned `isActive`.
* Optionally remove inactive records from the active view.
* Refetch `GET /api/dashboard/addons` if the UI needs fully refreshed nested plan data.

### Delete Add-on

```http
DELETE /api/dashboard/addons/:id
```

#### Purpose

Soft-deactivates an add-on item or add-on subscription plan.

#### Payload

No JSON body is required.

#### Success Response

```json
{
  "status": true,
  "data": {
    "id": "addon_id_example",
    "isActive": false
  }
}
```

#### Frontend Behavior

* Treat this as a soft delete.
* Remove the item/plan from the active view or mark it as disabled.
* Do not assume the record was physically removed from the database.

## Secondary Pricing Row Endpoints

The `/api/dashboard/addon-prices` endpoint group is secondary/advanced only.

The Dashboard Add-ons screen must use:

```http
GET /api/dashboard/addons
```

as its main read model.

Rules:

* The main Add-ons page must not use `/api/dashboard/addon-prices` for rendering.
* Normal add-on plan creation must use `POST /api/dashboard/addons` with nested `planPrices[]`.
* Normal add-on plan updates must use `PUT /api/dashboard/addons/:id` with nested `planPrices[]`.
* `/api/dashboard/addon-prices` may be used only for advanced/bulk matrix tooling if such UI exists.

## Success and Error Response Shapes

### Success Shape

Successful responses use:

```json
{
  "status": true,
  "data": {}
}
```

### Validation Error Shape

Validation errors use:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "Human readable error message"
  }
}
```

The frontend should display `error.message` to the operator and may use `error.code` for conditional handling.

## Validation Rules and Errors

### 1. Unknown plan category

#### Bad Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "خطة",
    "en": "Plan"
  },
  "category": "proteins",
  "menuProductIds": ["menu_product_id"],
  "planPrices": [
    {
      "basePlanId": "base_plan_id",
      "priceHalala": 1000,
      "isActive": true
    }
  ]
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "category must be one of: juice, snack, small_salad"
  }
}
```

### 2. Invalid `planPrices` type

#### Bad Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "خطة",
    "en": "Plan"
  },
  "category": "juice",
  "menuProductIds": ["menu_product_id"],
  "planPrices": "invalid_type"
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "planPrices must be an array"
  }
}
```

### 3. Invalid `menuProductIds` type

#### Bad Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "خطة",
    "en": "Plan"
  },
  "category": "juice",
  "menuProductIds": "invalid_type",
  "planPrices": [
    {
      "basePlanId": "base_plan_id",
      "priceHalala": 1000,
      "isActive": true
    }
  ]
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "menuProductIds must be an array"
  }
}
```

### 4. Missing `priceHalala` for `kind: "item"`

#### Bad Payload

```json
{
  "kind": "item",
  "name": {
    "ar": "عنصر",
    "en": "Item"
  },
  "category": "juice"
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "priceHalala is required for one-time items"
  }
}
```

### 5. Invalid `basePlanId`

#### Bad Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "خطة",
    "en": "Plan"
  },
  "category": "juice",
  "menuProductIds": ["menu_product_id"],
  "planPrices": [
    {
      "basePlanId": "invalid_mongo_id",
      "priceHalala": 1000,
      "isActive": true
    }
  ]
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ID",
    "message": "planPrices[0].basePlanId is not a valid id"
  }
}
```

### 6. Invalid `menuProductId`

#### Bad Payload

```json
{
  "kind": "plan",
  "name": {
    "ar": "خطة",
    "en": "Plan"
  },
  "category": "juice",
  "menuProductIds": ["invalid_mongo_id"],
  "planPrices": [
    {
      "basePlanId": "base_plan_id",
      "priceHalala": 1000,
      "isActive": true
    }
  ]
}
```

#### Expected

HTTP 400

#### Example Response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ID",
    "message": "menuProductIds is not a valid id"
  }
}
```

## Frontend UI Guidance

### 1. Add-ons Page Loading

* Call `GET /api/dashboard/addons`.
* Render `data.items` as one-time add-on items.
* Render `data.plans` as subscription add-on plans.
* Render plan category select from `data.meta.addonPlanCategories`.
* Do not call `/api/dashboard/addon-prices` to render the main page.

### 2. Item Table/Card

For each item show:

* Arabic/English name
* category
* `priceLabel`
* active status
* edit action
* toggle action
* delete action

### 3. Plan Table/Card

For each plan show:

* Arabic/English name
* category label from `data.meta.addonPlanCategories`
* `menuProductsCount`
* `planPricesCount`
* active status
* linked menu products preview
* plan prices by base plan
* edit action
* toggle action
* delete action

### 4. Editing an Add-on Plan

Use one form that edits:

* `name.ar`
* `name.en`
* `category`
* `maxPerDay`
* `menuProductIds`
* `planPrices`
* `isActive`

Submit the whole form to:

```http
PUT /api/dashboard/addons/:id
```

Do not submit separate pricing-row requests for normal plan editing.

### 5. Pricing UI Rules

* Use `priceHalala` in payloads.
* Display `priceLabel` from API responses.
* Do not calculate add-on subscription plan totals in frontend.
* Do not multiply matrix price by days or meals.
* Do not use MenuProduct prices as subscription add-on prices.
* Do not use one-time item prices as subscription add-on plan prices.

### 6. Linked Product UI Rules

* `menuProducts[]` are selectable products under a plan.
* They are not subscription plan cards.
* Do not flatten them into top-level add-on plans.
* Use `menuProductIds[]` only when creating/updating an add-on subscription plan.

## Customer/Mobile Context

Customer/mobile subscription creation uses:

```http
GET /api/subscriptions/addons/options?planId=:basePlanId
```

This Dashboard contract focuses on Dashboard endpoints.

Important context:

* Mobile/customer chooses add-on subscription plans during subscription creation.
* Daily selection later chooses menu products allowed by the purchased add-on plan.
* Dashboard must not confuse add-on plan IDs with menu product IDs.

## Final Acceptance Checklist

* [ ] I can render the Add-ons page from `GET /api/dashboard/addons` only.
* [ ] I can create a one-time add-on item with `POST /api/dashboard/addons`.
* [ ] I can create a subscription add-on plan with linked `menuProductIds` and `planPrices` in one request.
* [ ] I can update a subscription add-on plan with one `PUT /api/dashboard/addons/:id` request.
* [ ] I use `data.meta.addonPlanCategories` for the category select.
* [ ] I do not hardcode add-on category labels.
* [ ] I do not call `/api/dashboard/addon-prices` to render the main screen.
* [ ] I do not multiply add-on plan price by days or meals.
* [ ] I do not flatten `menuProducts` as top-level add-ons.
* [ ] I block add-on plan submit when `menuProductIds` is empty.
* [ ] I block add-on plan submit when `planPrices` is empty.