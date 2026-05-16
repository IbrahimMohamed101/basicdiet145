> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Dashboard Pagination Plan

## Executive Summary

This document inventories all potentially unbounded list endpoints in the basicdiet145 backend and provides recommendations for pagination implementation. The audit reveals:

- **Already paginated**: 8 endpoints (mobile orders, dashboard orders, admin lists, logs)
- **Unpaginated operational queues**: 6 endpoints (kitchen/courier/pickup queues, delivery schedule)
- **Unpaginated date-scoped lists**: 4 endpoints (daily orders, pickups, deliveries, subscription days)
- **Unpaginated timeline**: 1 endpoint (subscription timeline - requires Flutter coordination)

**Key findings**:
- Dashboard admin endpoints already have robust pagination with meta in response
- Operational queue endpoints return full arrays for real-time workflow - pagination would break UX without frontend coordination
- Date-scoped endpoints are naturally bounded by date but could grow large for busy days
- Mobile subscription timeline is Flutter-dependent and should not be changed without coordination

## Endpoint Inventory

### 1. GET /api/orders (Mobile Client Orders)

- **Endpoint**: `GET /api/orders`
- **File/Function**: `src/controllers/orderController.js:listOrders` (line 1330)
- **Current query**: `Order.find({ userId: req.userId })` with status, paymentStatus, date range filters
- **Current response shape**: `{ status: true, data: items, meta: { page, limit, total } }`
- **Current pagination support**: YES - page/limit with max 50, default 10
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking pagination option**: N/A
- **Recommended default limit**: 10 (current)
- **Recommended max limit**: 50 (current)
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 2. GET /api/dashboard-orders (Dashboard Order List)

- **Endpoint**: `GET /api/dashboard-orders`
- **File/Function**: `src/controllers/dashboard/orderDashboardController.js:listOrders` (line 19)
- **Current query**: `orderDashboardService.listDashboardOrders` with role-based visibility filters
- **Current response shape**: `{ status: true, data }` (data includes pagination meta from service)
- **Current pagination support**: YES - page/limit with MAX_LIMIT 100
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking pagination option**: N/A
- **Recommended default limit**: 20
- **Recommended max limit**: 100 (current)
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 3. GET /api/kitchen/operations/list (Kitchen Operations List)

- **Endpoint**: `GET /api/kitchen/operations/list`
- **File/Function**: `src/controllers/kitchenOperationsController.js:getList` (line 19)
- **Current query**: `listKitchenOperations` with date, tab, mode, status, search filters
- **Current response shape**: `{ status: true, data: { date, tab, rows, pagination, appliedFilters } }`
- **Current pagination support**: YES - page/limit with max 100, default 20
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking pagination option**: N/A
- **Recommended default limit**: 20 (current)
- **Recommended max limit**: 100 (current)
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 4. GET /api/dashboard-boards/kitchen/queue (Kitchen Queue)

- **Endpoint**: `GET /api/dashboard-boards/kitchen/queue`
- **File/Function**: `src/controllers/dashboard/opsBoardController.js:queue` (line 273)
- **Current query**: `SubscriptionDay.find({ date, status: { $in: statuses } })` + `Order.find({ fulfillmentDate: date })`
- **Current response shape**: `{ status: true, data: { date, items, filters } }`
- **Current pagination support**: NO - returns full array
- **Frontend likely depends on full array**: YES - real-time operational board
- **Non-breaking pagination option**: Add optional pagination with default limit high enough for typical day (e.g., 200), frontend can opt-in
- **Breaking pagination option**: Enforce pagination - would break operational workflow
- **Recommended default limit**: 200 (if adding optional pagination)
- **Recommended max limit**: 500
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped data)
- **Required tests**: Verify frontend handles pagination meta, test with large datasets
- **Frontend impact**: HIGH - requires frontend coordination to handle pagination UI for operational boards

### 5. GET /api/dashboard-boards/courier/queue (Courier Queue)

