# Production Readiness Audit for 10K Users

## Executive Summary

Top 5 risks identified:

| # | Risk | Severity | Impact |
|---|------|----------|--------|
| 1 | Missing operationIdempotencyKey index on Payment | P0 | Double payment deduction at scale |
| 2 | User.phone unique index only - email validation gaps | P0 | Duplicate user creation possible |
| 3 | No caching on hot endpoints | P1 | Response latency spikes at 10k users |
| 4 | Missing Addon catalog indexes (kind, category) | P1 | Slow addon listing queries |
| 5 | NODE_ENV activation bypass in dev routes | P0 | Dev code in production risk |

## Severity Legend

- **P0**: Must fix before production - critical for 10k scale
- **P1**: Should fix before launch - performance/material integrity
- **P2**: Optimization - performance improvements
- **P3**: Nice-to-have - code quality

---

## Findings

### 1. Hot Endpoints Analysis

#### GET /api/subscriptions/current/overview

**Files inspected:**
- `src/services/subscription/subscriptionClientOverviewService.js` (full)
- `src/controllers/subscriptionController.js` (lines 335-400)

**DB Queries:**
1. `Subscription.findOne({ userId, status: {$in: ["active", "pending_payment"]} })` - **OK**: Uses `{userId: 1}` index
2. `serializeSubscriptionForClient` - fetches Plan, SubscriptionDays - **N+1 risk**
3. `buildSubscriptionOverviewSkipUsageSafe` - fetches Plan, compute skipPolicy - **OK**
4. `loadPremiumCatalogForOverview` - queries BuilderProtein without index hints - **Slow at 10k**
5. `getRestaurantHours` - queries Setting collection - **No index**

**Response size risk:** HIGH - Returns full subscription document plus premium balance array per day

**Recommendations:**
- Add `.select()` projection to subscription query
- Cache premium catalog with 5-min TTL
- Cache restaurant hours with 1-min TTL
- Add lean() to Plan queries

---

#### GET /api/subscriptions/meal-planner-menu

**Files inspected:**
- `src/services/subscription/mealPlannerCatalogService.js` (full)
- `src/controllers/menuController.js`

**DB Queries (per request):**
```javascript
BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1 }).lean()  // No index
BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } })      // Uses { isActive, sortOrder } index
BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } })        // No index found
SaladIngredient.find({ isActive: true })                                            // No index found
```

**N+1 risk:** LOW - Single queries per collection

**Response size risk:** MEDIUM - Returns all catalog items per request

**Recommendations:**
- Add compound index: `{ isActive: 1, sortOrder: 1, createdAt: -1 }` on each catalog model
- Cache this endpoint with 30-min TTL
- Add `.lean()` to all queries

---

#### GET /api/subscriptions/:id/days/:date

**Files inspected:**
- `src/services/subscription/subscriptionDayPlanningService.js`
- `src/routes/subscriptions.js` (line 410)

**DB Queries:**
```javascript
Subscription.findById(subscriptionId)                                    // Uses {_id} index
SubscriptionDay.findOne({ subscriptionId, date })                          // Uses {subscriptionId: 1, date: 1} UNIQUE index
BuilderProtein, BuilderCarb, Meal lookups                                 // N+1 if no lean()
```

**Recommendations:**
- Already has good indexes ✓
- Add `.lean()` to reference lookups
- Add projection for day details: `select('-customSalads -customMeals -operationAuditLog')`

---

#### PUT /api/subscriptions/:id/days/:date/selection

**Files inspected:**
- `src/services/subscription/subscriptionSelectionService.js` (lines 1-200)
- `src/services/subscription/subscriptionSelectionClientService.js`

**Race condition risk:** MEDIUM - Updates subscription.premiumBalance array inline

**Current code pattern:**
```javascript
// subscriptionSelectionService.js lines 105-150
if (sel.premiumSource === "balance") {
  const bucket = subscription.premiumBalance.find((b) => ... && b.remainingQty > 0);
  if (bucket) {
    bucket.remainingQty -= 1;  // Inline mutation - NOT atomic
  }
}
```

