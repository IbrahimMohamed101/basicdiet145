# G2 production conversion night

Execution requires a new explicit Hema approval for the production window and a reviewed, merged tools version. A tools PR or CI rehearsal does not authorize a production deployment. Record the exact reviewed commit, operator and UTC times privately. Keep database credentials, backups, production manifests and customer data outside the repository and CI.

## 1. Prepare and back up before maintenance

- Confirm the Docker production-shape rehearsal, legacy reproduction and maintenance checks passed on the approved commit. Record whether code 70 was reproduced and the safe diagnostic if available.
- Record the exact live backend `MONGO_URI`, MongoDB start command, pre-deploy command and relevant flags in a private local record. Test rollback access and prepare its exact configuration changes before the window.
- Run `mongodump` locally against the standalone database before maintenance. Supply authentication privately through a protected configuration file or prompt. Write the archive into a private local directory with restrictive permissions, verify its exit status and archive checksum, and perform a restore rehearsal into an isolated local database. Stop on an incomplete backup.
- Assign a watchdog/operator to monitor the deadline and complete logs. Have the rollback operations ready to apply without another planning step. Do not start the window if uninterrupted monitoring cannot be maintained.

## 2. Freeze writes and capture a second local dump

Enable backend `MAINTENANCE_MODE=true` and deploy with no initializer in `preDeployCommand`. Verify the maintenance startup marker, blocked mutation routes including Moyasar settlement GETs, disabled background jobs, and successful ordinary read/health requests. Confirm every backend replica is frozen and stop any other database writer.

Immediately after the freeze, run a second local `mongodump` and verify success, checksum and readability. Preserve both dumps separately. This second dump and the subsequent baseline describe the frozen standalone state. Stop before changing MongoDB if the freeze or dump cannot be verified.

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

Prepare the private key file with the MongoDB runtime owner and mode `0400`, using the approved private `G2_RS0_KEYFILE`. Preserve the existing data volume and root user. Apply the MongoDB configuration directly to that service and deploy MongoDB only. Keep the backend step 5 patch staged during this operation so it cannot start early through an environment-wide commit.

```sh
docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth
```

Wait for MongoDB deployment success and readiness while monitoring the deadline. Stop on a failed MongoDB deployment and apply the decision rules below.

## 5. Commit the reviewed backend patch and initialize

Recheck the complete pending diff, then apply the already-staged step 5 backend patch. Do not add or repair missing variables after starting step 4. The initializer connects directly, issues `hello`, validates gzip, JSON, database and SHA-256 before any other application database command, then initializes and verifies.

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

Rollback A restores the exact former standalone command below on the same MongoDB volume. Wait for `SUCCESS` and `Waiting for connections`. Keep the private key variable intact.

```sh
docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false
```

Then restore the privately recorded original backend `MONGO_URI` (use `${{MongoDB.MONGO_URL}}` only if the former value was not recorded), clear `preDeployCommand=[]`, set `MAINTENANCE_MODE=false` and `G2_OWNER_APPROVED=false`, and remove the compressed/digest, legacy/split and execution-scope G2 variables. Deploy the backend and record the UTC write-reopening time. Verify `Payment indexes ensured`, absence of `G2 maintenance active`, dashboard data reads returning 200/304, and no new application/server errors. Continue with step 8 after rollback. A further G2 attempt requires a new approved window.

## 7. Reopen after PASS

Remove the one-time initializer from `preDeployCommand`, disable maintenance, set `G2_OWNER_APPROVED=false`, and remove the temporary G2 baseline/execution variables while retaining the approved replica-set application URI. Deploy and verify startup, payment indexes, ordinary dashboard reads and application error logs. Record the actual UTC write-reopening time and the evidence used to establish it. Keep post-init incidents frozen for Hema's decision if reopening fails.

## 8. Reconcile Moyasar with read-only access

Query all pages of live Moyasar payments created **or updated** from the UTC maintenance-freeze timestamp through the recorded write-reopening timestamp. Use explicit UTC timestamps instead of date-picker local midnights. Deduplicate by provider payment identifier, then compare relevant records against internal Payments by provider ID, status and subscription/application state.

Report counts only, including created, updated, paid, matched and paid-without-application. Keep customer and payment details private. Any recovery, refund, settlement synchronization or other data change requires a separate explicit approval for that case.
