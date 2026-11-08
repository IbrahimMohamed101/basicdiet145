#!/usr/bin/env bash
# G2: GitHub Actions ONLY. Uses mongo:8.0, two disposable Docker volumes, synthetic records.
# Never talks to Railway, network proxies, existing databases, or real customer records.
set -euo pipefail
umask 077
[[ "${GITHUB_ACTIONS:-}" == "true" && "${CI:-}" == "true" ]] || {
  echo "G2_GITHUB_ACTIONS_ONLY" >&2; exit 64;
}
export G2_EXECUTION_SCOPE=ci-disposable
export G2_MONGO_DB=basicdiet_g2_ci_test
export NODE_ENV=test
RUN_TOKEN="${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
SOURCE="g2-ci-source-$RUN_TOKEN"
TARGET="g2-ci-restore-$RUN_TOKEN"
SOURCE_VOL="g2-ci-source-vol-$RUN_TOKEN"
TARGET_VOL="g2-ci-target-vol-$RUN_TOKEN"
export G2_BACKUP_DIR="$(mktemp -d)"
export G2_CI_ROOT_USER="g2_ci_root"
export G2_CI_ROOT_PASSWORD="$(openssl rand -hex 24)"
export G2_RS0_KEYFILE="$(openssl rand -base64 512 | tr -d '\n')"
clean() {
  docker rm -f "$SOURCE" "$TARGET" >/dev/null 2>&1 || true
  docker volume rm "$SOURCE_VOL" "$TARGET_VOL" >/dev/null 2>&1 || true
  rm -rf "$G2_BACKUP_DIR"
}
trap clean EXIT
timed() {
  local step="$1"; shift
  local start end
  start="$(date +%s%3N)"
  "$@"
  end="$(date +%s%3N)"
  echo "G2_TIMING step=$step duration_ms=$((end-start))"
}
wait_auth() {
  local container="$1"
  for n in $(seq 1 90); do
    if docker exec "$container" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -qx 1; then
      return 0
    fi
    sleep 1
  done
  echo "G2_MONGO_READINESS_TIMEOUT" >&2
  return 1
}
start_standalone() {
  local name="$1" volume="$2" port="$3"
  docker run -d --name "$name" --hostname g2-internal \
    -p "127.0.0.1:$port:27017" \
    -v "$volume:/data/db" \
    -e "MONGO_INITDB_ROOT_USERNAME=$G2_CI_ROOT_USER" \
    -e "MONGO_INITDB_ROOT_PASSWORD=$G2_CI_ROOT_PASSWORD" \
    mongo:8.0 mongod --ipv6 --bind_ip ::,0.0.0.0 --auth \
    --setParameter diagnosticDataCollectionEnabled=false >/dev/null
  wait_auth "$name"
}
start_rs0() {
  local name="$1" volume="$2" port="$3"
  docker run -d --name "$name" --hostname g2-internal \
    -p "127.0.0.1:$port:27017" \
    -v "$volume:/data/db" \
    -v "$PWD/scripts/g2-mongo-start-rs0.sh:/g2-start.sh:ro" \
    -e G2_RS0_KEYFILE -e G2_EXECUTION_SCOPE \
    mongo:8.0 bash /g2-start.sh >/dev/null
  wait_auth "$name"
  docker exec "$name" sh -c '
    test "$(stat -c %a /data/db/g2-rs0-keyfile)" = 400 &&
    test "$(stat -c %u /data/db/g2-rs0-keyfile)" = "$(id -u mongodb)"
  '
}
init_rs0() {
  local name="$1"
  docker cp scripts/g2-mongo-init-rs0.js "$name:/tmp/g2-init.js" >/dev/null
  local inside_uri
  inside_uri="mongodb://$G2_CI_ROOT_USER:$G2_CI_ROOT_PASSWORD@127.0.0.1:27017/$G2_MONGO_DB?authSource=admin&directConnection=true"
  docker exec -e "G2_EXECUTION_SCOPE=ci-disposable" \
    -e "G2_RS0_MEMBER_HOST=localhost" \
    -e "G2_MONGO_URI=$inside_uri" \
    "$name" mongosh --quiet --nodb --file /tmp/g2-init.js
}
local_uri() {
  local port="$1" replica="$2"
  G2_MONGO_URI="mongodb://$G2_CI_ROOT_USER:$G2_CI_ROOT_PASSWORD@127.0.0.1:$port/$G2_MONGO_DB?authSource=admin&directConnection=true"
  if [[ "$replica" == "yes" ]]; then G2_MONGO_URI="$G2_MONGO_URI&replicaSet=rs0"; fi
  export G2_MONGO_URI
  export MONGO_URI_TEST="$G2_MONGO_URI"
}
docker volume create "$SOURCE_VOL" >/dev/null
docker volume create "$TARGET_VOL" >/dev/null
timed source_standalone_start start_standalone "$SOURCE" "$SOURCE_VOL" 27017
local_uri 27017 no
timed synthetic_seed node scripts/g2-mongo-synthetic-seed.js
timed backup_archive_sha256_manifest bash scripts/g2-mongo-backup.sh
timed source_graceful_stop docker stop --time 20 "$SOURCE"
docker rm "$SOURCE" >/dev/null
timed source_rs0_restart start_rs0 "$SOURCE" "$SOURCE_VOL" 27017
timed source_initiate_primary init_rs0 "$SOURCE"
timed source_initiate_idempotent init_rs0 "$SOURCE"
local_uri 27017 yes
timed source_counts_indexes node scripts/g2-mongo-manifest.js --compare "$G2_BACKUP_DIR/collections-indexes.json"
timed source_commit_abort node scripts/g2-mongo-verify.js "$G2_BACKUP_DIR/collections-indexes.json"
timed backend_transaction_support node scripts/g2-mongo-backend-capability.js
# Existing monetary regressions run using the same Node backend modules.
timed pos_financial_regressions node --test \
  tests/posG2ExpectedTotals.test.js tests/posInvoiceMath.test.js tests/posFinancialQuote.test.js
# Separate destination volume; first bootstrap an authenticated standalone user,
# then switch that SAME new volume to rs0/keyfile/auth, then restore.
timed target_empty_standalone_start start_standalone "$TARGET" "$TARGET_VOL" 27018
timed target_graceful_stop docker stop --time 20 "$TARGET"
docker rm "$TARGET" >/dev/null
timed target_rs0_restart start_rs0 "$TARGET" "$TARGET_VOL" 27018
timed target_initiate_primary init_rs0 "$TARGET"
local_uri 27018 yes
export G2_RESTORE_EMPTY_TARGET=true
timed restore_archive_counts_indexes bash scripts/g2-mongo-restore.sh
timed restored_commit_abort node scripts/g2-mongo-verify.js "$G2_BACKUP_DIR/collections-indexes.json"
echo "G2_SYNTHETIC_STANDALONE_TO_RS0_RESTORE_DRILL_PASS"