**Recommendations:**
- Use atomic findOneAndUpdate for premium balance decrement:
```javascript
await Subscription.findOneAndUpdate(
  { _id: subscriptionId, "premiumBalance.proteinId": proteinId, "premiumBalance.remainingQty": { $gt: 0 } },
  { $inc: { "premiumBalance.$.remainingQty": -1 } }
);
```

---

#### POST /api/subscriptions/:id/days/:date/confirm

**Files inspected:**
- `src/services/subscription/subscriptionDayPlanningService.js`
- `src/routes/subscriptions.js` (line 589)

**Race condition risk:** HIGH - No status guards on confirm

**Current pattern:**
```javascript
// confirmCanonicalDayPlanning
// No findOneAndUpdate with status filter
```

**Recommendations:**
- Add atomic guard:
```javascript
await SubscriptionDay.findOneAndUpdate(
  { _id: dayId, status: "open", plannerState: "draft" },
  { $set: { plannerState: "confirmed", "plannerMeta.confirmedAt": new Date() } }
);
```

---

#### Payment Webhook (POST /webhooks/moyasar)

**Files inspected:**
- `src/controllers/webhookController.js` (full)
- `src/services/paymentApplicationService.js`

**Current protection:**
- Uses `runMongoTransactionWithRetry` with session ✓
- Has `applied: true` check before claim ✓
- Has `providerInvoiceId` and `providerPaymentId` indexes ✓

**Missing:**
- No `operationIdempotencyKey` index on Payment model
- No idempotency on payment status update

**Recommendations:**
- Add index: `{ operationIdempotencyKey: 1 }` - **CRITICAL**
- Add idempotency check before marking applied

---

#### Pickup Prepare (POST /:id/days/:date/pickup/prepare)

**Files inspected:**
- `src/services/subscription/subscriptionPickupPreparationService.js` or `subscriptionPickupClientService.js`
- `src/routes/subscriptions.js` (line 295)

**Race condition risk:** MEDIUM - Uses findOneAndUpdate but missing status guards

**Current pattern (subscriptionPickupClientService.js line 159):**
```javascript
await SubscriptionDay.findOneAndUpdate(
  { subscriptionId, date, pickupRequested: false },
  { $set: { pickupRequested: true, pickupRequestedAt: new Date() } }
);
```

**Missing guards:**
- No status check (should check status: "open")
- No idempotency on mutation

**Recommendations:**
- Add status filter: `status: "open"`
- Add idempotency via unique constraint on (subscriptionId, date, pickupRequestedAt) compound with nullable

---

### 2. MongoDB Indexes

#### Required Indexes

| Model | Index | Exists? | Add? | Reason | Migration Note |
|-------|-------|---------|-----|--------|---------------|
| User | `{ phone: 1 }` | ✓ | No | Already unique | - |
| User | `{ email: 1 }` | Missing | **YES** | Duplicate email users possible | Add unique sparse index |
| Payment | `{ operationIdempotencyKey: 1 }` | Missing | **YES** | Idempotency for payments | Create partial with `{ $type: "string", $ne: "" }` |
| Addon | `{ kind: 1, category: 1, isActive: 1 }` | Missing | **YES** | Catalog filtering | - |
| Addon | `{ isActive: 1, sortOrder: 1 }` | Missing | **YES** | Admin list sorting | - |
| BuilderProtein | `{ isActive: 1, isPremium: 1, sortOrder: 1 }` | Missing | **YES** | Premium catalog | - |
| BuilderCarb | `{ isActive: 1, sortOrder: 1 }` | Missing | **YES** | Catalog sorting | - |
| Plan | `{ isActive: 1, sortOrder: 1 }` | Missing | **YES** | Admin list | - |
| Plan | `{ daysCount: 1, isActive: 1 }` | Missing | **YES** | Filtering | - |
| SubscriptionDays | `{ mealReminderSentAt: 1, status: 1 }` | Missing | **YES** | Batch reminder job | Partial with `{ $type: "date" }` |
| Subscription | `{ remainingMeals: 1 }` | Missing | **YES** | Quota queries | - |
| Subscription | `{ endDate: 1, status: 1 }` | Missing | **YES** | Expiry queries | - |
| PromoCode | `{ codeNormalized: 1, deletedAt: 1 }` | ✓ | Check | Already has partial unique | Verify in migration |
| BuilderCategory | `{ isActive: 1, sortOrder: 1 }` | Missing | **YES** | Catalog sort | - |
| Meal | `{ isActive: 1, sortOrder: 1 }` | Missing | **YES** | Admin list | - |
| Meal | `{ category: 1, isActive: 1 }` | Missing | **YES** | Listing | - |

