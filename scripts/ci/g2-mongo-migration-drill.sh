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
NETWORK="g2-ci-private-$RUN_TOKEN"
SOURCE_ALIAS="mongodb.railway.internal"
TARGET_ALIAS="g2-restore.railway.internal"
FINAL_START_COMMAND="$(cat scripts/g2-mongo-final-start-command.txt)"
[[ "$FINAL_START_COMMAND" == /bin/sh\ -ec\ \'* && "$FINAL_START_COMMAND" == *'exec docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false --replSet rs0 --keyFile /data/db/rs0-keyfile --auth'* ]] || { echo "G2_START_COMMAND_DRIFT" >&2; exit 65; }
export G2_BACKUP_DIR="$(mktemp -d)"
export G2_CI_ROOT_USER="g2_ci_root"
export G2_CI_ROOT_PASSWORD="$(openssl rand -hex 24)"
export G2_RS0_KEYFILE="$(openssl rand -base64 512 | tr -d '\n')"
clean() {
  docker rm -f "$SOURCE" "$TARGET" >/dev/null 2>&1 || true
  docker volume rm "$SOURCE_VOL" "$TARGET_VOL" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
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
  # Docker state and exit code ONLY; never print Mongo logs, URI or environment.
  local state
  state="$(docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}}' "$container" 2>/dev/null || echo missing)"
  local diagnostic="UNKNOWN"
  if docker logs "$container" 2>&1 | grep -Eqi 'AVX|Illegal instruction'; then diagnostic="CPU_INSTRUCTION"; fi
  if docker logs "$container" 2>&1 | grep -Eqi 'rseq|pthread'; then diagnostic="RSEQ_RUNTIME"; fi
  if docker logs "$container" 2>&1 | grep -Eqi 'unrecognized option|unknown option'; then diagnostic="MONGO_OPTION"; fi
  if docker logs "$container" 2>&1 | grep -Eqi 'cannot assign requested address|address already in use|failed to set up listener'; then diagnostic="BIND"; fi
  if docker logs "$container" 2>&1 | grep -Eqi 'permission denied|access denied'; then diagnostic="PERMISSIONS"; fi
  echo "G2_MONGO_READINESS_TIMEOUT state=$state diagnostic=$diagnostic" >&2
  return 1
}
start_standalone() {
  local name="$1" volume="$2" port="$3" alias="$4"
  docker run -d --name "$name" --hostname "$alias" \
    --network "$NETWORK" --network-alias "$alias" \
    -p "127.0.0.1:$port:27017" -v "$volume:/data/db" \
    -e "GLIBC_TUNABLES=glibc.pthread.rseq=1" \
    -e "MONGO_INITDB_ROOT_USERNAME=$G2_CI_ROOT_USER" \
    -e "MONGO_INITDB_ROOT_PASSWORD=$G2_CI_ROOT_PASSWORD" \
    mongo:8.0 mongod --ipv6 --bind_ip ::,0.0.0.0 \
    --setParameter diagnosticDataCollectionEnabled=false --auth >/dev/null
  wait_auth "$name"
}
start_rs0() {
  local name="$1" volume="$2" port="$3" alias="$4" mode="${5:-without-secret}"
  local secret_env=()
  if [[ "$mode" == "with-secret" ]]; then secret_env=(-e G2_RS0_KEYFILE); fi
  # Launch EXACT golden Start Command. Only first boot receives the key secret.
  # Railway's explicit startCommand replaces the image ENTRYPOINT, so invoke it.
  docker run -d --name "$name" --hostname "$alias" \
    --network "$NETWORK" --network-alias "$alias" \
    -p "127.0.0.1:$port:27017" -v "$volume:/data/db" \
    --entrypoint /bin/sh -e "GLIBC_TUNABLES=glibc.pthread.rseq=1" \
    "${secret_env[@]}" mongo:8.0 -ec "$FINAL_START_COMMAND" >/dev/null
  wait_auth "$name"
  docker exec "$name" sh -c '
    test "$(stat -c %a /data/db/rs0-keyfile)" = 400 &&
    test "$(stat -c %u /data/db/rs0-keyfile)" = "$(id -u mongodb)"
  '
}
node_init_rs0() {
  local alias="$1" port="$2" baseline="$3"
  local_uri "$port" no
  export G2_OWNER_APPROVED=true G2_RS0_MEMBER_HOST="$alias"
  G2_BASELINE_MANIFEST_B64="$(base64 -w0 "$baseline")" node scripts/g2-rs0-init-and-verify.js
}
restart_without_secret_and_assert_inode() {
  local name="$1" volume="$2" port="$3" alias="$4"
  local before after
  before="$(docker exec "$name" stat -c '%i:%s:%Y:%Z' /data/db/rs0-keyfile)"
  docker stop --time 20 "$name" >/dev/null
  docker rm "$name" >/dev/null
  start_rs0 "$name" "$volume" "$port" "$alias" without-secret
  after="$(docker exec "$name" stat -c '%i:%s:%Y:%Z' /data/db/rs0-keyfile)"
  [[ "$before" == "$after" ]] || { echo "G2_KEYFILE_WAS_MODIFIED_ON_RESTART" >&2; exit 66; }
  echo "G2_KEYFILE_RESTART_WITHOUT_SECRET_PASS"
}
backend_from_peer_container() {
  local alias="$1" mode="$2"
  local uri="mongodb://$G2_CI_ROOT_USER:$G2_CI_ROOT_PASSWORD@$alias:27017/$G2_MONGO_DB?authSource=admin&replicaSet=rs0"
  local topology="ReplicaSetWithPrimary"
  if [[ "$mode" == direct ]]; then
    uri="$uri&directConnection=true"
    topology="Single"
  fi
  # The real backend db.js / URI resolver runs in another container on the same
  # Docker bridge as MongoDB. No host-port shortcut and no localhost rs0 member.
  docker run --rm --network "$NETWORK" -v "$PWD:/work:ro" -w /tmp \
    -e "CI=true" -e "GITHUB_ACTIONS=true" \
    -e "G2_EXECUTION_SCOPE=ci-disposable" -e "G2_CI_PEER_CONTAINER=true" \
    -e "NODE_ENV=production" -e "MONGO_URI=$uri" \
    -e "G2_EXPECTED_CLIENT_TOPOLOGY=$topology" \
    node:20-bookworm node /work/scripts/g2-mongo-backend-capability.js
}
local_uri() {
  local port="$1" replica="$2"
  G2_MONGO_URI="mongodb://$G2_CI_ROOT_USER:$G2_CI_ROOT_PASSWORD@127.0.0.1:$port/$G2_MONGO_DB?authSource=admin&directConnection=true"
  if [[ "$replica" == "yes" ]]; then G2_MONGO_URI="$G2_MONGO_URI&replicaSet=rs0"; fi
  export G2_MONGO_URI
  export MONGO_URI_TEST="$G2_MONGO_URI"
}
docker network create "$NETWORK" >/dev/null
docker volume create "$SOURCE_VOL" >/dev/null
docker volume create "$TARGET_VOL" >/dev/null
timed source_standalone_start start_standalone "$SOURCE" "$SOURCE_VOL" 27017 "$SOURCE_ALIAS"
local_uri 27017 no
timed synthetic_seed node scripts/g2-mongo-synthetic-seed.js
timed backup_archive_sha256_manifest bash scripts/g2-mongo-backup.sh
timed source_graceful_stop docker stop --time 20 "$SOURCE"
docker rm "$SOURCE" >/dev/null
timed source_rs0_first_boot_create_keyfile start_rs0 "$SOURCE" "$SOURCE_VOL" 27017 "$SOURCE_ALIAS" with-secret
unset G2_RS0_KEYFILE
timed source_restart_without_keyfile_variable restart_without_secret_and_assert_inode "$SOURCE" "$SOURCE_VOL" 27017 "$SOURCE_ALIAS"
timed source_node_initiate_primary node_init_rs0 "$SOURCE_ALIAS" 27017 "$G2_BACKUP_DIR/collections-indexes.json"
timed source_node_initiate_idempotent node_init_rs0 "$SOURCE_ALIAS" 27017
local_uri 27017 yes
timed source_counts_indexes node scripts/g2-mongo-manifest.js --compare "$G2_BACKUP_DIR/collections-indexes.json"
timed source_commit_abort node scripts/g2-mongo-verify.js "$G2_BACKUP_DIR/collections-indexes.json"
timed backend_peer_rs0_discovery backend_from_peer_container "$SOURCE_ALIAS" discovery
timed backend_peer_direct_connection backend_from_peer_container "$SOURCE_ALIAS" direct
# Existing monetary regressions run using the same Node backend modules.
timed pos_financial_regressions node --test \
  tests/posG2ExpectedTotals.test.js tests/posInvoiceMath.test.js tests/posFinancialQuote.test.js
# Separate destination volume; first bootstrap an authenticated standalone user,
# then switch that SAME new volume to rs0/keyfile/auth, then restore.
timed target_empty_standalone_start start_standalone "$TARGET" "$TARGET_VOL" 27018 "$TARGET_ALIAS"
local_uri 27018 no
timed target_standalone_manifest node scripts/g2-mongo-manifest.js --out "$G2_BACKUP_DIR/target-collections-before-rs0.json"
timed target_graceful_stop docker stop --time 20 "$TARGET"
docker rm "$TARGET" >/dev/null
export G2_RS0_KEYFILE="$(openssl rand -base64 512 | tr -d '\n')"
timed target_rs0_first_boot_create_keyfile start_rs0 "$TARGET" "$TARGET_VOL" 27018 "$TARGET_ALIAS" with-secret
unset G2_RS0_KEYFILE
timed target_restart_without_keyfile_variable restart_without_secret_and_assert_inode "$TARGET" "$TARGET_VOL" 27018 "$TARGET_ALIAS"
timed target_node_initiate_primary node_init_rs0 "$TARGET_ALIAS" 27018 "$G2_BACKUP_DIR/target-collections-before-rs0.json"
local_uri 27018 yes
export G2_RESTORE_EMPTY_TARGET=true
timed restore_archive_counts_indexes bash scripts/g2-mongo-restore.sh
timed restored_commit_abort node scripts/g2-mongo-verify.js "$G2_BACKUP_DIR/collections-indexes.json"
timed restored_backend_peer_rs0_discovery backend_from_peer_container "$TARGET_ALIAS" discovery
timed restored_backend_peer_direct_connection backend_from_peer_container "$TARGET_ALIAS" direct
echo "G2_SYNTHETIC_STANDALONE_TO_RS0_RESTORE_DRILL_PASS"
