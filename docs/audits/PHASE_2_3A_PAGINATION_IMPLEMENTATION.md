> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Phase 2.3A: Optional Pagination Implementation Plan

## Scope

Add optional, non-breaking pagination to 7 low/medium-risk endpoints.

**Compatibility Rule**: If page/limit are NOT provided, the endpoint must return the exact same response shape and full data as today. If page/limit ARE provided, apply pagination and include meta.

**Exclusions**: No changes to dashboard board queues, delivery schedule, mobile subscription timeline, already paginated endpoints, business logic, subscription meal deduction policy, one-time order delivery gate, or order date query strategy.

## Target Endpoints

### 1. GET /api/admin/subscriptions/:id/days

- **File/Function**: `src/controllers/adminController.js:listSubscriptionDaysAdmin` (line 3789)
- **Current response shape**: `{ status: true, data: days }`
- **Optional paginated response shape**: `{ status: true, data: days, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all days with no meta (current behavior)
- **Max limit**: 365
- **Tests to add/update**:
  - Test without page/limit returns all days, no meta
  - Test with page=1, limit=10 returns paginated with meta
  - Test with page=2, limit=10 returns second page
  - Test with limit > 365 clamped to 365
  - Test invalid page/limit returns 400
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 2. GET /api/admin/subscriptions/:id/audit-log

- **File/Function**: `src/controllers/adminController.js:getSubscriptionAuditLogAdmin` (line 4159)
- **Current response shape**: `{ status: true, data: { auditLogs, activityLogs } }`
- **Optional paginated response shape**: `{ status: true, data: { auditLogs, activityLogs }, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all logs with no meta (current behavior)
- **Max limit**: 200
- **Tests to add/update**:
  - Test without page/limit returns all logs, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 200 clamped to 200
  - Test invalid page/limit returns 400
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 3. GET /api/kitchen/orders/:date

- **File/Function**: `src/controllers/orderKitchenController.js:listOrdersByDate` (line 13)
- **Current response shape**: `{ status: true, data: orders }`
- **Optional paginated response shape**: `{ status: true, data: orders, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all orders for date with no meta (current behavior)
- **Max limit**: 300
- **Tests to add/update**:
  - Test without page/limit returns all orders, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 300 clamped to 300
  - Test invalid page/limit returns 400
  - Test one-time order delivery gate still applies
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 4. GET /api/kitchen/pickups/:date

- **File/Function**: `src/controllers/kitchenController.js:listPickupsByDate` (line 273)
- **Current response shape**: `{ status: true, data: rows }`
- **Optional paginated response shape**: `{ status: true, data: rows, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all pickups for date with no meta (current behavior)
- **Max limit**: 300
- **Tests to add/update**:
  - Test without page/limit returns all pickups, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 300 clamped to 300
  - Test invalid page/limit returns 400
  - Test pickup mode filter still applies
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 5. GET /api/kitchen/today-pickup

- **File/Function**: `src/controllers/kitchenController.js:listTodayPickups` (line 304)
- **Current response shape**: `{ status: true, data: rows }` (delegates to listPickupsByDate)
- **Optional paginated response shape**: `{ status: true, data: rows, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all pickups for today with no meta (current behavior)
- **Max limit**: 300
- **Tests to add/update**:
  - Test without page/limit returns all pickups, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 300 clamped to 300
  - Test invalid page/limit returns 400
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 6. GET /api/courier/orders/today

- **File/Function**: `src/controllers/orderCourierController.js:listTodayOrders` (line 20)
- **Current response shape**: `{ status: true, data: queue }`
- **Optional paginated response shape**: `{ status: true, data: queue, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all orders for today with no meta (current behavior)
- **Max limit**: 300
- **Tests to add/update**:
  - Test without page/limit returns all orders, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 300 clamped to 300
  - Test invalid page/limit returns 400
  - Test one-time order delivery gate still applies
  - Test delivery join still works
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

### 7. GET /api/courier/deliveries/today

- **File/Function**: `src/controllers/courierController.js:listTodayDeliveries` (line 33)
- **Current response shape**: `{ status: true, data: deliveries }`
- **Optional paginated response shape**: `{ status: true, data: deliveries, meta: { page, limit, total, totalPages } }`
- **Pagination params**: `page` (optional, integer >= 1), `limit` (optional, integer >= 1)
- **Default behavior when no params**: Returns all deliveries for today with no meta (current behavior)
- **Max limit**: 300
- **Tests to add/update**:
  - Test without page/limit returns all deliveries, no meta
  - Test with page=1, limit=50 returns paginated with meta
  - Test with page=2, limit=50 returns second page
  - Test with limit > 300 clamped to 300
  - Test invalid page/limit returns 400
- **Frontend impact**: Low - optional pagination, existing frontend unchanged

## Implementation Pattern

### Helper Function

Create or reuse a helper for optional pagination:

```javascript
function resolveOptionalPagination(query = {}, maxLimit) {
  const page = query.page ? Math.max(1, parseInt(query.page, 10)) : null;
  const limit = query.limit ? Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10))) : null;
  
  // If neither provided, return null (no pagination)
  if (!page && !limit) {
    return null;
  }
  
  // If only one provided, use defaults
  const effectivePage = page || 1;
  const effectiveLimit = limit || 50;
  
  return { page: effectivePage, limit: effectiveLimit };
}
```

### Controller Pattern

```javascript
async function listEndpoint(req, res) {
  // ... existing query building ...
  
  const pagination = resolveOptionalPagination(req.query, MAX_LIMIT);
  
  if (!pagination) {
    // No pagination requested - return all (current behavior)
    const items = await Model.find(query).sort({ ... }).lean();
    return res.status(200).json({ status: true, data: items });
  }
  
  // Pagination requested - apply it
  const skip = (pagination.page - 1) * pagination.limit;
  const [items, total] = await Promise.all([
    Model.find(query).sort({ ... }).skip(skip).limit(pagination.limit).lean(),
    Model.countDocuments(query)
  ]);
  
  return res.status(200).json({
    status: true,
    data: items,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit)
    }
  });
}
```

## Implementation Order

1. **Create helper function** `resolveOptionalPagination` in shared utils
2. **Update admin subscription days** (simplest, single query)
3. **Update admin audit log** (two queries, need to decide if pagination applies to both)
4. **Update kitchen orders by date** (single query, has filters)
5. **Update kitchen pickups by date** (single query, has filters)
6. **Update kitchen today pickup** (delegates to pickups by date)
7. **Update courier orders today** (single query with join)
8. **Update courier deliveries today** (single query)

## Open Questions

1. **Audit log pagination**: Should pagination apply to both `auditLogs` and `activityLogs` arrays, or should they have separate pagination? Recommendation: Paginate the combined result or apply same pagination to both arrays.

2. **Max limits**: Are the proposed max limits appropriate?
   - Subscription days: 365
   - Audit log: 200
   - Date-scoped endpoints: 300

3. **Helper location**: Should `resolveOptionalPagination` be added to existing admin controller helpers or a new shared utility?

4. **Test coverage**: Should we add integration tests with large datasets to verify pagination performance?
