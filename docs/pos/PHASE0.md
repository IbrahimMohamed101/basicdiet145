# POS Phase 0 — design-only foundation; NOT a working cashier

This PR introduces the five pos_* Mongoose schemas, an explicitly gated POS
read-only health endpoint, a default read-only index audit, and tests.
No orders, cash movements, refunds, payroll, reports or customer balances
can be changed by this module yet.

* POS_ENABLED is false by default.
* The only available endpoint when enabled is authenticated GET /api/pos/health.
  It always returns salesEnabled=false (even if readiness is OK).
* MongoDB Standalone returns POS_TRANSACTIONS_REQUIRED: fail closed.
* Missing declared indexes return POS_INDEXES_MISSING: fail closed.
* No automatic index builds. scripts/pos-indexes.js defaults to read-only;
  --apply requires POS_INDEX_MIGRATION_APPROVED=true and POS_BACKUP_REFERENCE,
  refuses nonempty POS collections, and must only run following a restore
  verification and separate operational approval.
* All declared amounts are integer halala.
* No modification to Order, Payment, Subscription, DailyCashClosing, or
  existing install* services.
* Never merge payment recovery PR #188 as part of this work.

## Tax compliance blocker for live sales

ZATCA e-invoicing generation requirements (phase 1) apply to covered taxpayers,
including a mandatory QR on simplified B2C tax invoices. Phase 2 integration
is enforced in notified waves. The provisional PosCounter is for **internal
receipts only**, not evidence of a compliant tax invoice. Obtain confirmation
of Basic Diet's taxable entity and applicable ZATCA wave from the accountant,
then implement compliant invoice generation/storage and required integration
before any real-world sales. No browser-only printable receipt is sufficient
by itself.

## Next isolated PRs

1. Authenticated published catalog and server-authoritative priceMenuCart
   quote, shift open/close on a replica set only.
2. Paid POS orders with exactly-once transitions and split payments; test
   double clicks and crash recovery on replica set.
3. Separate POS web entry and dedicated Railway frontend service.
4. Subscriber collection via existing cashier operations endpoints; never
   deduct subscriber balance inside POS models.
5. Read-only POS reports and reconciliation against Imdady before cutover.

Working assumptions to validate: A1 controlled parallel Imdady rollout;
A2 one branch with branchId everywhere; A3 current one_time catalog;
A4 online only; A5 e-invoice compliance from first live sale, integration
per wave; A6 dining/table workflow not in first cut; A7 no ingredient stock;
A8 external card machine with operator-verified payment recording.
