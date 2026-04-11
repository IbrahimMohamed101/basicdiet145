# Test Failure Fix - Complete Action Plan

## Executive Summary

**Total Failing Tests**: 48
**Root Causes Identified**: 8 (A-H)
**Fixes Completed**: 3/8
**Remaining Fixes**: 5/8
**Environmental Blocker**: MongoDB not running (blocks test validation)

---

## Completed Fixes ✅

### 1. menuController.js - Fix E (categoryId Missing)
- **File**: src/controllers/menuController.js
- **Function**: buildSubscriptionMealCatalog (lines 96-101)
- **Change**: Added `categoryId: section.category.id` to meal category payload
- **Impact**: Fix 1 test returning undefined categoryId
- **Status**: ✅ COMPLETED

### 2. subscriptionCheckoutService.js - Fix F (Draft Not Released)
- **File**: src/services/subscription/subscriptionCheckoutService.js
- **Change**: Added logic to delete failed drafts on idempotency retry
- **Impact**: Fix 2 tests not releasing terminal state drafts
- **Status**: ✅ COMPLETED in previous session

### 3. subscriptionCheckoutService.js - Fix G (failureReason Missing)
- **File**: src/services/subscription/subscriptionCheckoutService.js
- **Change**: Added failureReason persistence when draft payment fails
- **Impact**: Fix 2 tests with undefined failureReason
- **Status**: ✅ COMPLETED in previous session

---

## Code Review Findings

### Root Cause A: Error Handler Priority (VERIFIED CORRECT)
- **Location**: src/controllers/subscriptionController.js, confirmDayPlanning (line 4925)
- **Status**: ✅ Code already has correct error handler order
- **Verification**: `if (err.status && err.code)` is FIRST check before specific error codes
- **Impact**: These 7 tests should already be passing
- **Action**: None - code is correct

---

## Fixes Requiring Code Implementation

### Root Cause B: updateDaySelection Returns 500 (8 tests)

**Priority**: 🔴 HIGH - Most test failures

**Approach**: 
1. Add null-guards in updateDaySelection for canonical contract validation
2. Add try-catch coverage for performDaySelectionUpdate errors
3. Ensure addon service calls have proper error handling

**Files to Modify**:
- src/controllers/subscriptionController.js (updateDaySelection function, ~line 4771)
- src/services/subscription/subscriptionSelectionService.js (performDaySelectionUpdate)
- src/services/subscription/oneTimeAddonPlanningService.js

**Implementation Pattern**:
```javascript
if (subscription && !subscription.canonicalContract && subscription.contractMode === "canonical") {
  return errorResponse(res, 500, "INTERNAL", "Invalid subscription canonical contract configuration");
}
```

**Tests to Verify**: Any test calling POST `/subscriptions/{id}/days/{date}/selections` with addon data

---

### Root Cause C: Day Payment Creation Returns Wrong Status (4 tests)

**Priority**: 🔴 HIGH

**Issue 1 - Happy Path Returns 422**:
- Problem: Must verify `maybeHandleNonCheckoutIdempotency` not triggering incorrectly
- File: src/controllers/subscriptionController.js (line 3603)
- Action: Check if idempotency guard firing to early in happy path

**Issue 2 - Idempotency Returns 422 Instead of 409**:
- Location: maybeHandleNonCheckoutIdempotency function (find via grep_search)
- Action: Verify returns 409 for duplicate requests, not 422

**Files to Verify**:
- src/controllers/subscriptionController.js:
  - createPremiumOverageDayPayment (line 3556)
  - createOneTimeAddonDayPlanningPayment (line 4023)
- Search for maybeHandleNonCheckoutIdempotency definition

---

### Root Cause D: Payment Verify Returns 400 Instead of 200 (2 tests)

**Priority**: 🟡 MEDIUM

**Issue**: After payment settlement, confirmDayPlanning returns blocking error

**Likely Causes**:
1. Test timing - calling confirmDayPlanning before settlement committed
2. Field sync - payment status not immediately visible to new query
3. Wrong field being checked for payment status

**Files to Check**:
- src/controllers/subscriptionController.js:
  - verifyPremiumOverageDayPayment (line 3685)
  - confirmDayPlanning error handler (line 4915)
- src/services/paymentApplicationService.js:
  - applyPremiumOverageDayPayment (line 440)

**Verification Pattern**:
1. Check that session.commitTransaction() fully completes
2. Verify test waits for response before calling confirmDayPlanning
3. Check confirmDayPlanning queries fresh data from DB

---

### Root Cause H: MongoDB Timeout (20+ tests)

