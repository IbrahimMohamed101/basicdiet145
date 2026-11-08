# POS Phase G3 — Staging-only one-business-day acceptance record

**Status: BLOCKED; not a passing end-to-end run.** This checklist must only be executed after:
- PRs G0/G1/G2 have green CI, merged **only** to Staging branches and deployed on pinned commits;
- an approved, PII-scrubbed business-config seed has actually been imported to isolated Staging; **Production client, subscription, order and payment records must never be copied**;
- a genuine cashier Staging account has permission to create customer/subscription using the **existing** `users/create` and subscription flows. As of 2026-11-08, `canCreateAppCustomer` and `canCreateCustomerSubscription` exclude `cashier`; DO NOT bypass original route authorization;
- the separate restored synthetic MongoDB 8 rehearsal and standalone no-rollback protections pass;
- approved manual checkout/refund test account available; no real Moyasar, ZATCA, SMS or Production endpoints.

## Evidence collection

Log: Staging deploy backend/dashboard SHA + SUCCESS, authenticated cashier role/id (not its password), published POS catalog revision, synthetic users, starting invoice/refund sequence, date `Asia/Riyadh`, all request IDs/idempotency keys **in a secured artifact** (not public), each expected and actual amount **as integer halalas**, closing GET/PUT/submit/approve payloads, residual mismatches and screenshots. Avoid PII even in sanitized QA artifacts.

| # | Authenticated action, existing UI/API only | Assertions |
| --- | --- | --- |
| 0 | Log in as the **cashier**, record starting `STG-` and `STG-R-` counters; confirm synthetic subscribers | no Production contacts, Staging DB `basicdiet_pos_staging_test` |
| 1 | Use existing customer creation flow for two fake clients; new/renew subscription via `CreateSubscriptionFormContent` | actual `Subscription` + `Payment`, role authorized, first paid dashboard cash, second paid dashboard Visa; exact `paidAt` Saudi business date and collector |
| 2 | Restaurant cash sale | `PosInvoice`/POS ledger, one confirmed idempotency key, VAT included |
| 3 | Restaurant network sale | one invoice, network payment only, no cash drawer amount |
| 4 | HungerStation or Keeta sale with external order ref, marked paid | `app_receivable` by channel, not drawer or duplicate Payment |
| 5 | One 10% invoice-level discount | gross−discount exact halalas and VAT extracted from discounted gross; compare each line |
| 6 | One partial refund | `PosRefund` + signed `PosLedger.refunds` update **in one transaction**; remaining quantity correct; repeated key replay and over-refund rejected |
| 7 | Deduct one meal from synthetic active subscriber via existing `ManualDeductionPage` | aggregateBalance decremented exactly once, journal created, same key replay no double deduction |
| 8 | Open existing DailyCashClosing draft, enter counted cash/network from actual receipts, submit, approve as permitted manager | server `expectedTotals(businessDate)` by channel/collector, snapshot frozen at submit, `cashDifferenceHalala=0`, `networkDifferenceHalala=0`; no double count between Payment and POS invoice |
| 9 | Open existing daily report | POS net/refund figures separate from legacy Order/Payment; same Saudi day totals |

No approval of Production until a cashier-role authorization plan, full green CI, verified Staging screenshots and **ZATCA Q-011 + Wait for CI** resolution.

## Example arithmetic vector — **synthetic unit test, NOT the above real Staging run**

A controlled pure reducer vector in `tests/posG2ExpectedTotals.test.js` uses:
- POS cash: 42.00 SAR; POS network 3.00; app receivable 34.00;
- partial cash refund: 1.50; subscription cash payment: 100.00; subscription Visa payment: 200.00.
- **Expected cash = 140.50 SAR; expected network = 203.00; app receivable = 34.00; total = 377.50 SAR.**
- Cash/visa counted exactly as expected => **0 halala drawer discrepancy**.

This vector demonstrates expected sums only; it is **not evidence of live posted Staging transactions**.

## Real MongoDB standalone coverage

`tests/posG3StandaloneMechanisms.integration.test.js` uses a disposable local MongoDB 8 **without replSet**. It creates 2 fake users/subscriptions and 2 synthetic cash/Visa `Payment` records, confirms an operation idempotency key unique index and an atomic guarded single-document meal deduction even under two concurrent identical requests, and demonstrates that `startSafeSession().withTransaction` cannot roll back a prior write. It **does not** claim to exercise every real subscription controller or a genuinely authenticated cashier. Follow-up standalone HTTP fault-injection tests must target actual create/renew/deduct endpoints, including crashes after each intermediate write.

## Stop conditions

Block any G3 signoff if an app endpoint points outside Staging, any phone resembles an actual customer, a payment gateway is contacted, invoice count differs from successful sells, accounting mismatches a halala, a refund has no signed ledger entry, a step silently retries with a fresh operation key, the cashier gets 403, or the Mongo standalone test incorrectly claims rollback support.

**Not yet completed:** actual owner-approved config import; real cashier G3 day; screenshots/counters; standalone end-to-end create/renew/quick-deduction fault injection; Production approval.
