# 📱 API Integration Contract: Meal Planner v3 (Canonical) Schema Migration & Form Mapping Guide

This document is the authoritative integration contract and reference guide for the Flutter client team. It outlines the transition from legacy planner structures to the **v3 Canonical Schema**, describes the exact root cause of the `PLANNER_MIXED_LEGACY_CANONICAL_SLOT` validation error, maps frontend form controls to payload attributes, and documents the API payloads and responses.

---

## 🚨 1. Root Cause: Resolving `PLANNER_MIXED_LEGACY_CANONICAL_SLOT` (422 Error)

### The Issue
During selection validation (`POST /api/subscriptions/{id}/days/{date}/selection/validate`), the backend returned a **422 Unprocessable Entity** error:
* **Code:** `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`
* **Message:** `Canonical planner slot must not include legacy selection fields`

### Why This Happened
The mobile client sent a payload containing `contractVersion: "v3"` (or having `selectedOptions` arrays), which triggered the canonical v3 validation engine. However, the slot objects in the `mealSlots` array mixed **legacy structure fields** (`proteinId`, `carbs`, `carbId`, `salad`, `sandwichId`) with the new **canonical format fields** (`productId` and `selectedOptions`).

### The Fix
For any v3 request, **the client must completely remove all legacy flat fields from the slot object**. All custom selections (proteins, carbs, salads, dressings, etc.) must be serialized inside the nested `selectedOptions` array.

#### ❌ Mixed/Legacy Slot Structure (Wrong)
```json
{
  "slotIndex": 1,
  "selectionType": "standard_meal",
  "productId": "6a4ff8...", 
  "proteinId": "6a4ff8...", // ❌ FORBIDDEN: Legacy flat field
  "carbs": [                 // ❌ FORBIDDEN: Legacy flat field
    {
      "carbId": "6a4957...",
      "grams": 150
    }
  ]
}
```

####   Canonical v3 Slot Structure (Correct)
```json
{
  "slotIndex": 1,
  "selectionType": "standard_meal",
  "productId": "6a4ff8...",
  "selectedOptions": [      //    CORRECT: All choices nested here
    {
      "groupId": "6a4ff8_group_id",
      "groupKey": "proteins",
      "optionId": "6a4ff8_chicken_id",
      "optionKey": "grilled_chicken",
      "quantity": 1
    },
    {
      "groupId": "6a4957_group_id",
      "groupKey": "carbs",
      "optionId": "6a4957_rice_id",
      "optionKey": "white_rice",
      "quantity": 1,
      "grams": 150
    }
  ]
}
```

---

## 🎛️ 2. Frontend Form Control & Payload Mapping

To build the meal planning interface, map the visual elements in your forms to the JSON payload attributes as defined in the table below:

| UI Form Element | Component Type | Dynamic Option Source (from Catalog API) | Payload Attribute Mapping |
| :--- | :--- | :--- | :--- |
| **Meal Type / Slot Type** | `Toggle / Dropdown / Radio` | Static / Section Type mapping:<br>• `standard_meal`<br>• `premium_meal`<br>• `premium_large_salad`<br>• `sandwich`<br>• `full_meal_product` | `mealSlots[].selectionType` |
| **Product Selection** | `Grid of Cards / Select Box` | Catalog `products[]` inside the matching section. | `mealSlots[].productId` |
| **Protein Selection** | `Single-Select Radio / Cards` | Catalog `optionGroups[]` where `key == "proteins"` (or `groupKey == "proteins"`). | Appended to `mealSlots[].selectedOptions` array |
| **Carbs Selection** | `Multi-Select Checkboxes` | Catalog `optionGroups[]` where `key == "carbs"` (or `groupKey == "carbs"`). | Appended to `mealSlots[].selectedOptions` array |
| **Carbs Weight (Grams)** | `Slider / Dropdown List` | Static increments (e.g., `100`, `150`, `200`, `300`). Defaults to `150` grams. | `mealSlots[].selectedOptions[].grams` (Only sent for Carb options) |
| **Salad Customizations** | `Radios (Single) / Checkboxes (Multi)` | Catalog `optionGroups[]` inside the product for Salad. (E.g. `protein`, `vegetables`, `sauces`). | Appended to `mealSlots[].selectedOptions` array |
| **Daily Addons Selection** | `Checkbox List (Add List)` | Catalog `availableAddonChoices` or `addonCatalog`. | `requestedOneTimeAddonIds` (Flat array of product ID strings) |

