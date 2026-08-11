# Subscription Stacking release-safety repair report

Report date: 2026-08-10 (Africa/Cairo). Production was treated as read-only. No production database write, payment, webhook, index operation, migration, deployment, merge, or Railway variable change was performed. Flutter was not modified.

## 1. Latest Backend main SHA

`5de96ffb65097b2df625bd5b6350925b10a99ab1`, fetched and reverified immediately before the repair commits. It includes the newer historical and courier fulfillment repairs and remained unchanged while the candidate was prepared.

## 2. Repair branch SHA

Evaluated repair code SHA: `85cbf4b668a0d5d77a05f578ed5ee2d895fa8052` on `fix/subscription-stacking-release-safety-v2-20260809`.

Backend PR: https://github.com/IbrahimMohamed101/basicdiet145/pull/102. It is open, cleanly mergeable, and was not merged. GitHub reported 28/28 successful checks for this SHA.

## 3. Flutter SHA

`6e1be0b38272160bc377cedf391cf082d0f2abfa`, equal to `origin/main`. No tracked Flutter file changed. The user's pre-existing untracked `docs/FRONTEND_MEAL_PLANNER_BACKEND_CONTRACT.md` remains untouched.

## 4. Dashboard SHA

Evaluated Dashboard repair SHA: `0f9fe92c8c7a776b38aac315b912801332222407`, based on official Dashboard `origin/main` SHA `4caa9f30ff0b4e076df4cb76a2055a42c06a0608`, branch `fix/subscription-stacking-dashboard-safety-20260809`.

The branch is pushed to `IbrahimMohamed101/client_dashbourd`. GitHub rejected a PR to `Basic-Diet/client_dashbourd` because the authenticated account has no write permission and the same-named personal repository is not in the official fork network. No repository settings were changed.

## 5. Files changed

Backend candidate changes 27 files:

- Finalization and checkout: `CheckoutDraft.js`, `subscriptionController.js`, `paymentApplicationService.js`, `subscription/runtime.js`, `subscriptionCheckoutService.js`, `subscriptionStackingCheckoutPreflightService.js`, `subscriptionStackingFinalizationAuthorityService.js`, `subscriptionStackingFinalizeRouterService.js`, `subscriptionStackingActivationService.js`, and `subscriptionStackingPaidDraftOrchestratorService.js`.
- Dashboard backend boundary: `dashboardSubscriptionStackingReadModel.js`, `dashboardSubscriptionStackingWriteGuard.js`, `subscriptionDashboardStackingReadService.js`, and `routes/index.js`.
- Tests: finalization authority/router, activation, preflight, paid-draft orchestration, startup isolation, concurrent purchases, Dashboard read/write safety, and the stale restaurant delivery-handler assertion.
- Release support: phase workflow, staging runbook, and `package-lock.json`.

Dashboard candidate changes 11 files: the subscription DTO types, stacking presentation helper/test, package/payment overview, list/quick-view/detail/header components, manual-deduction page, subscription detail route, and `package-lock.json`.

## 6. Legacy finalizer root cause

Checkout preflight could load `subscription/runtime.js` before startup installed the stacking write router. Runtime, shared payment application, and a controller destructured `finalizeSubscriptionDraftPaymentFlow` from a replaceable CommonJS export. Node cached the old function reference, so a paid allowlisted additive checkout could call legacy activation and replace/cancel the active parent instead of adding a batch.

## 7. Legacy finalizer repair

All replaceable activation exports are now resolved from the service object at runtime/call time. Checkout persists immutable routing authority with version, mode, decision time, and—only for additive checkout—the exact expected parent ID. No index or migration was added. A pending additive draft cannot fall back to legacy activation if rollout configuration changes.

## 8. Finalization routing proof

Routing is mutually exclusive:

- legacy drafts with write disabled use legacy finalization;
- first-subscription intents use standard initial activation only if no active parent exists inside the transaction;
- additive intents use stacking finalization against their checkout-time parent;
- additive fallthrough, missing authority, disabled-after-checkout, parent mismatch, missing parent, and an active parent appearing after initial checkout all fail closed.

