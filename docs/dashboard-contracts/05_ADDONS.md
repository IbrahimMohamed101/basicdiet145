# Dashboard Add-ons Contract

This contract defines how the Dashboard frontend should render and manage add-on items, add-on subscription plans, linked menu products, and plan-based add-on pricing.

## Core Concepts

### 1. Add-on Item
* A one-time sellable item.
* Appears under `data.items`.
* Has direct price fields such as `priceHalala`, `priceSar`, `priceLabel`.
* Uses `kind: "item"`.
* Backend derives `type: "one_time"`.

### 2. Add-on Subscription Plan
* A subscription add-on selected with a base subscription plan.
* Appears under `data.plans`.
* Uses `kind: "plan"`.
* Backend derives `type: "subscription"`.
* Does not use direct price as the source of truth.
* Uses `planPrices[]` for pricing by base subscription plan.
* Has linked `menuProducts[]` that define what the customer can select later.

### 3. Linked Menu Products
* These are nested under each add-on subscription plan.
* They are not top-level add-on purchase cards.
* The dashboard uses them to show/edit which products belong to an add-on plan.
* Example: Juice Subscription can include Orange Juice, Apple Juice, Mango Juice.
* Example: Small Salad Subscription can include Green Salad - 100g.

### 4. Plan Prices
* Nested under each add-on subscription plan as `planPrices[]`.
* Each row maps one add-on plan to one base subscription plan.
* Price is flat package price for that base plan.
* Do not multiply by days or meals in frontend.
* Do not calculate final quote in frontend.

## Primary Dashboard Read Endpoint

GET `/api/dashboard/addons`

**Purpose**: 
Loads the full Add-ons dashboard screen.

The dashboard must use this endpoint as the main source of truth for:
* one-time add-on items
* subscription add-on plans
* linked menu products
* pricing matrix rows
* category select options
* summary counts

**Important**: The Dashboard frontend should not call `/api/dashboard/addon-prices` to render the main Add-ons screen.

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

*Note: All IDs in examples are placeholders. The dashboard must use IDs returned by the relevant read/picker endpoints:*
* *add-on IDs from `GET /api/dashboard/addons`*
* *menu product IDs from the menu products picker endpoint*
* *base plan IDs from the base plans picker endpoint*

### Field Reference Table

**`data.items[]`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Unique identifier | Used for updates/toggles | Read-only |
| `kind` | string | Always `"item"` | Differentiates items from plans | Read-only |
| `type` | string | Always `"one_time"` | Derived type | Read-only |
| `name` | object | Localized `{ ar, en }` name | Display in lists | Writeable |
| `category` | string | Add-on category | Display / Edit | Writeable |
| `priceHalala`| number | Price in halala | Edit field value | Writeable |
| `priceSar` | number | Price in SAR | Display | Read-only |
| `priceLabel` | string | Formatted price string | Display | Read-only |
| `currency` | string | Currency code | Display context | Read-only |
| `isActive` | boolean | Toggle status | Status badge / toggle | Writeable |

**`data.plans[]`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Unique identifier | Used for updates/toggles | Read-only |
| `kind` | string | Always `"plan"` | Differentiates plans from items | Read-only |
| `type` | string | Always `"subscription"` | Derived type | Read-only |
| `name` | object | Localized `{ ar, en }` name | Display in lists | Writeable |
| `category` | string | Plan category | Display / Edit | Writeable |
| `maxPerDay` | number | Daily entitlement limit | Edit field value | Writeable |
| `pricingMode`| string | `"base_plan_matrix"` | Internal mode | Read-only |
| `menuProductIds` | array | Linked product IDs | Form submission payload | Writeable |
| `menuProductsCount` | number | Total linked products | Summary display | Read-only |
| `planPricesCount` | number | Total pricing matrix rows | Summary display | Read-only |
| `isActive` | boolean | Toggle status | Status badge / toggle | Writeable |

**`data.plans[].menuProducts[]`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Product ID | Matches `menuProductIds` | Read-only |
| `key` | string | Internal unique key | Context | Read-only |
| `name` | object | Localized `{ ar, en }` name | Display in product lists | Read-only |
| `image` | string | Product image URL | Thumbnail display | Read-only |
| `category` | string | Menu category (e.g. `drinks`) | Grouping | Read-only |
| `isActive` | boolean | Product active status | Filtering / Warning | Read-only |

**`data.plans[].planPrices[]`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `id` / `_id` | string | Matrix row ID | Identifying the row | Read-only |
| `addonPlanId` | string | ID of this plan | Context | Read-only |
| `basePlanId` | string | Target base plan ID | Form submission payload | Writeable |
| `basePlanName` | object | Localized name of base plan| Label for pricing row | Read-only |
| `daysCount` | number | Base plan days | Context | Read-only |
| `mealsCount` | number | Base plan meals | Context | Read-only |
| `basePlanPriceHalala` | number | Price of base plan | Context | Read-only |
| `priceHalala`| number | Flat addon package price | Edit field value | Writeable |
| `priceSar` | number | Addon package price (SAR) | Display | Read-only |
| `priceLabel` | string | Addon package price label | Display | Read-only |
| `currency` | string | Currency code | Context | Read-only |
| `isActive` | boolean | Status of pricing row | Toggle | Writeable |