- **Endpoint**: `GET /api/dashboard-boards/courier/queue`
- **File/Function**: `src/controllers/dashboard/opsBoardController.js:queue` (line 273) - same function with screen="courier"
- **Current query**: Same as kitchen queue with courier-specific status filters
- **Current response shape**: `{ status: true, data: { date, items, filters } }`
- **Current pagination support**: NO - returns full array
- **Frontend likely depends on full array**: YES - real-time operational board
- **Non-breaking pagination option**: Add optional pagination with default limit high enough for typical day (e.g., 200), frontend can opt-in
- **Breaking pagination option**: Enforce pagination - would break operational workflow
- **Recommended default limit**: 200 (if adding optional pagination)
- **Recommended max limit**: 500
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped data)
- **Required tests**: Verify frontend handles pagination meta, test with large datasets
- **Frontend impact**: HIGH - requires frontend coordination to handle pagination UI for operational boards

### 6. GET /api/dashboard-boards/pickup/queue (Pickup Queue)

- **Endpoint**: `GET /api/dashboard-boards/pickup/queue`
- **File/Function**: `src/controllers/dashboard/opsBoardController.js:queue` (line 273) - same function with screen="pickup"
- **Current query**: Same as kitchen queue with pickup-specific status filters
- **Current response shape**: `{ status: true, data: { date, items, filters } }`
- **Current pagination support**: NO - returns full array
- **Frontend likely depends on full array**: YES - real-time operational board
- **Non-breaking pagination option**: Add optional pagination with default limit high enough for typical day (e.g., 200), frontend can opt-in
- **Breaking pagination option**: Enforce pagination - would break operational workflow
- **Recommended default limit**: 200 (if adding optional pagination)
- **Recommended max limit**: 500
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped data)
- **Required tests**: Verify frontend handles pagination meta, test with large datasets
- **Frontend impact**: HIGH - requires frontend coordination to handle pagination UI for operational boards

### 7. GET /api/dashboard-boards/delivery-schedule (Delivery Schedule)

- **Endpoint**: `GET /api/dashboard-boards/delivery-schedule`
- **File/Function**: `src/controllers/dashboard/opsBoardController.js:deliverySchedule` (line 374)
- **Current query**: Same as courier queue with additional grouping by window/zone
- **Current response shape**: `{ status: true, data: { date, summary, groupedByWindow, groupedByZone, items, filters } }`
- **Current pagination support**: NO - returns full array
- **Frontend likely depends on full array**: YES - operational planning view
- **Non-breaking pagination option**: Add optional pagination with default limit high enough for typical day (e.g., 200), frontend can opt-in
- **Breaking pagination option**: Enforce pagination - would break operational workflow
- **Recommended default limit**: 200 (if adding optional pagination)
- **Recommended max limit**: 500
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped data)
- **Required tests**: Verify frontend handles pagination meta, test grouping with paginated data
- **Frontend impact**: HIGH - requires frontend coordination to handle pagination UI for operational boards

### 8. GET /api/admin/users (Admin App Users)

- **Endpoint**: `GET /api/admin/users`
- **File/Function**: `src/controllers/adminController.js:listAppUsers` (line 3379)
- **Current query**: `User.find({ role: "client" })` with pagination
- **Current response shape**: `{ status: true, data: users, meta: { page, limit, total } }`
- **Current pagination support**: YES - page/limit via resolvePaginationOrRespond
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking pagination option**: N/A
- **Recommended default limit**: 20
- **Recommended max limit**: 100
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 9. GET /api/admin/subscriptions (Admin Subscriptions)

- **Endpoint**: `GET /api/admin/subscriptions`
- **File/Function**: `src/controllers/adminController.js:listSubscriptionsAdmin` (line 3506)
- **Current query**: `SubscriptionOperationsReadService.performAdminSubscriptionsSearch`
- **Current response shape**: `{ status: true, data: payload.data, meta: buildPaginationMeta(...), filters }`
- **Current pagination support**: YES - page/limit via service
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking option**: N/A
- **Recommended default limit**: 20
- **Recommended max limit**: 100
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 10. GET /api/admin/orders (Admin Orders)

