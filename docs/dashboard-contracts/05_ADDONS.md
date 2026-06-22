# Dashboard Add-on Subscription Plans CRUD, Linking & Pricing Contract

This is the frontend/Postman contract for the Dashboard Add-ons page.

The page manages add-on **subscription plans**. It may create, list, update, archive, and toggle those plans. It links products that already exist in Menu/Catalog and saves an add-on price for each selected base subscription plan.

It does not create, edit, or delete menu products. It also does not calculate customer quotes or manage customer daily selections.

## Postman setup

### Base URL

```text
{{baseUrl}}/api
```

Local example:

```text
http://localhost:3000/api
```

### Required headers

All seven endpoints require an authenticated Dashboard user with the `admin` or `superadmin` role.

```http
Authorization: Bearer {{dashboardAccessToken}}
Accept: application/json
Content-Type: application/json
Accept-Language: en
```

`Content-Type` is only necessary for requests with a JSON body. `Accept-Language` may be `en` or `ar`; it affects localized picker fields such as the base-plan `name`.

### Common success and error envelopes

Successful requests use:

```json
{
  "status": true,
  "data": {}
}
```

Validation, authorization, and not-found errors use:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "Human-readable error message"
  }
}
```

Common HTTP statuses:

| Status | Meaning |
| --- | --- |
| `200` | Read, update, toggle, or archive succeeded |
| `201` | Add-on subscription plan created |
| `400` | Invalid path ID, payload, query, linked product, or base plan |
| `401` | Missing, invalid, expired, or revoked dashboard token |
| `403` | Dashboard user does not have permission |
| `404` | Requested add-on plan does not exist |
| `409` | Conflict, when returned by an underlying uniqueness rule |
| `500` | Unexpected server error |

## Endpoint summary

| # | Method | Endpoint | Add-ons page usage |
| --- | --- | --- | --- |
| 1 | GET | `/api/dashboard/addons` | Load all manageable add-on subscription plans |
| 2 | POST | `/api/dashboard/addons` | Create and link a new add-on subscription plan |
| 3 | PUT | `/api/dashboard/addons/:id` | Replace editable plan state, product links, and prices |
| 4 | DELETE | `/api/dashboard/addons/:id` | Safely archive a plan |
| 5 | PATCH | `/api/dashboard/addons/:id/toggle` | Toggle active/inactive |
| 6 | GET | `/api/dashboard/menu/products?view=picker` | Select existing menu products |
| 7 | GET | `/api/dashboard/plans?view=picker` | Select base plans for matrix pricing |

---

## 1. GET `/api/dashboard/addons`

Loads every add-on subscription plan needed for administration, including active, inactive, archived, and plans that do not yet have pricing rows. This is an administrative read model; the separate public add-on endpoint still exposes only available plans.

### Postman request

```http
GET {{baseUrl}}/api/dashboard/addons
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

### Query parameters

`status` accepts `active`, `inactive`, `archived`, or `all`. The default is `all`, making the unfiltered dashboard request management-safe.

### Request body

None.

### `200 OK` response

