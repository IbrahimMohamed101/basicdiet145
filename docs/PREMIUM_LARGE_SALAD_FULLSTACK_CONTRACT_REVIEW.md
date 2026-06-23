# Premium Meal Upgrades Dashboard — Frontend README

## 1. Purpose

This screen allows dashboard admins to manage **Premium Meal Upgrades**.

A premium meal upgrade is **not a new meal** and does **not increase subscription meal count**.

Example:

```text
Subscription total meals = 14
Premium upgrades selected = 4

Result:
10 regular meals
4 premium upgraded meals
Total remains 14 meals
```

The screen manages only:

```text
Existing menu item → PremiumUpgradeConfig
```

It must not create normal meals, menu products, menu options, option groups, or Meal Builder drafts.

---

## 2. Important Business Rules

### What this screen does

- Links an existing `MenuProduct` or `MenuOption` as a premium upgrade.
- Controls the subscription-only upgrade delta price.
- Controls enabled/visible state.
- Supports soft archive.
- Shows diagnostics/readiness.

### What this screen must not do

- Do not use `MealBuilderPage`.
- Do not use `PUT /api/dashboard/meal-builder/draft`.
- Do not publish Meal Builder.
- Do not create `MenuProduct`.
- Do not create `MenuOption`.
- Do not create option groups.
- Do not modify one-time order prices.
- Do not change subscription total meal count.
- Do not rewrite old customer selections, orders, payments, or subscription days.
- Do not mix premium upgrades with add-ons.
- Do not require Flutter/mobile changes.

---

## 3. Concept: Link Existing Item, Do Not Create New Item

The admin does not create a premium meal from scratch.

Correct flow:

```text
1. Menu/Catalog already has an eligible item.
2. Premium Upgrades screen fetches eligible candidates.
3. Admin links one candidate as a PremiumUpgradeConfig.
4. Admin controls upgrade delta, visibility, status, and archive state.
```

Wrong flow:

```text
Premium Upgrades screen creates a new meal/product/option
```

If the admin wants a new item like `Lamb Chops`, it must first be created in the Menu/Catalog screen and attached correctly to its product/group. Then it can appear as a candidate here.

---

## 4. Supported Premium Types

### 4.1 Premium protein upgrade

```text
selectionType = premium_meal
sourceType = menu_option
```

Current known examples:

```text
beef_steak
shrimp
salmon
```

Usually these are menu options attached to:

```text
basic_meal / proteins
```

### 4.2 Premium large salad

```text
selectionType = premium_large_salad
sourceType = menu_product
premiumKey = premium_large_salad
```

Current known example:

```text
premium_large_salad
```

---

## 5. Add-ons Separation

Add-ons are not premium meal upgrades.

Do not use this screen for:

```text
subscription add-on plans
one-time add-ons
juices
snacks
addon entitlements
addonsOneTime
```

Premium upgrades and add-ons are separate:

```text
Subscription premium upgrades: premiumItems
Subscription add-ons: addons
Planner premium upgrades: premium mealSlots
Planner add-ons: addonsOneTime
```

---

## 6. Base API

All endpoints are dashboard-authenticated.

```text
Base path:
/api/dashboard/premium-upgrades
```

Recommended headers:

```http
Authorization: Bearer <dashboard_token>
Content-Type: application/json
Accept: application/json
```

---

## 7. Endpoint Summary

| User Story | Method | Endpoint | Purpose |
|---|---:|---|---|
| List configs | GET | `/api/dashboard/premium-upgrades` | Show current premium upgrade configs |
| Candidates | GET | `/api/dashboard/premium-upgrades/candidates` | Show eligible existing menu items that can be linked |
| Create link | POST | `/api/dashboard/premium-upgrades` | Create `PremiumUpgradeConfig` for existing menu item |
| Update price/details | PATCH | `/api/dashboard/premium-upgrades/:id` | Update upgrade delta, sort, display group, metadata |
| Update state | PATCH | `/api/dashboard/premium-upgrades/:id/state` | Toggle enabled/visible/status |
| Archive | POST | `/api/dashboard/premium-upgrades/:id/archive` | Soft archive a premium upgrade |
| Readiness | GET | `/api/dashboard/premium-upgrades/readiness` | Show diagnostics and system readiness |