- **Endpoint**: `GET /api/admin/orders`
- **File/Function**: `src/controllers/adminController.js:listOrdersAdmin` (line 4410)
- **Current query**: `Order.find()` with pagination
- **Current response shape**: `{ status: true, data: orders, meta: buildPaginationMeta(...) }`
- **Current pagination support**: YES - page/limit via resolvePaginationOrRespond
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking option**: N/A
- **Recommended default limit**: 20
- **Recommended max limit**: 100
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 11. GET /api/subscriptions/:id/timeline (Subscription Timeline - Mobile)

- **Endpoint**: `GET /api/subscriptions/:id/timeline`
- **File/Function**: `src/controllers/subscriptionController.js:getSubscriptionTimeline` (line 1710)
- **Current query**: `buildSubscriptionTimeline(id, { lang })` - fetches all subscription days
- **Current response shape**: `{ status: true, data: localizeTimelineReadPayload(timeline, lang) }`
- **Current pagination support**: NO - returns full timeline
- **Frontend likely depends on full array**: YES - Flutter mobile app
- **Non-breaking pagination option**: Add optional pagination with high default limit (e.g., 90 days), requires Flutter coordination
- **Breaking pagination option**: Enforce pagination - REQUIRES FLUTTER COORDINATION
- **Recommended default limit**: 90 days (if adding optional pagination)
- **Recommended max limit**: 365 days
- **Page/limit vs cursor recommendation**: cursor-based (date-based cursor for timeline)
- **Required tests**: Flutter integration tests, verify timeline continuity across pages
- **Frontend impact**: CRITICAL - requires Flutter team coordination, mobile app changes

### 12. GET /api/admin/subscriptions/:id/days (Admin Subscription Days)

- **Endpoint**: `GET /api/admin/subscriptions/:id/days`
- **File/Function**: `src/controllers/adminController.js:listSubscriptionDaysAdmin` (line 3789)
- **Current query**: `SubscriptionDay.find({ subscriptionId: id }).sort({ date: 1 })`
- **Current response shape**: `{ status: true, data: days }`
- **Current pagination support**: NO - returns all days for subscription
- **Frontend likely depends on full array**: LIKELY - admin detail view
- **Non-breaking pagination option**: Add optional pagination with default limit 50, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break admin detail view
- **Recommended default limit**: 50 (if adding optional pagination)
- **Recommended max limit**: 365
- **Page/limit vs cursor recommendation**: page/limit (simpler for subscription-scope)
- **Required tests**: Verify admin detail view handles pagination
- **Frontend impact**: MEDIUM - admin dashboard may need pagination UI

### 13. GET /api/kitchen/days/:date (Kitchen Daily Orders)

- **Endpoint**: `GET /api/kitchen/days/:date`
- **File/Function**: `src/controllers/kitchenController.js:listDailyOrders` (line 187)
- **Current query**: `SubscriptionDay.find({ date })` with populate
- **Current response shape**: `{ status: true, data: enrichedDays }`
- **Current pagination support**: NO - returns all days for date
- **Frontend likely depends on full array**: LIKELY - daily operations view
- **Non-breaking pagination option**: Add optional pagination with default limit 200, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break daily operations view
- **Recommended default limit**: 200 (if adding optional pagination)
- **Recommended max limit**: 500
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped)
- **Required tests**: Verify kitchen operations view handles pagination
- **Frontend impact**: MEDIUM - kitchen operations view may need pagination UI

### 14. GET /api/kitchen/pickups/:date (Kitchen Pickups by Date)