```json
{
  "status": true,
  "data": {
    "plans": [
      {
        "id": "68556cc945b68c8b4fd10001",
        "name": {
          "ar": "اشتراك الزبادي",
          "en": "Yogurt Subscription"
        },
        "category": "snack",
        "kind": "plan",
        "type": "subscription",
        "maxPerDay": 1,
        "isActive": true,
        "isArchived": false,
        "archivedAt": null,
        "menuProductIds": [
          "68556cc945b68c8b4fd20001",
          "68556cc945b68c8b4fd20002"
        ],
        "menuProducts": [
          {
            "id": "68556cc945b68c8b4fd20001",
            "key": "plain_yogurt",
            "name": {
              "ar": "زبادي سادة",
              "en": "Plain Yogurt"
            },
            "category": "snacks",
            "image": "https://cdn.example.com/plain-yogurt.jpg",
            "isActive": true
          },
          {
            "id": "68556cc945b68c8b4fd20002",
            "key": "greek_yogurt",
            "name": {
              "ar": "زبادي يوناني",
              "en": "Greek Yogurt"
            },
            "category": "snacks",
            "image": "https://cdn.example.com/greek-yogurt.jpg",
            "isActive": true
          }
        ],
        "planPrices": [
          {
            "basePlanId": "68556cc945b68c8b4fd30001",
            "basePlanName": {
              "ar": "خطة 7 أيام",
              "en": "7 Day Plan"
            },
            "daysCount": 7,
            "mealsCount": 14,
            "priceHalala": 7000,
            "priceSar": 70,
            "priceLabel": "70 SAR",
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
          }
        },
        {
          "key": "small_salad",
          "label": {
            "ar": "اشتراك السلطة الصغيرة",
            "en": "Small Salad Subscription"
          }
        },
        {
          "key": "snack",
          "label": {
            "ar": "اشتراك السناك",
            "en": "Snack Subscription"
          }
        }
      ]
    },
    "summary": {
      "plansCount": 1,
      "matrixRowsCount": 1,
      "currency": "SAR"
    }
  }
}
```

### Response field meanings

| Field | Type | Meaning |
| --- | --- | --- |
| `data.plans` | array | Manageable add-on subscription plans |
| `id` | string | Add-on plan ID used by PUT, DELETE, and toggle |
| `name.ar`, `name.en` | string | Arabic and English plan names |
| `category` | string | `juice`, `snack`, or `small_salad` |
| `maxPerDay` | number | Maximum add-on selections allowed per day |
| `kind`, `type` | string | Plan discriminators (`plan` and normally `subscription`) |
| `isActive` | boolean | Current availability toggle |
| `isArchived` | boolean | Whether DELETE has soft-archived the plan |
| `archivedAt` | string/null | Archive timestamp |
| `menuProductIds` | string[] | IDs the frontend submits back when saving |
| `menuProducts` | array | Populated display data for linked products |
| `planPrices` | array | Add-on pricing rows per base subscription plan |
| `priceHalala` | integer | Canonical writable amount in halala; `7000` means SAR 70 |
| `priceSar` | number | Display conversion of `priceHalala / 100` |
| `priceLabel` | string | Ready-to-display SAR label |
| `daysCount` | number | Number of days in the referenced base plan |
| `mealsCount` | number | Derived meal count for the referenced base plan |
| `data.meta.addonPlanCategories` | array | Allowed category select options |
| `data.summary.plansCount` | integer | Number of returned plans |
| `data.summary.matrixRowsCount` | integer | Total returned `planPrices` rows across all plans |

There is no `data.items` in the lean response. Internal fields such as `_id`, `pricingMode`, `addonPlanId`, timestamps other than `archivedAt`, and `__v` are not returned.

---

## 2. POST `/api/dashboard/addons`

Creates one add-on subscription plan, links existing menu products, and creates its base-plan pricing rows.

POST never creates menu products. Every `menuProductIds[]` value must come from endpoint 6.

### Postman request

```http
POST {{baseUrl}}/api/dashboard/addons
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json
```

### Request body

```json
{
  "name": {
    "ar": "اشتراك الزبادي",
    "en": "Yogurt Subscription"
  },
  "category": "snack",
  "maxPerDay": 1,
  "isActive": true,
  "menuProductIds": [
    "68556cc945b68c8b4fd20001",
    "68556cc945b68c8b4fd20002"
  ],
  "planPrices": [
    {
      "basePlanId": "68556cc945b68c8b4fd30001",
      "priceHalala": 7000,
      "isActive": true
    },
    {
      "basePlanId": "68556cc945b68c8b4fd30002",
      "priceHalala": 14000,
      "isActive": true
    }
  ]
}
```

### Payload contract

