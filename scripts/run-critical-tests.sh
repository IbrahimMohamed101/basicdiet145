#!/bin/bash
# Runs the critical subset with the same MongoDB isolation as run-all-tests.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test-db-isolation.sh"

FORCE_TEST_DB=""
PASSTHROUGH_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-test-db)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --force-test-db requires a database name."
        exit 1
      fi
      FORCE_TEST_DB="$2"
      shift 2
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Strip leading whitespace
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    # Skip empty lines and comments
    if [ -n "$trimmed" ] && [[ ! "$trimmed" =~ ^# ]]; then
      export "$trimmed"
    fi
  done < .env
fi

if [ -n "${MONGO_URI_TEST:-}" ]; then
  export MONGO_URI="$MONGO_URI_TEST"
fi

BASE_MONGO_URI="${MONGO_URI:-}"
echo "DEBUG MONGO_URI is: '${MONGO_URI}'"
BASE_DB_NAME=""

if [ -n "$BASE_MONGO_URI" ]; then
  BASE_DB_NAME=$(mongo_uri_db_name "$BASE_MONGO_URI")
  echo "Using base MONGO_URI: $(mask_mongo_uri "$BASE_MONGO_URI")"
  echo "Base database: $BASE_DB_NAME"
else
  echo "WARNING: MONGO_URI is not set. Mongo-backed critical tests may fail or use local defaults."
fi

if [ -n "$FORCE_TEST_DB" ]; then
  if ! is_safe_test_db_name "$FORCE_TEST_DB"; then
    echo "ERROR: --force-test-db must name an isolated database ending in _test."
    exit 1
  fi
  echo "WARNING: --force-test-db is set; all Mongo-backed critical tests will share '$FORCE_TEST_DB'."
fi

run_test() {
  local label="$1"
  local test_file="$2"

  echo ""
  echo "[$label] Running: $test_file ..."

  if [ -n "$BASE_MONGO_URI" ] && grep -Eq "MONGO_URI|MONGODB_URI|mongoose|mongodb" "$test_file"; then
    local db_name
    if [ -n "$FORCE_TEST_DB" ]; then
      db_name="$FORCE_TEST_DB"
    else
      db_name=$(derive_test_db_name "$BASE_DB_NAME" "$test_file")
    fi

    if ! is_safe_test_db_name "$db_name"; then
      echo "ERROR: refusing unsafe test database name '$db_name'."
      exit 1
    fi

    local test_uri
    test_uri=$(mongo_uri_with_db "$BASE_MONGO_URI" "$db_name")
    echo "  DB: $db_name ($(mask_mongo_uri "$test_uri"))"
    drop_test_db_if_safe "$test_uri" "$db_name"

    MONGO_URI="$test_uri" MONGODB_URI="$test_uri" NODE_ENV=test node "$test_file" "${PASSTHROUGH_ARGS[@]}"
  else
    NODE_ENV=test node "$test_file" "${PASSTHROUGH_ARGS[@]}"
  fi
}

echo "=== Running Critical Tests for Frontend Handoff ==="

echo ""
echo "[1/7] Running unit tests (npm test)..."
npm test

run_test "2/7" tests/checkout.integration.test.js
run_test "3/7" tests/oneTimeOrderOps.test.js
run_test "4/7" tests/subscriptionBalancePolicy.test.js
run_test "5/7" tests/mobileApiContracts.test.js
run_test "6/7" tests/fulfillmentStatusEndpoint.test.js
run_test "7/7" tests/corsPreflight.test.js

echo ""
echo "All critical tests passed."
