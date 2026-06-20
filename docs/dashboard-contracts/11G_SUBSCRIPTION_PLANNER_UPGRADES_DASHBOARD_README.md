# 11G — Subscription Planner Upgrades Dashboard API Contract

This document provides the exact Postman-style API contract for the Subscription Planner Upgrades / Meal Builder Dashboard. It contains detailed documentation of all payloads, path parameters, query parameters, headers, success responses, error cases, and field-level descriptions to ensure seamless frontend integration.

---

## Postman Setup & Globals

### Base URL
```text
{{baseUrl}}/api
```
*Local environment example:* `http://localhost:3000/api`

### Required Headers
All endpoints listed below require an authenticated Dashboard user session with either the `admin` or `superadmin` role.

```http
Authorization: Bearer {{dashboardAccessToken}}
Accept: application/json
Content-Type: application/json
Accept-Language: en
```
- **Authorization**: Bearer token obtained from the dashboard login flow.
- **Content-Type**: Must be `application/json` for writing operations (`POST`, `PUT`).
- **Accept-Language**: Controls localization of hydrated catalogs and labels. Supported values: `en`, `ar` (defaults to `en`).

---

## Global Envelopes & Error Structures

### Common Success Envelope
All successful requests return an HTTP status code `200` (or `201` for creation) and follow this standard JSON envelope:
```json
{
  "status": true,
  "data": {}
}
```

### Common Error Envelope
If a request fails validation, authorization, or encounters an internal error, it returns a non-2xx HTTP status and a standard error envelope:
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description.",
    "details": {}
  }
}
```

### HTTP Status Codes
| Status | Meaning |
| :--- | :--- |
| `200` | Request succeeded. Returns the requested resource or result. |
| `201` | Resource successfully created (returned by `POST /draft`). |
| `400` | Bad Request. Invalid payload, query parameter, or malformed ObjectId. |
| `401` | Unauthorized. Missing, expired, or invalid dashboard token. |
| `403` | Forbidden. Dashboard user does not possess `admin` or `superadmin` roles. |
| `404` | Not Found. Draft, published configuration, or picker section not found. |
| `409` | Conflict. Document version mismatch or uniqueness check constraint violated. |
| `500` | Internal Server Error. Unexpected server exception. |

---

## Endpoint Directory

| # | Method | Path | Description |
| :--- | :--- | :--- | :--- |
| **1** | `GET` | `/api/dashboard/meal-builder` | Retrieve current draft, published config, preview, and validations. |
| **2** | `GET` | `/api/dashboard/meal-builder/draft/hydrated` | Fetch the current draft with fully hydrated options/products and validations. |
| **3** | `POST` | `/api/dashboard/meal-builder/draft` | Create or reset a new current draft (demotes old drafts). |
| **4** | `PUT` | `/api/dashboard/meal-builder/draft` | Replace/update sections in the current draft. |
| **5** | `GET` | `/api/dashboard/meal-builder/pickers/:sectionKey` | Fetch eligible catalog products or options for a specific section key. |
| **6** | `POST` | `/api/dashboard/meal-builder/validate` | Run full validation on either the current draft or an unsaved payload. |
| **7** | `POST` | `/api/dashboard/meal-builder/publish` | Lock the current draft and publish it as the active version. |
| **8** | `GET` | `/api/dashboard/meal-builder/readiness` | Get system deployment and QA readiness checks. |

---

## 1. GET `/api/dashboard/meal-builder`

### Purpose
Load the overall Meal Builder state. This includes the current draft configuration, active published configuration, preview model representation, compatibility `plannerCatalog` consumed by older clients, and validations.

### Postman Request
```http
GET {{baseUrl}}/dashboard/meal-builder
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

