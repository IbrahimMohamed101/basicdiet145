"use strict";
// G1 explicit Staging-only activation. Never run from application startup.
// CI subprocess mode is restricted to one local disposable database.
require("dotenv").config();
const { preparePosStagingRuntime, isPosStagingRuntime } = require("../src/utils/posStagingRuntime");
// Match src/index.js: normalize the Staging process environment BEFORE loading
// Mongoose models/services or attempting any database connection.
const boot = (() => {
  try { return { isolated: preparePosStagingRuntime(), failed: false }; }
  catch { return { isolated: false, failed: true }; }
})();
const mongoose = require("mongoose");
const DashboardUser = require("../src/models/DashboardUser");
const DailyCashClosing = require("../src/models/DailyCashClosing");
const { KEY, loadPolicy, scheduleStartDate } = require("../src/services/pos/posClosingSetting");

const DATE = "2026-11-08";
const STAGING_HOST = "mongodb-qxhu.railway.internal";
const STAGING_DB = "basicdiet_pos_staging_test";
const CI_DB = "basicdiet_pos_g1_ci_test";
const ERROR_CODES = new Set([
  "STAGING_RUNTIME_MISMATCH", "DB_NAME_MISMATCH", "DB_HOST_MISMATCH",
  "NOT_RS0", "ACTOR_NOT_FOUND", "ACTOR_NOT_ADMIN", "CLOSING_EXISTS", "ALREADY_SCHEDULED",
]);
const RUNTIME_VARIABLES = [
  "POS_STAGING_ISOLATED", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID",
  "POS_STAGING_MONGO_URL", "DASHBOARD_DEFAULT_ADMIN_EMAIL",
  "DASHBOARD_DEFAULT_ADMIN_PASSWORD", "DASHBOARD_DEFAULT_CASHIER_EMAIL",
  "DASHBOARD_DEFAULT_CASHIER_PASSWORD",
];
function coded(code, missing = []) {
  const error = new Error(code);
  error.code = code;
  error.missing = missing.filter(key => RUNTIME_VARIABLES.includes(key));
  return error;
}
function runtimeMismatch() {
  return coded("STAGING_RUNTIME_MISMATCH",
    RUNTIME_VARIABLES.filter(key => !process.env[key]));
}
function ciLocalOnly(argv) {
  return argv.has("--ci-local-rs0")
    && process.env.NODE_ENV === "test"
    && process.env.CI === "true";
}
function parsedMongoUri(uri) {
  try {
    const parsed = new URL(uri || "");
    if (parsed.protocol !== "mongodb:") return null;
    return parsed;
  } catch {
    return null;
  }
}
function assertMongoTarget(uri, localCI) {
  const parsed = parsedMongoUri(uri);
  // No connection is attempted until both name AND host pass.
  if (!parsed) throw coded("DB_HOST_MISMATCH");
  if (parsed.pathname !== "/" + (localCI ? CI_DB : STAGING_DB))
    throw coded("DB_NAME_MISMATCH");
  if (localCI) {
    if (parsed.hostname !== "127.0.0.1" ||
      !["27017", "27018"].includes(parsed.port))
      throw coded("DB_HOST_MISMATCH");
  } else if (parsed.hostname !== STAGING_HOST || (parsed.port && parsed.port !== "27017")) {
    throw coded("DB_HOST_MISMATCH");
  }
  return parsed;
}
function prepareRuntime(argv) {
  if (boot.failed) {
    // The canonical normalizer's errors are classified without printing its
    // message (which may be derived from secret-bearing connection settings).
    if (!ciLocalOnly(argv)) {
      const missing = RUNTIME_VARIABLES.filter(key => !process.env[key]);
      if (missing.length) throw coded("STAGING_RUNTIME_MISMATCH", missing);
      const raw = parsedMongoUri(process.env.POS_STAGING_MONGO_URL);
      if (raw && raw.hostname !== STAGING_HOST) throw coded("DB_HOST_MISMATCH");
      if (!raw) throw coded("DB_HOST_MISMATCH");
    }
    throw runtimeMismatch();
  }
  if (boot.isolated && isPosStagingRuntime()) return { localCI: false };
  // A second, exact-match path only for the GitHub runner's disposable MongoDB.
  // Neither Railway's Staging nor Production can enable this by accident:
  // it needs CLI opt-in, NODE_ENV=test, CI=true, and localhost+fixed CI db.
  if (!ciLocalOnly(argv)) throw runtimeMismatch();
  const local = parsedMongoUri(process.env.MONGO_URI_TEST);
  if (!local) throw coded("DB_HOST_MISMATCH");
  assertMongoTarget(process.env.MONGO_URI_TEST, true);
  // CI equivalent of normalized MONGO_URI; no raw POS_STAGING_MONGO_URL use.
  process.env.MONGO_URI = process.env.MONGO_URI_TEST;
  return { localCI: true };
}
async function assertDbIdentity(localCI) {
  if (mongoose.connection.name !== (localCI ? CI_DB : STAGING_DB))
    throw coded("DB_NAME_MISMATCH");
  if (mongoose.connection.host !== (localCI ? "127.0.0.1" : STAGING_HOST))
    throw coded("DB_HOST_MISMATCH");
  let hello;
  try {
    hello = await mongoose.connection.db.admin().command({ hello: 1 });
  } catch {
    throw coded("NOT_RS0");
  }
  if (hello.setName !== "rs0" || hello.isWritablePrimary !== true)
    throw coded("NOT_RS0");
}
async function loadActor() {
  const actorId = process.env.POS_G1_APPROVING_ADMIN_ID;
  if (!mongoose.isValidObjectId(actorId)) throw coded("ACTOR_NOT_FOUND");
  const actor = await DashboardUser.findById(actorId)
    .select("_id role isActive").lean();
  if (!actor) throw coded("ACTOR_NOT_FOUND");
  if (!["admin", "superadmin"].includes(actor.role) || actor.isActive === false)
    throw coded("ACTOR_NOT_ADMIN");
  return actor;
}
async function readPolicyState() {
  const policy = await loadPolicy();
  const matching = policy.baselineStartDate === DATE || policy.changes.some(item =>
    item.effectiveFrom === DATE && item.startDate === DATE);
  if (matching) throw coded("ALREADY_SCHEDULED");
  const closingExists = await DailyCashClosing.exists({
    businessDate: { $gte: DATE },
  });
  if (closingExists) throw coded("CLOSING_EXISTS");
  const last = policy.changes[policy.changes.length - 1];
  if (last && DATE <= last.effectiveFrom) throw coded("CLOSING_EXISTS");
}
async function main(argv = new Set(process.argv.slice(2))) {
  const unexpected = [...argv].filter(x => !["--dry-run", "--ci-local-rs0"].includes(x));
  if (unexpected.length) throw coded("STAGING_RUNTIME_MISMATCH");
  const { localCI } = prepareRuntime(argv);
  const mongoURI = process.env.MONGO_URI;
  assertMongoTarget(mongoURI, localCI);
  try {
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 7000, autoIndex: false, autoCreate: false });
  } catch {
    // No connection details leak into application logs.
    throw coded("NOT_RS0");
  }
  try {
    await assertDbIdentity(localCI);
    const actor = await loadActor();
    await readPolicyState();
    if (argv.has("--dry-run")) {
      process.stdout.write("DRY_RUN_OK\n");
      return;
    }
    try {
      await scheduleStartDate({
        startDate: DATE, effectiveFrom: DATE, actorId: actor._id,
        actorRole: actor.role,
      }, localCI ? { testOnly: true } : {});
    } catch (error) {
      // Idempotence even after a concurrent invocation wins the transaction.
      await readPolicyState(); // throws ALREADY_SCHEDULED if the same entry won.
      if (error.code && ERROR_CODES.has(error.code)) throw error;
      throw coded("CLOSING_EXISTS");
    }
    process.stdout.write("SCHEDULED\n");
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) {
  main().catch(error => {
    const code = ERROR_CODES.has(error?.code) ? error.code : "STAGING_RUNTIME_MISMATCH";
    const suffix = code === "STAGING_RUNTIME_MISMATCH" && error?.missing?.length
      ? " missing=" + error.missing.join(",") : "";
    // Expected no-op on an already-scheduled value must not fail preDeploy.
    (code === "ALREADY_SCHEDULED" ? process.stdout : process.stderr)
      .write(code + suffix + "\n");
    process.exitCode = code === "ALREADY_SCHEDULED" ? 0 : 1;
  });
}
module.exports = { main, assertMongoTarget, prepareRuntime };
