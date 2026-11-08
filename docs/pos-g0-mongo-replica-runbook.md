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

**Release gate:** the read-only `scripts/pos-g0-transaction-inventory.js` now scans all `src/` JavaScript/TypeScript transaction API calls; CI uploads `pos-g0-transaction-callsites` JSON for manual sign-off. This is a syntax call-site inventory, **not proof that every financial flow has safe CAS/idempotency**, and it does not statically resolve dynamic wrappers or plain `session` options. Independently inspect dynamically installed routers and session writes; mark every financial path PASS/FAIL on both replica and standalone with crash/fault injection. Anything unknown is a blocker.

## Production single-node rs0 runbook — **DO NOT EXECUTE WITHOUT EXPLICIT OWNER APPROVAL**

All commands below are **instructions only**, with placeholders; never run on Production as part of G0.

### Preconditions, backup and restore verification
1. Book a maintenance window and arrange branch manager sign-off; stop writes (API/app/worker/webhook ingestion), queue inbound webhooks safely, capture collection counts and payment/entitlement reconciliation. Define rollback owner and a second operator.
2. Verify existing `mongod` version and `db.adminCommand({hello:1})`, auth settings, `/data/db` mount, available disk, exact Mongo URI, driver topology, public proxy consumers. Inventory all external clients **before** closing a public proxy.
3. Take encrypted, access-controlled **full backup of Production `test` plus essential auth metadata** using a trusted offline process, with point-in-time/write-free consistency. Store outside the Railway volume. **Never restore customer PII to a shared Staging environment.**
4. Restore-test the **full** backup only inside a secured, Production-designated recovery boundary under separate owner authorization, never on Staging and never on any host accessible to test accounts. If this is not authorized, mark full restore verification as **NOT DONE** and prohibit the Production migration. The G0 rehearsal on Staging must restore only a **separate synthetic/approved sanitized config-only backup**, with no customer, subscription, payment or personal records from Production. For either allowed restore, verify restore exit code and allowed collection/index counts; record SHA-256 manifest, backup time and evidence without exposing data.
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

---

## G2 additive preparation (2026-11-08) — STOP: planning + disposable CI ONLY

This section **updates the G0/PR #204 runbook in place**; the G0 evidence remains, but its timing assumptions are superseded by measured G2 CI results when available. No Production, Railway, TCP proxy, deployed service, variable, or real dataset was contacted or modified during phase A. No Production migration approval, deployment, staging rehearsal approval, backup contents or currently selected Railway plan can be inferred from this PR.

### A. Code-only Mongo consumer inventory; Railway inspection explicitly deferred

