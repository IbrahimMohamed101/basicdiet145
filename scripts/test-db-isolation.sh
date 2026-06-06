#!/bin/bash
# Shared helpers for assigning one MongoDB database per test file.

mask_mongo_uri() {
  echo "$1" | sed 's|\(://[^:/@]*:\)[^@]*\(@\)|\1***\2|'
}

mongo_uri_db_name() {
  MONGO_URI_TO_PARSE="$1" node <<'NODE'
const uri = process.env.MONGO_URI_TO_PARSE || "";

try {
  const parsed = new URL(uri);
  if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol ${parsed.protocol}`);
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!dbName) {
    throw new Error("Mongo URI must include a database name");
  }

  console.log(dbName);
} catch (error) {
  console.error(`Invalid MONGO_URI: ${error.message}`);
  process.exit(1);
}
NODE
}

mongo_uri_with_db() {
  MONGO_URI_TO_PARSE="$1" MONGO_DATABASE_NAME="$2" node <<'NODE'
const uri = process.env.MONGO_URI_TO_PARSE || "";
const dbName = process.env.MONGO_DATABASE_NAME || "";

try {
  const parsed = new URL(uri);
  if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol ${parsed.protocol}`);
  }
  if (!dbName) {
    throw new Error("replacement database name is empty");
  }

  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  console.log(parsed.toString());
} catch (error) {
  console.error(`Invalid MONGO_URI: ${error.message}`);
  process.exit(1);
}
NODE
}

safe_test_slug() {
  local file_path="$1"
  local rel_path="${file_path#tests/}"
  local stem="${rel_path%.test.js}"

  if [ "$stem" = "$rel_path" ]; then
    stem="${rel_path%.js}"
  fi

  echo "$stem" \
    | sed -E 's/[^A-Za-z0-9]+/_/g; s/^_+//; s/_+$//' \
    | tr -s '_'
}

short_test_hash() {
  TEST_FILE_PATH="$1" node <<'NODE'
const crypto = require("crypto");
const filePath = String(process.env.TEST_FILE_PATH || "")
  .replace(/\\/g, "/")
  .replace(/^\.\//, "");

console.log(crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 8));
NODE
}

derive_test_db_name() {
  local _base_db_name="$1"
  local file_path="$2"
  local hash

  hash=$(short_test_hash "$file_path")
  if [ -z "$hash" ]; then
    hash="unknown"
  fi

  echo "bd145_${hash}_test"
}

is_safe_test_db_name() {
  local db_name="$1"
  local byte_length

  byte_length=$(LC_ALL=C printf "%s" "$db_name" | wc -c | tr -d ' ')
  [[ "$db_name" =~ ^[A-Za-z0-9_]+$ ]] || return 1
  [[ "$db_name" == *_test ]] || return 1
  [[ "$db_name" == *test* ]] || return 1
  [[ "$byte_length" -le 38 ]] || return 1
  [[ "$db_name" != "admin" ]] || return 1
  [[ "$db_name" != "local" ]] || return 1
  [[ "$db_name" != "config" ]] || return 1
  [[ ! "$db_name" =~ (^|_)(prod|production|live)(_|$) ]] || return 1

  return 0
}

drop_test_db_if_safe() {
  local uri="$1"
  local db_name="$2"

  if ! is_safe_test_db_name "$db_name"; then
    echo "  [SAFETY] Refusing to drop '$db_name'; it is not an isolated test database name." >&2
    return 0
  fi

  DROP_MONGO_URI="$uri" node <<'NODE'
const { MongoClient } = require("mongodb");

async function main() {
  const uri = process.env.DROP_MONGO_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  await client.db().dropDatabase();
  await client.close();
}

main().catch((error) => {
  console.error(`  [WARN] Could not drop test database before run: ${error.message}`);
  process.exitCode = 0;
});
NODE
}

drop_derived_test_dbs_if_safe() {
  local uri="$1"

  DROP_MONGO_URI="$uri" node <<'NODE'
const { MongoClient } = require("mongodb");

const DERIVED_TEST_DB_RE = /^bd145_[0-9a-f]{8}_test$/;

async function main() {
  const uri = process.env.DROP_MONGO_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases({ nameOnly: true });
  const testDbNames = databases
    .map((database) => database.name)
    .filter((name) => DERIVED_TEST_DB_RE.test(name));

  for (const dbName of testDbNames) {
    await client.db(dbName).dropDatabase();
    console.log(`  Dropped stale test database: ${dbName}`);
  }

  await client.close();
}

main().catch((error) => {
  console.error(`  [WARN] Could not drop stale test databases: ${error.message}`);
  process.exitCode = 0;
});
NODE
}
