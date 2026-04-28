# Complete Backend Flow Integration Contract (Production Grade)

This document provides a 100% accurate, deep-dive integration contract for the backend Node.js system, completely stripping legacy assumptions. It captures exactly how the backend behaves in production.

---

## 1. Subscription Lifecycle

### Schematic Flow
`Draft/Quoted` ➔ `Checkout Draft` ➔ `Payment Pending` ➔ `Active` ➔ `Completed/Expired`

### Schema Details
The `Subscription` root model manages the macro boundary of the user's purchased plan.
- **Statuses**:
  - `active`: Fully paid and currently running.
  - `frozen`: Paused temporarily via user/admin action.
  - `expired`: All days passed or depleted.
- **`premiumBalance` Array**:
  Tracks all purchased premium entries.
  - Structure: `{ premiumKey, purchasedQty, remainingQty, proteinId (legacy sync) }`.
  - When you purchase 10 Salmon slots, `{ premiumKey: "salmon", purchasedQty: 10, remainingQty: 10 }` is created.
  - **Behavior**: It is purely a ledger. Selecting a meal deducts the balance. Swapping it back out refunds it automatically.
- **`addonSelections` Array**: Tracks global/subscription-level addons bought during checkout.

### State Transitions
- **Checkout** creates a `CheckoutDraft`.
- **Payment Verification** activates the draft, migrating fields into the live `Subscription`, injecting empty `SubscriptionDay`s into the system, and seeding initial ledger balances.

---

## 2. SubscriptionDay Lifecycle

`SubscriptionDay` operates as an independent daily state machine.

### Exact Status Meanings & Triggers
- `open`: Default starting state. Day is fully modifiable by the client.
- `frozen`: Controlled via `subscriptionFreezeClientService`, blocks operations and pushes fulfillment out.
- `locked`: The cutoff time has passed. Modifying the planner is strictly disabled natively (admin bypass exists).
- `in_preparation`: Branch pickup requested or kitchen has begun processing.
- `ready_for_pickup`: Branch scanned the label, ready for client.
- `out_for_delivery`: Driver has the bag.
- `fulfilled`: Customer received it (completed terminal state).
- `delivery_canceled`, `canceled_at_branch`, `no_show`: Terminal failure states.
- `skipped`: Client elected to skip the day entirely.

### Transitions
- Client saves/confirms meals ➔ Remains `open`.
- Client hits cutoff limit ➔ System Cron transitions `open` to `locked`.
- Client fires `POST /pickup/prepare` ➔ Pushes to `in_preparation`.

---

## 3. Internal Service Responsibilities

Backend logic is cleanly segmented. Knowing these services accelerates debugging:

- **`subscriptionCheckoutService`**: Responsible strictly for receiving checkout parameters, generating the Quote, ensuring robust `vatHalala` calculations, mapping `premiumKey`s, and building the `CheckoutDraft` along with the Moyasar/payment context.
- **`subscriptionActivationService`**: Invoked *after* payment succeeds. It translates `CheckoutDraft` into the canonical `Subscription`, creates identical `SubscriptionDay` rows, and populates `premiumBalance`.
- **`subscriptionSelectionService`**: The CRUD pipeline for saving/modifying meal choices on a specific day. Handles updating `SubscriptionDay.mealSlots`. Checks idempotency.
- **`mealSlotPlannerService`**: The core rules engine. Validates if slots are legal (e.g., checking standard carbs limits <= 300g, 2 types max, max 1 beef family, custom_premium_salad logic). Computes `plannerMeta` dynamically for every save.
- **`subscriptionClientOverviewService`**: Provides data aggregation. Computes `premiumSummary` securely by comparing `purchasedQtyTotal` vs `remainingQtyTotal`.

---

## 4. Pricing & Money Flow

- **Checkout Quote**: `canonicalSubtotal = basePlan + addos + premiumFee + deliveryFee + vat`. The `vatHalala` is explicitly back-computed from the canonical subtotal directly inside the system to guarantee invoice alignment.
- **Premium Extra Fees**: Computed per day globally. E.g., `custom_premium_salad` flat fee is `3000 halala` (30 SAR). 
- **`premiumTotalHalala`**: Aggregates all upcharges during checkout accurately.
- **Charge Timing**: 
  - Checkout charges immediately via the generated invoice URL.
  - "Overage" upgrades during meal planning do NOT charge upon clicking selection. They accumulate natively in `premiumPendingPaymentCount` returning a `422` if you attempt to confirm without fetching and clearing a payment link via `/premium-extra/payments`.

