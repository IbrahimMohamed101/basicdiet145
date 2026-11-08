# POS G0 — MongoDB transaction risk, migration runbook (NO PRODUCTION EXECUTION)

Status: **read-only assessment / staging rehearsal required**. Prepared 2026-11-08. Database name in Production: **`test`**.

## ورقة ليلة التحويل — 8 خطوات، توثيق فقط (تحتاج موافقة جديدة قبل التنفيذ)

**STOP العام:** لا تغيير في Railway/Production ولا تشغيل لهذا الإجراء من PR #211. لا تستكمل إذا تعذّر إثبات النسخة الفعلية، سلامة النسخة الاحتياطية، عزلة الكتابة، أو صلاحية استعادة الخدمة. حدّد المشغّل والمراقب وخطة التعامل مع webhooks مسبقًا.

| # | الإجراء المستقبلي في Railway | المتوقع | متى نوقف وكيف نرجع |
|---|---|---|---|
| 1 | إيقاف كل الكتابة للباك إند والـ workers وطلبات الدفع/الويبهوك مع تجميد التسجيل، وتسجيل وقت البداية. | لا تغييرات جديدة في DB؛ خطة حفظ طلبات Moyasar معتمدة. | أي مصدر يكتب: STOP، أعِد إعدادات الخدمة الأصلية قبل لمس Mongo. |
| 2 | أخذ **Railway volume backup** للـ /data/db تحت وقف الكتابة والتحقق من إمكانية الاستعادة/الاحتفاظ بنسخة خارج مسار الفشل، بما فيها auth وkeyfile عند وجوده. | نقطة استرجاع محددة وموثوقة مع manifest أعداد وفهارس. | Backup غير موثّق أو بلا خطة restore: STOP، استمر بالتشغيل القديم. |
| 3 | قراءة نسخة Mongo الفعلية ثم pin لصورة `mongo:8.0.x` **المطابقة تمامًا** وإيقاف image auto-updates. | نفس الثنائيات، بلا ترقية ضمنية؛ إثبات الإعداد. | أي اختلاف في version/digest: STOP وأعِد إعداد الصورة السابق. |
| 4 | على خدمة Mongo نفسها وبنفس volume، أدخل Start Command الواحد من الملف المعتمد أدناه مع `G2_RS0_KEYFILE` في أول تشغيل فقط. | إنشاء keyfile بمالك mongodb و0400، أو إعادة استخدامه بلا إعادة كتابة؛ بدء mongod بوضع rs0+auth. | فشل البدء/الأذونات: STOP واسترجع startCommand السابق إذا لم تحدث كتابات؛ لا تحذف المفتاح ولا volume. |
| 5 | على **خدمة الباك إند فقط** حدّث `MONGO_URI` للـ private DNS مع `replicaSet=rs0`، واضبط `preDeployCommand=node scripts/g2-rs0-init-and-verify.js` بعد موافقة منفصلة `G2_OWNER_APPROVED=true`. | Node يتصل `directConnection=true` للتهيئة، عضو `mongodb.railway.internal:27017` يصبح PRIMARY، ثم backend يستخدم discovery. | أي فشل exit code: STOP، لا تفتح الكتابة؛ استرجع إعدادات app ومونجو المدونة عند عدم وجود كتابات جديدة. |
| 6 | راجع `hello` وcommit/abort وmanifest أعداد كل collection وفهارسها، واختبر readiness للباك إند؛ أزل موافقة G2 بعد نجاح التهيئة. | `rs0` PRIMARY والاختبارات كلها PASS بلا فروق. | اختلاف count/index أو عدم استقرار: STOP؛ لا تعِد كتابة البيانات أو الـ backup عشوائيًا. |
| 7 | افتح الكتابة تدريجيًا فقط بعد توقيع المشغّل والمراقب. | معاملات البيع والاشتراك تسجَّل مرة واحدة. | عند حدوث كتابات جديدة **لا تستخدم rollback عمياء إلى standalone أو backup أقدم**؛ جمّد الكتابة وابدأ reconciliation. |
| 8 | طابِق قائمة مدفوعات/محاولات Moyasar خلال فترة التوقف (ناجح، فاشل، مستردّ) مع Payment والاشتراكات والأرصدة/التسجيلات المحلية. | صفر عمليات مدفوعة بلا تفعيل، وصفر تفعيل مزدوج؛ محضر مطابقة. | أي فرق: أوقف المدفوعات الجديدة، سجّل الحالة وعالجها بخطة تصحيح معتمدة دون تكرار التحصيل. |

