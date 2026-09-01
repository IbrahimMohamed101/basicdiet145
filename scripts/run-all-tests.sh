#!/bin/bash
# Runs every classified tests/**/*.test.js file with one isolated MongoDB database per file.

TEST_DIR="tests"
REPORT_DIR="test-reports"
FAILED_DETAIL_DIR="$REPORT_DIR/failed-details"
TIMEOUT_SECONDS=180

SUMMARY_FILE="$REPORT_DIR/summary.txt"
FULL_LOG="$REPORT_DIR/full-test-run.log"
FAILED_LOG="$REPORT_DIR/failed-tests.log"
TIMEOUT_LOG="$REPORT_DIR/timeout-tests.log"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${USE_MONGODB_MEMORY_REPLSET:-}" = "true" ] && [ -z "${MONGO_URI_TEST:-}" ] && [ -z "${USE_MONGODB_MEMORY_REPLSET_STARTED:-}" ]; then
  exec node "$SCRIPT_DIR/with-memory-replset.js" -- bash "$0" "$@"
fi

source "$SCRIPT_DIR/test-db-isolation.sh"

mkdir -p "$REPORT_DIR" "$FAILED_DETAIL_DIR"
rm -f "$FULL_LOG" "$FAILED_LOG" "$TIMEOUT_LOG" "$SUMMARY_FILE"
rm -f "$FAILED_DETAIL_DIR"/*.log

echo "Starting full test run at $(date)" | tee -a "$FULL_LOG"

FORCE_TEST_DB=""
PASSTHROUGH_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-test-db)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --force-test-db requires a database name." | tee -a "$FULL_LOG"
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

HAS_MONGO=false
BASE_MONGO_URI=""
BASE_DB_NAME=""
TEST_MONGO_GUARD="--require=$SCRIPT_DIR/../tests/helpers/installMongoTestSafetyGuard.js"

if [ -n "${MONGO_URI_TEST:-}" ]; then
  HAS_MONGO=true
  BASE_MONGO_URI="$MONGO_URI_TEST"
  BASE_DB_NAME=$(assert_safe_base_test_mongo_uri "$BASE_MONGO_URI") || exit 1
  echo "Using base MONGO_URI: $(mask_mongo_uri "$BASE_MONGO_URI")" | tee -a "$FULL_LOG"
  echo "Base database: $BASE_DB_NAME" | tee -a "$FULL_LOG"
else
  echo "WARNING: MONGO_URI_TEST is not set. Mongo-backed tests will be skipped." | tee -a "$FULL_LOG"
fi

if [ -n "$FORCE_TEST_DB" ]; then
  if ! is_safe_test_db_name "$FORCE_TEST_DB"; then
    echo "ERROR: --force-test-db must name an isolated database ending in _test." | tee -a "$FULL_LOG"
    exit 1
  fi
  echo "WARNING: --force-test-db is set; all Mongo-backed tests will share '$FORCE_TEST_DB'." | tee -a "$FULL_LOG"
fi

if [ "$HAS_MONGO" = true ] && [ -z "$FORCE_TEST_DB" ]; then
  echo "Cleaning stale derived test databases..." | tee -a "$FULL_LOG"
  drop_derived_test_dbs_if_safe "$BASE_MONGO_URI" 2>&1 | tee -a "$FULL_LOG"
fi

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TIMEOUT_TESTS=0
SKIPPED_TESTS=0

mapfile -t TEST_MANIFEST < <(node "$SCRIPT_DIR/test-runner-dispatcher.js" --manifest-tsv)

for test_entry in "${TEST_MANIFEST[@]}"; do
  IFS=$'\t' read -r test_file TEST_FRAMEWORK TEST_RUNNER REQUIRES_MONGO_TEXT REQUIRES_REPLSET_TEXT SAFE_TO_PARALLELIZE_TEXT TEST_COMMAND <<< "$test_entry"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  REQUIRES_MONGO=false
  [ "$REQUIRES_MONGO_TEXT" = "yes" ] && REQUIRES_MONGO=true

  echo "----------------------------------------" | tee -a "$FULL_LOG"
  echo "Running: $test_file" | tee -a "$FULL_LOG"
  echo "  Framework: $TEST_FRAMEWORK ($TEST_RUNNER)" | tee -a "$FULL_LOG"
  echo "  Command: $TEST_COMMAND" | tee -a "$FULL_LOG"

  if [ "$REQUIRES_MONGO" = true ] && [ "$HAS_MONGO" = false ]; then
    echo "SKIPPED: $test_file (Requires MONGO_URI)" | tee -a "$FULL_LOG"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
    continue
  fi

  TEST_MONGO_URI="${MONGO_URI_TEST:-}"
  TEST_DB_NAME=""

  if [ "$REQUIRES_MONGO" = true ]; then
    if [ -n "$FORCE_TEST_DB" ]; then
      TEST_DB_NAME="$FORCE_TEST_DB"
    else
      TEST_DB_NAME=$(derive_test_db_name "$BASE_DB_NAME" "$test_file")
    fi

    if ! is_safe_test_db_name "$TEST_DB_NAME"; then
      echo "FAILED: $test_file (unsafe generated database name: $TEST_DB_NAME)" | tee -a "$FULL_LOG"
      echo "$test_file" >> "$FAILED_LOG"
      FAILED_TESTS=$((FAILED_TESTS + 1))
      continue
    fi

    TEST_MONGO_URI=$(mongo_uri_with_db "$BASE_MONGO_URI" "$TEST_DB_NAME") || exit 1
    echo "  DB: $TEST_DB_NAME ($(mask_mongo_uri "$TEST_MONGO_URI"))" | tee -a "$FULL_LOG"
    drop_test_db_if_safe "$TEST_MONGO_URI" "$TEST_DB_NAME" 2>&1 | tee -a "$FULL_LOG"
  fi

  SAFE_TEST_NAME=$(safe_test_slug "$test_file")
  DETAIL_LOG="$FAILED_DETAIL_DIR/${SAFE_TEST_NAME}.log"
  TMP_OUT=$(mktemp /tmp/basicdiet145_test_out_XXXXXX)

  RUN_COMMAND="$TEST_COMMAND"
  for arg in "${PASSTHROUGH_ARGS[@]}"; do
    printf -v QUOTED_ARG "%q" "$arg"
    RUN_COMMAND="$RUN_COMMAND $QUOTED_ARG"
  done

  MONGO_URI_TEST="$TEST_MONGO_URI" MONGO_URI="$TEST_MONGO_URI" MONGODB_URI="$TEST_MONGO_URI" NODE_ENV=test \
    NODE_OPTIONS="${NODE_OPTIONS:-} $TEST_MONGO_GUARD" \
    timeout "$TIMEOUT_SECONDS" \
    bash -c "$RUN_COMMAND" \
    >"$TMP_OUT" 2>&1
  EXIT_CODE=$?

  cat "$TMP_OUT" >> "$FULL_LOG"

  if [ $EXIT_CODE -eq 0 ]; then
    echo "SUCCESS: $test_file" | tee -a "$FULL_LOG"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  elif [ $EXIT_CODE -eq 124 ]; then
    echo "TIMEOUT: $test_file" | tee -a "$FULL_LOG"
    echo "$test_file" >> "$TIMEOUT_LOG"
    {
      echo "=== TIMEOUT: $test_file ==="
      echo "Timed out after ${TIMEOUT_SECONDS}s"
      echo "DB: ${TEST_DB_NAME:-n/a}"
      echo ""
      cat "$TMP_OUT"
    } > "$DETAIL_LOG"
    TIMEOUT_TESTS=$((TIMEOUT_TESTS + 1))
  else
    echo "FAILED: $test_file (Exit code: $EXIT_CODE)" | tee -a "$FULL_LOG"
    echo "$test_file" >> "$FAILED_LOG"
    {
      echo "=== FAILED: $test_file ==="
      echo "Exit code: $EXIT_CODE"
      echo "DB: ${TEST_DB_NAME:-n/a}"
      echo ""
      cat "$TMP_OUT"
    } > "$DETAIL_LOG"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi

  if [ "$REQUIRES_MONGO" = true ] && [ -z "$FORCE_TEST_DB" ]; then
    drop_test_db_if_safe "$TEST_MONGO_URI" "$TEST_DB_NAME" 2>&1 | tee -a "$FULL_LOG"
  fi

  rm -f "$TMP_OUT"
done

{
  echo ""
  echo "=== Test Summary ==="
  echo "Generated at:           $(date)"
  echo "Total Tests Discovered: $TOTAL_TESTS"
  echo "Passed:                 $PASSED_TESTS"
  echo "Failed:                 $FAILED_TESTS"
  echo "Timed Out:              $TIMEOUT_TESTS"
  echo "Skipped:                $SKIPPED_TESTS"
  echo "===================="
  if [ $FAILED_TESTS -gt 0 ] || [ $TIMEOUT_TESTS -gt 0 ]; then
    echo ""
    echo "Failed/timeout detail logs:"
    for f in "$FAILED_DETAIL_DIR"/*.log; do
      [ -f "$f" ] && echo "  $f"
    done
  fi
} | tee -a "$SUMMARY_FILE" | tee -a "$FULL_LOG"

if [ $FAILED_TESTS -gt 0 ] || [ $TIMEOUT_TESTS -gt 0 ]; then
  exit 1
fi

exit 0
