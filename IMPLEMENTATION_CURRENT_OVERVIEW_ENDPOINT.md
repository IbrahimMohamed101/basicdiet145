# GET /api/subscriptions/current/overview Implementation

## Overview
Successfully implemented the `GET /api/subscriptions/current/overview` endpoint for the mobile app. This endpoint resolves the current (most recent "active" or "pending_payment") subscription for the authenticated user and returns its full overview.

---

## Implementation Details

### 1. Route Definition

**Location:** [src/routes/subscriptions.js](src/routes/subscriptions.js#L19)

```javascript
router.get("/current/overview", asyncHandler(controller.getCurrentSubscriptionOverview));
```

**Placement:** Added after authenticated routes but BEFORE dynamic `:id` routes to prevent Express from matching `/current/overview` as `/:id`.

```javascript
router.use(authMiddleware);

router.get("/", asyncHandler(controller.listCurrentUserSubscriptions));
router.get("/payment-methods", asyncHandler(controller.getSubscriptionPaymentMethods));
router.get("/current/overview", asyncHandler(controller.getCurrentSubscriptionOverview));  // ← HERE
router.post("/quote", asyncHandler(controller.quoteSubscription));
// ... dynamic :id routes follow below
```

---

### 2. Controller Implementation

**Location:** [src/controllers/subscriptionController.js](src/controllers/subscriptionController.js#L3464-L3502)

```javascript
async function getCurrentSubscriptionOverview(req, res) {
  const userId = req.userId;
  const lang = getRequestLang(req);

  try {
    // Find active or pending_payment subscription, most recent first
    const sub = await Subscription.findOne(
      {
        userId,
        status: { $in: ["active", "pending_payment"] },
      },
      null,
      { sort: { createdAt: -1 } }
    ).lean();

    if (!sub) {
      return res.status(200).json({
        ok: true,
        data: null,
      });
    }

    return res.status(200).json({
      ok: true,
      data: await serializeSubscriptionForClient(sub, lang),
    });
  } catch (err) {
    logger.error("subscriptionController.getCurrentSubscriptionOverview failed", {
      error: err.message,
      stack: err.stack,
      userId: userId ? String(userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to retrieve current subscription");
  }
}
```

**Export Added:** Added `getCurrentSubscriptionOverview` to module.exports.

---

### 3. Key Implementation Characteristics

#### Behavior
| Scenario | Response | Status Code |
|----------|----------|------------|
| Active subscription found | Full subscription overview | 200 |
| Pending_payment subscription found | Full subscription overview | 200 |
| Multiple subscriptions (mixed status) | Most recent active/pending_payment | 200 |
| No active/pending subscription | `{ ok: true, data: null }` | 200 |
| Unexpected error | `errorResponse` | 500 |

#### Current Subscription Logic
- **Query Filter:** `status: { $in: ["active", "pending_payment"] }`
- **Sort:** `createdAt: -1` (most recent first)
- **Limit:** Implicit 1 (findOne returns first match)
- **Lean:** Yes, uses `.lean()` for read-only performance

#### Reused Service
- Uses existing `serializeSubscriptionForClient(subscription, lang)` from the same controller
- No code duplication; same subscription serialization as `GET /api/subscriptions/:id`
- Ensures consistency in data shape and localization

#### Response Contract
```json
{
  "ok": true,
  "data": { ...subscription overview } | null
}
```

---

### 4. Performance Optimization

**Index Utilization:** The query leverages existing MongoDB index:

```javascript
SubscriptionSchema.index({ userId: 1, status: 1 });
```

This provides optimal query performance:
- Indexed lookup on `userId` + `status`
- Sorting by `createdAt` is in-memory after indexed fetch (small result set)
- `.lean()` returns plain objects (no Mongoose overhead)

---

### 5. Error Handling

**Authentication:** Handled by middleware; any unauthenticated request is rejected before reaching this controller.

**No Subscription:** Returns 200 with `data: null` (not 404) - **intentional design**:
- Mobile app expects this endpoint to always return 200
- `data: null` signals user has no current subscription
- Simpler client logic vs handling both 200 and 404

**Unexpected Errors:** Standard `errorResponse` (500 status, "INTERNAL" code) with proper logging.

---

### 6. Test Coverage

**Test File:** [test/getCurrentSubscriptionOverview.test.js](test/getCurrentSubscriptionOverview.test.js)

**Test Cases:** 7 comprehensive tests

✅ All tests passing

```
# tests 7
# pass 7
# fail 0
```

#### Test Scenarios
1. **Active subscription returns overview** - Validates happy path with active subscription
2. **Pending_payment subscription returns overview** - Validates pending payment status included
3. **No subscription returns null** - Validates null response when no current subscription exists
4. **Multiple subscriptions returns most recent** - Validates sort/limit logic works correctly
5. **Skips canceled/expired subscriptions** - Validates query filters out invalid statuses
6. **Response structure conforms to standard envelope** - Validates `{ ok, data }` shape
7. **Requires authentication** - Validates userId is passed to query

---

### 7. Consistency & Standards

✅ **Response Envelope:** Uses `{ ok: true, data: ... }` (not `status`)
✅ **Reused Serialization:** Same `serializeSubscriptionForClient()` as `:id/overview`
✅ **Language Support:** Respects `Accept-Language` header via `getRequestLang(req)`
✅ **Logging:** Proper error logging with context
✅ **Route Ordering:** Placed before dynamic `:id` to prevent conflicts

---

## Usage Examples

### cURL
```bash
# Get current subscription overview
curl -X GET http://localhost:3000/api/subscriptions/current/overview \
  -H "Authorization: Bearer <token>"

# Response: Active subscription
{
  "ok": true,
  "data": {
    "_id": "65f123abc...",
    "userId": "65f456def...",
    "status": "active",
    "planName": { "en": "Gold Plan", "ar": "الخطة الذهبية" },
    "selectedMealsPerDay": 3,
    "totalMeals": 15,
    "remainingMeals": 8,
    "startDate": "2026-03-19T21:00:00.000Z",
    "validityEndDate": "2026-04-15T21:00:00.000Z",
    "deliveryMode": "delivery",
    "deliveryWindow": "8 AM - 11 AM",
    ...
  }
}

# Response: No current subscription
{
  "ok": true,
  "data": null
}
```

### JavaScript SDK
```javascript
// React Native / Expo
const response = await fetch('/api/subscriptions/current/overview', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept-Language': 'ar',
  },
});

const result = await response.json();
if (result.data) {
  // Has current subscription
  console.log(`Current plan: ${result.data.planName.ar}`);
} else {
  // No current subscription
  console.log('User needs to select a plan');
}
```

---

## Files Modified

1. **[src/controllers/subscriptionController.js](src/controllers/subscriptionController.js)**
   - Added `getCurrentSubscriptionOverview()` method
   - Updated module.exports

2. **[src/routes/subscriptions.js](src/routes/subscriptions.js)**
   - Added route: `GET /current/overview`

3. **[test/getCurrentSubscriptionOverview.test.js](test/getCurrentSubscriptionOverview.test.js)** (new)
   - 7 comprehensive test cases
   - All passing ✅

---

## Verification Checklist

- ✅ Endpoint resolves current subscription correctly
- ✅ Uses req.userId from auth middleware
- ✅ Filters by status ["active", "pending_payment"]
- ✅ Returns null gracefully when no subscription exists
- ✅ Returns 200 (not 404) for no subscription case
- ✅ Reuses serializeSubscriptionForClient (no duplicated logic)
- ✅ Uses indexed MongoDB query for performance
- ✅ Proper error handling and logging
- ✅ Response follows standard envelope { ok: true, data }
- ✅ Route placed correctly before dynamic :id routes
- ✅ Comprehensive test coverage (7 tests, all passing)
- ✅ No conflicts with existing endpoints
- ✅ Consistent with existing architecture

---

## Notes

- The endpoint is **additive only** - no existing endpoints were modified
- The endpoint **does NOT** change the response contract of any existing endpoint
- The implementation is **minimal and focused** - only what's needed for the mobile app
- All existing functionality remains **unchanged and unaffected**
