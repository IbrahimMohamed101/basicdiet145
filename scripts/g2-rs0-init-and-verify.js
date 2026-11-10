"use strict";
// G2 owner-gated pre-deploy operation. No mongosh. Never log URIs or data.
const { MongoClient } = require("mongodb");
const { createHash } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const { collect } = require("./g2-mongo-manifest");

const CODES = Object.freeze({
  G2_OWNER_APPROVAL_REQUIRED: 64,
  G2_MANIFEST_REQUIRED: 71,
  G2_MAINTENANCE_REQUIRED: 72,
  G2_UNSAFE_TARGET: 65,
  G2_INIT_FAILED: 66,
  G2_PRIMARY_TIMEOUT: 67,
  G2_MANIFEST_MISMATCH: 68,
  G2_TRANSACTION_FAILED: 69,
  G2_UNEXPECTED_FAILURE: 70,
  G2_BASELINE_TOO_LARGE: 73,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code, cause) => { throw Object.assign(new Error(code, { cause }), { code }); };

function baselineOutput(snapshot) {
  const json = JSON.stringify(snapshot);
  const compressed = gzipSync(Buffer.from(json, "utf8")).toString("base64");
  if (compressed.length >= 30000) fail("G2_BASELINE_TOO_LARGE");
  return "G2_BASELINE_GZ=" + compressed + "\n" +
    "G2_BASELINE_SHA256=" + createHash("sha256").update(json).digest("hex") + "\n" +
    "G2_BASELINE_BYTES=" + Buffer.byteLength(compressed, "ascii") + "\n";
}

function readBaseline(dbName) {
  try {
    let json;
    const compressed = process.env.G2_BASELINE_MANIFEST_GZ_B64;
    if (compressed) {
      const digest = process.env.G2_BASELINE_SHA256 || "";
      if (!/^[a-fA-F0-9]{64}$/.test(digest) || compressed.length >= 30000 ||
          Buffer.from(compressed, "base64").toString("base64") !== compressed) {
        fail("G2_MANIFEST_REQUIRED");
      }
      const bytes = gunzipSync(Buffer.from(compressed, "base64"), { maxOutputLength: 16 * 1024 * 1024 });
      if (createHash("sha256").update(bytes).digest("hex") !== digest.toLowerCase()) {
        fail("G2_MANIFEST_REQUIRED");
      }
      json = bytes.toString("utf8");
    } else if (process.env.G2_EXECUTION_SCOPE === "ci-disposable" &&
               process.env.G2_BASELINE_MANIFEST_B64) {
      json = Buffer.from(process.env.G2_BASELINE_MANIFEST_B64, "base64").toString("utf8");
    } else {
      fail("G2_MANIFEST_REQUIRED");
    }
    const baseline = JSON.parse(json);
    if (baseline.format !== "G2_COUNTS_INDEXES_V1" || baseline.db !== dbName ||
        !baseline.collections || typeof baseline.collections !== "object" ||
        Array.isArray(baseline.collections)) fail("G2_MANIFEST_REQUIRED");
    for (const collection of Object.values(baseline.collections)) {
      if (!collection || !Number.isSafeInteger(collection.count) || collection.count < 0 ||
          !Array.isArray(collection.indexes) || collection.indexes.some(index =>
            !index || typeof index.name !== "string" || !index.key ||
            typeof index.key !== "object" || Array.isArray(index.key) ||
            typeof index.unique !== "boolean" || typeof index.sparse !== "boolean")) {
        fail("G2_MANIFEST_REQUIRED");
      }
    }
    return baseline.collections;
  } catch (error) {
    fail("G2_MANIFEST_REQUIRED", error);
  }
}

function diagnostic(error) {
  const code = Object.hasOwn(CODES, error.code) ? error.code : "G2_UNEXPECTED_FAILURE";
  const original = error.cause || error;
  const token = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : "-";
  const labels = Array.isArray(original.errorLabels) ? original.errorLabels.map(token).join(",") : "";
  return `G2_FAIL stage=${error.g2Stage || "config"} code=${code} name=${token(original.name)} ` +
    `codeName=${token(original.codeName)} mongoCode=${Number.isInteger(original.code) ? original.code : "-"} labels=${labels || "-"}\n`;
}

function configuration() {
  if (process.env.G2_OWNER_APPROVED !== "true") fail("G2_OWNER_APPROVAL_REQUIRED");
  const ci = process.env.G2_EXECUTION_SCOPE === "ci-disposable";
  const staging = process.env.G2_EXECUTION_SCOPE === "staging-isolated";
  if (staging && process.env.G2_STAGING_REHEARSAL_APPROVED !== "true") fail("G2_OWNER_APPROVAL_REQUIRED");
  if (ci && !(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true")) {
    fail("G2_UNSAFE_TARGET");
  }
  if (!ci && !staging && !["", "owner-approved"].includes(process.env.G2_EXECUTION_SCOPE || "")) fail("G2_UNSAFE_TARGET");
  const raw = process.env.G2_MONGO_URI || process.env.MONGO_URI ||
    process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!raw) fail("G2_UNSAFE_TARGET");
  let uri;
  try {
    uri = new URL(raw);
    if (uri.protocol !== "mongodb:" || uri.host.includes(",") ||
        !uri.pathname || uri.pathname === "/" || uri.searchParams.has("tlsCertificateKeyFile")) {
      fail("G2_UNSAFE_TARGET");
    }
  } catch { fail("G2_UNSAFE_TARGET"); }
  const expectedHost = ci
    ? (process.env.G2_RS0_MEMBER_HOST || "mongodb.railway.internal")
    : staging ? "g2-mongo-restore-drill.railway.internal" : "mongodb.railway.internal";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(expectedHost)) fail("G2_UNSAFE_TARGET");
  const targetHost = uri.hostname;
  if (ci) {
    if (!["127.0.0.1", "localhost"].includes(targetHost) ||
        uri.pathname !== "/basicdiet_g2_ci_test") fail("G2_UNSAFE_TARGET");
  } else if (staging) {
    if (targetHost !== expectedHost || uri.pathname !== "/basicdiet_g2_staging_synthetic") fail("G2_UNSAFE_TARGET");
  } else if (targetHost !== "mongodb.railway.internal" || uri.pathname !== "/test" ||
             process.env.NODE_ENV === "test") {
    fail("G2_UNSAFE_TARGET");
  }
  // Initiation must work before a replica-set topology can be discovered.
  uri.searchParams.delete("replicaSet");
  uri.searchParams.set("directConnection", "true");
  return { uri: uri.toString(), dbName: uri.pathname.slice(1), member: expectedHost + ":27017" };
}