**أمر Railway Mongo Start Command الحرفي (لا تنفّذه الآن):**

```sh
/bin/sh -ec 'set -eu; if [ ! -e /data/db/rs0-keyfile ]; then test "$(id -u)" = 0; test -d /data/db; test -n "${G2_RS0_KEYFILE:-}"; umask 077; t=$(mktemp /data/db/.rs0-keyfile.XXXXXXXX); trap "rm -f $t" EXIT; printf "%s" "$G2_RS0_KEYFILE" > "$t"; chown mongodb:mongodb "$t"; chmod 0400 "$t"; mv "$t" /data/db/rs0-keyfile; fi; test "$(stat -c %a /data/db/rs0-keyfile)" = 400; test "$(stat -c %U /data/db/rs0-keyfile)" = mongodb; exec docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth'
```

**ملاحظة مهمة:** Railway pre-deploy للباك إند وليس لخدمة Mongo؛ ملف `/data/db` يُنشأ/يُفحص فقط عند بدء Mongo. تحديد backup سياسة تخزين keyfile قرار أمني منفصل. قائمة TCP proxy العامة تبقى كما هي حتى قرار لاحق. تنفيذ الخطوات يخضع لبروفة Staging صناعية ناجحة وموافقة تشغيل جديدة.

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

### Keyfile & image-source startup (G2 correction, NOT AUTHORIZED TO RUN)
The old ad-hoc random-key and guessed UID `999` instructions are withdrawn. The approved design is the existing **Railway Docker image source** (official `mongo:8.0`, patched to the exact installed `mongo:8.0.x` during an authorized maintenance window), a one-time secret-to-volume initialization, and a literal final start command; **no backend-repository Docker build, custom Dockerfile or `RAILWAY_RUN_UID=0` dependency**. Follow the normative G2 section C below. Never provision or start this process in this PR.
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
For private-network clients that resolve the advertised replica-set member DNS, prefer `replicaSet=rs0` **without** `directConnection`. For a retained public TCP proxy endpoint, external clients must use `directConnection=true` because they cannot resolve the advertised private member; validate each external client and TLS/auth settings. Update each relevant `MONGODB_URI`/resolved Mongo reference in a controlled staged change; redeploy application workers in a coordinated window. Health checks: basic CRUD, `hello`, *real transaction commit and deliberately aborted rollback*, index readiness, webhook idempotency, and POS/subscription accounting checks.

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

### C. Corrected G2 operator design — Railway image source only (DOCUMENTATION; DO NOT RUN)

Owner-reported Railway facts on 2026-11-08 (not re-read by this PR): Production MongoDB service `3375e020…` is official image `mongo:8.0`, start command `docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false`, 5 GB `/data/db` volume, private endpoint `mongodb`, active public TCP proxy and image `autoUpdates` configured (last update 2026-10-03). Production `basicdiet145` is the only service **reported** with Mongo URI variables; `basicdiet-landing` has none. Staging `MongoDB-qxhu` reportedly runs `rs0` + keyfile + auth on `mongo:8.0` since 2026-08-11. Treat these as dated owner-supplied observations; revalidate read-only at the later authorized maintenance gate. **No Railway action is part of this PR.**

**Mandatory preflight BEFORE any maintenance change:**
1. Obtain a separately approved read-only `db.adminCommand({buildInfo:1}).version` (and `mongod --version`) from the currently running Production MongoDB. Confirm the exact matching `8.0.x` version and image digest; do NOT guess `x`. Pin the Railway service Source to that exact `mongo:8.0.x` image **as an image source**, never the GitHub repo; record version/digest and confirm it is identical to the running binary. If not an exact match, STOP. Disable automatic image updates (configuration `autoUpdates.type=disabled` where managed as infrastructure-as-code, otherwise Settings → Source → Configure Auto Updates → turn OFF) and verify the setting really is disabled *before* the maintenance. The Railway docs confirm semantic-version tags can auto-advance and trigger redeployment: https://docs.railway.com/deployments/image-auto-updates and https://docs.railway.com/infrastructure-as-code/reference .
2. Before Phase B or cutover, an **authorized operator must delete** the legacy Staging service `pos-staging-mongo-copy-oneoff-20261108`, whose configuration reportedly still contains `PROD_MONGO_URI`; verify that no deployment, env reference, persistent job, public proxy or clone remains and retain audit evidence **without opening or printing the secret**. Never delete this service from this PR. If deletion is unapproved/unverified, STOP.
3. Confirm write freeze, full independently verified backups and recovery approvals, volume capacity/disk/headroom, exact existing auth/URI flags, secret rotation ownership, DNS reachability, and that the database user already exists on the **existing** Production volume. No re-initialization of the Production root user, no auth bypass, and no reliance on `MONGO_INITDB_ROOT_*` to create users on a populated volume.
4. Record a **one-week** read-only baseline of public TCP proxy inbound flow by origin/consumer, failed/successful connection attempts and traffic time windows, plus known external scripts/BI/tools. Railway aggregate network metrics alone cannot prove absence of external consumers. Do not disable the proxy until owners decide after this evidence.