- **Endpoint**: `GET /api/kitchen/pickups/:date`
- **File/Function**: `src/controllers/kitchenController.js:listPickupsByDate` (line 273)
- **Current query**: `SubscriptionDay.find({ date, status: { $in: [...] } })` filtered for pickup mode
- **Current response shape**: `{ status: true, data: rows }`
- **Current pagination support**: NO - returns all pickups for date
- **Frontend likely depends on full array**: LIKELY - pickup operations view
- **Non-breaking pagination option**: Add optional pagination with default limit 100, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break pickup operations view
- **Recommended default limit**: 100 (if adding optional pagination)
- **Recommended max limit**: 300
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped)
- **Required tests**: Verify pickup operations view handles pagination
- **Frontend impact**: MEDIUM - pickup operations view may need pagination UI

### 15. GET /api/kitchen/today-pickup (Kitchen Today Pickups)

- **Endpoint**: `GET /api/kitchen/today-pickup`
- **File/Function**: `src/controllers/kitchenController.js:listTodayPickups` (line 304)
- **Current query**: Alias for listPickupsByDate with today's date
- **Current response shape**: Same as listPickupsByDate
- **Current pagination support**: NO - inherits from listPickupsByDate
- **Frontend likely depends on full array**: LIKELY - pickup operations view
- **Non-breaking pagination option**: Same as listPickupsByDate
- **Breaking pagination option**: Same as listPickupsByDate
- **Recommended default limit**: 100 (if adding optional pagination)
- **Recommended max limit**: 300
- **Page/limit vs cursor recommendation**: page/limit
- **Required tests**: Same as listPickupsByDate
- **Frontend impact**: MEDIUM - same as listPickupsByDate

### 16. GET /api/courier/deliveries/today (Courier Today Deliveries)

- **Endpoint**: `GET /api/courier/deliveries/today`
- **File/Function**: `src/controllers/courierController.js:listTodayDeliveries` (line 33)
- **Current query**: `Delivery.find({ dayId: { $in: dayIds } })` for today's subscription days
- **Current response shape**: `{ status: true, data: deliveries }`
- **Current pagination support**: NO - returns all deliveries for today
- **Frontend likely depends on full array**: LIKELY - courier operations view
- **Non-breaking pagination option**: Add optional pagination with default limit 100, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break courier operations view
- **Recommended default limit**: 100 (if adding optional pagination)
- **Recommended max limit**: 300
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped)
- **Required tests**: Verify courier operations view handles pagination
- **Frontend impact**: MEDIUM - courier operations view may need pagination UI

### 17. GET /api/courier/orders/today (Courier Today Orders)

- **Endpoint**: `GET /api/courier/orders/today`
- **File/Function**: `src/controllers/orderCourierController.js:listTodayOrders` (line 20)
- **Current query**: `Order.find({ fulfillmentDate: today, fulfillmentMethod: "delivery", ... })` with delivery join
- **Current response shape**: `{ status: true, data: queue }`
- **Current pagination support**: NO - returns all orders for today
- **Frontend likely depends on full array**: LIKELY - courier operations view
- **Non-breaking pagination option**: Add optional pagination with default limit 100, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break courier operations view
- **Recommended default limit**: 100 (if adding optional pagination)
- **Recommended max limit**: 300
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped)
- **Required tests**: Verify courier operations view handles pagination
- **Frontend impact**: MEDIUM - courier operations view may need pagination UI

### 18. GET /api/kitchen/orders/:date (Kitchen Orders by Date)

- **Endpoint**: `GET /api/kitchen/orders/:date`
- **File/Function**: `src/controllers/orderKitchenController.js:listOrdersByDate` (line 13)
- **Current query**: `Order.find({ fulfillmentDate: date, paymentStatus: "paid", status: { $in: [...] } })`
- **Current response shape**: `{ status: true, data: orders }`
- **Current pagination support**: NO - returns all orders for date
- **Frontend likely depends on full array**: LIKELY - kitchen operations view
- **Non-breaking pagination option**: Add optional pagination with default limit 100, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break kitchen operations view
- **Recommended default limit**: 100 (if adding optional pagination)
- **Recommended max limit**: 300
- **Page/limit vs cursor recommendation**: page/limit (simpler for date-scoped)
- **Required tests**: Verify kitchen operations view handles pagination
- **Frontend impact**: MEDIUM - kitchen operations view may need pagination UI