---

## 🌐 3. Fetching Form Options dynamically: Catalog Response Schema

Before rendering any forms, fetch the available options and configuration limits for standard meals, premium upgrades, salads, and addons.

**Endpoint:** `GET /api/subscriptions/meal-planner-menu?contractVersion=v3`

### Simplified Catalog Structure
```json
{
  "ok": true,
  "data": {
    "plannerCatalog": {
      "contractVersion": "meal_planner_menu.v3",
      "currency": "SAR",
      "sections": [
        {
          "key": "custom_order",
          "sectionType": "option_family",
          "title": { "ar": "اطلب على مزاجك", "en": "Custom Order" },
          "products": [
            {
              "_id": "64abcdef01234567890abcde",
              "key": "basic_meal",
              "selectionType": "standard_meal",
              "name": { "ar": "وجبة بيسك", "en": "Basic Meal" },
              "action": {
                "type": "open_builder",
                "requiresBuilder": true,
                "treatAsFullMeal": false
              },
              "optionGroups": [
                {
                  "groupId": "64bcdef01234567890f11111",
                  "key": "proteins",
                  "name": { "ar": "بروتين", "en": "Protein" },
                  "minSelections": 1,
                  "maxSelections": 1,
                  "isRequired": true,
                  "options": [
                    {
                      "optionId": "64cdef01234567890f222222",
                      "key": "grilled_chicken",
                      "name": { "ar": "دجاج مشوي", "en": "Grilled Chicken" },
                      "extraPriceHalala": 0
                    },
                    {
                      "optionId": "64cdef01234567890f222223",
                      "key": "beef_steak",
                      "name": { "ar": "ستيك لحم", "en": "Beef Steak" },
                      "extraPriceHalala": 2000 // Displays premium cost badge if applicable
                    }
                  ]
                },
                {
                  "groupId": "64bcdef01234567890f33333",
                  "key": "carbs",
                  "name": { "ar": "كارب", "en": "Carbs" },
                  "minSelections": 1,
                  "maxSelections": 2,
                  "isRequired": true,
                  "options": [
                    {
                      "optionId": "64cdef01234567890f444444",
                      "key": "white_rice",
                      "name": { "ar": "رز ابيض", "en": "White Rice" },
                      "extraPriceHalala": 0
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
}
```

> [!TIP]
> **Form Rendering logic:** 
> * If `action.requiresBuilder == false` (e.g. for `full_meal_product` or `sandwich`), add the product directly. Do not render custom option groups.
> * If `action.requiresBuilder == true`, iterate over the `optionGroups` array. Use `minSelections` and `maxSelections` to determine whether to render radio buttons (single selection) or checkboxes (multiple selection).

---

## 🛠️ 4. Form Submission & Validation Payloads (v3)

Submit user selection updates dynamically to validate pricing and rules.

**Endpoint:** `POST /api/subscriptions/{subscriptionId}/days/{date}/selection/validate`  
**Save Endpoint:** `PUT /api/subscriptions/{subscriptionId}/days/{date}/selection`

### A. Standard Meal / Premium Meal Form Payload
For a standard meal (with chicken and white rice) and a premium meal (with beef steak):
```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_meal",
      "productId": "64abcdef01234567890abcde",
      "selectedOptions": [
        {
          "groupId": "64bcdef01234567890f11111",
          "groupKey": "proteins",
          "optionId": "64cdef01234567890f222222",
          "optionKey": "grilled_chicken",
          "quantity": 1
        },
        {
          "groupId": "64bcdef01234567890f33333",
          "groupKey": "carbs",
          "optionId": "64cdef01234567890f444444",
          "optionKey": "white_rice",
          "quantity": 1,
          "grams": 150
        }
      ]
    }
  ],
  "requestedOneTimeAddonIds": []
}
```

### B. Premium Large Salad Form Payload
For salads, customize option groups like `protein` (allowlisted only), `vegetables`, and `sauce`:
```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "premium_large_salad",
      "productId": "64a000000000000000000001",
      "selectedOptions": [
        {
          "groupId": "64b000000000000000000001",
          "groupKey": "protein",
          "optionId": "64c000000000000000000001",
          "optionKey": "grilled_chicken",
          "quantity": 1
        },
        {
          "groupId": "64b000000000000000000002",
          "groupKey": "vegetables",
          "optionId": "64c000000000000000000002",
          "optionKey": "lettuce",
          "quantity": 1
        },
        {
          "groupId": "64b000000000000000000003",
          "groupKey": "sauce",
          "optionId": "64c000000000000000000003",
          "optionKey": "ranch_dressing",
          "quantity": 1
        }
      ]
    }
  ],
  "requestedOneTimeAddonIds": []
}
```

