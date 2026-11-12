# Task 6 Railway staging rehearsal plan

Status is proposed for Hema review. Execution, deployment and cleanup are separate approval gates. This document records a plan only. The existing six staged backend-variable removals remain pending for Hema's decision.

## Scope and prerequisites

- Target only environment `90700265-e775-4075-a99c-8d04508a7d98` in project `189703a8-68f1-428b-816e-2adeac4774db`.
- Use the existing staging backend `basicdiet145`, service `9a6d629e-c9f4-4687-bf83-613011606018`, as the pre-deploy execution surface. Each seed, baseline, legacy and v2 invocation runs through `preDeployCommand`.
- Use generated credentials and synthetic data throughout. The target database is exactly `basicdiet_g2_staging_synthetic`.
- Before execution, privately record the backend's original source commit/branch, variable references, `preDeployCommand`, maintenance state and runtime flags. Review the current pending patch so applying step 5 cannot also apply unrelated work.
- All approved code must be present in the backend build image before setting its pre-deploy command. Any temporary source change and restoration will be included in the staging diff for Hema review.

The preparation PR supplies the following tools for review before execution approval.

1. `scripts/ci/g2-synthetic-seed.js` has an explicitly approved `staging-isolated` path requiring `G2_OWNER_APPROVED=true`, `G2_STAGING_REHEARSAL_APPROVED=true`, hostname `g2-mongo-restore-drill.railway.internal` and database `basicdiet_g2_staging_synthetic`. Its original Docker CI restrictions remain in place. The empty-database check runs before model loading, inserts or index creation. The manifest uses the validated database name.
2. `scripts/.g2-legacy-init.js` is the literal historical `c4580553a56f986e7702471b32a82d74e12e1c65:scripts/g2-rs0-init-and-verify.js`. Its SHA-256 is `963ead351b9ddbd26564d3124ba8628df0f1739a92a663368015af3116d0b133`, tested against `git show` from that commit. The existing Dockerfile copies this packaged file into the backend image. `scripts/ci/g2-legacy-diagnostics.js` preserves the original exit classification and arguments, emits `G2_LEGACY_EXIT=<original code>` and `G2_RUNTIME`, and retains safe error/topology metadata. It emits `G2_INITIATE_SENT` immediately before a legacy initiation command for the rollback decision.
3. `scripts/ci/g2-preflight.js` is a read-only pre-deploy command. It checks the approved target and URI option values and reports encoded-variable lengths and SHA-256 hashes, without decoding or printing the manifest payload.

## Single-session freeze and restoration deadline

Complete both experiments and staging restoration in the same attended session. Record `staging_frozen_at` once, at the first maintenance freeze before the legacy trial, and prepare the original staging restoration patch before starting. The second trial does not reset this clock.

Record `staging_restore_started_at` when restoration begins. If restoration has not started by `staging_frozen_at + 3 hours`, stop the experiment immediately and restore staging at once. This applies even if a trial is still running or awaiting diagnosis. Preserve any initiated drill state for review while restoring the original staging backend connection/configuration. Finish restoration and verify staging in that same session. The separate 15-minute step 4 deadline applies to each trial within this overall session limit.

## Temporary resources and references

Create one temporary `mongo:8.0` service named `g2-mongo-restore-drill`, with private hostname `g2-mongo-restore-drill.railway.internal`, mounted at `/data/db`. Record the new service ID and every volume ID immediately after creation.

Use two fresh, isolated volumes for comparable pre-init trials, `g2-drill-legacy-<UTC>` and `g2-drill-v2-<UTC>`. The legacy trial must run first, followed by v2 through the same temporary service. Change the mounted trial volume and restore the standalone start command in one reviewed service patch. Detach and preserve the first trial's volume when attaching the second. This avoids running the second initializer against an already initialized replica set and preserves the legacy evidence until cleanup approval.

| Drill-service variable | Planned value |
| --- | --- |
| `MONGO_INITDB_ROOT_USERNAME` | `${{secret()}}` |
| `MONGO_INITDB_ROOT_PASSWORD` | `${{secret()}}` |
| `G2_RS0_KEYFILE` | `${{secret()}}`, validate its generated format/length for a MongoDB keyfile |
| `MONGO_URL` | `mongodb://${{MONGO_INITDB_ROOT_USERNAME}}:${{MONGO_INITDB_ROOT_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:27017/basicdiet_g2_staging_synthetic?authSource=admin` |

