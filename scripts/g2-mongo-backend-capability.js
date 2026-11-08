"use strict";
// CI-only backend capability check; never starts index.js jobs or webhooks.
const mongoose = require("mongoose");
const { checkMongoTransactionSupport, startSafeSession } = require("../src/utils/mongoTransactionSupport");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
async function main() {
  if (process.env.G2_EXECUTION_SCOPE !== "ci-disposable"
    || process.env.NODE_ENV !== "test"
    || !process.env.MONGO_URI_TEST) throw Error("G2_CI_ONLY");
  const uri = resolveMongoUri();
  const u = new URL(uri);
  if (!["127.0.0.1", "localhost"].includes(u.hostname)
    || u.pathname !== "/basicdiet_g2_ci_test") throw Error("G2_CI_ONLY");
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  try {
    const supports = await checkMongoTransactionSupport();
    const session = await startSafeSession();
    try {
      if (supports !== true || session.supportsTransactions !== true)
        throw Error("G2_BACKEND_TRANSACTIONS_NOT_SUPPORTED");
    } finally { await session.endSession(); }
    process.stdout.write("G2_BACKEND_TRANSACTIONS_SUPPORTED=true\n");
  } finally { await mongoose.disconnect(); }
}
main().catch(e => {
  process.stderr.write((e.message.startsWith("G2_") ? e.message : "G2_BACKEND_CAPABILITY_FAILED") + "\n");
  process.exitCode = 1;
});
