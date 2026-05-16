> Status: Merge candidate. This document overlaps with newer documentation. Review `docs/DOCS_CLEANUP_RECOMMENDATIONS.md` before using it as source of truth.

# Production Deployment Readiness Checklist

This document outlines the mandatory steps and verification requirements before promoting current changes to the production environment (`basicdiet145.onrender.com`).

> [!NOTE]
> This is a **Deployment Readiness Checklist**. It serves as a guide for rollout. The backend is not considered "Production Ready" unless all gates listed below pass successfully on the target environment.

## 1. Required Environment Variables

Ensure the following variables are configured in the production environment:

| Category | Variable | Required Value / Action |
| :--- | :--- | :--- |
| **App** | `NODE_ENV` | `production` |
| **App** | `APP_TIMEZONE` | `Asia/Riyadh` |
| **Database** | `MONGO_URI` | Production Atlas URI |
| **Security** | `JWT_SECRET` | Rotate to a strong, unique secret |
| **Security** | `DASHBOARD_JWT_SECRET` | Rotate to a strong, unique secret |
| **Security** | `OTP_HASH_SECRET` | Rotate to a strong, unique secret |
| **Security** | `BETTER_AUTH_SECRET` | Rotate to a strong, unique secret |
| **Payment** | `MOYASAR_SECRET_KEY` | **Live** secret key from Moyasar Dashboard |
| **Payment** | `MOYASAR_WEBHOOK_SECRET` | **Live** webhook secret from Moyasar Dashboard |
| **Payment** | `MOYASAR_WEBHOOK_ALLOWED_IPS` | Optional: Configure if strict IP filtering is required |
| **WhatsApp** | `TWILIO_ACCOUNT_SID` | Production Twilio SID |
| **WhatsApp** | `TWILIO_AUTH_TOKEN` | Production Twilio Auth Token |
| **WhatsApp** | `TWILIO_VERIFY_SERVICE_SID` | Production Twilio Verify Service SID (`VA...`) |
| **Flags** | `OTP_TEST_MODE` | `false` |
| **Flags** | `ALLOW_TEST_AUTH` | `false` |
| **Flags** | `SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED` | `false` |
| **Flags** | `ONE_TIME_ORDER_DELIVERY_ENABLED` | `false` |

## 2. Feature Flags & Safe Defaults

The following behavior-altering flags must be correctly set:

- **`SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED`**: `false`
  - *Reason*: The new meal balance policy prohibits automatic consumption of past days by the system.
- **`ONE_TIME_ORDER_DELIVERY_ENABLED`**: `false` (Default)
  - *Action*: Set to `true` only if the courier delivery network for one-time orders is fully operational.
- **`MOYASAR_WEBHOOK_SECRET`**: Must be updated to match the active webhook in the Moyasar Dashboard to prevent `401 Unauthorized` for webhook events.

## 3. Pre-Deployment Integrity Audit

### A. Order Date Parity Audit (HARD GATE)
Standardizing on `fulfillmentDate` requires verified data parity. Production deploy of fulfillmentDate-only query behavior is **BLOCKED** unless this audit returns YES on real order data.
- **Instruction**: Run the following script against the production database (read-only):
  ```bash
  MONGO_URI="..." node scripts/audits/auditOrderDateParity.js
  ```
- **Requirement**: Must return `SAFE_TO_SWITCH_TO_FULFILLMENT_DATE_ONLY: YES`.
- **Action if NO**: Export mismatched Order IDs for manual review or apply atomic backfills as defined in `docs/audits/ORDER_DATE_QUERY_STRATEGY.md`.

### B. Index Rollout Plan
Three new background indexes must be deployed to support dashboard performance:
1. `ActivityLog`: `{ entityType: 1, createdAt: -1 }`
2. `NotificationLog`: `{ userId: 1, createdAt: -1 }`
3. `Order`: `{ fulfillmentDate: 1, paymentStatus: 1, status: 1, fulfillmentMethod: 1, updatedAt: -1 }`
- **Safety**: Verify all three have `background: true` set in the model files.
- **Monitoring**: Monitor Mongo Atlas index build progress, CPU, and IO metrics during deployment.

