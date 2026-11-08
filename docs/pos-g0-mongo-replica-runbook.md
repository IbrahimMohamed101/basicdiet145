# POS G0 — MongoDB transaction risk, migration runbook (NO PRODUCTION EXECUTION)

Status: **read-only assessment / staging rehearsal required**. Prepared 2026-11-08. Database name in Production: **`test`**.

## Verified Railway configuration

| Environment/service | Evidence | Finding |
|---|---|---|
| Production / MongoDB (`3375e020-...`) | Railway service config `deploy.startCommand` | `docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false`; **no `--replSet`**. Mounted `/data/db` volume. |
| Production / MongoDB | Railway networking | ACTIVE **public** TCP proxy `hayabusa.proxy.rlwy.net:59730` → MongoDB port `27017`; existence does **not** prove actual usage. |
| Staging / MongoDB-qxhu (`0846899c-...`) | Railway service config | `mongod ... --replSet rs0 --keyFile /data/db/rs0-keyfile --auth`; private endpoint and no TCP proxy. |
| Production / basicdiet145 | Environment variables only | Connector redacts secret values. Do not read, print or copy credentials or URI. |
| Application `src/utils/mongoTransactionSupport.js` | Repository source | `checkMongoTransactionSupport` uses `hello.setName` / `msg === isdbgrid`; when unsupported, `startSafeSession` replaces `startTransaction`, `commitTransaction`, `abortTransaction` with no-ops and `withTransaction` with direct invocation. **No cross-document rollback** in that mode. The detection flag is process-wide cached; assess connection identity if introducing multiple Mongo connections. |

Configuration is evidence of a standalone server; a runtime `hello`/driver topology check should still confirm this during an authorized read-only window. This document does not claim a connection or topology probe was executed on Production.

## Transaction-dependent operational routes and guards — review register

The following is a **priority register, not a claim that every transaction caller in the repository has been exhaustively inventoried**. Search all application code and dependency-injected route adapters before any Production migration approval. A guard listed as *required* is not asserted implemented without an integration test.

| Flow/source | Transaction-dependent writes / risk on standalone | Independent safeguard / action |
|---|---|---|
| POS staged sales — `src/services/pos/financialLedgerService.js` | Invoice, ledger, counter, audit, durable operation in one Mongo transaction | **Already staging-only**; `pos_operations` pending fence, unique idempotency key, one pending per actor+kind, and transactional commit. **Fail closed on standalone**, do not attempt multi-document POS sale there. |
| POS staged refunds — same service | Refund balance, refund document, negative ledger entry, operation state | Partial quantity conditional update + unique key; still **requires replica-set atomicity** for the whole bundle. Reject non-transaction topology. |
| Dashboard subscription activation / renewal / stacking — `dashboardSubscriptions` and related subscription/payment services | User entitlement, Subscription, Payment, promo redemption, stacking batches may diverge | Check unique `paymentId`, paid-state idempotency, CAS on draft status, entitlements and compensation/reconciliation records; verify standalone repeated requests and mid-operation faults **before** relying on them. |
| Manual subscription deduction — `src/services/dashboard/manualDeduction/*` and `manualSubscriptionDeductionService.js` | Balance/deduction history and per-day state may split | Per-operation idempotency and conditional remaining-balance mutation (CAS); ensure no duplicate deduction after a process crash. **Standalone fault test required.** |
| Quick-day deduction / cashier consumption — `subscriptionQuickDayDeduction*`, cashier consumption | Reserved/available entitlement vs per-day entry and audit | Conditional mutation, logical key per subscription/date, reconciliation on partial failure; avoid unsafe blind retry. |
| Subscription planning and addon claims — `installSubscription*Write* `, `installSubscription*Reservation*` and entitlement flows | Day selection, pooled balance, addon reservation allocation and expiry | Unique lock/operation identity and CAS of entitlement balances; reconcile orphaned reservations; standalone fault test. |
| Payment webhook and recovery — `paymentApplicationService`, `paymentFlowService`, `moyasarService`, `reconciliationService` | Payment paid but activation incomplete | Payment ID unique, webhook idempotency + recovery job; compare paid provider evidence against entitlement and checkout-draft state. |
| Subscription cancellation/refunds — `paymentRefundService`, dashboard financial control | Refund and subscription state diverge | Refund unique provider/reference, CAS transition, durable compensation and reviewer approval; no second payout on timeout. |
| One-time orders / courier fulfillment — `orders/*`, `deliveryWorkflowService`, dashboard ops | Order status, invoice, stock/fulfillment event may split | CAS expected previous status, unique command key, idempotent fulfillment and auditable reconciliation. |
| Daily cash closing — `dashboardDailyCashClosings.js` | New/draft/submit/approve and immutable snapshot | Single unique businessDate + status-conditional updates and optimistic concurrency. Expected server totals frozen at submit; admin-only approve. |
| Customer account merge and manual compensation | Two account/balance identities may diverge | Operation lock/idempotency + explicit compensation, never rely on no-op transaction. Staging fault injection required. |

**Release gate:** create a machine-generated call-site inventory for `startSafeSession`, `startSession`, `withTransaction`, `startTransaction` and any `session` use in dynamically installed routers. Mark every financial path PASS/FAIL on both replica and standalone with crash/fault injection. Anything unknown is a blocker.