The backend uses references to this temporary service.

| Backend variable | Planned value during initialization |
| --- | --- |
| `G2_MONGO_URI` | `${{g2-mongo-restore-drill.MONGO_URL}}` |
| `MONGO_URI` | `${{g2-mongo-restore-drill.MONGO_URL}}&replicaSet=rs0` |
| `G2_EXECUTION_SCOPE` | `staging-isolated` |
| `G2_OWNER_APPROVED` | `true` after Hema's execution approval |
| `G2_STAGING_REHEARSAL_APPROVED` | `true` after Hema's execution approval |
| `MAINTENANCE_MODE` | `true` |
| `NODE_ENV` | The staging backend's original value is `staging`. During the rehearsal it was temporarily `production` for `preDeploy` only; the custom runtime Start Command enforced `NODE_ENV=staging`. Restore the variable to `staging` and remove the custom Start Command altogether so the Dockerfile `CMD` runs normally. |
| `LOG_DIR` | A writable backend-container log directory |
| `G2_BASELINE_MANIFEST_GZ_B64` | Exact compressed output from that trial's frozen baseline |
| `G2_BASELINE_SHA256` | Exact digest from the same trial |

Before step 4, use `preDeployCommand=["node scripts/ci/g2-preflight.js"]` to inspect reference resolution. The command validates the exact expected host/database and `authSource=admin`. If `replicaSet` or `directConnection` is present, it checks `rs0` or `true` respectively. An application URI without `replicaSet` is allowed during the standalone phase. The step 5 reference diff must include `replicaSet=rs0` before conversion.

The output reports `scheme=mongodb`, `host=staging-drill`, the synthetic database name, and required/present option names. `host` is a verified role token so the actual DNS name/address stays private. It also reports character count, UTF-8 byte length and SHA-256 of the fully rendered old base64 variable when present, and of the compressed variable. These are hashes of the encoded environment values, distinct from `G2_BASELINE_SHA256`, which hashes the decompressed JSON. It excludes resolved URIs, credentials, payloads and server addresses.

## Mandatory Mongo start-command deployment-ID gate (second rehearsal, 2026-11-12)

**Run after every MongoDB start-command change**, including the legacy standalone restart, legacy wrapper step 4, any permitted legacy Rollback A, v2 standalone startup and v2 wrapper step 4. Each change must produce a **new deployment ID**, its UTC start time and deployment-specific complete startup logs; never infer success from `describe-service`, a stored `startCommand`, `SUCCESS` alone or aggregate service logs.

- For the standalone command, require `Waiting for connections`, and **no** replica-set startup markers or new replication-configuration lines in this deployment's own startup logs.
- For the wrapper with `--replSet rs0` on an uninitialized trial volume, require `Did not find local replica set configuration document at startup` **then** `Waiting for connections`, in that order, from the **same deployment ID**. Presence of actual/unexpected replica-set configuration triggers STOP and preservation of the volume.
- If the required evidence does not appear **within 3 minutes of starting that deployment**, or if logs are incomplete: STOP, do **not** run step 5, and apply the trial's documented Rollback A vs. preserve/escalate decision using complete evidence. Never roll back a volume after confirmed or uncertain successful initiation. This three-minute gate does not extend either trial's 15-minute step 4 deadline or the overall three-hour staging freeze.
- On rollback, require another **new** standalone deployment ID and the standalone log gate before counting `rollback_elapsed_seconds` or claiming recovery. Read `get-staged-changes` on production and verify it is empty **before each deployment**, without changing production.

**2026-11-11 incident / implementation lesson:** The previous drill service now has a stored wrapper with `--replSet rs0`, while deployment `9944020c-1417-446f-93d8-0c00453e5fbd` has deployment metadata `reason=redeploy` and startup logs at `2026-11-11T01:55:28Z` demonstrating standalone (`Waiting for connections` without replica-set-aware startup). Therefore the `redeploy` did not launch with the saved wrapper; successful `update-service`/saved configuration alone is not proof. Available deployment metadata does **not** establish whether the original wrapper-setting action was a direct `update-service` or an accepted staged patch; do not present that part as verified without an activity/audit record. Before another trial, capture the precise original staging backend references in a recoverable private form. When the connector redacts all values and no verified prior capture exists, do not freeze or change `MONGO_URI` because restoration cannot be guaranteed.