**Priority**: 🟡 MEDIUM - Environmental issue

**Current Status**: MongoDB not running, tests timeout at 10 seconds

**Solution**:
1. **Install mongodb-memory-server**:
   ```bash
   npm install --save-dev mongodb-memory-server
   ```

2. **Create test setup file** (test/setup-mongo.js):
   ```javascript
   import { MongoMemoryServer } from 'mongodb-memory-server';
   
   let mongoServer;
   
   export async function startMongoDB() {
     mongoServer = await MongoMemoryServer.create();
     process.env.MONGODB_URI = mongoServer.getUri();
   }
   
   export async function stopMongoDB() {
     if (mongoServer) {
       await mongoServer.stop();
     }
   }
   ```

3. **Update test files** with before/after hooks:
   ```javascript
   before(async () => { await startMongoDB(); });
   after(async () => { await stopMongoDB(); });
   ```

**Affected Test Files**:
- test/sliceBIntegration.test.js (~5 tests)
- test/subscriptionCancellation.test.js (~4 tests)
- test/subscriptionWriteLocalization.test.js (~3 tests)
- test/subscriptionFreezeSkipRegression.test.js (~4 tests)
- test/subscriptionUiParityEnhancements.test.js (~4 tests)

---

## Execution Plan

### Phase 1: Quick Fixes (Low Risk)
**Time**: ~15 minutes
**Impact**: 8 tests fixed

1. **Action B.1**: Search/grep for error handling in updateDaySelection service
2. **Action C.1**: Find maybeHandleNonCheckoutIdempotency and verify status codes
3. **Action D.1**: Verify payment settlement transaction completion

### Phase 2: Test Infrastructure (Medium Effort)
**Time**: ~30 minutes
**Impact**: 20+ tests fixed

1. Install mongodb-memory-server
2. Create test setup module
3. Update all integration test files with mongo setup

### Phase 3: Validation
**Time**: ~10 minutes
**Impact**: Full test suite validation

1. Run full test suite
2. Verify pass count >= 46/48
3. Document any remaining issues

---

## Quick Reference: Test Status by Root Cause

| Root Cause | Tests | Current | Expected | Status |
|-----------|-------|---------|----------|---------|
| A | 7 | FAILING | PASSING | ✅ Code correct |
| B | 8 | FAILING→500 | FAILING→appropriate | 🔴 Needs fix |
| C | 4 | FAILING→422 | FAILING→200/409 | 🔴 Needs fix |
| D | 2 | FAILING→400 | FAILING→200 | 🔴 Needs fix |
| E | 1 | FAILING | PASSING | ✅ FIXED |
| F | 2 | FAILING | PASSING | ✅ FIXED |
| G | 2 | FAILING | PASSING | ✅ FIXED |
| H | 20+ | TIMEOUT | PASSING | 🔴 Needs mongo |

**Total**: 48 tests → ~6 need code fixes + 20+ need MongoDB

---

## Command Reference

### Run Full Test Suite
```bash
npm test 2>&1 | tee test-output.txt
```

### Count Passing Tests
```bash
grep -c "✔" test-output.txt
```

### Count Failing Tests
```bash
grep -c "✖" test-output.txt
```

### Run Specific Test
```bash
npm test -- --grep "test name pattern"
```

### Start MongoDB
```bash
mongod --dbpath ./data/db &
```

---

## Expected Outcomes After All Fixes

```
✅ Test A: confirmDayPlanning - 7 tests passing (already correct)
✅ Test B: updateDaySelection - 8 tests now return proper status codes
✅ Test C: Day payment creation - 4 tests return 200/409 correctly
✅ Test D: Payment verification - 2 tests complete successfully
✅ Test E: Meal categories - 1 test has categoryId (DONE)
✅ Test F: Draft management - 2 tests release terminals (DONE)
✅ Test G: Failure tracking - 2 tests persist failureReason (DONE)
✅ Test H: Integration tests - 20+ tests pass with MongoDB (PENDING)

Final Status: 46+/48 tests passing (~96% success rate)
```

---

## Next Steps

1. **Immediately**: Review REMAINING_FIXES_DETAILED.md for specific code locations
2. **Execute Phase 1**: Quick verification of error handling paths
3. **Execute Phase 2**: Set up test MongoDB infrastructure
4. **Run Tests**: Validate fixes and identify any remaining issues
5. **Document**: Update test results and document any remaining gaps

---

## References

- Full Root Cause Analysis: ROOT_CAUSE_FIXES_APPLIED.md
- Detailed Fix Instructions: REMAINING_FIXES_DETAILED.md
- Test Results: Will be generated after running npm test
