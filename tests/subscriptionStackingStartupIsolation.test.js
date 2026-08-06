"use strict";

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.join(__dirname, "..");
const indexPath = path.join(repositoryRoot, "src", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

function positionOf(fragment) {
  const index = source.indexOf(fragment);
  assert.notStrictEqual(index, -1, `Missing startup fragment: ${fragment}`);
  return index;
}

function testSafetyRunsBeforeInstallers() {
  const safetyCall = positionOf("assertSubscriptionStackingProductionSafety(process.env)");
  const rolloutCall = positionOf("assertSubscriptionStackingRolloutConfiguration(process.env)");
  const canonicalComposition = positionOf('require("./services/installSubscriptionBackendRepairComposition")');
  const firstStackingInstaller = positionOf('require("./services/installSubscriptionStackingUnsupportedActionGuards")');

  assert(safetyCall < rolloutCall, "production safety must run before rollout validation");
  assert(rolloutCall < canonicalComposition, "rollout validation must run before canonical subscription composition");
  assert(
    canonicalComposition < firstStackingInstaller,
    "canonical add-on pricing/client composition must load before stacking can capture cancellation dependencies"
  );
}

function testIncompleteRoutersRemainDisconnected() {
  assert.strictEqual(
    source.includes("installSubscriptionStackingPlannedPickupRouter"),
    false,
    "planned pickup must remain disconnected until ownership binding is approved"
  );
  assert.strictEqual(
    source.includes("installSubscriptionStackingSkipRouter"),
    false,
    "atomic skip router must remain disconnected until remote staging validation"
  );
}

function testNoStartupFlagMutation() {
  const forbiddenAssignments = [
    /process\.env\.SUBSCRIPTION_STACKING_SHADOW_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_READ_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_WRITE_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_USER_IDS\s*=/,
  ];
  for (const pattern of forbiddenAssignments) {
    assert.strictEqual(pattern.test(source), false, `startup must not mutate rollout flags: ${pattern}`);
  }
}

function testFreshProcessReachesDatabaseBoundaryWithoutCompositionFailure() {
  const dbPath = require.resolve(path.join(repositoryRoot, "src", "db.js"));
  const validateEnvPath = require.resolve(path.join(repositoryRoot, "src", "utils", "validateEnv.js"));
  const marker = "STARTUP_COMPOSITION_PROBE_COMPLETE";

  const childScript = `
    "use strict";
    const dbPath = ${JSON.stringify(dbPath)};
    const validateEnvPath = ${JSON.stringify(validateEnvPath)};
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        connectDb() {
          process.stderr.write(${JSON.stringify(`${marker}\n`)});
          return Promise.reject(new Error(${JSON.stringify(marker)}));
        },
      },
      children: [],
      paths: [],
    };
    require.cache[validateEnvPath] = {
      id: validateEnvPath,
      filename: validateEnvPath,
      loaded: true,
      exports: {
        validateEnv() {
          return { ok: true, missing: [], invalid: [], securityViolations: [] };
        },
      },
      children: [],
      paths: [],
    };
    require(${JSON.stringify(indexPath)});
  `;

  const env = {
    ...process.env,
    NODE_ENV: "test",
    APP_ENV: "test",
    ENVIRONMENT: "test",
    DEPLOY_ENV: "test",
    RAILWAY_ENVIRONMENT_NAME: "test",
    PORT: "39999",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
    SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "",
    SUBSCRIPTION_STACKING_USER_IDS: "",
  };

  const result = spawnSync(process.execPath, ["-e", childScript], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 30000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;

  assert.ifError(result.error);
  assert.strictEqual(result.signal, null, `fresh startup probe was terminated: ${output}`);
  assert.strictEqual(result.status, 1, `probe must stop only at the injected DB boundary: ${output}`);
  assert(
    output.includes(marker),
    `src/index.js did not reach the database boundary in a clean process: ${output}`
  );
  assert.strictEqual(
    output.includes("SUBSCRIPTION_REPAIR_COMPOSITION_INCOMPLETE"),
    false,
    `startup composition assertion failed before the database boundary: ${output}`
  );
  assert.strictEqual(
    output.includes("Add-on choices captured a legacy carryover pricing reference"),
    false,
    `add-on choices captured stale pricing during fresh startup: ${output}`
  );
}

function run() {
  testSafetyRunsBeforeInstallers();
  testIncompleteRoutersRemainDisconnected();
  testNoStartupFlagMutation();
  testFreshProcessReachesDatabaseBoundaryWithoutCompositionFailure();
  console.log("subscription stacking startup isolation tests passed");
}

run();
