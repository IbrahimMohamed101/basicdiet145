#!/usr/bin/env bash
set -euo pipefail

# All credentials and data are generated inside this disposable job. No Railway
# tokens, deployment hooks, host networking, published ports or account secrets.
mode="${1:-current}"
[[ "$mode" == current || "$mode" == legacy ]]
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true ]]
rehearsal_tmp=$(mktemp -d)
network="g2-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${mode}"
volume="${network}-data"
mongo="${network}-mongo"
cleanup() {
  docker rm -f "$mongo" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$rehearsal_tmp"
  rm -f scripts/.g2-legacy-init.js
}
trap cleanup EXIT
export G2_REHEARSAL_ENV_FILE="$rehearsal_tmp/common.env"
node <<'NODE'
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const username = 'g2_' + randomBytes(8).toString('hex');
const password = randomBytes(32).toString('hex');
process.stdout.write('::add-mask::' + username + '\n::add-mask::' + password + '\n');
const uri = new URL('mongodb://mongodb.railway.internal:27017/test?authSource=admin');
uri.username = username;
uri.password = password;
const variables = {
  CI: 'true', GITHUB_ACTIONS: 'true', G2_SYNTHETIC_DOCKER: 'true',
  NODE_ENV: 'production', MAINTENANCE_MODE: 'true',
  LOG_DIR: '/tmp/g2-rehearsal-logs',
  G2_OWNER_APPROVED: 'true', G2_EXECUTION_SCOPE: 'owner-approved',
  MONGO_INITDB_ROOT_USERNAME: username, MONGO_INITDB_ROOT_PASSWORD: password,
  G2_MONGO_URI: uri.toString(), MONGO_URI: uri.toString() + '&replicaSet=rs0',
};
fs.writeFileSync(process.env.G2_REHEARSAL_ENV_FILE,
  Object.entries(variables).map(([key, value]) => key + '=' + value).join('\n') + '\n', { mode: 0o600 });
NODE
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker pull mongo:8.0 >/dev/null
docker pull node:20-alpine >/dev/null
echo "G2_REHEARSAL_KERNEL=$(uname -r)"
docker image inspect --format '{{index .RepoDigests 0}}' mongo:8.0

node_container() {
  docker run --rm --network "$network" --env-file "$G2_REHEARSAL_ENV_FILE" \
    -v "$PWD:/work:ro" -w /work node:20-alpine "$@"
}
wait_mongo() {
  for attempt in $(seq 1 45); do
    if node_container node -e '
      const { MongoClient } = require("mongodb");
      const uri = new URL(process.env.G2_MONGO_URI);
      uri.searchParams.set("directConnection", "true");
      const client = new MongoClient(uri.toString(), { serverSelectionTimeoutMS: 1000 });
      client.connect().then(() => client.close(), async error => {
        error.g2Stage = "connect";
        process.stderr.write(require("./scripts/g2-rs0-init-and-verify").diagnostic(error));
        await client.close(); process.exitCode = 1;
      });
    ' > "$rehearsal_tmp/readiness.stdout" 2> "$rehearsal_tmp/readiness.stderr"; then return; fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$mongo")" != true ]]; then break; fi
    sleep 1
  done
  echo 'G2_DOCKER_READY_TIMEOUT' >&2
  cat "$rehearsal_tmp/readiness.stderr" >&2
  docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}}' "$mongo"
  docker logs "$mongo" 2>&1 | node -e '
    let text = ""; process.stdin.on("data", chunk => text += chunk);
    process.stdin.on("end", () => {
      for (const line of text.trim().split("\n").slice(-15)) {
        try { const log = JSON.parse(line); console.log(JSON.stringify({ s: log.s, id: log.id, msg: log.msg })); }
        catch { /* Non-JSON entrypoint output is excluded. */ }
      }
    });'
  return 1
}

# Exact former standalone start command. The official entrypoint creates the root
# account from MONGO_INITDB_ROOT_* on this fresh volume before accepting clients.
docker run -d --name "$mongo" --network "$network" \
  --network-alias mongodb.railway.internal --env-file "$G2_REHEARSAL_ENV_FILE" \
  -v "$volume:/data/db" mongo:8.0 \
  docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 \
  --setParameter diagnosticDataCollectionEnabled=false >/dev/null
