#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-basicdiet-mongo-rs}"

docker run -d \
  --name "${container_name}" \
  -p 27017:27017 \
  mongo:7 \
  --replSet rs0 \
  --bind_ip_all

for attempt in {1..45}; do
  if docker exec "${container_name}" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 2
done

docker exec "${container_name}" mongosh --quiet --eval '
  try {
    rs.status();
  } catch (error) {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] });
  }
'

for attempt in {1..45}; do
  if docker exec "${container_name}" mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; then
    echo "MongoDB replica set is writable"
    exit 0
  fi
  sleep 2
done

echo "MongoDB replica set did not become writable" >&2
docker logs "${container_name}" >&2
exit 1