## Production single-node rs0 runbook — **DO NOT EXECUTE WITHOUT EXPLICIT OWNER APPROVAL**

All commands below are **instructions only**, with placeholders; never run on Production as part of G0.

### Preconditions, backup and restore verification
1. Book a maintenance window and arrange branch manager sign-off; stop writes (API/app/worker/webhook ingestion), queue inbound webhooks safely, capture collection counts and payment/entitlement reconciliation. Define rollback owner and a second operator.
2. Verify existing `mongod` version and `db.adminCommand({hello:1})`, auth settings, `/data/db` mount, available disk, exact Mongo URI, driver topology, public proxy consumers. Inventory all external clients **before** closing a public proxy.
3. Take encrypted, access-controlled **full backup of Production `test` plus essential auth metadata** using a trusted offline process, with point-in-time/write-free consistency. Store outside the Railway volume. **Never restore customer PII to a shared Staging environment.**
4. Independently restore the backup into a secured, isolated **non-Production validation host** with the same Mongo major version; verify restore exit code, document/index counts and representative cross-collection consistency; record SHA-256 manifest, backup time and successful restore evidence. The rehearsal within this project must instead use **synthetic/approved sanitized configuration-only data**, not Production customer records.
5. Record pre-change container/volume snapshot, current start command, `MONGODB_URI` (stored securely, not copied into documentation), and viable rollback point. Ensure persistent volume backups are immutable.

### Key file & startup (on a secured isolated replica rehearsal first)
```sh
# Run securely as a privileged init step with volume access; never print key material.
umask 077
openssl rand -base64 756 > /data/db/rs0-keyfile
chmod 400 /data/db/rs0-keyfile
chown 999:999 /data/db/rs0-keyfile  # verify Mongo image's actual UID/GID first
# Must exist before mongod starts; keep backups of file off the repo.
```
Use Railway's image-specific `mongod` invocation, mirroring Staging MongoDB-qxhu (add `--replSet rs0 --keyFile /data/db/rs0-keyfile --auth`, preserve current bind options). Confirm the key persists across restart and has strict filesystem permissions. Do not put key contents in logs, env output or Git.

### Initiate replica set
With authenticated `mongosh` on the container private network, after `mongod` starts:
```javascript
rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "<STABLE_PRIVATE_MONGODB_HOST>:27017" }] });
rs.status();
db.adminCommand({ hello: 1 }); // expect setName rs0 and isWritablePrimary true
```
Use a **stable, DNS-resolvable private hostname** reachable by all app instances (never `localhost` unless all clients share the Mongo process namespace). If initial authentication/bootstrap differs, follow the MongoDB localhost exception only with tightly controlled local-only access and remove it afterward; do not disable auth broadly.

### URI / application
Database path remains `/test`; preserve URL-encoded credentials and original `authSource` (typically `admin`). Example shape, **not a secret**:
```text
mongodb://<USER>:<PASSWORD>@<PRIVATE_HOST>:27017/test?authSource=admin&replicaSet=rs0
```
Do not set `directConnection=true` on a client required to discover the replica set; validate routing/hostnames and TLS configuration for the deployed environment. Update each relevant `MONGODB_URI`/resolved Mongo reference in a controlled staged change; redeploy application workers in a coordinated window. Health checks: basic CRUD, `hello`, *real transaction commit and deliberately aborted rollback*, index readiness, webhook idempotency, and POS/subscription accounting checks.

### Rollback
1. Stop writes. If transition has **not** processed any new writes, restore the original start command and original URI and restart the prior container using the unchanged volume; verify the standalone topology and app readiness.
2. If any new writes have occurred after conversion, **do not** blindly downgrade or restore the older volume: this can lose money/customer changes. Retain the rs0 data, reconcile a newer backup/oplog/event journal and carry out a reviewed migration or point-in-time restore procedure. Preserve audit logs and consult MongoDB/Railway operators.
3. If the upgrade fails before app cutover, revert code/config atomically to the saved baseline and verify original API service reachability. Record incidents, re-enable worker traffic only after data/reconciliation sign-off.

### Downtime estimate (planning assumption, not a promise)
Allow **30–90 minutes maintenance window** for a single-node restart/rs.initiate, connection refactoring and verification, **excluding** backup/restore and incident recovery. An actual interruption may be longer; rehearsal and full dataset size will refine this. Single-node `rs0` supports transactions but **does not provide high availability**.

### TCP proxy decision
Production currently has an ACTIVE public MongoDB proxy. **Usage is unknown** from static service configuration. Check proxy traffic logs, app connection references, allowlisted clients and external integrations for at least a representative operational window. If none need it, remove it from Production **only after a separate approval and monitored cutover**, leaving MongoDB private networking enabled. If an external client needs access, migrate it to authenticated private tunnel/VPN with least-privilege before closure. No firewall, credentials, proxy or Production settings were changed.

## Rehearsal on Staging-only restored clone
Only a dedicated disposable staging service/volume and the explicit synthetic/sanitized backup may be used. Never point at Production TCP proxy/URI, never import PII and do not reconfigure the shared `MongoDB-qxhu` used by the current POS Stage F. Record backup checksum, restore count, `rs.initiate`, transaction rollback test, restart persistence, read/write API smoke and rollback trial. **Not executed yet**; no approved safe restore source has been provided.