---

## 5. Confirm Behavior (`POST .../confirm`)

- **What Happens**: Promotes `plannerState` to `confirmed`. 
- **Does it Revalidate?**: YES. It ensures `plannerMeta.isConfirmable` is valid and the cutoff isn't exceeded.
- **Does it Consume premiumBalance?**: Premium balances are conceptually consumed *inside* the array ledger when you *save* the draft. The confirmation merely freezes the draft so it cannot be easily changed without explicitly breaking the confirmation.
- **Does it Lock Permanently?**: NO. You can technically modify a confirmed day *if* the `locked` macro-status cutoff hasn't passed, though clients should treat confirmed as final unless a deliberate edit action is fired. Once the global day cutoff runs, the status updates to `locked`, shutting out edits completely.

---

## 6. Error Codes Directory

| HTTP Status | Error Code | Trigger & Meaning |
|---|---|---|
| `422` | `INVALID_PREMIUM_ITEM` | You submitted `custom_premium_salad` to the checkout API. |
| `422` | `BEEF_LIMIT_EXCEEDED` | Selected > 1 beef protein on a single day. |
| `422` | `INVALID_CARB` | Carb structures exceed 2 types, 300g total weight, or contain 0g fields. |
| `422` | `PLANNING_INCOMPLETE` | Attempted `/confirm` but `completeSlotCount` < `requiredSlotCount`. |
| `422` | `PREMIUM_PAYMENT_REQUIRED` | Cannot confirm day: Premium overages exist and must be paid off. |
| `422` | `LOCKED` | Day has passed cutoff, modifications/confirms rejected. |
| `400` | `RESTAURANT_CLOSED` | Attempted `pickup/prepare` outside operating business hours. |
| `409` | `DAY_SKIPPED` / `DAY_FROZEN` | Action rejected due to conflicting day states. |

---

## 7. Delivery & Pickup Deep Logic

### Updates 
- **System Jobs**: A cutoff cron sweeps days automatically moving `open` to `locked`.
- **System Webhooks**: Courier software tracking pings advance status to `out_for_delivery` and `fulfilled`.
- **Admin**: Admins can force states to terminal failure e.g., `delivery_canceled`.

### The Pickup Flow
1. **Prepare Trigger**: Frontend hits `POST .../pickup/prepare`. Day status becomes `in_preparation`.
2. **Polling Target**: Frontend hits `GET .../pickup/status`.
3. **Execution**: Kitchen node scans ticket, updates backend. Polling endpoint natively shifts `isReady` to true and exposes `pickupCode` in the JSON.
4. If outside business hours, `prepare` fails firmly with `400 RESTAURANT_CLOSED`.

---

## 8. Data Contracts (JSON)

### Subscription
```json
{
  "_id": "65...",
  "status": "active",
  "deliveryMode": "delivery",
  "premiumBalance": [
    {
      "premiumKey": "salmon",
      "purchasedQty": 10,
      "remainingQty": 5
    }
  ],
  "startDate": "2026-04-10T00:00:00Z"
}
```

### SubscriptionDay (Meal Planner State)
```json
{
  "date": "2026-04-20",
  "status": "open",
  "plannerState": "draft",
  "plannerMeta": {
    "requiredSlotCount": 3,
    "completeSlotCount": 2,
    "beefSlotCount": 1,
    "premiumPendingPaymentCount": 0,
    "isConfirmable": false,
    "isDraftValid": true
  },
  "mealSlots": [
    {
      "slotIndex": 1,
      "selectionType": "standard_combo",
      "status": "complete",
      "proteinId": "651a...",
      "carbSelections": [
        { "carbId": "651b...", "grams": 150 },
        { "carbId": "651c...", "grams": 150 }
      ]
    },
    {
      "slotIndex": 2,
      "selectionType": "custom_premium_salad",
      "proteinId": null,
      "isPremium": false,
      "premiumExtraFeeHalala": 3000
    }
  ]
}
```

---

## 9. Current Overview Contract

The `GET /api/subscriptions/current/overview` natively computes ledger truths.