### Request Payload
*None.*

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "draft": {
      "id": "665f1b2e7b9a4d0012ba0001",
      "status": "draft",
      "isCurrent": true,
      "contractVersion": "subscription_meal_builder.v1",
      "revisionHash": "",
      "source": "dashboard",
      "notes": "Upgrade choices",
      "sections": [
        {
          "id": "665f1b2e7b9a4d0012ba0999",
          "key": "premium",
          "type": "option_group",
          "source": {
            "kind": "premium_mixed"
          },
          "sortOrder": 10,
          "titleOverride": {
            "ar": "مميز",
            "en": "Premium"
          },
          "selectionType": "premium_meal",
          "required": false,
          "minSelections": 0,
          "maxSelections": 1,
          "multiSelect": false,
          "visible": true,
          "availableFor": ["subscription"],
          "metadata": {},
          "rules": {},
          "selectedOptionIds": ["665f1b2e7b9a4d0012e50001"],
          "selectedProductIds": [],
          "sectionType": "option_group",
          "sourceKind": "premium_visual",
          "productContextId": "665f1b2e7b9a4d0012b20001",
          "sourceGroupId": "665f1b2e7b9a4d0012c30001",
          "sourceCategoryId": null,
          "includeMode": "selected"
        }
      ],
      "createdAt": "2026-06-20T12:00:00.000Z",
      "updatedAt": "2026-06-20T12:10:00.000Z"
    },
    "published": {
      "id": "665f1b2e7b9a4d0012ba0000",
      "status": "published",
      "isCurrent": true,
      "contractVersion": "subscription_meal_builder.v1",
      "revisionHash": "sha256:abc1234567890def...",
      "source": "dashboard",
      "publishedAt": "2026-06-18T10:00:00.000Z",
      "notes": "Initial deployment",
      "sections": []
    },
    "preview": {
      "contractVersion": "subscription_meal_builder.v1",
      "sections": []
    },
    "plannerCatalog": {
      "sections": []
    },
    "validation": {
      "draft": {
        "status": "ready",
        "ready": true,
        "errors": [],
        "warnings": []
      },
      "published": {
        "status": "ready",
        "ready": true,
        "errors": [],
        "warnings": []
      }
    }
  }
}
```

### Response Field Descriptions

#### Base Level Fields
| Field | Type | Description |
| :--- | :--- | :--- |
| `draft` | object \| null | The active working draft. Null if no draft exists. |
| `published` | object \| null | The current live published configuration. Null if none is published. |
| `preview` | object \| null | Read-only app representation computed from the published configuration. |
| `plannerCatalog` | object | The resolved compatibility catalog schema sent to mobile apps. |
| `validation` | object | The validation status of both the draft and the published configs. |

#### Section Object Fields (Inside `draft.sections` / `published.sections`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | string | Mongoose ObjectId of the section block. |
| `key` | string | Canonical identifier (e.g. `"premium"`, `"sandwich"`, `"chicken"`, `"beef"`, `"fish"`, `"eggs"`, `"carbs"`). |
| `type` | string | Canonical layout style: `"mixed"`, `"product_list"`, `"option_family"`, `"option_group"`. |
| `source` | object | Metadata detailing catalog linkages. Contains `kind`, `categoryKey`, `groupKey`, and/or `displayCategoryKey`. |
| `sortOrder` | integer | Number defining layout render order (smaller numbers render first). |
| `titleOverride` | object | Localized custom title object containing Arabic (`ar`) and English (`en`) strings. |
| `selectionType` | string | Evaluates constraints downstream. Expected values: `"premium_meal"`, `"premium_large_salad"`, `"standard_meal"`, `"sandwich"`. |
| `required` | boolean | If `true`, requires selecting an item in this section. |
| `minSelections` | integer | Minimum selections allowed. Must be `>= 0`. |
| `maxSelections` | integer \| null | Maximum selections allowed. If null, selections are unbounded. |
| `multiSelect` | boolean | If `true`, allows selecting multiple candidates. |
| `visible` | boolean | Controls visibility to end-users. |
| `availableFor` | string[] | Array specifying channels. Hardcoded to `["subscription"]`. |
| `metadata` | object | Custom key-value pairs stored in the section. |
| `rules` | object | Writable rules (e.g. standard carb group restrictions). |
| `selectedOptionIds` | string[] | Array of active MenuOption ObjectIds linked to this section. |
| `selectedProductIds` | string[] | Array of active MenuProduct ObjectIds linked to this section. |
| `sectionType` | string | *Deprecated write-field fallback.* (`"option_group"`, `"product_category"`, `"product_list"`). |
| `sourceKind` | string | *Deprecated write-field fallback.* (`""`, `"visual_family"`, `"configurable_product"`, `"product_list"`, `"premium_visual"`). |
| `productContextId` | string \| null | *Deprecated write-field fallback.* Parent product ObjectId for option contexts. |
| `sourceGroupId` | string \| null | *Deprecated write-field fallback.* Source option group ObjectId. |
| `sourceCategoryId` | string \| null | *Deprecated write-field fallback.* Source category ObjectId. |
| `includeMode` | string | *Deprecated write-field fallback.* Selection scope (`"all"` or `"selected"`). |

---

## 2. GET `/api/dashboard/meal-builder/draft/hydrated`

### Purpose
Fetch the current draft config with detailed catalog hydration. This translates selected IDs (`selectedOptionIds` and `selectedProductIds`) into rich catalog nodes (names, availability, prices, warnings, and errors) for visual editing and item diagnostics.

### Postman Request
```http
GET {{baseUrl}}/dashboard/meal-builder/draft/hydrated
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

