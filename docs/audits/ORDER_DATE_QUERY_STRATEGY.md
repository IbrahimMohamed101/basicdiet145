> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Order Date Query / Index Strategy

## Executive Summary
The current Order indexing strategy is fragmented, relying on a redundant `$or` pattern between `fulfillmentDate` and `deliveryDate`. While these fields are synced via `pre("validate")` middleware, the query pattern prevents MongoDB from using a single optimal compound index efficiently for operational boards and queues.

This plan proposes standardizing all operational queries on a canonical `fulfillmentDate` field and implementing a unified compound index strategy to support 10,000+ users.

## Data Parity / Backfill Safety
Before standardizing queries on `fulfillmentDate`, an audit of existing data is required to ensure no orders "disappear" from dashboard visibility.

### Parity Audit Requirements:
1. **Count-Check 1**: Orders where `deliveryDate` exists AND `fulfillmentDate` is missing/empty/null.
2. **Count-Check 2**: Orders where `fulfillmentDate` exists AND `deliveryDate` is missing/empty/null.
3. **Count-Check 3**: Orders where both exist but differ (indicates legacy manual updates or validation bypass).
4. **Audit Status**: The parity script has been run against `basicdiet145_test` (0 issues found). Production data parity has **NOT** been verified yet. This audit must be performed on production before query standardization.

### Running the Audit:
Perform a read-only assessment using the provided audit script.
```bash
# Execute the read-only parity audit
MONGO_URI="..." node scripts/audits/auditOrderDateParity.js
```
The script will output `SAFE_TO_SWITCH_TO_FULFILLMENT_DATE_ONLY: YES/NO`.

### Backfill Policy:
If parity is not 100%, a non-destructive aggregation-pipeline update must run:

```javascript
// A. Fix missing fulfillmentDate (Sync from deliveryDate)
db.orders.updateMany(
  {
    $or: [{ fulfillmentDate: { $exists: false } }, { fulfillmentDate: null }, { fulfillmentDate: "" }],
    deliveryDate: { $exists: true, $ne: null, $ne: "" }
  },
  [ { $set: { fulfillmentDate: "$deliveryDate" } } ]
)

// B. Fix missing deliveryDate (Sync from fulfillmentDate)
db.orders.updateMany(
  {
    $or: [{ deliveryDate: { $exists: false } }, { deliveryDate: null }, { deliveryDate: "" }],
    fulfillmentDate: { $exists: true, $ne: null, $ne: "" }
  },
  [ { $set: { deliveryDate: "$fulfillmentDate" } } ]
)

// C. Mismatched Dates
// WARNING: If both fields exist but differ, do NOT auto-fix. 
// Export IDs for manual review to determine which date is correct for operations.
```

## Rollout Safety
- **Dry-run**: Perform counts and export list of affected IDs before any update.
- **Pre-check**: Run against `_test` environment first.
- **Snapshot**: Ensure a database backup/snapshot exists before execution.
- **Logging**: Log all affected Order IDs and recovery counts.
- **No Destruction**: Do not delete `deliveryDate`.
- **No Side-Effects**: Do not modify `requestedDeliveryDate` or `requestedFulfillmentDate`.

## Implementation Plan

### Phase 1: Data Audit & Optional Backfill
* **Step**: Run the Data Parity Audit in Production.
* **Safety**: If risk orders > 0, execute the atomic backfill pipelines listed above.
* **Constraint**: Manual review required for any differing dates where both fields are populated.

### Phase 2: Index Deployment
Deploy the new compound index to support all primary operational queries:
**[NEW]** `Order`: `{ fulfillmentDate: 1, paymentStatus: 1, status: 1, fulfillmentMethod: 1, updatedAt: -1 }` (Background).

#### Supported Queries:
* **Kitchen Queue**: Uses `fulfillmentDate`, `paymentStatus`, `status`. (Index prefix hit).
* **Pickup Queue**: Uses `fulfillmentDate`, `paymentStatus`, `status`, `fulfillmentMethod: "pickup"`. (Full index hit).
* **Courier Queue**: Uses `fulfillmentDate`, `paymentStatus`, `status`, `fulfillmentMethod: "delivery"`. (Full index hit).
* **Delivery Schedule**: Matches Courier Queue pattern.
* **Dashboard Order List**: Matches `fulfillmentDate` lookup or range.

### Phase 3: Query Standardization
Refactor the following files to use `fulfillmentDate` only:
1. **`src/services/dashboard/opsReadService.js`**: `listOperations`
2. **`src/controllers/dashboard/opsBoardController.js`**: `queryBoardDays`
3. **`src/services/orders/orderDashboardService.js`**: `buildOrderFilter`

### Phase 4: Verification & Cleanup
* **Functional**: Verify that Ops queues show identical results before/after.
* **Regression**: Confirm one-time order delivery gate still respects `ONE_TIME_ORDER_DELIVERY_ENABLED`.
* **Legacy**: Keep `deliveryDate` and `requestedDeliveryDate` as aliases for display/backward compatibility.

## Verification Tests
* **Queue Accuracy**: `opsBoardController` finds orders by `fulfillmentDate`.
* **Parity Preservation**: Legacy orders with synced dual dates still appear in results.
* **Visibility Guard**: `pending_payment` orders remain hidden from ops queues.
* **Fulfillment Guard**: Paid pickup orders correctly appear in Pickup/Kitchen queues.

## Strategy Status
**Phase 2.2B Implemented and Verified** on `basicdiet145_test`.
- **Verification Environment**: `basicdiet145_test` with seeded clean synchronous data.
- **Test Coverage**: Result parity between legacy `$or` and new `fulfillmentDate` verified via `tests/orderQueryParity.test.js`.
- **Production Readiness**: **STILL BLOCKED**. Production rollout remains blocked until the `scripts/audits/auditOrderDateParity.js` returns `SAFE_TO_SWITCH_TO_FULFILLMENT_DATE_ONLY: YES` on live production/staging datasets.