**`data.meta.addonPlanCategories[]`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `key` | string | Strict category value | Internal select value | Read-only |
| `label` | object | Localized `{ ar, en }` name | Select option text | Read-only |
| `description`| object | Localized `{ ar, en }` desc | Select option subtext | Read-only |

**`data.summary`**
| Field | Type | Meaning | Frontend Usage | Read/Write |
|---|---|---|---|---|
| `itemsCount` | number | Rendered items | Info display | Read-only |
| `plansCount` | number | Rendered plans | Info display | Read-only |
| `matrixRowsCount` | number | Total pricing rows | Info display | Read-only |
| `currency` | string | Default currency | Context | Read-only |

## Category Rules

For add-on subscription plans, category is a strict backend-defined enum.

**Allowed values**:
* `juice`
* `small_salad`
* `snack`

Dashboard must render the plan category field as a Select using:
`data.meta.addonPlanCategories`

**Important distinction**:
* `plan.category` is the add-on entitlement category.
* `menuProducts[].category` is the menu product catalog category.
* These are different concepts and must not be mixed.

Do not hardcode category labels in frontend if backend provides `meta.addonPlanCategories`.

**Invalid examples**:
* `proteins`
* `sandwiches`
* `addons`
* `salads`
* `desert`

These must not be sent as add-on plan categories.

## Create Add-on Item

POST `/api/dashboard/addons`

Use this when creating a one-time add-on item.

**Payload**:
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

**Rules**:
* `kind` is required.
* `name.ar` and `name.en` are required.
* `priceHalala` is required for `kind: "item"`.
* `priceHalala` is integer halala.
* `priceSar` and `priceLabel` are read-only response fields.
* Backend derives `type: "one_time"`.

**Expected success response**:
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

POST `/api/dashboard/addons`

Use this when creating a subscription add-on plan with linked menu products and pricing matrix rows in one request.

**Payload**:
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

**Rules**:
* `kind` is required.
* `kind` must be `"plan"`.
* `category` must be one of `juice`, `small_salad`, `snack`.
* `menuProductIds` are required for `kind: "plan"`.
* `planPrices` are required for `kind: "plan"`.
* `planPrices[].basePlanId` is required.
* `planPrices[].priceHalala` is required.
* `priceHalala` at top level is not the pricing source for `kind: "plan"`.
* Frontend must not multiply add-on plan prices by days or meals.
* Backend derives `type: "subscription"`.

**Expected success response**:
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
        "name": { "ar": "عصير برتقال", "en": "Orange Juice" },
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
        "basePlanName": { "ar": "اشتراك 7 أيام", "en": "7-Day Meal Subscription" },
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

PUT `/api/dashboard/addons/:id`

Use this to update a one-time add-on item.

**Payload**:
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

**Rules**:
* Send the full current editable item state.
* `priceHalala` remains the direct item price.
* Response returns the updated item.

## Update Add-on Subscription Plan

PUT `/api/dashboard/addons/:id`

Use this to update a subscription add-on plan and its aggregate relations in one request.

**Payload**:
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

**Rules**:
* This request updates plan metadata, linked menu products, and plan prices.
* Frontend should not call separate pricing-row endpoints for normal plan editing.
* Response returns the updated full plan with nested `menuProducts` and `planPrices`.

## Toggle / Delete / Status

* `PATCH /api/dashboard/addons/:id/toggle`
  * **Purpose**: Toggles the `isActive` status of an add-on item or plan.
  * **Payload**: None required.
  * **Expected success response**: Returns the updated add-on object with the new `isActive` boolean.
  * **Frontend behavior**: Automatically updates the status without requiring a full re-fetch or form submission.

* `DELETE /api/dashboard/addons/:id`
  * **Purpose**: Soft-deactivates an add-on item or plan.
  * **Payload**: None required.
  * **Expected success response**:
    ```json
    {
      "status": true,
      "data": {
        "id": "addon_id_example",
        "isActive": false
      }
    }
    ```
  * **Frontend behavior**: Removes the item/plan from the active view or marks it as deleted/disabled in the UI.

## Secondary Pricing Row Endpoints

The endpoints for `/api/dashboard/addon-prices` are for **secondary/advanced use only**.

**Important wording**:
The Dashboard Add-ons screen should use `GET /api/dashboard/addons` as its main read model.
The main Add-ons page must not use `/api/dashboard/addon-prices` for rendering.
Normal add-on plan create/update operations must use the primary `/api/dashboard/addons` endpoints with nested `planPrices` arrays.

**Usage context**:
These endpoints are designed for bulk pricing updates or specialized matrix inspection tools, not for standard plan configuration.

## Validation Errors

### 1. Unknown plan category

**Payload**:
```json
{
  "kind": "plan",
  "name": { "ar": "خطة", "en": "Plan" },
  "category": "proteins"
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "category must be one of: juice, snack, small_salad"
  }
}
```