**G2 approved code proposal, not deployed:** one idempotent Start Command is in `scripts/g2-mongo-final-start-command.txt` and reproduced verbatim on the night sheet. On first boot only, require root, secret `G2_RS0_KEYFILE`, atomic mktemp/printf/chown/chmod/mv; validate owner/mode on every boot. On later boots, the secret is **not required** and the existing keyfile is not overwritten. The same literal command directly execs the official `docker-entrypoint.sh mongod`. No separate initial keyfile command, `sleep infinity`, mongosh or Railway shell is required. Railway Start Command overrides image ENTRYPOINT; the inline /bin/sh supplies shell expansion; see https://docs.railway.com/deployments/start-command and https://docs.railway.com/volumes .

**Node preDeploy bootstrap and verification:** `scripts/g2-rs0-init-and-verify.js` runs from the backend container only with `G2_OWNER_APPROVED=true`. It connects directly to the private host, performs idempotent `replSetInitiate` for `mongodb.railway.internal:27017`, waits PRIMARY, verifies commit+abort and exact pre/post collection counts/index definitions; no URI or data logging. Distinct non-zero exit codes indicate blocked approval, unsafe target, init, PRIMARY timeout, manifest mismatch or failed transactions. Configure backend `preDeployCommand` only at separately approved maintenance, then remove the approval gate once complete. The old `scripts/g2-mongo-init-rs0.js` is legacy disposable reference, **not the Production path**.

**Connection policy proven by the intended CI topology:**
- Production backend on Railway private network: `mongodb://<USER>:<PASSWORD>@mongodb.railway.internal:27017/test?authSource=admin&replicaSet=rs0` **without** `directConnection`. This permits MongoDB driver topology discovery using the stable private advertised member. Preserve verified auth database, URI credential encoding and existing TLS options; `basicdiet145` is the only *reported* current Mongo variable consumer.
- If the public TCP proxy is retained, any **external** client needs its *existing actual public proxy host/port* with `?authSource=admin&replicaSet=rs0&directConnection=true`. A public client cannot follow the advertised private `mongodb.railway.internal` member. Keep =true for external proxy clients, and test every one. Alternative: after one-week network-flow monitoring + owner sign-off, retire the public proxy and use private tunnel/approved access instead. The two alternatives are an **owner decision**, not authorized here. See https://docs.railway.com/networking/tcp-proxy , https://docs.railway.com/databases/mongo-ha and https://docs.railway.com/networking/private-networking/how-it-works .
- Staging already uses `directConnection=true` (reported). This is acceptable for direct single-node paths but does not exercise replica set discovery, so GitHub CI now tests **both** `replicaSet=rs0` with no direct flag (`ReplicaSetWithPrimary`) and `replicaSet=rs0&directConnection=true` (`Single`) from a **separate backend Node container** across an isolated Docker bridge. The live Production rollout must use the *internal discovered* option unless an approved reason proves it inaccessible.

**Backup / keyfile security decision:** Railway volume snapshots include **all files** on `/data/db`, including `rs0-keyfile`; the key can therefore be recovered by anyone authorized to restore/read those backups. Official: https://docs.railway.com/volumes/backups . Owner/security reviewer must explicitly decide **ACCEPT** only with encrypted backups, restricted access, access logs, retention and key rotation/recovery procedures, or **REJECT** and STOP because the approved same-volume design cannot omit the keyfile from volume backups. Do not treat the snapshots as secret-free. A single-member rs0 enables transactions but provides no HA.

