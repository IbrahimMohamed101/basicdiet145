# Task 6 Railway staging rehearsal plan

Status is proposed for Hema review. Execution, deployment and cleanup are separate approval gates. This document records a plan only. The existing six staged backend-variable removals remain pending for Hema's decision.

## Scope and prerequisites

- Target only environment `90700265-e775-4075-a99c-8d04508a7d98` in project `189703a8-68f1-428b-816e-2adeac4774db`.
- Use the existing staging backend `basicdiet145`, service `9a6d629e-c9f4-4687-bf83-613011606018`, as the pre-deploy execution surface. Each seed, baseline, legacy and v2 invocation runs through `preDeployCommand`.
- Use generated credentials and synthetic data throughout. The target database is exactly `basicdiet_g2_staging_synthetic`.
- Before execution, privately record the backend's original source commit/branch, variable references, `preDeployCommand`, maintenance state and runtime flags. Review the current pending patch so applying step 5 cannot also apply unrelated work.
- All approved code must be present in the backend build image before setting its pre-deploy command. Any temporary source change and restoration will be included in the staging diff for Hema review.

Two code preparations need a separate review before this plan can run.

1. `scripts/ci/g2-synthetic-seed.js` currently accepts Docker CI on host `mongodb.railway.internal`, database `test`, only. Extend its existing guard with an explicitly approved `staging-isolated` path requiring `G2_OWNER_APPROVED=true`, `G2_STAGING_REHEARSAL_APPROVED=true`, hostname `g2-mongo-restore-drill.railway.internal` and the exact synthetic database name. Retain the empty-database check and existing CI restrictions. Use the validated target database name in the generated manifest. Railway will use this real staging guard.
2. Package the unchanged `c4580553a56f986e7702471b32a82d74e12e1c65:scripts/g2-rs0-init-and-verify.js` as `scripts/.g2-legacy-init.js` in the approved rehearsal image, and verify its file hash against that commit before deploying. The current CI creates this file dynamically with `git show`. The Railway image needs a reviewed packaging step because its normal image does not contain that generated file. Invoke it through `scripts/ci/g2-legacy-diagnostics.js`. Extend that adapter's evidence output to record the legacy original exit classification and safe runtime metadata, while retaining its top-level diagnostic, topology and server-type output.

The preparation changes above are proposed work. This plan does not claim the current Docker-only seed or legacy packaging is ready for Railway.

## Temporary resources and references

Create one temporary `mongo:8.0` service named `g2-mongo-restore-drill`, with private hostname `g2-mongo-restore-drill.railway.internal`, mounted at `/data/db`. Record the new service ID and every volume ID immediately after creation.

Use two fresh, isolated volumes for comparable pre-init trials, `g2-drill-legacy-<UTC>` and `g2-drill-v2-<UTC>`. Run the trials sequentially through the same temporary service. Change the mounted trial volume and restore the standalone start command in one reviewed service patch. Detach and preserve the first trial's volume when attaching the second. This avoids running the second initializer against an already initialized replica set and preserves the legacy evidence until cleanup approval.

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
| `NODE_ENV` | `production` for the rehearsal |
| `LOG_DIR` | A writable backend-container log directory |
| `G2_BASELINE_MANIFEST_GZ_B64` | Exact compressed output from that trial's frozen baseline |
| `G2_BASELINE_SHA256` | Exact digest from the same trial |

Before step 4, inspect reference resolution privately through a guarded pre-deploy preflight. Compare only scheme, exact expected host/database, required option names and a digest of the expected concatenated synthetic baseline. Its output contains runtime versions, byte lengths, hashes and type/status tokens. It excludes resolved URIs, credentials and server addresses.

## Steps 2 through 5 for each trial

### 2. Freeze staging, seed the standalone drill

Enable staging backend maintenance and remove its previous pre-deploy operation for this trial. Confirm the staging background jobs and settlement routes are frozen. Keep this freeze until restoration.

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

Record `pass_at` from the timestamped pre-deploy PASS line and report `elapsed_seconds=pass_at-step4_started_at` for each passing trial. For a failing legacy trial, report elapsed time to failure separately and retain its exact safe diagnostic. Record image digest, Node and driver versions, deployment IDs and the reference-concatenation length/hash alongside the result.

If there is no PASS by the deadline and complete logs prove no initiation attempt, stop the initializer and apply the documented standalone rollback to that synthetic trial. Any initiation marker, MongoDB initiation command, or incomplete logs requires stopping with the synthetic state preserved for Hema review. Each independent trial has its own recorded deadline.

## Restore staging and request explicit cleanup approval

1. Restore the staging backend's original reviewed source, connection references, `preDeployCommand`, `NODE_ENV` and maintenance/runtime flags in a reviewed restoration patch. Set `G2_OWNER_APPROVED=false` and `G2_STAGING_REHEARSAL_APPROVED=false` while retaining the other temporary G2 variables until explicit cleanup approval. Restore and verify its original staging data reads before removing any resource it depended on.
2. Present Hema with the exact temporary service ID, both newly created volume IDs, mount/attachment state and remaining backend `G2_*` variable names. Keep their synthetic state available for review until Hema explicitly approves deletion.
3. After that explicit cleanup approval, delete only `g2-mongo-restore-drill`, its two recorded trial volumes and any remaining staging backend `G2_*` variables. Verify the original staging database volumes remain attached to their original services.
4. Report both trial outcomes, legacy code-70 reproduction status, elapsed times, runtime metadata and cleanup results. Execution and deletion approvals are recorded separately.
