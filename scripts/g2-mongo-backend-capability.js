"use strict";
// CI-only backend bootstrap under the NON-test URI resolver. This deliberately
// uses the same private DNS and URI shape as the proposed Production backend.
// NODE_ENV=test would correctly reject mongodb.railway.internal as a known
// Production hostname; do NOT weaken that existing safety guard.
const mongoose = require("mongoose");
const { checkMongoTransactionSupport, startSafeSession } = require("../src/utils/mongoTransactionSupport");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const { connectDb } = require("../src/db");
async function main() {
  if (process.env.G2_EXECUTION_SCOPE !== "ci-disposable"
    || process.env.CI !== "true"
    || process.env.GITHUB_ACTIONS !== "true"
    || process.env.G2_CI_PEER_CONTAINER !== "true"
    || process.env.NODE_ENV !== "production"
    || !process.env.MONGO_URI) throw Error("G2_CI_PEER_ONLY");
  const uri = resolveMongoUri();
  const u = new URL(uri);
  if (!["mongodb.railway.internal", "g2-restore.railway.internal"].includes(u.hostname)
    || u.port !== "27017"
    || u.pathname !== "/basicdiet_g2_ci_test"
    || u.searchParams.get("replicaSet") !== "rs0"
    || u.searchParams.get("authSource") !== "admin"
    || (u.searchParams.has("directConnection") && u.searchParams.get("directConnection") !== "true"))
    throw Error("G2_CI_PEER_ONLY");
  const expected = u.searchParams.get("directConnection") === "true"
    ? "Single" : "ReplicaSetWithPrimary";
  if (process.env.G2_EXPECTED_CLIENT_TOPOLOGY !== expected)
    throw Error("G2_TOPOLOGY_EXPECTATION_INVALID");
  // Do not print any representation of the URI, even masked.
  const originalLog = console.log;
  try {
    console.log = (...values) => {
      if (String(values[0] || "").startsWith("[railway-startup]")) return;
      return originalLog(...values);
    };
    await connectDb();
  } finally { console.log = originalLog; }
  try {
    const actual = mongoose.connection.getClient().topology.description.type;
    if (actual !== expected) throw Error("G2_TOPOLOGY_UNEXPECTED");
    const supports = await checkMongoTransactionSupport();
    const session = await startSafeSession();
    try {
      if (supports !== true || session.supportsTransactions !== true)
        throw Error("G2_BACKEND_TRANSACTIONS_NOT_SUPPORTED");
    } finally { await session.endSession(); }
    process.stdout.write("G2_PEER_BACKEND_TOPOLOGY_" + expected + "_TRANSACTIONS_PASS\n");
  } finally { await mongoose.disconnect(); }
}
main().catch(e => {
  process.stderr.write((e.message.startsWith("G2_") ? e.message : "G2_BACKEND_CAPABILITY_FAILED") + "\n");
  process.exitCode = 1;
});
