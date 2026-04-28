# Flutter Integration Manual For Subscription Meal Planner Backend

This document is the final Flutter integration reference for the current backend code on branch `main`.

Use this file as the source of truth for Flutter work. If any old report, stale Swagger interpretation, or legacy frontend assumption conflicts with this document, follow this document and the current backend behavior.

---

## 1. Backend Status Summary

### Canonical contract now in production
- The canonical meal planner write contract is `mealSlots`.
- Each slot must use canonical `selectionType` values only:
  - `standard_meal`
  - `premium_meal`
  - `premium_large_salad`
  - `sandwich`
- Carb selection is canonical only as `carbs: [{ carbId, grams }]`.
- Premium salad is canonical only as:
  - `selectionType: "premium_large_salad"`
  - `salad.groups`
  - entitlement key remains `custom_premium_salad`

### Intentional legacy behavior that still exists
- Backend still accepts some legacy planner input for backward compatibility during normalization:
  - `standard_combo`
  - `custom_premium_salad`
  - top-level `carbId`
  - legacy `customSalad`
- This compatibility is input-only and should not be used by Flutter.
- `/api/builder/premium-meals` intentionally preserves the older `custom_premium_salad` catalog shape for old clients. Flutter should not use this endpoint for meal planner state.

### Canonical endpoints Flutter is allowed to use
- `GET /api/subscriptions/meal-planner-menu`
- `GET /api/subscriptions/current/overview`
- `GET /api/subscriptions/:id`
- `GET /api/subscriptions/:id/timeline`
- `GET /api/subscriptions/:id/days/:date`
- `POST /api/subscriptions/:id/days/:date/selection/validate`
- `PUT /api/subscriptions/:id/days/:date/selection`
- `PUT /api/subscriptions/:id/days/selections/bulk`
- `POST /api/subscriptions/:id/days/:date/confirm`
- `POST /api/subscriptions/:id/days/:date/premium-extra/payments`
- `POST /api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify`
- `POST /api/subscriptions/:id/days/:date/one-time-addons/payments/verify`

### Deprecated or unsupported endpoints Flutter must not use
- `POST /api/subscriptions/:id/addon-selections`
- `DELETE /api/subscriptions/:id/addon-selections`
- `POST /api/subscriptions/:id/premium-selections`
- `DELETE /api/subscriptions/:id/premium-selections`

These routes intentionally return `422` and instruct the client to use canonical `mealSlots` via `/days/:date/selection`.

---

## 2. Global Rules For Flutter

- Always send canonical `mealSlots`. Never build new planner writes using legacy fields.
- Never use `standard_combo` or `custom_premium_salad` as input `selectionType`.
- Never send top-level `carbId` instead of `carbs[]`.
- Never use helper endpoints for premium/addon slot mutation. They are unsupported on purpose.
- Never infer readiness from `status` alone.
- Always read:
  - `paymentRequirement`
  - `commercialState`
  - `plannerMeta`
  - `plannerState`
  together.
- Do not reimplement planner validation rules locally. Use validate and save endpoints.
- Do not assume premium payment is resolved until `verify` returns updated day state.
- After any successful save, verify, or confirm, replace local day state with backend response.
- If backend returns `idempotent: true`, still trust returned `data` as the source of truth.
- Use `Accept-Language: en` or `ar` if localized labels are needed.
- All subscription endpoints documented here assume authenticated client access with `Authorization: Bearer <token>`.

---

## 3. Canonical Data Contracts

All examples below are practical shapes consumed by Flutter. Not every response contains every field, but these are the fields Flutter should understand.

### 3.1 API Envelope

Successful responses:

```json
{
  "ok": true,
  "data": {}
}
```

Error responses:

```json
{
  "ok": false,
  "error": {
    "code": "LOCKED",
    "message": "Day is locked",
    "details": {}
  }
}
```

`error.details` is optional.

### 3.2 `mealSlot`

Canonical read/write slot object:

| Field | Type | Required on write | Meaning |
|---|---|---:|---|
| `slotIndex` | `number` | yes | 1-based slot number for the day |
| `slotKey` | `string` | recommended | stable slot identity, normally `slot_1`, `slot_2`, etc. |
| `selectionType` | enum | yes | `standard_meal`, `premium_meal`, `premium_large_salad`, `sandwich` |
| `proteinId` | `string \| null` | depends | protein for standard/premium meals |
| `carbs` | `Array<{ carbId: string, grams: number }>` | depends | canonical carb split |
| `sandwichId` | `string \| null` | depends | sandwich meal id |
| `salad` | `object \| null` | depends | grouped premium large salad payload |
| `status` | enum | no | backend-computed `empty`, `partial`, `complete` |
| `isPremium` | `boolean` | no | backend-computed |
| `premiumKey` | `string \| null` | no | backend entitlement key |
| `premiumSource` | enum | no | `none`, `balance`, `pending_payment`, `paid_extra`, `paid` |
| `premiumExtraFeeHalala` | `number` | no | extra amount for unpaid premium slot |

Important Flutter notes:
- On write, Flutter should send only the canonical selection fields.
- Do not send `status`, `isPremium`, `premiumSource`, or `premiumExtraFeeHalala` unless a special admin/debug tool explicitly requires it. Backend computes them.
- On read, Flutter should use returned `status` and premium fields to render the current state.

### 3.3 `mealSlot.salad`

Canonical premium large salad object:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `presetKey` | `string \| null` | no | optional preset label |
| `groups` | `object` | yes for salad slot | grouped selected ingredient ids |

Expected `groups` keys:
- `leafy_greens`
- `vegetables`
- `fruits`
- `protein`
- `cheese_nuts`
- `sauce`

Validation rules:
- Exactly 1 `protein`
- Exactly 1 `sauce`
- Protein must be premium
- No `carbs`
- No `sandwichId`

### 3.4 `plannerMeta`

Returned on day read, validate, save, confirm, and related day responses.

| Field | Type | Meaning |
|---|---|---|
| `requiredSlotCount` | `number` | how many slots must be complete |
| `emptySlotCount` | `number` | backend-computed |
| `partialSlotCount` | `number` | backend-computed |
| `completeSlotCount` | `number` | backend-computed |
| `beefSlotCount` | `number` | backend-computed beef family count |
| `premiumSlotCount` | `number` | total premium slots |
| `premiumCoveredByBalanceCount` | `number` | premium slots covered by entitlement balance |
| `premiumPendingPaymentCount` | `number` | premium slots still waiting for payment |
| `premiumPaidExtraCount` | `number` | premium slots already paid as extras |
| `premiumTotalHalala` | `number` | pending premium extra total |
| `isDraftValid` | `boolean` | planner passes rules |
| `isConfirmable` | `boolean` | complete, valid, and no pending premium payment |
| `lastEditedAt` | ISO datetime | latest planner edit |
| `confirmedAt` | ISO datetime or `null` | when confirmed |
| `confirmedByRole` | `string \| null` | normally `client` when client confirmed |

### 3.5 `PaymentRequirement`

This is the backend truth for payment and confirm blocking.