### Request Payload
*None.*

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "contractVersion": "dashboard_meal_builder_hydrated_draft.v1",
    "draft": {
      "id": "665f1b2e7b9a4d0012ba0001",
      "status": "draft",
      "isCurrent": true,
      "sections": [
        {
          "key": "premium",
          "selectionType": "premium_meal",
          "selectedOptionIds": ["665f1b2e7b9a4d0012e50001"],
          "selectedProductIds": ["665f1b2e7b9a4d0012b20099"],
          "selectedOptions": [
            {
              "id": "665f1b2e7b9a4d0012e50001",
              "optionId": "665f1b2e7b9a4d0012e50001",
              "type": "option",
              "key": "salmon",
              "name": {
                "ar": "سلمون طازج",
                "en": "Fresh Salmon"
              },
              "label": "Fresh Salmon",
              "familyKey": "fish",
              "premiumKey": "salmon",
              "displayCategoryKey": "premium",
              "selectionType": "premium_meal",
              "pricing": {
                "extraPriceHalala": 3000,
                "extraWeightUnitGrams": 0,
                "extraWeightPriceHalala": 0,
                "currency": "SAR"
              },
              "selected": true,
              "eligible": true,
              "linked": true,
              "available": true,
              "active": true,
              "visible": true,
              "published": true,
              "subscriptionEnabled": true,
              "relationExists": true,
              "included": true,
              "includedVia": "product_option_relation",
              "catalogItemAvailable": true,
              "reasonCodes": ["SELECTED", "ELIGIBLE"],
              "warnings": [],
              "errors": []
            }
          ],
          "selectedProducts": [
            {
              "id": "665f1b2e7b9a4d0012b20099",
              "productId": "665f1b2e7b9a4d0012b20099",
              "type": "product",
              "key": "premium_large_salad",
              "name": {
                "ar": "سلطة جامبو مميزة",
                "en": "Premium Large Salad"
              },
              "label": "Premium Large Salad",
              "itemType": "premium_large_salad",
              "categoryId": "665f1b2e7b9a4d0012b20088",
              "categoryKey": "salads",
              "selectionType": "premium_large_salad",
              "configurable": true,
              "pricing": {
                "pricingModel": "fixed",
                "priceHalala": 2500,
                "currency": "SAR"
              },
              "selected": true,
              "eligible": true,
              "linked": true,
              "available": true,
              "active": true,
              "visible": true,
              "published": true,
              "subscriptionEnabled": true,
              "relationExists": true,
              "catalogItemAvailable": true,
              "reasonCodes": ["SELECTED", "ELIGIBLE"],
              "warnings": [],
              "errors": []
            }
          ],
          "items": [
            {
              "id": "665f1b2e7b9a4d0012e50001",
              "type": "option",
              "key": "salmon",
              "label": "Fresh Salmon",
              "available": true,
              "errors": [],
              "warnings": []
            }
          ],
          "hydration": {
            "selectedOptionCount": 1,
            "selectedProductCount": 1,
            "errorCount": 0,
            "warningCount": 0
          }
        }
      ]
    },
    "ready": true,
    "errors": [],
    "warnings": [],
    "sections": [],
    "validation": {
      "status": "ready",
      "ready": true,
      "errors": [],
      "warnings": [],
      "checks": [],
      "summary": {
        "sections": 1,
        "errors": 0,
        "warnings": 0,
        "migratedFromLegacyTemplate": false
      }
    }
  }
}
```

### Hydrated Item Field Descriptions (Inside `selectedOptions` & `selectedProducts`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` / `optionId` / `productId` | string | ObjectId of the entity. |
| `type` | string | `"option"` or `"product"`. |
| `key` | string | String identifier (e.g. `"salmon"`, `"premium_large_salad"`). |
| `name` | object | Multi-language localized name object `{ ar, en }`. |
| `label` | string | Single localized string chosen according to the `Accept-Language` header. |
| `familyKey` | string | (*Options only*) The associated protein family (`"chicken"`, `"beef"`, `"fish"`, `"eggs"`). |
| `premiumKey` | string | (*Options only*) The option's premium identifier (must match catalog configuration). |
| `pricing` | object | Financial details in Halala. Contains `priceHalala`, `extraPriceHalala`, and `currency` (`SAR`). |
| `selected` | boolean | Indicates if the item is currently selected in the draft. |
| `eligible` | boolean | `true` if the item passes all validation rules for inclusion. |
| `linked` | boolean | Indicates if correct database relations exist between the parent product and group/option. |
| `available` | boolean | Reflects active status, availability flags, and visibility. |
| `active` | boolean | Raw model `isActive` value. |
| `visible` | boolean | Raw model `isVisible` value. |
| `published` | boolean | `true` if the item has been released to the catalog. |
| `subscriptionEnabled` | boolean | `true` if this item is marked for subscription channels. |
| `relationExists` | boolean | Product-Group-Option relation is present in the database. |
| `catalogItemAvailable` | boolean | global ledger visibility verification. |
| `reasonCodes` | string[] | Array of state flags (e.g., `["SELECTED", "ELIGIBLE"]`). |
| `errors` | object[] | Critical errors blocking the publication of this item (e.g., missing price overrides). |
| `warnings` | object[] | Non-blocking issues or configuration discrepancies. |
| `state` | string | UI status helper: `"selected"`, `"eligible"`, `"addable"`, `"not_linked"`, `"unavailable"`, or `"invalid"`. |

