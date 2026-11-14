# Basic Diet POS — unified Staging PRD v0.3.3

**Authority:** Owner instructions, 2026-11-07. **Environment:** `codex/pos-staging-isolation` backend and `codex/pos-staging-preview` dashboard only. Dedicated database `basicdiet_pos_staging_test`. No authorization for `main`, Production, live payment collection, Moyasar, or ZATCA submission.

This document consolidates D-086..D-090 as addenda to the existing POS PRD v0.3.2. Other approved PRD decisions remain in force unless explicitly amended.

## Consolidated decisions

- **D-086:** Owner authorizes POS UI/backend implementation and synthetic testing only in an isolated Staging; no Production data/codes/keys. Supersedes study-only D-008 for Staging alone.
- **D-087:** Cashier and restaurant have operational POS/menu/subscription access parity. No inherited financial admin powers.
- **D-088:** 15% VAT **included** in all menu prices. Line discount on gross before invoice discount. Invoice percentage discount rounded HALF_UP on discounted sum; allocate by largest remainder (fraction, higher line amount, earlier line index). VAT recovered from each final discounted gross line using `floor((grossHalalas*30+115)/230)`; line net=gross−VAT, invoice totals sum line values. This supersedes the proposed D-019; intentionally differs from Imdad.
- **D-089 (temporary):** Cashier may grant line/invoice fixed or percentage discounts in all channels without cap. Discount may not exceed eligible gross. Full audit: actor, type, amount, time. Configurable cap `null` means no cap; no cap settings UI. Overrides prior D-060 cap.
- **D-090 (temporary):** `pos.refund` permits cashier, restaurant, admin and superadmin to record whole/partial refunds with mandatory reason. Money is actually returned **outside POS**; record amount and external return method, with no payment gateway. Overrides prior D-057 manager-only policy.

**Previously proposed now approved:** D-018 idempotent atomic sale, D-022 immutable final invoice with separate refund document. **Preserved:** D-050 single restaurant tender per invoice; app invoices are receivables (not drawer cash), D-041 reject stale catalog, D-058 external refund, D-068 separated daily close.

## Financial contract

All money fields are signed-safe, nonnegative integer **halalas**. Price and tax come **only** from server-side published POS catalog, never posted client totals. Every parent product is an independent line; each distinct add-on is another line with `parentLineId` and quantity `mealQuantity×addonQuantity`. Add-on quantity permitted 1–10. VAT round per line, not per unit (e.g. 500×3 produces 196 VAT); **three separately priced 500 add-on lines produce 65+65+65** as in approved sample B 023454.

Line discount first; allocate invoice discount by largest remainder, then VAT on the post-discount gross per line. The seven exact D-088 vectors are regression fixtures; property checks enforce sum(discount allocations)=invoice discount and gross=VAT+net on every line.

## Staging sale/refund

- `Idempotency-Key` required, unique and hashed with stable normalized semantic payload. Replay identical request returns original document, different request conflicts 409.
- One MongoDB transaction per operation encompasses active catalog verification, sequential counter increment, invoice/refund insertion, collection or receivable ledger and complete audit. Retry transient write conflicts. Counter uses separate Staging series `STG-NNNNNN` and `STG-R-NNNNNN`; aborts roll back both counter and sale (no gaps for committed invoices).
- Invoice is append-only. Snapshot published catalog revision, channel, fulfillment mode, actor ID/name/role from verified server-side DashboardUser identity, all product/add-on lines, original prices, quantities, discounts, gross, VAT, net and totals. No update endpoints.
- Restaurant: cash received/remaining change or network indicator; single tender, network **record only**. Delivery app: externally reported `paid|cash`, optional order reference and **receivable only**, never count as store cash.
- Refunds reference an original invoice, bounded per original line and remaining quantity. Partial gross and VAT are proportional HALF_UP based on original line; final remaining quantity receives exact remainder. Distinct `pos.refund` capability and mandatory reason. Refund execution outside POS; no online refund API.

## Staging invoice presentation

Printed Staging document must say **«فاتورة تجريبية — غير ضريبية»**, never represent a compliant ZATCA document. Tax-compliant invoice numbering, signing/QR, merchant tax registration, live deployment and live payment connection remain **Production blockers** (Q-011), not solved by Staging work.

## Deployment guard and missing identity fields

The current DashboardUser schema has `email` and `role`, **no `name` field**. Any actor displayName/name must be read from a server-trusted persisted profile after adding it; do not accept client-supplied actor name or falsely treat email as legal name. Until populated, expose `name:null` and a separate `email` identifier.

Staging Railway currently reports `checkSuites:false` (Issue #84). Do not claim Wait for CI is enabled without config readback and a verified failing-run block.

## Safety and acceptance gates

Unit tests for vectors/property checks; Mongo replica-set integration for replay and conflicts, catalog race, transaction rollback/retry, concurrent cashier counters and over-refund; four-viewport browser sale/refund QA; operational test with Staging-only cashier session; CI fully green, Railway Staging deploy `SUCCESS`.

**Production, main, live payment/receipt/ZATCA and customer data remain strictly out of scope.**