### Index Migration Code

```javascript
// Add to src/models/ indexes or create migration script

// User.email
await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true });

// Payment.operationIdempotencyKey
await Payment.collection.createIndex(
  { operationIdempotencyKey: 1 },
  { name: "operationIdempotencyKey_1", sparse: true }
);

// Addon catalog indexes
await Addon.collection.createIndex(
  { kind: 1, category: 1, isActive: 1 },
  { name: "kind_1_category_1_isActive_1" }
);
await Addon.collection.createIndex(
  { isActive: 1, sortOrder: 1 },
  { name: "isActive_1_sortOrder_1" }
);

// BuilderProtein premium catalog
await BuilderProtein.collection.createIndex(
  { isActive: 1, isPremium: 1, sortOrder: 1 },
  { name: "isActive_1_isPremium_1_sortOrder_1" }
);
```

---

### 3. Race Condition Analysis

#### Risk: Double Payment Deduction

**Path:** User selects premium → payment verify → premium balance decremented

**Files:** `paymentApplicationService.js` line 166, `premiumExtraDayPaymentService.js`

**Current guard:** Uses session transaction ✓

**Missing:** `operationIdempotencyKey` on Payment

**Fix:** Add index + use idempotency key in payment metadata

---

#### Risk: Double Day Confirm

**Path:** Two concurrent confirm requests for same day

**Files:** `subscriptionDayPlanningService.js`

**Missing guard:** No status filter in update

**Current:**
```javascript
// No atomic guard, uses save() after fetch
```

**Fix:**
```javascript
const result = await SubscriptionDay.findOneAndUpdate(
  { _id: day._id, status: "open", plannerState: "draft" },
  { $set: { plannerState: "confirmed" } },
  { new: true }
);
if (!result) throw new Error("DAY_ALREADY_CONFIRMED");
```

---

#### Risk: Premium Balance Double Decrement

**Path:** Concurrent selection updates using same premium

**Files:** `subscriptionSelectionService.js` lines 136-140

**Current:** Inline array mutation, not atomic

**Fix:**
```javascript
// Replace inline decrement with atomic
const updated = await Subscription.findOneAndUpdate(
  {
    _id: subscriptionId,
    "premiumBalance.proteinId": proteinId,
    "premiumBalance.remainingQty": { $gt: 0 }
  },
  { $inc: { "premiumBalance.$.remainingQty": -1 } },
  { new: true }
);
if (!updated) throw new Error("INSUFFICIENT_BALANCE");
```

---

#### Risk: Repeat Webhook Processing

**Path:** Moyasar sends webhook twice

**Files:** `webhookController.js` lines 250-263

**Current guard:** Uses `applied: false` filter in findOneAndUpdate - OK but needs idempotency key

**Missing:** No operationIdempotencyKey index

**Fix:** Add idempotency key to payment creation, verify on webhook

---

### 4. Caching Plan

| Content | TTL | Invalidation Trigger | Stale Risk |
|---------|-----|-------------------|-----------|
| Meal planner catalog | 30 min | Admin update to proteins/carbs | Low - changes rarely |
| Premium catalog | 5 min | Admin protein update | Medium |
| Addon catalog | 30 min | Admin addon CRUD | Low |
| Restaurant hours | 1 min | Admin settings change | Low |
| Plan catalog (plans.js) | 30 min | Admin plan toggle | Low |
| Promo codes | 5 min | Admin promo CRUD | Low |
| Terms content | 60 min | Admin content save | High - add invalidation |

**Implementation:**

```javascript
// Simple in-memory cache example
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

function getCached(key, fetchFn, ttl = TTL_MS) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) return cached.value;
  const value = await fetchFn();
  cache.set(key, { value, ts: Date.now() });
  return value;
}
```

