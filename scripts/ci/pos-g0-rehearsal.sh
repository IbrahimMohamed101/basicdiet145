#!/usr/bin/env bash
set -euo pipefail

# Self-contained Staging/CI rehearsal using two disposable MongoDB 8 Docker
# volumes. NO Railway / Production hostnames, credentials, PII, or database copy.
source_container="basicdiet-g0-source-$$"
clone_container="basicdiet-g0-clone-$$"
source_volume="basicdiet-g0-source-$$"
clone_volume="basicdiet-g0-clone-$$"
archive_path="/tmp/basicdiet-g0-synthetic-$$.archive"
cleanup() {
  docker rm -f "$source_container" "$clone_container" >/dev/null 2>&1 || true
  docker volume rm "$source_volume" "$clone_volume" >/dev/null 2>&1 || true
  rm -f "$archive_path"
}
trap cleanup EXIT

wait_mongod() {
  local container="$1"
  for i in $(seq 1 80); do
    if docker exec "$container" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' \
      2>/dev/null | grep -q '^1$'; then return 0; fi
    sleep 1
  done
  echo "MongoDB did not start in $container" >&2
  docker logs "$container" >&2
  return 1
}

docker volume create "$source_volume" >/dev/null
docker volume create "$clone_volume" >/dev/null
docker run -d --name "$source_container" -v "$source_volume:/data/db" mongo:8.0 \
  --bind_ip 127.0.0.1 >/dev/null
wait_mongod "$source_container"
docker exec "$source_container" mongosh --quiet --eval '
  const coll = db.getSiblingDB("g0_synthetic").plans;
  coll.insertOne({ key: "synthetic_only", daysCount: 7, priceHalala: 10000 });
  if (coll.countDocuments({}) !== 1) throw new Error("Source fixture failed");
'
docker exec "$source_container" mongodump --db g0_synthetic \
  --archive=/tmp/g0_synthetic.archive >/dev/null
docker cp "$source_container:/tmp/g0_synthetic.archive" "$archive_path" >/dev/null
test -s "$archive_path"

docker run -d --name "$clone_container" -v "$clone_volume:/data/db" mongo:8.0 \
  --bind_ip 127.0.0.1 >/dev/null
wait_mongod "$clone_container"
docker cp "$archive_path" "$clone_container:/tmp/restore.archive" >/dev/null
docker exec "$clone_container" mongorestore --archive=/tmp/restore.archive \
  --nsFrom='g0_synthetic.*' --nsTo='g0_rehearsal.*' >/dev/null
docker exec "$clone_container" mongosh --quiet --eval '
  const row = db.getSiblingDB("g0_rehearsal").plans.findOne({ key: "synthetic_only" });
  if (!row || row.priceHalala !== 10000) throw new Error("Restore verification failed");
  if (db.getSiblingDB("g0_rehearsal").users.countDocuments({}) !== 0)
    throw new Error("Unexpected PII collection after restore");
'
echo "G0_RESTORED_SYNTHETIC_COUNT=1"

# Generate the keyfile solely inside this ephemeral isolated volume.
docker exec -u root "$clone_container" bash -c '
  umask 077
  openssl rand -base64 756 > /data/db/rs0-keyfile
  chown mongodb:mongodb /data/db/rs0-keyfile
  chmod 400 /data/db/rs0-keyfile
'
local_password="$(openssl rand -hex 24)"
docker exec -e G0_PASSWORD="$local_password" "$clone_container" mongosh --quiet --eval '
  db.getSiblingDB("admin").createUser({
    user: "g0-local-only", pwd: process.env.G0_PASSWORD, roles: ["root"]
  })
'
docker rm -f "$clone_container" >/dev/null
docker run -d --name "$clone_container" -v "$clone_volume:/data/db" mongo:8.0 \
  --bind_ip 127.0.0.1 --replSet rs0 --keyFile /data/db/rs0-keyfile --auth >/dev/null

for i in $(seq 1 80); do
  if docker exec -e G0_PASSWORD="$local_password" "$clone_container" mongosh --quiet --eval '
      const ok = db.getSiblingDB("admin").auth("g0-local-only", process.env.G0_PASSWORD);
      if (!ok) throw new Error("Mongo auth failed");
      db.runCommand({ ping: 1 }).ok;
    ' 2>/dev/null | grep -q '^1$'; then break; fi
  sleep 1
done

docker exec -i -e G0_PASSWORD="$local_password" "$clone_container" mongosh --quiet <<'JS'
if (!db.getSiblingDB("admin").auth("g0-local-only", process.env.G0_PASSWORD))
  throw new Error("Mongo auth failed");
rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] });
JS

for i in $(seq 1 80); do
  if docker exec -e G0_PASSWORD="$local_password" "$clone_container" mongosh --quiet --eval '
      db.getSiblingDB("admin").auth("g0-local-only", process.env.G0_PASSWORD);
      db.hello().isWritablePrimary;
    ' 2>/dev/null | grep -q '^true$'; then break; fi
  sleep 1
done

docker exec -i -e G0_PASSWORD="$local_password" "$clone_container" mongosh --quiet <<'JS'
if (!db.getSiblingDB("admin").auth("g0-local-only", process.env.G0_PASSWORD))
  throw new Error("Mongo auth failed");
if (db.hello().setName !== "rs0" || !db.hello().isWritablePrimary)
  throw new Error("Replica set primary not established");
const session = db.getMongo().startSession();
try {
  session.startTransaction();
  session.getDatabase("g0_rehearsal").rollback_probe.insertOne({ event: "abort_me" });
  session.abortTransaction();
} finally { session.endSession(); }
if (db.getSiblingDB("g0_rehearsal").rollback_probe.countDocuments({}) !== 0)
  throw new Error("Transaction rollback failed");
if (db.getSiblingDB("g0_rehearsal").plans.countDocuments({}) !== 1)
  throw new Error("Restored config missing after RS conversion");
print("G0_RS0_TRANSACTION_ROLLBACK=PASS");
JS

# Roll back the *disposable clone* to the original standalone command.
docker rm -f "$clone_container" >/dev/null
docker run -d --name "$clone_container" -v "$clone_volume:/data/db" mongo:8.0 \
  --bind_ip 127.0.0.1 >/dev/null
wait_mongod "$clone_container"
docker exec "$clone_container" mongosh --quiet --eval '
  if (db.hello().setName) throw new Error("Rollback was not standalone");
  if (db.getSiblingDB("g0_rehearsal").plans.countDocuments({}) !== 1)
    throw new Error("Rollback lost restored fixture");
'
echo "G0_STANDALONE_ROLLBACK=PASS"
