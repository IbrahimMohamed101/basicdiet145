"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const vm = require("node:vm");
const { baselineOutput, diagnostic } = require("../scripts/g2-rs0-init-and-verify");
const mongoProtocol = "mongodb";

const snapshot = { format: "G2_COUNTS_INDEXES_V1", db: "test", collections: {
  synthetic: { count: 1, indexes: [{ name: "_id_", key: { _id: 1 }, unique: false, sparse: false }] },
} };

function signedBaseline(value = snapshot) {
  const json = JSON.stringify(value);
  return {
    G2_BASELINE_MANIFEST_GZ_B64: gzipSync(json).toString("base64"),
    G2_BASELINE_SHA256: createHash("sha256").update(json).digest("hex"),
  };
}

function isolatedMain({ env = {}, connectError, closeError, hello = {}, initiateError, baseline = false } = {}) {
  const calls = [];
  const stdout = [];
  const database = {
    async command(command) {
      calls.push(Object.keys(command)[0]);
      if (command.hello) return hello;
      if (initiateError) throw initiateError;
      return { ok: 1 };
    },
  };
  class MongoClient {
    async connect() { calls.push("connect"); if (connectError) throw connectError; }
    db() { return database; }
    async close() { calls.push("close"); if (closeError) throw closeError; }
  }
  const context = {
    Buffer, URL, setTimeout, module: { exports: {} },
    process: {
      argv: ["node", "g2.js", ...(baseline ? ["--baseline"] : [])],
      env: { MAINTENANCE_MODE: "true", G2_OWNER_APPROVED: "true",
        G2_EXECUTION_SCOPE: "owner-approved", NODE_ENV: "production",
        G2_MONGO_URI: `${mongoProtocol}://mongodb.railway.internal:27017/test?authSource=admin`, ...env },
      stdout: { write: value => stdout.push(value) },
    },
    require(name) {
      if (name === "mongodb") return { MongoClient };
      if (name === "./g2-mongo-manifest") return { collect: async () => {
        calls.push("collect"); return snapshot.collections;
      } };
      return require(name);
    },
  };
  vm.runInNewContext(readFileSync(require.resolve("../scripts/g2-rs0-init-and-verify"), "utf8"), context);
  return { main: context.module.exports.main, calls, stdout };
}

test("baseline emits exactly three lines, hashes the original JSON and measures the encoded gzip", () => {
  const lines = baselineOutput(snapshot).trim().split("\n");
  assert.equal(lines.length, 3);
  const values = Object.fromEntries(lines.map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(gunzipSync(Buffer.from(values.G2_BASELINE_GZ, "base64")).toString(), JSON.stringify(snapshot));
  assert.equal(values.G2_BASELINE_SHA256, createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"));
  assert.equal(Number(values.G2_BASELINE_BYTES), values.G2_BASELINE_GZ.length);
});

test("oversized encoded gzip fails with its new code", () => {
  assert.throws(() => baselineOutput({ synthetic: randomBytes(40000).toString("hex") }), { code: "G2_BASELINE_TOO_LARGE" });
});

for (const [name, change] of [
  ["missing gzip", {}],
  ["corrupt gzip", { ...signedBaseline(), G2_BASELINE_MANIFEST_GZ_B64: "YWJj" }],
  ["missing digest", { G2_BASELINE_MANIFEST_GZ_B64: signedBaseline().G2_BASELINE_MANIFEST_GZ_B64 }],
  ["wrong digest", { ...signedBaseline(), G2_BASELINE_SHA256: "0".repeat(64) }],
  ["wrong database", signedBaseline({ ...snapshot, db: "other" })],
  ["invalid collections", signedBaseline({ ...snapshot, collections: "invalid" })],
  ["legacy in owner scope", { G2_BASELINE_MANIFEST_B64: Buffer.from(JSON.stringify(snapshot)).toString("base64") }],
]) {
  test(name + " prevents initiation, including on an already initialized primary", async () => {
    const run = isolatedMain({ env: change, hello: { setName: "rs0", isWritablePrimary: true } });
    await assert.rejects(run.main(), { code: "G2_MANIFEST_REQUIRED", g2Stage: "manifest" });
    assert.deepEqual(run.calls, ["connect", "hello", "close"]);
    assert.equal(run.stdout.length, 0);
  });
}

test("initiate marker precedes the command and preserves the server's failure metadata", async () => {
  const serverError = Object.assign(new Error("must never be logged"), {
    name: "MongoServerError", code: 13, codeName: "Unauthorized", errorLabels: ["RetryableWriteError"],
  });
  const run = isolatedMain({ env: signedBaseline(), initiateError: serverError });
  let original;
  await assert.rejects(run.main(), error => { original = error; return error.code === "G2_INIT_FAILED"; });
  assert.deepEqual(run.calls, ["connect", "hello", "replSetInitiate", "close"]);
  assert.deepEqual(run.stdout, ["G2_INITIATE_SENT\n"]);
  assert.equal(diagnostic(original), "G2_FAIL stage=initiate code=G2_INIT_FAILED name=MongoServerError codeName=Unauthorized mongoCode=13 labels=RetryableWriteError\n");
});

test("close rejection cannot hide the original connect failure or its stage", async () => {
  const original = new TypeError("private value");
  const run = isolatedMain({ connectError: original, closeError: new Error("cleanup") });
  await assert.rejects(run.main(), error => error === original && error.g2Stage === "connect");
  assert.deepEqual(run.calls, ["connect", "close"]);
});

test("baseline capture remains read-only", async () => {
  const run = isolatedMain({ baseline: true });
  await run.main();
  assert.deepEqual(run.calls, ["connect", "hello", "collect", "close"]);
  assert.equal(run.stdout.join("").trim().split("\n").length, 3);
});

test("diagnostics contain one line and exclude messages, URIs and untrusted tokens", () => {
  const error = Object.assign(new Error("private message"), {
    name: "Error\nprivate", codeName: `${mongoProtocol}://private`, errorLabels: ["bad label\nprivate"],
  });
  assert.equal(diagnostic(error), "G2_FAIL stage=config code=G2_UNEXPECTED_FAILURE name=- codeName=- mongoCode=- labels=-\n");
});

test("unexpected driver errors retain their own metadata when they also have a cause", () => {
  const error = Object.assign(new Error("private outer", { cause: new TypeError("private inner") }), {
    name: "MongoServerSelectionError", errorLabels: ["ResetPool"], g2Stage: "connect",
  });
  assert.equal(diagnostic(error), "G2_FAIL stage=connect code=G2_UNEXPECTED_FAILURE name=MongoServerSelectionError codeName=- mongoCode=- labels=ResetPool\n");
});