---

### 5. Large Payload Analysis

#### GET /api/subscriptions/current/overview

**Current response:** Full subscription document including:
- `premiumBalance` array (potentially large)
- `premiumSelections` array
- `addonSubscriptions` array
- Full plan document nested
- Delivery address

**Size estimate:** 5-15KB per response

**Fix:** Add projection:
```javascript
Subscription.findOne(query, {
  select: "userId planId status startDate endDate remainingMeals premiumBalance"
});
```

---

#### GET /api/subscriptions/meal-planner-menu

**Current response:** All proteins, carbs, salad ingredients per request

**Size estimate:** 50-200KB with full images/nutrition

**Fix:**
- Cache endpoint (30-min TTL)
- Add pagination if needed
- Remove unused fields

---

#### Subscription Day Details

**Risk:** Returns `customSalads`, `customMeals`, `operationAuditLog` arrays

**Fix:** Add projection:
```javascript
SubscriptionDay.findOne(query, {
  select: "-customSalads -customMeals -operationAuditLog"
});
```

---

### 6. Security Analysis

| Check | Status | Location | Issue |
|-------|--------|----------|-------|
| JWT handling | ✓ OK | `src/middleware/auth.js` | Proper secret, algorithm |
| DEV_AUTH_BYPASS | **FAIL** | `src/middleware/auth.js:6` | In non-production only but bypasses JWT |
| NODE_ENV activation bypass | **FAIL** | `src/routes/subscriptions.js:74-76` | Dev-only route but concerning |
| CORS config | ✓ OK | `src/app.js:71-86` | Uses allowedOrigins |
| Rate limiting | ✓ OK | `src/middleware/rateLimit.js` | OTP, checkout, dashboard login |
| Dashboard auth | ✓ OK | `src/middleware/dashboardAuth.js` | Token verification |
| Admin routes | ✓ OK | `src/routes/admin.js:18` | Uses dashboardAuthMiddleware |
| Webhook verification | ✓ OK | `src/controllers/webhookController.js:83` | Secret validation |
| Error responses | ⚠️ PARTIAL | Various | Some missing specific codes |

**P0 Fixes:**

1. **Disable DEV_AUTH_BYPASS in production (already conditional):**
```javascript
// Already safe: process.env.NODE_ENV !== "production" check in place
```

2. **Remove or protect subscription activation route:**
```javascript
// subscriptions.js line 74-76 - add production guard
if (process.env.NODE_ENV !== "production") {
  // Already has non-production check - OK
}
```

3. **Missing User.email index:**
```javascript
// Add to User model or migration
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
```

---

### 7. Error Handling

| Check | Status | Notes |
|-------|--------|-------|
| Invalid input returns 4xx | ✓ OK | Uses errorResponse with codes |
| Unexpected errors log stack | ✓ OK | logger.error with stack |
| Sensitive data exposure | ⚠️ PARTIAL | No generic "INTERNAL" for validation |
| Error code consistency | ✓ OK | Uses errorResponse helper |

**Issue:** Generic "INTERNAL" code used for validation errors in some places

**Fix:** Replace with specific codes like "VALIDATION_ERROR", "INVALID_DATE"

---

### 8. Logging / Observability

| Check | Status | Notes |
|-------|--------|-------|
| requestId | **MISSING** | No request ID in logs |
| userId | ⚠️ PARTIAL | Some endpoints log userId |
| subscriptionId | ⚠️ PARTIAL | Scattered logging |
| paymentId | ⚠️ PARTIAL | Payment-specific logs exist |
| Endpoint latency | **MISSING** | No timing logs |
| Slow query logging | **MISSING** | No query timing |
| Payment lifecycle | ⚠️ PARTIAL | Basic logs exist |
| Webhook logs | ✓ OK | Good detail in webhookController |

**Recommendations:**

1. Add request ID middleware:
```javascript
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  next();
});
```

2. Add structured logging:
```javascript
logger.info("endpoint_name", {
  requestId: req.requestId,
  userId: req.userId,
  subscriptionId,
  latency: Date.now() - req.startTime
});
```

