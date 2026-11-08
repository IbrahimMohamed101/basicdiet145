# POS G0 — MongoDB transaction-risk inventory and single-node replica-set runbook

**State:** Discovery/runbook, not approval to change Production. Prepared 2026-11-08. All code changes and rehearsal are restricted to **Staging or local isolated throwaway databases**. The Production database name is **`test`**. Do **not** export or import Production customers, subscriptions, orders, payments, addresses, phones, emails, or any other PII into Staging.

## Verified deployment facts (Railway read-only inspection)

| Service | Environment | Current configuration | Consequence |
| --- | --- | --- | --- |
| `MongoDB` (`3375e020-d685-4187-b34c-5db287879b3d`) | Production | `mongo:8.0`; `docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false`; mounted `/data/db`; **no `--replSet`** | Standalone server: no MongoDB multi-document transactions |
| `MongoDB-qxhu` (`0846899c-5f5b-4c8b-97f5-8dcf0d6d7bd4`) | Staging | `mongo:8.0`; `mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth`; private endpoint | A single-node `rs0` with keyfile/auth; used for isolated transactional POS testing |
| `MongoDB` | Production | Active public TCP proxy (Railway; endpoint deliberately omitted from this operational document) | Public network exposure; review actual consumers before removal |

Source audit: `src/utils/mongoTransactionSupport.js` `checkMongoTransactionSupport()` examines `hello.setName`/`isdbgrid`. If unsupported, `startSafeSession()` overrides `startTransaction()`, `commitTransaction()`, and `abortTransaction()` with no-ops; `withTransaction(work)` invokes `work(session)` **without rollback**. The fallback does not turn several writes into an atomic unit. Code that does not deliberately use a compare-and-set, immutable operation key, or recovery saga is **not proven safe**. Note the capability flag is module-level cached; do not change topology in-process and expect this cache to refresh without restart.

## Transaction-dependent operational and money paths

This inventory lists verified session/transaction entrypoints in the Staging-bound backend source. Some helpers below are called by multiple endpoints. “Protection” identifies a code mechanism, **not a blanket guarantee**; fault injection on standalone MongoDB is required before Production migration approval.

| Entry point | Writes at risk | Verified alternative / exposure on standalone |
| --- | --- | --- |
| `src/controllers/subscriptionController.js` | subscription creation/renewal, payment state, meal entitlements; session start/commit/abort | Payment `findOneAndUpdate` claim and request idempotency keys; activation/stacking saga and reconciliation downstream. Verify post-claim crash windows and draft recovery |
| `src/services/subscription/subscriptionActivationService.js` | paid activation, stacking balance, linked draft | Explicit `session.supportsTransactions` branch; `stackingActivationLease` and independently idempotent activation steps. Test lease expiry/retry after a partial write |
| `src/services/subscription/subscriptionStackingEntitlementRouterService.js` and `subscriptionEntitlementLedgerService.js` | batch/allocation operations, remaining balances | conditional allocation/batch updates and idempotent allocation keys; no cross-document rollback in standalone, so reconcile linked allocations |
| `src/services/dashboard/manualDeduction/stackedManualDeductionService.js` | aggregate balance/manual deduction activity | `Subscription.findOneAndUpdate` lease CAS; deterministic operation key/journal; retry/reconcile pending operation. Test double clicks and partial completion |
| `src/services/dashboard/subscriptionQuickDayDeductionService.js` | same-day pickup deduction/ledger | Explicit no-transaction route on `supportsTransactions === false`, idempotency-key operation and guarded updates; test same key/replay and concurrent operators |
| `src/services/subscription/subscriptionCancellationService.js` | day entitlement releases, add-on/premium credits, cancellation status | idempotent release functions + final guarded cancellation CAS; test crash between release and final status, and retry |
| `src/controllers/orderController.js` | order, payment and inventory/entitlement state | request idempotency lookup/unique key and payment status checks; rollback absent in standalone. Test a crash after intermediate order/payment writes |
| `src/controllers/addonController.js` | add-on purchases/day selections/payment or balance | `startSafeSession()` / no-op txn on standalone, plus some record guards; **full compensation/atomicity not verified** — targeted standalone fault test required |
| `src/services/subscription/oneTimeAddonDayPlanningPaymentService.js` | one-time add-on day planning and payment claim | operation idempotency key and Payment `findOneAndUpdate` claim; investigate whether intermediate selected-day writes recover after an injected crash |
| `src/services/subscription/premiumExtraDayPaymentService.js`, `premiumOverageDayPaymentService.js` | premium-upgrade payment and entitlement | idempotency and guarded Payment claim, but cross-document recovery needs standalone failure tests |
| `src/services/paymentRefundService.js`, `src/services/dashboard/subscriptionFinancialControlNoTxnService.js` | refund settlement and admin financial control | guarded Payment claim, refund idempotency and independent reconciliation; never issue the external refund twice on replay |
| `src/services/fulfillmentService.js`, `subscriptionDayConsumptionService.js`, `subscriptionDailyAddonService.js` | pickup/fulfillment claims, consumption and add-on movements | status CAS and unique allocation/release keys; test crash boundaries and concurrent repeated requests |
| `src/services/pos/financialLedgerService.js` | POS invoice/ledger/refund/balance/operation | **Isolated Staging only**. Uses native Mongoose transaction, per-operator pending operation, unique idempotency key and refund-balance CAS. Must **fail closed** without replSet; not a Production standalone fallback |
| `src/routes/dashboardDailyCashClosings.js` | daily close draft/submit/approve | Single-document `findOneAndUpdate` state CAS and snapshot; no multi-document transaction. Date unique index; approve after successful submit only |

