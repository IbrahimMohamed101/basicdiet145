# POS G3 — Full-day Staging acceptance matrix (not yet accepted)

**Scope:** Staging only. Real cashier browser actions require an authenticated Staging cashier session. The synthetic CI suites do **not** constitute real Staging cashier acceptance. Never use Production customers or data in tests.

## Preconditions
- G0 Staging-only synthetic/config fixture applied on a **separate isolated replica-set clone**, after owner approval for any config export (allowlisted collections only). Do not export or restore customer/phone/subscription/payment records from Production.
- G1 and G2 PRs merged, both Staging services SUCCESS on pinned SHAs; all CI green. Verify `POS_REFUND_ROLES` permits `cashier`; Production never changed.
- Existing role restriction: cashier subscription creation **cash-only** in `src/controllers/adminController.js`. Visa by a cashier is currently **forbidden**. Do not override the controller silently. An owner-authorized role decision is required before G3's strict "same cashier buys cash and visa" scenario can pass; otherwise test visa with authorized restaurant/admin role and mark strict G3 **BLOCKED**.
- Actual one-day tests use customer fixtures with *synthetic* phone numbers and no SMS, PII, gateway charge or external API calls.
- Record invoice and refund counters before starting, UUID/idempotency keys, timestamps in `Asia/Riyadh`, tester role and no cross-environment traffic.

## Real cashier acceptance checklist

| # | Action / authoritative source | Acceptance evidence |
|---|---|---|
| 1 | Create synthetic subscriber using existing `/admin/users` route, Staging gated cashier access only | Exactly one core user + app user, one-time credentials; no live notifications |
| 2 | Existing CreateSubscriptionFormContent: new cash subscription; verify `Payment` | `status=paid`, `source=dashboard_subscription_cash`, `collectedBy`, `paidAt` within Saudi day |
| 3 | Second subscription with Visa (role gate noted above) | `source=dashboard_subscription_visa`; no fake card transaction |
| 4 | POS sale restaurant cash | One `PosInvoice` and `PosLedger.restaurant_cash` |
| 5 | POS sale restaurant network, invoice 10% discount | Server-authoritative gross/VAT: per-line HALF_UP and gross × 15/115 after discount |
| 6 | POS sale HungerStation/Keeta with external order reference | `app_receivable`, not restaurant cash or bank network |
| 7 | Partial refund | One `PosRefund` plus negative `PosLedger.refunds` entry in same commit; no over-refund |
| 8 | Subscription meal deduction using existing ManualDeductionPage | One actual entitlement debit and one audit operation, not twice |
| 9 | Existing `/daily-closing` page: save draft then submit, manager approve | Server `expectedTotals`, immutable snapshot and zero cash/network difference in **halalas** |
| 10 | Retry and duplicate POST scenarios | At most one payment, invoice, refund and meal deduction per idempotency key |
| 11 | Final audit | Invoices consecutive and unique, no unexpected gaps, no duplicate Payment→PosInvoice attribution, no Production change |

## Pure synthetic reference example (NOT live Staging results)

| Movement | Halalas |
|---|---:|
| Restaurant cash invoice | 4,200 |
| Restaurant network invoice | 300 |
| HungerStation receivable | 3,400 |
| Cash partial refund | -150 |
| Dashboard cash subscription | 10,000 |
| Dashboard Visa subscription | 20,000 |
| **Expected cash** | **14,050** |
| **Expected network** | **20,300** |
| **App receivable** | **3,400** |
| **Expected cash+network+receivable** | **37,750** |

The numbers are test fixtures already exercised in `tests/posG2ExpectedTotals.test.js`, **not sales or customer data** from a real day. Check actual independent evidence from Mongo and the cashier UI at execution time.

## CI environments / limitations
- `pos-stage-f-validation.yml` and `tests/posStageF.integration.test.js`: replica-set transactions, sale+refund idempotency and G2 ledger/total reconciliation on disposable local Mongo.
- `pos-g3-ci.yml`: isolated GitHub Actions standalone `mongo:8.0` service runs the **existing cash-subscription and concurrent meal-deduction tests** to identify missing compare-and-set or idempotency guarantees. A failed check is a blocker, not an invitation to bypass transaction logic.
- `G3` cannot be declared **PASS** until a real authenticated cashier executes the matrix against an approved Staging fixture and an admin separately approves the daily closing. Browser synthetic tests alone are insufficient.
- **No full-Production backup or PII may enter Staging.** Config exports require explicit owner approval and a scrubbed allowlisted artifact. A clone restore drill must use synthetic/config-only backup.

## Result record template
Record date/role, head SHAs, three invoice numbers, two subscription Payment IDs, one refund ID, meal deduction audit ID, cashier/manager closing IDs, expected/counted cash & network in halalas, per-channel receivables, and each HTTP failure/response. Sanitized output only: no names, phone numbers, raw tokens, email addresses or addresses.

Current actual G3 result: **NOT EXECUTED**. All reported amounts above are synthetic examples; do not report them as live achievements.
