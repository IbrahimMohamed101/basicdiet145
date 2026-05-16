> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Activity and Audit Log Retention/Indexing Audit

## 1. Current Log Collections and Schemas

| Collection | Model Path | Purpose | Key Fields |
| :--- | :--- | :--- | :--- |
| **ActivityLog** | `src/models/ActivityLog.js` | Generic operational events (order state changes, courier flow). | `entityType`, `entityId`, `action`, `byUserId`, `byRole`, `meta` |
| **SubscriptionAuditLog** | `src/models/SubscriptionAuditLog.js` | Business-critical subscription lifecycle audit trails. | `entityType`, `entityId`, `action`, `fromStatus`, `toStatus`, `actorType`, `actorId`, `note`, `meta` |
| **NotificationLog** | `src/models/NotificationLog.js` | History of sent push notifications. | `userId`, `type`, `dedupeKey`, `entityType`, `entityId`, `status`, `sentAt` |

## 2. Current Indexes

| Collection | Current Indexes | Effectiveness / Gaps |
| :--- | :--- | :--- |
| **ActivityLog** | `{ entityType: 1, entityId: 1, createdAt: -1 }` | **Good** for specific entity history. **Poor** for global activity feeds or date-ranged searches by role/action. |
| **SubscriptionAuditLog** | `{ entityType: 1, entityId: 1, createdAt: -1 }` | **Sufficient** for individual subscription audit views. |
| **NotificationLog** | `{ dedupeKey: 1 }` (unique, sparse) | **CRITICAL GAP**: Dashboard list views (`listNotificationLogs`) query by `userId` and `createdAt` without an index, forcing collection scans. |

## 3. Query Patterns
- **Entity Specific**: Dashboard often queries logs for a specific `subscriptionId` or `orderId` via `{ entityType, entityId }`. (Indexed).
- **User Specific**: Dashboard queries notifications for a specific `userId`. (**Unindexed**).
- **Global Feeds**: Admin dashboard "Latest Activity" queries with empty filter and `{ createdAt: -1 }` sort. (**Unindexed**).
- **Date Filtering**: Operational queries often include `from`/`to` date ranges on `createdAt`.

## 4. Retention Policy Status
> [!IMPORTANT]
> **NO TTL OR DELETION LOGIC HAS BEEN IMPLEMENTED.**
> All log archival and retention cleanup jobs are blocked pending business and legal approval.

### A. SubscriptionAuditLog (Legal/Audit)
- **Status**: Long-retention data.
- **Policy**: No TTL. No deletion.
- **Requirement**: Must be preserved indefinitely or according to statutory limitation periods in Saudi Arabia. Short-term archiving is prohibited without explicit approval.

### B. ActivityLog (Operational)
- **Status**: Operational evidence.
- **Policy**: No TTL implemented.
- **Requirement**: Although operational, these logs are required for investigating disputes, refunds, complaints, and carrier performance. Retention period must be approved by Support and Legal departments.

### C. NotificationLog (Transient/Support)
- **Status**: Delivery record.
- **Policy**: No TTL implemented.
- **Requirement**: Likely transient, but must be retained until the notification/support retention policy is formally approved.

## 5. Implementation Status (Phase 1)
The following non-destructive indexes have been implemented to stabilize dashboard performance:

| Collection | Index | Status | Rationale |
| :--- | :--- | :--- | :--- |
| **NotificationLog** | `{ userId: 1, createdAt: -1 }` | **[DONE]** | Optimized for user notification history views. |
| **ActivityLog** | `{ entityType: 1, createdAt: -1 }` | **[DONE]** | Optimized for typed operational feeds (e.g. latest subscription events). |

*Note: NotificationLog entityType/entityId index remains deferred as no active entity-history query path requires it yet.*

## 6. Blocked Retention Decisions
The following actions remain **STRICTLY BLOCKED** pending business/legal approval:
1.  **TTL Implementation**: No `expireAfterSeconds` indexes have been added.
2.  **Archival Jobs**: No scripts or jobs exist to move or delete data.
3.  **Support-Retention Approval**: Confirmation of support window for operational investigative logs is still pending.

## 7. Next Steps
1.  Verify index efficiency via MongoDB explain plans once data volume reaches threshold.
2.  Obtain legal guidance on data residency and retention requirements for Saudi Arabia.
