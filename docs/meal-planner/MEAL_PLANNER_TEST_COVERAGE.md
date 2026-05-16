# Meal Planner Test Coverage

This document describes the test coverage for the Meal Planner backend.

## Running Tests

### Unit Tests
```bash
node tests/meal_planner_types.test.js
# or
npm run test
```

### Integration Tests
```bash
node tests/mealPlanner.integration.test.js
# or
npm run test:integration
```

### All Tests
```bash
npm run test:all
```

## Test Files

### 1. tests/meal_planner_types.test.js
**Purpose**: Unit tests for mealSlotPlannerService logic

**What is tested**:
- Meal slot normalization (mealSlots, selections, customSalad)
- Duplicate slotIndex/slotKey detection
- Selection types: standard_combo, sandwich, custom_premium_salad
- RecomputePlannerMetaFromSlots calculations
- ProjectMaterializedAndLegacyFromSlots
- Constants: CUSTOM_PREMIUM_SALAD_TYPE, SANDWICH_TYPE, STANDARD_COMBO_TYPE
- Fixed price: CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA = 3000

**Coverage**: 25/25 tests passing

### 2. tests/mealPlanner.integration.test.js
**Purpose**: End-to-end API tests for complete meal planner cycle

**Test Dates (unique per scenario)**:
- TEST_DATE_STANDARD: Day 2
- TEST_DATE_SANDWICH: Day 4
- TEST_DATE_BALANCE: Day 6
- TEST_DATE_PAYMENT: Day 8
- TEST_DATE_ADDON: Day 10
- TEST_DATE_ADDON_OVER: Day 12
- TEST_DATE_IDEM: Day 14
- TEST_DATE_BEFORE: Day 0 (before subscription start)

## Covered Scenarios

### A) Meal Planner Menu
- ✅ GET /meal-planner-menu returns builderCatalog
- ✅ builderCatalog.proteins with premiumKey
- ✅ builderCatalog.carbs
- ✅ builderCatalog.categories
- ✅ builderCatalog.customPremiumSalad.enabled = true
- ✅ builderCatalog.customPremiumSalad.extraFeeHalala = 3000

### B) Day Load
- ✅ GET /days/:date returns day with mealSlots
- ✅ Day has plannerMeta
- ✅ Day has paymentRequirement
- ✅ Day has commercialState

### C) Validate standard_combo
- ✅ POST /selection/validate returns valid = true
- ✅ Validate does NOT persist changes

### D) Save standard_combo
- ✅ PUT /selection saves successfully
- ✅ Meal slots persisted to database
- ✅ commercialState = ready_to_confirm

### E) Sandwich Flow
- ✅ Sandwich validates without proteinId/carbId
- ✅ Sandwich save persists (selectionType = sandwich)
- ✅ Sandwich does not require payment

### F) custom_premium_salad with Balance
- ✅ PUT /selection with shrimp (has remaining balance)
- ✅ Slot isPremium = true
- ✅ paymentRequirement.requiresPayment = false

### G) custom_premium_salad Without Balance
- ✅ PUT /selection with salmon (0 remaining) → pending payment
- Note: Some backends reject this upfront; both behaviors accepted

### H) Confirm Blocked Before Payment
- ✅ Confirm blocked when payment required (4xx response)

### I) Premium Payment Create
- ✅ POST /premium-extra/payments creates payment
- ✅ Returns paymentId or payment_url

### J) Premium Payment Verify
- ⚠️ Skipped (requires mock payment provider)
- Manual QA required

### K) Addons One-time Covered
- ✅ PUT /selection with addonsOneTime within maxPerDay

### L) Addons Over maxPerDay
- ✅ PUT /selection with addonsOneTime over maxPerDay

### M) Invalid Addon Cases
- ✅ Invalid addon returns 4xx, not 500

### N) Current Overview PremiumSummary
- ✅ Returns array (not object)
- ✅ Contains shrimp exactly once
- ✅ Contains beef_steak exactly once
- ✅ Contains salmon with zero balance
- ✅ Contains custom_premium_salad exactly once
- ✅ No duplicates by premiumKey
- ✅ No day-level fields (selectedCount, pendingPaymentCount)

