#!/usr/bin/env bash
# POS G0 — isolated synthetic restore/replSet/auth/rollback rehearsal.
# This ONLY operates on new disposable local Docker containers and volumes,
# never any Railway or existing MongoDB host. No Production data or PII.
set -euo pipefail
PREFIX="pos-g0-qa-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
SRC="${PREFIX}-source"
DST="${PREFIX}-restore"
VOL="${PREFIX}-volume"
FIXTURE_DB="basicdiet_pos_g0_fixture"
# Fixed local-only CI credential. Neither a Production credential nor a secret
# used outside these disposable containers.
AUTH_USER="pos_g0_ci"
AUTH_PASSWORD="ci-only-no-external-access"
cleanup() {
  docker rm -f "$SRC" "$DST" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$VOL" >/dev/null
await_mongo() {
  local container="$1"
  for _ in $(seq 1 50); do
    if docker exec "$container" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then
      return 0
    fi
    sleep 1
  done
  echo "MongoDB did not become ready in container $container" >&2
  return 1
}
echo "Creating disposable synthetic standalone fixture (no Production sources)"
docker run -d --name "$SRC" --network none \
  -e GLIBC_TUNABLES=glibc.pthread.rseq=1 mongo:8.0 >/dev/null
await_mongo "$SRC"
docker exec "$SRC" mongosh --quiet "$FIXTURE_DB" --eval '
  db.plans.insertOne({_id:"synthetic-plan",daysCount:7,priceHalala:75000});
  db.zones.insertOne({_id:"synthetic-zone",name:"test-zone"});
  db.settings.insertOne({_id:"synthetic-setting",timezone:"Asia/Riyadh"});
  db.plans.createIndex({daysCount:1});
' >/dev/null
docker exec "$SRC" mongodump --quiet --db "$FIXTURE_DB" --archive=/tmp/fixture.archive
docker cp "$SRC:/tmp/fixture.archive" "/tmp/${PREFIX}-fixture.archive" >/dev/null
echo "Restoring only the synthetic backup onto a separate disposable volume"
docker run -d --name "$DST" --network none \
  -e GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  -v "$VOL:/data/db" mongo:8.0 >/dev/null
await_mongo "$DST"
docker cp "/tmp/${PREFIX}-fixture.archive" "$DST:/tmp/fixture.archive" >/dev/null
docker exec "$DST" mongorestore --quiet --drop --archive=/tmp/fixture.archive
docker exec "$DST" mongosh --quiet "$FIXTURE_DB" --eval '
  if(db.plans.countDocuments({})!==1 || db.zones.countDocuments({})!==1 ||
      db.settings.countDocuments({})!==1) throw new Error("Synthetic restore count mismatch");
  if(!db.plans.getIndexes().some(x=>x.name==="daysCount_1"))
    throw new Error("Restored index missing");
' >/dev/null
rm -f "/tmp/${PREFIX}-fixture.archive"
echo "Provisioning disposable keyFile and test user before enabling auth"
docker exec "$DST" sh -c '
  umask 077
  openssl rand -base64 512 > /data/db/rs0-keyfile
  chmod 400 /data/db/rs0-keyfile
  chown mongodb:mongodb /data/db/rs0-keyfile
'
docker exec "$DST" mongosh --quiet admin --eval "
  db.createUser({user:'$AUTH_USER',pwd:'$AUTH_PASSWORD',roles:[{role:'root',db:'admin'}]})
" >/dev/null
docker rm -f "$DST" >/dev/null
docker run -d --name "$DST" --network none \
  -e GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  -v "$VOL:/data/db" mongo:8.0 \
  mongod --replSet rs0 --keyFile /data/db/rs0-keyfile --auth --bind_ip_all >/dev/null

MONGO_AUTH="mongodb://$AUTH_USER:$AUTH_PASSWORD"
MONGO_AUTH="$MONGO_AUTH@127.0.0.1:27017/admin?authSource=admin&directConnection=true"
for _ in $(seq 1 50); do
  if docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then break; fi
  sleep 1
done
echo "Initializing standalone clone as one-node rs0"
docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval '
  rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})
' >/dev/null
for _ in $(seq 1 50); do
  if docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval 'db.adminCommand({hello:1}).isWritablePrimary' 2>/dev/null | grep -q '^true$'; then break; fi
  sleep 1
done
docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval '
  const hello=db.adminCommand({hello:1});
  if(hello.setName!=="rs0"||!hello.isWritablePrimary) throw new Error("Replica set primary unavailable");
  const session=db.getMongo().startSession();
  session.startTransaction();
  session.getDatabase("basicdiet_pos_g0_fixture").settings.insertOne({_id:"must-rollback",value:42});
  session.abortTransaction();
  session.endSession();
  if(db.getSiblingDB("basicdiet_pos_g0_fixture").settings.countDocuments({_id:"must-rollback"})!==0)
    throw new Error("Transaction rollback failed");
  if(db.getSiblingDB("basicdiet_pos_g0_fixture").plans.countDocuments({})!==1)
    throw new Error("Restored data lost after rs0 conversion");
' >/dev/null
echo "Testing rollback to standalone after NO business writes on converted clone"
docker rm -f "$DST" >/dev/null
docker run -d --name "$DST" --network none \
  -e GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  -v "$VOL:/data/db" mongo:8.0 mongod --auth --bind_ip_all >/dev/null
for _ in $(seq 1 50); do
  if docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then break; fi
  sleep 1
done
docker exec "$DST" mongosh --quiet "$MONGO_AUTH" --eval '
  if(db.adminCommand({hello:1}).setName) throw new Error("Standalone rollback did not restore topology");
  const restored=db.getSiblingDB("basicdiet_pos_g0_fixture");
  if(restored.plans.countDocuments({})!==1||restored.zones.countDocuments({})!==1)
    throw new Error("Restored synthetic data not preserved after rollback");
' >/dev/null
echo "POS G0 synthetic restore -> rs0+keyFile+auth -> transaction rollback -> standalone rollback: PASS"