- **`premiumSummary`**:
```json
"premiumSummary": [
  {
    "premiumKey": "salmon",
    "displayName": "Salmon",
    "purchasedQtyTotal": 5,
    "remainingQtyTotal": 2,
    "consumedQtyTotal": 3
  },
  {
    "premiumKey": "custom_premium_salad",
    "displayName": "Custom Premium Salad",
    "purchasedQtyTotal": 0,
    "remainingQtyTotal": 0,
    "consumedQtyTotal": 1
  }
]
```
- **Calculations**:
  - `purchasedQtyTotal` directly aggregates `Subscription.premiumBalance.purchasedQty`.
  - `remainingQtyTotal` aggregates `Subscription.premiumBalance.remainingQty`.
  - `consumedQtyTotal` = `purchasedQtyTotal - remainingQtyTotal`. Exception globally applied for extra one-offs that aren't natively stored natively on balance (e.g., `custom_premium_salad` natively reflects `0` purchase but tracks `consumed`).
- **`custom_premium_salad`**: It isn't a true DB protein layout natively. Thus it populates purely based on consumed array lookbacks. 

---

## 10. Edge Case Behavior

1. **Repeated Save (Idempotency)**
   - Backend gracefully accepts repeated identical payloads to `PUT .../selection`. Emits HTTP `200` with `idempotent: true`. Safely updates the array structure natively.
   
2. **Switching Premium Items / Standard Items**
   - Seamless. If a slot held `beef_steak` (premium balance deduction) and the frontend swaps to `chicken` natively, the backend automatically refunds `1` to `beef_steak`'s remaining quantity upon payload save.
   
3. **Removing Premium Items**
   - Passing an empty slot cleanly voids any tracked payments/balances attached to the earlier slot index format natively.

4. **Invalid carbSelections**
   - If payload lacks required fields, frontend drops a flat `422 INVALID_CARB`. 
   - Weight verification forces max 300g natively. `0g` entries are immediately rejected.
   
5. **Unpaid Premium Extras**
   - If a custom salad remains un-paid, `plannerMeta.premiumPendingPaymentCount` > 0.
   - Pushing `POST .../confirm` crashes directly into `422 PREMIUM_PAYMENT_REQUIRED` natively.

6. **Confirm Failure Cases**
   - Fails solidly if day is `locked` (`422 LOCKED`).
   - Fails if `completeSlotCount` does not equal `requiredSlotCount` (`422 PLANNING_INCOMPLETE`).
   
## 11. Addon Selections (Unified Flow)

Addons (Juices, Snacks, Small Salads) are now managed declaratively within the `SubscriptionDay` to prevent data drift between balances and selections.

### Addon Sources
- `subscription`: Covered by fixed daily entitlements (e.g., 1 Juice/day plan). `priceHalala` is 0.
- `wallet`: Covered by a prepaid balance (purchased as a pack). `priceHalala` is 0.
- `pending_payment`: A one-time addition that will require payment before the day is out for delivery. `priceHalala` > 0.
- `paid`: Already paid one-time addition.

### Addon Endpoints
- **Bulk Update**: `PUT /api/subscriptions/:id/days/:date/selections` with `requestedOneTimeAddonIds`. This is the primary atomic path.
- **Standalone Add**: `POST /api/subscriptions/:id/addon-selections`. merged into the day as a single-item update.
- **Standalone Remove**: `DELETE /api/subscriptions/:id/addon-selections`. 

---

## 12. Robustness Features

### 1. Repeated Save (Idempotency)
The backend implements a sophisticated `plannerRevisionHash` that captures the complete state of a day (slots + addons).
- If the incoming payload results in a hash identical to the existing `plannerRevisionHash`, the backend performs **Short-circuit Idempotency**.
- It returns HTTP `200` with `idempotent: true`, bypassing all database writes and transaction overhead. This is critical for high-load stability and handling client retries.

### 2. Auto-Refund Logic
Whenever a day selection is updated, the backend automatically reconciles both `premiumBalance` and `addonBalance`. 
- If a premium meal is removed, the credit is returned to the wallet atomically.
- If an addon is removed, the wallet credit is returned atomically.

## Concluding Integration Rule
Clients **must never** attempt to calculate `premiumPendingPaymentCount`, valid states, or invoice math manually. All validation math strictly relies on fetching backend representations generated dynamically at runtime and mapping local models securely to backend validation responses explicitly via `plannerMeta.isConfirmable`.