There are additional writes in the codebase; this inventory focuses on explicit session consumers and their delegated financial/operational paths. Before conversion, use repo-wide static discovery for `startSafeSession`, `startTransaction`, `withTransaction`, `startSession`, `supportsTransactions`, `Payment.findOneAndUpdate` and irreversible external effects. Review every changed call graph and attach a standalone fault-injection test for each unresolved gap. **No evidence of rollback** is not evidence of safety.

## Production conversion procedure — **runbook only; never run without a new explicit owner approval**

**Prerequisites & stop conditions:**
1. Verify Railway project/environment/service IDs **against Production**, latest build, volume mount, observed disk space, MongoDB 8 compatibility, client connection strings, service-level SLOs, all jobs/writers, and health checks. Freeze jobs and writes during cutover; do not run the live app with a stale standalone URI.
2. Prepare two independent encrypted, access-controlled backups **outside the Production volume**: a verified consistent `mongodump --oplog` only if supported by current source topology/tool semantics, otherwise take a **quiesced** full logical dump plus Railway volume snapshot while writes are stopped; maintain at least one verified rollback copy. Because standalone cannot supply an oplog-backed continuous backup, prefer **stopping writes** and using a consistent backup method. Inventory document counts, BSON hashes and index definitions. Do not copy PII to Staging. A full backup must remain under authorized Production backup controls, not in GitHub/chat.
3. Restore a **separate sanitized/synthetic** backup to isolated disposable Staging MongoDB 8 with a separate volume and credentials. Confirm expected counts, index uniqueness, authentication, read/write, log replay, and that the destination DB name is not shared with a live Production application. This is the rehearsal input; **never use a full Production customer-containing dump in Staging**.
4. Generate private key **on the isolated database volume** using a secure source, e.g. `umask 077; openssl rand -base64 756 > /data/db/rs0-keyfile`; `chown mongodb:mongodb /data/db/rs0-keyfile`; `chmod 400 /data/db/rs0-keyfile`. Ensure runtime user can read it, file is not a directory, and its bytes are excluded from logs, backups sent to development, code and URLs. Do not store plaintext keyfile in a Railway environment variable or GitHub.
5. **Change only the database service start command** in an authorized cutover:
   ```sh
   mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth
   ```
   Verify persistent `/data/db` is still mounted and the existing admin credentials/roles remain intact. Avoid blindly restoring root credentials or running `rs.initiate` on the wrong service.
6. In the database container, authenticated as a principal with replica set privileges, run **once**:
   ```js
   rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb.railway.internal:27017" }] })
   rs.status()
   db.hello().isWritablePrimary
   ```
   Confirm the host resolves **from the backend service** and is the actual private DNS name. Ensure `PRIMARY`, majority write concern, authenticated `ping`, and write/retry acceptance before enabling traffic. `rs.initiate` on this target may need a temporary `directConnection=true` client.
7. Keep Production **database name `test`**. Example shape of the application connection URI (password **placeholder only**):
   ```text
   mongodb://<user>:<urlencoded-password>@mongodb.railway.internal:27017/test?authSource=admin&replicaSet=rs0&directConnection=true
   ```
   Change the actual configured application Mongo URI variables only in the authorized maintenance step. Restart all consumers (also refreshes cached transaction capability). No reference to Staging's `basicdiet_pos_staging_test` in Production. Verify `hello.setName === "rs0"` and an atomic two-collection rollback probe using **new isolated throwaway records in the Production `test` db only with explicit owner approval**.
