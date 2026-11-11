"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const { configuration } = require("../scripts/ci/g2-synthetic-seed");
const { report } = require("../scripts/ci/g2-preflight");
const { diagnostic } = require("../scripts/g2-rs0-init-and-verify");
const mongoProtocol = "mongodb";
const stagingUri = `${mongoProtocol}://g2-mongo-restore-drill.railway.internal:27017/basicdiet_g2_staging_synthetic?authSource=admin`;
const staging = {
  G2_EXECUTION_SCOPE: "staging-isolated", G2_OWNER_APPROVED: "true",
  G2_STAGING_REHEARSAL_APPROVED: "true", G2_MONGO_URI: stagingUri,
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function seedHarness(env, collections = []) {
  const calls = [];
  const mongoose = {
    set() {},
    async connect(_uri, options) {
      calls.push("connect");
      assert.equal(options.autoIndex, false);
      assert.equal(options.autoCreate, false);
    },
    async disconnect() { calls.push("disconnect"); },
    connection: { db: { listCollections() {
      calls.push("listCollections");
      return { toArray: async () => collections };
    } } },
  };
  const module = { exports: {} };
  const source = readFileSync(require.resolve("../scripts/ci/g2-synthetic-seed"), "utf8");
  vm.runInNewContext(source, {
    URL, Buffer, module, __dirname: path.resolve(__dirname, "../scripts/ci"),
    process: { env },
    require(name) {
      if (name === "mongoose") return mongoose;
      if (name === "node:fs") return { readdirSync() { calls.push("models"); throw Error("Unexpected model load"); } };
      if (name === "../g2-mongo-manifest") return {};
      if (name.includes("paymentIndexService")) { calls.push("indexes"); throw Error("Unexpected index write"); }
      return require(name);
    },
  });
  return { main: module.exports.main, calls };
}

test("staging seed accepts only the approved isolated host and database", () => {
  assert.equal(configuration(staging).dbName, "basicdiet_g2_staging_synthetic");
});

for (const [name, change] of [
  ["wrong host", { G2_MONGO_URI: stagingUri.replace("g2-mongo-restore-drill", "other-service") }],
  ["wrong database", { G2_MONGO_URI: stagingUri.replace("basicdiet_g2_staging_synthetic", "other_database") }],
  ["missing owner approval", { G2_OWNER_APPROVED: undefined }],
  ["missing staging approval", { G2_STAGING_REHEARSAL_APPROVED: undefined }],
  ["false owner approval", { G2_OWNER_APPROVED: "false" }],
  ["false staging approval", { G2_STAGING_REHEARSAL_APPROVED: "false" }],
]) {
  test("seed rejects " + name + " before connecting or loading write-capable models", async () => {
    const run = seedHarness({ ...staging, ...change });
    await assert.rejects(run.main());
    assert.deepEqual(run.calls, []);
  });
}

test("seed rejects an existing collection before any models, inserts or indexes", async () => {
  const run = seedHarness(staging, [{ name: "existing_synthetic_collection", type: "collection" }]);
  await assert.rejects(run.main());
  assert.deepEqual(run.calls, ["connect", "listCollections", "disconnect"]);
});

test("all three existing CI flags and the original CI host/database restrictions remain required", () => {
  const env = { CI: "true", GITHUB_ACTIONS: "true", G2_SYNTHETIC_DOCKER: "true",
    G2_EXECUTION_SCOPE: "owner-approved", G2_OWNER_APPROVED: "false",
    G2_MONGO_URI: `${mongoProtocol}://mongodb.railway.internal:27017/test?authSource=admin` };
  assert.equal(configuration(env).dbName, "test");
  for (const key of ["CI", "GITHUB_ACTIONS", "G2_SYNTHETIC_DOCKER"]) {
    assert.throws(() => configuration({ ...env, [key]: "false" }));
  }
  assert.throws(() => configuration({ ...env, G2_MONGO_URI: stagingUri }));
  assert.throws(() => configuration({ ...env, G2_MONGO_URI: env.G2_MONGO_URI.replace("/test?", "/other?") }));
});

test("packaged legacy bytes have the same SHA-256 as the immutable c458055 source", () => {
  const root = path.resolve(__dirname, "..");
  const original = execFileSync("git", ["show", "c4580553a56f986e7702471b32a82d74e12e1c65:scripts/g2-rs0-init-and-verify.js"], { cwd: root });
  const packaged = readFileSync(path.join(root, "scripts/.g2-legacy-init.js"));
  assert.equal(hash(packaged), hash(original));
  assert.equal(hash(packaged), "963ead351b9ddbd26564d3124ba8628df0f1739a92a663368015af3116d0b133");
});

async function legacyHarness(error, args = []) {
  const stdout = [], stderr = [], calls = [];
  class MongoClient { async connect() { calls.push("connect"); } }
  class Db { async command(command) { calls.push(Object.keys(command)[0]); return { ok: 1 }; } }
  const process = { argv: ["node", "adapter", ...args], execPath: "node", version: "v20.0.0",
    stdout: { write: text => stdout.push(text) }, stderr: { write: text => stderr.push(text) } };
  const manifest = { collect: async () => ({}) };
  const source = readFileSync(require.resolve("../scripts/ci/g2-legacy-diagnostics"), "utf8");
  await vm.runInNewContext(source, {
    process,
    require(name) {
      if (name === "mongodb") return { MongoClient, Db };
      if (name === "mongodb/package.json") return { version: "6.13.0" };
      if (name === "../g2-rs0-init-and-verify") return { diagnostic };
      if (name === "../g2-mongo-manifest") return manifest;
      if (name === "../.g2-legacy-init") return { async main() {
        assert.deepEqual(Array.from(process.argv.slice(2)), args);
        if (error) throw error;
        await new MongoClient().connect();
        await new Db().command({ hello: 1 });
        await new Db().command({ replSetInitiate: { _id: "rs0" } });
      } };
      throw Error("Unexpected dependency");
    },
  });
  return { process, stdout: stdout.join(""), stderr: stderr.join(""), calls };
}

test("legacy adapter preserves successful command calls and arguments and logs runtime/exit", async () => {
  const run = await legacyHarness(undefined, ["--baseline"]);
  assert.deepEqual(run.calls, ["connect", "hello", "replSetInitiate"]);
  assert.equal(run.process.exitCode, undefined);
  assert.equal(run.stderr, "G2_RUNTIME node=v20.0.0 driver=6.13.0\n");
  assert.match(run.stdout, /^G2_INITIATE_SENT\nG2_LEGACY_EXIT=0\nG2_LEGACY_DIAGNOSTIC_PASS\n$/);
});

test("legacy adapter retains all original failure exit classifications and unexpected exit 70", async () => {
  const codes = { G2_OWNER_APPROVAL_REQUIRED: 64, G2_MANIFEST_REQUIRED: 71,
    G2_MAINTENANCE_REQUIRED: 72, G2_UNSAFE_TARGET: 65, G2_INIT_FAILED: 66,
    G2_PRIMARY_TIMEOUT: 67, G2_MANIFEST_MISMATCH: 68, G2_TRANSACTION_FAILED: 69,
    G2_UNEXPECTED_FAILURE: 70, unknown: 70 };
  for (const [code, expected] of Object.entries(codes)) {
    const run = await legacyHarness(Object.assign(new Error("private message"), { code }));
    assert.equal(run.process.exitCode, expected);
    assert.equal(run.stdout, `G2_LEGACY_EXIT=${expected}\n`);
    assert.doesNotMatch(run.stderr, /private message/);
    assert.match(run.stderr, /G2_FAIL stage=config/);
  }
});

test("the actual packaged CLI and adapter agree on config failures before any database access", () => {
  const base = { ...process.env, ...staging, MAINTENANCE_MODE: "true" };
  for (const overrides of [{ G2_OWNER_APPROVED: "false" }, { MAINTENANCE_MODE: "false" }]) {
    const env = { ...base, ...overrides };
    const original = spawnSync(process.execPath, ["scripts/.g2-legacy-init.js"], { env, encoding: "utf8" });
    const adapter = spawnSync(process.execPath, ["scripts/ci/g2-legacy-diagnostics.js"], { env, encoding: "utf8" });
    assert.equal(adapter.status, original.status);
    assert.match(adapter.stdout, new RegExp(`G2_LEGACY_EXIT=${original.status}`));
    assert.match(adapter.stderr, /^G2_RUNTIME node=v\S+ driver=\S+\nG2_FAIL/);
  }
});

test("preflight reports exact assembled-variable lengths and hashes with no URI, credentials or addresses", () => {
  const uri = new URL(stagingUri);
  uri.username = "synthetic_user";
  uri.password = "synthetic_credential";
  const env = { ...staging, G2_MONGO_URI: uri.toString(), MONGO_URI: uri.toString() + "&replicaSet=rs0",
    G2_BASELINE_MANIFEST_B64: "synthetic-first-part" + "synthetic-second-part",
    G2_BASELINE_MANIFEST_GZ_B64: "synthetic-compressed-value" };
  const text = report(env);
  assert.match(text, /scheme=mongodb host=staging-drill db=basicdiet_g2_staging_synthetic required_options=authSource options=authSource,replicaSet/);
  for (const name of ["G2_BASELINE_MANIFEST_B64", "G2_BASELINE_MANIFEST_GZ_B64"]) {
    assert.ok(text.includes(`variable=${name} chars=${env[name].length} bytes=${Buffer.byteLength(env[name])} sha256=${hash(env[name])}`));
    assert.ok(!text.includes(env[name]));
  }
  assert.doesNotMatch(text, /synthetic_user|synthetic_credential|railway\.internal|:\/\//);
  const withoutLegacy = { ...env };
  delete withoutLegacy.G2_BASELINE_MANIFEST_B64;
  assert.ok(!report(withoutLegacy).includes("variable=G2_BASELINE_MANIFEST_B64"));
});

test("preflight rejects an unintended application target, invalid required options or missing gzip", () => {
  const env = { ...staging, G2_BASELINE_MANIFEST_GZ_B64: "synthetic-value" };
  assert.throws(() => report({ ...env, MONGO_URI: stagingUri.replace("g2-mongo-restore-drill", "other") }));
  assert.throws(() => report({ ...env, G2_MONGO_URI: stagingUri.replace("authSource=admin", "authSource=other") }));
  assert.throws(() => report({ ...env, MONGO_URI: stagingUri + "&replicaSet=other" }));
  assert.throws(() => report({ ...env, G2_BASELINE_MANIFEST_GZ_B64: undefined }));
  const failed = spawnSync(process.execPath, ["scripts/ci/g2-preflight.js"], {
    env: { ...process.env, ...env, G2_OWNER_APPROVED: "false" }, encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.equal(failed.stderr, "G2_PREFLIGHT_FAILED\n");
});