---

## 3. POST `/api/dashboard/meal-builder/draft`

### Purpose
Initialize or reset the current Meal Builder draft. Sending an empty array of `sections` (or omitting them) will cause the backend to generate the default visual layout structure (encompassing standard protein families, premium visual upgrades, sandwiches, and carbs). Any pre-existing draft will have its `isCurrent` flag set to `false`.

### Postman Request
```http
POST {{baseUrl}}/dashboard/meal-builder/draft
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json
```

### Request Body
```json
{
  "notes": "Upgraded catalog pricing template",
  "sections": [
    {
      "key": "premium",
      "sectionType": "option_group",
      "sourceKind": "premium_visual",
      "productContextId": "665f1b2e7b9a4d0012b20001",
      "sourceGroupId": "665f1b2e7b9a4d0012c30001",
      "selectedOptionIds": ["665f1b2e7b9a4d0012e50001"],
      "selectedProductIds": ["665f1b2e7b9a4d0012b20099"],
      "includeMode": "selected",
      "selectionType": "premium_meal",
      "sortOrder": 10,
      "required": false,
      "minSelections": 0,
      "maxSelections": 1,
      "multiSelect": false,
      "visible": true,
      "availableFor": ["subscription"],
      "metadata": {},
      "rules": {}
    }
  ]
}
```

### Payload Validation Rules
- `notes`: Optional string description.
- `sections`: Optional array. If omitted, the default Visual Template is seeded.
- **Section Validation**:
  - `key`: Required non-empty string.
  - `sectionType`: Must be `"option_group"`, `"product_category"`, or `"product_list"`.
  - `sourceKind`: Must be `""`, `"visual_family"`, `"configurable_product"`, `"product_list"`, or `"premium_visual"`.
  - `includeMode`: Must be `"all"` or `"selected"`.
  - `minSelections`: Must be an integer `>= 0`.
  - `maxSelections`: Must be null or an integer `>= minSelections`.
  - `availableFor`: Must be exactly `["subscription"]`.
  - **Option Group constraints**: If `sectionType === "option_group"`, both `productContextId` and `sourceGroupId` must be valid, existing ObjectIds.
  - **Category constraints**: If `sectionType === "product_category"`, `sourceCategoryId` must be a valid, existing ObjectId.
  - **Product List constraints**: If `sectionType === "product_list"` and `includeMode === "selected"`, `selectedProductIds` must contain at least one valid ObjectId.