8. Re-enable writers in stages, verify live subscription create/renewal, payment idempotency, deductions, webhooks, delivery, refunds, and scheduled jobs; monitor 5xx, connections, replica state, replication/keyfile auth errors, and financial reconciliation.

**Rollback**: before any write migration, retain the original standalone start command and all original URIs as a secure change record. If failure **before** accepting new rs0 writes, freeze writers, restore the original command, remove replicaSet URI params, restart services, test transactions capability fallback and operational health. If writes have occurred **after** new rs0 operation begins, **do not blindly start the modified volume as standalone** or restore an old backup: this may lose accepted financial events. Stop writes, capture fresh backup and consult qualified DB recovery staff for a point-in-time, no-double-payment reconciliation. Revert using a verified clean volume/restore plan with business sign-off, then replay/reconcile each payment/meal movement. Preserve WAL/oplog and application logs for incident analysis. Never roll back automatically after financial writes.

**Downtime**: reserve a **30–60 minute staffed maintenance window** for backup verification, database restart/primary election, client reconnect, and acceptance; the actual outage may be shorter or longer depending on volume size and Railway deployment. Single-node replica set provides transactions **but no HA** — any node outage is an outage.

## Staging-only rehearsal acceptance gates (NOT YET EXECUTED)

- Disposable MongoDB 8 on a **different Staging service and volume**; never connect the rehearse client to Production service/host, public TCP proxy, or `test`.
- Synthetic/sanitized fixture only. Restore with `mongorestore`; verify count/hash/indexes and absence of `users`, `payments`, `subscriptions`, `orders` copied from Production; create all test users/subscriptions **locally**.
- First run standalone with auth, verify `hello.setName` missing and `startSafeSession.supportsTransactions === false`; exercise the same subscription/meal-deduction scenarios with retries and deliberate partial failures. Mark uncovered saga windows.
- Restart **only disposable clone** with rs0+keyfile+auth, `rs.initiate` and `PRIMARY`; verify actual transaction commit/rollback and all POS F/G CI tests; then rehearse rollback of the still-disposable clone before any finance acceptance.
- Collect: test commands, sanitized fixture checksum, timestamps, backup/restore checksum, command/URI templates (no secrets), primary-election observed downtime, 5xx/latency, invoice/Payment balance in halalas; attach CI artifacts to G0 PR.
- **Hard stop** if backup restore, auth, URI isolation, indexes, synthetic-only attestation, business calculations or rollback rehearsal fail.

## Public TCP proxy decision

Railway shows an **ACTIVE** Production MongoDB public TCP proxy. The available Railway network-flow sample contains only service-peer flows; that does **not** establish historical or external usage is zero. Audit client IP/service inventory, connection logs, external admin tools and any off-platform workers first. Migrate authorized clients to private `mongodb.railway.internal` or a controlled VPN/bastion; then request Production owner approval to **remove the public TCP proxy** and monitor. **Do not disable it now** because Production usage is not conclusively known.

## Privacy-safe seed/export policy

- Production export requires a **new explicit owner approval** naming collection allowlist, projected fields, responsible operator, destination and retention policy; nothing has been exported.
- Allowed only: `plans`, `zones`, `menuCategories`, `menuProducts`, `menuOptionGroups`, `menuOptions`, `addons`, `mealBuilderConfigs`, `settings` (menu components are a single approved `menu` category). No customer or financial collections.
- Export should be projections of approved business config only; scrub `createdBy`, `updatedBy`, emails, phones, addresses, secret tokens, arbitrary PII/Freeform metadata, and source credentials. Review locale strings, `settings.value` and menu descriptions manually before release. Provide schema validation/strict field whitelist and SHA-256 manifest.
- Seed target **only** dedicated `mongodb-qxhu.railway.internal/basicdiet_pos_staging_test` and use isolated synthetic customers with fake, non-routable numbers. An import must never infer Production URI from `MONGO_URI`; no auto-run on application startup.
- Existing `scripts/pos/buildSanitizedStagingFixture.js` is an offline product-only sanitizer that **does not connect to a database**. Reuse it for menu drafts rather than passing raw dumps through the app. New Stage G seed tool should similarly fail closed on unexpected collections and obvious PII.
- `G3` cannot start until configuration fixture approved, Staging seed attested, permissions enabled through existing APIs without bypass, and rs0/standalone CI pass.

Useful official references:
- https://www.mongodb.com/docs/manual/tutorial/convert-standalone-to-replica-set/
- https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-with-keyfile-access-control/
- https://www.mongodb.com/docs/database-tools/mongodump/
- https://www.mongodb.com/docs/database-tools/mongorestore/