3. Add slow query logging in services:
```javascript
const start = Date.now();
await Subscription.findOne(query);
logger.info("slow_query", { query: "subscription_lookup", duration: Date.now() - start });
```

---

### 9. Background Jobs

**Files inspected:** `src/jobs/index.js`

| Job | Frequency | Idempotency | Indexes | Batch Size |
|-----|-----------|------------|---------|----------|
| processDailyCutoff | Daily (once) | ⚠️ PARTIAL | subscriptionId+date | ALL - risk |
| processDueDeliveryArrivingSoon | 1 min | ✓ | deliveryStatus | ALL - risk |
| processDailyMealSelectionReminders | Daily (once) | ⚠️ PARTIAL | mealReminderSentAt | ALL - risk |
| processSubscriptionExpiryReminders | Daily (once) | ⚠️ PARTIAL | endDate | ALL - risk |
| cleanupAbandonedPromoReservations | 15 min | ✓ | createdAt | ALL - risk |

**Issues:**

1. **No batch size limits** - All queries fetch ALL documents
2. **Missing indexes for reminder queries** - `mealReminderSentAt`, `endDate`
3. **No cursor pagination** - Uses `.find()` without limit

**Fixes:**

```javascript
// Batch processing with limit
const BATCH_SIZE = 100;
const docs = await Subscription.find(query).limit(BATCH_SIZE).lean();
for (const doc of docs) {
  await processDoc(doc); // individual with error handling
}
// Use cursor for large batches
const cursor = Subscription.find(query).lean();
while (await cursor.hasNext()) {
  const doc = await cursor.next();
  // process with error handling
}
```

---

### 10. Data Integrity

| Check | Status | Issue |
|-------|--------|-------|
| premiumKey uniqueness | ✓ OK | Has unique sparse index |
| SubscriptionDay uniqueness | ✓ OK | Unique compound index |
| Addon kind/category | ⚠️ PARTIAL | No unique, duplicate kinds possible |
| businessDate timezone | ✓ OK | Using KSA timezone |
| Legacy fields | ⚠️ Present | `planningVersion`, `planningState` retained |

**Data integrity risks:**

1. **Addon duplicate kind/category** - No unique constraint on Addon
2. **Subscription remainingMeals decrement race** - Inline mutation

---

### 11. Deployment Analysis

**Files inspected:**
- `src/app.js` (express setup)
- `src/db.js` (MongoDB connection)
- `src/index.js` (server startup)

| Check | Status | Notes |
|-------|--------|-------|
| Health endpoint | ✓ OK | `/health` with DB ping |
| Graceful shutdown | **MISSING** | No signal handlers |
| Mongo pooling | ⚠️ DEFAULT | Uses mongoose defaults |
| Server timeouts | **MISSING** | No explicit timeouts |
| Body size limit | ⚠️ HARDCODED | 1MB in app.js |

**Fixes:**

1. **Add MongoDB pool config in db.js:**
```javascript
mongoose.connect(uri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
});
```

2. **Add server timeouts in index.js:**
```javascript
server.timeout = 30000;
server.keepAliveTimeout = 5000;
```

3. **Graceful shutdown:**
```javascript
process.on("SIGTERM", () => {
  server.close(() => mongoose.disconnect());
});
```

---

## Race Condition Plan

| Flow | Risk Level | Current Protection | Fix |
|------|-----------|-------------------|-----|
| Premium balance decrement | HIGH | Inline mutation | Atomic findOneAndUpdate with $gt: 0 |
| Day confirm | MEDIUM | None | Add status:"open" filter on update |
| Payment webhook | LOW | Session + app flag | Add operationIdempotencyKey |
| Pickup prepare | MEDIUM | Partial | Add status + idempotency |
| Checkout create | MEDIUM | requestHash index | Add operationIdempotencyKey |

---

## Security Checklist

