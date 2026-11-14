"use strict";

// Disposable Docker CI or explicitly approved isolated staging only.
// Never import application startup or its jobs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { collect } = require("../g2-mongo-manifest");

function configuration(env = process.env) {
  const staging = env.G2_EXECUTION_SCOPE === "staging-isolated";
  if (staging) {
    assert.equal(env.G2_OWNER_APPROVED, "true");
    assert.equal(env.G2_STAGING_REHEARSAL_APPROVED, "true");
  } else {
    assert.equal(env.CI, "true");
    assert.equal(env.GITHUB_ACTIONS, "true");
    assert.equal(env.G2_SYNTHETIC_DOCKER, "true");
  }
  const uri = new URL(env.G2_MONGO_URI);
  assert.equal(uri.hostname, staging ? "g2-mongo-restore-drill.railway.internal" : "mongodb.railway.internal");
  assert.equal(uri.pathname, staging ? "/basicdiet_g2_staging_synthetic" : "/test");
  return { uri, dbName: uri.pathname.slice(1) };
}

function setPath(document, dottedPath, value) {
  const parts = dottedPath.split(".");
  let parent = document;
  for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
  parent[parts.at(-1)] = value;
}

async function main(env = process.env) {
  const { uri, dbName } = configuration(env);
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  try {
    await mongoose.connect(uri.toString(), { autoIndex: false, autoCreate: false });
    assert.deepEqual(await mongoose.connection.db.listCollections().toArray(), []);
    // Model compilation and index-service initialization happen only after the
    // read-only empty-database check, with automatic collection/index writes off.
    const { ensurePaymentIndexes } = require("../../src/services/paymentIndexService");
    const modelsDirectory = path.resolve(__dirname, "../../src/models");
    for (const file of fs.readdirSync(modelsDirectory).filter(file => file.endsWith(".js"))) {
      require(path.join(modelsDirectory, file));
    }
    const models = Object.values(mongoose.models);
    let total = 0;
    for (const [position, model] of models.entries()) {
      // Exercise every real collection with about 30k total, mostly operational days.
      const count = model.modelName === "SubscriptionDay" ? 20000 :
        Math.floor(10000 / (models.length - 1)) + (position === 0 ? 16 : 0);
      const indexedPaths = [...new Set(model.schema.indexes().flatMap(([key]) => Object.keys(key)))];
      const documents = Array.from({ length: count }, (_, index) => {
        const document = { _id: new mongoose.Types.ObjectId(), syntheticG2: true };
        for (const field of indexedPaths) {
          const schemaPath = model.schema.path(field);
          let value = "synthetic-" + index;
          if (schemaPath?.instance === "ObjectId") value = new mongoose.Types.ObjectId();
          if (schemaPath?.instance === "Number") value = index;
          if (schemaPath?.instance === "Boolean") value = true;
          if (schemaPath?.instance === "Date") value = new Date("2099-01-01T00:00:00Z");
          setPath(document, field, value);
        }
        return document;
      });
      await model.collection.insertMany(documents);
      await model.createIndexes();
      total += count;
    }
    // Exactly the startup service used by src/db.js, after all schema indexes exist.
    await ensurePaymentIndexes();
    process.stdout.write("Payment indexes ensured\n");
    const manifest = { format: "G2_COUNTS_INDEXES_V1", db: dbName, collections: await collect(mongoose.connection.db) };
    const encodedLength = Buffer.from(JSON.stringify(manifest)).toString("base64").length;
    assert.ok(encodedLength > 32768, "Synthetic baseline must reproduce the old variable-size limit");
    assert.ok(total >= 29000 && total <= 31000);
    process.stdout.write(`G2_SYNTHETIC_DOCUMENTS=${total}\nG2_SYNTHETIC_COLLECTIONS=${models.length}\nG2_LEGACY_BASELINE_BYTES=${encodedLength}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch(error => {
  // Schema/index failures are actionable without logging documents or credentials.
  process.stderr.write(`G2_SEED_FAIL name=${error.name} mongoCode=${Number.isInteger(error.code) ? error.code : "-"}\n`);
  process.exitCode = 1;
});

module.exports = { configuration, main };