### 19. GET /api/admin/dashboard-users (Admin Dashboard Users)

- **Endpoint**: `GET /api/admin/dashboard-users`
- **File/Function**: `src/controllers/adminController.js:listDashboardUsers` (line 3356)
- **Current query**: `DashboardUser.find()` with pagination
- **Current response shape**: `{ status: true, data: users, meta: buildPaginationMeta(...) }`
- **Current pagination support**: YES - page/limit via resolvePaginationOrRespond
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking option**: N/A
- **Recommended default limit**: 20
- **Recommended max limit**: 100
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 20. GET /api/admin/logs (Activity Logs)

- **Endpoint**: `GET /api/admin/logs`
- **File/Function**: `src/controllers/adminController.js:listActivityLogs` (line 5080)
- **Current query**: `ActivityLog.find(query)` with filters
- **Current response shape**: `{ status: true, data: logs, meta: buildPaginationMeta(...) }`
- **Current pagination support**: YES - page/limit via resolvePaginationOrRespond
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking option**: N/A
- **Recommended default limit**: 50
- **Recommended max limit**: 200
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 21. GET /api/admin/notification-logs (Notification Logs)

- **Endpoint**: `GET /api/admin/notification-logs`
- **File/Function**: `src/controllers/adminController.js:listNotificationLogs` (line 5142)
- **Current query**: `NotificationLog.find(query)` with filters
- **Current response shape**: `{ status: true, data: logs, meta: buildPaginationMeta(...) }`
- **Current pagination support**: YES - page/limit via resolvePaginationOrRespond
- **Frontend likely depends on full array**: NO - already paginated
- **Non-breaking pagination option**: Already paginated, leave alone
- **Breaking option**: N/A
- **Recommended default limit**: 50
- **Recommended max limit**: 200
- **Page/limit vs cursor recommendation**: page/limit (current)
- **Required tests**: N/A - already tested
- **Frontend impact**: None

### 22. GET /api/admin/subscriptions/:id/audit-log (Subscription Audit Log)

- **Endpoint**: `GET /api/admin/subscriptions/:id/audit-log`
- **File/Function**: `src/controllers/adminController.js:getSubscriptionAuditLogAdmin` (line 4159)
- **Current query**: `SubscriptionAuditLog.find()` + `ActivityLog.find()` for subscription and its days
- **Current response shape**: `{ status: true, data: { auditLogs, activityLogs } }`
- **Current pagination support**: NO - returns all logs for subscription
- **Frontend likely depends on full array**: LIKELY - admin audit view
- **Non-breaking pagination option**: Add optional pagination with default limit 50 per log type, frontend can opt-in
- **Breaking pagination option**: Enforce pagination - may break admin audit view
- **Recommended default limit**: 50 (if adding optional pagination)
- **Recommended max limit**: 200
- **Page/limit vs cursor recommendation**: page/limit (simpler for audit logs)
- **Required tests**: Verify admin audit view handles pagination
- **Frontend impact**: MEDIUM - admin audit view may need pagination UI

## Non-Breaking Options

### Optional Pagination Pattern

For unpaginated endpoints where frontend coordination is uncertain, implement **optional pagination**:

```javascript
// Query parameter pattern
const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10)) : null;
const limit = req.query.limit ? Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10))) : null;

// If neither provided, return all (current behavior)
if (!page && !limit) {
  const items = await Model.find(query).lean();
  return res.status(200).json({ status: true, data: items });
}

// If pagination requested, apply it
const skip = (page - 1) * limit;
const [items, total] = await Promise.all([
  Model.find(query).skip(skip).limit(limit).lean(),
  Model.countDocuments(query)
]);
return res.status(200).json({ 
  status: true, 
  data: items,
  meta: { page, limit, total }
});
```

**Benefits**:
- Frontend can opt-in by sending page/limit
- Existing frontend continues to work without changes
- Allows gradual rollout