async function waitPrimary(admin) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const hello = await admin.command({ hello: 1 });
      if (hello.setName && hello.setName !== "rs0") fail("G2_INIT_FAILED");
      if (hello.setName === "rs0" && hello.isWritablePrimary === true) return;
    } catch (error) {
      if (error.code === "G2_INIT_FAILED") throw error;
    }
    await sleep(1000);
  }
  fail("G2_PRIMARY_TIMEOUT");
}

async function transactionProbe(client, db, original) {
  const name = "__g2_node_transaction_probe";
  if (Object.prototype.hasOwnProperty.call(original, name)) fail("G2_TRANSACTION_FAILED");
  let created = false;
  try {
    await db.createCollection(name);
    created = true;
    const col = db.collection(name);
    const commit = client.startSession();
    try {
      await commit.withTransaction(async () => {
        await col.insertOne({ _id: "commit" }, { session: commit });
      }, { writeConcern: { w: "majority" } });
    } finally { await commit.endSession(); }
    if (await col.countDocuments({ _id: "commit" }) !== 1) fail("G2_TRANSACTION_FAILED");
    const abort = client.startSession();
    try {
      abort.startTransaction();
      await col.insertOne({ _id: "abort" }, { session: abort });
      await abort.abortTransaction();
    } finally { await abort.endSession(); }
    if (await col.countDocuments({ _id: "abort" }) !== 0) fail("G2_TRANSACTION_FAILED");
  } catch (error) {
    if (error.code === "G2_TRANSACTION_FAILED") throw error;
    fail("G2_TRANSACTION_FAILED", error);
  } finally {
    if (created) await db.collection(name).drop().catch(() => {});
  }
}