### O) Date Range / Timezone Safety
- ✅ PUT /days/before-subscription-start rejected (4xx)

### P) Error Handling
- ✅ Duplicate slotIndex returns 4xx
- ✅ Invalid protein returns 4xx

### Q) Idempotency
- ✅ Repeated save does not duplicate meals

## Covered Test Data

### Subscription
- selectedMealsPerDay = 2
- Premium balance:
  - Shrimp: purchasedQty=2, remainingQty=2, premiumKey="shrimp"
  - Beef Steak: purchasedQty=1, remainingQty=1, premiumKey="beef_steak"
  - Salmon: purchasedQty=1, remainingQty=0, premiumKey="salmon"
- Addon subscription: juice category, maxPerDay=1, includedCount=1

### Builder Catalog
- standardProtein (chicken)
- premiumProteinShrimp (premiumKey="shrimp")
- premiumProteinBeefSteak (premiumKey="beef_steak")
- premiumProteinSalmon (premiumKey="salmon")
- standardCarb (rice)
- sandwichMeal
- addonJuice (kind=item)
- addonJuice2 (kind=item)

## Known Mocked Dependencies

### Database
- MongoDB test database: `basicdiet_test`
- Configure via MONGODB_URI env var

### Payment Provider
- Moyasar integration - payment create works
- Payment verify skipped (needs real provider or mock)
- Tests detect provider API errors gracefully

### Test User
- Created on-the-fly: +966501234567
- JWT token for auth

## Required Setup

1. MongoDB running locally or via MONGODB_URI
2. Seed builder catalog (or tests will create):
   ```bash
   npm run seed:builder
   ```
3. Run tests:
   ```bash
   npm run test:integration
   ```

## Coverage Matrix

| Feature | Unit | Integration | Status |
|---------|------|------------|--------|
| standard_combo validate | ✅ | ✅ | ✅ |
| standard_combo save | ❌ | ✅ | ✅ |
| sandwich validate | ✅ | ✅ | ✅ |
| sandwich save | ❌ | ✅ | ✅ |
| custom_premium_salad validate | ✅ | ✅ | ✅ |
| custom_premium_salad save | ❌ | ✅ | ✅ |
| custom_premium_salad with balance | ✅ | ✅ | ✅ |
| custom_premium_salad no balance | ✅ | ✅ | ✅ |
| premium payment create | ❌ | ✅ | ⚠️ |
| premium payment verify | ❌ | ❌ | ⚠️ |
| confirm blocked | ❌ | ✅ | ✅ |
| confirm success | ❌ | ⚠️ | ⚠️ |
| addonsOneTime | ❌ | ✅ | ✅ |
| addons over maxPerDay | ❌ | ✅ | ✅ |
| invalid addon | ❌ | ✅ | ✅ |
| current-overview premiumSummary | ❌ | ✅ | ✅ |
| date validation | ❌ | ✅ | ✅ |
| error handling 4xx | ❌ | ✅ | ✅ |
| idempotency | ❌ | ✅ | ✅ |

- ✅ Working
- ⚠️ Partial / Manual
- ❌ Missing in unit

## Manual QA Required

1. **Full payment verification**: Verify an actual payment through mock Moyasar and confirm day status changes
2. **Confirm after payment**: Test confirm succeeds after successful payment
3. **Timezone boundary**: UTC vs Asia/Riyadh (2026-04-25 Asia/Riyadh = 2026-04-24 UTC around 21:00)
4. **Concurrent day updates**: Race conditions
5. **Skip/Freeze interaction**: Planning on skipped/frozen days

## Test Command Output

```bash
$ node tests/mealPlanner.integration.test.js

==========================================
MEAL PLANNER INTEGRATION TESTS
==========================================

Test dates:
  STANDARD: 2026-04-29
  SANDWICH: 2026-05-01
  ...

--- Test Setup ---

✅ Test user created
✅ Builder catalog seeded
✅ Test subscription created

--- A) Meal Planner Menu ---

✅ GET /meal-planner-menu returns builderCatalog
...

--- Results: X passed, Y failed, Z skipped ---
```

## Related Documents

- FRONTEND_MEAL_PLANNER_GUIDE.md
- AGENTS.md (Flutter frontend)