### Success Response (`201 Created`)
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012ba0001",
    "status": "draft",
    "isCurrent": true,
    "contractVersion": "subscription_meal_builder.v1",
    "notes": "Upgraded catalog pricing template",
    "sections": [
      {
        "key": "premium",
        "selectionType": "premium_meal",
        "selectedOptionIds": ["665f1b2e7b9a4d0012e50001"],
        "selectedProductIds": ["665f1b2e7b9a4d0012b20099"]
      }
    ],
    "publishedAt": null
  }
}
```

### Example Validation Error (`400 Bad Request`)
```json
{
  "ok": false,
  "error": {
    "code": "MEAL_BUILDER_INVALID_SECTION_REFERENCE",
    "message": "option_group sections require productContextId and sourceGroupId",
    "details": {
      "index": 0
    }
  }
}
```

---

## 4. PUT `/api/dashboard/meal-builder/draft`

### Purpose
Perform full-replacement updates on the current working draft sections. If no draft exists, one will be created.

> [!WARNING]
> This endpoint uses **replacement (overwrite) semantics**. You must submit the entire array of sections you wish to keep. Any omitted sections will be permanently removed.

### Postman Request
```http
PUT {{baseUrl}}/dashboard/meal-builder/draft
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json
```

### Request Body
Follows the exact same shape as the `POST /draft` payload.
```json
{
  "notes": "Update to salad selections",
  "sections": [
    {
      "key": "premium",
      "sectionType": "product_list",
      "sourceKind": "product_list",
      "selectedProductIds": ["665f1b2e7b9a4d0012b20099"],
      "includeMode": "selected",
      "selectionType": "premium_large_salad",
      "sortOrder": 10,
      "required": false,
      "minSelections": 0,
      "maxSelections": 1,
      "multiSelect": false,
      "visible": true,
      "availableFor": ["subscription"],
      "metadata": {},
      "rules": {}
    }
  ]
}
```

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "id": "665f1b2e7b9a4d0012ba0001",
    "status": "draft",
    "isCurrent": true,
    "notes": "Update to salad selections",
    "sections": [
      {
        "key": "premium",
        "selectionType": "premium_large_salad",
        "selectedProductIds": ["665f1b2e7b9a4d0012b20099"]
      }
    ],
    "updatedAt": "2026-06-20T12:30:00.000Z"
  }
}
```

---

## 5. GET `/api/dashboard/meal-builder/pickers/:sectionKey`

### Purpose
Fetch all catalog items (Menu Products or Menu Options) that are eligible candidates for addition to a specific section, based on the section's category/group constraints.

### Postman Request
```http
GET {{baseUrl}}/dashboard/meal-builder/pickers/premium?q=salmon&page=1&limit=10&includeUnavailable=false
Authorization: Bearer {{dashboardAccessToken}}
Accept-Language: en
```

### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `sectionKey` | string | Yes | The section identifier. Supported values: `"premium"`, `"sandwich"`, `"chicken"`, `"beef"`, `"fish"`, `"eggs"`, `"carbs"`. Unrecognized keys return a `400` error. |

### Query Parameters
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `q` \| `search` | string | `""` | Search query to match against item key or localized names. |
| `includeUnavailable` | boolean | `false` | If `true`, returns items that are inactive, unpublished, or out of stock. |
| `includeNotLinked` | boolean | `true` | If `true`, includes options that exist in the database but have not yet been linked to the parent product relation. |
| `diagnostics` | boolean | `false` | If `true`, appends system trace markers and database execution details in a root `diagnostics` object. |
| `page` | integer | `1` | Pagination page number. |
| `limit` | integer | `50` | Pagination page size (max `100`). |

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "contractVersion": "dashboard_meal_builder_picker.v1",
    "sectionKey": "premium",
    "candidateType": "mixed",
    "product": {
      "id": "665f1b2e7b9a4d0012b20001",
      "key": "basic_meal",
      "name": {
        "ar": "وجبة أساسية",
        "en": "Basic Meal"
      }
    },
    "group": {
      "id": "665f1b2e7b9a4d0012c30001",
      "key": "proteins",
      "name": {
        "ar": "البروتين",
        "en": "Protein"
      }
    },
    "rules": {
      "selectionType": "premium_meal",
      "requiredPremiumKeys": []
    },
    "candidates": [
      {
        "id": "665f1b2e7b9a4d0012e50001",
        "key": "salmon",
        "name": {
          "ar": "سلمون",
          "en": "Salmon"
        },
        "priceHalala": 3000,
        "selected": true,
        "available": true,
        "errors": [],
        "warnings": []
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "pages": 1
    }
  }
}
```

---

## 6. POST `/api/dashboard/meal-builder/validate`

### Purpose
Validate layout configuration rules and database entity integrity. This endpoint can be used to validate unsaved UI changes in real-time, or to validate the saved draft before attempting publication.

### Postman Request
```http
POST {{baseUrl}}/dashboard/meal-builder/validate
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json
```

### Request Body
- To validate unsaved sections, pass: `{"sections": [...]}`.
- To validate the saved draft database model, pass: `{}`.

### Success Response (`200 OK` - Valid)
```json
{
  "status": true,
  "data": {
    "status": "ready",
    "ready": true,
    "errors": [],
    "warnings": [],
    "checks": [],
    "summary": {
      "sections": 1,
      "errors": 0,
      "warnings": 0
    }
  }
}
```

### Success Response (`200 OK` - Invalid Payload/Draft)
Even if the draft contains validation failures, the endpoint returns an HTTP status `200` but marks `ready: false` with details.
```json
{
  "status": true,
  "data": {
    "status": "error",
    "ready": false,
    "errors": [
      {
        "level": "error",
        "code": "MEAL_BUILDER_PREMIUM_PRICE_INVALID",
        "message": "Premium option salmon requires a positive premium extraPriceHalala override."
      }
    ],
    "warnings": [],
    "checks": [],
    "summary": {
      "sections": 1,
      "errors": 1,
      "warnings": 0
    }
  }
}
```

---

## 7. POST `/api/dashboard/meal-builder/publish`

### Purpose
Lock the current draft, run strict validation, compute a static revision hash (SHA-256), and publish it to the system. This demotes the older published version to archived status.

> [!IMPORTANT]
> The publish endpoint **strictly enforces validations**. If `ready: false` is evaluated, publication will immediately fail with a `400 Bad Request` error.

### Postman Request
```http
POST {{baseUrl}}/dashboard/meal-builder/publish
Authorization: Bearer {{dashboardAccessToken}}
Content-Type: application/json