async function main() {
  let stage = "config";
  let client;
  let failure;
  try {
    const baselineOnly = process.argv.length === 3 && process.argv[2] === "--baseline";
    if (process.argv.length > 2 && !baselineOnly) fail("G2_UNSAFE_TARGET");
    // Both the capture and the one-time initializer must run under frozen writes.
    if (process.env.MAINTENANCE_MODE !== "true") fail("G2_MAINTENANCE_REQUIRED");
    const config = configuration();
    stage = "connect";
    client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(config.dbName);
    const admin = client.db("admin");
    stage = "hello";
    const hello = await admin.command({ hello: 1 });
    if (baselineOnly) {
      // Run as the backend preDeploy command BEFORE the Mongo start-command change.
      // This is intentionally read-only and never returns document bodies or URIs.
      if (hello.setName || hello.msg === "isdbgrid") fail("G2_UNSAFE_TARGET");
      stage = "collect";
      const snapshot = {
        format: "G2_COUNTS_INDEXES_V1",
        db: config.dbName,
        collections: await collect(db),
      };
      stage = "manifest";
      process.stdout.write(baselineOutput(snapshot));
      return;
    }
    // An uninitialized --replSet mongod rejects collection reads. The baseline
    // MUST be captured during write freeze on the last standalone deployment,
    // then passed privately to preDeploy; never substitute a post-init snapshot.
    stage = "manifest";
    const before = readBaseline(config.dbName);
    stage = "initiate";
    if (hello.setName && hello.setName !== "rs0") fail("G2_INIT_FAILED");
    if (hello.setName !== "rs0") {
      let initiated;
      try {
        process.stdout.write("G2_INITIATE_SENT\n");
        initiated = await admin.command({
          replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: config.member }] },
        });
      } catch (error) {
        if (error.codeName !== "AlreadyInitialized") fail("G2_INIT_FAILED", error);
        initiated = { ok: 1, codeName: "AlreadyInitialized" };
      }
      if (initiated.ok !== 1 && initiated.codeName !== "AlreadyInitialized") {
        fail("G2_INIT_FAILED");
      }
      process.stdout.write(initiated.codeName === "AlreadyInitialized" ? "G2_INITIATE_ALREADY\n" : "G2_INITIATE_OK\n");
    } else {
      process.stdout.write("G2_INITIATE_ALREADY\n");
    }
    stage = "wait-primary";
    await waitPrimary(admin);
    stage = "collect";
    let after = await collect(db);
    stage = "compare";
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fail("G2_MANIFEST_MISMATCH");
    }
    stage = "probe";
    await transactionProbe(client, db, before);
    stage = "collect";
    after = await collect(db);
    stage = "compare";
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fail("G2_MANIFEST_MISMATCH");
    }
    process.stdout.write("G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS\n");
  } catch (error) {
    failure = error;
    error.g2Stage = stage;
    throw error;
  } finally {
    if (client) {
      try { await client.close(); } catch (error) {
        if (!failure) {
          error.g2Stage = stage;
          throw error;
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = Object.prototype.hasOwnProperty.call(CODES, error.code)
      ? error.code : "G2_UNEXPECTED_FAILURE";
    process.stderr.write(diagnostic(error));
    process.exitCode = CODES[code];
  });
}
module.exports = { configuration, main, baselineOutput, readBaseline, diagnostic };