| Service / workflow | Variable names (names only) | Code resolution / evidence | Verification gap |
|---|---|---|---|
| Production `basicdiet145` backend, including API, webhook handlers, cron loop | `MONGO_URI`, `MONGODB_URI`, `MONGO_URL` | `src/db.js` calls `resolveMongoUri()` in `src/utils/mongoUriResolver.js`: non-test priority **MONGO_URI → MONGODB_URI → MONGO_URL**. All Mongoose models, webhook handlers and `src/jobs/index.js` use the same default connection. | Exact set of configured keys and connection topology on Railway NOT checked. |
| Tests / explicitly test-mode Node processes | `MONGO_URI_TEST` | `resolveMongoUri()` uses `MONGO_URI_TEST` ONLY when `NODE_ENV=test`; `src/utils/posStagingRuntime.js` rewrites that key only for isolated POS Staging. | Never treat an application Production variable with “TEST” in its name as proof of isolation. |
| Owner-reported Production backend variable | `MONGODB_URI_TEST` | Not referenced in `resolveMongoUri()`; different spelling from the actual test resolver `MONGO_URI_TEST`. This is **not proof that all scripts/tools ignore it**. | Owner approval to remove requires read-only Railway key inventory + search of external tools and ad-hoc tasks. **Do not remove now.** |
| Production MongoDB service | `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `G2_RS0_KEYFILE` (proposed) | Server start command, auth and volume; service **provides** MongoDB, not an application Mongo URI consumer. | Actual complete set of currently configured keys and image UID must be checked in authorized maintenance window. |
| Other services in Railway project `dependable-alignment` / Production | All keys matching `*MONGO*` | No Railway access permitted for phase A; source code alone cannot enumerate every deployed service or its environment variables. | **Unverified**. Authorized read-only Railway inventory required BEFORE cutover, with service name + key name only; no values. |
| External clients of public TCP proxy | Unknown | G0 notes a proxy exists; static source and known host mention do NOT prove an active client or non-use. | Owner: identify off-platform scripts, BI tools, third-party clients, backup agents, IP/network telemetry. **Do not disable proxy on assumptions.** |

For Production data `test`, the application URI **shape only** (not a usable credential or actual hostname) after the migration is:
`mongodb://<USER>:<PASSWORD>@<PRIVATE_DNS>:27017/test?authSource=admin&replicaSet=rs0`.
Preserve the *actual* original authentication database and TLS flags as verified. The member advertised in `rs.conf()` must be a stable private DNS name resolvable **from each backend and Mongo client**; do not use an ephemeral hostname or 127.0.0.1 for Production. Railway-internal application clients ordinarily should discover the member with `replicaSet=rs0`, without `directConnection=true`. If an externally proxied single endpoint cannot resolve advertised private member DNS, `directConnection=true` **may be necessary as a temporary single-node connection workaround**, but this reduces topology discovery and does not cure proxy security/exposure; validate every external consumer separately. Source: https://www.mongodb.com/docs/drivers/node/current/connect/connection-targets/

### B. Downtime / Moyasar / recovery risks

`src/jobs/index.js` runs one guarded loop each 60 seconds, with (1) due-delivery notification, (2) `processPaidSubscriptionPaymentRecoveries`, (3) 15-minute abandoned-promo cleanup, (4) cutoff, (5) reminders. During X minutes database unavailability, DB reads/writes fail and cron operations log failures; in-memory schedules are NOT a durable queue. At restart some date-eligible jobs may run late, but failure/restart before a durable result may cause partial work or repeated notifications. Put writes into maintenance mode **before** DB interruption, including API, workers and Moyasar reception. Do not acknowledge a webhook 2xx until its durable receipt/processing policy is understood (see caveat below).

Moyasar's documented behavior: the receiver is instructed to promptly return 2xx; if it does not, Moyasar retries five more times, with the published retry schedule (immediate, 1 minute, 10 minutes, 30 minutes, 1 hour, 2 hours), then drops the message: https://docs.moyasar.com/api/other/webhooks/webhook-reference . Therefore an outage lasting X minutes can miss delivery after the retry budget; a 2xx emitted BEFORE a durable DB write can permanently hide an event. Query the Moyasar **payment list/API and webhook attempts** for the maintenance interval, and reconcile by payment/invoice ID rather than assuming delivery. Official attempts API: https://docs.moyasar.com/api/other/webhooks/attempts/list-attempts .

`src/services/subscription/subscriptionPaymentRecoveryService.js` finds `Payment` rows already stored as `paid` with `applied=false` or missing `subscriptionId`, sorted and capped per batch (max 100), with retry-at timestamps and 10-minute next-retry on failures. It **cannot discover a provider-paid transaction whose webhook never created/marked a local Payment as paid**. It does not cover every order/refund variant. Mandatory post-cutover: independent provider-led reconciliation of paid/refunded events, duplicate/cancelled drafts, entitlements/stacking balance, refund ledger, and payment counts; sign off before reopening payments.

### C. G2 files, explicit owner review and commands (DO NOT RUN NOW)

