# POS G3 — Staging execution record and remaining gates

**Scope:** Staging only. Real cashier browser actions require an authenticated Staging cashier session. The synthetic CI suites do **not** constitute real Staging cashier acceptance. Never use Production customers or data in tests.

## Preconditions
- G0 Staging-only synthetic/config fixture applied on a **separate isolated replica-set clone**, after owner approval for any config export (allowlisted collections only). Do not export or restore customer/phone/subscription/payment records from Production.
- G1 and G2 PRs merged, both Staging services SUCCESS on pinned SHAs; all CI green. Verify `POS_REFUND_ROLES` permits `cashier`; Production never changed.
- D-092 approved cashier/restaurant parity, including cashier Visa/Mada recording. The obsolete cashier cash-only restriction is removed.
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
- `pos-g3-ci.yml`: isolated GitHub Actions standalone `mongo:8.0` service runs the **current targeted cash-subscription financial guard test** (`posG3StandaloneSubscriptionGuard.test.js`) and concurrent balance-consumption test (`subscriptionBalanceConcurrency.test.js`). A failed check is a blocker, not an invitation to bypass transaction logic.
- The pre-existing broad `dashboardCashSubscriptionContract.test.js` returned **6 passed / 19 failed** against standalone Mongo, including outdated premium fixture expectations and the real mismatched-amount bug. The real financial mismatch was fixed and covered independently in PR #207, but the legacy suite has **NOT been repaired or declared green**; its other assertions require separate review before full G3 sign-off. It is not used as an authoritative Stage G release gate until reconciled, and must not be represented as passing.
- `G3` cannot be declared **PASS** until a real authenticated cashier executes the matrix against an approved Staging fixture and an admin separately approves the daily closing. Browser synthetic tests alone are insufficient.
- **No full-Production backup or PII may enter Staging.** Config exports require explicit owner approval and a scrubbed allowlisted artifact. A clone restore drill must use synthetic/config-only backup.

## Result record template
Record date/role, head SHAs, three invoice numbers, two subscription Payment IDs, one refund ID, meal deduction audit ID, cashier/manager closing IDs, expected/counted cash & network in halalas, per-channel receivables, and each HTTP failure/response. Sanitized output only: no names, phone numbers, raw tokens, email addresses or addresses.

## Actual G3 browser execution reported by Claude (2026-11-08, Staging cashier)

Owner-provided outcome report (not independently replayed in this documentation update):
- Steps **1–8 PASS**, **9 BLOCKED by G1 daily closing**, **10 NOT RUN**, **11 PASS**.
- Cash subscription **17,400 halalas**; Visa subscription **17,400 halalas** (cashier).
- Restaurant cash sale **3,700 halalas** (VAT **482** per line; add-on separate line).
- Network sale **7,800 halalas**, 10% invoice discount => **7,020 halalas**, VAT **915 halalas**.
- HungerStation app receivable **3,800 halalas**.
- Partial network refund **STG-R-000002**, **2,880 halalas**.
- Attempt to refund over available quantity rejected by UI and API: **409 POS_CONFLICT**.
- Meal deduction **7 → 6**.
- Independent reconciliation versus `expectedTotals`: **0 halala difference**.
- Sale invoice numbering **STG-000009 through STG-000011**, continuous with no observed gaps.

G3 overall remains **BLOCKED** (step 9 pending G1; step 10 not executed). These are reported historical browser results, not the synthetic example above and not a fresh test run.

## Owner-authorized Production data copy to Staging — unresolved security risks (2026-11-08)

The owner reported/approved a full Production copy into Staging. This G1 code change neither authorizes nor performs any copying. Before any subsequent Staging use of copied data, explicitly resolve: (1) access control on Staging; (2) test-only Moyasar and Twilio keys, with no real notifications or charges; (3) retention/deletion policy for personal data and backups; (4) removal of unnecessary Production-linked temporary services. Do not commit customer data. Previous synthetic-only constraints are superseded as an owner decision but remain **security gates requiring verification**.