| Item | Status | Fix Required |
|------|--------|------------|
| JWT secret handling | ✓ | None |
| DEV_AUTH_BYPASS in production | ✓ Safe | None - conditional |
| CORS configuration | ✓ | None |
| Rate limiting on auth | ✓ | None |
| Webhook secret validation | ✓ | Requires MOYASAR_WEBHOOK_SECRET env |
| User email unique | **FAIL** | Add email index |
| Admin auth consistency | ✓ | None |
| API error codes | ⚠️ | Add specific codes |

---

## Deployment Checklist

### Required Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| PORT | Server port | 3000 |
| MONGO_URI | MongoDB connection | mongodb://... |
| JWT_SECRET | App JWT signing | complex_string |
| DASHBOARD_JWT_SECRET | Dashboard JWT | complex_string |
| MOYASAR_WEBHOOK_SECRET | Webhook validation | webhook_secret |
| NODE_ENV | Environment | production |
| CORS_ORIGINS | Allowed origins | https://app.com,https://admin.com |
| RATE_LIMIT_OTP_WINDOW_MS | Rate limit window | 60000 |

### Health Checks

- [ ] `/health` returns 200 with DB up
- [ ] MongoDB connection state = 1
- [ ] Basic database queries working
- [ ] JWT verification functional

---

## Prioritized Fix Plan

### Phase 1: Must Fix Before Production (This Week)

| Priority | Item | Files | Fix |
|----------|------|------|-----|
| P0 | Add operationIdempotencyKey index | Payment.js | Add index def + migration |
| P0 | Add User.email unique index | User.js or migration | Add sparse unique index |
| P0 | Add Addon.kind+category+isActive index | Addon.js | Add index |
| P1 | Fix premium balance atomic decrement | subscriptionSelectionService.js | Use findOneAndUpdate |
| P1 | Add day confirm status guard | subscriptionDayPlanningService.js | Add status filter |
| P1 | Disable NODE_ENV activation anyway | subscriptions.js | Remove or protect route |

### Phase 2: Before Launch (Next Sprint)

| Priority | Item | Files | Fix |
|----------|------|------|-----|
| P1 | Add caching to hot endpoints | overview, mealPlanner | Add 30-min cache |
| P1 | Add query projections to endpoints | subscriptionController | Add select() |
| P2 | Add batch processing to jobs | jobs/index.js | Add cursor/batch |
| P2 | Add body size limit env var | app.js | Use process.env |
| P2 | Add structured request logging | app.js | Add middleware |

### Phase 3: Post-Launch Optimization

| Priority | Item | Files | Fix |
|----------|------|------|-----|
| P2 | Add request ID to all logs | All services | Add to logger calls |
| P2 | Add slow query logging | All services | Add timing logs |
| P3 | Graceful shutdown | index.js | Add signal handlers |
| P3 | MongoDB connection pool tuning | db.js | Use env config |

---

## Final Launch Checklist

Before launching to production with 10k users:

- [ ] Run index migrations for Payment, User, Addon
- [ ] Verify all indexes exist: `db.collection.getIndexes()`
- [ ] Set production environment variables
- [ ] Test webhook with MOYASAR_WEBHOOK_SECRET
- [ ] Verify rate limits are configured
- [ ] Test health endpoint
- [ ] Check job indexes for batch queries
- [ ] Verify CORS_ORIGINS is set
- [ ] Run load test on hot endpoints
- [ ] Monitor logs for slow queries

---

## Testing Recommendations

### Index Verification
```javascript
// Verify indexes exist after deployment
db.payment.getIndexes()
db.user.getIndexes()
db.subscriptionDay.getIndexes()
```

### Load Test Script
```javascript
// Example: k6 or artillery test for overview endpoint
// 100 concurrent users, 10 minutes
const overviewPromise = async (userId) => {
  const start = Date.now();
  await fetch(`/api/subscriptions/current/overview`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("latency:", Date.now() - start);
};
```

---

## Code Changes Made During This Audit

This audit performed **no code changes** to the production codebase. All recommendations are documented for future implementation.

**Files that would need changes:**

1. `src/models/User.js` - add email index
2. `src/models/Payment.js` - add operationIdempotencyKey index
3. `src/models/Addon.js` - add catalog indexes
4. `src/db.js` - add connection pool config (optional, can use env)
5. Migration script creation recommended for index deployment