**Endpoints suitable for optional pagination**:
- Kitchen/courier/pickup queues (operational boards)
- Delivery schedule
- Kitchen daily orders
- Kitchen pickups
- Courier deliveries/orders
- Kitchen orders by date
- Admin subscription days
- Admin subscription audit log

### High Default Limits for Date-Scoped Endpoints

For date-scoped endpoints, use high default limits when adding optional pagination:
- Kitchen/courier/pickup queues: default 200, max 500
- Daily orders/pickups/deliveries: default 100, max 300
- Subscription days: default 50, max 365

**Rationale**: Date-scoped queries are naturally bounded. A busy day might have 200-300 orders, but rarely more. High defaults ensure typical days return full results without pagination UI.

## Breaking Changes / Frontend Coordination

### High Impact - Requires Frontend Coordination

#### Operational Queues (Kitchen/Courier/Pickup)

**Endpoints**:
- `GET /api/dashboard-boards/kitchen/queue`
- `GET /api/dashboard-boards/courier/queue`
- `GET /api/dashboard-boards/pickup/queue`
- `GET /api/dashboard-boards/delivery-schedule`

**Impact**: These are real-time operational boards used by kitchen/courier staff. Enforcing pagination would:
- Break current "see all at once" workflow
- Require pagination UI in operational dashboard
- Potentially slow down operations if staff must paginate

**Recommendation**: Do NOT enforce pagination without explicit frontend coordination. Use optional pagination pattern if needed for performance.

#### Subscription Timeline (Mobile Flutter)

**Endpoint**: `GET /api/subscriptions/:id/timeline`

**Impact**: This is used by the Flutter mobile app. Changes require:
- Flutter team coordination
- Mobile app update
- Timeline UI changes to handle pagination
- Potential user experience impact

**Recommendation**: Do NOT change without explicit Flutter team coordination. If pagination is needed, use cursor-based pagination by date for smooth timeline scrolling.

### Medium Impact - May Require Frontend Updates

#### Admin Detail Views

**Endpoints**:
- `GET /api/admin/subscriptions/:id/days`
- `GET /api/admin/subscriptions/:id/audit-log`

**Impact**: Admin dashboard detail views may need pagination UI if enforced pagination is added.

**Recommendation**: Use optional pagination pattern. If enforcing pagination, coordinate with dashboard frontend team.

#### Date-Scoped Operations Views

**Endpoints**:
- `GET /api/kitchen/days/:date`
- `GET /api/kitchen/pickups/:date`
- `GET /api/courier/deliveries/today`
- `GET /api/courier/orders/today`
- `GET /api/kitchen/orders/:date`

**Impact**: Operations views may need pagination UI for busy days.

**Recommendation**: Use optional pagination pattern with high defaults (100-200). Most days will return full results without pagination UI.

## Recommended Implementation Phases

### Phase 1: No Changes (Already Paginated)

**Endpoints** (8):
- GET /api/orders (mobile)
- GET /api/dashboard-orders
- GET /api/kitchen/operations/list
- GET /api/admin/users
- GET /api/admin/subscriptions
- GET /api/admin/orders
- GET /api/admin/dashboard-users
- GET /api/admin/logs
- GET /api/admin/notification-logs

**Action**: Document current pagination behavior, no code changes needed.

### Phase 2: Optional Pagination for Date-Scoped Endpoints

**Endpoints** (6):
- GET /api/kitchen/days/:date
- GET /api/kitchen/pickups/:date
- GET /api/kitchen/today-pickup
- GET /api/courier/deliveries/today
- GET /api/courier/orders/today
- GET /api/kitchen/orders/:date

**Implementation**:
- Add optional page/limit query parameters
- Use high defaults (100-200) to avoid breaking typical workflows
- Return pagination meta only when pagination is used
- Add tests for both paginated and non-paginated modes

**Frontend coordination**: Optional - can be deployed without frontend changes.

### Phase 3: Optional Pagination for Operational Queues