### 2. Missing planPrices for kind: "plan"

If `planPrices` is sent but is not an array:

**Payload**:
```json
{
  "kind": "plan",
  "name": { "ar": "خطة", "en": "Plan" },
  "category": "juice",
  "planPrices": "invalid_type"
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "planPrices must be an array"
  }
}
```

*(Note: If `planPrices` is omitted entirely, the backend accepts the payload and creates a plan with zero pricing rows. The dashboard frontend should enforce the presence of prices before submission.)*

### 3. Missing menuProductIds for kind: "plan"

If `menuProductIds` is sent but is not an array (during an update):

**Payload**:
```json
{
  "menuProductIds": "invalid_type"
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "menuProductIds must be an array"
  }
}
```

*(Note: If omitted entirely during creation, the backend defaults to an empty array without throwing an error.)*

### 4. Missing priceHalala for kind: "item"

**Payload**:
```json
{
  "kind": "item",
  "name": { "ar": "عنصر", "en": "Item" },
  "category": "juice"
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "priceHalala is required for one-time items"
  }
}
```

### 5. Invalid basePlanId

**Payload**:
```json
{
  "kind": "plan",
  "name": { "ar": "خطة", "en": "Plan" },
  "category": "juice",
  "planPrices": [
    {
      "basePlanId": "invalid_mongo_id",
      "priceHalala": 1000
    }
  ]
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ID",
    "message": "planPrices[0].basePlanId is not a valid id"
  }
}
```

### 6. Invalid menuProductId

**Payload**:
```json
{
  "kind": "plan",
  "name": { "ar": "خطة", "en": "Plan" },
  "category": "juice",
  "menuProductIds": ["invalid_mongo_id"]
}
```

**Expected**: HTTP 400

**Example response**:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ID",
    "message": "menuProductIds is not a valid id"
  }
}
```

## Menu Products Picker Source

**Endpoint**: `GET /api/dashboard/menu/products`
**Method**: `GET`

**Purpose**: Fetches the list of all available menu products in the catalog. The dashboard uses this to populate the multi-select dropdown for linking products to add-on subscription plans.

**Minimal response shape**:
```json
{
  "status": true,
  "data": [
    {
      "id": "menu_product_id_example",
      "_id": "menu_product_id_example",
      "key": "orange_juice",
      "name": { "ar": "عصير برتقال", "en": "Orange Juice" },
      "category": "drinks",
      "isActive": true
    }
  ]
}
```

**Frontend guidance**: 
* Render a multi-select list using `name` and `category` from the response.
* Use `data[].id` as the selected values.
* The selected values are submitted as `menuProductIds[]` in `POST` / `PUT` `/api/dashboard/addons`.

## Base Plans Picker Source

**Endpoint**: `GET /api/dashboard/plans`
**Method**: `GET`

**Purpose**: Fetches the list of base subscription plans. The dashboard uses this to render the pricing matrix configuration rows for add-on subscription plans.

**Minimal response shape**:
```json
{
  "status": true,
  "data": [
    {
      "id": "base_plan_id_example",
      "_id": "base_plan_id_example",
      "name": { "ar": "اشتراك 7 أيام", "en": "7-Day Meal Subscription" },
      "isActive": true
    }
  ]
}
```

**Frontend guidance**:
* Filter for active, sellable base plans.
* For every sellable base subscription plan, render one matrix row containing: `basePlanId + priceHalala + isActive`.
* Use `data[].id` from the picker response as the `planPrices[].basePlanId` when submitting the matrix to `POST` / `PUT` `/api/dashboard/addons`.

## Frontend UI Guidance

1. **Add-ons page loading**:
   * Call `GET /api/dashboard/addons`.
   * Render `data.items` as one-time add-on items.
   * Render `data.plans` as subscription add-on plans.
   * Render plan category select from `data.meta.addonPlanCategories`.

2. **Plan card/table**:
   For each plan show:
   * name
   * category label
   * menuProductsCount
   * planPricesCount
   * isActive
   * planPrices by base plan

3. **Item card/table**:
   For each item show:
   * name
   * category
   * priceLabel
   * isActive

4. **Editing plan**:
   Use one form that edits:
   * name
   * category
   * maxPerDay
   * menuProductIds
   * planPrices
   * isActive
   
   Submit the whole form to: `PUT /api/dashboard/addons/:id`

5. **Pricing**:
   * Use `priceHalala` internally in payload.
   * Display `priceLabel` from response.
   * Do not calculate add-on subscription plan totals in frontend.
   * Do not multiply matrix price by days/meals.

6. **Linked products**:
   * `menuProducts[]` are selectable products under a plan.
   * They are not subscription plan cards.
   * Do not flatten them into top-level add-on plans.

## Customer/Mobile Context

Customer/mobile subscription creation uses:
GET `/api/subscriptions/addons/options?planId=:basePlanId`

*Note: This dashboard document focuses on Dashboard endpoints.*

**Important context**:
* Mobile/customer chooses add-on plans during subscription creation.
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