| Field | Required | Type | Rules |
| --- | --- | --- | --- |
| `name` | yes | object | Must contain both `ar` and `en` |
| `name.ar` | yes | string | Must be non-empty after trimming |
| `name.en` | yes | string | Must be non-empty after trimming |
| `category` | yes | string | `juice`, `snack`, or `small_salad` |
| `maxPerDay` | no | number | Must be `>= 0`; defaults to `1` |
| `isActive` | no | boolean | Must be a real JSON boolean; defaults to `true` |
| `menuProductIds` | yes | string[] | At least one unique, valid, existing product ID |
| `planPrices` | yes | object[] | At least one row; base-plan IDs must be unique |
| `planPrices[].basePlanId` | yes | string | Valid existing base-plan ID from endpoint 7 |
| `planPrices[].priceHalala` | yes | integer | Numeric JSON value `>= 0`; never submit SAR here |
| `planPrices[].isActive` | no | boolean | Defaults to `true` |

Do not send `kind`, `type`, `pricingMode`, `priceSar`, `priceLabel`, `menuProducts`, or `basePlanName`. The backend derives or populates them.

### `201 Created` response

```json
{
  "status": true,
  "data": {
    "id": "68556cc945b68c8b4fd10001",
    "name": {
      "ar": "اشتراك الزبادي",
      "en": "Yogurt Subscription"
    },
    "category": "snack",
    "maxPerDay": 1,
    "isActive": true,
    "menuProductIds": [
      "68556cc945b68c8b4fd20001",
      "68556cc945b68c8b4fd20002"
    ],
    "menuProducts": [
      {
        "id": "68556cc945b68c8b4fd20001",
        "key": "plain_yogurt",
        "name": {
          "ar": "زبادي سادة",
          "en": "Plain Yogurt"
        },
        "category": "snacks",
        "image": "https://cdn.example.com/plain-yogurt.jpg",
        "isActive": true
      },
      {
        "id": "68556cc945b68c8b4fd20002",
        "key": "greek_yogurt",
        "name": {
          "ar": "زبادي يوناني",
          "en": "Greek Yogurt"
        },
        "category": "snacks",
        "image": "https://cdn.example.com/greek-yogurt.jpg",
        "isActive": true
      }
    ],
    "planPrices": [
      {
        "basePlanId": "68556cc945b68c8b4fd30001",
        "basePlanName": {
          "ar": "خطة 7 أيام",
          "en": "7 Day Plan"
        },
        "daysCount": 7,
        "mealsCount": 14,
        "priceHalala": 7000,
        "priceSar": 70,
        "priceLabel": "70 SAR",
        "isActive": true
      },
      {
        "basePlanId": "68556cc945b68c8b4fd30002",
        "basePlanName": {
          "ar": "خطة 14 يوم",
          "en": "14 Day Plan"
        },
        "daysCount": 14,
        "mealsCount": 28,
        "priceHalala": 14000,
        "priceSar": 140,
        "priceLabel": "140 SAR",
        "isActive": true
      }
    ]
  }
}
```

