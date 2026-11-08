"use strict";
// G2 owner-gated pre-deploy operation. No mongosh. Never log URIs or data.
const { MongoClient } = require("mongodb");
const { collect } = require("./g2-mongo-manifest");

const CODES = Object.freeze({
  G2_OWNER_APPROVAL_REQUIRED: 64,
  G2_UNSAFE_TARGET: 65,
  G2_INIT_FAILED: 66,
  G2_PRIMARY_TIMEOUT: 67,
  G2_MANIFEST_MISMATCH: 68,
  G2_TRANSACTION_FAILED: 69,
  G2_UNEXPECTED_FAILURE: 70,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function configuration() {
  if (process.env.G2_OWNER_APPROVED !== "true") fail("G2_OWNER_APPROVAL_REQUIRED");
  const ci = process.env.G2_EXECUTION_SCOPE === "ci-disposable";
  if (ci && !(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true")) {
    fail("G2_UNSAFE_TARGET");
  }
  if (!ci && process.env.G2_EXECUTION_SCOPE === "ci-disposable") fail("G2_UNSAFE_TARGET");
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
    : "mongodb.railway.internal";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(expectedHost)) fail("G2_UNSAFE_TARGET");
  const targetHost = uri.hostname;
  if (ci) {
    if (!["127.0.0.1", "localhost"].includes(targetHost) ||
        uri.pathname !== "/basicdiet_g2_ci_test") fail("G2_UNSAFE_TARGET");
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
    fail("G2_TRANSACTION_FAILED");
  } finally {
    if (created) await db.collection(name).drop().catch(() => {});
  }
}

async function main() {
  const config = configuration();
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(config.dbName);
    const before = await collect(db);
    const admin = client.db("admin");
    const hello = await admin.command({ hello: 1 });
    if (hello.setName && hello.setName !== "rs0") fail("G2_INIT_FAILED");
    if (hello.setName !== "rs0") {
      let initiated;
      try {
        initiated = await admin.command({
          replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: config.member }] },
        });
      } catch (error) {
        if (error.codeName !== "AlreadyInitialized") fail("G2_INIT_FAILED");
        initiated = { ok: 1 };
      }
      if (initiated.ok !== 1 && initiated.codeName !== "AlreadyInitialized") {
        fail("G2_INIT_FAILED");
      }
    }
    await waitPrimary(admin);
    if (JSON.stringify(before) !== JSON.stringify(await collect(db))) {
      fail("G2_MANIFEST_MISMATCH");
    }
    await transactionProbe(client, db, before);
    if (JSON.stringify(before) !== JSON.stringify(await collect(db))) {
      fail("G2_MANIFEST_MISMATCH");
    }
    process.stdout.write("G2_RS0_PRIMARY_COMMIT_ABORT_COUNTS_INDEXES_PASS\n");
  } finally { await client.close(); }
}

if (require.main === module) {
  main().catch((error) => {
    const code = Object.prototype.hasOwnProperty.call(CODES, error.code)
      ? error.code : "G2_UNEXPECTED_FAILURE";
    process.stderr.write(code + "\n");
    process.exitCode = CODES[code];
  });
}
module.exports = { configuration, main };