**CI implementation:** The old `Dockerfile.g2-mongo` and `scripts/g2-mongo-start-rs0.sh` are removed. Disposable GitHub Actions runs official `mongo:8.0` image directly; on an isolated volume first creates a synthetic authenticated standalone, stops it, writes the keyfile once, invokes the *literal* final command, uses dedicated Docker DNS aliases `mongodb.railway.internal` and `g2-restore.railway.internal`, then checks both backend topology modes, real transaction rollback/commit, synthetic archive checksum, restored indexes/counts and monetary tests. `src/utils/mongoUriResolver.js` correctly blocks the Production hostname in `NODE_ENV=test`; the CI peer deliberately tests the **non-test Production URI resolution** inside the isolated Docker network (with tight hostname/database/CI guards), without weakening that protection. This is not Production or Railway access.

### D. Phase B — NEW empty Mongo service on Staging (PLAN ONLY, NO RAILWAY ACTION NOW)

**No old bucket/archive dependency.** Drill uses **synthetic records generated fresh** in a strictly isolated Staging fixture; do not download or rely on the earlier backup bucket/object, customer records or Production credentials. The approved `MongoDB-qxhu` is not modified.

1. After separate owner authorization and a verified isolation gate (including independently retiring the legacy one-off service containing `PROD_MONGO_URI`), create **one new Staging-only** MongoDB service using official image `mongo:8.0` (pin exact installed 8.0.x before any cutover), **one new empty** private `/data/db` volume, and private endpoint only. **No public proxy/domain**, no link to shared app backend.
2. Bootstrap an authenticated standalone from the empty new volume with synthetic users and data; record SHA-256/counts/index manifest from this **new synthetic dataset**. Simulate frozen writes and a Railway volume backup; verify a separate restore/recovery route for the synthetic contents.
3. In the same new Staging service, apply the **exact** Start Command text from `scripts/g2-mongo-final-start-command.txt` (not a paraphrase). First start with the one-time `G2_RS0_KEYFILE`; restart without the variable and assert inode, permissions, bytes and count/index parity.
4. Run the **same Node file** `scripts/g2-rs0-init-and-verify.js` using `G2_OWNER_APPROVED=true` and the isolated Staging fixture. **The Production-target host is fixed in the script**: for the Staging rehearsal, use a strictly disposable CI/local alias equivalent as the existing GitHub Actions does, or introduce a separate explicitly reviewed isolated-Staging host allowance in a future PR. Do not repoint the production-locked file by weakening its target guard.
5. Verify PRIMARY, transaction commit/abort, unchanged collection counts/indexes, real backend read/write isolation and rollback **before** any customer service cutover. Document commands, timings, results, rollback point, version/digest and owner sign-off.
6. STOP if any fixture uses Production URI, public TCP proxy, restored real data, the existing shared Staging rs0, or any command different from the golden line. Clean up the disposable service/volume only with separate approval.

**Current execution status:** Github disposable Docker CI only. The Railway Staging rehearsal is NOT RUN.

### Owner decision gates (not yet approved)
1. Maintenance window (date + Riyadh clock time), owner/operator, merchant/branch notification, and realistic allowed downtime.
2. Identify public TCP proxy clients, then explicitly keep/remove/replace proxy **in a later approved change**; external clients remain unknown.
3. Fate of `MONGODB_URI_TEST` in Production: retain until read-only full-service key inventory and script search; approve deletion only if demonstrably unused; don't confuse with `MONGO_URI_TEST`.
4. Scheduled Railway volume backups: daily/weekly/monthly and retention/cost; obtain actual Railway plan, storage capacity and existing schedule as a separate read-only approval.
5. Phase B: approve a new private Staging-only synthetic fixture service/volume, with no old bucket/archive dependency. This Draft PR requests no execution authority.nly after proving provenance, expected hash/manifest and sanitized classification, and authorize the isolated new image-source service and eventual separate cleanup. This G2 Draft PR requests **no** execution authority.\n6. Decide **ACCEPT/REJECT** storing the persistent replica-set keyfile inside volume backups (including access/rotation/retention policy); REJECT blocks this same-volume design.\n7. Authorize/verify deletion of the legacy Staging one-off service carrying `PROD_MONGO_URI`, before any Phase B or cutover.\n8. Confirm exact running `buildInfo.version` and image digest at maintenance, pin matching `mongo:8.0.x`, and disable image `autoUpdates` before any conversion.
