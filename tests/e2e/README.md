# E2E Integration Tests

End-to-end integration tests that exercise the real HTTP API without mocks.

## Prerequisites

- MongoDB running (configured via `MONGO_URI` or `MONGO_URI_TEST` in `.env`)
- Express app must be compilable (no need to start server separately; supertest handles it)
- Node.js 14+

## Tests

### addon_checkout_terminal_test.js

**Purpose:** Verify that addon credits are correctly consumed during checkout when the customer has sufficient remaining balance.

**Flow:**
1. Creates a brand-new test customer and subscription
2. Seeds addon balance (juice: 20 remaining)
3. Calls `POST /api/subscriptions/:id/days/:date/selection/validate` with 8 juice addon requests
4. Verifies that all 8 are marked as `source: "subscription"` (not pending payment)
5. Calls `PUT /api/subscriptions/:id/days/:date/selection` to save
6. Verifies HTTP 200 (not 402)
7. Calls `GET /api/subscriptions/current/overview` and verifies remaining = 12
8. Calls `GET /api/subscriptions/:id` and verifies the same balance
9. Prints a detailed test report
10. Cleans up test data (unless `KEEP_TEST_DATA=true`)

**Run:**
```bash
# Use production DB (MONGO_URI)
node tests/e2e/addon_checkout_terminal_test.js

# Use test DB (MONGO_URI_TEST)
MONGO_URI_TEST=mongodb+srv://... node tests/e2e/addon_checkout_terminal_test.js

# Keep test data for inspection
KEEP_TEST_DATA=true node tests/e2e/addon_checkout_terminal_test.js
```

**Expected Output:**
```
✓ Created user: ...
✓ Created plan: ...
✓ Created addon category: ...
✓ Created 8 juice menu products
✓ Created protein: ...
✓ Created subscription: ...
✓ Generated JWT for user

--- POST /selection/validate ---
Status: 200
Response: { valid: true, addonSelections: [...], paymentRequirement: { ... } }

--- PUT /selection ---
Status: 200
Response: { subscription: { ... }, day: { ... } }

--- GET /current/overview ---
Status: 200
Addon Balances: { juice: { remainingUnits: 12, ... } }

--- GET /subscriptions/:id ---
Status: 200
Addon Balances: { juice: { remainingUnits: 12, ... } }

========== TEST REPORT ==========

User ID: ...
Subscription ID: ...
Date: YYYY-MM-DD
Initial Remaining: 20
Requested: 8
Included: 8
Pending: 0
Amount Due: 0
Remaining After Save: 12

✓ PASS
```

**Exit Codes:**
- `0`: All assertions passed
- `1`: Any assertion failed or error occurred

**What This Tests:**
- Real HTTP endpoints (no service mocks)
- Real Express middleware and routes
- Real MongoDB operations
- JWT authentication
- Addon balance consumption workflow
- Payment requirement calculation
- Consistency between validate, save, overview, and subscription endpoints

## Running All E2E Tests

```bash
# Use npm script (if configured in package.json)
npm run test:e2e

# Or run individually
node tests/e2e/addon_checkout_terminal_test.js
```

## Notes

- Tests use `supertest` to make HTTP calls to the Express app
- Each test creates and cleans up its own fixtures
- No data persists after test completion (unless `KEEP_TEST_DATA=true`)
- Safe to run against production DB (creates test data with predictable names/patterns)
- JWT tokens are generated using the same secret as production
