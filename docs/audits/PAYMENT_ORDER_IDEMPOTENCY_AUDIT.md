> Status: Historical / audit reference. Do not use this as the current frontend or API implementation source of truth. For current frontend handoff docs, see `docs/frontend-handoff/`.

# Payment and Order Idempotency Audit

## Overview
This audit inspects the one-time order payment and fulfillment flows, focusing on idempotency, race conditions between webhooks and manual verification, and protection against duplicate processing.

## Inspected Files
- [orderPaymentService.js](file:///home/hema/Projects/basicdiet145/src/services/orders/orderPaymentService.js)
- [webhookController.js](file:///home/hema/Projects/basicdiet145/src/controllers/webhookController.js)
- [orderController.js](file:///home/hema/Projects/basicdiet145/src/controllers/orderController.js)
- [Order.js](file:///home/hema/Projects/basicdiet145/src/models/Order.js)
- [Payment.js](file:///home/hema/Projects/basicdiet145/src/models/Payment.js)
- [orders.js](file:///home/hema/Projects/basicdiet145/src/routes/orders.js)
- [oneTimeOrders.test.js](file:///home/hema/Projects/basicdiet145/tests/oneTimeOrders.test.js)
- [moyasar_retry.test.js](file:///home/hema/Projects/basicdiet145/tests/moyasar_retry.test.js)
- [webhookSecurity.test.js](file:///home/hema/Projects/basicdiet145/tests/webhookSecurity.test.js)

---

## Flow Audits

### A. Customer calls verify payment while Moyasar webhook arrives at same time
**1. Current Behavior:** Both entry points call `applyPaidOrderPayment` within a MongoDB transaction. They attempt to "claim" the payment by updating `applied: false` to `applied: true` using `findOneAndUpdate`.
**2. Idempotency Protection:** Atomic bit-flip on `Payment.applied`. Only one request succeeds in the `findOneAndUpdate` call.
**3. Race Condition Risk:** Low. The claim pattern is robust.
**4. Duplicate Confirmation Possible:** No. The second request will fail the atomic claim and see `applied: true`.
**5. Duplicate ActivityLog/Payment Updates:** No. `writeOrderLogOnce` uses a existence check, and the `Payment` update is protected by the `applied: false` filter.
**6. Recommended Fix:** None needed for safety. 
**7. Tests Required:** Concurrent verify/webhook simulation test.

### B. Moyasar sends the same paid webhook twice
**1. Current Behavior:** `applyOrderWebhookInvoice` checks `payment.applied === true` before starting transaction, and the transaction uses the atomic claim pattern.
**2. Idempotency Protection:** `alreadyProcessed` check and atomic claim.
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Existing `duplicate webhook idempotent` test in `webhookSecurity.test.js` covers this.

### C. Customer calls verify payment twice
**1. Current Behavior:** `verifyOrderPayment` has an initial guard check: `if (order.status === 'confirmed' || ...) return idempotent: true`.
**2. Idempotency Protection:** Status-based guard clause.
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Integration test calling verify twice.

### D. Paid webhook arrives after order already confirmed
**1. Current Behavior:** Webhook finds payment, sees `applied: true` and `status: "paid"`, returns `alreadyProcessed: true`.
**2. Idempotency Protection:** `alreadyProcessed` pre-check.
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Sequence test: Verify first, then Webhook.

### E. Failed webhook arrives after order already confirmed
**1. Current Behavior:** `markOrderPaymentNonPaid` is called but contains a guard: `if (order.status === 'confirmed' || order.paymentStatus === 'paid') return alreadyConfirmed: true`.
**2. Idempotency Protection:** Status-based guard clause specifically for transitions to "failed" from "paid".
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Sequence test: Confirm order, then receive failed webhook.

### F. Pending invoice verify should not finalize order
**1. Current Behavior:** `verifyOrderPayment` checks `providerStatus === "paid"`. If `initiated` (pending), it returns `isFinal: false` and does not call `applyPaidOrderPayment`.
**2. Idempotency Protection:** Explicit status conditional.
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Verify a pending invoice and assert order stays `pending_payment`.

### G. Expired/cancelled unpaid order should not become paid
**1. Current Behavior:** `verifyOrderPayment` has a `NON_PAYABLE_ORDER_STATUSES` guard. However, `applyOrderWebhookInvoice` (webhook path) **DOES NOT** have this guard.
**2. Idempotency Protection:** Partial (Verify only). Webhook can revive an expired/cancelled order.
**3. Race Condition Risk:** Low, but logic inconsistency exists.
**4. Duplicate Confirmation Possible:** No.
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** Add `NON_PAYABLE` check to `applyOrderWebhookInvoice` or explicitly decide if "revival" is the intended behavior for late webhooks.
**7. Tests Required:** Webhook arriving for an `expired` order.

### H. Same idempotency key with same request returns existing pending order
**1. Current Behavior:** `orderController.js` (`createOrder` and `checkoutOrder`) checks for `existingByKey`. If `requestHash` matches and status is `pending_payment`, it returns the existing order details.
**2. Idempotency Protection:** `Order` model has a unique index on `{ userId, idempotencyKey }`.
**3. Race Condition Risk:** Low (handled by DB index).
**4. Duplicate Confirmation Possible:** N/A (Order creation phase).
**5. Duplicate ActivityLog/Payment Updates:** No.
**6. Recommended Fix:** None.
**7. Tests Required:** Create order twice with same key and body.

### I. Same idempotency key with different request returns conflict
**1. Current Behavior:** `orderController.js` checks `existingByKey.requestHash !== requestHash` and returns 409 `IDEMPOTENCY_CONFLICT`.
**2. Idempotency Protection:** Hash-based request differentiation.
**3. Race Condition Risk:** None.
**4. Duplicate Confirmation Possible:** N/A.
**5. Duplicate ActivityLog/Payment Updates:** N/A.
**6. Recommended Fix:** None.
**7. Tests Required:** Create order with same key but different body.

---

## Overall Findings and Risks

### 1. Webhook Controller Redundancy
[webhookController.js](file:///home/hema/Projects/basicdiet145/src/controllers/webhookController.js) contains a legacy block for `type === "one_time_order"` (Lines 445-484) that manually updates orders and payments. 
> [!WARNING]
> While this code is likely unreachable because `applyOrderWebhookInvoice` handles the request first (Line 122), this redundancy is a maintenance risk and could lead to split-brain behavior if the provider ID lookup logic differs.

### 2. Order Revival Inconsistency
An `EXPIRED` or `CANCELLED` order cannot be verified manually by the client, but a delayed `invoice.paid` webhook **will** successfully confirm the order and change its status back to `confirmed`. 
> [!NOTE]
> This may be desirable for "late payment" recovery but contradicts the strict "expired" status.

### 3. Missing Transaction in verifyOrderPayment Status Sync
In `verifyOrderPayment`, if a status is `initiated` but the local payment is not, it performs `await payment.save()` (Line 401) outside of a transaction.
> [!NOTE]
> This is a minor sync operation and non-destructive, but technically lacks the safety of the main paid/failed flows.

### 4. Idempotency Key Coverage
The `Payment` model has `operationIdempotencyKey` but it is currently unused in the one-time order flow. The flow relies entirely on the `Order` idempotency key and the `applied` bit on `Payment`.

---

## Recommended Minimal Fixes
1. **Unify Webhook Logic:** Remove the manual `one_time_order` block from `webhookController.js` to ensure `orderPaymentService.js` is the single source of truth.
2. **Revival Guard:** Add a guard to `applyOrderWebhookInvoice` to either prevent revival of terminal orders or explicitly log the revival.
3. **Audit Log Consistency:** Ensure `order_webhook_confirmed` and `order_payment_confirmed` actions are perfectly synchronized in their metadata.

## Tests to Add/Update
1. **Concurrency Test:** Simulate simultaneous `verify` and `webhook` calls to verify no duplicate logs/side-effects.
2. **Revival Test:** Confirm behavior when a webhook arrives for an expired order.
3. **Idempotency Conflict Test:** Explicitly test `IDEMPOTENCY_CONFLICT` for different payloads with same key.