---

## 8. Recommended Frontend Route

```text
/premium-upgrades
```

Recommended screen title:

```text
Premium Meal Upgrades
الوجبات المميزة
```

Recommended primary button label:

```text
Add Existing Menu Item as Premium Upgrade
ربط عنصر من المنيو كترقية مميزة
```

Do not call the button:

```text
Create Premium Meal
```

because this screen does not create meals.

---

## 9. Screen Layout

Recommended sections:

1. Readiness banner/card.
2. Premium upgrades table.
3. Filters.
4. Candidate drawer/modal for linking existing items.
5. Edit upgrade delta modal.
6. State toggle actions.
7. Archive confirmation dialog.

---

## 10. GET List Premium Upgrades

### Endpoint

```http
GET /api/dashboard/premium-upgrades
```

### Optional query params (Filters Form)

The frontend should provide a filter form for these query parameters:

| Query Param | Input Type | Required | Options / Details |
|---|---|---|---|
| `status` | Select Box | No | `active`, `archived`, `all` |
| `isEnabled` | Select Box | No | `true`, `false`, `all` |
| `isVisible` | Select Box | No | `true`, `false`, `all` |
| `sourceType` | Select Box | No | `menu_option`, `menu_product`, `all` |
| `selectionType` | Select Box | No | `premium_meal`, `premium_large_salad`, `all` |
| `q` | Text Input | No | Search by name or key |
| `page` | Number Input | No | Current page number (default: 1) |
| `limit` | Number Input | No | Items per page (default: 20) |

### Purpose

Show all existing premium upgrade configs for management.

The screen should be able to show:

```text
active
disabled
hidden
archived
invalid source
invalid relation
```

### Example request

```http
GET /api/dashboard/premium-upgrades?page=1&limit=20
```

### Example response