## Steps 2 through 5 for each trial

### 2. Freeze staging, seed the standalone drill

Enable staging backend maintenance and remove its previous pre-deploy operation for this trial. Confirm the staging background jobs and settlement routes are frozen. Record the session-wide `staging_frozen_at` at this first freeze before legacy. Keep this freeze across both trials until restoration. Check the three-hour restoration-start deadline throughout the session.

Start the temporary MongoDB service on the fresh trial volume with the former standalone command.

```sh
docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false
```

Wait for successful startup and root authentication. Point both backend connection references at the standalone synthetic drill for this phase, with no `replicaSet` option in the application URI yet. Set `preDeployCommand=["node scripts/ci/g2-synthetic-seed.js"]` and deploy staging backend after review. Verify about 30000 documents, 65 real-model collections, the real schema indexes and `Payment indexes ensured`. Keep the seed command out of subsequent deployments because it rejects nonempty targets.

Use only a synthetic manifest/count inventory to establish the trial baseline.

### 3. Capture baseline and stage every step 5 input

Set `preDeployCommand=["node scripts/g2-rs0-init-and-verify.js --baseline"]` while MongoDB remains standalone, then deploy staging backend. Capture its three stdout baseline values and the stderr runtime line separately.

Stage all step 5 variables, references, the replica-set application URI and the chosen pre-deploy command before step 4. Verify the compressed value is below 30000 characters and the original base64 exceeds 32768. Compare the generated counts/index definitions between the two synthetic trials.

For the legacy trial, split the original JSON's base64 value into `G2_BASELINE_PART1` and `G2_BASELINE_PART2`, each below Railway's variable limit. Configure the old variable through Railway references.

```text
G2_BASELINE_MANIFEST_B64=${{G2_BASELINE_PART1}}${{G2_BASELINE_PART2}}
```

Verify its rendered length and SHA-256 through the private pre-deploy preflight before step 4. This tests Railway's own reference concatenation. Retain the compressed baseline and digest too for the v2 comparison.

### 4. Apply the exact approved wrapper and start timing

Record `step4_started_at` in UTC immediately before applying the MongoDB command change. The deadline is that timestamp plus 15 minutes. Apply the command directly to the drill service so the backend step 5 patch stays staged.

Use this exact production-approved wrapper.

```sh
/bin/sh -ec 'set -eu; if [ ! -e /data/db/rs0-keyfile ]; then test "$(id -u)" = 0; test -d /data/db; test -n "${G2_RS0_KEYFILE:-}"; umask 077; t=$(mktemp /data/db/.rs0-keyfile.XXXXXXXX); trap "rm -f $t" EXIT; printf "%s" "$G2_RS0_KEYFILE" > "$t"; chown mongodb:mongodb "$t"; chmod 0400 "$t"; mv "$t" /data/db/rs0-keyfile; fi; test "$(stat -c %a /data/db/rs0-keyfile)" = 400; test "$(stat -c %U /data/db/rs0-keyfile)" = mongodb; exec docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth'
```

A fresh drill volume has no keyfile, so this exercises the wrapper's create-and-check path. A restart on that trial volume exercises its existing-file path. Preserve the same root account and data volume across the standalone-to-replica-set transition.

Wait for successful MongoDB startup while observing the same deadline and complete logs.

### 5. Run the selected initializer as the backend pre-deploy command

- Legacy trial on its own fresh volume uses `preDeployCommand=["node scripts/ci/g2-legacy-diagnostics.js"]`. Collect its stage, original error class, numeric MongoDB code, labels, topology type and server types, or its PASS marker. A failed pre-deploy is an expected diagnostic outcome only after its exact original classification is recorded.
- V2 trial on its own fresh volume uses `preDeployCommand=["node scripts/g2-rs0-init-and-verify.js"]`. Require `G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS`, with `G2_INITIATE_SENT` and the matching initiation result, counts/index equality and successful commit/abort probes.

For a legacy failure before initiation, stop the initializer and verify complete logs contain neither `G2_INITIATE_SENT` nor `replSetInitiate`. Apply the MongoDB portion of Rollback A from the production runbook verbatim to the drill service, retaining that trial's volume and private key variable.

```sh
docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false
```

