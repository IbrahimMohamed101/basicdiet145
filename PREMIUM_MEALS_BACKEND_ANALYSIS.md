# Premium Meals Backend Analysis & Mobile Integration Guide

## Executive Summary

**Verdict:** The backend supports **two distinct premium meal models** (legacy itemized + generic credits), and **premium balance data DOES exist but is strategically separated** in the wallet endpoint. The "My Subscription" overview should NOT be extended; instead, the mobile app should use a **two-endpoint pattern** to show premium vs regular meal counts clearly.

---

## 1. How Premium Meals Actually Work in Backend

### A. Two Wallet Modes (Simultaneously Supported)

The backend implements two simultaneous premium meal models for backward compatibility:

#### **Mode 1: Legacy Itemized (`legacy_itemized`)**
- **What it is:** Individual premium meal purchases tracked per meal ID
- **Fields:**
  ```
  Subscription.premiumBalance = [
    {
      premiumMealId: ObjectId,
      purchasedQty: Number,
      remainingQty: Number,
      unitExtraFeeHalala: Number,
      purchasedAt: Date
    }
  ]
  ```
- **When consumed:** User selects this premium meal → 1 unit consumed
- **Persisted in:** `Subscription.premiumSelections[]` (one entry per day selected)
- **Summary:** `buildSubscriptionSummaries()` aggregates by `premiumMealId`

#### **Mode 2: Generic Credits (`generic_v1`)**
- **What it is:** A unified credit pool (all premium meals share the same wallet)
- **Fields:**
  ```
  Subscription.genericPremiumBalance = [
    {
      purchasedQty: Number,
      remainingQty: Number,
      unitCreditPriceHalala: Number,
      purchasedAt: Date,
      source: String  // "purchase" | other
    }
  ]
  ```
- **When consumed:** Any premium meal selection consumes 1 credit
- **Persisted in:** `Subscription.premiumSelections[]` (links to wallet row via `premiumWalletRowId`)
- **Summary:** `buildSubscriptionSummaries()` shows as single row with `name: "Generic Premium Credits"`

### B. Related Fields in Subscription Model

| Field | Type | Purpose | Notes |
|-------|------|---------|-------|
| `totalMeals` | Number | Total regular meals in plan | Does NOT include premium |
| `remainingMeals` | Number | Regular meals not yet consumed | Does NOT include premium |
| `premiumRemaining` | Number | Total premium units available | Synced from `premiumBalance` or `genericPremiumBalance` |
| `premiumPrice` | Number | Price per premium unit | Legacy field, may be 0 |
| `premiumBalance` | Array | Legacy itemized purchases | Used when `premiumWalletMode === "legacy_itemized"` |
| `genericPremiumBalance` | Array | Generic credit pool | Used when `premiumWalletMode === "generic_v1"` |
| `premiumWalletMode` | Enum | Which model this subscription uses | Determines serialization path |
| `premiumSelections` | Array | All premium meal selections across all days | Tracks consumption over time |

### C. Relationship Between Fields

```
Regular Meals:
- totalMeals (from plan) = X
- remainingMeals = total - consumed regular meals = Y
- Regular meals = Y (remaining regular meals)

Premium Meals:
- premiumRemaining = SUM(premiumBalance[].remainingQty)
  OR = SUM(genericPremiumBalance[].remainingQty)
- premiumRemaining = units available for purchase
- Consumed premium = SUM(premiumSelections[])
```

---

## 2. Source of Truth in Code

### Location 1: Premium Wallet Mode Detection (Recursive Path)