| Field | Type | Meaning |
|---|---|---|
| `status` | enum | `satisfied`, `priced`, `pending`, `failed` |
| `requiresPayment` | `boolean` | whether the day currently requires payment |
| `pricingStatus` | enum | `not_required`, `priced`, `pending`, `failed` |
| `blockingReason` | enum or `null` | why the day is blocked |
| `canCreatePayment` | `boolean` | whether Flutter is allowed to create a payment now |
| `premiumSelectedCount` | `number` | total premium slots |
| `premiumPendingPaymentCount` | `number` | unpaid premium slots |
| `addonSelectedCount` | `number` | total selected add-ons for that day |
| `addonPendingPaymentCount` | `number` | unpaid one-time add-ons |
| `pendingAmountHalala` | `number` | total currently unpaid amount |
| `amountHalala` | `number` | same total amount currently payable |
| `currency` | `string` | currently `SAR` |
| `pricingStatusLabel` | localized string | localized display helper |
| `blockingReasonLabel` | localized string or `null` | localized display helper |

Current `blockingReason` values:
- `locked`
- `planning_incomplete`
- `payment_revision_mismatch`
- `pricing_failed`
- `pricing_pending`
- `premium_pending_payment`
- `addons_pending_payment`
- `planner_unconfirmed`

### 3.6 `commercialState`

Derived backend state for planner workflow:

| Value | Meaning |
|---|---|
| `draft` | planner is incomplete or invalid |
| `payment_required` | planner is complete but blocked by unpaid amount |
| `ready_to_confirm` | planner is valid, complete, and payable state is clear |
| `confirmed` | planner has been confirmed |

### 3.7 Timeline day

Returned by `GET /api/subscriptions/:id/timeline`.

| Field | Type | Meaning |
|---|---|---|
| `date` | `string` | KSA business date `YYYY-MM-DD` |
| `status` | enum | normalized day state used for timeline UI |
| `statusLabel` | `string` | localized label |
| `selectedMeals` | `number` | selected count |
| `requiredMeals` | `number` | required count |
| `commercialState` | enum | planner workflow state |
| `commercialStateLabel` | `string` | localized label |
| `isFulfillable` | `boolean` | true only when planner is confirmed and no payment is pending |
| `canBePrepared` | `boolean` | same current operational gate used by backend |
| `paymentRequirement` | `PaymentRequirement \| null` | payment truth |
| `fulfillmentMode` | `string` | backend fulfillment mode |
| `consumptionState` | `string` | backend consumption state |
| `requiredMealCount` | `number` | fulfillment count |
| `specifiedMealCount` | `number` | fulfillment count |
| `unspecifiedMealCount` | `number` | fulfillment count |
| `hasCustomerSelections` | `boolean` | whether customer selected anything |
| `planningReady` | `boolean` | backend planning readiness flag |
| `fulfillmentReady` | `boolean` | backend fulfillment readiness flag |
| `selectedMealIds` | `string[]` | legacy compatibility ids |
| `mealSlots` | `mealSlot[]` | canonical slot read model |

### 3.8 Premium summary

Returned in current overview.

| Field | Type | Meaning |
|---|---|---|
| `premiumMealId` | `string` | protein id or static legacy key |
| `premiumKey` | enum string | canonical premium identity such as `shrimp`, `salmon`, `beef_steak`, `custom_premium_salad` |
| `name` | `string` | localized display name |
| `purchasedQtyTotal` | `number` | purchased entitlement total |
| `remainingQtyTotal` | `number` | remaining entitlement total |
| `consumedQtyTotal` | `number` | purchased minus remaining |

### 3.9 `addonSelections`

Day-level add-ons currently on the day.

| Field | Type | Meaning |
|---|---|---|
| `addonId` | `string` | addon id |
| `name` | localized object or string | stored addon name |
| `category` | `string` | addon category |
| `source` | enum | `subscription`, `wallet`, `pending_payment`, `paid` |
| `priceHalala` | `number` | day-level charged amount |
| `currency` | `string` | usually `SAR` |
| `paymentId` | `string \| null` | linked payment when applicable |

Flutter note:
- `source: "pending_payment"` means add-on exists on day but still needs payment.
- One-time add-on payment endpoints only operate on pending add-ons already present on the day.

---

## 4. Minimal Flutter Models

Flutter developers should implement at least the following models. This is NOT a full codegen, but the critical structure for a stable integration.

### 4.1 `MealSlot`
*The fundamental unit of the planner.*

```dart
class MealSlot {
  final int slotIndex;
  final String slotKey;
  final String selectionType; // standard_meal, premium_meal, ...
  final String? proteinId;
  final List<CarbSelection>? carbs;
  final String? sandwichId;
  final SaladSelection? salad;

  // Computed (read-only)
  final String status; // empty, partial, complete
  final bool isPremium;
  final String? premiumKey;
  final String premiumSource; // none, balance, pending_payment, ...
  final int premiumExtraFeeHalala;
}
```

- **Source of Truth**: **Backend.** Always use returned values to render UI states (e.g., "Paid", "Pending Payment").

### 4.2 `PlannerMeta`
*The summary of the day's planning rules and state.*

```dart
class PlannerMeta {
  final bool isDraftValid;
  final bool isConfirmable;
  final int requiredSlotCount;
  final int completeSlotCount;
  final int premiumSlotCount;
  final int premiumPendingPaymentCount;
  final DateTime? confirmedAt;
}
```

- **Critical Fields**: `isConfirmable` is the primary gate for the final "Confirm" button.

### 4.3 `PaymentRequirement`
*The orchestrator of the checkout/confirm flow.*

```dart
class PaymentRequirement {
  final String status; // satisfied, priced, pending, failed
  final bool requiresPayment;
  final String? blockingReason;
  final bool canCreatePayment;
  final int pendingAmountHalala;
}
```

### 4.4 `TimelineDay`
*For the calendar overview.*

```dart
class TimelineDay {
  final String date;
  final String status; // Operational status (open, locked, delivered...)
  final String commercialState; // Planner state (draft, ready_to_confirm...)
  final bool isFulfillable;
  final List<MealSlot> mealSlots;
}
```

### 4.5 `SubscriptionOverviewPremiumSummary`
*For the entitlement/wallet view.*

```dart
class PremiumSummary {
  final String premiumKey; // shrimp, salmon, beef_steak...
  final String name;
  final int remainingQtyTotal;
}
```

### 4.6 `AddonSelection`
*Individual add-ons on a day.*

```dart
class AddonSelection {
  final String addonId;
  final String source; // subscription, wallet, pending_payment, paid
  final int priceHalala;
}
```

---

## 5. Field Ownership Clarification

To reduce integration errors, follow this ownership model:

| Field Category | Sent by Flutter | Computed by Backend | Read-only for Flutter |
|---|:---:|:---:|:---:|
| `slotIndex` | ✅ | | |
| `selectionType` | ✅ | | |
| `proteinId` / `carbs` / `sandwichId` | ✅ | | |
| `status` (empty/partial/complete) | | ✅ | ✅ |
| `isPremium` / `premiumKey` | | ✅ | ✅ |
| `premiumSource` / `premiumExtraFeeHalala` | | ✅ | ✅ |
| `plannerMeta` / `paymentRequirement` | | ✅ | ✅ |
| `commercialState` | | ✅ | ✅ |

> [!IMPORTANT]
> **Golden Rule:** Never author "computed" fields from Flutter. Even if you think you know the status or the premium fee, trust only the returned server state after a `validate` or `save`.

---

## 6. Which Endpoint Should Flutter Use?

A quick guide for the correct API for every UI scenario:

| Screen / Action | Correct Endpoint |
|---|---|
| **Opening Day Planner** | `GET /api/subscriptions/:id/days/:date` |
| **Loading Selection Menu** | `GET /api/subscriptions/meal-planner-menu` |
| **Real-time UX Validation** | `POST /api/subscriptions/:id/days/:date/selection/validate` |
| **Saving Selections** | `PUT /api/subscriptions/:id/days/:date/selection` |
| **Starting Payment** | `POST /api/subscriptions/:id/days/:date/premium-extra/payments` |
| **After returning from Moyasar** | `POST /api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify` |
| **Confirming Day** | `POST /api/subscriptions/:id/days/:date/confirm` |
| **Applying same meal to bulk** | `PUT /api/subscriptions/:id/days/selections/bulk` |

---

## 7. Common Flutter Integration Mistakes

- ❌ **Mistake:** Using `status` (of a day or slot) alone to enable the "Confirm" button.
  - ✅ **Correct:** Use `plannerMeta.isConfirmable` AND `paymentRequirement.requiresPayment === false`.
- ❌ **Mistake:** Sending `carbId` as a top-level field in `mealSlot`.
  - ✅ **Correct:** Send `carbs: [{ "carbId": "...", "grams": 150 }]` (even for single carb).
- ❌ **Mistake:** Using `custom_premium_salad` or `standard_combo` as an input `selectionType`.
  - ✅ **Correct:** Use `selectionType: "premium_large_salad"` or `"standard_meal"`.
- ❌ **Mistake:** Calling legacy helper endpoints (`/addon-selections`).
  - ✅ **Correct:** Include add-on IDs in `addonsOneTime[]` inside the main `selection` PUT.
- ❌ **Mistake:** Assuming `save` is enough to finalize the day.
  - ✅ **Correct:** Users must **Save**, then **Pay** (if priced), then **Confirm**.
- ❌ **Mistake:** Not calling `verify` after a successful payment transaction.
  - ✅ **Correct:** The backend must synchronize provider status before the day becomes confirmable.
- ❌ **Mistake:** Ignoring per-date results in `bulk` save.
  - ✅ **Correct:** Bulk response can have mixed results (some dates ok, some failed).

---

## 8. Endpoints

Base prefix in production app routing: `/api`

### Common headers for all authenticated Flutter requests

```http
Authorization: Bearer <app-access-token>
Accept-Language: en
Content-Type: application/json
```

If `Accept-Language` is omitted, localized labels still exist but may default by server language resolution.

---

### 8.1 Get meal planner menu

- **Method:** `GET`
- **Path:** `/api/subscriptions/meal-planner-menu`
- **Purpose:** load all planner menus and builder catalog data needed to render planner UI
- **Status:** canonical
- **Request body:** none

#### Success response shape

```json
{
  "ok": true,
  "data": {
    "currency": "SAR",
    "regularMeals": [],
    "premiumMeals": [],
    "addons": [],
    "builderCatalog": {
      "categories": [],
      "proteins": [],
      "premiumProteins": [],
      "carbs": [],
      "sandwiches": [],
      "premiumLargeSalad": {},
      "rules": {}
    }
  }
}
```

#### Request Body Example

No request body.

#### Response Example

```json
{
  "ok": true,
  "data": {
    "currency": "SAR",
    "builderCatalog": {
      "proteins": [
        {
          "id": "680f1a111111111111111111",
          "displayCategoryKey": "protein_category",
          "name": "Chicken",
          "description": "Grilled chicken",
          "proteinFamilyKey": "chicken",
          "ruleTags": [],
          "selectionType": "standard_meal",
          "isPremium": false,
          "sortOrder": 0
        }
      ],
      "premiumProteins": [
        {
          "id": "680f1a222222222222222222",
          "displayCategoryKey": "protein_category",
          "name": "Shrimp",
          "description": "Grilled shrimp",
          "proteinFamilyKey": "seafood",
          "ruleTags": ["premium"],
          "selectionType": "premium_meal",
          "isPremium": true,
          "premiumKey": "shrimp",
          "extraFeeHalala": 1500,
          "sortOrder": 0
        }
      ],
      "carbs": [
        {
          "id": "680f1a333333333333333333",
          "displayCategoryKey": "protein_category",
          "name": "Rice",
          "description": "Steamed rice",
          "sortOrder": 0
        }
      ],
      "sandwiches": [
        {
          "id": "680f1a444444444444444444",
          "name": "Sandwich",
          "description": "Sandwich meal",
          "imageUrl": null,
          "calories": null,
          "selectionType": "sandwich"
        }
      ],
      "premiumLargeSalad": {
        "id": "premium_large_salad",
        "enabled": true,
        "premiumKey": "custom_premium_salad",
        "selectionType": "premium_large_salad",
        "extraFeeHalala": 3000,
        "groups": [
          { "key": "leafy_greens", "name": "Leafy Greens", "minSelect": 0, "maxSelect": 99 },
          { "key": "vegetables", "name": "Vegetables", "minSelect": 0, "maxSelect": 99 },
          { "key": "fruits", "name": "Fruits", "minSelect": 0, "maxSelect": 99 },
          { "key": "protein", "name": "Protein", "minSelect": 1, "maxSelect": 1 },
          { "key": "cheese_nuts", "name": "Cheese & Nuts", "minSelect": 0, "maxSelect": 99 },
          { "key": "sauce", "name": "Sauce", "minSelect": 1, "maxSelect": 1 }
        ],
        "ingredients": []
      },
      "rules": {
        "version": "meal_planner_rules.v2",
        "beef": { "proteinFamilyKey": "beef", "maxSlotsPerDay": 1 },
        "standardCarbs": { "maxTypes": 2, "maxTotalGrams": 300 }
      }
    }
  }
}
```

#### Flutter behavior
- Use `builderCatalog.proteins`, `premiumProteins`, `carbs`, `sandwiches`, and `premiumLargeSalad`.
- Do not use `regularMeals` or `premiumMeals` as the planner write source.
- Ignore any old expectation of `large_salad` appearing in `carbs`; it is intentionally excluded.

---

### 8.2 Get current subscription overview

- **Method:** `GET`
- **Path:** `/api/subscriptions/current/overview`
- **Purpose:** top-level overview for active or pending-payment subscription
- **Status:** canonical read endpoint
- **Request body:** none

#### Request Body Example

No request body.

#### Success response example

```json
{
  "ok": true,
  "data": {
    "_id": "680f1b111111111111111111",
    "status": "active",
    "deliveryMode": "pickup",
    "premiumBalance": [
      {
        "proteinId": "680f1a222222222222222222",
        "premiumKey": "shrimp",
        "purchasedQty": 2,
        "remainingQty": 1
      }
    ],
    "premiumSummary": [
      {
        "premiumMealId": "680f1a222222222222222222",
        "premiumKey": "shrimp",
        "name": "Shrimp",
        "purchasedQtyTotal": 2,
        "remainingQtyTotal": 1,
        "consumedQtyTotal": 1
      },
      {
        "premiumMealId": "custom_premium_salad",
        "premiumKey": "custom_premium_salad",
        "name": "Custom Premium Salad",
        "purchasedQtyTotal": 0,
        "remainingQtyTotal": 0,
        "consumedQtyTotal": 0
      }
    ],
    "businessDate": "2026-04-28",
    "pickupPreparation": null
  }
}
```

#### Flutter behavior
- Use this endpoint for subscription home/overview.
- Use `premiumSummary` for wallet/entitlement UI.
- `current/overview` may return `data: null` if user has no active or pending-payment subscription.

---

### 8.3 Get a subscription