All G2 scripts are stored in the repository; none is invoked by backend startup or Railway in this PR:
- `Dockerfile.g2-mongo` packages the Mongo 8.0 startup wrapper into the Mongo image. **A Railway Mongo service based on the existing raw Mongo image cannot execute scripts in this backend repository without building/deploying that image or explicitly mounting the script.** No change to existing Mongo service is attempted.
- `scripts/g2-mongo-start-rs0.sh` requires `G2_OWNER_APPROVED=true` outside CI; requires root at bootstrap (`RAILWAY_RUN_UID=0`), an existing /data/db mount, the secret `G2_RS0_KEYFILE`, owner UID/GID from `id -u mongodb`/`id -g mongodb` (not blindly 999), chmod 0400; rejects unexpected key changes on restart; runs the **existing** `--ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false` plus `--replSet rs0 --keyFile /data/db/g2-rs0-keyfile --auth`.
- `scripts/g2-mongo-init-rs0.js` requires `G2_MONGO_URI`, `G2_RS0_MEMBER_HOST` (stable internal DNS), `G2_OWNER_APPROVED=true`; initiate command is repeat-safe (`G2_ALREADY_INITIALIZED`), confirms primary.
- `scripts/g2-mongo-backup.sh` writes gzip archive (`mongodump --archive --gzip`), SHA-256, and `collections-indexes.json` with counts and index descriptors only; runs under closed-to-writes state, stores archives outside volume. Credentials passed through mode-0600 MongoDB Database Tools `--config` file; no URI/secret echoed or passed in command-line arguments. Official database tools: https://www.mongodb.com/docs/database-tools/mongodump/
- `scripts/g2-mongo-verify.js` checks `hello.setName`, `isWritablePrimary`, a real committed transaction, an aborted transaction with no surviving write, then drops its dedicated verification collection and compares counts/indexes from the manifest **both before and after**.
- `scripts/g2-mongo-restore.sh` requires explicit `G2_RESTORE_EMPTY_TARGET=true`, archive checksum, an empty target DB, then `mongorestore --archive --gzip --stopOnError` and exact count/index manifest equality. It does **not** restore Mongo users from the application DB dump: provision appropriate admin access separately and securely. Official database tools: https://www.mongodb.com/docs/database-tools/mongorestore/
- `scripts/ci/g2-mongo-migration-drill.sh` and `.github/workflows/g2-mongo-replica-ci.yml` are restricted to GitHub Actions with disposable localhost Mongo 8.0. They contain only synthetic subscription/payment/invoice records; archive never uploaded or retained.