**Endpoints** (4):
- GET /api/dashboard-boards/kitchen/queue
- GET /api/dashboard-boards/courier/queue
- GET /api/dashboard-boards/pickup/queue
- GET /api/dashboard-boards/delivery-schedule

**Implementation**:
- Add optional page/limit query parameters
- Use high defaults (200-500) for operational boards
- Return pagination meta only when pagination is used
- Add tests for both paginated and non-paginated modes

**Frontend coordination**: Recommended - discuss with dashboard team before deploying.

### Phase 4: Optional Pagination for Admin Detail Views

**Endpoints** (2):
- GET /api/admin/subscriptions/:id/days
- GET /api/admin/subscriptions/:id/audit-log

**Implementation**:
- Add optional page/limit query parameters
- Use moderate defaults (50) for subscription-scope data
- Return pagination meta only when pagination is used
- Add tests for both paginated and non-paginated modes

**Frontend coordination**: Recommended - discuss with dashboard team before deploying.

### Phase 5: Subscription Timeline (Requires Flutter Coordination)

**Endpoint** (1):
- GET /api/subscriptions/:id/timeline

**Implementation**:
- Coordinate with Flutter team
- Implement cursor-based pagination by date
- Use default limit of 90 days
- Add Flutter integration tests

**Frontend coordination**: REQUIRED - do not implement without Flutter team approval.

## Tests Required

### Unit Tests

For each endpoint with new pagination:
- Test without pagination parameters (returns all, no meta)
- Test with page=1, limit=10 (returns paginated with meta)
- Test with page=2, limit=10 (returns second page)
- Test with limit exceeding max (clamped to max)
- Test with invalid page/limit (400 error or ignored)
- Test pagination meta accuracy (total, page, limit)

### Integration Tests

- Test pagination with large datasets (1000+ records)
- Test pagination with filters (status, date, search)
- Test pagination with role-based visibility
- Test pagination performance (query time with skip/limit)

### Frontend Tests

- Test frontend handles pagination meta when present
- Test frontend handles missing pagination meta (backward compatibility)
- Test pagination UI interactions (next/prev page, page numbers)
- Test loading states during pagination
- Test error handling for invalid pagination requests

## Open Questions

1. **Operational Queue Pagination**: Should operational queues (kitchen/courier/pickup) have pagination at all? Real-time workflow may be disrupted by pagination. Consider:
   - Current daily order volumes
   - Performance impact of returning 200-500 items
   - Staff feedback on current UX

2. **Subscription Timeline Pagination**: Is pagination needed for subscription timeline? Consider:
   - Typical subscription length (30 days vs 365 days)
   - Flutter team capacity for pagination implementation
   - Mobile UX for paginated timelines

3. **Default Limits**: Are the recommended default limits appropriate?
   - Operational queues: 200-500
   - Date-scoped endpoints: 100-300
   - Subscription-scope: 50-365

4. **Cursor vs Page/Limit**: Should any endpoints use cursor-based pagination?
   - Timeline: cursor by date makes sense
   - Real-time queues: page/limit is simpler
   - Admin lists: page/limit is standard

5. **Frontend Timeline**: What is the frontend team's capacity for pagination UI updates?
   - Dashboard team availability
   - Flutter team availability
   - Deployment coordination

6. **Performance Monitoring**: Should we add performance monitoring for unpaginated endpoints?
   - Track response times for large datasets
   - Alert when response times exceed thresholds
   - Use data to drive pagination decisions

## Appendix: Current Pagination Helpers

### resolvePaginationOrRespond

Located in `src/controllers/adminController.js`, used by admin endpoints:

```javascript
function resolvePaginationOrRespond(res, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit };
}
```

**Usage**: Admin endpoints use this helper for consistent pagination.

### buildPaginationMeta

Located in `src/controllers/adminController.js`, builds pagination response meta:

```javascript
function buildPaginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
```

**Usage**: Admin endpoints return this in response meta field.

### Recommendation

Reuse these helpers for consistency when adding pagination to new endpoints.
