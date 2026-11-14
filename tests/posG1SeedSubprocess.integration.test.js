"use strict";
process.env.NODE_ENV = "test";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const DashboardUser = require("../src/models/DashboardUser");
const DailyCashClosing = require("../src/models/DailyCashClosing");
const ActivityLog = require("../src/models/ActivityLog");
const Setting = require("../src/models/Setting");

const RS0 = "mongodb:" + "//127.0.0.1:27017/basicdiet_pos_g1_ci_test?replicaSet=rs0";
const STANDALONE = "mongodb:" + "//127.0.0.1:27018/basicdiet_pos_g1_ci_test?directConnection=true";
const script = path.resolve(__dirname, "../scripts/pos-g1-seed-closing-date-staging.js");
function run(flags = [], overrides = {}) {
  const env = {
    ...process.env,
    CI: "true", NODE_ENV: "test", MONGO_URI_TEST: RS0,
    // The subprocess must obtain the actor role exclusively from MongoDB.
    ...overrides,
  };
  // Never forward a real Railway setting or remote URI in the isolated runner.
  for (const key of ["POS_STAGING_ISOLATED", "POS_STAGING_MONGO_URL",
    "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "MONGO_URI",
    "MONGODB_URI", "MONGO_URL"]) delete env[key];
  const result = spawnSync(process.execPath, [script, ...flags], {
    env, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.error, undefined, "subprocess must exit cleanly");
  // No credentials, URI strings or IDs may be written in either output.
  for (const out of [result.stdout, result.stderr]) {
    assert.equal(out.includes("mongodb:" + "//"), false);
    assert.equal(out.includes("mongodb-qxhu"), false);
    assert.equal(out.includes(String(overrides.POS_G1_APPROVING_ADMIN_ID || "UNSET_EXPECTED_ACTOR_ID")), false);
  }
  return result;
}
function code(result, expected, expectedExit = 1) {
  assert.equal(result.status, expectedExit, [expected, result.stdout, result.stderr].join(" "));
  assert.match(result.stdout + result.stderr, new RegExp("(?:^|\\n)" + expected + "(?: missing=[A-Z_,]+)?(?:\\n|$)"));
}
test("G1 seed subprocess: dry-run is read-only, once-only transaction, safe re-run and every error code", async () => {
  if (process.env.MONGO_URI_TEST !== RS0 || process.env.NODE_ENV !== "test") {
    throw new Error("Seed subprocess test requires explicit disposable local rs0 URI");
  }
  await mongoose.connect(RS0, { serverSelectionTimeoutMS: 8000 });
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, "rs0");
    await mongoose.connection.dropDatabase(); // strictly local CI fixture
    const admin = await DashboardUser.create({ email: "owner@g1-ci.invalid",
      passwordHash: "synthetic-ci-only-hash", role: "superadmin", isActive: true });
    const cashier = await DashboardUser.create({ email: "staff@g1-ci.invalid",
      passwordHash: "synthetic-ci-only-hash", role: "cashier", isActive: true });
    const actorEnv = { POS_G1_APPROVING_ADMIN_ID: String(admin._id) };

    const absentEnv = run(["--dry-run"]);
    code(absentEnv, "STAGING_RUNTIME_MISMATCH");
    assert.match(absentEnv.stderr, /RAILWAY_ENVIRONMENT_ID/);
    assert.equal(absentEnv.stderr.includes("http"), false);

    code(run(["--ci-local-rs0", "--dry-run"], {
      ...actorEnv, MONGO_URI_TEST: "mongodb:" + "//127.0.0.1:27017/basicdiet_other_ci_test?replicaSet=rs0",
    }), "DB_NAME_MISMATCH");
    code(run(["--ci-local-rs0", "--dry-run"], {
      ...actorEnv, MONGO_URI_TEST: "mongodb:" + "//disallowed.invalid:27017/basicdiet_pos_g1_ci_test?replicaSet=rs0",
    }), "DB_HOST_MISMATCH");
    code(run(["--ci-local-rs0", "--dry-run"], {
      ...actorEnv, MONGO_URI_TEST: STANDALONE,
    }), "NOT_RS0");
    code(run(["--ci-local-rs0", "--dry-run"], {
      POS_G1_APPROVING_ADMIN_ID: String(new mongoose.Types.ObjectId()),
    }), "ACTOR_NOT_FOUND");
    code(run(["--ci-local-rs0", "--dry-run"], {
      POS_G1_APPROVING_ADMIN_ID: String(cashier._id),
    }), "ACTOR_NOT_ADMIN");

    await DailyCashClosing.create({ businessDate: "2026-11-08", createdBy: admin._id });
    code(run(["--ci-local-rs0", "--dry-run"], actorEnv), "CLOSING_EXISTS");
    await DailyCashClosing.deleteOne({ businessDate: "2026-11-08" });

    const settingsBefore = await Setting.countDocuments({ key: "posClosingStartDate" });
    const logsBefore = await ActivityLog.countDocuments({ action: "pos_closing_start_date_scheduled" });
    const collectionsBefore = (await mongoose.connection.db.listCollections().toArray())
      .map(entry => entry.name).sort();
    const dry = run(["--ci-local-rs0", "--dry-run"], actorEnv);
    code(dry, "DRY_RUN_OK", 0);
    assert.equal(await Setting.countDocuments({ key: "posClosingStartDate" }), settingsBefore);
    assert.equal(await ActivityLog.countDocuments({ action: "pos_closing_start_date_scheduled" }), logsBefore);
    assert.deepEqual((await mongoose.connection.db.listCollections().toArray())
      .map(entry => entry.name).sort(), collectionsBefore,
      "dry-run must not create collections or indexes");

    const execute = run(["--ci-local-rs0"], {
      ...actorEnv, POS_G1_APPROVING_ADMIN_ROLE: "cashier",
    });
    code(execute, "SCHEDULED", 0);
    const setting = await Setting.findOne({ key: "posClosingStartDate" }).lean();
    assert.ok(setting);
    assert.equal(setting.value.changes.length, 1);
    assert.equal(setting.value.changes[0].startDate, "2026-11-08");
    assert.equal(setting.value.changes[0].effectiveFrom, "2026-11-08");
    assert.equal(setting.value.changes[0].changedByRole, "superadmin");
    const logs = await ActivityLog.find({ action: "pos_closing_start_date_scheduled" }).lean();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].byRole, "superadmin");
    assert.equal(String(logs[0].byUserId), String(admin._id));
    const settingRaw = JSON.stringify(setting.value);
    const firstLogId = String(logs[0]._id);

    code(run(["--ci-local-rs0"], actorEnv), "ALREADY_SCHEDULED", 0);
    code(run(["--ci-local-rs0", "--dry-run"], actorEnv), "ALREADY_SCHEDULED", 0);
    const after = await Setting.findOne({ key: "posClosingStartDate" }).lean();
    assert.equal(JSON.stringify(after.value), settingRaw);
    assert.equal(await Setting.countDocuments({ key: "posClosingStartDate" }), 1);
    const afterLogs = await ActivityLog.find({ action: "pos_closing_start_date_scheduled" }).lean();
    assert.equal(afterLogs.length, 1);
    assert.equal(String(afterLogs[0]._id), firstLogId);
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  }
});
