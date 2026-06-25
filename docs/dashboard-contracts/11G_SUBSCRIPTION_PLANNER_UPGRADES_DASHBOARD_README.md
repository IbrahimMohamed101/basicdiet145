  # Premium Meal Upgrades Dashboard — Frontend Handoff README

  ## 0. Scope

  This document is the frontend implementation contract for the Dashboard screen:

  ```text
  Premium Meal Upgrades
  الوجبات المميزة
  ```

  Recommended dashboard route:

  ```text
  /premium-upgrades
  ```

  This screen manages `PremiumUpgradeConfig` records only.

  It links existing menu items as subscription premium upgrades. It does **not** create new menu products, menu options, option groups, add-ons, or Meal Builder drafts.

  ---

  ## 1. Core Business Meaning

  A premium meal upgrade is an upgrade applied to an existing subscription meal slot.

  It does not add a new meal.

  Example:

  ```text
  Subscription total meals: 14
  Customer selected premium upgrades: 4

  Final result:
  10 regular meals
  4 premium upgraded meals
  Total remains 14 meals
  ```

  Frontend must never display this as:

  ```text
  extra meal
  additional meal
  add-on
  new meal product
  ```

  Correct UI wording:

  ```text
  Upgrade delta
  Upgrade price difference
  فرق سعر الترقية
  ```

  Incorrect UI wording:

  ```text
  Meal price
  سعر الوجبة
  Add-on price
  سعر الإضافة
  ```

  ---

  ## 2. Hard Frontend Boundaries

  This screen must not do any of the following:

  ```text
  Do not use MealBuilderPage.
  Do not call PUT /api/dashboard/meal-builder/draft.
  Do not publish Meal Builder.
  Do not create MenuProduct.
  Do not create MenuOption.
  Do not create option groups.
  Do not manage Add-ons.
  Do not change one-time order pricing.
  Do not change subscription total meal count.
  Do not rewrite historical records.
  Do not require Flutter/mobile changes.
  ```

  Correct screen action:

  ```text
  Link eligible existing menu item as premium upgrade.
  ```

  Wrong screen action:

  ```text
  Create premium meal.
  ```

  Recommended primary button label:

  ```text
  Add Existing Menu Item as Premium Upgrade
  ربط عنصر من المنيو كترقية مميزة
  ```

  ---

  ## 3. Add-ons Are Separate

  Premium upgrades and add-ons are different concepts.

  Do not mix them.

  | Flow | Payload concept |
  |---|---|
  | Subscription premium upgrades | `premiumItems[{ premiumKey, qty }]` |
  | Subscription add-on plans | `addons[id]` |
  | Planner premium upgrades | premium `mealSlots` with `selectionType + premiumKey` |
  | Planner add-ons | `addonsOneTime` |
  | Dashboard premium upgrades | `/api/dashboard/premium-upgrades` |

  This screen must not manage:

  ```text
  addons
  addonsOneTime
  subscription add-on plans
  juices
  snacks
  add-on entitlements
  ```

  ---

  ## 4. API Base

  All requests are dashboard authenticated.

  ```http
  Authorization: Bearer <dashboard_token>
  Accept: application/json
  Content-Type: application/json
  ```

  Base path:

  ```text
  /api/dashboard/premium-upgrades
  ```

  ---

  ## 5. Endpoints Summary

  | Screen action | Method | Endpoint |
  |---|---:|---|
  | List premium upgrades | GET | `/api/dashboard/premium-upgrades` |
  | List eligible candidates | GET | `/api/dashboard/premium-upgrades/candidates` |
  | Create premium upgrade link | POST | `/api/dashboard/premium-upgrades` |
  | Update price/display/sort | PATCH | `/api/dashboard/premium-upgrades/:id` |
  | Toggle enabled/visible | PATCH | `/api/dashboard/premium-upgrades/:id/state` |
  | Archive premium upgrade | POST | `/api/dashboard/premium-upgrades/:id/archive` |
  | Readiness diagnostics | GET | `/api/dashboard/premium-upgrades/readiness` |

  ---

  ## 6. Supported Values / Enums

  Use these exact values.

  ### `sourceType`

  ```ts
  type SourceType = 'menu_option' | 'menu_product';
  ```

  | Value | Meaning |
  |---|---|
  | `menu_option` | Option-backed premium upgrade, e.g. premium protein |
  | `menu_product` | Product-backed premium upgrade, e.g. premium large salad |

  ### `selectionType`

  ```ts
  type SelectionType = 'premium_meal' | 'premium_large_salad';
  ```

  | Value | Meaning |
  |---|---|
  | `premium_meal` | Premium protein/meal upgrade |
  | `premium_large_salad` | Premium large salad upgrade |

  ### `status`

  ```ts
  type PremiumUpgradeStatus = 'active' | 'archived';
  ```

  | Value | Meaning |
  |---|---|
  | `active` | Config can be managed normally |
  | `archived` | Soft archived, hidden from customer planner, kept for history |

  ### Current known `premiumKey` values

  ```text
  beef_steak
  shrimp
  salmon
  premium_large_salad
  ```

  Do not hardcode config IDs.

  `premiumKey` is returned by backend and is not manually edited by frontend.

  ---

  ## 7. Shared DTOs

  ### 7.1 Premium Upgrade Config DTO

  This DTO is returned by list, create, update, state, and archive endpoints.

  ```ts
  type PremiumUpgradeConfigDto = {
    id: string;
    revision: number;

    sourceType: 'menu_option' | 'menu_product';
    sourceId: string;
    sourceProductId: string | null;
    sourceGroupId: string | null;
    sourceGroupKey: string | null;
    sourceKey: string;
    sourceName: {
      ar: string | null;
      en: string | null;
    };

    selectionType: 'premium_meal' | 'premium_large_salad';
    premiumKey: string;

    displayGroup: {
      key: string | null;
      id: string | null;
    };

    upgradeDeltaHalala: number;
    upgradeDeltaSar: number;
    currency: 'SAR';

    isEnabled: boolean;
    isVisible: boolean;
    status: 'active' | 'archived';
    sortOrder: number;

    sourceStatus: {
      exists: boolean;
      active: boolean;
      visible: boolean;
      available: boolean;
      published: boolean;
      subscriptionEnabled: boolean;
      relationValid: boolean;
    };

    validation: {
      valid: boolean;
      errors: string[];
      warnings: string[];
    };

    businessRule: {
      consumesExistingMealSlot: true;
      doesAddMeal: false;
      limitSource: 'subscription_total_meals';
    };

    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
  };
  ```

  ### 7.2 Candidate DTO

  ```ts
  type PremiumUpgradeCandidateDto = {
    id: string;
    sourceId: string;
    type: 'menu_option' | 'menu_product';
    sourceType: 'menu_option' | 'menu_product';

    sourceProductId: string | null;
    sourceGroupId: string | null;
    sourceProductKey: string | null;
    sourceGroupKey: string | null;

    key: string;
    premiumKey: string;

    name: {
      ar: string | null;
      en: string | null;
    };

    selectionType: 'premium_meal' | 'premium_large_salad';
    upgradeDeltaHalala: number;
    currency: 'SAR';

    isLinked: boolean;

    eligibilityDiagnostics: {
      eligible: boolean;
      issues: string[];
    };
  };
  ```

  ---

  ## 8. Page Load Flow

  On page open:

  ```text
  1. GET /api/dashboard/premium-upgrades/readiness
  2. GET /api/dashboard/premium-upgrades?page=1&limit=20
  ```

  Recommended UI layout:

  ```text
  Readiness banner
  Filters
  Premium upgrades table
  Add/link button
  ```

  After any mutation:

  ```text
  1. Use response to update row immediately.
  2. Re-fetch list or row to refresh latest revision.
  3. Optionally re-fetch readiness if state/archive/create changed.
  ```

  Important:

  ```text
  Always use latest revision from response for the next PATCH/archive request.
  ```

  ---

  # 9. GET List Premium Upgrades

  ## Endpoint

  ```http
  GET /api/dashboard/premium-upgrades
  ```

  ## Purpose

  Display existing premium upgrade configs, including active, hidden, disabled, invalid, and archived items depending on filters.

  ---

  ## 9.1 List Filters Form

  Send fields as query parameters.

  ### UI Controls

  | Field | UI control | Options | Send value | Default |
  |---|---|---|---|---|
  | `q` | Text input | Any text | string | omit |
  | `status` | Select box | `all`, `active`, `archived` | omit when `all`; otherwise selected value | `all` |
  | `isEnabled` | Select box | `all`, `true`, `false` | omit when `all`; otherwise boolean/string accepted by query | `all` |
  | `isVisible` | Select box | `all`, `true`, `false` | omit when `all`; otherwise boolean/string accepted by query | `all` |
  | `sourceType` | Select box | `all`, `menu_option`, `menu_product` | omit when `all`; otherwise selected value | `all` |
  | `selectionType` | Select box | `all`, `premium_meal`, `premium_large_salad` | omit when `all`; otherwise selected value | `all` |
  | `page` | Number input / pagination state | integer `>= 1` | number | `1` |
  | `limit` | Select box | `10`, `20`, `50`, `100` | number | `20` |

  ### Query builder rule

  Do not send `all` to backend unless backend explicitly supports it. Prefer omitting the filter.

  Example frontend query builder:

  ```ts
  const params = new URLSearchParams();

  if (q.trim()) params.set('q', q.trim());
  if (status !== 'all') params.set('status', status);
  if (isEnabled !== 'all') params.set('isEnabled', String(isEnabled === 'true'));
  if (isVisible !== 'all') params.set('isVisible', String(isVisible === 'true'));
  if (sourceType !== 'all') params.set('sourceType', sourceType);
  if (selectionType !== 'all') params.set('selectionType', selectionType);

  params.set('page', String(page));
  params.set('limit', String(limit));
  ```

  ---

  ## 9.2 Example Requests

  ```http
  GET /api/dashboard/premium-upgrades?page=1&limit=20
  ```

  ```http
  GET /api/dashboard/premium-upgrades?status=active&isEnabled=true&isVisible=true&page=1&limit=20
  ```

  ```http
  GET /api/dashboard/premium-upgrades?selectionType=premium_large_salad&page=1&limit=20
  ```

  ---

  ## 9.3 Example Response

  ```json
  {
    "data": [
      {
        "id": "6a391431151810f96620286c",
        "revision": 1,
        "sourceType": "menu_option",
        "sourceId": "6a3551b13f6b8e45eac5b5f8",
        "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
        "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
        "sourceGroupKey": null,
        "sourceKey": "beef_steak",
        "sourceName": {
          "ar": "ستيك لحم",
          "en": "Beef Steak"
        },
        "selectionType": "premium_meal",
        "premiumKey": "beef_steak",
        "displayGroup": {
          "key": "premium_proteins",
          "id": null
        },
        "upgradeDeltaHalala": 2000,
        "upgradeDeltaSar": 20,
        "currency": "SAR",
        "isEnabled": true,
        "isVisible": true,
        "status": "active",
        "sortOrder": 10,
        "sourceStatus": {
          "exists": true,
          "active": true,
          "visible": true,
          "available": true,
          "published": true,
          "subscriptionEnabled": true,
          "relationValid": true
        },
        "validation": {
          "valid": true,
          "errors": [],
          "warnings": []
        },
        "businessRule": {
          "consumesExistingMealSlot": true,
          "doesAddMeal": false,
          "limitSource": "subscription_total_meals"
        },
        "createdAt": "2026-06-22T10:53:37.466Z",
        "updatedAt": "2026-06-22T10:53:37.466Z",
        "archivedAt": null
      }
    ],
    "meta": {
      "total": 4,
      "page": 1,
      "limit": 20
    },
    "status": true
  }
  ```

  ---

  ## 9.4 Table Columns

  | Column | Source field | UI notes |
  |---|---|---|
  | Name | `sourceName.ar`, `sourceName.en` | Show both or current language with fallback |
  | Premium key | `premiumKey` | Read-only |
  | Type | `selectionType` | Badge |
  | Source type | `sourceType` | Badge |
  | Source context | `sourceProductId`, `sourceGroupId`, `sourceGroupKey` | Small text |
  | Upgrade delta | `upgradeDeltaSar` | Display as SAR |
  | Enabled | `isEnabled` | Toggle |
  | Visible | `isVisible` | Toggle |
  | Status | `status` | Badge |
  | Valid | `validation.valid` | Green/red state |
  | Sort | `sortOrder` | Numeric |
  | Actions | row actions | Edit / hide / show / enable / disable / archive |

  ---

  # 10. GET Candidates

  ## Endpoint

  ```http
  GET /api/dashboard/premium-upgrades/candidates
  ```

  ## Purpose

  Load existing menu sources that can be linked as premium upgrades.

  Only candidates returned by backend with:

  ```json
  {
    "eligibilityDiagnostics": {
      "eligible": true,
      "issues": []
    }
  }
  ```

  should be linkable.

  The frontend must not let the admin manually type source IDs.

  ---

  ## 10.1 Candidates Filters Form

  Send fields as query parameters.

  | Field | UI control | Options | Send value | Default |
  |---|---|---|---|---|
  | `q` | Text input | Any text | string | omit |
  | `selectionType` | Select box | `all`, `premium_meal`, `premium_large_salad` | omit when `all`; otherwise selected value | `all` |
  | `sourceType` | Select box | `all`, `menu_option`, `menu_product` | omit when `all`; otherwise selected value | `all` |
  | `sourceProductId` | Hidden or advanced select | Existing product ID | string | omit |
  | `includeLinked` | Toggle / checkbox | `true`, `false` | boolean query value | `false` |
  | `page` | Pagination | integer `>= 1` | number | `1` |
  | `limit` | Select box | `10`, `20`, `50`, `100` | number | `20` |

  ### Candidate modal recommended defaults

  ```text
  includeLinked = false
  limit = 20
  selectionType = all
  sourceType = all
  ```

  ### Query examples

  ```http
  GET /api/dashboard/premium-upgrades/candidates
  ```

  ```http
  GET /api/dashboard/premium-upgrades/candidates?includeLinked=true&limit=100
  ```

  ```http
  GET /api/dashboard/premium-upgrades/candidates?selectionType=premium_meal&sourceType=menu_option&includeLinked=false
  ```

  ---

  ## 10.2 Empty Candidates Response

  If all eligible candidates are already linked, this is valid:

  ```json
  {
    "data": [],
    "meta": {
      "total": 0,
      "page": 1,
      "limit": 20
    },
    "status": true
  }
  ```

  Frontend should show:

  ```text
  No unlinked eligible premium candidates.
  Use "Include linked" to view already linked items.
  ```

  Do not show this as an error.

  ---

  ## 10.3 Candidate Response Example

  ```json
  {
    "data": [
      {
        "id": "6a3551b13f6b8e45eac5b5f8",
        "sourceId": "6a3551b13f6b8e45eac5b5f8",
        "type": "menu_option",
        "sourceType": "menu_option",
        "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
        "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
        "sourceProductKey": "basic_meal",
        "sourceGroupKey": "proteins",
        "key": "beef_steak",
        "premiumKey": "beef_steak",
        "name": {
          "ar": "ستيك لحم",
          "en": "Beef Steak"
        },
        "selectionType": "premium_meal",
        "upgradeDeltaHalala": 2000,
        "currency": "SAR",
        "isLinked": true,
        "eligibilityDiagnostics": {
          "eligible": true,
          "issues": []
        }
      }
    ],
    "meta": {
      "total": 4,
      "page": 1,
      "limit": 20
    },
    "status": true
  }
  ```

  ---

  ## 10.4 Candidate Dropdown Behavior

  In add/link modal:

  | Candidate state | UI behavior |
  |---|---|
  | `eligible=true`, `isLinked=false` | Can select and link |
  | `eligible=true`, `isLinked=true` | Show `Already linked`, disable create action |
  | `eligible=false` | Disable and show `issues` |
  | `data=[]` | Show empty state, not error |

  Dropdown option display:

  ```text
  {Arabic name} / {English name} — {sourceType} — {selectionType}
  ```

  Dropdown value:

  ```text
  candidate.id
  ```

  But payload must use all candidate source fields, not just `id`.

  ---

  # 11. POST Create Premium Upgrade Link

  ## Endpoint

  ```http
  POST /api/dashboard/premium-upgrades
  ```

  ## Purpose

  Create a `PremiumUpgradeConfig` for an existing eligible candidate.

  This creates a link only.

  It does not create a menu product or menu option.

  ---

  ## 11.1 Add/Link Form

  ### Step A — Select candidate

  UI control:

  ```text
  Searchable select box / autocomplete
  ```

  Options source:

  ```http
  GET /api/dashboard/premium-upgrades/candidates?includeLinked=false
  ```

  Candidate fields copied into payload:

  ```text
  sourceType
  sourceId
  sourceProductId
  sourceGroupId
  selectionType
  ```

  These fields are read-only/hidden in the form.

  ---

  ### Step B — Config fields

  | Field | UI control | Editable by admin | Values / validation | Payload type |
  |---|---|---:|---|---|
  | `sourceType` | Hidden / read-only text | No | from candidate: `menu_option` or `menu_product` | string |
  | `sourceId` | Hidden | No | from candidate `sourceId` | string |
  | `sourceProductId` | Hidden | No | from candidate; required for `menu_option`; product ID for `menu_product` | string |
  | `sourceGroupId` | Hidden | No | from candidate; `null` for product-backed salad | string/null |
  | `selectionType` | Hidden / read-only badge | No | from candidate: `premium_meal` or `premium_large_salad` | string |
  | `displayGroupKey` | Select box | Yes | `premium_proteins`, `premium_salads` | string |
  | `upgradeDeltaSarInput` | Number input | Yes | SAR display/input, min `0`, step `0.01` | frontend-only |
  | `upgradeDeltaHalala` | Hidden computed value | No direct edit | `Math.round(upgradeDeltaSarInput * 100)` | number |
  | `isEnabled` | Toggle / checkbox | Yes | true/false; default true | boolean |
  | `isVisible` | Toggle / checkbox | Yes | true/false; default true | boolean |
  | `sortOrder` | Number input | Yes | integer or number; default next order | number |

  ### `displayGroupKey` select options

  Use select box:

  | Label | Value |
  |---|---|
  | Premium Proteins | `premium_proteins` |
  | Premium Salads | `premium_salads` |

  Recommended auto-default:

  ```ts
  if (candidate.selectionType === 'premium_meal') displayGroupKey = 'premium_proteins';
  if (candidate.selectionType === 'premium_large_salad') displayGroupKey = 'premium_salads';
  ```

  ### Price input rule

  The backend expects halala.

  The admin should see SAR.

  Example:

  ```text
  Admin types: 20
  Frontend sends: 2000
  ```

  ```ts
  const upgradeDeltaHalala = Math.round(Number(upgradeDeltaSarInput) * 100);
  ```

  Do not send `upgradeDeltaSar` in write requests.

  ---

  ## 11.2 Create Payload Builder

  ```ts
  function buildCreatePayload(candidate, form) {
    return {
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      sourceProductId: candidate.sourceProductId,
      sourceGroupId: candidate.sourceGroupId,
      selectionType: candidate.selectionType,
      displayGroupKey: form.displayGroupKey,
      upgradeDeltaHalala: Math.round(Number(form.upgradeDeltaSarInput) * 100),
      isEnabled: Boolean(form.isEnabled),
      isVisible: Boolean(form.isVisible),
      sortOrder: Number(form.sortOrder)
    };
  }
  ```

  ---

  ## 11.3 Example Payload — Premium Protein / Menu Option

  ```json
  {
    "sourceType": "menu_option",
    "sourceId": "6a3551b13f6b8e45eac5b5f8",
    "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
    "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
    "selectionType": "premium_meal",
    "displayGroupKey": "premium_proteins",
    "upgradeDeltaHalala": 2000,
    "isEnabled": true,
    "isVisible": true,
    "sortOrder": 10
  }
  ```

  ---

  ## 11.4 Example Payload — Premium Large Salad / Menu Product

  ```json
  {
    "sourceType": "menu_product",
    "sourceId": "6a3552293f6b8e45eac5b947",
    "sourceProductId": "6a3552293f6b8e45eac5b947",
    "sourceGroupId": null,
    "selectionType": "premium_large_salad",
    "displayGroupKey": "premium_salads",
    "upgradeDeltaHalala": 2900,
    "isEnabled": true,
    "isVisible": true,
    "sortOrder": 40
  }
  ```

  ---

  ## 11.5 Expected Success Response

  HTTP:

  ```text
  201 Created
  ```

  Body:

  ```json
  {
    "data": {
      "id": "6a391431151810f96620286c",
      "revision": 1,
      "sourceType": "menu_option",
      "sourceId": "6a3551b13f6b8e45eac5b5f8",
      "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
      "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
      "sourceGroupKey": null,
      "sourceKey": "beef_steak",
      "sourceName": {
        "ar": "ستيك لحم",
        "en": "Beef Steak"
      },
      "selectionType": "premium_meal",
      "premiumKey": "beef_steak",
      "displayGroup": {
        "key": "premium_proteins",
        "id": null
      },
      "upgradeDeltaHalala": 2000,
      "upgradeDeltaSar": 20,
      "currency": "SAR",
      "isEnabled": true,
      "isVisible": true,
      "status": "active",
      "sortOrder": 10,
      "sourceStatus": {
        "exists": true,
        "active": true,
        "visible": true,
        "available": true,
        "published": true,
        "subscriptionEnabled": true,
        "relationValid": true
      },
      "validation": {
        "valid": true,
        "errors": [],
        "warnings": []
      },
      "businessRule": {
        "consumesExistingMealSlot": true,
        "doesAddMeal": false,
        "limitSource": "subscription_total_meals"
      },
      "createdAt": "2026-06-22T10:53:37.466Z",
      "updatedAt": "2026-06-22T10:53:37.466Z",
      "archivedAt": null
    },
    "status": true
  }
  ```

  ---

  ## 11.6 Create Form Submit Rules

  Before submit:

  ```text
  candidate must be selected
  candidate.isLinked must be false
  candidate.eligibilityDiagnostics.eligible must be true
  upgradeDeltaSarInput must be >= 0
  displayGroupKey must be selected
  sortOrder must be a number
  ```

  After success:

  ```text
  Close modal
  Show success toast
  Refresh list
  Refresh candidates
  Refresh readiness
  ```

  ---

  # 12. PATCH Update Price / Display Group / Sort

  ## Endpoint

  ```http
  PATCH /api/dashboard/premium-upgrades/:id
  ```

  ## Purpose

  Update editable fields only.

  Allowed editable fields for frontend:

  ```text
  upgradeDeltaHalala
  displayGroupKey
  sortOrder
  metadata
  ```

  Do not send immutable fields:

  ```text
  sourceType
  sourceId
  sourceProductId
  sourceGroupId
  selectionType
  premiumKey
  currency
  ```

  ---

  ## 12.1 Edit Form Fields

  | Field | UI control | Required | Options / validation | Payload type |
  |---|---|---:|---|---|
  | `expectedRevision` | Hidden | Yes | current `revision` from latest row data | number |
  | `displayGroupKey` | Select box | No | `premium_proteins`, `premium_salads` | string |
  | `upgradeDeltaSarInput` | Number input | No | SAR input, min `0`, step `0.01` | frontend-only |
  | `upgradeDeltaHalala` | Hidden computed value | No | `Math.round(upgradeDeltaSarInput * 100)` | number |
  | `sortOrder` | Number input | No | number | number |

  ### Edit modal read-only fields

  Show but do not allow editing:

  ```text
  Name
  premiumKey
  sourceType
  sourceKey
  selectionType
  status
  sourceStatus
  validation
  ```

  ---

  ## 12.2 Update Payload Examples

  ### Change only price

  ```json
  {
    "expectedRevision": 1,
    "upgradeDeltaHalala": 2500
  }
  ```

  ### Change price and sort

  ```json
  {
    "expectedRevision": 2,
    "upgradeDeltaHalala": 2000,
    "sortOrder": 10
  }
  ```

  ### Change display group

  ```json
  {
    "expectedRevision": 3,
    "displayGroupKey": "premium_proteins"
  }
  ```

  ---

  ## 12.3 Expected Success Response

  HTTP:

  ```text
  200 OK
  ```

  Body:

  ```json
  {
    "data": {
      "id": "6a391431151810f96620286c",
      "revision": 2,
      "sourceType": "menu_option",
      "sourceId": "6a3551b13f6b8e45eac5b5f8",
      "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
      "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
      "sourceGroupKey": null,
      "sourceKey": "beef_steak",
      "sourceName": {
        "ar": "ستيك لحم",
        "en": "Beef Steak"
      },
      "selectionType": "premium_meal",
      "premiumKey": "beef_steak",
      "displayGroup": {
        "key": "premium_proteins",
        "id": null
      },
      "upgradeDeltaHalala": 2500,
      "upgradeDeltaSar": 25,
      "currency": "SAR",
      "isEnabled": true,
      "isVisible": true,
      "status": "active",
      "sortOrder": 10,
      "sourceStatus": {
        "exists": true,
        "active": true,
        "visible": true,
        "available": true,
        "published": true,
        "subscriptionEnabled": true,
        "relationValid": true
      },
      "validation": {
        "valid": true,
        "errors": [],
        "warnings": []
      },
      "businessRule": {
        "consumesExistingMealSlot": true,
        "doesAddMeal": false,
        "limitSource": "subscription_total_meals"
      },
      "createdAt": "2026-06-22T10:53:37.466Z",
      "updatedAt": "2026-06-22T10:58:05.299Z",
      "archivedAt": null
    },
    "status": true
  }
  ```

  ---

  ## 12.4 Revision Conflict Handling

  If backend returns `PREMIUM_UPGRADE_REVISION_CONFLICT`, show:

  ```text
  This item was updated by another admin. Please refresh and try again.
  ```

  Then:

  ```text
  1. Close or keep modal in disabled state.
  2. Re-fetch list.
  3. Re-open modal with latest revision if admin wants to retry.
  ```

  ---

  # 13. PATCH Toggle State

  ## Endpoint

  ```http
  PATCH /api/dashboard/premium-upgrades/:id/state
  ```

  ## Purpose

  Change enabled/visible state.

  Recommended frontend: expose only toggles for:

  ```text
  isEnabled
  isVisible
  ```

  Do not expose `status` as a normal edit select. Use the archive endpoint for archiving.

  ---

  ## 13.1 State Form / Inline Toggle Fields

  | Field | UI control | Required | Options / validation | Payload type |
  |---|---|---:|---|---|
  | `expectedRevision` | Hidden | Yes | current row `revision` | number |
  | `isEnabled` | Toggle / checkbox | No | true/false | boolean |
  | `isVisible` | Toggle / checkbox | No | true/false | boolean |

  At least one of `isEnabled` or `isVisible` should be sent.

  ---

  ## 13.2 Payload Examples

  ### Hide from customer planner

  ```json
  {
    "expectedRevision": 2,
    "isVisible": false
  }
  ```

  ### Show again

  ```json
  {
    "expectedRevision": 3,
    "isVisible": true
  }
  ```

  ### Disable selection

  ```json
  {
    "expectedRevision": 4,
    "isEnabled": false
  }
  ```

  ### Enable selection

  ```json
  {
    "expectedRevision": 5,
    "isEnabled": true
  }
  ```

  ### Update both flags together

  ```json
  {
    "expectedRevision": 6,
    "isEnabled": true,
    "isVisible": true
  }
  ```

  ---

  ## 13.3 Expected Success Response

  ```json
  {
    "data": {
      "id": "6a391431151810f96620286c",
      "revision": 7,
      "sourceType": "menu_option",
      "sourceId": "6a3551b13f6b8e45eac5b5f8",
      "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
      "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
      "sourceGroupKey": null,
      "sourceKey": "beef_steak",
      "sourceName": {
        "ar": "ستيك لحم",
        "en": "Beef Steak"
      },
      "selectionType": "premium_meal",
      "premiumKey": "beef_steak",
      "displayGroup": {
        "key": "premium_proteins",
        "id": null
      },
      "upgradeDeltaHalala": 2000,
      "upgradeDeltaSar": 20,
      "currency": "SAR",
      "isEnabled": true,
      "isVisible": true,
      "status": "active",
      "sortOrder": 10,
      "sourceStatus": {
        "exists": true,
        "active": true,
        "visible": true,
        "available": true,
        "published": true,
        "subscriptionEnabled": true,
        "relationValid": true
      },
      "validation": {
        "valid": true,
        "errors": [],
        "warnings": []
      },
      "businessRule": {
        "consumesExistingMealSlot": true,
        "doesAddMeal": false,
        "limitSource": "subscription_total_meals"
      },
      "createdAt": "2026-06-22T10:53:37.466Z",
      "updatedAt": "2026-06-22T11:10:00.000Z",
      "archivedAt": null
    },
    "status": true
  }
  ```

  ---

  ## 13.4 State UI Matrix

  | Row state | Customer planner behavior | Dashboard behavior |
  |---|---|---|
  | `status=active`, `isEnabled=true`, `isVisible=true` | Visible and selectable | Show normal row |
  | `status=active`, `isVisible=false` | Hidden | Show row with Hidden badge |
  | `status=active`, `isEnabled=false` | Not selectable | Show row with Disabled badge |
  | `status=archived` | Hidden and not selectable | Show only in archived/all filters |

  ---

  # 14. POST Archive

  ## Endpoint

  ```http
  POST /api/dashboard/premium-upgrades/:id/archive
  ```

  ## Purpose

  Soft archive a premium upgrade.

  It does not delete the menu source or historical records.

  ---

  ## 14.1 Archive Dialog Fields

  | Field | UI control | Required | Options / validation | Payload type |
  |---|---|---:|---|---|
  | `expectedRevision` | Hidden | Yes | current row `revision` | number |
  | `reason` | Text area | Yes | non-empty string, recommended min 3 chars | string |

  Recommended dialog text:

  ```text
  This will archive the premium upgrade only. It will not delete the menu item or any historical customer records.
  ```

  ---

  ## 14.2 Payload Example

  ```json
  {
    "expectedRevision": 7,
    "reason": "No longer available from supplier"
  }
  ```

  ---

  ## 14.3 Expected Success Response

  ```json
  {
    "data": {
      "id": "6a391431151810f96620286c",
      "revision": 8,
      "sourceType": "menu_option",
      "sourceId": "6a3551b13f6b8e45eac5b5f8",
      "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
      "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
      "sourceGroupKey": null,
      "sourceKey": "beef_steak",
      "sourceName": {
        "ar": "ستيك لحم",
        "en": "Beef Steak"
      },
      "selectionType": "premium_meal",
      "premiumKey": "beef_steak",
      "displayGroup": {
        "key": "premium_proteins",
        "id": null
      },
      "upgradeDeltaHalala": 2000,
      "upgradeDeltaSar": 20,
      "currency": "SAR",
      "isEnabled": false,
      "isVisible": false,
      "status": "archived",
      "sortOrder": 10,
      "sourceStatus": {
        "exists": true,
        "active": true,
        "visible": true,
        "available": true,
        "published": true,
        "subscriptionEnabled": true,
        "relationValid": true
      },
      "validation": {
        "valid": true,
        "errors": [],
        "warnings": []
      },
      "businessRule": {
        "consumesExistingMealSlot": true,
        "doesAddMeal": false,
        "limitSource": "subscription_total_meals"
      },
      "createdAt": "2026-06-22T10:53:37.466Z",
      "updatedAt": "2026-06-22T11:20:00.000Z",
      "archivedAt": "2026-06-22T11:20:00.000Z"
    },
    "status": true
  }
  ```

  ---

  ## 14.4 Archive UI Rules

  After archive success:

  ```text
  Close dialog.
  Show success toast.
  Remove row from active list if current filter is active.
  Keep row visible if current filter is archived/all.
  Refresh readiness.
  ```

  Do not offer hard delete.

  ---

  # 15. GET Readiness

  ## Endpoint

  ```http
  GET /api/dashboard/premium-upgrades/readiness
  ```

  ## Purpose

  Show diagnostics for production readiness.

  ---

  ## 15.1 Expected Response

  ```json
  {
    "isReady": true,
    "diagnostics": {
      "totalConfigs": 4,
      "activeConfigs": 4,
      "missingSources": 0,
      "invalidRelations": 0,
      "duplicateKeys": 0,
      "priceMismatches": [],
      "legacyChecks": {
        "builderProteinsCount": 20,
        "fallbackActive": false
      },
      "configState": {
        "isEmpty": false,
        "legacyFallbackActive": false,
        "configsAuthoritative": true,
        "backfillStatus": "complete",
        "partialConfigRisk": false,
        "knownKeys": [
          "beef_steak",
          "shrimp",
          "salmon",
          "premium_large_salad"
        ],
        "configuredKnownKeys": [
          "beef_steak",
          "shrimp",
          "salmon",
          "premium_large_salad"
        ],
        "missingConfigKeys": []
      },
      "knownSources": [
        {
          "premiumKey": "beef_steak",
          "resolvable": true,
          "sourceType": "menu_option",
          "sourceId": "6a3551b13f6b8e45eac5b5f8",
          "sourceProductId": "6a35521c3f6b8e45eac5b8e9",
          "sourceGroupId": "6a3551ae3f6b8e45eac5b5e9",
          "issues": []
        }
      ],
      "unresolvedSourceKeys": []
    },
    "status": true
  }
  ```

  ---

  ## 15.2 Readiness Banner Mapping

  | Condition | Banner type | Message |
  |---|---|---|
  | `isReady=true` and `partialConfigRisk=false` | Success | Premium upgrade system is ready. |
  | `configState.isEmpty=true` and `legacyFallbackActive=true` | Info | No configs yet. Legacy fallback is active. |
  | `partialConfigRisk=true` | Critical | Partial config risk detected. Do not publish until all known keys are configured. |
  | `missingSources > 0` | Warning/Critical | Some premium upgrade sources are missing. |
  | `invalidRelations > 0` | Warning/Critical | Some source relations are invalid. |
  | `duplicateKeys > 0` | Critical | Duplicate premium keys detected. |
  | `priceMismatches.length > 0` | Warning | Legacy/config price mismatch detected. |

  ---

  ## 15.3 Readiness Details UI

  Show:

  ```text
  totalConfigs
  activeConfigs
  missingSources
  invalidRelations
  duplicateKeys
  priceMismatches
  legacyChecks.fallbackActive
  configState.configsAuthoritative
  configState.backfillStatus
  configState.partialConfigRisk
  configState.knownKeys
  configState.configuredKnownKeys
  configState.missingConfigKeys
  knownSources
  unresolvedSourceKeys
  ```

  Important rule to display in UI:

  ```text
  If PremiumUpgradeConfig is empty, legacy fallback may work.
  If any config exists, configs become the source of truth.
  Partial backfill in production is not allowed.
  ```

  ---

  # 16. Error Handling

  The backend can return errors such as:

  ```text
  PREMIUM_UPGRADE_INVALID_SOURCE_ID
  PREMIUM_UPGRADE_SOURCE_NOT_FOUND
  PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE
  PREMIUM_UPGRADE_RELATION_INVALID
  PREMIUM_UPGRADE_DUPLICATE
  PREMIUM_UPGRADE_KEY_CONFLICT
  PREMIUM_UPGRADE_INVALID_DELTA
  PREMIUM_UPGRADE_REVISION_CONFLICT
  PREMIUM_UPGRADE_ARCHIVED
  ```

  ## 16.1 Recommended Error Parser

  The exact error body can vary by backend error middleware. Read code from multiple possible places:

  ```ts
  function getApiErrorCode(errorResponse) {
    return (
      errorResponse?.code ||
      errorResponse?.error?.code ||
      errorResponse?.data?.code ||
      errorResponse?.errors?.[0]?.code ||
      null
    );
  }
  ```

  ## 16.2 Error UI Mapping

  | Error code | UI message |
  |---|---|
  | `PREMIUM_UPGRADE_INVALID_SOURCE_ID` | Invalid source ID. Refresh candidates and try again. |
  | `PREMIUM_UPGRADE_SOURCE_NOT_FOUND` | The selected menu source no longer exists. |
  | `PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE` | This menu item is not eligible as a premium upgrade. |
  | `PREMIUM_UPGRADE_RELATION_INVALID` | The source relation is invalid or missing. |
  | `PREMIUM_UPGRADE_DUPLICATE` | This source is already linked as a premium upgrade. |
  | `PREMIUM_UPGRADE_KEY_CONFLICT` | Premium key already exists. |
  | `PREMIUM_UPGRADE_INVALID_DELTA` | Upgrade delta must be a valid non-negative amount. |
  | `PREMIUM_UPGRADE_REVISION_CONFLICT` | This item was updated by another admin. Refresh and try again. |
  | `PREMIUM_UPGRADE_ARCHIVED` | This premium upgrade is archived and cannot accept this action. |

  For unknown errors:

  ```text
  Something went wrong. Please refresh and try again.
  ```

  ---

  # 17. Current Expected Data State

  Current configured premium upgrades:

  | premiumKey | selectionType | sourceType | expected upgrade delta |
  |---|---|---|---:|
  | `beef_steak` | `premium_meal` | `menu_option` | `2000` |
  | `shrimp` | `premium_meal` | `menu_option` | `2000` |
  | `salmon` | `premium_meal` | `menu_option` | `2000` |
  | `premium_large_salad` | `premium_large_salad` | `menu_product` | `2900` |

  Expected readiness:

  ```text
  isReady = true
  totalConfigs = 4
  activeConfigs = 4
  legacyFallbackActive = false
  configsAuthoritative = true
  backfillStatus = complete
  partialConfigRisk = false
  missingConfigKeys = []
  ```

  Expected candidates after all four are linked:

  ```http
  GET /api/dashboard/premium-upgrades/candidates
  ```

  ```json
  {
    "data": [],
    "meta": {
      "total": 0,
      "page": 1,
      "limit": 20
    },
    "status": true
  }
  ```

  Expected candidates with linked items included:

  ```http
  GET /api/dashboard/premium-upgrades/candidates?includeLinked=true
  ```

  ```text
  meta.total = 4
  all items have isLinked = true
  ```

  ---

  # 18. Frontend Implementation Checklist

  ## Must implement

  ```text
  Readiness card
  List table
  Filters
  Candidates modal
  Create/link form
  Edit price/display/sort form
  State toggles
  Archive dialog
  Error handling
  Revision conflict handling
  Refresh after mutation
  ```

  ## Must not implement

  ```text
  MealBuilderPage
  Meal Builder draft save
  Meal Builder publish
  Menu product creation
  Menu option creation
  Option group creation
  Add-ons management
  Flutter/mobile contract changes
  One-time order price changes
  ```

  ---

  # 19. QA Checklist

  1. Open page and confirm readiness is ready.
  2. Confirm list returns 4 configs.
  3. Confirm table shows price as SAR but writes halala.
  4. Confirm candidates without `includeLinked` returns empty when all four are linked.
  5. Confirm candidates with `includeLinked=true` returns 4 linked candidates.
  6. Try edit Beef Steak from 20 SAR to 25 SAR and confirm payload sends `2500`.
  7. Restore Beef Steak from 25 SAR to 20 SAR and confirm payload sends `2000`.
  8. Hide one item using `/state`, then show again.
  9. Try stale revision update and confirm friendly conflict message.
  10. Do not test archive on production unless intentionally archiving.
  11. Confirm browser network tab does not call any Meal Builder endpoints.

  ---

  # 20. Final Rule for Frontend

  This page is a `PremiumUpgradeConfig` management screen.

  The only valid create action is:

  ```text
  Select eligible existing menu candidate → Link it as PremiumUpgradeConfig
  ```

  The page must never create or edit the underlying menu item itself.