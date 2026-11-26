# Verified subscription checkout recovery

## Cause and evidence

A failed attempt marked the invoice-level Payment and CheckoutDraft `failed`
(`failureReason=payment_failed`). A later successful attempt entered the webhook
and success-redirect paths. Both previously claimed Payment as `paid` **inside
the same Mongo transaction as activation**. Additive stacking finalization then
updated drafts only when status was `pending_payment` or `completed`.
`STACKING_DRAFT_COMPLETION_CONFLICT` aborted the transaction, including the
Payment promotion and entitlement insert. Payment therefore remained `failed`.

The incident's available logs from 2026-11-25 show `payment_paid` and successful
provider-invoice authentication followed by this exact error in webhook and
success redirect. This is an application retry failure, not evidence that the
successful payment was declined. No production reads or writes were made while
implementing this patch; production facts come from the preceding investigation.

Two further guards prevented self-healing: reconciliation excluded failed
payments from promotion, and client verify returned immediately for failed
drafts. The existing recovery worker selects only internally `paid` payments.
Its reconciliation logic also treated additive *intent* as an already-applied
purchase, even when a transaction rollback had left no purchase batch.

The regression integration test reinstates the old draft filter against an
ephemeral replica set and proves that the paid claim and batch insert roll back.

## Corrected flow

1. Authenticate webhook or the existing redirect token / app user as before.
2. Fetch invoice detail and the exact successful payment using Moyasar's secret
   key on the server. Callback IDs are lookup hints, never payment evidence.
3. Match invoice/payment IDs, invoice ownership metadata (`userId`, `draftId`),
   saved draft/payment links, amount and currency. The attempt must belong to
   the invoice, be paid/captured and have no refunded amount. A different already
   paid reference or a refunded local payment fails closed. Missing evidence
   fails closed; no fields or package values are supplied by the operator.
4. Persist `paid`, the successful reference and minimal verification provenance
   with a conditional single-record update **before** running activation.
   Preserve `applied` and other metadata. A failed activation cannot roll back
   this independently verified financial fact.
5. Invoke `recoverPaidSubscriptionPayment` for that Payment only. It uses the
   canonical draft finalizer and existing purchase/draft unique keys. A failed
   draft with `payment_failed` can complete for its same user/payment. With no
   previously applied batch, use normal activation; with a matching applied
   batch, use the existing reconciliation path without crediting meals again.
6. Ignore late failure notifications for paid/refunded subscription payments,
   including a conditional write guard for requests racing with verification.

Provider contracts: [Fetch invoice](https://docs.moyasar.com/api/invoices/04-show-invoice),
[Fetch payment](https://docs.moyasar.com/api/payments/02-fetch-payment).
The detail endpoint is deliberate: the older invoice-list endpoint can omit
attempts. The existing list API helper is retained for unrelated callers.

## After merge and deployment by the release owner

This PR does not deploy or execute recovery. Do not run this procedure against an
older build. In the deployed application's trusted runtime, with its existing
Mongo and Moyasar credentials, substitute the approved case identifiers:

```sh
node scripts/recover-verified-subscription-checkout.js \
  --user-id "$CASE_USER_ID" \
  --draft-id "$CASE_DRAFT_ID" \
  --invoice-id "$CASE_INVOICE_ID" \
  --provider-payment-id "$CASE_SUCCESSFUL_PAYMENT_ID"
```

Default is read-only, including provider GET requests. Require
`providerVerified=true`, one matching Payment and the expected saved package.
The incident package is 30 days, one meal/day, 200 g; do not pass replacement
package fields. `complete=false` is expected before an unapplied checkout is
recovered. Keep the output in the restricted incident record, not GitHub.

Run the same command once with `--apply`. It re-verifies the provider, records
paid state and calls official recovery. It does not create an invoice, charge,
capture, refund, manually create a subscription, run a migration, or alter flags.

The saved draft is authoritative about standard/additive routing. An additive
purchase may attach to its checkout-time subscription **container**, even if
that container's old package expired. The old subscription ID/status alone
does not prove success: require the *new batch* linked to this Payment/draft.
If the expected parent is now unavailable, or a rollout gate is disabled, stop;
retain the verified paid record for review. Never substitute a different parent,
enable a flag from this script, clear a review marker, or create a replacement.

Run the original command again without `--apply` to verify:

- `providerVerified=true`, `paymentStatus=paid`, `applied=true`,
  `draftStatus=completed`, `complete=true` and coherent subscription links.
- For this additive checkout: `purchaseCount=1`, `applicationState=applied`,
  saved 30 meals, one meal/day and 200 g. Check remaining/consumed/reserved
  counts on this batch; do not add the old container's balances as new credit.
- Refresh dashboard customer purchases and app subscriptions. Verify the linked
  new purchase, its effective dates and meal availability. A scheduled purchase
  can be `paid_scheduled`; inspect dates before asserting it is active today.
- Repeating the procedure must keep the same purchase ID and quantities.
  No second charge or second entitlement should exist.

An apply exit code of 2 means verification/application is incomplete; exit 1
means an error or mismatched evidence. Preserve the output and inspect official
recovery logs. Do not change database records to force success. A transient
`PAYMENT_VERIFICATION_CONFLICT` can be retried with the identical identifiers.
Activation errors leave Payment paid so the existing recovery worker can retry.

## Targeted validation

All database tests use MongoMemoryServer / MongoMemoryReplSet and the repository
test safety guard, never an application database:

```sh
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js --test tests/subscriptionVerifiedPayment.integration.test.js tests/subscriptionPaymentRecovery.test.js
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/activation_reconciliation_verification.js
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/moyasarInvoiceCallbackContract.test.js
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/moyasar_retry.test.js
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/subscriptionStackingActivationService.test.js
NODE_ENV=test node -r ./tests/helpers/installMongoTestSafetyGuard.js tests/subscriptionStackingFinalizeRouter.test.js
```

Coverage includes transaction-rollback evidence, failure then success, duplicate
and concurrent callbacks, reversed callbacks, paid-but-unapplied late failure,
provider reference/invoice/amount/currency/owner mismatch, untrusted callback
status/body, redirect verification, authenticated draft verification and ownership,
read-only preflight, preserved paid state after activation failure, official
recovery, and exactly one purchase with 30 entitlements/days after retries.