## 4. Operational Setup

### A. Backup & Snapshots
- **Action**: Take a full MongoDB Atlas snapshot manually before starting deployment.
- **Target Collections**: 
  - `Order`, `Payment`, `User`, `Delivery`
  - `Subscription`, `SubscriptionDay`, `SubscriptionAuditLog`
  - `ActivityLog`, `NotificationLog`

### B. Webhook Configuration
- Verify the webhook URL in Moyasar points to: `https://basicdiet145.onrender.com/api/webhooks/moyasar`.
- Ensure the webhook secret is updated in the env vars immediately.

## 5. Deployment Commands

### Phase 1: Pre-Deploy (Build/CI)
```bash
git diff --check       # Check for whitespace/marker errors
npm run lint

# Explicit Required Integration Tests:
# NOTE: You must export the following before running tests:
# export NODE_ENV=test
# export JWT_SECRET=supersecret
# export MONGO_URI=<your_test_database_uri>

node tests/orderPaymentIdempotency.test.js
node tests/oneTimeOrders.test.js
node tests/oneTimeOrderOps.test.js
node tests/webhookSecurity.test.js
node tests/subscriptionBalancePolicy.test.js
node tests/subscriptionBalanceConcurrency.test.js
node tests/subscriptionFulfillmentConcurrency.test.js
node tests/mealPlanner.integration.test.js
node tests/optionalPagination.test.js
node tests/orderQueryParity.test.js
node tests/indexDefinitions.test.js
node tests/subscriptionTimelinePerformance.test.js
node tests/opsSearchService.test.js
node tests/moyasar_retry.test.js
node tests/vatInclusivePricing.test.js
```

### Phase 2: Post-Deploy (Verify)
- **Render Service Logs**:
  - Confirm the app booted successfully.
  - Monitor logs for "Server started on port 3000".
  - Confirm no startup index build errors or connection timeouts.

- **Index Verification**:
  ```bash
  mongosh "$MONGO_URI" --eval "db.notificationlogs.getIndexes()"
  mongosh "$MONGO_URI" --eval "db.activitylogs.getIndexes()"
  mongosh "$MONGO_URI" --eval "db.orders.getIndexes()"
  ```

## 6. Post-Deployment Smoke Tests

Execute the following checks immediately after deploy:
1. **Health Verification**: `GET /api/health` (internal) or `GET /api/orders/menu` (public) to verify DB/app connectivity.
2. **OTP Login**: Verify a client can login via OTP (ensuring Twilio/WhatsApp integration).
3. **Pickup Quote**: Perform a `POST /api/orders/quote` for a pickup order to verify pricing logic.
4. **Ops Dashboard**: Load the Operations Board (Kitchen/Courier) and verify one-time orders appear correctly.
5. **Webhook Auth**: Send a test webhook from Moyasar Dashboard. 
   - **CRITICAL CAUTION**: DO NOT test webhooks against real customer orders unless intentionally using a controlled live test payment.
6. **Log Visibility**: View `ActivityLog` in the dashboard to verify rendering and check for any `paid_webhook_for_non_payable_order` flags.

## 7. Rollback Plan

- **Trigger**: Any `500 Internal Server Error` on checkout, login, or operations board lasting > 5 minutes.
- **Priority 1 (Code Rollback)**: Revert code to the previous stable commit on Render. This is the first and fastest option.
- **Priority 2 (Manual Recovery)**: If data backfills or index changes caused logic issues, use the documented backfill/recovery logic in `ORDER_DATE_QUERY_STRATEGY.md` before full restore.
- **Priority 3 (Database Snapshot Restore)**: **LAST RESORT**. Restoring a snapshot will result in data loss for any legitimate orders, payments, or registrations created between the deploy and the restore.

## 8. Monitoring & Alerts

- Monitor **NotificationLog** for `status: "failed"` counts (indicates FCM/Push issues).
- Monitor **ActivityLog** for `action: "order_webhook_late_payment"` to identify manual review tasks.
- Set up Render/Datadog alerts for HTTP 5xx response spikes.