| Order / command (placeholder names, NOT executed) | Owner | Verification and STOP condition |
|---|---|---|
| 1. Approve owner schedule, freeze write-capable API, jobs and payments; announce maintenance to branch staff | Owner + operations lead | Written approval and inbound payment acceptance blocked; STOP if any ongoing writers/unidentified TCP consumers. |
| 2. Authorized read-only Railway **key-name** inventory for EVERY service in `dependable-alignment` Production + TCP proxy consumers (no values) | Owner + Railway operator | Complete service/key matrix signed; STOP on unknown worker/proxy client. |
| 3. Save existing Mongo image/version/startCommand, current volume identity and mount `/data/db`, account plan, config rollback, free space and backup safety | Railway operator | Independent verified recovery point; STOP if volume cannot be preserved or access boundary uncertain. |
| 4. Freeze all writers and record baseline: `G2_EXECUTION_SCOPE=owner-approved G2_OWNER_APPROVED=true node scripts/g2-mongo-manifest.js --out <SECURE_DIR>/before.json` | DB owner | Collection counts/indexes only; STOP on live writes or insufficient permissions. |
| 5. `G2_BACKUP_DIR=<SECURE_DIR> bash scripts/g2-mongo-backup.sh` while writes frozen. Verify `sha256sum -c ...`, archive and separate secure copy | DB owner | SHA-256 + count/index manifest and recovery-tested backup; STOP if archive not verified. Capture admin-user/auth backup separately under secure operator procedure. |
| 6. **Only after successful approved restore rehearsal:** stop old standalone Mongo, retain same original Railway volume `/data/db`. Stage new Mongo image using `Dockerfile.g2-mongo` and the exact wrapper command; set `G2_RS0_KEYFILE` (secret), `G2_OWNER_APPROVED=true`, `RAILWAY_RUN_UID=0` | Railway operator | Keyfile root-written, chmod 400, owned by image `mongodb` UID; STOP if restart/bind/auth differs from baseline or any existing writer returns. |
| 7. Start Mongo on same volume; `mongosh --quiet --nodb --file scripts/g2-mongo-init-rs0.js`, using private `G2_MONGO_URI` + `G2_RS0_MEMBER_HOST` from protected env | DB owner | `G2_RS0_PRIMARY` or `G2_ALREADY_INITIALIZED`, internal host resolvable, `hello.setName=rs0` and primary; STOP on timeouts, hostname mismatch or wrong node. |
| 8. `node scripts/g2-mongo-manifest.js --compare <SECURE_DIR>/collections-indexes.json`; `node scripts/g2-mongo-verify.js <SECURE_DIR>/collections-indexes.json` | DB owner | All collections and indexes match; commit and abort PASS; STOP on any mismatch. |
| 9. In controlled staged Railway changes update **all actual Mongo URI consumers** to the approved private rs0 URI. Keep Production `NODE_ENV` unchanged and do not activate POS; do not modify proxy yet. | Backend owner | Health, actual Mongoose/`startSafeSession` transaction support and log probes PASS; STOP if any process resolves wrong variable or advertised hostname. |
| 10. Validate subscriptions, renewals, cashier deduction and promo/cancellation idempotency, queued job restarts, Moyasar provider-led reconciliation and refund safety | Business owner + payment operator | Provider payments vs local entitlements balances and transaction abort PASS; STOP on unexplained payment, duplicate or partial apply. |
| 11. Unfreeze controlled traffic; observe for ≥30 min, monitor error rates/replica primary/oplog/disk; record operator sign-off | Owner + on-call | STOP / re-enter maintenance on any divergence. Do not enable POS Production until separate owner go-live. |

**G2 CI baseline, first successful disposable Mongo 8.0 run (GitHub Action 42512441693):** The archive contained **five synthetic documents**, **three user-defined unique indexes**, and no real client data. All source/target collection counts and indexes matched, both commit+abort tests passed, the actual backend transaction-support check passed, 20/20 POS financial unit tests passed. No Production connection. Precise durations below were measured with milliseconds wall-clock around each CI step on an ephemeral GitHub runner:

| Step | CI measured (ms) | Approx seconds |
|---|---:|---:|
| Standalone source start + authentication readiness | 2266 | 2.266 |
| Seed synthetic subscriptions/payments/unique indexes | 2217 | 2.217 |
| Logical archive + SHA-256 + manifest | 190 | 0.190 |
| Stop source Mongo gracefully | 150 | 0.150 |
| Restart same volume with keyFile/rs0/auth | 1893 | 1.893 |
| Initiate rs0 and elect PRIMARY | 1427 | 1.427 |
| Re-run initiation (idempotence check) | 403 | 0.403 |
| Compare source document counts and indexes | 152 | 0.152 |
| Verify commit, intentional abort and cleanup | 178 | 0.178 |
| Verify backend transaction support | 234 | 0.234 |
| POS financial tests, 20/20 | 280 | 0.280 |
| Start isolated empty restore destination | 3247 | 3.247 |
| Stop destination | 173 | 0.173 |
| Restart destination same volume in rs0 mode | 1870 | 1.870 |
| Initiate destination PRIMARY | 1547 | 1.547 |
| Restore archive and compare all counts/indexes | 521 | 0.521 |
| Verify restored commit/abort | 170 | 0.170 |
| **Sum of instrumented operations (not full CI job)** | **16918** | **16.918** |

Synthetic **source interruption steps only** (graceful stop + rs0 restart + initiate + counts/indexes + transaction verification + backend capability) totaled **4034 ms ≈ 0.067 minutes**. This is NOT the expected Production downtime: it excludes backup size, application restart, payment reconciliation, DNS/network propagation, disk I/O, and any failure. Planning reservation 60–120 min is a risk allowance only; require an owner-authorized full-size safe restore rehearsal and real data size/disk benchmarks before the maintenance window can be signed off.

