"use strict";
// JSON contains ONLY collection counts and index definitions. No document payloads.
const fs = require("node:fs");
const { MongoClient } = require("mongodb");
function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i += 2) out[process.argv[i]] = process.argv[i + 1];
  return out;
}
function safety() {
  if (!["ci-disposable", "owner-approved"].includes(process.env.G2_EXECUTION_SCOPE)) throw Error("G2_SCOPE_REQUIRED");
  if (process.env.G2_EXECUTION_SCOPE === "owner-approved" && process.env.G2_OWNER_APPROVED !== "true") throw Error("G2_APPROVAL_REQUIRED");
  const db = process.env.G2_MONGO_DB;
  if (!/^[a-zA-Z0-9_]+$/.test(db || "") || !db) throw Error("G2_DB_NAME_REQUIRED");
  const uri = process.env.G2_MONGO_URI;
  if (!uri) throw Error("G2_URI_VARIABLE_REQUIRED");
  if (process.env.G2_EXECUTION_SCOPE === "ci-disposable") {
    const u = new URL(uri);
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || db !== "basicdiet_g2_ci_test")
      throw Error("G2_CI_DISPOSABLE_ONLY");
  }
  return { db, uri };
}
async function collect(db) {
  // Include EVERY real collection, including internal system collections; exclude
  // views because they do not own separate documents or collection indexes.
  const names = (await db.listCollections({}).toArray())
    .filter(c => c.type === "collection").map(c => c.name).sort();
  const result = {};
  for (const name of names) {
    const collection = db.collection(name);
    const indexes = (await collection.indexes()).map(i => ({
      name: i.name, key: i.key, unique: i.unique === true,
      sparse: i.sparse === true,
      ...(i.expireAfterSeconds === undefined ? {} : { expireAfterSeconds: i.expireAfterSeconds }),
      ...(i.partialFilterExpression === undefined ? {} : { partialFilterExpression: i.partialFilterExpression }),
    })).sort((a, b) => a.name.localeCompare(b.name));
    result[name] = { count: await collection.countDocuments({}), indexes };
  }
  return result;
}
async function main() {
  const cli = args(), { db: dbName, uri } = safety();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const snapshot = { format: "G2_COUNTS_INDEXES_V1", db: dbName, collections: await collect(client.db(dbName)) };
    if (cli["--compare"]) {
      const baseline = JSON.parse(fs.readFileSync(cli["--compare"], "utf8"));
      if (JSON.stringify(baseline) !== JSON.stringify(snapshot)) throw Error("G2_MANIFEST_MISMATCH");
      process.stdout.write("G2_MANIFEST_MATCH\n");
    }
    if (cli["--out"]) fs.writeFileSync(cli["--out"], JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write("G2_COLLECTIONS=" + Object.keys(snapshot.collections).length + "\n");
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => {
  process.stderr.write((e.message.startsWith("G2_") ? e.message : "G2_MANIFEST_FAILED") + "\n"); process.exitCode = 1;
});
module.exports = { collect, safety };
