# Meal Planner Integration Guide (Slot-Based API)

This document is the **authoritative execution-level guide** for Flutter developers integrating the new slot-based meal planner. Use this to implement the UI flow, state management, and business logic without ambiguity.

---

## 1. Overview
The system has migrated from a simple "list of meal IDs" to a **Slot-Based Meal Builder**. 
- **The Core Idea**: A "Meal" is no longer a single ID. It is a **combination** of a **Protein** and a **Carb** placed in a specific **Slot**.
- **The Source of Truth**: The `mealSlots[]` array in the backend response. **Ignore** `selections[]` and `premiumSelections[]` fields; they exist only for backward compatibility with legacy operations.

---

## 2. Core Concepts

| Concept | Description |
| :--- | :--- |
| **Meal Slot** | A container for one meal. If a subscription allows 3 meals/day, there will be 3 slots. |
| **Protein** | The main component of a slot. Determines if the slot is **Premium**. |
| **Carb** | The side component of a slot. |
| **Planner Meta** | A summary object (`plannerMeta`) that tells the UI if the current plan is valid or confirmable. |
| **Materialized Meal** | The final "produced" meal object generated after a slot is confirmed. |

---

## 3. State Machine (Lifecycle)

### Slot State
Each slot in `mealSlots[]` has a `status` field:
- **`empty`**: Neither protein nor carb is selected.
- **`partial`**: Only one of them (usually protein) is selected.
- **`complete`**: Both protein and carb are selected.

### Premium State (`premiumSource`)
Determines how a premium meal is "paid" for in a slot:
- **`none`**: Slot is a regular meal (no extra cost).
- **`balance`**: Slot is premium and covered by the user's existing premium credit balance.
- **`pending_payment`**: Slot is premium, user has 0 balance, and **must pay** to finalize.
- **`paid_extra`**: Slot was previously `pending_payment` but is now settled.

### Day Lifecycle
1.  **DRAFT**: Default state. User is editing. `plannerState = "draft"`.
2.  **VALIDATED**: UI calls `/validate`. Backend returns `valid: true` or `slotErrors[]`.
3.  **PAYMENT_PENDING**: User saved a selection that requires extra payment. `paymentRequirement.requiresPayment = true`.
4.  **CONFIRMED**: User clicked "Confirm". Day is locked. `plannerState = "confirmed"`.

---

