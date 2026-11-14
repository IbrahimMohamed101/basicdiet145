#!/usr/bin/env bash
# Destructive restore ONLY into an approved empty isolated target.
set -euo pipefail
umask 077
: "${G2_BACKUP_DIR:?G2_BACKUP_DIR_REQUIRED}"
: "${G2_MONGO_URI:?G2_URI_VARIABLE_REQUIRED}"
: "${G2_MONGO_DB:?G2_DB_NAME_REQUIRED}"
[[ "${G2_RESTORE_EMPTY_TARGET:-}" == "true" ]] || { echo "G2_EMPTY_TARGET_APPROVAL_REQUIRED" >&2; exit 40; }
test -f "$G2_BACKUP_DIR/mongo.archive.gz" &&
test -f "$G2_BACKUP_DIR/mongo.archive.gz.sha256" &&
test -f "$G2_BACKUP_DIR/collections-indexes.json" || {
  echo "G2_ARCHIVE_MANIFEST_REQUIRED" >&2; exit 41;
}
(cd "$G2_BACKUP_DIR" && sha256sum --status --check mongo.archive.gz.sha256) || {
  echo "G2_ARCHIVE_CHECKSUM_MISMATCH" >&2; exit 42;
}
cfg="$(mktemp)"; tmp="$(mktemp)"; trap 'rm -f "$cfg" "$tmp"' EXIT
node -e 'process.stdout.write("uri: "+JSON.stringify(process.env.G2_MONGO_URI)+"\n")' > "$cfg"
chmod 0600 "$cfg"
node scripts/g2-mongo-manifest.js --out "$tmp" >/dev/null
node -e '
const m=require("node:fs");
const f=JSON.parse(m.readFileSync(process.argv[1],"utf8"));
if(Object.keys(f.collections).length!==0)process.exit(43);
' "$tmp" || { echo "G2_RESTORE_TARGET_NOT_EMPTY" >&2; exit 43; }
mongorestore --quiet --config "$cfg" --archive="$G2_BACKUP_DIR/mongo.archive.gz" \
  --gzip --stopOnError --nsInclude="$G2_MONGO_DB.*"
node scripts/g2-mongo-manifest.js --compare "$G2_BACKUP_DIR/collections-indexes.json"
echo "G2_RESTORE_COUNTS_INDEXES_PASS"