### Example validation error

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "menuProductIds must contain at least one item"
  }
}
```

Other possible messages include invalid category, invalid ID format, nonexistent linked IDs, duplicate IDs, empty `planPrices`, or negative/non-numeric `priceHalala`.

---

## 3. PUT `/api/dashboard/addons/:id`

Updates an existing add-on subscription plan. `:id` is the plan `id`, not a menu-product ID or base-plan ID.

### Important replacement behavior

Treat PUT as a complete form submission:

- Always send `name`, `category`, `maxPerDay`, `isActive`, and the complete `menuProductIds` array.
- When `planPrices` is supplied, the backend replaces the stored matrix with the supplied rows.
- Omitting `planPrices` keeps the existing matrix.
- Sending `planPrices: []` removes all matrix rows.
- Omitting `menuProductIds` currently results in an empty linked-products array.
- Omitting `maxPerDay` resets it to `1`.
- Omitting `isActive` defaults it to `true`.
- `kind` is not required and should not be sent.

### Postman request

```http
PUT {{baseUrl}}/api/dashboard/addons/68556cc945b68c8b4fd10001
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json
```

### Path parameter

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Existing add-on subscription plan ID |

### Request body

```json
{
  "name": {
    "ar": "اشتراك الزبادي المطور",
    "en": "Updated Yogurt Subscription"
  },
  "category": "snack",
  "maxPerDay": 2,
  "isActive": true,
  "menuProductIds": [
    "68556cc945b68c8b4fd20002"
  ],
  "planPrices": [
    {
      "basePlanId": "68556cc945b68c8b4fd30001",
      "priceHalala": 7500,
      "isActive": true
    }
  ]
}
```

### `200 OK` response

```json
{
  "status": true,
  "data": {
    "id": "68556cc945b68c8b4fd10001",
    "name": {
      "ar": "اشتراك الزبادي المطور",
      "en": "Updated Yogurt Subscription"
    },
    "category": "snack",
    "maxPerDay": 2,
    "isActive": true,
    "menuProductIds": [
      "68556cc945b68c8b4fd20002"
    ],
    "menuProducts": [
      {
        "id": "68556cc945b68c8b4fd20002",
        "key": "greek_yogurt",
        "name": {
          "ar": "زبادي يوناني",
          "en": "Greek Yogurt"
        },
        "category": "snacks",
        "image": "https://cdn.example.com/greek-yogurt.jpg",
        "isActive": true
      }
    ],
    "planPrices": [
      {
        "basePlanId": "68556cc945b68c8b4fd30001",
        "basePlanName": {
          "ar": "خطة 7 أيام",
          "en": "7 Day Plan"
        },
        "daysCount": 7,
        "mealsCount": 14,
        "priceHalala": 7500,
        "priceSar": 75,
        "priceLabel": "75 SAR",
        "isActive": true
      }
    ]
  }
}
```

### `404 Not Found` response

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Addon not found"
  }
}
```

---

## 4. DELETE `/api/dashboard/addons/:id`

Safely archives a subscription plan by setting `isActive=false`, `isArchived=true`, and `archivedAt` to the current time. It does not hard-delete the plan, its pricing rows, product links, subscription entitlements, or selections.

After success, the plan remains in default GET `/api/dashboard/addons` and `?status=all`; use `?status=archived` to request archived plans only.

### Postman request

```http
DELETE {{baseUrl}}/api/dashboard/addons/68556cc945b68c8b4fd10001
Authorization: Bearer {{dashboardAccessToken}}
```

### Path parameter

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Existing add-on subscription plan ID |

### Request body

None. Do not send `{ "confirm": true }` or another body.

### `200 OK` response

```json
{
  "status": true,
  "data": {
    "id": "68556cc945b68c8b4fd10001",
    "archived": true,
    "isActive": false,
    "isArchived": true,
    "archivedAt": "2026-06-22T12:00:00.000Z"
  }
}
```

### `404 Not Found` response

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Addon not found"
  }
}
```

---

## 5. PATCH `/api/dashboard/addons/:id/toggle`

Flips the current `isActive` value:

- `true` becomes `false`.
- `false` becomes `true`.

This is a toggle action, not an explicit-state setter. The frontend should use the boolean returned by the server rather than calculating the final state locally.

### Postman request

```http
PATCH {{baseUrl}}/api/dashboard/addons/68556cc945b68c8b4fd10001/toggle
Authorization: Bearer {{dashboardAccessToken}}
```

### Path parameter

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Existing add-on subscription plan ID |

### Request body

None. An empty `{}` body is tolerated but unnecessary.

### `200 OK` response when toggled off

```json
{
  "status": true,
  "data": {
    "id": "68556cc945b68c8b4fd10001",
    "isActive": false
  }
}
```

### `200 OK` response when toggled on

```json
{
  "status": true,
  "data": {
    "id": "68556cc945b68c8b4fd10001",
    "isActive": true
  }
}
```

Toggling changes only `isActive`; it does not modify pricing rows, linked products, subscriptions, selections, or archive fields. Inactive plans remain available from endpoint 1 by default and through `?status=inactive` or `?status=all`.

---

## 6. GET `/api/dashboard/menu/products`

Returns existing Menu/Catalog products. The Add-ons page uses these records only as link targets.

### Recommended Add-ons picker request

```http
GET {{baseUrl}}/api/dashboard/menu/products?view=picker&availableFor=subscription&isVisible=true&isAvailable=true
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

