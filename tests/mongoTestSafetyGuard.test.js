"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  assertConfiguredTestConnection,
  executeWithGuaranteedCleanup,
} = require("./helpers/installMongoTestSafetyGuard");

async function main() {
  const safeUri = "mongodb://127.0.0.1:27018/basicdiet_guard_test";

  assert.throws(
    () => assertConfiguredTestConnection(safeUri, {}, { NODE_ENV: "production", MONGO_URI_TEST: safeUri }),
    /NODE_ENV must be "test"/
  );

  assert.throws(
    () => assertConfiguredTestConnection(
      "mongodb://hayabusa.proxy.rlwy.net:59730/basicdiet_guard_test",
      {},
      { NODE_ENV: "test", MONGO_URI_TEST: "mongodb://hayabusa.proxy.rlwy.net:59730/basicdiet_guard_test" }
    ),
    /known production host/
  );

  assert.throws(
    () => assertConfiguredTestConnection(
      "mongodb://mongodb.railway.internal:27017/basicdiet_guard_test",
      {},
      { NODE_ENV: "test", MONGO_URI_TEST: "mongodb://mongodb.railway.internal:27017/basicdiet_guard_test" }
    ),
    /known production host/
  );

  assert.throws(
    () => assertConfiguredTestConnection("mongodb://127.0.0.1:27017/basicdiet_guard_test", {}, { NODE_ENV: "test" }),
    /MONGO_URI_TEST is required/
  );

  assert.throws(
    () => assertConfiguredTestConnection(
      "mongodb://safe-ci.invalid/test",
      {},
      { NODE_ENV: "test", MONGO_URI_TEST: "mongodb://safe-ci.invalid/test" }
    ),
    /reserved and is not allowed/
  );

  assert.doesNotThrow(() => assertConfiguredTestConnection(
    safeUri,
    {},
    { NODE_ENV: "test", MONGO_URI_TEST: safeUri }
  ));

  let cleanupCount = 0;
  const success = await executeWithGuaranteedCleanup(
    async () => "ok",
    async () => { cleanupCount += 1; }
  );
  assert.strictEqual(success, "ok");
  assert.strictEqual(cleanupCount, 1, "cleanup executes after success");

  await assert.rejects(
    executeWithGuaranteedCleanup(
      async () => { throw new Error("expected test failure"); },
      async () => { cleanupCount += 1; }
    ),
    /expected test failure/
  );
  assert.strictEqual(cleanupCount, 2, "cleanup executes after failure");

  const vulnerableTestSource = fs.readFileSync(
    path.join(__dirname, "branchPickupMealWalletSlotAppendPayment.test.js"),
    "utf8"
  );
  assert(!vulnerableTestSource.includes("process.exit(0)"));
  assert(!vulnerableTestSource.includes("process.env.MONGO_URI || process.env.MONGODB_URI"));
  assert(vulnerableTestSource.includes("resolveMongoUri()"));
  assert(vulnerableTestSource.includes("finally"));
  assert(vulnerableTestSource.includes("await cleanup()"));

  for (const runner of ["run-all-tests.sh", "run-critical-tests.sh"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "scripts", runner), "utf8");
    assert(source.includes("installMongoTestSafetyGuard.js"), `${runner} preloads the test Mongo guard`);
    assert(source.includes("MONGO_URI_TEST"), `${runner} requires the explicit test URI variable`);
  }

  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
  const directFallbackPattern = /process\.env\.MONGO_URI\s*\|\|\s*(?:process\.env\.MONGODB_URI|["']mongodb)/;
  const unguardedFallbackFiles = walk(__dirname)
    .filter((file) => file.endsWith(".js") && file !== __filename)
    .filter((file) => directFallbackPattern.test(fs.readFileSync(file, "utf8")))
    .filter((file) => !fs.readFileSync(file, "utf8").includes("installMongoTestSafetyGuard"));
  assert.deepStrictEqual(unguardedFallbackFiles, [], "every legacy runtime-URI fallback has a direct safety guard");

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const unguardedPackageScripts = Object.entries(packageJson.scripts || {})
    .filter(([name, command]) => name.startsWith("test") && /node\s+tests\//.test(command));
  assert.deepStrictEqual(unguardedPackageScripts, [], "every npm test node command preloads the safety guard");

  console.log("Mongo test safety guard regression tests passed");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