{"notes": "Enable salmon and premium large salad upgrades"}
```

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "config": {
      "id": "665f1b2e7b9a4d0012ba0002",
      "status": "published",
      "isCurrent": true,
      "contractVersion": "subscription_meal_builder.v1",
      "revisionHash": "sha256:abc123456...",
      "source": "dashboard",
      "publishedAt": "2026-06-20T13:00:00.000Z",
      "notes": "Enable salmon and premium large salad upgrades",
      "sections": []
    },
    "validation": {
      "status": "ready",
      "ready": true,
      "errors": [],
      "warnings": []
    },
    "contract": {
      "contractVersion": "subscription_meal_builder.v1",
      "revisionHash": "sha256:abc123456...",
      "sections": []
    }
  }
}
```

### Error Response (`400 Bad Request` - Validation Failed)
```json
{
  "ok": false,
  "error": {
    "code": "MEAL_BUILDER_VALIDATION_FAILED",
    "message": "Meal Builder draft is not publishable",
    "details": {
      "ready": false,
      "errors": [
        {
          "code": "MEAL_BUILDER_PREMIUM_PRICE_INVALID",
          "message": "Premium option salmon requires a positive premium extraPriceHalala override."
        }
      ]
    }
  }
}
```

---

## 8. GET `/api/dashboard/meal-builder/readiness`

### Purpose
Fetch QA check indicators and deployment gate markers. This reports whether both a current draft and valid published configuration exist, and summarizes overall system health.

### Postman Request
```http
GET {{baseUrl}}/dashboard/meal-builder/readiness
Authorization: Bearer {{dashboardAccessToken}}
```

### Success Response (`200 OK`)
```json
{
  "status": true,
  "data": {
    "status": "ready",
    "ready": true,
    "errors": [],
    "warnings": [],
    "checks": [],
    "summary": {
      "draft": true,
      "published": true,
      "sections": 6,
      "errors": 0,
      "warnings": 0,
      "revisionHash": "sha256:abc123456...",
      "route": "/api/dashboard/meal-builder/readiness"
    }
  }
}
```

---

## Frontend Integration Best Practices & Constraints

- **Only Submit Identifiers**: When updating drafts via `POST` or `PUT`, only submit array values for `selectedOptionIds` and `selectedProductIds`. Never submit the hydrated objects (like `selectedOptions` or `selectedProducts`) back to the server; they are calculated on-the-fly and will cause validation errors.
- **Premium Limit Enforcement**: There is no endpoint to configure `premiumUpgradeLimit` or maximum count limits on the dashboard. The premium limit is calculated automatically based on the user's subscription meal count (`maxPremiumUpgrades = totalMeals`).
- **Pricing Overrides**: You cannot edit pricing directly within the Meal Builder. Pricing is read-only and sourced from the Catalog / Menu endpoints (11B/11E) or override layers (11C).
- **Validation-Gated Publish**: Always disable the "Publish" button if `/validate` returns `ready: false` or if `errors` count is greater than `0`.