Fresh-process startup tests deliberately preload consumers before router installation and prove every consumer resolves the installed finalizer. Unit and replica-set tests prove legacy and stacking finalizers are never both applied.

## 9. Parent subscription preservation proof

The disposable replica-set integration test records the legacy parent ID and its operational state before payment, then asserts after additive activation that:

- the same parent remains active and Flutter-visible;
- no replacement subscription is created;
- legacy counters, fulfilled history, future day selection, premium/add-on snapshots, pickup state, and timeline state remain byte-for-byte unchanged except for the intended aggregate entitlement mirror;
- the new commercial purchase is a separate entitlement batch and payment.

Activation queries the exact expected parent ID and refuses a different or inactive parent.

## 10. Balance correctness proof

Batches and allocations remain authoritative; parent counters are a compatibility mirror. Related ledger, projection, partial-balance, lifecycle, planning, selection, fulfillment, and vertical-slice suites all passed. Reservation, consumption, release, retry, future-start, and concurrent-purchase paths produced no negative balance, double debit, lost update, or minted credit.

## 11. 20 + 52 = 72 evidence

The integration fixture starts with 20 remaining legacy meals and pays for 26 days × 2 meals/day = 52. It asserts a 20-meal legacy seed batch, a 52-meal purchase batch, aggregate remaining `72`, one active parent, one applied payment, and stable parent ID after direct finalization, webhook replay, and verify/webhook races.

## 12. 3x200 + 2x150 = 5-slot evidence

Scheduling, blueprint, planning-context, kitchen-grams, and vertical-slice tests produce exactly five overlapping daily slots: `200, 200, 200, 150, 150`. Grams are stored on batch/slot/allocation snapshots and are not flattened into a parent-level value. The Dashboard hides the misleading singular grams/day fields and shows each package independently.

## 13. Webhook replay evidence

The same paid draft was applied once, twice, ten times, and through 20 concurrent alternating webhook/verify applications. Every case ended with one purchase batch, one logical payment settlement, one activation effect, parent remaining 72, and the original parent ID.

## 14. Concurrency evidence

`subscriptionStackingConcurrentPurchases.integration.test.js` passed five consecutive complete runs on real `MongoMemoryReplSet` transactions. Coverage includes five distinct simultaneous purchases with no lost package, ten duplicate finalizers, twenty verify/webhook racers, transaction rollback/retry after a transient failure, and exact parent identity. General checkout gates also prove 20 callers with one idempotency key create one draft/invoice/payment.

## 15. Legacy customer compatibility evidence

With flags false, customers without batches continue through unchanged legacy reads and writes. Fixtures cover remaining and partially consumed balances, future selections, premium/add-on state, pickup/delivery state, skips, and historical fulfillment. Additive tests seed the legacy remainder transactionally and preserve historical state. No customer migration, data rewrite, or index rebuild is required.

## 16. Flutter test results

- Flutter 3.41.6 / Dart 3.11.4.
- `flutter analyze`: PASS, no issues.
- Full unchanged `flutter test`: 62 passed, 2 failed in `cart_pickup_selection_test.dart`.
- The focused test was repeated three times and reproduced the same baseline defects: expected unresolved branch `null` but received `north`, and a 30-second timeout while clearing an incompatible pickup window.
- `pubspec.lock` was restored after Flutter's SDK-driven resolution; no Flutter tracked file changed.

These failures predate and are independent of the stacking DTO. Per the user's explicit instruction, Flutter received no modification.

## 17. Flutter contract findings

Current subscription, timeline, day, planner, checkout, and payment DTOs preserve the same parent `subscriptionId`; nullable/defaulted aggregate fields retain their types; meal counts/grams remain integers; dates remain strings; future batches are not usable early. Review of subscription parsing found no stacking-specific cast or crash path. Unsupported mutations return deterministic backend errors through Flutter's existing generic error handling.

## 18. Dashboard test results

From a clean `npm ci` on official main plus the repair:

- typecheck: PASS;
- production build: PASS;
- stacking presentation tests: 2/2 PASS;
- ESLint on every changed file: PASS;
- full baseline tests: 58 files passed, 8 failed; 275 tests passed, 15 failed;
- full baseline lint: 14 errors and 5 warnings.