- **Method:** `GET`
- **Path:** `/api/subscriptions/:id`
- **Purpose:** full subscription read payload
- **Status:** canonical read endpoint
- **Request body:** none

#### Request Body Example

No request body.

#### Flutter behavior
- Useful when the app needs the full serialized subscription object.
- `current/overview` is usually enough for dashboard/home use.

---

### 8.4 Get subscription timeline

- **Method:** `GET`
- **Path:** `/api/subscriptions/:id/timeline`
- **Purpose:** full per-day timeline with planner/commercial/fulfillment interpretation
- **Status:** canonical
- **Request body:** none

#### Request Body Example

No request body.

#### Response example

```json
{
  "ok": true,
  "data": {
    "subscriptionId": "680f1b111111111111111111",
    "dailyMealsRequired": 2,
    "premiumMealsRemaining": 0,
    "premiumMealsSelected": 0,
    "premiumBalanceBreakdown": [],
    "days": [
      {
        "date": "2026-04-30",
        "day": "Thu",
        "month": "APR",
        "dayNumber": 30,
        "status": "open",
        "statusLabel": "Open",
        "selectedMeals": 2,
        "requiredMeals": 2,
        "commercialState": "ready_to_confirm",
        "commercialStateLabel": "Ready to Confirm",
        "isFulfillable": false,
        "canBePrepared": false,
        "paymentRequirement": {
          "status": "satisfied",
          "requiresPayment": false,
          "pricingStatus": "not_required",
          "blockingReason": "planner_unconfirmed",
          "canCreatePayment": false,
          "premiumSelectedCount": 0,
          "premiumPendingPaymentCount": 0,
          "addonSelectedCount": 0,
          "addonPendingPaymentCount": 0,
          "pendingAmountHalala": 0,
          "amountHalala": 0,
          "currency": "SAR",
          "pricingStatusLabel": "Not Required",
          "blockingReasonLabel": "Planner Unconfirmed"
        },
        "mealSlots": [
          {
            "slotIndex": 1,
            "slotKey": "slot_1",
            "status": "complete",
            "selectionType": "standard_meal",
            "proteinId": "680f1a111111111111111111",
            "carbs": [
              { "carbId": "680f1a333333333333333333", "grams": 150 }
            ],
            "sandwichId": null,
            "salad": null,
            "isPremium": false,
            "premiumKey": null,
            "premiumSource": "none",
            "premiumExtraFeeHalala": 0
          }
        ]
      }
    ]
  }
}
```

#### Flutter behavior
- Timeline UI should render from `days[]`.
- Do not use `status` alone to decide if confirm, payment, or fulfillment actions are possible.
- For planner CTA logic, use:
  - `commercialState`
  - `paymentRequirement`
  - `isFulfillable`
  - `canBePrepared`

---

### 8.5 Get a single day

- **Method:** `GET`
- **Path:** `/api/subscriptions/:id/days/:date`
- **Purpose:** fetch current canonical planner day state
- **Status:** canonical
- **Path params:**
  - `id`: subscription id
  - `date`: `YYYY-MM-DD`
- **Request body:** none

#### Request Body Example

No request body.

#### Response example

```json
{
  "ok": true,
  "data": {
    "date": "2026-04-30",
    "status": "open",
    "statusLabel": "Open",
    "plannerState": "draft",
    "plannerMeta": {
      "requiredSlotCount": 2,
      "emptySlotCount": 0,
      "partialSlotCount": 0,
      "completeSlotCount": 2,
      "beefSlotCount": 0,
      "premiumSlotCount": 0,
      "premiumCoveredByBalanceCount": 0,
      "premiumPendingPaymentCount": 0,
      "premiumPaidExtraCount": 0,
      "premiumTotalHalala": 0,
      "isDraftValid": true,
      "isConfirmable": true
    },
    "paymentRequirement": {
      "status": "satisfied",
      "requiresPayment": false,
      "pricingStatus": "not_required",
      "blockingReason": "planner_unconfirmed",
      "canCreatePayment": false,
      "premiumSelectedCount": 0,
      "premiumPendingPaymentCount": 0,
      "addonSelectedCount": 0,
      "addonPendingPaymentCount": 0,
      "pendingAmountHalala": 0,
      "amountHalala": 0,
      "currency": "SAR"
    },
    "commercialState": "ready_to_confirm",
    "isFulfillable": false,
    "canBePrepared": false,
    "rules": {
      "version": "meal_planner_rules.v2",
      "beef": { "proteinFamilyKey": "beef", "maxSlotsPerDay": 1 },
      "standardCarbs": { "maxTypes": 2, "maxTotalGrams": 300 }
    },
    "mealSlots": [
      {
        "slotIndex": 1,
        "slotKey": "slot_1",
        "status": "complete",
        "selectionType": "standard_meal",
        "proteinId": "680f1a111111111111111111",
        "carbs": [
          { "carbId": "680f1a333333333333333333", "grams": 150 }
        ],
        "sandwichId": null,
        "salad": null,
        "isPremium": false,
        "premiumKey": null,
        "premiumSource": "none",
        "premiumExtraFeeHalala": 0
      }
    ]
  }
}
```

#### Flutter behavior
- This is the primary screen source for a day detail screen.
- After validate/save/payment verify/confirm, replace the local day state with the latest response from backend.

---

### 8.6 Validate planner selection

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/selection/validate`
- **Purpose:** validate a potential planner payload without saving
- **Status:** canonical
- **Request body:** required

#### Request Body Example

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "proteinId": "680f1a111111111111111111",
      "carbs": [
        { "carbId": "680f1a333333333333333333", "grams": 150 }
      ]
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "sandwich",
      "sandwichId": "680f1a444444444444444444"
    }
  ]
}
```

