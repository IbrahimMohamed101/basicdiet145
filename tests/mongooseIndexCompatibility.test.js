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

const SUPPORTED_PARTIAL_FILTER_OPERATORS = new Set([
  "$and",
  "$or",
  "$eq",
  "$exists",
  "$type",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
]);

function inspectPartialFilterOperators(value, pathSegments = [], violations = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectPartialFilterOperators(
      entry,
      [...pathSegments, String(index)],
      violations
    ));
    return violations;
  }
  if (!value || typeof value !== "object") return violations;

  for (const [key, nestedValue] of Object.entries(value)) {
    const currentPath = [...pathSegments, key];
    if (key.startsWith("$") && !SUPPORTED_PARTIAL_FILTER_OPERATORS.has(key)) {
      violations.push({
        operator: key,
        path: currentPath.join("."),
        reason: "unsupported_partial_filter_operator",
      });
    }
    if (key === "$exists" && nestedValue !== true) {
      violations.push({
        operator: key,
        path: currentPath.join("."),
        reason: "partial_filter_exists_must_be_true",
      });
    }
    inspectPartialFilterOperators(nestedValue, currentPath, violations);
  }
  return violations;
}

function indexNameOf(keys, options = {}) {
  return options.name || Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}

function inspectIndexes() {
  const violations = [];
  for (const modelName of mongoose.modelNames().sort()) {
    const model = mongoose.model(modelName);
    for (const [keys, options = {}] of model.schema.indexes()) {
      const indexName = indexNameOf(keys, options);
      if (options.sparse === true && options.partialFilterExpression) {
        violations.push({
          modelName,
          keys,
          indexName,
          reason: "sparse_and_partial_filter_cannot_be_combined",
        });
      }
      if (options.unique === true && Object.keys(keys).length === 0) {
        violations.push({
          modelName,
          keys,
          indexName,
          reason: "unique_index_has_no_keys",
        });
      }
      if (options.partialFilterExpression) {
        for (const partialViolation of inspectPartialFilterOperators(
          options.partialFilterExpression
        )) {
          violations.push({
            modelName,
            keys,
            indexName,
            ...partialViolation,
          });
        }
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