wait_mongo
node_container node -e 'console.log("G2_REHEARSAL_NODE=" + process.version); console.log("G2_REHEARSAL_DRIVER=" + require("mongodb/package.json").version)'
node_container node scripts/ci/g2-synthetic-seed.js
node_container node scripts/g2-rs0-init-and-verify.js --baseline > "$rehearsal_tmp/baseline"
export G2_REHEARSAL_BASELINE_FILE="$rehearsal_tmp/baseline"
node <<'NODE'
const fs = require('node:fs');
const { gunzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const lines = fs.readFileSync(process.env.G2_REHEARSAL_BASELINE_FILE, 'utf8').trim().split('\n');
assert.equal(lines.length, 3);
const values = Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const compressed = values.G2_BASELINE_GZ;
const json = gunzipSync(Buffer.from(compressed, 'base64'));
const old = json.toString('base64');
assert.ok(old.length > 32768);
assert.ok(compressed.length < 30000);
assert.equal(Number(values.G2_BASELINE_BYTES), compressed.length);
fs.appendFileSync(process.env.G2_REHEARSAL_ENV_FILE,
  'G2_BASELINE_MANIFEST_GZ_B64=' + compressed + '\nG2_BASELINE_SHA256=' + values.G2_BASELINE_SHA256 + '\n' +
  'G2_BASELINE_PART1=' + old.slice(0, 30000) + '\nG2_BASELINE_PART2=' + old.slice(30000) + '\n');
process.stdout.write('G2_BASELINE_GZ_BYTES=' + compressed.length + '\nG2_BASELINE_JSON_BYTES=' + json.length + '\n');
NODE
docker stop "$mongo" >/dev/null
docker rm "$mongo" >/dev/null
docker run --rm --user 0 -v "$volume:/data/db" mongo:8.0 sh -c \
  'umask 077; head -c 756 /dev/urandom | base64 > /data/db/rs0-keyfile; chown mongodb:mongodb /data/db/rs0-keyfile; chmod 400 /data/db/rs0-keyfile'
docker run -d --name "$mongo" --network "$network" \
  --network-alias mongodb.railway.internal --env-file "$G2_REHEARSAL_ENV_FILE" \
  -v "$volume:/data/db" mongo:8.0 \
  docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 \
  --setParameter diagnosticDataCollectionEnabled=false \
  --replSet rs0 --keyFile /data/db/rs0-keyfile --auth >/dev/null
wait_mongo

if [[ "$mode" == legacy ]]; then
  git show c4580553a56f986e7702471b32a82d74e12e1c65:scripts/g2-rs0-init-and-verify.js > scripts/.g2-legacy-init.js
  set +e
  node_container sh -c 'export G2_BASELINE_MANIFEST_B64="${G2_BASELINE_PART1}${G2_BASELINE_PART2}"; exec node scripts/.g2-legacy-init.js' \
    > "$rehearsal_tmp/legacy.stdout" 2> "$rehearsal_tmp/legacy.stderr"
  legacy_exit=$?
  set -e
  echo "G2_LEGACY_EXIT=$legacy_exit"
  if [[ "$legacy_exit" != 0 ]]; then
    # Replay only while still uninitialized. Never re-run an unknown mutation.
    # A failed log read is fatal. grep a completed file to avoid pipefail/SIGPIPE.
    docker logs "$mongo" > "$rehearsal_tmp/mongo.log" 2>&1
    if grep -q 'replSetInitiate' "$rehearsal_tmp/mongo.log"; then
      echo 'G2_LEGACY_POST_INIT_FAILURE' >&2
      exit 1
    fi
    set +e
    node_container sh -c 'export G2_BASELINE_MANIFEST_B64="${G2_BASELINE_PART1}${G2_BASELINE_PART2}"; exec node scripts/ci/g2-legacy-diagnostics.js'
    diagnostic_exit=$?
    set -e
    [[ "$diagnostic_exit" != 0 ]]
  else
    grep -qx 'G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS' "$rehearsal_tmp/legacy.stdout"
    echo 'G2_LEGACY_FAILURE_NOT_REPRODUCED'
  fi
else
  for negative in corrupt-gzip wrong-sha missing-sha legacy-only; do
    set +e
    node_container node -e '
      const { spawnSync } = require("node:child_process");
      const env = { ...process.env };
      const mode = process.argv[1];
      if (mode === "corrupt-gzip") env.G2_BASELINE_MANIFEST_GZ_B64 = Buffer.from("synthetic-invalid-gzip").toString("base64");
      if (mode === "wrong-sha") env.G2_BASELINE_SHA256 = "0".repeat(64);
      if (mode === "missing-sha") delete env.G2_BASELINE_SHA256;
      if (mode === "legacy-only") {
        delete env.G2_BASELINE_MANIFEST_GZ_B64;
        env.G2_BASELINE_MANIFEST_B64 = env.G2_BASELINE_PART1 + env.G2_BASELINE_PART2;
      }
      const result = spawnSync(process.execPath, ["scripts/g2-rs0-init-and-verify.js"], { env, encoding: "utf8" });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.status;
    ' "$negative" > "$rehearsal_tmp/negative.stdout" 2> "$rehearsal_tmp/negative.stderr"
    negative_exit=$?
    set -e
    [[ "$negative_exit" == 71 ]]
    grep -q 'G2_FAIL stage=manifest code=G2_MANIFEST_REQUIRED' "$rehearsal_tmp/negative.stderr"
    ! grep -q 'G2_INITIATE_SENT' "$rehearsal_tmp/negative.stdout"
    docker logs "$mongo" > "$rehearsal_tmp/mongo.log" 2>&1
    ! grep -q 'replSetInitiate' "$rehearsal_tmp/mongo.log"
    echo "G2_NEGATIVE_${negative}_PASS"
  done
fi

# Also proves the new implementation passes in the legacy reproduction job.
node_container node scripts/g2-rs0-init-and-verify.js > "$rehearsal_tmp/current.stdout" 2> "$rehearsal_tmp/current.stderr" || {
  cat "$rehearsal_tmp/current.stderr" >&2
  exit 1
}
grep -qx 'G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS' "$rehearsal_tmp/current.stdout"
cat "$rehearsal_tmp/current.stdout"
if [[ "$mode" == current ]]; then
  # Retry with the same signed baseline must take the already-initialized path.
  node_container node scripts/g2-rs0-init-and-verify.js > "$rehearsal_tmp/retry.stdout"
  grep -qx 'G2_INITIATE_ALREADY' "$rehearsal_tmp/retry.stdout"
  grep -qx 'G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS' "$rehearsal_tmp/retry.stdout"
  echo 'G2_RETRY_PASS'
fi