### Request body

None.

### Useful query parameters

| Query | Type | Meaning |
| --- | --- | --- |
| `view=picker` | string | Returns the lean six-field picker DTO and forces `isActive=true` |
| `availableFor=subscription` | string | Returns products enabled for subscription usage |
| `categoryId` | string | Filters by Menu Category ID |
| `q` or `search` | string | Searches product key, Arabic name, or English name |
| `isVisible` | boolean-like string | Filter by dashboard visibility |
| `isAvailable` | boolean-like string | Filter by availability |
| `itemType` | string | Filter by product item type |
| `page` | positive integer | Enables pagination; defaults to page `1` |
| `limit` | integer `1..100` | Enables pagination; defaults to `25`, maximum `100` |

### `200 OK` picker response without pagination

```json
{
  "status": true,
  "data": [
    {
      "id": "68556cc945b68c8b4fd20001",
      "key": "plain_yogurt",
      "name": {
        "ar": "زبادي سادة",
        "en": "Plain Yogurt"
      },
      "category": "snacks",
      "image": "https://cdn.example.com/plain-yogurt.jpg",
      "isActive": true
    }
  ]
}
```

The frontend stores `data[index].id` in the add-on plan's `menuProductIds`. It should display `name`, `category`, and `image` but must not submit the populated product object to POST or PUT.

### `200 OK` picker response with `page` or `limit`

Request:

```http
GET {{baseUrl}}/api/dashboard/menu/products?view=picker&availableFor=subscription&page=1&limit=25
```

Response:

```json
{
  "status": true,
  "data": {
    "items": [
      {
        "id": "68556cc945b68c8b4fd20001",
        "key": "plain_yogurt",
        "name": {
          "ar": "زبادي سادة",
          "en": "Plain Yogurt"
        },
        "category": "snacks",
        "image": "https://cdn.example.com/plain-yogurt.jpg",
        "isActive": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1,
      "pages": 1
    }
  }
}
```

### Response without `view=picker`

Without picker mode, this is the general Menu Dashboard endpoint and returns full menu-product model fields. It may include `_id`, category/catalog links, descriptions, price fields, availability flags, UI metadata, timestamps, and `__v`. The Add-ons page should use `view=picker` to avoid depending on that larger contract.

### Example invalid-filter response

```json
{
  "ok": false,
  "error": {
    "code": "MENU_VALIDATION_ERROR",
    "message": "availableFor contains an unsupported channel"
  }
}
```

---

## 7. GET `/api/dashboard/plans`

Returns base subscription plans. The Add-ons page uses each selected plan ID as `planPrices[].basePlanId` and asks the administrator for the add-on `priceHalala` for that base plan.

### Recommended Add-ons picker request

