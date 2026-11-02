"use strict";
const mongoose = require("mongoose");
const { models: defaultModels } = require("./models");
function isEnabled(env = process.env) {
  return String(env.POS_ENABLED || "").trim().toLowerCase() === "true";
}
function indexDefinitions(models = defaultModels) {
  return models.flatMap(model => model.schema.indexes().map(([key, options]) => ({
    collection: model.collection.name, key, name: options.name,
    unique: Boolean(options.unique),
    partialFilterExpression: options.partialFilterExpression || null,
  })));
}
function equalIndex(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}
async function inspectIndexes(connection = mongoose.connection, models = defaultModels) {
  const missing = [];
  for (const model of models) {
    let actual = [];
    try {
      actual = await connection.db.collection(model.collection.name).indexes();
    } catch (err) {
      if (err.code !== 26 && err.codeName !== "NamespaceNotFound") throw err;
    }
    for (const def of indexDefinitions([model])) {
      const found = actual.find(row => row.name === def.name);
      if (!found || !equalIndex(found.key, def.key)
          || Boolean(found.unique) !== def.unique
          || !equalIndex(found.partialFilterExpression || null, def.partialFilterExpression)) {
        missing.push({ collection: def.collection, name: def.name });
      }
    }
  }
  return missing;
}
async function getPosReadiness({ connection = mongoose.connection, models = defaultModels, env = process.env } = {}) {
  if (!isEnabled(env)) return { ready: false, code: "POS_DISABLED", missingIndexes: [] };
  try {
    if (!connection.db) throw new Error("Mongo not connected");
    const hello = await connection.db.admin().command({ hello: 1 });
    // Intentionally DO NOT use the standalone fallback in mongoTransactionSupport.
    if (!hello.setName && hello.msg !== "isdbgrid") {
      return { ready: false, code: "POS_TRANSACTIONS_REQUIRED", missingIndexes: [] };
    }
    const missingIndexes = await inspectIndexes(connection, models);
    if (missingIndexes.length) return { ready: false, code: "POS_INDEXES_MISSING", missingIndexes };
    return { ready: true, code: "POS_READY", missingIndexes: [] };
  } catch (_) {
    return { ready: false, code: "POS_READINESS_UNAVAILABLE", missingIndexes: [] };
  }
}
async function requirePosReady(_req, res, next) {
  const state = await getPosReadiness();
  if (!state.ready) return res.status(503).json({ ok: false, code: state.code });
  return next();
}
module.exports = { isEnabled, indexDefinitions, inspectIndexes, getPosReadiness, requirePosReady };