Record `legacy_failed_at` from the timestamped failure/exit output. Deploy the drill with this standalone command, wait for `SUCCESS` and the new standalone `Waiting for connections` line, and record its timestamp as `drill_standalone_ready_at`. Report `rollback_elapsed_seconds=drill_standalone_ready_at-legacy_failed_at`. Disable the legacy pre-deploy command and re-arm approvals only for the separately reviewed v2 trial. Staging maintenance remains active across this drill rollback. If initiation evidence exists or logs are incomplete, preserve the drill state and escalate instead of switching it to standalone, while still honoring the staging restoration deadline.

Record `pass_at` from the timestamped pre-deploy PASS line and report `elapsed_seconds=pass_at-step4_started_at` for each passing trial. For a failing legacy trial, report elapsed time to failure separately and retain its exact safe diagnostic. Record image digest, Node and driver versions, deployment IDs and the reference-concatenation length/hash alongside the result.

If there is no PASS by the deadline and complete logs prove no initiation attempt, stop the initializer and apply the documented standalone rollback to that synthetic trial. Any initiation marker, MongoDB initiation command, or incomplete logs requires stopping with the synthetic state preserved for Hema review. Each independent trial has its own recorded deadline.

## Restore staging and request explicit cleanup approval

1. Begin restoration within the same session and by the three-hour restoration-start deadline. Stage and review the original staging backend source (`codex/pos-staging-isolation @ e3e07bb57d9c2dd3702db02f211f73c7f7309caa`), original staging database connection, `preDeployCommand=[]`, and original maintenance/runtime flags. **Remove the custom Start Command entirely** (do not leave `env NODE_ENV=staging npm start`, or the temporary command including a test payment key): clear the Railway override so execution returns to the Dockerfile `CMD`. **Restore the backend variable `NODE_ENV=staging`**. Set `G2_OWNER_APPROVED=false` and `G2_STAGING_REHEARSAL_APPROVED=false`, while retaining other temporary G2 variables until separate cleanup approval. Before committing, verify the Production environment has no staged changes; deploy Staging only and confirm the original staging database reads, `Payment indexes ensured`, and HTTP readiness before removing any dependency.
2. Present Hema with the exact temporary service ID, both newly created volume IDs, mount/attachment state and remaining backend `G2_*` variable names. Keep their synthetic state available for review until Hema explicitly approves deletion.
3. After that explicit cleanup approval, delete only `g2-mongo-restore-drill`, its two recorded trial volumes and any remaining staging backend `G2_*` variables. Verify the original staging database volumes remain attached to their original services.
4. Report both trial outcomes, legacy code-70 reproduction status, elapsed times, runtime metadata and cleanup results. Execution and deletion approvals are recorded separately.

### 2026-11-11 rehearsal stop and NODE_ENV interpretation

- Rehearsal `preDeploy` ran with `NODE_ENV=production`, but the application runtime Start Command enforced `NODE_ENV=staging`. This is **not a causal difference for historical code 70**: the immutable legacy initializer does not use Mongoose and reads `NODE_ENV` only within its `owner-approved` path. Do not attribute code 70 to the preDeploy/runtime environment split.
- The synthetic preflight was PASS (`688650d9-a25a-4c4f-8371-c9fc52996ba9`); the original reference concatenation rendered 54,232 characters and the compressed manifest 5,484 characters.
- Legacy pre-deploy (`fb8a930b-c56f-4ec6-ae29-2b0db0d2a69b`) at `2026-11-11T01:56:18Z` emitted `G2_INITIATE_SENT`, `G2_FAIL stage=initiate code=G2_INIT_FAILED`, and `G2_LEGACY_EXIT=66`. Therefore code **70 was not reproduced** in this trial. This is an explicit safety STOP: **do not perform standalone Rollback A on this initiated drill volume** and do not proceed to v2 without a new reviewed decision. Preserve the trial volume and logs.
- Restoration of the original isolated staging backend was SUCCESS (`00d63fd4-bffa-4e71-b490-818f422030c4`), and at `2026-11-11T01:58:57Z` its logs confirmed `basicdiet_pos_staging_test`, `MongoDB connected`, `Payment indexes ensured`, and API listening. The custom Start Command was cleared and `NODE_ENV=staging` restored. Cleanup of the temporary drill resources was **not approved or executed**.