### C. Sandwich / Full Meal Product Form Payload (Direct Add)
For items that do not require building (indicated by `action.requiresBuilder == false` / `action.treatAsFullMeal == true`), send an empty `selectedOptions` array:
```json
{
  "contractVersion": "meal_planner_menu.v3",
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "full_meal_product",
      "productId": "64a999999999999999999999",
      "selectedOptions": []
    }
  ],
  "requestedOneTimeAddonIds": []
}
```

---

## 📬 5. Responses Specification

### Validation Success Response (200 OK)
Indicates the payload options conform to validation rules and details payment specifications:
```json
{
  "ok": true,
  "data": {
    "valid": true,
    "paymentRequirement": {
      "requiresPayment": true, // Binding for payment CTA bar
      "pendingAmountHalala": 2000, // Total overage fee to display (e.g. 20.00 SAR)
      "currency": "SAR",
      "blockingReason": "PREMIUM_UPGRADE_REQUIRED"
    }
  }
}
```

### Validation Error Response (422 Unprocessable Entity)
When form inputs violate business rules. Map `field` attributes in `details.slotErrors` to highlight the exact input elements on the UI:
```json
{
  "ok": false,
  "error": {
    "code": "PLANNER_MIN_SELECTION_NOT_MET",
    "message": "proteins requires at least 1 selection",
    "details": {
      "slotErrors": [
        {
          "slotIndex": 1,
          "code": "PLANNER_MIN_SELECTION_NOT_MET",
          "message": "proteins requires at least 1 selection",
          "field": "mealSlots[0].selectedOptions",
          "productId": "64abcdef01234567890abcde",
          "groupId": "64bcdef01234567890f11111"
        }
      ]
    }
  }
}
```

#### Stable Error Codes to Handle
* `PLANNER_MIXED_LEGACY_CANONICAL_SLOT`: Client sent legacy fields. **Must remove legacy parameters.**
* `PLANNER_MIN_SELECTION_NOT_MET`: The selected option group has fewer options than required.
* `PLANNER_MAX_SELECTION_EXCEEDED`: The selected option group has exceeded the max limit.
* `SALAD_PROTEIN_NOT_ALLOWED`: Selected salad protein is not allowlisted.
* `PLANNER_OPTION_GROUP_UNAVAILABLE`: Option group is unavailable for the selected meal type (e.g., extra protein is disabled for salads).
* `PLANNER_INVALID_QUANTITY`: Selected option quantity must be greater than or equal to 1.

---

## 💳 6. Commercial checkout: Handling Payments (402 Error)

When a selection is saved via `PUT`, the backend verifies if payment is required. If a balance needs to be paid (e.g., premium meal upgrades or addon selections exceed standard allocations), it blocks saving and returns a **402 Payment Required** response.

### 402 Error Envelope
```json
{
  "ok": false,
  "error": {
    "status": 402,
    "code": "ADDON_PAYMENT_REQUIRED",
    "message": "Selections require payment.",
    "details": {
      "requiresPayment": true,
      "pendingAmountHalala": 2000
    }
  }
}
```

### Checkout & Verification Flow

1. **Trigger Checkout Payment:** Upon receiving a `402` response, extract the payment requirement details and initiate a day payment.
   
   **Endpoint:** `POST /api/subscriptions/{subscriptionId}/days/{date}/payments`
   
   **Response:**
   ```json
   {
     "paymentId": "pay_64bbbbbbbbbbbbbbbbbb",
     "status": "initiated",
     "requiresPayment": true,
     "totalHalala": 2000,
     "paymentUrl": "https://checkout.basicdiet.com/pay_64bbbbbbbbbbbbbbbbbb"
   }
   ```

2. **Open WebView / Native Payment Gate:** Redirect the user to the `paymentUrl` to complete the transaction.

3. **Verify Payment:** Once the user completes payment, check transaction status.
   
   **Endpoint:** `POST /api/subscriptions/{subscriptionId}/days/{date}/payments/{paymentId}/verify`
   
   **Response:**
   ```json
   {
     "ok": true,
     "data": {
       "status": "paid"
     }
   }
   ```

4. **Re-submit Selection:** Proceed with finalizing the selections.