**File:** [src/services/genericPremiumWalletService.js](src/services/genericPremiumWalletService.js#L19-L23)

```javascript
function isGenericPremiumWalletMode(entity) {
  return normalizePremiumWalletMode(entity) === GENERIC_PREMIUM_WALLET_MODE;
}
```

**Usage:** In `buildSubscriptionSummaries()` (line 3156), determines which balance array to read:
- ✅ If generic mode → read `genericPremiumBalance`
- ✅ If legacy mode → read `premiumBalance`

### Location 2: Summary Calculation (Core Logic)

**File:** [src/controllers/subscriptionController.js](src/controllers/subscriptionController.js#L3156-L3320)

Function `buildSubscriptionSummaries(subscription, lang)`:

```javascript
if (isGenericPremiumWalletMode(subscription)) {
  // Generic credits: all meals from one pool
  const genericRows = subscription.genericPremiumBalance || [];
  // SUM remaining:
  const remainingQtyTotal = genericRows.reduce((sum, row) => sum + row.remainingQty, 0);
  return {
    premiumSummary: [{
      purchasedQtyTotal: ...,
      remainingQtyTotal: ...,  // ← Total premium credits available
      consumedQtyTotal: ...,   // ← Used so far
      minUnitPriceHalala: ...,
      maxUnitPriceHalala: ...
    }],
    addonsSummary: [...]
  };
} else {
  // Legacy itemized: per-meal tracking
  const premiumBalance = subscription.premiumBalance || [];
  const premiumSelections = subscription.premiumSelections || [];
  
  // Build map of premiumMealId → {purchased, remaining, consumed}
  // Aggregate by meal ID
  const premiumSummary = [
    {
      premiumMealId: "meal-123",
      purchasedQtyTotal: 5,
      remainingQtyTotal: 2,  // ← Per-meal availability
      consumedQtyTotal: 3,
      minUnitPriceHalala: 1000,
      maxUnitPriceHalala: 1000
    }
  ];
}
```

### Location 3: Wallet Endpoint (Full Picture)

**File:** [src/controllers/subscriptionController.js](src/controllers/subscriptionController.js#L3325-L3403)

Function `buildSubscriptionWalletSnapshot(subscription, lang)`:

Returns:
```javascript
{
  subscriptionId: String,
  premiumWalletMode: "generic_v1" | "legacy_itemized",
  premiumRemaining: Number,
  premiumSummary: [ { purchasedQtyTotal, remainingQtyTotal, consumedQtyTotal, ... } ],
  addonsSummary: [ ... ],
  premiumBalance: [ { id, purchasedQty, remainingQty, unitExtraFeeHalala, ... } ],
  addonBalance: [ ... ],
  totals: {
    premiumPurchasedQtyTotal: Number,
    premiumRemainingQtyTotal: Number,
    addonPurchasedQtyTotal: Number,
    addonRemainingQtyTotal: Number
  }
}
```

---

## 3. Can Mobile Show Premium vs Regular Separately?

**YES, but with a strategic pattern.**

### Current State (Already Supported)

#### Endpoint 1: `GET /api/subscriptions` or `GET /api/subscriptions/:id`

**Returns (via serializeSubscriptionForClient):**
```javascript
{
  _id: String,
  userId: String,
  status: String,
  totalMeals: Number,           // ← Regular meals (does NOT include premium)
  remainingMeals: Number,       // ← Regular meals remaining
  premiumRemaining: Number,     // ← Premium credits/meals available
  startDate: Date,
  validityEndDate: Date,
  deliveryMode: String,
  selectedMealsPerDay: Number,
  contractSnapshot: { ... },
  premiumSummary: [ ... ],      // ← PER-MEAL BREAKDOWN (generic or itemized)
  addonsSummary: [ ... ],
  ...
}
```

**Current Gap:** The main subscription response includes `premiumSummary` array (aggregated), but mobile might not be parsing it yet.

#### Endpoint 2: `GET /api/subscriptions/:id/wallet`

**Returns (via buildSubscriptionWalletSnapshot):**
```javascript
{
  premiumWalletMode: String,     // ← "generic_v1" | "legacy_itemized"
  premiumRemaining: Number,      // ← Total available
  premiumSummary: [ ... ],       // ← Aggregated summaries
  premiumBalance: [ ... ],       // ← Detailed rows
  totals: {
    premiumPurchasedQtyTotal: Number,
    premiumRemainingQtyTotal: Number
  }
}
```

### Calculation Formula for Mobile

```javascript
// From single subscription overview:
totalRegularMeals = subscription.totalMeals

remainingRegularMeals = subscription.remainingMeals

totalPremiumCredits = subscription.premiumRemaining

consumedPremiumCredits = subscription.premiumSummary
  .reduce((sum, row) => sum + row.consumedQtyTotal, 0)

remainingPremiumCredits = subscription.premiumSummary
  .reduce((sum, row) => sum + row.remainingQtyTotal, 0)
```

---

## 4. If Values Don't Exist Directly, How to Derive?

**They DO exist, but are in different places:**

### All Required Values Are Present

| Value | Location | Calculation |
|-------|----------|-------------|
| `totalMeals` | `subscription.totalMeals` | Direct field |
| `remainingMeals` | `subscription.remainingMeals` | Direct field |
| `premiumIncluded` | N/A (not a field - see below) | Derived or from plan |
| `premiumRemaining` | `subscription.premiumRemaining` | Direct field |
| `regularRemaining` | `subscription.remainingMeals` | Direct = regular |
| `totalConsumedMeals` | `totalMeals - remainingMeals` | Derived |
| `totalConsumedPremium` | `SUM(premiumSummary[].consumedQtyTotal)` | Derived from summary |

### Important Clarification

**There is NO "premium meals included" field.** Premium is entirely wallet-based:

- Premium is a **PAY-EXTRA add-on**, not a base entitlement
- Base plan has `totalMeals` (all regular)
- User can **purchase** premium meals/credits separately → increases `premiumRemaining`
- Each day, user can choose premium or regular for each slot

**Therefore:**
```
Total available meals on a day = Regular + Premium (both optional)
Regular meals cap = totalMeals
Premium meals cap = premiumRemaining
```

---

## 5. Recommended Backend Contract

### Pattern: **Two-Endpoint Consumption**

**NOT an aggregate endpoint. Instead, mobile should:**

1. **Call `GET /api/subscriptions/:id`** for main overview (already returns `premiumSummary`)
2. **Call `GET /api/subscriptions/:id/wallet`** only if showing wallet details or purchasing

### Why NOT Merge into Overview?

- **Separation of concerns:** Overview is fast/cacheable, wallet has financial details
- **Security:** Wallet should have stricter audit logging
- **Scope:** Overview shows meal plan status; wallet shows credits/purchases
- **Mobile pattern:** "My Subscription" != "My Wallet" (two separate tabs/screens)

### Recommended Mobile Implementation

**Screen: My Subscription**
```javascript
// One fetch
const overview = await fetch('/api/subscriptions/:id', { headers: auth });

// Display
Plan Name: overview.data.contractSnapshot.plan.planName
Total Meals: overview.data.totalMeals  // ← Regular meals base
Remaining Meals: overview.data.remainingMeals  // ← Regular remaining
Premium Available: overview.data.premiumRemaining  // ← Premium credits available
Status: overview.data.status
```

**Screen: Wallet** (optional secondary screen)
```javascript
// Separate fetch when needed
const wallet = await fetch('/api/subscriptions/:id/wallet', { headers: auth });

// Display premium balance rows, purchase history, etc.
Premium Mode: wallet.data.premiumWalletMode
Purchased Total: wallet.data.totals.premiumPurchasedQtyTotal
Remaining: wallet.data.totals.premiumRemainingQtyTotal
Consumed: premiumPurchasedQtyTotal - premiumRemainingQtyTotal
```

---

## 6. Exact Response Shape Proposed

### `GET /api/subscriptions/:id` (Existing, No Change Needed)

```javascript
{
  "ok": true,
  "data": {
    "_id": "sub-123",
    "userId": "user-456",
    "status": "active",
    "planName": {
      "en": "Gold Plan",
      "ar": "الخطة الذهبية"
    },
    
    // REGULAR MEALS
    "totalMeals": 30,           // Base plan: 30 regular meals
    "remainingMeals": 15,       // 15 consumed, 15 left
    "selectedMealsPerDay": 1,
    
    // PREMIUM (NEW/CLARIFIED)
    "premiumRemaining": 5,      // 5 premium credits available
    "premiumWalletMode": "generic_v1",
    "premiumSummary": [
      {
        "premiumMealId": null,
        "name": "Premium Credits",
        "purchasedQtyTotal": 10,
        "remainingQtyTotal": 5,
        "consumedQtyTotal": 5,
        "minUnitPriceHalala": 1000,
        "maxUnitPriceHalala": 1000
      }
    ],
    
    // ADD-ONS
    "addonsSummary": [ ... ],
    
    // DATES
    "startDate": "2026-03-19T21:00:00.000Z",
    "validityEndDate": "2026-04-15T21:00:00.000Z",
    
    // DELIVERY
    "deliveryMode": "delivery",
    "deliveryWindow": "8 AM - 11 AM",
    "deliveryAddress": { ... },
    
    // CONTRACT
    "contract": {
      "isCanonical": true,
      "version": "subscription_contract.v1"
    }
  }
}
```

### `GET /api/subscriptions/:id/wallet` (Existing, Full Details)

```javascript
{
  "ok": true,
  "data": {
    "subscriptionId": "sub-123",
    "premiumWalletMode": "generic_v1",
    "premiumRemaining": 5,
    
    "premiumSummary": [
      {
        "premiumMealId": null,
        "name": "Premium Credits",
        "purchasedQtyTotal": 10,
        "remainingQtyTotal": 5,
        "consumedQtyTotal": 5,
        "minUnitPriceHalala": 1000,
        "maxUnitPriceHalala": 1000
      }
    ],
    
    "premiumBalance": [
      {
        "id": "balance-row-1",
        "premiumMealId": null,
        "purchasedQty": 10,
        "remainingQty": 5,
        "unitExtraFeeHalala": 1000,
        "currency": "SAR",
        "purchasedAt": "2026-03-20T10:00:00.000Z",
        "walletMode": "generic_v1"
      }
    ],
    
    "addonsSummary": [ ... ],
    "addonBalance": [ ... ],
    
    "totals": {
      "premiumPurchasedQtyTotal": 10,
      "premiumRemainingQtyTotal": 5,
      "addonPurchasedQtyTotal": 0,
      "addonRemainingQtyTotal": 0
    }
  }
}
```

---

## 7. Needed Backend Change (If Any)

**NO backend changes required for basic mobile display.**

### Current State
✅ `premiumRemaining` is already in overview
✅ `premiumSummary` is already in overview
✅ `totalMeals` + `remainingMeals` are separate (correct design)
✅ Wallet endpoint provides full details for advanced features

### Optional Future Enhancement (Low Priority)

If mobile wants a **"quick summary" response**, add a derived field to wallet endpoint:

```javascript
// In buildSubscriptionWalletSnapshot():
return {
  ...existing,
  summary: {
    mealBreakdown: {
      totalRegularMeals: subscription.totalMeals,
      remainingRegularMeals: subscription.remainingMeals,
      totalPremiumMeals: premiumBalance.reduce(sum => sum + row.purchasedQty),
      remainingPremiumMeals: subscription.premiumRemaining,
      totalMealsConsumed: subscription.totalMeals - subscription.remainingMeals,
      totalPremiumConsumed: premiumPurchasedQtyTotal - premiumRemainingQtyTotal
    }
  }
}
```

**But this is OPTIONAL** — the data already exists in separate fields.

---

## 8. Why Frontend Should Not Guess This

### The System is Non-Trivial

1. **Two wallet modes exist simultaneously:**
   - Legacy subscriptions still use itemized premiums
   - New subscriptions use generic credits
   - Logic differs for consumption, refunds, and display
   - Mobile must NOT assume `genericPremiumBalance` exists

2. **Premium ≠ "Included":**
   - Premium is purchased, not guaranteed
   - Regular meals are the base entitlement
   - Premium is optional per-meal
   - Frontend cannot assume premium count from plan data

3. **Consumption is Complex:**
   - When premium is selected, WHICH balance row gets decremented?
   - In generic mode, FIFO (oldest purchase first)
   - In legacy mode, per-meal purchase is consumed
   - Refunds must track row IDs correctly

4. **Financial Accuracy:**
   - Each premium purchase has different `unitExtraFeeHalala`
   - Wallets can have multiple rows with different prices
   - Frontend cannot hardcode pricing

5. **Async Consumption:**
   - Premium selections are written at **day planning time**
   - Can be undone/refunded before day locks
   - Frontend must refresh from backend for accurate count

### Code Path is Dynamic

**Mobile cannot replicate:**
- `buildSubscriptionSummaries()` aggregation logic
- `isGenericPremiumWalletMode()` mode detection
- `syncPremiumRemainingFromActivePremiumWallet()` recalculation
- `consumeGenericPremiumCredits()` consumption logic

---

## 9. Edge Cases

### Case 1: Mixed Wallet Rows (Multiple Purchases)
```javascript
genericPremiumBalance: [
  { purchasedQty: 5, remainingQty: 2, unitCreditPriceHalala: 1000, purchasedAt: Date1 },
  { purchasedQty: 3, remainingQty: 3, unitCreditPriceHalala: 1500, purchasedAt: Date2 }
]

// Backend correctly shows:
premiumRemaining: 5  // 2 + 3
premiumSummary[0]: {
  remainingQtyTotal: 5,
  consumedQtyTotal: 3,
  minUnitPriceHalala: 1000,
  maxUnitPriceHalala: 1500  // ← Different prices!
}

// Frontend MUST NOT assume flat price
```

### Case 2: Subscription Renewed
```javascript
renewedFromSubscriptionId: "old-sub-123"

// Premium balance is FRESH (not carried over)
// Legacy: each renewal starts with premiumRemaining = 0
// User must repurchase premium
// Frontend logic stays same: look at premiumRemaining
```

### Case 3: Premium Selection Refunded
```javascript
// User selects premium on Day 5
// Before day locks, user cancels selection
// Backend removes from premiumSelections[]
// Backend increments premiumBalance/genericPremiumBalance
// Frontend must refresh to see updated premiumRemaining
```

### Case 4: Legacy Itemized Mode
```javascript
premiumWalletMode: "legacy_itemized"
premiumBalance: [
  {
    premiumMealId: "meal-456",
    purchasedQty: 5,
    remainingQty: 0,
    unitExtraFeeHalala: 1000
  },
  {
    premiumMealId: "meal-789",
    purchasedQty: 3,
    remainingQty: 2,
    unitExtraFeeHalala: 1200
  }
]
premiumSummary: [
  { premiumMealId: "meal-456", remainingQtyTotal: 0, ... },
  { premiumMealId: "meal-789", remainingQtyTotal: 2, ... }
]

// Frontend sees: Meal A exhausted, Meal B has 2 left
// Mobile UI pattern: "Premium Meals Available" → [{ name: "Steak", qty: 0 }, { name: "Salmon", qty: 2 }]
```

### Case 5: Transitioning Between Modes
```javascript
// NOT SUPPORTED by backend
// A subscription is created in ONE mode and stays that way
// No in-flight migration
// Frontend can safely assume mode is stable for a given sub
```

---

## 10. Final Recommendation

### What Mobile App Should Do

#### **For "My Subscription" Screen:**

```javascript
/* Single endpoint, two data streams */
const sub = await fetch('/api/subscriptions/current/overview', auth);

// Display regular meals
regularMeals = {
  total: sub.totalMeals,
  remaining: sub.remainingMeals,
  consumed: sub.totalMeals - sub.remainingMeals
};

// Display premium credits
premiumCredits = {
  total: sub.premiumSummary.reduce((s,r) => s + r.purchasedQtyTotal, 0),
  remaining: sub.premiumRemaining,
  consumed: sub.premiumSummary.reduce((s,r) => s + r.consumedQtyTotal, 0)
};

// Show both clearly separated
```

#### **For "Wallet Details" screen (if needed later):**

```javascript
const wallet = await fetch('/api/subscriptions/:id/wallet', auth);

// Show purchase history rows
wallet.premiumBalance.forEach(row => {
  console.log(`Purchased: ${row.purchasedQty}, Remaining: ${row.remainingQty}, Price: ${row.unitExtraFeeHalala}`);
});
```

### What Mobile App Should NOT Do

❌ Do not calculate `premiumRemaining` from contract snapshot
❌ Do not hardcode premium price assumptions
❌ Do not assume premium is always available (premiumRemaining can be 0)
❌ Do not merge regular + premium into single "meals" count
❌ Do not infer wallet mode from response structure (always check `premiumWalletMode` field)
❌ Do not assume `premiumSummary` length = 1 (generic mode = 1 row, legacy mode = many rows)

### What Backend Already Provides

✅ `subscription.totalMeals` — regular meals
✅ `subscription.remainingMeals` — regular remaining
✅ `subscription.premiumRemaining` — total premium available
✅ `subscription.premiumSummary[]` — aggregated breakdown (mode-aware)
✅ `subscription.premiumWalletMode` — mode indicator
✅ Wallet endpoint with full transactional detail for advanced features

---

## Implementation Checklist

### Mobile Developer Checklist

- [ ] Parse `premiumRemaining` from overview response
- [ ] Parse `premiumSummary` array (handle both generic and legacy modes)
- [ ] Display regular meals: `totalMeals` vs `remainingMeals`
- [ ] Display premium meals: `premiumRemaining` vs "total purchased"
- [ ] Handle case: `premiumRemaining = 0` (show "no premium available")
- [ ] Handle case: `premiumSummary = []` (show "no premium purchased")
- [ ] Test with both wallet modes (ask backend team for test subscriptions)
- [ ] Do NOT cache `premiumRemaining` longer than subscription refresh
- [ ] Refresh wallet state after any premium selection/deselection
- [ ] Show prices only if rendering purchase UI (never hardcode)

### Backend Verification

- ✅ `premiumRemaining` is synced correctly after selections
- ✅ `buildSubscriptionSummaries()` handles both wallet modes
- ✅ `premiumWalletMode` field is always set
- ✅ Wallet endpoint shows full transaction history
- ✅ Test subscription lifecycle: create → purchase premium → select → show balance

---

## Code References

| What | Where |
|------|-------|
| Premium wallet modes | [src/utils/premiumWallet.js](src/utils/premiumWallet.js) |
| Summary builder | [src/controllers/subscriptionController.js:3156-3320](src/controllers/subscriptionController.js#L3156) |
| Wallet snapshot | [src/controllers/subscriptionController.js:3325-3403](src/controllers/subscriptionController.js#L3325) |
| Serializer | [src/controllers/subscriptionController.js:3404-3440](src/controllers/subscriptionController.js#L3404) |
| Generic wallet service | [src/services/genericPremiumWalletService.js](src/services/genericPremiumWalletService.js) |
| Subscription model | [src/models/Subscription.js](src/models/Subscription.js#L90-L135) |
| Read localization | [src/utils/subscriptionReadLocalization.js:213](src/utils/subscriptionReadLocalization.js#L213) |

---

## Summary Table

| Question | Answer |
|----------|--------|
| **Premium model?** | Dual: Legacy itemized (per-meal) + Generic credits (unified pool) |
| **Selection impact?** | Decrements balance row (FIFO in generic mode) |
| **Backend fields exist?** | Yes: `totalMeals`, `remainingMeals`, `premiumRemaining`, `premiumSummary` |
| **Safe derivation?** | Yes, all values present directly or simply computed |
| **Recommended contract?** | Use existing 2-endpoint pattern; no merge needed |
| **Response shape?** | Already correct; `premiumSummary` is aggregated per mode |
| **Backend changes needed?** | No (optional: add convenience summary field) |
| **Why frontend shouldn't guess?** | Non-trivial async consumption, multiple modes, financial accuracy |
| **Edge cases?** | Mixed prices, renewals, refunds, mode stability |
| **Mobile checklist?** | Parse `premiumRemaining`, handle zero cases, refresh after changes |
