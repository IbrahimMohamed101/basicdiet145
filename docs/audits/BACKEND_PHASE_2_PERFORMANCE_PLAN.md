> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Backend Phase 2 Performance Plan

## Executive Summary
This document serves as the formal Phase 2A performance audit for the backend system. The core objective is to ensure that all high-traffic endpoints and database operations are prepared for a **10,000+ user load**.

## Phase 2.1: Safe Optimized Readiness (IMPLEMENTED)

### 🚀 Indexes Added
- **User**: `{ role: 1, createdAt: -1 }` (Categorical search for admin user list).
- **SubscriptionDay**: `{ date: 1, status: 1, updatedAt: -1 }` (Operational dashboard boards & queues).
  - *Note*: Added with `{ background: true }`. Production builds should still be monitored during build phase.

### 🛠️ N+1 Fixes
- **File**: `src/services/subscription/subscriptionTimelineService.js`
- **Details**: Bulk-fetch `BuilderProtein` records in `premiumBalanceBreakdown` using a single query (`$in: proteinIds`) before the mapping loop.

### 🛡️ Search Hardening
- **`opsSearchService.js`**:
  - Direct ObjectId lookup when query or reference suffix is a valid ID.
  - Added `.limit(50)` to `Subscription` sub-queries.
  - Added `.limit(10)` to `Order` search sub-queries.
  - Standardized `minQueryLength: 3` with exception for valid `ObjectId`s.

---

## Deferred Items (Phase 2.2+)

- **Order Indexes**: `Order.createdAt` and combined operational date indexes (Pending query strategy confirmation).
- **Pagination**: Dashboard endpoints (`/ops/list`, `/orders`) remain unbounded (Requires Frontend coordination).
- **Mobile Timeline Windowing**: Returning all days instead of a rolling window (Requires Mobile alignment).
- **Retention/TTL**: `ActivityLog` growth risk (Pending business approval for retention window).
- **Load Benchmarks**: Heavy seeding and performance validation scripts.

## Phase 2.1 Verification (STAGING/MANUAL)
- **Verification Status**: ✅ Implemented and verified.
- **Results**:
  - `tests/subscriptionTimelinePerformance.test.js`: Passed
  - `tests/opsSearchService.test.js`: Passed
  - `tests/indexDefinitions.test.js`: Passed
  - `git diff --check`: Passed

> [!IMPORTANT]
> Phase 2.1 changes are verified, but overall production readiness remains **NOT READY** until dashboard pagination, Order date indexing strategy, ActivityLog retention strategy, and load benchmarking are completed.

## Manual Verification Commands
```bash
# Verify Performance Fixes & Search Hardening
NODE_ENV=test MONGO_URI="mongodb+srv://hemaatar:011461519790@cluster0.w8vukgr.mongodb.net/basicdiet145_test?retryWrites=true&w=majority&appName=Cluster0" node tests/subscriptionTimelinePerformance.test.js
NODE_ENV=test MONGO_URI="mongodb+srv://hemaatar:011461519790@cluster0.w8vukgr.mongodb.net/basicdiet145_test?retryWrites=true&w=majority&appName=Cluster0" node tests/opsSearchService.test.js
node tests/indexDefinitions.test.js

# Verify Production-like Index Deployment
# (Note: background:true is used but monitor DB load during migration)
```