**Operational timing and maintenance window:** The G2 GitHub CI will emit `G2_TIMING step=... duration_ms=...`. These are measurements against five tiny synthetic documents and **must not be extrapolated linearly to Production**, especially backup/archive/restore/storage I/O. Until dataset size and approved full restore drill are measured, provision a **60–120-minute reservation AFTER completion of a verified backup**, with an unlimited rollback contingency; this is a cautious planning range, **not a guaranteed downtime figure**. Keep a separate real-data backup/restore time allowance; no safe exact downtime is available from CI alone. Record actual timings in the runbook addendum following CI.

**Rollback A, ZERO writes accepted since restart:** freeze clients, save conversion logs, validate no new business writes against pre-change counts/payment state, stage old Mongo image/start command and original application URI(s) onto same unchanged volume, verify standalone + preserved counts, then reopen **only with owner authorization**. Do not assume direct downgrade if Mongo metadata/FCV has changed: verify against a rehearsal first and use a backup restore instead if unsafe.

**Rollback B, ANY new writes since restart:** NEVER blindly start old standalone, restore stale snapshot, or delete rs0 metadata. Keep isolated rs0 volume intact and suspend payments. Take a fresh read-consistent backup with post-change events/oplog if supported, and reconcile provider-paid/refunded identifiers, subscription entitlements, POS ledgers, operation idempotency keys and timestamps. Restore to a fresh isolated replica set and replay/merge **all after-cutover writes exactly once** under a documented, reviewer-approved reconciliation plan; switch application pointers only after financial checksum and owner sign-off. If not reconciled, extend maintenance and retain rs0 — never lose settled payments.

**Railway scheduled backups:** Official docs support manual and daily (24h, 6-day retention), weekly (7d, 27d) and monthly (30d, 89d) schedules on volumes; backup/restore UI stages a *new* volume on restore and **only restores inside the same project + environment**. See https://docs.railway.com/volumes/backups and https://docs.railway.com/volumes/reference . Backups cost incremental used storage. The current account plan, current scheduled backup configuration, eligible volume size/capacity and billing **were not read**, so **not verified for this Production service**. Recommend enabling daily + weekly + monthly for Mongo volume with alerting and periodic restore drills after owner authorizes changes. Native Railway volume backup **cannot be used to clone Production into Staging across environments**; phase B instead uses an existing explicitly authorized archive in the separate Staging bucket.

**Post-conversion metrics:** poll `hello.isWritablePrimary` and `hello.setName` (every minute), `local.oplog.rs` stats size/count and first/last time (oplog window), `dbStats` counts/storageSize/indexSize, `df -h /data/db` (bytes, inode/free space), Mongo process memory/disk IOPS, payment recovery backlog/error counts, webhook 5xx and provider-vs-local paid count. Raise alerts on loss of primary, low free space (<20%), shrinking oplog window relative to expected outage duration, no backup success, and any payment/entitlement discrepancy. A single member does **not** supply failover.

### D. Phase B — Railway Staging isolated restore drill: PLAN ONLY; NOT AUTHORIZED

**Permission gate:** Do not create, stage, deploy or remove ANY Railway resource until a **new, explicit owner approval for phase B**, including the service, variable names, safe archive provenance and deletion. No existing Production read/connection, no additional Production backup, no Production settings changes.