```json
{
  "data": [
    {
      "id": "configId",
      "revision": 1,
      "sourceType": "menu_option",
      "sourceId": "optionId",
      "sourceProductId": "basicMealProductId",
      "sourceGroupId": "proteinGroupId",
      "sourceGroupKey": "proteins",
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

### Frontend display fields

| Field | UI label |
|---|---|
| `sourceName.ar` | Arabic name |
| `sourceName.en` | English name |
| `sourceType` | Source type |
| `sourceKey` | Source key |
| `premiumKey` | Premium key |
| `selectionType` | Upgrade type |
| `upgradeDeltaSar` | Upgrade delta price |
| `isEnabled` | Enabled |
| `isVisible` | Visible |
| `status` | Status |
| `validation.valid` | Valid |
| `validation.errors` | Errors |
| `validation.warnings` | Warnings |
| `sourceStatus` | Source diagnostics |
| `businessRule.doesAddMeal` | Must always be false |

### Important UI wording

Use:

```text
Upgrade delta price
فرق سعر الترقية
```

Do not use:

```text
Meal price
سعر الوجبة
```

---

## 11. GET Candidates

### Endpoint

```http
GET /api/dashboard/premium-upgrades/candidates
```

### Optional query params (Candidate Filters)

| Query Param | Input Type | Required | Options / Details |
|---|---|---|---|
| `selectionType` | Select Box | No | `premium_meal`, `premium_large_salad`, `all` |
| `sourceType` | Select Box | No | `menu_option`, `menu_product`, `all` |
| `sourceProductId` | Text Input | No | UUID of the source product |
| `q` | Text Input | No | Search by name or key |
| `includeLinked` | Checkbox / Boolean | No | `true`, `false` (default: `false`) |
| `page` | Number Input | No | Current page number (default: 1) |
| `limit` | Number Input | No | Items per page (default: 20) |

### Purpose

Show existing menu items that are eligible to be linked as premium upgrades.

### Important rule

Only items returned by this endpoint with:

```json
"eligibilityDiagnostics": {
  "eligible": true,
  "issues": []
}
```

should be linkable.

This screen cannot link any random menu item.

### Example request — unlinked only

```http
GET /api/dashboard/premium-upgrades/candidates
```

If all known items are already linked, this can return:

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

This is valid and expected.

### Example request — include already linked

```http
GET /api/dashboard/premium-upgrades/candidates?includeLinked=true&limit=100
```

### Example response

```json
{
  "data": [
    {
      "id": "optionId",
      "sourceId": "optionId",
      "type": "menu_option",
      "sourceType": "menu_option",
      "sourceProductId": "basicMealProductId",
      "sourceGroupId": "proteinGroupId",
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

### Candidate UI behavior

- If `isLinked = true`, show badge: `Already linked`.
- If `isLinked = false`, show action: `Link as premium upgrade`.
- If `eligible = false`, disable action and show issues.
- Do not show a create product/option form here.

---

## 12. POST Create Premium Upgrade Link

### Endpoint

```http
POST /api/dashboard/premium-upgrades
```

### Purpose

Create a `PremiumUpgradeConfig` linking an existing menu source as a premium upgrade.

### Menu option-backed premium meal example

```json
{
  "sourceType": "menu_option",
  "sourceId": "optionId",
  "sourceProductId": "basicMealProductId",
  "sourceGroupId": "proteinGroupId",
  "selectionType": "premium_meal",
  "displayGroupKey": "premium_proteins",
  "upgradeDeltaHalala": 2000,
  "isEnabled": true,
  "isVisible": true,
  "sortOrder": 10
}
```

### Product-backed premium large salad example

```json
{
  "sourceType": "menu_product",
  "sourceId": "premiumLargeSaladProductId",
  "sourceProductId": "premiumLargeSaladProductId",
  "sourceGroupId": null,
  "selectionType": "premium_large_salad",
  "displayGroupKey": "premium_salads",
  "upgradeDeltaHalala": 2900,
  "isEnabled": true,
  "isVisible": true,
  "sortOrder": 40
}
```

### Expected response

```json
{
  "data": {
    "id": "configId",
    "revision": 1,
    "premiumKey": "beef_steak",
    "selectionType": "premium_meal",
    "upgradeDeltaHalala": 2000,
    "upgradeDeltaSar": 20,
    "isEnabled": true,
    "isVisible": true,
    "status": "active",
    "businessRule": {
      "consumesExistingMealSlot": true,
      "doesAddMeal": false,
      "limitSource": "subscription_total_meals"
    }
  },
  "status": true
}
```

### Payload Form Definition (Create Premium Upgrade)

When submitting the POST request, the frontend form should structure the payload using the following input types. Note: Many of these values are read-only and passed directly from the selected candidate.

| Payload Attribute | Input Type | Required | Options / Details |
|---|---|---|---|
| `sourceType` | Read-only (Hidden) | Yes | Auto-filled from candidate (`menu_option` or `menu_product`) |
| `sourceId` | Read-only (Hidden) | Yes | Auto-filled from candidate (UUID) |
| `sourceProductId` | Read-only (Hidden) | Yes (if `menu_option`) | Auto-filled from candidate (UUID). |
| `sourceGroupId` | Read-only (Hidden) | Yes (if `menu_option`) | Auto-filled from candidate (UUID). Can be null for `menu_product`. |
| `selectionType` | Read-only (Hidden) | Yes | Auto-filled from candidate (`premium_meal` or `premium_large_salad`) |
| `displayGroupKey` | Select Box | Yes | `premium_proteins`, `premium_salads` |
| `upgradeDeltaHalala` | Number Input | Yes | Must be integer `>= 0`. Frontend should ask for SAR and multiply by 100 before sending. |
| `isEnabled` | Toggle / Checkbox | Yes | `true` or `false` |
| `isVisible` | Toggle / Checkbox | Yes | `true` or `false` |
| `sortOrder` | Number Input | Yes | Default to a sensible number like `10` |

### Frontend validation before submit

- Ensure all required read-only fields from the candidate are included in the payload.
- `upgradeDeltaHalala` must be integer `>= 0`.
- Do not allow duplicate submit for already linked candidates.
- Do not allow manual `premiumKey` editing (Server derives `premiumKey`).

### Frontend rules

- Server creates only `PremiumUpgradeConfig`.
- Server must not create or modify menu source records.

---

## 13. PATCH Update Upgrade Delta / Sort / Display Group

### Endpoint

```http
PATCH /api/dashboard/premium-upgrades/:id
```

### Purpose

Update editable config fields.

Editable examples:

```text
upgradeDeltaHalala
displayGroupKey
sortOrder
metadata
```

Immutable fields:

```text
sourceType
sourceId
sourceProductId
sourceGroupId
selectionType
premiumKey
currency
```

### Payload Form Definition (Update Details)

When submitting the PATCH request, the frontend form should send only the modified fields along with `expectedRevision`.

| Payload Attribute | Input Type | Required | Options / Details |
|---|---|---|---|
| `expectedRevision` | Read-only (Hidden) | Yes | Must match the `revision` field from the latest GET response. |
| `upgradeDeltaHalala` | Number Input | No | Integer `>= 0`. Remember to ask user for SAR and multiply by 100. |
| `displayGroupKey` | Select Box | No | `premium_proteins`, `premium_salads` |
| `sortOrder` | Number Input | No | Sorting order integer. |

### Request example

```json
{
  "expectedRevision": 1,
  "upgradeDeltaHalala": 2500,
  "displayGroupKey": "premium_proteins",
  "sortOrder": 15
}
```

### Expected response

```json
{
  "data": {
    "id": "configId",
    "revision": 2,
    "premiumKey": "beef_steak",
    "upgradeDeltaHalala": 2500,
    "upgradeDeltaSar": 25,
    "currency": "SAR"
  },
  "status": true
}
```

### Important revision rule

Every update must send:

```json
"expectedRevision": <current row revision>
```

The frontend should use the `revision` from the latest list/detail response.

If the backend returns revision conflict, show:

```text
This item was updated by another admin. Please refresh and try again.
```

Then reload the list.

### Price behavior

Changing `upgradeDeltaHalala` affects future subscription premium upgrade pricing only.

It does not:

- change normal menu price
- change one-time order price
- rewrite historical selections
- rewrite paid subscriptions
- rewrite orders or payments

---

## 14. PATCH State

### Endpoint

```http
PATCH /api/dashboard/premium-upgrades/:id/state
```

### Purpose

Enable/disable or show/hide an upgrade.

### Payload Form Definition (Update State)

| Payload Attribute | Input Type | Required | Options / Details |
|---|---|---|---|
| `expectedRevision` | Read-only (Hidden) | Yes | Must match the `revision` field from the latest GET response. |
| `isEnabled` | Toggle / Checkbox | Yes (if updating) | `true` or `false` |
| `isVisible` | Toggle / Checkbox | Yes (if updating) | `true` or `false` |

### Request example — hide from customer planner

```json
{
  "expectedRevision": 2,
  "isEnabled": true,
  "isVisible": false
}
```

### Request example — show again

```json
{
  "expectedRevision": 3,
  "isEnabled": true,
  "isVisible": true
}
```

### Expected response

```json
{
  "data": {
    "id": "configId",
    "revision": 4,
    "isEnabled": true,
    "isVisible": true,
    "status": "active"
  },
  "status": true
}
```

### Frontend behavior

| State | Customer planner | Dashboard |
|---|---|---|
| `isEnabled=true`, `isVisible=true`, `status=active` | Visible and selectable | Visible |
| `isVisible=false` | Hidden | Visible |
| `isEnabled=false` | Not selectable | Visible |
| `status=archived` | Hidden and not selectable | Visible only in archived/all filters |

Hidden or disabled configs should not be accepted for new selections, even if the customer has an old cached client state.

---

## 15. POST Archive

### Endpoint

```http
POST /api/dashboard/premium-upgrades/:id/archive
```

### Purpose

Soft archive a premium upgrade.

### Payload Form Definition (Archive)

| Payload Attribute | Input Type | Required | Options / Details |
|---|---|---|---|
| `expectedRevision` | Read-only (Hidden) | Yes | Must match the `revision` field from the latest GET response. |
| `reason` | Text Area / Input | Yes | Reason for archiving the upgrade. |

### Request body

```json
{
  "expectedRevision": 4,
  "reason": "No longer available from supplier"
}
```

### Expected response

```json
{
  "data": {
    "id": "configId",
    "revision": 5,
    "status": "archived",
    "archivedAt": "2026-06-22T12:00:00.000Z"
  },
  "status": true
}
```

### Frontend rules

- `reason` is required.
- Show confirmation dialog.
- Make it clear this is a soft archive.
- Do not delete menu source.
- Do not delete old subscriptions, selections, orders, payments, or subscription days.
- Archived item should disappear from public/customer planner.
- Archived item should remain available in dashboard via `archived` or `all` filters.

Recommended confirmation text:

```text
This will archive the premium upgrade only. It will not delete the menu item or historical customer records.
```

---

## 16. GET Readiness

### Endpoint

```http
GET /api/dashboard/premium-upgrades/readiness
```

### Purpose

Show operational diagnostics and readiness state.

### Example response

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
        "sourceId": "optionId",
        "sourceProductId": "basicMealProductId",
        "sourceGroupId": "proteinGroupId",
        "issues": []
      }
    ],
    "unresolvedSourceKeys": []
  },
  "status": true
}
```

### Readiness UI

Show a top banner:

#### Ready

```text
Premium upgrade system is ready.
Configs are authoritative.
Legacy fallback is off.
```

#### Warning

```text
Premium upgrade system has warnings.
Review missing configs, invalid sources, duplicate keys, or price mismatches.
```

#### Critical

```text
Partial config risk detected.
Do not publish to production until all known premium keys are configured.
```

### Important readiness rule

```text
If PremiumUpgradeConfig collection is empty:
legacy fallback can work.

