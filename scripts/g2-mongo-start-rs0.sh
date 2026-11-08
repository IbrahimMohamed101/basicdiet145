#!/usr/bin/env bash
# G2 PREPARATION ONLY: execute exclusively in a separately approved maintenance window.
# Preserve the existing Railway /data/db mount and MongoDB 8.0 startup options.
set -euo pipefail
umask 077
if [[ "${G2_EXECUTION_SCOPE:-}" != "ci-disposable" && "${G2_OWNER_APPROVED:-}" != "true" ]]; then
  echo "G2_OWNER_APPROVAL_REQUIRED" >&2; exit 32
fi
if [[ "$(id -u)" != "0" ]]; then
  echo "G2_ROOT_FOR_KEYFILE_REQUIRED (RAILWAY_RUN_UID=0)" >&2; exit 33
fi
if [[ -z "${G2_RS0_KEYFILE:-}" || ${#G2_RS0_KEYFILE} -lt 6 || ${#G2_RS0_KEYFILE} -gt 1024 ||
  ! "${G2_RS0_KEYFILE}" =~ ^[A-Za-z0-9+/=]+$ ]]; then
  echo "G2_KEYFILE_INVALID" >&2; exit 34
fi
test -d /data/db || { echo "G2_VOLUME_NOT_MOUNTED" >&2; exit 35; }
file=/data/db/g2-rs0-keyfile
temp="$(mktemp /data/db/.g2-keyfile.XXXXXXXX)"
trap 'rm -f "$temp"' EXIT
printf '%s' "$G2_RS0_KEYFILE" > "$temp"
chown "$(id -u mongodb):$(id -g mongodb)" "$temp"
chmod 0400 "$temp"
if [[ -e "$file" ]]; then
  # Rotation is separate from G2. Never overwrite a persisted key on restart.
  if ! cmp -s "$temp" "$file"; then
    echo "G2_KEYFILE_CHANGED_REQUIRES_SEPARATE_APPROVAL" >&2; exit 36
  fi
  rm -f "$temp"
  chown "$(id -u mongodb):$(id -g mongodb)" "$file"
  chmod 0400 "$file"
else
  mv "$temp" "$file"
fi
trap - EXIT
unset G2_RS0_KEYFILE
# Original standalone start flags are retained; only add rs0/auth/keyFile.
exec docker-entrypoint.sh mongod \
  --ipv6 --bind_ip ::,0.0.0.0 \
  --setParameter diagnosticDataCollectionEnabled=false \
  --replSet rs0 --keyFile "$file" --auth
