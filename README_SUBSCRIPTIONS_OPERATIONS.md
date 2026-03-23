# Subscriptions Operations & Tooling

This document outlines operations-ready guidelines for the canonical subscription system.

## 1. Observability
Structured logs are placed in critical invariant branches, notably when planning validation fails or a payment application does not successfully map to the intended subscription state. Search for `"Payment side effects not applied"` for debugging webhook or idempotency issues.

## 2. Payment Safeguards
If a payment arrives successfully via Webhooks but cannot be applied due to a synchronization mismatch (e.g., mismatching premium count, day already skipped/cancelled), the payment handles this idempotently but returns `{ applied: false }` internally. The discrepancy is structurally logged as a warning so the operation team can resolve the mismatch (e.g., refund manually or correct the subscription).

## 3. Safe Admin Tools
- **Freeze/Skip**: Use `POST /api/admin/subscriptions/:id/freeze` and `POST /api/admin/subscriptions/:id/days/:date/skip` to pause days safely. These paths respect the core validity algorithms and automatically extend the `validityEndDate` if policy dictates.

## 4. Delivery View Models
With Phase 2 completion, delivery queries should use the specific snapshot-driven extraction layer `deliveryOperationsService.js` to build kitchen batching inputs without directly polluting the database models.