#### Success response example

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "plannerState": "draft",
    "plannerMeta": {
      "requiredSlotCount": 2,
      "completeSlotCount": 2,
      "partialSlotCount": 0,
      "emptySlotCount": 0,
      "premiumPendingPaymentCount": 0,
      "isDraftValid": true,
      "isConfirmable": true
    },
    "mealSlots": [],
    "plannerRevisionHash": "sha256hash",
    "premiumSummary": {
      "selectedCount": 0,
      "coveredByBalanceCount": 0,
      "pendingPaymentCount": 0,
      "paidExtraCount": 0,
      "totalExtraHalala": 0,
      "currency": "SAR"
    },
    "premiumExtraPayment": {
      "status": "none",
      "amountHalala": 0,
      "currency": "SAR",
      "revisionHash": "sha256hash",
      "extraPremiumCount": 0
    },
    "paymentRequirement": {
      "status": "satisfied",
      "requiresPayment": false,
      "pricingStatus": "not_required",
      "blockingReason": "planner_unconfirmed",
      "canCreatePayment": false,
      "premiumSelectedCount": 0,
      "premiumPendingPaymentCount": 0,
      "addonSelectedCount": 0,
      "addonPendingPaymentCount": 0,
      "pendingAmountHalala": 0,
      "amountHalala": 0,
      "currency": "SAR"
    },
    "commercialState": "ready_to_confirm",
    "isFulfillable": false,
    "canBePrepared": false,
    "rules": {
      "version": "meal_planner_rules.v2"
    }
  }
}
```

#### Important error cases
- `400 INVALID` if `mealSlots` is missing or not an array
- `422 INVALID_MEAL_PLAN` with `error.details.slotErrors`
- `422 BEEF_LIMIT_EXCEEDED`
- `422 INVALID_PROTEIN_TYPE`
- `422 SALAD_PROTEIN_NOT_PREMIUM`
- `422 INVALID_CARB_ID`
- `409 LOCKED`

#### Flutter behavior
- Use this if you want pre-save UX validation.
- The save endpoint still revalidates. Validate is optional but useful for UX.

---

### 8.7 Save planner selection

- **Method:** `PUT`
- **Path:** `/api/subscriptions/:id/days/:date/selection`
- **Purpose:** save canonical planner day state
- **Status:** canonical
- **Request body:** required

#### Request Body Example

```json
{
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "premium_meal",
      "proteinId": "680f1a222222222222222222",
      "carbs": [
        { "carbId": "680f1a333333333333333333", "grams": 150 }
      ]
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "premium_large_salad",
      "salad": {
        "groups": {
          "protein": ["680f1a222222222222222222"],
          "sauce": ["680f1a555555555555555555"]
        }
      }
    }
  ]
}
```

Optional add-on integration in the same save:

```json
{
  "mealSlots": [...],
  "addonsOneTime": ["680f1a666666666666666666"]
}
```

#### Success response example

Returns the **full current state** of the day after applying the update. Flutter should replace its local day model with this `data` object.

```json
{
  "ok": true,
  "data": {
    "date": "2026-05-04",
    "status": "open",
    "plannerState": "draft",
    "plannerMeta": {
      "requiredSlotCount": 2,
      "completeSlotCount": 2,
      "premiumSlotCount": 2,
      "isConfirmable": true
    },
    "paymentRequirement": {
      "status": "satisfied",
      "requiresPayment": false
    },
    "commercialState": "ready_to_confirm",
    "mealSlots": [
      {
        "slotIndex": 1,
        "slotKey": "slot_1",
        "status": "complete",
        "selectionType": "premium_meal",
        "proteinId": "680f1a222222222222222222",
        "carbs": [{ "carbId": "680f1a333333333333333333", "grams": 150 }],
        "isPremium": true,
        "premiumKey": "shrimp",
        "premiumSource": "balance"
      },
      {
        "slotIndex": 2,
        "slotKey": "slot_2",
        "status": "complete",
        "selectionType": "premium_large_salad",
        "salad": {
          "groups": {
            "protein": ["680f1a222222222222222222"],
            "sauce": ["680f1a555555555555555555"]
          }
        },
        "isPremium": true,
        "premiumKey": "custom_premium_salad",
        "premiumSource": "balance"
      }
    ],
    "addonSelections": []
  }
}
```

#### Special success note
- Backend may include top-level `idempotent: true` if the exact same payload was already saved.

#### Important error cases
- `422 LEGACY_DAY_SELECTION_UNSUPPORTED`
- `422 INVALID_MEAL_PLAN`
- `422 LOCKED`
- `409 LOCKED`
- `403 FORBIDDEN`

#### Flutter behavior
- Save is the main planner write API.
- If save returns premium slots with `premiumSource: "pending_payment"`, show payment flow UI instead of enabling confirm.

---

### 8.8 Bulk save planner selection

- **Method:** `PUT`
- **Path:** `/api/subscriptions/:id/days/selections/bulk`
- **Purpose:** save canonical `mealSlots` across multiple dates
- **Status:** canonical
- **Request body:** required

#### Canonical request style 1

```json
{
  "dates": ["2026-05-14", "2026-05-16"],
  "mealSlots": [
    {
      "slotIndex": 1,
      "slotKey": "slot_1",
      "selectionType": "standard_meal",
      "proteinId": "680f1a111111111111111111",
      "carbs": [
        { "carbId": "680f1a333333333333333333", "grams": 150 }
      ]
    },
    {
      "slotIndex": 2,
      "slotKey": "slot_2",
      "selectionType": "standard_meal",
      "proteinId": "680f1a111111111111111111",
      "carbs": [
        { "carbId": "680f1a333333333333333333", "grams": 150 }
      ]
    }
  ]
}
```

#### Canonical request style 2

```json
{
  "days": [
    {
      "date": "2026-05-14",
      "mealSlots": [
        {
          "slotIndex": 1,
          "slotKey": "slot_1",
          "selectionType": "sandwich",
          "sandwichId": "680f1a444444444444444444"
        }
      ]
    },
    {
      "date": "2026-05-16",
      "mealSlots": [
        {
          "slotIndex": 1,
          "slotKey": "slot_1",
          "selectionType": "sandwich",
          "sandwichId": "680f1a444444444444444444"
        }
      ]
    }
  ]
}
```

#### Success response example

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalDates": 2,
      "updatedCount": 2,
      "idempotentCount": 0,
      "failedCount": 0
    },
    "results": [
      {
        "date": "2026-05-14",
        "ok": true,
        "idempotent": false,
        "data": {
          "date": "2026-05-14",
          "plannerState": "draft",
          "mealSlots": []
        }
      }
    ]
  }
}
```

#### Legacy bulk payload behavior

If Flutter sends old bulk payloads without `mealSlots`, backend does not silently translate them. The entry fails explicitly:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalDates": 1,
      "updatedCount": 0,
      "idempotentCount": 0,
      "failedCount": 1
    },
    "results": [
      {
        "date": "2026-05-14",
        "ok": false,
        "code": "LEGACY_DAY_SELECTION_UNSUPPORTED",
        "message": "Bulk day selection requires canonical mealSlots payload."
      }
    ]
  }
}
```

#### Flutter behavior
- Treat bulk results per date, not just top-level summary.
- Mixed success/failure is possible.

---

### 8.9 Confirm planner day

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/confirm`
- **Purpose:** confirm a fully valid and fully payable planner day
- **Status:** canonical
- **Request body:** none

#### Request Body Example

No request body.

#### Success response example

```json
{
  "ok": true,
  "success": true,
  "plannerState": "confirmed",
  "data": {
    "date": "2026-05-04",
    "plannerState": "confirmed",
    "plannerMeta": {
      "requiredSlotCount": 2,
      "completeSlotCount": 2,
      "isDraftValid": true,
      "isConfirmable": true,
      "confirmedAt": "2026-04-28T10:00:00.000Z",
      "confirmedByRole": "client"
    },
    "commercialState": "confirmed",
    "isFulfillable": true,
    "canBePrepared": true
  }
}
```

#### Important error cases
- `422 PLANNING_INCOMPLETE`
- `422 PREMIUM_PAYMENT_REQUIRED`
- `422 LOCKED`
- `409 DAY_ALREADY_CONFIRMED`
- `404 NOT_FOUND`

#### Flutter behavior
- Never enable confirm from local assumptions only.
- Enable confirm only when backend day state indicates:
  - `plannerMeta.isConfirmable === true`
  - `paymentRequirement.requiresPayment === false`
  - `commercialState === "ready_to_confirm"`
- On confirm success, replace full day state with response `data`.

---

