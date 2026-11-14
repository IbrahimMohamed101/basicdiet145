"use strict";
// Post-conversion: real commit + intentional abort; leaves no test collection.
const { MongoClient } = require("mongodb");
const { safety, collect } = require("./g2-mongo-manifest");
const fs = require("node:fs");
async function main() {
  const { db: name, uri } = safety();
  const manifest = process.argv[2];
  if (!manifest) throw Error("G2_MANIFEST_REQUIRED");
  const cli = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await cli.connect();
  const db = cli.db(name);
  const tmpName = "__g2_transaction_verification";
  let created = false;
  try {
    const hello = await cli.db("admin").command({ hello: 1 });
    if (hello.setName !== "rs0" || hello.isWritablePrimary !== true)
      throw Error("G2_RS0_PRIMARY_REQUIRED");
    const baseline = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (baseline.collections[tmpName]) throw Error("G2_TEMP_COLLECTION_COLLISION");
    if (JSON.stringify(baseline.collections) !== JSON.stringify(await collect(db)))
      throw Error("G2_MANIFEST_MISMATCH_BEFORE");
    await db.createCollection(tmpName);
    created = true;
    const tmp = db.collection(tmpName);
    const committed = cli.startSession();
    try {
      await committed.withTransaction(async () => {
        await tmp.insertOne({ _id: "committed" }, { session: committed });
      });
    } finally { await committed.endSession(); }
    if (await tmp.countDocuments({ _id: "committed" }) !== 1) throw Error("G2_COMMIT_FAILED");
    const aborted = cli.startSession();
    try {
      aborted.startTransaction();
      await tmp.insertOne({ _id: "aborted" }, { session: aborted });
      await aborted.abortTransaction();
    } finally { await aborted.endSession(); }
    if (await tmp.countDocuments({ _id: "aborted" }) !== 0) throw Error("G2_ABORT_FAILED");
  } finally {
    if (created) await db.collection(tmpName).drop().catch(() => {});
    await cli.close();
  }
  const check = new MongoClient(uri);
  try {
    await check.connect();
    const baseline = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (JSON.stringify(baseline.collections) !== JSON.stringify(await collect(check.db(name))))
      throw Error("G2_MANIFEST_MISMATCH_AFTER");
  } finally { await check.close(); }
  process.stdout.write("G2_RS0_PRIMARY_COMMIT_ABORT_MANIFEST_PASS\n");
}
if (require.main === module) main().catch(e => {
  process.stderr.write((e.message.startsWith("G2_") ? e.message : "G2_VERIFICATION_FAILED") + "\n"); process.exitCode = 1;
});
