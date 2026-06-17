# Subscription Domain Contracts

This document specifies the logical invariants, schema requirements, and state transitions governing the subscription domain in BasicDiet145.

---

## 1. Base Meal Subscription Invariants

### Meal Slots as Source of Truth
- The source of truth for planned meals in a subscription is the collection of generated meal slots (`mealSlots`).
- `mealCount` must not be used as the source of truth where meal slots exist.
- The total allowed meals are computed at checkout via the contract formula: `totalMeals = daysCount * selectedMealsPerDay`.

### Global Meal Cap Validation
- A customer cannot plan more future meals than their subscription remaining balance allows.
- When saving selections for any single day or in bulk, the system must enforce the following invariant across all planned days:
  $$\text{Existing Complete Slots (Outside Affected Dates)} + \text{Incoming Complete Slots} \le \text{Subscription.remainingMeals}$$
- This validation must execute within a database transaction to prevent race conditions and overbooking.

---

## 2. Add-on Entitlements and Ledger Balance

### Add-on Definitions
- Add-ons are supplementary items (e.g., juices, snacks, desserts) that are separate from the base meal plan.

### Ledger/Entitlement Model
- Add-ons must have a strictly independent balance ledgers:
  - `purchasedQty`: Total quantity purchased.
  - `remainingQty`: Quantity currently available for scheduling/pickup.
  - `consumedQty`: Quantity already delivered/collected.
- Add-on selections must **never** be stored or submitted inside base `selectedMealSlotIds`.
- The system must reject any attempt to submit add-on IDs inside meal slot validation structures.

---

## 3. Premium Meal Upgrades

### Definition and Limits
- Premium upgrades (e.g., premium proteins, large salads) upgrade an existing base meal slot.
- Upgrading a meal slot to premium does **not** create an additional meal.
- The total number of premium meals planned or consumed cannot exceed the customer's purchased premium balance.

---

## 4. Fulfillment Models

### Home Delivery
- Scoped strictly to `{ subscriptionId, date }`.
- Creates at most **one** `Delivery` record per subscription per day.
- Transitioning a day to `out_for_delivery` or `delivered` deducts standard credits once. Duplicate dispatches or fulfillments must be blocked or run idempotently without double-deductions.

### Branch Pickup
- Operates strictly on `SubscriptionPickupRequest` records.
- Creating a `SubscriptionPickupRequest` atomically reserves the meal credits by decrementing `Subscription.remainingMeals`.
- Transitioning a planned branch pickup subscription day requires an active `SubscriptionPickupRequest`. Operations like `prepare`, `ready_for_pickup`, `fulfill`, and `no_show` must return `422 PICKUP_REQUEST_REQUIRED` on a `subscription_day` that lacks a pickup request.
- Fulfilling the request consumes the reserved balance but does not decrement `remainingMeals` again.
- Canceling a pickup request before consumption releases the reserved credits back to `remainingMeals`.
- `no_show` consumes the reserved credits without returning them to `remainingMeals`.