1. **Archive source gate.** Owner identifies the existing object in the Staging-only backup bucket, expected SHA-256 and format; verify from existing metadata without creating any new Production read. If archive contains unsanitized Production PII or payment records, **STOP**: do not import to ordinary Staging; use a separately approved restricted recovery boundary with audited access, encryption, test-safe credentials and defined retention/destruction, or use synthetic/sanitized archive instead. No customer rows printed.
2. **Staged Railway changes (exact proposed delta, NONE applied):** Create new service `g2-mongo-restore-drill` in Staging, sourced from this branch with Dockerfile path `Dockerfile.g2-mongo`, image base `mongo:8.0`. Create ONE fresh isolated volume with mount `/data/db`, no attached application, no TCP proxy, no public domain/port, one container only; set `RAILWAY_RUN_UID=0`, `G2_OWNER_APPROVED=true` (only after approval), `G2_RS0_KEYFILE` secret, `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD` (dedicated ephemeral bootstrap credentials), `G2_RS0_MEMBER_HOST` internal DNS from the new service, `G2_EXECUTION_SCOPE=owner-approved`, and `G2_MONGO_DB` matching the approved archive DB. Confirm official mongo:8.0 first-boot admin creation before rs.initiate; STOP if it fails. Set restricted `G2_MONGO_URI` only in an operator-controlled job/shell, never public/stored in docs. Other bucket retrieval variable **names only**, depending on authorized storage provider: `G2_STAGING_BUCKET`, `G2_STAGING_ARCHIVE_OBJECT`, `G2_STAGING_ARCHIVE_SHA256`, `G2_STAGING_BUCKET_READ_ID`, `G2_STAGING_BUCKET_READ_SECRET`. No actual credentials requested or read in phase A.
3. **Startup staged command:** `/usr/local/bin/g2-mongo-start-rs0` from the new image, with `G2_RS0_KEYFILE` at /data/db/g2-rs0-keyfile (0400, owner mongo UID), preserve base flags, rs0, auth, and volume. Pre-provision **synthetic** Mongo admin credentials inside this isolated volume according to an approved bootstrap process (the wrapper does not create Mongo users). STOP if credentials/bootstrap cannot be secured or Mongo cannot authenticate.
4. **Initialize & verify:** run `mongosh --quiet --nodb --file scripts/g2-mongo-init-rs0.js` from a securely connected operator runtime, confirm `hello`; fetch only the existing **approved Staging bucket archive** to a mode-0700 temporary directory, validate checksum; `G2_RESTORE_EMPTY_TARGET=true G2_BACKUP_DIR=<SECURE_DIR> bash scripts/g2-mongo-restore.sh`; then `node scripts/g2-mongo-verify.js <SECURE_DIR>/collections-indexes.json`. Benchmark upload/download, startup, init, restore, manifest and abort/commit separately. If object lacks valid count/index manifest or checksum: STOP.
5. **Isolation proof, staged changes and cleanup:** verify Staging API/production services have not been repointed; verify **no TCP proxy and no public endpoints**, no shared Mongo volume, no cron jobs/notifications, only synthetic/test identities. Record sanitized timings and indexes/counts, NOT documents. With a **separate deletion approval**, delete the temporary service and its volume and rotate/remove temporary secrets/backup files. Never delete the source Staging bucket backup or alter existing Mongo staging service.

**Expected Railway staged changes (preview; pending approval):** +1 new Staging Mongo service (source branch + custom Dockerfile), +1 new disposable /data/db volume, +new service variable names above, +private-network configuration only, 0 public TCP proxies, 0 Production changes, 0 existing app/service URI changes; cleanup later removes ONLY this temporary service and volume on independent approval. Actual UI staged-change diff remains **NOT VERIFIED** until phase B authorization.

### Owner decision gates (not yet approved)
1. Maintenance window (date + Riyadh clock time), owner/operator, merchant/branch notification, and realistic allowed downtime.
2. Identify public TCP proxy clients, then explicitly keep/remove/replace proxy **in a later approved change**; external clients remain unknown.
3. Fate of `MONGODB_URI_TEST` in Production: retain until read-only full-service key inventory and script search; approve deletion only if demonstrably unused; don't confuse with `MONGO_URI_TEST`.
4. Scheduled Railway volume backups: daily/weekly/monthly and retention/cost; obtain actual Railway plan, storage capacity and existing schedule as a separate read-only approval.
5. Phase B: authorize isolated service + approved **sanitized** Staging bucket archive + role/PII boundary + its eventual deletion. This G2 Draft PR requests **no** execution authority.
