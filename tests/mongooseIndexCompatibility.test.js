"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const modelsDirectory = path.join(__dirname, "..", "src", "models");
for (const fileName of fs.readdirSync(modelsDirectory).sort()) {
  if (!fileName.endsWith(".js")) continue;
  require(path.join(modelsDirectory, fileName));
}

function inspectIndexes() {
  const violations = [];
  for (const modelName of mongoose.modelNames().sort()) {
    const model = mongoose.model(modelName);
    for (const [keys, options = {}] of model.schema.indexes()) {
      if (options.sparse === true && options.partialFilterExpression) {
        violations.push({
          modelName,
          keys,
          indexName: options.name || Object.entries(keys)
            .map(([field, direction]) => `${field}_${direction}`)
            .join("_"),
          reason: "sparse_and_partial_filter_cannot_be_combined",
        });
      }
      if (options.unique === true && Object.keys(keys).length === 0) {
        violations.push({
          modelName,
          keys,
          indexName: options.name || "",
          reason: "unique_index_has_no_keys",
        });
      }
    }
  }
  return violations;
}

function run() {
  const violations = inspectIndexes();
  if (violations.length > 0) {
    console.error(JSON.stringify({ invalidMongooseIndexes: violations }, null, 2));
  }
  assert.deepStrictEqual(violations, [], "All Mongoose indexes must be valid for MongoDB");
  console.log(`mongoose index compatibility tests passed (${mongoose.modelNames().length} models)`);
}

run();
