# G2 production conversion night

Execution requires a new explicit Hema approval for the production window and a reviewed, merged tools version. A tools PR or CI rehearsal does not authorize a production deployment. Record the exact reviewed commit, operator and UTC times privately. Keep database credentials, backups, production manifests and customer data outside the repository and CI.

## 1. Prepare and back up before maintenance

- Confirm the Docker production-shape rehearsal, legacy reproduction and maintenance checks passed on the approved commit. Record whether code 70 was reproduced and the safe diagnostic if available.
- Record the exact live backend `MONGO_URI`, MongoDB start command, pre-deploy command and relevant flags in a private local record. Test rollback access and prepare its exact configuration changes before the window.
- Run `mongodump` locally against the standalone database before maintenance. Supply authentication privately through a protected configuration file or prompt and write the archive into a private local directory with restrictive permissions. The mandatory minimum is exit status 0 plus matching `done dumping` lines and document counts for the core collections present in the captured inventory, including `users`, `subscriptions`, `subscriptiondays`, `payments`, `checkoutdrafts`, `subscriptionentitlementbatches` and `subscriptionentitlementallocations`. Stop on an incomplete or mismatched dump. A local restore rehearsal is optional when Docker is available.
- Assign a watchdog/operator to monitor the deadline and complete logs. Have the rollback operations ready to apply without another planning step. Do not start the window if uninterrupted monitoring cannot be maintained.

## 2. Freeze writes and capture a second local dump

Enable backend `MAINTENANCE_MODE=true` and deploy with no initializer in `preDeployCommand`. Verify the maintenance startup marker, blocked mutation routes including Moyasar settlement GETs, disabled background jobs, and successful ordinary read/health requests. Confirm every backend replica is frozen and stop any other database writer.

Immediately after the freeze, run a second local `mongodump` and apply the same mandatory checks from step 1, exit status 0 plus matching core-collection `done dumping` lines and document counts. Preserve both dumps separately. This second dump and the subsequent baseline describe the frozen standalone state. Stop before changing MongoDB if the freeze or dump cannot be verified.

## 3. Capture the baseline and stage every step 5 variable

While MongoDB is still standalone and writes remain frozen, run the approved script with `--baseline` privately. It emits exactly three lines, containing counts and index definitions only.

```text
G2_BASELINE_GZ=<base64 gzip of the original JSON>
G2_BASELINE_SHA256=<SHA-256 of the original JSON bytes>
G2_BASELINE_BYTES=<encoded gzip character/byte length>
```

Keep this output private. `G2_BASELINE_BYTES` measures the encoded value Railway receives. It must be below 30000. An encoded value at or above that threshold exits with `G2_BASELINE_TOO_LARGE` (73). Do not split or truncate the compressed value.

Stage **all** backend variables for step 5 before beginning step 4.

| Variable | Staged value |
| --- | --- |
| `G2_BASELINE_MANIFEST_GZ_B64` | Exact `G2_BASELINE_GZ` output |
| `G2_BASELINE_SHA256` | Exact digest output |
| `G2_EXECUTION_SCOPE` | `owner-approved` |
| `G2_OWNER_APPROVED` | `true` |
| `MAINTENANCE_MODE` | `true` |
| `NODE_ENV` | `production` |
| `G2_MONGO_URI` | Private root-authenticated direct URI, database `test`, `authSource=admin` |
| `MONGO_URI` | The approved application URI with `replicaSet=rs0` |

Stage backend `preDeployCommand=["node scripts/g2-rs0-init-and-verify.js"]` on the approved commit too. Remove the obsolete manifest and split-part variables from this staged patch. Review that only the intended backend changes are pending and that values match the private captured output. Both compressed manifest and SHA-256 are mandatory, including on retries against an initialized primary. Legacy `G2_BASELINE_MANIFEST_B64` is accepted only in `ci-disposable` scope.

## 4. Change the MongoDB start command and start the 15-minute deadline

Record `step4_started_at` and `deadline=step4_started_at+15 minutes` in UTC **before** applying the MongoDB change. Start the watchdog at this point. Do not extend the deadline for a build, restart or retry.