### 8.10 Create premium extra payment

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/premium-extra/payments`
- **Purpose:** create or reuse a payment for unpaid premium slots on the day
- **Status:** canonical
- **Request body:** optional

Optional body fields:
- `successUrl`
- `backUrl`

#### Request Body Example

```json
{
  "successUrl": "myapp://payments/premium-extra/success",
  "backUrl": "myapp://meal-planner/day"
}
```

#### Success response example

```json
{
  "ok": true,
  "data": {
    "paymentId": "680f1c111111111111111111",
    "payment_id": "680f1c111111111111111111",
    "payment_url": "https://invoice.moyasar.com/...",
    "providerInvoiceId": "inv_123",
    "invoice_id": "inv_123",
    "amountHalala": 3000,
    "totalHalala": 3000,
    "currency": "SAR",
    "reused": false,
    "plannerRevisionHash": "sha256hash",
    "premiumExtraPayment": {
      "status": "pending",
      "paymentId": "680f1c111111111111111111",
      "providerInvoiceId": "inv_123",
      "amountHalala": 3000,
      "currency": "SAR",
      "revisionHash": "sha256hash",
      "extraPremiumCount": 1
    },
    "premiumSummary": {
      "selectedCount": 1,
      "coveredByBalanceCount": 0,
      "pendingPaymentCount": 1,
      "paidExtraCount": 0,
      "totalExtraHalala": 3000,
      "currency": "SAR"
    },
    "paymentRequirement": {
      "status": "priced",
      "requiresPayment": true,
      "pricingStatus": "priced",
      "blockingReason": "premium_pending_payment",
      "canCreatePayment": true,
      "premiumSelectedCount": 1,
      "premiumPendingPaymentCount": 1,
      "addonSelectedCount": 0,
      "addonPendingPaymentCount": 0,
      "pendingAmountHalala": 3000,
      "amountHalala": 3000,
      "currency": "SAR"
    },
    "commercialState": "payment_required"
  }
}
```

#### Important error cases
- `409 PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED`
- `409 PREMIUM_EXTRA_ALREADY_PAID`
- `409 PREMIUM_EXTRA_PAYMENT_REUSE_INVALID`
- `409 LOCKED`
- `404 NOT_FOUND`

#### Flutter behavior
- If success returns `reused: true`, still use the returned `payment_url`.
- Open `payment_url` in browser/webview as required by your flow.
- After returning from payment, call verify endpoint.

---

### 8.11 Verify premium extra payment

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/premium-extra/payments/:paymentId/verify`
- **Purpose:** verify provider payment status and synchronize planner state
- **Status:** canonical
- **Request body:** none

#### Request Body Example

No request body.

#### Success response example

```json
{
  "ok": true,
  "data": {
    "subscriptionId": "680f1b111111111111111111",
    "dayId": "680f1d111111111111111111",
    "date": "2026-05-04",
    "plannerState": "draft",
    "plannerRevisionHash": "sha256hash",
    "premiumPendingPaymentCount": 0,
    "premiumSummary": {
      "selectedCount": 1,
      "coveredByBalanceCount": 0,
      "pendingPaymentCount": 0,
      "paidExtraCount": 1,
      "totalExtraHalala": 0,
      "currency": "SAR"
    },
    "premiumExtraPayment": {
      "status": "paid",
      "paymentId": "680f1c111111111111111111",
      "providerInvoiceId": "inv_123",
      "amountHalala": 3000,
      "currency": "SAR",
      "paidAt": "2026-04-28T10:05:00.000Z",
      "revisionHash": "sha256hash",
      "extraPremiumCount": 1
    },
    "paymentRequirement": {
      "status": "satisfied",
      "requiresPayment": false,
      "pricingStatus": "not_required",
      "blockingReason": "planner_unconfirmed",
      "canCreatePayment": false,
      "premiumSelectedCount": 1,
      "premiumPendingPaymentCount": 0,
      "addonSelectedCount": 0,
      "addonPendingPaymentCount": 0,
      "pendingAmountHalala": 0,
      "amountHalala": 0,
      "currency": "SAR"
    },
    "commercialState": "ready_to_confirm",
    "isFulfillable": false,
    "canBePrepared": false,
    "paymentId": "680f1c111111111111111111",
    "paymentStatus": "paid",
    "isFinal": true,
    "amount": 3000,
    "currency": "SAR",
    "applied": true,
    "providerInvoiceId": "inv_123",
    "providerPaymentId": "pay_123",
    "payment": {
      "id": "680f1c111111111111111111",
      "provider": "moyasar",
      "type": "premium_extra_day",
      "status": "paid",
      "amount": 3000,
      "currency": "SAR",
      "providerInvoiceId": "inv_123",
      "providerPaymentId": "pay_123",
      "applied": true
    },
    "providerInvoice": {
      "id": "inv_123",
      "status": "paid",
      "amount": 3000,
      "currency": "SAR",
      "url": "https://invoice.moyasar.com/...",
      "attemptsCount": 1
    },
    "checkedProvider": true,
    "synchronized": true
  }
}
```

#### Important error cases
- `404 NOT_FOUND`
- `409 MISMATCH`
- `409 CHECKOUT_IN_PROGRESS`
- `409 PREMIUM_EXTRA_REVISION_MISMATCH`
- `502 PAYMENT_PROVIDER_ERROR`

#### Flutter behavior
- If `paymentStatus === "paid"` and `synchronized === true`, immediately refresh/replace day state from this response.
- If backend returns `PREMIUM_EXTRA_REVISION_MISMATCH`, user must reload the day, review the changed planner, and create a new payment if needed.

---

### 8.12 Create one-time add-on payment

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/one-time-addons/payments`
- **Purpose:** create payment for day add-ons already marked `pending_payment`
- **Status:** canonical
- **Request body:** optional

#### Request Body Example

```json
{
  "successUrl": "myapp://payments/addons/success",
  "backUrl": "myapp://meal-planner/day"
}
```

#### Success response example

```json
{
  "ok": true,
  "data": {
    "payment_url": "https://invoice.moyasar.com/...",
    "invoice_id": "inv_456",
    "payment_id": "680f1e111111111111111111",
    "totalHalala": 1000
  }
}
```

#### Important error cases
- `409 ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED`
- `409 NO_PENDING_ONE_TIME_ADDONS`
- `404 NOT_FOUND`

#### Flutter behavior
- This endpoint only works after the day already contains `addonSelections` with `source: "pending_payment"`.
- After payment UI flow completes, call verify endpoint.

---

### 8.13 Verify one-time add-on payment

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/one-time-addons/payments/:paymentId/verify`
- **Purpose:** verify and apply one-time add-on payment
- **Status:** canonical
- **Request body:** none

#### Backward-compatible Flutter alias

- **Method:** `POST`
- **Path:** `/api/subscriptions/:id/days/:date/one-time-addons/payments/verify`
- **Purpose:** verify and apply the latest matching day payment when `paymentId` is not available
- **Status:** supported compatibility alias

#### Request Body Example

No request body.

#### Success response example

```json
{
  "ok": true,
  "data": {
    "subscriptionId": "680f1b111111111111111111",
    "dayId": "680f1d111111111111111111",
    "date": "2026-05-04",
    "addonSelections": [
      {
        "addonId": "680f1a666666666666666666",
        "name": "Juice",
        "category": "juice",
        "source": "paid",
        "priceHalala": 1000,
        "currency": "SAR"
      }
    ],
    "pendingCount": 0,
    "paymentId": "680f1e111111111111111111",
    "paymentStatus": "paid",
    "isFinal": true,
    "amount": 1000,
    "currency": "SAR",
    "applied": true,
    "providerInvoiceId": "inv_456",
    "payment": {
      "id": "680f1e111111111111111111",
      "provider": "moyasar",
      "type": "one_time_addon_day_planning",
      "status": "paid",
      "amount": 1000,
      "currency": "SAR",
      "applied": true
    },
    "providerInvoice": {
      "id": "inv_456",
      "status": "paid",
      "amount": 1000,
      "currency": "SAR",
      "url": "https://invoice.moyasar.com/...",
      "attemptsCount": 1
    },
    "checkedProvider": true,
    "synchronized": true
  }
}
```