```http
GET {{baseUrl}}/api/dashboard/plans?view=picker
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

`view=picker` defaults to active plans only.

### Request body

None.

### Picker query parameters

| Query | Type | Meaning |
| --- | --- | --- |
| `view=picker` | string | Returns the lean base-plan picker DTO |
| `q` or `search` | string | Searches plan ID, Arabic/English name, days, grams, or meals/day |
| `status` | string | `active`, `inactive`, or `all` |
| `isActive` | boolean-like string | Alternative to `status`; picker defaults it to `true` |

### `200 OK` picker response

With `Accept-Language: en`:

```json
{
  "status": true,
  "data": [
    {
      "id": "68556cc945b68c8b4fd30001",
      "name": "7 Day Plan",
      "daysCount": 7,
      "mealsCount": 14,
      "isActive": true
    },
    {
      "id": "68556cc945b68c8b4fd30002",
      "name": "14 Day Plan",
      "daysCount": 14,
      "mealsCount": 28,
      "isActive": true
    }
  ]
}
```

With `Accept-Language: ar`, `name` is the localized Arabic string. Unlike product-picker `name`, plan-picker `name` is a **string**, not `{ ar, en }`.

The frontend uses:

```json
{
  "basePlanId": "68556cc945b68c8b4fd30001",
  "priceHalala": 7000,
  "isActive": true
}
```

inside POST or PUT. `daysCount` and `mealsCount` are display-only and must not be submitted in `planPrices`.

### Response without `view=picker`

Without picker mode, the endpoint returns the full Plans Dashboard contract:

```json
{
  "status": true,
  "data": [
    {
      "_id": "68556cc945b68c8b4fd30001",
      "name": {
        "ar": "خطة 7 أيام",
        "en": "7 Day Plan"
      },
      "description": {
        "ar": "",
        "en": ""
      },
      "daysCount": 7,
      "durationDays": 7,
      "currency": "SAR",
      "gramsOptions": [],
      "skipPolicy": {
        "enabled": true,
        "maxDays": 0
      },
      "freezePolicy": {
        "enabled": true,
        "maxDays": 31,
        "maxTimes": 1
      },
      "active": true,
      "available": true,
      "isAvailable": true,
      "isActive": true,
      "sortOrder": 0,
      "createdAt": "2026-06-20T10:00:00.000Z",
      "updatedAt": "2026-06-20T10:00:00.000Z",
      "__v": 0,
      "pricing": {
        "startsFromHalala": 0,
        "startsFromSar": 0,
        "compareAtStartsFromHalala": 0,
        "compareAtStartsFromSar": 0
      }
    }
  ],
  "summary": {
    "totalPlans": 1,
    "activePlans": 1,
    "inactivePlans": 0,
    "averageDaysCount": 7
  },
  "meta": {
    "q": "",
    "status": "all",
    "totalCount": 1,
    "filteredCount": 1
  }
}
```

The exact nested `gramsOptions` contents depend on the base plan. The Add-ons page should use `view=picker` and must not depend on the full administrative plan model.

### Invalid status response

```json
{
  "ok": false,
  "error": {
    "code": "INVALID",
    "message": "status must be one of: active, inactive, all"
  }
}
```

---

## Frontend integration flow

1. Call `GET /api/dashboard/menu/products?view=picker&availableFor=subscription&isVisible=true&isAvailable=true`.
2. Call `GET /api/dashboard/plans?view=picker`.
3. Call `GET /api/dashboard/addons` to load current add-on plans.
4. Render product selections using product IDs and render one price input per selected base plan.
5. Convert/display money as needed, but submit the canonical integer `priceHalala`.
6. For create, submit POST with product IDs and base-plan price rows.
7. For edit, submit the complete PUT form state so links or defaults are not accidentally cleared.
8. After POST, PUT, DELETE, or toggle, refresh GET `/api/dashboard/addons`.

## TypeScript reference types

```ts
type LocalizedName = {
  ar: string;
  en: string;
};

type AddonCategory = "juice" | "snack" | "small_salad";

type AddonMenuProduct = {
  id: string;
  key: string;
  name: LocalizedName;
  category: string;
  image: string;
  isActive: boolean;
};

type AddonPlanPrice = {
  basePlanId: string;
  basePlanName: LocalizedName;
  daysCount: number;
  mealsCount: number;
  priceHalala: number;
  priceSar: number;
  priceLabel: string;
  isActive: boolean;
};

type AddonPlan = {
  id: string;
  name: LocalizedName;
  category: AddonCategory;
  maxPerDay: number;
  isActive: boolean;
  menuProductIds: string[];
  menuProducts: AddonMenuProduct[];
  planPrices: AddonPlanPrice[];
};

type AddonPlanWritePayload = {
  name: LocalizedName;
  category: AddonCategory;
  maxPerDay?: number;
  isActive?: boolean;
  menuProductIds: string[];
  planPrices: Array<{
    basePlanId: string;
    priceHalala: number;
    isActive?: boolean;
  }>;
};

type MenuProductPickerItem = {
  id: string;
  key: string;
  name: LocalizedName;
  category: string;
  image: string;
  isActive: boolean;
};

type BasePlanPickerItem = {
  id: string;
  name: string;
  daysCount: number;
  mealsCount: number;
  isActive: boolean;
};
```