**MongoDB 8.0 kernel/rseq precondition (2026-11-12 isolated staging evidence):** In the **same MongoDB-service-only configuration patch and single new deployment** that applies the wrapper, set `GLIBC_TUNABLES=glibc.pthread.rseq=1` on the MongoDB service (not the backend). Do not apply this by an additional prior restart. On Rollback A, **retain the same GLIBC_TUNABLES variable** while reverting only the MongoDB start command to standalone; verify a new standalone deployment's log gate before reopening writes. Keep the existing data volume and generated keyfile unchanged. This is a **community workaround, not an official MongoDB fix**; Hema must separately approve production conversion, with a backup, operator and rollback plan. The independent staging drill without the variable logged `MongoDB cannot start` on 2026-11-12 deployment `a9b1eced-5c01-4e66-9953-1692e174231e`; its fresh standalone v2 volume started with the variable in `93769fd4-3f56-460f-873a-250177255e47`. This does **not** prove both deployments ran on the same affected host, so it is not a conclusive defective-kernel A/B test. Reference: MongoDB [SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912); [Railway Central Station discussion](https://station.railway.com/questions/can-t-create-a-new-mongo-databse-93f51e99). Never use this observation alone to waive production verification. The isolated v2 rehearsal then converted the 30,000-document / 65-collection synthetic baseline with the unchanged approved wrapper and the tunable: step 4 began `2026-11-12T15:52:06.580Z`, wrapper startup deployment `7e7a172b-cb8a-4b7e-adb2-9571151d7452` showed the required `Did not find local replica set configuration document at startup` followed by `Waiting for connections`, initializer deployment `a268ef6d-3f21-4491-afd1-bb37f072dbdf` emitted `G2_INITIATE_SENT`, `G2_INITIATE_OK`, and `G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS` within **87.456 seconds**. A fresh post-PASS deployment `f895e0f6-9c6b-435d-b10c-a923013adc1a` used the same wrapper and variable, reached `Waiting for connections` and primary; independent read-only runner `hello` deployment `dd558730-ae07-494f-80c5-d6a7083a2187` confirmed `setName=rs0` and `isWritablePrimary=true`. **These successes do not establish that the new deployments used the original defective kernel host and do not authorize production changes.**

Use the complete approved wrapper from production deployment `2a278e7d-a452-475b-a8f2-e480dffa945f` on 2026-11-10. `/data/db/rs0-keyfile` already exists on the current production volume. The wrapper preserves an existing file and checks mode `400` and owner `mongodb`. On a fresh volume it writes the file atomically from the private `G2_RS0_KEYFILE` variable and applies those permissions. Preserve the existing data volume and root user. Apply this exact start command directly to MongoDB and deploy that service only. Keep the backend step 5 patch staged during this operation so it cannot start early through an environment-wide commit.

```sh
/bin/sh -ec 'set -eu; if [ ! -e /data/db/rs0-keyfile ]; then test "$(id -u)" = 0; test -d /data/db; test -n "${G2_RS0_KEYFILE:-}"; umask 077; t=$(mktemp /data/db/.rs0-keyfile.XXXXXXXX); trap "rm -f $t" EXIT; printf "%s" "$G2_RS0_KEYFILE" > "$t"; chown mongodb:mongodb "$t"; chmod 0400 "$t"; mv "$t" /data/db/rs0-keyfile; fi; test "$(stat -c %a /data/db/rs0-keyfile)" = 400; test "$(stat -c %U /data/db/rs0-keyfile)" = mongodb; exec docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth'
```

Wait for MongoDB deployment success and readiness while monitoring the deadline. Stop on a failed MongoDB deployment and apply the decision rules below.

### Mandatory deployment-ID/startup-log gate (2026-11-12)

This is a **hard gate after every MongoDB start-command change**, including step 4, the standalone rollback, and any repeated attempt. A saved Railway `startCommand` or a successful `update-service` response is **not** evidence of the command used by the running container. Do not trust a service-level aggregate log or a previous deployment's startup.

1. Apply the change only to the intended MongoDB service and environment. Trigger a **new deployment** after the configuration change, record its exact deployment ID, UTC creation/start time and status; inspect its deployment snapshot/configuration if available. Do not assume that `redeploy` of an older build applies a newly saved command: the 2026-11-11 staging drill `9944020c-1417-446f-93d8-0c00453e5fbd` was a `redeploy` with a service-level wrapper saved but its startup proved standalone.
2. Fetch the **complete startup logs for that specific deployment ID** (`get-logs` with `deploymentId` and a bounded startup time window). For an uninitialized volume being converted to `--replSet rs0`, require `Did not find local replica set configuration document at startup` **followed by** `Waiting for connections`; also verify the expected replica-set-aware startup evidence. If an initialized configuration unexpectedly appears, stop and escalate without attempting standalone rollback. For the standalone command, require `Waiting for connections` and **no replication-related startup lines** (including `Starting up replica set aware services`, `Did not find local replica set configuration document at startup`, or new replication-configuration lines).
3. **Immediate STOP/rollback gate:** If this deployment's startup log contains `MongoDB cannot start` (including the Linux kernel/TCMalloc incompatibility), **do not wait three minutes and do not initiate**. On an **uninitialized and verified uninitiated** volume, begin Rollback A immediately using the exact standalone command while retaining `GLIBC_TUNABLES=glibc.pthread.rseq=1`; require a new standalone deployment ID and `Waiting for connections` with no replication startup lines. If an initialization may have occurred or log evidence is incomplete, preserve the volume and escalate instead of attempting a standalone rollback.
4. Allow at most **3 minutes after starting the new deployment** to obtain the required ordered markers from its own complete logs. If markers are absent, logs are missing/truncated, or the actual launch mode is uncertain: **do not run or retry the initializer**. Apply the rollback/escalation decision in section 6 using complete initializer and MongoDB logs. Never perform Rollback A after confirmed or possible successful initiation. This three-minute check does not reset the existing 15-minute conversion deadline.
5. Reapply this same mandatory deployment-ID gate to the standalone deployment performed by Rollback A, recording its ID and UTC `Waiting for connections` time. No replication startup markers are permitted on the rollback deployment. A failure to verify the rollback startup is a STOP/escalation, not a reason to declare restoration complete.

