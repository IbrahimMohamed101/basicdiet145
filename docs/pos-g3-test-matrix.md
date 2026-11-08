# POS G3 — Full-day Staging acceptance matrix (partially verified, G1 blocked)

**Scope:** Staging only. Reported 2026-11-08 Claude browser run used role=cashier, per owner-provided results; these observations are recorded as **owner-supplied evidence, not independently reverified in this PR**. G3 is NOT accepted while G1 and retries are pending. Do not commit customer details or secrets.

## Preconditions
- Previous G0 preparatory approach allowed synthetic/config-only fixtures. D-096 records the owner's 2026-11-08 approval of a full Production copy on Staging, but the copy, access controls and data retention are not independently verified; G1 authorises **no new data export or import**.
- G1 and G2 PRs merged, both Staging services SUCCESS on pinned SHAs; all CI green. Verify `POS_REFUND_ROLES` permits `cashier`; Production never changed.
- D-091/D-092 now allow the same cashier/restaurant branch operator to record cash and Visa/Mada subscriptions through the authorized dashboard path; the previous cash-only note is superseded.
- For subsequent G1 acceptance tests, use only synthetic test accounts/identifiers; do not send real SMS, charge gateways or disclose Production-derived PII. The source data used in the owner-reported 2026-11-08 browser run has not been independently verified.
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
- Prior synthetic-only restriction was the G0 safety baseline. D-096 now records owner approval for a full Production copy on Staging (2026-11-08), **without proving safe controls are in place**. This Draft PR does not itself transfer data. Staging access, test keys and retention stay an OPEN security gate.

## Result record template
Record date/role, head SHAs, three invoice numbers, two subscription Payment IDs, one refund ID, meal deduction audit ID, cashier/manager closing IDs, expected/counted cash & network in halalas, per-channel receivables, and each HTTP failure/response. Sanitized output only: no names, phone numbers, raw tokens, email addresses or addresses.

## Owner-reported Claude Staging cashier G3 run — 2026-11-08

Status: **PARTIAL / NOT ACCEPTED**. The following is a transcript summary supplied by the owner, not independent GitHub CI or database evidence.

| Checklist items | Reported result | Evidence summary (halalas) |
|---|---|---|
| 1–3 | PASS | Cash subscription 17,400; Visa subscription 17,400, both by cashier |
| 4 | PASS | Cash sale 3,700; VAT 482 per stated line, add-on as distinct line |
| 5 | PASS | Network sale 7,800 less 10% invoice discount = 7,020; VAT 915 |
| 6 | PASS | HungerStation sale 3,800 recorded as app receivable |
| 7 | PASS | Partial network refund STG-R-000002 = 2,880. Excess refund blocked by UI and API with 409 POS_CONFLICT |
| 8 | PASS | Meal deduction reduced 7 → 6 |
| 9 | **BLOCKED** | Old backend closing submit reason calculation conflicts with POS expectedTotals (G1 remediation) |
| 10 | **NOT RUN** | Uncertain network response/retry/idempotency not confirmed |
| 11 | PASS | Invoice sequence STG-000009 through STG-000011 has no gaps; independent expectedTotals difference 0 halalas |

The run above is *not* the full G1 acceptance fixture of cash 150,965, network 335,240, applications 7,600 and total 493,805 halalas; do not conflate these scenarios.

## Production-derived data on Staging — D-096 unresolved protection gate

The owner states on 2026-11-08 that a **full Production copy on Staging** was authorized. Execution status, access restrictions, key safety and retention are **not independently verified**. This changes the assumption in earlier synthetic-only notes and needs an explicit security reconciliation before further Staging tests:
- Restrict who can access Staging, its backups, network and test accounts.
- Verify Moyasar and Twilio Staging credentials are *test-only*, without printing tokens.
- Approve data retention, deletion, and incident response for Production-derived customer records.
- No new Production export, PII transfer, seed with customer data or deployment is performed by this Draft PR.

**Current G3 overall status: BLOCKED / NOT ACCEPTED** until G1 submit/approve, retries, security and owner gates pass.
