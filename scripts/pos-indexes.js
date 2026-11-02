"use strict";
// Default: READ ONLY. --apply is an explicitly approved first-install migration.
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const { models } = require("../src/modules/pos/models");
const { indexDefinitions, inspectIndexes } = require("../src/modules/pos/readiness");
async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && (
    process.env.POS_INDEX_MIGRATION_APPROVED !== "true" ||
    !String(process.env.POS_BACKUP_REFERENCE || "").trim()
  )) {
    throw new Error("POS index write requires POS_INDEX_MIGRATION_APPROVED=true and externally verified POS_BACKUP_REFERENCE");
  }
  await connectDb();
  if (!apply) {
    console.log(JSON.stringify({ mode: "read_only", definitions: indexDefinitions(), missing: await inspectIndexes() }, null, 2));
    return;
  }
  // Intended only for newly created, empty POS collections. Never migrate
  // populated sales data without a separate index-conflict audit.
  for (const model of models) {
    if (await mongoose.connection.db.collection(model.collection.name).countDocuments({}) !== 0) {
      throw new Error("Refusing nonempty POS collection: " + model.collection.name);
    }
  }
  for (const model of models) {
    const definitions = model.schema.indexes().map(([key, options]) => ({ key, ...options }));
    if (definitions.length) await mongoose.connection.db.collection(model.collection.name).createIndexes(definitions);
  }
  const missing = await inspectIndexes();
  if (missing.length) throw new Error("POS index verification failed");
  console.log(JSON.stringify({ mode: "applied", validated: indexDefinitions().length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.connection.close().catch(() => {}));