The full-suite failures are pre-existing unrelated Meal Builder mocks/API-contract expectations, Saudi phone normalization, and two Node-test files that Vitest treats as empty suites. No stacking repair test failed.

## 19. Dashboard repairs

The backend adds a read-only `dashboard_stacking_read.v1` context for subscription list/search/detail responses. It exposes the parent as an operational container, aggregate balance, independent packages with grams/meals/day/dates/status/balance/fulfillment/pricing, and sanitized independent payment transactions. The UI labels combined packages, shows package/payment detail, suppresses misleading singular grams/period fields, and hides parent-only lifecycle controls.

The server blocks target subscription mutations whenever persisted batches exist, even after flags are switched off. It also blocks a second Dashboard-created subscription for an allowlisted active legacy parent and for any active batch-backed parent regardless of current flags.

## 20. Manual deduction behavior

Batch-aware allocation semantics were not invented. Manual deduction fails closed for any batch-backed parent. The Dashboard disables selection/submission and the backend returns `STACKING_DASHBOARD_MUTATION_NOT_READY` before mutation. Legacy subscriptions with no batches keep current behavior. There is no arbitrary parent-total debit, negative batch, or unaudited allocation.

## 21. Accounting/payment behavior

Every additive purchase retains its own CheckoutDraft and Payment identity while linking to the same parent. Dashboard read DTOs sanitize metadata but expose amount, currency, provider/method, provider reference, status, and timestamps per purchase. Existing accounting contract suites passed. Refund/per-package cancellation accounting remains intentionally unsupported.

## 22. Premium/add-on status

Additive packages containing premium or add-on entitlements are rejected before invoice/payment. Existing legacy premium/add-on use, planner allocation, and lifecycle tests remain green. Mixed premium/add-on package stacking is not certified and must remain disabled.

## 23. Skip/freeze/cancel/refund status

For batch-backed/allowlisted stacked subscriptions, skip, unskip, skip range, freeze, unfreeze, full cancellation, per-package cancellation, and refund remain unsupported and fail closed before mutation. Legacy non-stacked behavior remains unchanged. The repaired Dashboard hides lifecycle actions and the backend guard remains authoritative.

## 24. Pickup/delivery status

Direct and planned pickup mutations for stacked subscriptions remain blocked. Existing legacy pickup, single-location, delivery fulfillment, historical delivery recovery, courier, kitchen, and fulfillment concurrency gates passed. The repair does not alter newer main fulfillment code. Stored per-slot grams remain the kitchen authority.

## 25. Dependency audit before/after

- Backend production audit: before 9 findings (1 high, 8 moderate); after 8 moderate, 0 high, 0 critical. `js-yaml` moved from 4.3.0 to 4.3.1. Remaining findings are the `firebase-admin`/Google Cloud/`uuid` tree; npm's available fix is a semver-major Firebase Admin upgrade, so it was not forced into this safety repair.
- Dashboard production audit: before 5 findings (1 critical, 3 high, 1 low); after 1 low, 0 moderate/high/critical. Safe lockfile updates include axios 1.19.0, nanoid 3.3.18, postcss 8.5.26, and seroval 1.6.2. The remaining low advisory concerns arbitrary file reads from an esbuild development server on Windows; the deployed Linux production build does not run that dev server, and the first non-vulnerable version is outside npm's selected Vite subrange.

No `npm audit fix --force` or breaking major upgrade was used.

## 26. Backend CI results

Backend PR #102 at SHA `85cbf4b6` has 28/28 GitHub checks successful, 0 failed, 0 pending. Notable remote results include Subscription Stacking Phase 0-13 (41 s), Security Matrix (24 s), Vertical Slice (29 s), Changed JS Syntax (12 s), Secret Scan (9 s), Production Dependency Security (20 s), final backend release gate (6 m 37 s), and isolated final backend gate (6 m 50 s).

Locally, `npm ci`, validation/security/subscription gates, 51 stacking/entitlement and related suites, the phase workflow matrix, changed-code syntax, diff check, secret scan, and the full disposable-replica-set release-gate continuation passed. The unwrapped release command stopped only where designed when `MONGO_URI_TEST` was absent; the identical database-required gates passed after both Mongo variables were set to the disposable replica set.