#### Flutter behavior
- If verify returns paid and synchronized, reload or replace the day state before enabling confirm.
- One-time add-on payment affects `paymentRequirement`.

---

### 8.14 Unsupported helper endpoint: add/remove add-on selection

- **Methods:** `POST`, `DELETE`
- **Path:** `/api/subscriptions/:id/addon-selections`
- **Purpose:** none for Flutter
- **Status:** deprecated and unsupported

#### Request Body Example

```json
{
  "date": "2026-05-04",
  "addonId": "680f1a666666666666666666",
  "qty": 1
}
```

#### Actual response

```json
{
  "ok": false,
  "error": {
    "code": "LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED",
    "message": "Addon helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  }
}
```

#### Flutter behavior
- Do not call this endpoint.
- Use canonical `PUT /days/:date/selection` with the final full planner payload.

---

### 8.15 Unsupported helper endpoint: add/remove premium selection

- **Methods:** `POST`, `DELETE`
- **Path:** `/api/subscriptions/:id/premium-selections`
- **Purpose:** none for Flutter
- **Status:** deprecated and unsupported

#### Request Body Example

```json
{
  "date": "2026-05-04",
  "baseSlotKey": "slot_1",
  "proteinId": "680f1a222222222222222222"
}
```

#### Actual response

```json
{
  "ok": false,
  "error": {
    "code": "LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED",
    "message": "Premium helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  }
}
```

#### Flutter behavior
- Do not call this endpoint.
- Use canonical `PUT /days/:date/selection`.

---

## 9. Canonical Request Shapes

### 9.1 `standard_meal`

```json
{
  "slotIndex": 1,
  "slotKey": "slot_1",
  "selectionType": "standard_meal",
  "proteinId": "680f1a111111111111111111",
  "carbs": [
    { "carbId": "680f1a333333333333333333", "grams": 150 }
  ]
}
```

### 9.2 `premium_meal`

```json
{
  "slotIndex": 1,
  "slotKey": "slot_1",
  "selectionType": "premium_meal",
  "proteinId": "680f1a222222222222222222",
  "carbs": [
    { "carbId": "680f1a333333333333333333", "grams": 150 }
  ]
}
```

### 9.3 `premium_large_salad`

```json
{
  "slotIndex": 2,
  "slotKey": "slot_2",
  "selectionType": "premium_large_salad",
  "salad": {
    "groups": {
      "protein": ["680f1a222222222222222222"],
      "sauce": ["680f1a555555555555555555"],
      "vegetables": ["680f1a777777777777777777"],
      "cheese_nuts": ["680f1a888888888888888888"]
    }
  }
}
```

### 9.4 `sandwich`

```json
{
  "slotIndex": 1,
  "slotKey": "slot_1",
  "selectionType": "sandwich",
  "sandwichId": "680f1a444444444444444444"
}
```

### 9.5 What Flutter must not send anymore

- `selectionType: "standard_combo"`
- `selectionType: "custom_premium_salad"`
- top-level `carbId`
- top-level `carbSelections`
- `customSalad` as the canonical planner shape
- helper mutation payloads for `/addon-selections` or `/premium-selections`

### 9.6 How legacy payloads are rejected

- Single-day save without canonical `mealSlots`:
  - `422 LEGACY_DAY_SELECTION_UNSUPPORTED`
- Bulk save without canonical `mealSlots`:
  - per-date failure with `LEGACY_DAY_SELECTION_UNSUPPORTED`
- Premium helper endpoints:
  - `422 LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED`
- Add-on helper endpoints:
  - `422 LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED`

---

## 10. Read Models For Flutter

### 10.1 Use these fields to build UI

- Slot cards:
  - `mealSlots`
  - `builderCatalog`
- Confirm CTA:
  - `plannerMeta.isConfirmable`
  - `commercialState`
  - `paymentRequirement.requiresPayment`
- Payment CTA:
  - `paymentRequirement.requiresPayment`
  - `paymentRequirement.canCreatePayment`
  - `paymentRequirement.pendingAmountHalala`
  - `paymentRequirement.blockingReason`
- Editability:
  - `status`
  - `plannerState`
  - `commercialState`
- Timeline indicators:
  - `status`
  - `commercialState`
  - `isFulfillable`
  - `canBePrepared`
- Entitlement summary:
  - `premiumSummary`

### 10.2 Do not build business rules from these alone

- `status`
- `premiumSource`
- `completeSlotCount`

They are useful for display, but payment/confirmation flow must still rely on `paymentRequirement` and `commercialState`.

---

## 11. Payment Flow

### 11.1 Premium extra payment flow

1. User saves day with premium slots.
2. Backend may return premium slots with `premiumSource: "pending_payment"`.
3. Flutter reads:
   - `paymentRequirement.requiresPayment`
   - `paymentRequirement.canCreatePayment`
   - `paymentRequirement.pendingAmountHalala`
4. If `requiresPayment === true` and `canCreatePayment === true`, call:
   - `POST /premium-extra/payments`
5. Open returned `payment_url`.
6. After payment UI returns, call:
   - `POST /premium-extra/payments/:paymentId/verify`
7. Replace local day/payment state from verify response.
8. If verify resolves payment and day becomes `ready_to_confirm`, enable confirm.

### 11.2 One-time add-on payment flow

1. Day already contains `addonSelections` with `source: "pending_payment"`.
2. Flutter reads `paymentRequirement`.
3. If unpaid add-ons exist and backend allows creation, call:
   - `POST /one-time-addons/payments`
4. Open returned `payment_url`.
5. After payment UI returns, call:
   - `POST /one-time-addons/payments/:paymentId/verify`
   - or compatibility alias `POST /one-time-addons/payments/verify`
6. Replace local day state after success.

### 11.3 Meaning of `revision_mismatch`

`premiumExtraPayment.status === "revision_mismatch"` means the planner changed after payment creation. The old invoice is no longer safe to apply.

Flutter action:
- reload day
- show user that planner changed
- let user save current selections again if needed
- create a new premium payment only after reloading the latest state

### 11.4 Meaning of payment-related states

- `pricing_pending`
  - payment exists or provider status is still pending
  - Flutter should keep polling/verify flow, not create another payment unless backend returns reusable initiation
- `pricing_failed`
  - payment attempt failed
  - Flutter should let user retry payment creation if backend allows it
- `premium_pending_payment`
  - unpaid premium slots exist
  - Flutter should show premium payment CTA
- `addons_pending_payment`
  - unpaid add-ons exist
  - Flutter should show add-on payment CTA

---

## 12. Timeline Interpretation

### 12.1 `status`

Timeline `status` is a normalized operational day status, not a planner status.

Examples:
- `open`
- `locked`
- `delivered`
- `frozen`
- `skipped`
- `delivery_canceled`
- `canceled_at_branch`
- `no_show`

### 12.2 `commercialState`

This is the planner workflow state:
- `draft`
- `payment_required`
- `ready_to_confirm`
- `confirmed`

### 12.3 `isFulfillable`

True only when the backend considers the day operationally fulfillable now. Flutter should use this as a stronger signal than planner completion.

### 12.4 `canBePrepared`

Current backend operational gate for preparation. If false, Flutter should not show operational readiness as complete.

### 12.5 `paymentRequirement`

This is the source of truth for payment gating inside timeline too.

