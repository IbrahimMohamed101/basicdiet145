# Backend Subscription Lifecycle Audit

This audit documents the relationship between client actions, backend state transitions, and ledger balance updates.

---

## 1. Lifecycle Milestones & Transitions

### Phase 1: Subscription Creation (Checkout)
1. **Draft Generation**:
   - **Trigger**: Client calls `POST /api/subscriptions/checkout`.
   - **Backend Action**: Creates a `CheckoutDraft` and a pending `Payment` record. Derives the initial balance contract (`totalMeals = daysCount * selectedMealsPerDay`).
   - **Balance Effect**: No balance impact (draft state).
2. **Activation**:
   - **Trigger**: Moyasar Webhook or manual validation calls `/verify-payment`.
   - **Backend Action**: Transitions status to `active`. Copies plan parameters to the `Subscription` document and populates `remainingMeals = totalMeals`. Initializes `premiumBalance` and `addonBalance` ledger arrays.

---

### Phase 2: Planning & Modification
1. **Single / Bulk Selection Updates**:
   - **Trigger**: Client calls `PUT /selection` or `POST /bulk-selection`.
   - **Backend Action**: Validates dates against active boundaries. Verifies that the global complete planned slot count does not exceed `remainingMeals`.
   - **Balance Effect**: None (reserves slots under `SubscriptionDay.mealSlots`, but does not decrement `remainingMeals` until fulfillment).
2. **Premium/Add-on Payment Verification**:
   - **Trigger**: Unified day payments verify/callback.
   - **Backend Action**: Validates invoice revision hashes. If valid, marks day payment paid.
   - **Balance Effect**: Updates the subscription's `premiumBalance` or `addonBalance` ledger (remaining/purchased quantities).

---

### Phase 3: Fulfillment Operations

#### Home Delivery Lifecycle
1. **Preparation**: `confirmed` -> `in_preparation` (Kitchen preparer).
2. **Dispatch**: `in_preparation` -> `out_for_delivery` (Courier starts route). Upserts a unique `Delivery` document for the `{ subscriptionId, date }`.
3. **Fulfillment**: `out_for_delivery` -> `fulfilled` (Courier delivery). Decrements `remainingMeals` by the day's slot count and sets `creditsDeducted = true`. Repeated requests are blocked by the `creditsDeducted` guard.

#### Branch Pickup Lifecycle
1. **Client Pickup Request**:
   - **Trigger**: Client calls `POST /pickup-requests`.
   - **Backend Action**: Verifies ownership and active state. Creates a `SubscriptionPickupRequest` with status `locked`.
   - **Balance Effect**: Atomically decrements `Subscription.remainingMeals` by `mealCount` (reserves credits).
2. **Kitchen Preparation**:
   - **Trigger**: Staff calls `/prepare` on the pickup request.
   - **State Transition**: `locked` -> `in_preparation`.
3. **Ready for Pickup**:
   - **Trigger**: Staff calls `/ready_for_pickup`.
   - **State Transition**: `in_preparation` -> `ready_for_pickup`. Generates the branch pickup verification code.
4. **Fulfillment**:
   - **Trigger**: Staff calls `/fulfill` with verification code.
   - **State Transition**: `ready_for_pickup` -> `fulfilled`.
   - **Balance Effect**: None (credits were already decremented during reservation).
5. **No Show**:
   - **Trigger**: Staff calls `/no_show`.
   - **State Transition**: `ready_for_pickup`/`in_preparation` -> `no_show`.
   - **Balance Effect**: Retains credit decrement (does not return meals to subscription).
6. **Cancellation**:
   - **Trigger**: Client or Admin cancels before fulfillment.
   - **State Transition**: `locked`/`in_preparation` -> `canceled`.
   - **Balance Effect**: Increments `Subscription.remainingMeals` by the request's reserved `mealCount` (releases credits).

---

## 2. Operational Invariant Rules
- **No Direct Day Actions for Pickup**: Kitchen/branch staff cannot prepare, ready, or fulfill branch pickup subscription days directly. They must operate on the `SubscriptionPickupRequest`. Direct transitions on a pickup subscription day are blocked with `422 PICKUP_REQUEST_REQUIRED`.
- **One Delivery Visit Per Day**: Home delivery updates upsert a single delivery record scoped to `{ subscriptionId, date }`, guaranteeing a single courier visit.
