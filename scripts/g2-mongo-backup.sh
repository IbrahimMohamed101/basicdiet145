#!/usr/bin/env bash
# Require quiesced writes for a consistent standalone logical backup.
set -euo pipefail
umask 077
: "${G2_BACKUP_DIR:?G2_BACKUP_DIR_REQUIRED}"
: "${G2_MONGO_URI:?G2_URI_VARIABLE_REQUIRED}"
: "${G2_MONGO_DB:?G2_DB_NAME_REQUIRED}"
mkdir -p "$G2_BACKUP_DIR"
chmod 0700 "$G2_BACKUP_DIR"
cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
node -e 'process.stdout.write("uri: "+JSON.stringify(process.env.G2_MONGO_URI)+"\n")' > "$cfg"
chmod 0600 "$cfg"
# The URI is read internally by mongodump via mode-0600 config, never argv or stdout.
node scripts/g2-mongo-manifest.js --out "$G2_BACKUP_DIR/collections-indexes.json" >/dev/null
mongodump --quiet --config "$cfg" --db "$G2_MONGO_DB" \
  --archive="$G2_BACKUP_DIR/mongo.archive.gz" --gzip
(
  cd "$G2_BACKUP_DIR"
  sha256sum mongo.archive.gz > mongo.archive.gz.sha256
)
test -s "$G2_BACKUP_DIR/mongo.archive.gz"
echo "G2_BACKUP_ARCHIVE_SHA256_MANIFEST_READY"