## 27. Dashboard CI/build results

Dashboard `npm ci`, typecheck, production build, focused stacking tests, changed-file lint, diff check, and production audit were green at SHA `0f9fe92c`. The branch is pushed and reproducible. An upstream PR could not be created solely because the authenticated account lacks permission and the personal repository is not an official fork.

## 28. Remaining blockers

No code-side blocker remains for starting isolated staging certification. The following still block production rollout and/or upstream delivery:

1. No remote isolated staging certification has been executed yet; staging service, replica set, sandbox payment, webhook, and test user must be provisioned.
2. A maintainer with `Basic-Diet/client_dashbourd` permission must import the pushed Dashboard SHA or create the official PR.
3. Flutter has two pre-existing pickup-selection test failures; Dashboard has unrelated baseline full-suite/lint failures. They were not hidden or broadly refactored.
4. Premium/add-on stacking, skip/freeze/cancel/refund, and direct/planned pickup remain intentionally unsupported.
5. Backend retains eight moderate Firebase Admin dependency advisories requiring a separately tested major upgrade.
6. The current production guard intentionally forbids every stacking mode; no production canary is authorized.

## 29. Exact staging prerequisites

1. Deploy immutable Backend SHA `85cbf4b6` and Dashboard SHA `0f9fe92c` to separate staging services only.
2. Use `NODE_ENV=staging`, `APP_ENV=staging`, a dedicated MongoDB replica set/database with no production credentials, and Moyasar sandbox/mock with a separate webhook.
3. Verify database/payment isolation and set the two staging confirmation variables only after proof; run `node scripts/validate-subscription-stacking-staging-env.js` and require `ok: true`.
4. Use exactly one test user, `ALLOW_ALL_USERS=false`, no wildcard, and the same exact ID in required shadow/read/write allowlists.
5. Start all flags false; progress one deployment at a time through shadow, read, then write.
6. Confirm no unfinished draft for the user predates finalization authority v1. Never patch a draft by hand.
7. Create a known 20-remaining parent, buy a sandbox 52-meal base package, and prove 72, same parent ID, independent payment/package, 3×200 + 2×150 slots, future-start isolation, Dashboard truthfulness, and fail-closed mutations.
8. Replay once/twice/ten times, race webhook/verify, repeat the concurrency matrix five times, and retain sanitized logs/reconciliation evidence.
9. Stop at any mismatch. Do not use production PII, database, payment keys, webhook, or hosts.

## 30. Exact production canary prerequisites

Production remains all flags false. Before any one-user canary:

1. Complete and sign off remote staging certification at immutable reviewed SHAs.
2. Merge and deploy reviewed Backend and Dashboard changes with flags still false; verify startup/read compatibility.
3. Add a separate reviewed production-canary policy requiring explicit approval/attestation, exact one internal ObjectId, matching allowlists, no wildcard, `ALLOW_ALL_USERS=false`, write implies read and shadow, production detection, and an emergency kill switch. Do not remove the current guard generically.
4. Restrict the account to base packages and exclude all unsupported operations.
5. Establish parent/batch/allocation/draft/payment/accounting reconciliation, alerts, on-call ownership, and a batch-read-compatible rollback artifact.
6. Advance only through one internal shadow, one internal read, then one internal base-only write, with a reviewed observation window at each step.

## 31. Rollback strategy

Before a stacked write, close WRITE, READ, and SHADOW and clear allowlists. After any stacked write, close WRITE first, retain READ for affected IDs, close SHADOW if needed, and deploy the last known batch-read-compatible artifact. Reconcile parent, batches, allocations, draft, payment, and accounting before closing READ. Never roll back by deleting batches, rewriting customer data, rebuilding indexes, or deploying a legacy-only binary that hides existing batch state.

## 32. Final decision

The repaired code is ready to proceed to isolated staging certification only. It is not production-ready, does not authorize a production canary, and does not authorize enabling any production flag.

READY_FOR_STAGING_CERTIFICATION