Operator checklist: command changed → new deployment ID recorded → exact deployment startup logs checked → markers match mode within 3 minutes → only then advance. Production deployment still requires its own explicit approval; the staging rehearsal approval does not authorize it.

## 5. Commit the reviewed backend patch and initialize

Recheck the complete pending diff, then apply the already-staged step 5 backend patch. Do not add or repair missing variables after starting step 4. The initializer connects directly, issues `hello`, validates gzip, JSON, database and SHA-256 before any other application database command, then initializes and verifies.

After configuration validation and before connecting, every invocation emits `G2_RUNTIME node=<process.version> driver=<mongodb package version>` once on stderr. This preserves the baseline's three stdout lines. For a server-selection failure with a topology reason, the failure line also appends `topology=<type token> servers=<deduplicated server type tokens|->`. It never includes server addresses or messages.

Safe failure output has this format and contains no error message or URI.

```text
G2_FAIL stage=<stage> code=<G2 code> name=<error.name> codeName=<codeName|-> mongoCode=<number|-> labels=<errorLabels|->
```

Stages are `config`, `connect`, `hello`, `manifest`, `initiate`, `wait-primary`, `collect`, `probe`, and `compare`. Existing exit codes 64–72 retain their meanings. A malformed/missing manifest or wrong SHA-256 exits 71 with `G2_MANIFEST_REQUIRED` before initiation.

The script writes `G2_INITIATE_SENT` immediately before sending `replSetInitiate`, followed by `G2_INITIATE_OK` or `G2_INITIATE_ALREADY` when appropriate. Preserve complete timestamped initializer and MongoDB logs. Treat `G2_INITIATE_ALREADY` as evidence of an initialized replica set even when no new command was sent in that attempt.

Success requires this exact final marker before the deadline.

```text
G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS
```

It verifies primary state, pre/post collection counts and index definitions, a committed transaction and an aborted transaction, followed by another manifest comparison. A cleanup failure must not replace the original diagnostic.

## 6. Enforce the automatic rollback/escalation decision

At a terminal failure, or at the 15-minute deadline without PASS, stop the initializer and prohibit concurrent retries. Inspect the **complete logs for all attempts** before acting.

| Evidence | Required action |
| --- | --- |
| No PASS, no `G2_INITIATE_SENT` or `G2_INITIATE_ALREADY`, and no `replSetInitiate` in MongoDB logs, with verified complete logs and an uninitialized replica set | Automatically execute Rollback A immediately |
| Any `G2_INITIATE_SENT`, `G2_INITIATE_OK`, `G2_INITIATE_ALREADY`, or `replSetInitiate` evidence, even if the command failed | Stop and escalate to Hema while preserving the freeze and replica-set configuration |
| Missing/truncated logs, uncertain initializer state, or uncertain replica-set state | Stop and escalate with writes frozen |
| PASS before the deadline | Continue to step 7 |

Rollback A restores the exact former standalone command below on the same MongoDB volume. Wait for `SUCCESS` and `Waiting for connections`. **Keep `GLIBC_TUNABLES=glibc.pthread.rseq=1` on MongoDB**, as well as the private key variable, while reverting the start command. Never bypass the standalone deployment-ID/startup-log gate.

```sh
docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false
```

Then restore the privately recorded original backend `MONGO_URI` (use `${{MongoDB.MONGO_URL}}` only if the former value was not recorded), clear `preDeployCommand=[]`, set `MAINTENANCE_MODE=false` and `G2_OWNER_APPROVED=false`, and remove the compressed/digest, legacy/split and execution-scope G2 variables. Deploy the backend and record the UTC write-reopening time. Verify `Payment indexes ensured`, absence of `G2 maintenance active`, dashboard data reads returning 200/304, and no new application/server errors. Continue with step 8 after rollback. A further G2 attempt requires a new approved window.

## 7. Reopen after PASS

Remove the one-time initializer from `preDeployCommand`, disable maintenance, set `G2_OWNER_APPROVED=false`, and remove the temporary G2 baseline/execution variables while retaining the approved replica-set application URI. Deploy and verify startup, payment indexes, ordinary dashboard reads and application error logs. Record the actual UTC write-reopening time and the evidence used to establish it. Keep post-init incidents frozen for Hema's decision if reopening fails.

## 8. Reconcile Moyasar with read-only access

Query all pages of live Moyasar payments created **or updated** from the UTC maintenance-freeze timestamp through the recorded write-reopening timestamp. Use explicit UTC timestamps instead of date-picker local midnights. Deduplicate by provider payment identifier, then compare relevant records against internal Payments by provider ID, status and subscription/application state.

Report counts only, including created, updated, paid, matched and paid-without-application. Keep customer and payment details private. Any recovery, refund, settlement synchronization or other data change requires a separate explicit approval for that case.