## 4. Full User Flow (Execution Steps)
ّ
### Step 1: Load Planner & Catalog
- **UI Action**: User navigates to a specific date in the calendar.
- **API Call 1**: `GET /subscriptions/:id/days/:date` (Get the day's current plan).
- **API Call 2**: `GET /subscriptions/meal-planner-menu` (Get all proteins/carbs/categories).
- **Frontend Logic**: 
  - Match `mealSlots` IDs with catalog items to show names/images.
  - Check `plannerMeta.isConfirmable` to set the initial state of the "Confirm" button.

### Step 2: User Selects Protein/Carb
- **UI Action**: User taps a Protein or Carb item.
- **API Call (Optional but Recommended)**: `POST /subscriptions/:id/days/:date/selection/validate`
  - **Goal**: Instant feedback without saving.
  - **Payload**: `{ "mealSlots": [...] }` (The full current map of slots).
- **Response**: Returns `valid`, `slotErrors[]`, `plannerMeta`, and `wallet`.
- **UI Next Step**: 
  - Highlight slots with errors (e.g., "Max 1 Beef" or "Missing Carb").
  - Update the "Premium Used" counter using the `wallet` object.

### Step 3: Save Selection (Persist Draft)
- **UI Action**: User clicks "Save" or navigates away.
- **API Call**: `PUT /subscriptions/:id/days/:date/selection`
- **Backend Behavior**: 
  - Validates selections.
  - Deducts balance from wallet.
  - If overage exists, creates a `premiumExtraPayment` object with `status: "pending"`.
- **Response**: The updated `day` object.
- **UI Next Step**: Check `paymentRequirement`. If payment is needed, the UI **must** show the payment prompt before allowing "Confirm".

### Step 4: Handle Premium Payment (If Required)
- **UI Action**: User clicks "Pay for Extra".
- **API Call**: `POST /subscriptions/:id/days/:date/premium-extra/payments`
- **Response**: Returns `payment_url` and `paymentId`.
- **UI Next Step**: 
  - Open WebView for payment.
  - On return to app, call **Verify** endpoint: `POST .../verify`.
  - **CRITICAL**: After successful verification, you **MUST** refetch the day (`GET /days/:date`) to refresh the `premiumSource` of the slots.

### Step 5: Final Confirmation
- **UI Action**: User clicks "Confirm".
- **Prerequisite**: `plannerMeta.isConfirmable` must be `true`.
- **API Call**: `POST /subscriptions/:id/days/:date/confirm`
- **Backend Behavior**: Pairs proteins/carbs into `materializedMeals`, locks the record, and sets `plannerState = "confirmed"`.
- **UI Next Step**: Show "Confirmed" badge. Disable all selection interactions.

---

## 5. Premium Flow & Payment Rules

### When does `paymentRequirement` appear?
If a user selects a premium protein and their `wallet.availablePremiumCredits` is **0**, backend marks that slot as `premiumSource: "pending_payment"`.

### Calculation Logic
- `extraPremiumCount`: Count of slots with `pending_payment`.
- `amountHalala`: `extraPremiumCount * unitExtraFeeHalala` (found in the catalog).

### The Revision Safety Rule
If you initiate a payment for Slot A and Slot B, but change it to Slot C before paying, the verification will fail with `PREMIUM_EXTRA_REVISION_MISMATCH`. 
**Frontend Rule**: If `mealSlots` change, any existing payment draft is invalidated.

---

## 6. Validation & Business Rules

| Rule | Backend Code | UI Behavior |
| :--- | :--- | :--- |
| **Beef Limit** | `BEEF_LIMIT_EXCEEDED` | Maximum **ONE** beef protein per day. If exceeded, `isConfirmable` becomes `false`. |
| **Partial Slots** | `PLANNING_INCOMPLETE` | Every slot must have both Protein AND Carb. Partial slots block confirmation. |
| **Locking** | `LOCKED` | Once `plannerState` is `confirmed` or `date` matches/is after today, the day is locked for edits. |

---

## 7. UI Implementation Rules (MUST FOLLOW)

1.  **Trust `plannerMeta`**: Do not calculate "is valid" in Flutter. Always use `plannerMeta.isConfirmable` and `plannerMeta.isDraftValid`.
2.  **Source of Truth**: Use `mealSlots[]`. The meal ID logic from the old system is deprecated.
3.  **Slot Errors**: If `valid: false`, loop through `slotErrors[]`. Match `slotIndex` to your UI components to show the `message`.
4.  **Wallet Management**: Use `wallet.projectedCoveredCount` to show how many premium meals are "free" vs `wallet.projectedPendingPaymentCount` for "paid".
5.  **Confirm Blocking**: The "Confirm" button **must** be disabled if:
    - `plannerMeta.isConfirmable == false`
    - OR `paymentRequirement.requiresPayment == true`.

---

## 8. API Response Examples

### Example 1: Draft Day (Requires Payment)
```json
{
  "date": "2026-04-20",
  "status": "open",
  "mealSlots": [
    {
      "slotIndex": 1,
      "status": "complete",
      "proteinId": "PROT_BEEF_ID",
      "carbId": "CARB_RICE_ID",
      "isPremium": true,
      "premiumSource": "pending_payment" 
    }
  ],
  "plannerMeta": {
    "isConfirmable": false, 
    "beefSlotCount": 1,
    "premiumPendingPaymentCount": 1
  },
  "paymentRequirement": {
    "requiresPayment": true,
    "amountHalala": 2000,
    "currency": "SAR"
  }
}
```

### Example 2: Validation Error (Beef Rule)
```json
{
  "valid": false,
  "slotErrors": [
    {
      "slotIndex": 1,
      "field": "protein",
      "code": "BEEF_LIMIT_EXCEEDED",
      "message": "Only one beef meal is allowed per day"
    },
    {
      "slotIndex": 2,
      "field": "protein",
      "code": "BEEF_LIMIT_EXCEEDED",
      "message": "Only one beef meal is allowed per day"
    }
  ]
}
```

### Example 3: Confirmed Day
```json
{
  "date": "2026-04-20",
  "status": "open",
  "plannerState": "confirmed",
  "materializedMeals": [
    {
      "slotKey": "slot_1",
      "comboKey": "BEEF_RICE_STD",
      "operationalSku": "BF-RC-01"
    }
  ]
}
```

---

## 9. Edge Cases

- **User navigates away with unsaved changes**: Prompt to save.
- **Refunds**: If a user pays for an extra premium slot but then switches back to a regular protein, the backend *auto-refunds* the credit to the user's wallet balance (standard behavior for `paid_extra` -> `none`).
- **Catalog updates**: If a protein is disabled in the backend, its ID will no longer appear in the catalog. The UI should handle `null` lookups gracefully.

---

## 10. Summary Checklist for Frontend
1. [ ] Fetch Catalog and Map to Categories.
2. [ ] Render `requiredSlotCount` cards.
3. [ ] Implement `POST /validate` on every selection change.
4. [ ] Check `requiresPayment` on `PUT /selection` response.
5. [ ] Ensure "Confirm" is only enabled when `isConfirmable` is true AND no payment is pending.