If any PremiumUpgradeConfig rows exist:
configs become authoritative.
Partial config in production is not allowed.
```

Known keys:

```text
beef_steak
shrimp
salmon
premium_large_salad
```

---

## 17. Error Handling

Expected backend error codes can include:

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

Recommended frontend mapping:

| Error code | UI message |
|---|---|
| `PREMIUM_UPGRADE_REVISION_CONFLICT` | This item was changed by another admin. Refresh and try again. |
| `PREMIUM_UPGRADE_DUPLICATE` | This source is already linked as a premium upgrade. |
| `PREMIUM_UPGRADE_KEY_CONFLICT` | Premium key already exists. |
| `PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE` | This menu item is not eligible as a premium upgrade. |
| `PREMIUM_UPGRADE_RELATION_INVALID` | Source relation is invalid or missing. |
| `PREMIUM_UPGRADE_INVALID_DELTA` | Upgrade delta must be a valid non-negative amount. |
| `PREMIUM_UPGRADE_ARCHIVED` | This premium upgrade is archived and cannot be modified this way. |

---

## 18. Current Production/Staging Expected State

Current configured premium keys:

```text
beef_steak
shrimp
salmon
premium_large_salad
```

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

Expected candidates behavior:

```text
GET /candidates
=> data: []
```

because all current eligible candidates are already linked.

```text
GET /candidates?includeLinked=true
=> total: 4
```

with each item having:

```json
"isLinked": true
```

---

## 19. Frontend Implementation Checklist

### Must do

- Use `/api/dashboard/premium-upgrades` endpoints only for this screen.
- Fetch readiness on page load.
- Fetch list on page load.
- Use candidates endpoint inside add/link modal.
- Use `expectedRevision` on all PATCH/archive calls.
- Refresh row/list after mutation.
- Display `upgradeDeltaSar` when available.
- Submit `upgradeDeltaHalala` as write authority.
- Show diagnostics from `validation` and `sourceStatus`.
- Show `businessRule.doesAddMeal = false` clearly or internally assert it.

### Must not do

- Do not import or embed MealBuilderPage.
- Do not call Meal Builder draft APIs.
- Do not publish Meal Builder.
- Do not add new menu products/options from this screen.
- Do not hardcode config IDs.
- Do not allow duplicate links.
- Do not send `upgradeDeltaSar` as write authority.
- Do not treat premium upgrade as add-on.
- Do not change mobile/Flutter contracts.

---

## 20. Suggested Table Columns

```text
Name
Premium Key
Selection Type
Source Type
Source Context
Upgrade Delta
Enabled
Visible
Status
Valid
Sort Order
Actions
```

Actions:

```text
Edit price
Edit sort/display group
Hide/Show
Enable/Disable
Archive
View diagnostics
```

---

## 21. Suggested Filters Form Structure

For the main list screen, implement a filter bar with the following inputs mapping to query params:

| UI Label | Query Param | Input Type | Options |
|---|---|---|---|
| Search | `q` | Text Input | Search by name or key |
| Status | `status` | Select Box | `active`, `archived`, `all` |
| Enabled | `isEnabled` | Select Box | `true`, `false`, `all` |
| Visible | `isVisible` | Select Box | `true`, `false`, `all` |
| Source Type | `sourceType` | Select Box | `menu_option`, `menu_product`, `all` |
| Selection Type| `selectionType` | Select Box | `premium_meal`, `premium_large_salad`, `all` |

---

## 22. Suggested Add/Link Modal Fields

**Read-only Information (Display Only, taken from candidate):**

```text
Name
Source type
Source key
Product key
Group key
Premium key
Selection type
Eligibility diagnostics
Already linked flag
```

**Editable Form Fields (For Payload):**

| Form Field Label | Backend Payload Key | UI Input Type | Options |
|---|---|---|---|
| Display Group | `displayGroupKey` | Select Box | `premium_proteins`, `premium_salads` |
| Upgrade Delta (SAR) | `upgradeDeltaHalala` | Number Input | Multiply SAR by 100 before sending |
| Enabled | `isEnabled` | Toggle | `true`, `false` |
| Visible | `isVisible` | Toggle | `true`, `false` |
| Sort Order | `sortOrder` | Number Input | e.g. 10, 20, 30 |

Frontend should map these values back to the candidate data to submit the full payload:

```text
sourceId
sourceType
sourceProductId
sourceGroupId
premiumKey
selectionType
```

These come directly from the selected candidate and are usually submitted as hidden properties in the payload.

---

## 23. Notes for Price Display

Backend stores price in halala:

```text
2000 halala = 20 SAR
2900 halala = 29 SAR
```

Use:

```text
upgradeDeltaSar
```

for display if returned.

Use:

```text
upgradeDeltaHalala
```

for forms and API writes.

Recommended UI label:

```text
Upgrade delta
فرق سعر الترقية
```

---

## 24. Manual QA Scenarios

1. Open screen and confirm readiness is ready.
2. Confirm list shows 4 configs.
3. Confirm candidates without `includeLinked` returns empty after all four are linked.
4. Confirm candidates with `includeLinked=true` returns 4 linked items.
5. Edit Beef Steak delta from 20 SAR to 25 SAR, then restore to 20 SAR.
6. Hide one item and confirm list updates `isVisible=false`.
7. Show it again.
8. Try stale revision update and confirm conflict message.
9. Do not test archive on production unless intentionally archiving.
10. Confirm no request is sent to Meal Builder endpoints.

---

## 25. Example Current Known Configs

These are examples only. Do not hardcode IDs in frontend.

| premiumKey | selectionType | sourceType | default upgrade delta |
|---|---|---|---:|
| `beef_steak` | `premium_meal` | `menu_option` | `2000` |
| `shrimp` | `premium_meal` | `menu_option` | `2000` |
| `salmon` | `premium_meal` | `menu_option` | `2000` |
| `premium_large_salad` | `premium_large_salad` | `menu_product` | `2900` |

---

## 26. Final Frontend Rule

The screen is a **PremiumUpgradeConfig management screen**.

It is not:

```text
Meal Builder
Menu Product Creator
Menu Option Creator
Add-ons screen
One-time order pricing screen
Mobile contract screen
```

The only valid create action here is:

```text
Link an eligible existing menu item as a premium upgrade.
```