### 12.6 Important rule

`status` is not enough.

Even if a day looks selectable or visually complete:
- If `paymentRequirement.requiresPayment === true`, it is not confirm-ready.
- If `commercialState !== "ready_to_confirm"` and `plannerState !== "confirmed"`, do not treat it as finalized.

---

## 13. Do Not Use From Flutter

### 13.1 Deprecated / unsupported endpoints

- `/api/subscriptions/:id/addon-selections`
  - Why not: partial legacy mutation route
  - Correct alternative: `PUT /api/subscriptions/:id/days/:date/selection`

- `/api/subscriptions/:id/premium-selections`
  - Why not: partial legacy mutation route
  - Correct alternative: `PUT /api/subscriptions/:id/days/:date/selection`

### 13.2 Deprecated / unsupported payload shapes

- `selectionType: "standard_combo"`
- `selectionType: "custom_premium_salad"`
- top-level `carbId`
- top-level `carbSelections`
- `customSalad` as canonical planner output assumption
- bulk request payloads using `selections` / `premiumSelections`

### 13.3 Endpoint not intended as planner source

- `/api/builder/premium-meals`
  - Why not: intentional legacy compatibility endpoint
  - Correct alternative for planner UI: `GET /api/subscriptions/meal-planner-menu`

---

## 14. Kitchen / Operational Notes

- Planner canonical state retains the full carb split in `mealSlots[].carbs`.
- Operational materialization still simplifies a split-carb meal to one primary carb for downstream kitchen compatibility.
- This simplification affects `materializedMeals` and kitchen-facing derived naming.
- Flutter planner UI must always render from canonical `mealSlots`, not from kitchen operational representations.
- Kitchen operations now identify materialized items primarily by `operationalSku`:
  - standard/premium combo example: `proteinId:carbId`
  - sandwich example: `sandwich:<mealId>`
  - premium large salad example: `salad:custom_premium_salad`

---

## 15. Error Handling Matrix

| Code | Meaning | What Flutter should do |
|---|---|---|
| `LOCKED` | day is no longer editable/confirmable | disable editing and refresh UI |
| `PLANNING_INCOMPLETE` | planner is not fully complete or not ready to confirm | keep user in edit state |
| `INVALID_MEAL_PLAN` | planner validation failed | inspect `error.details.slotErrors` and show field-level errors |
| `BEEF_LIMIT_EXCEEDED` | more than one beef slot selected | show business-rule validation error |
| `INVALID_PROTEIN_TYPE` | selected protein does not match slot type | show slot error |
| `SALAD_PROTEIN_NOT_PREMIUM` | salad protein must be premium | show slot error |
| `INVALID_CARB_ID` | carb id is invalid/inactive/unavailable | show slot error |
| `PREMIUM_PAYMENT_REQUIRED` | confirm blocked until premium payment is cleared | start premium payment flow |
| `PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED` | payment creation attempted when no payment is needed | reload day and hide payment CTA |
| `PREMIUM_EXTRA_ALREADY_PAID` | payment already settled | reload day and continue flow |
| `PREMIUM_EXTRA_REVISION_MISMATCH` | planner changed since payment creation | reload day and require new payment if still needed |
| `NO_PENDING_ONE_TIME_ADDONS` | addon payment requested when no unpaid add-ons exist | reload day and hide add-on payment CTA |
| `ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED` | backend does not allow one-time add-on payment for this day | hide add-on payment CTA |
| `LEGACY_DAY_SELECTION_UNSUPPORTED` | old planner payload was sent | fix client payload to canonical `mealSlots` |
| `LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED` | deprecated premium helper endpoint called | stop using endpoint; use day selection save |
| `LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED` | deprecated addon helper endpoint called | stop using endpoint; use day selection save |
| `NOT_FOUND` | subscription/day/payment not found | show empty/error state and allow retry or exit |
| `FORBIDDEN` | wrong user owns resource | force auth/session recovery |
| `MISMATCH` | payment/day or invoice id mismatch | reload day and payment state; do not continue blindly |
| `CHECKOUT_IN_PROGRESS` | provider invoice/payment not fully ready | retry verify after short delay |
| `PAYMENT_PROVIDER_ERROR` | provider verification failed | allow retry verify and show temporary payment error |

---

## 16. Flutter Action Checklist

### 16.1 On planner screen open

1. Call `GET /api/subscriptions/meal-planner-menu` if not cached.
2. Call `GET /api/subscriptions/:id/days/:date`.
3. Build UI from:
   - `mealSlots`
   - `builderCatalog`
   - `plannerMeta`
   - `paymentRequirement`
   - `commercialState`

### 16.2 On every edit

1. Update local draft state.
2. Optionally call validate endpoint for pre-save validation.
3. Do not finalize business rules locally.

### 16.3 On save

1. Call `PUT /api/subscriptions/:id/days/:date/selection`.
2. Replace local day state from backend response.
3. If response has `idempotent: true`, still trust returned data.

### 16.4 On payment decision

1. Read `paymentRequirement`.
2. If `requiresPayment === false`, do not show payment CTA.
3. If `requiresPayment === true` and `canCreatePayment === true`, create payment.

### 16.5 On premium payment

1. Call create premium extra payment endpoint.
2. Open `payment_url`.
3. On app return, call verify premium extra payment endpoint.
4. Replace local day state from verify response.

### 16.6 On one-time add-on payment

1. Only if backend day already has unpaid add-ons.
2. Call create one-time add-on payment endpoint.
3. Open `payment_url`.
4. Verify payment.
5. Replace local day state.

### 16.7 On confirm

1. Only when backend state indicates:
   - `plannerMeta.isConfirmable === true`
   - `paymentRequirement.requiresPayment === false`
   - `commercialState === "ready_to_confirm"`
2. Call confirm endpoint.
3. Replace day state from response.

### 16.8 On timeline refresh

1. Call `GET /api/subscriptions/:id/timeline`.
2. Render status from:
   - `status`
   - `commercialState`
   - `paymentRequirement`
   - `isFulfillable`
   - `canBePrepared`

---

## 18. Quick Validation Checklist For Developers

Before finishing your integration, ensure you can answer "Yes" to all these:

- [ ] **What do I send?** Only canonical fields (`slotIndex`, `selectionType`, `proteinId`, `carbs[]`, `sandwichId`, `salad.groups`, `addonsOneTime[]`).
- [ ] **What do I NOT send?** Computed fields (`status`, `isPremium`, etc.) and legacy keys (`standard_combo`).
- [ ] **What do I read?** The full `data` object returned by the server (Models in Section 4).
- [ ] **Which endpoint do I use?** Follow the Guide in Section 6.
- [ ] **How to handle payment?** Use `requiresPayment` and `canCreatePayment` before calling payment APIs.
- [ ] **When to enable Confirm?** Only when `plannerMeta.isConfirmable` is `true`.
- [ ] **What shape is the error?** Generic envelope: `{ ok: false, error: { code, message, details } }`.
- [ ] **Are my `carbs` canonical?** Always a list `[{ carbId, grams }]`.
- [ ] **Am I calling legacy helpers?** Check that you are NOT calling `/addon-selections` or `/premium-selections`.

---

## 19. Final Notes

- This file is the final Flutter integration manual for the current backend on `main`.
- Flutter should not need to read backend source code if this document is followed.
- If a future backend change intentionally alters any request/response contract documented here, this file must be updated in the same branch before Flutter work continues.
