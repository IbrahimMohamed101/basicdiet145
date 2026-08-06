"use strict";

function normalizeBoolean(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  const err = new Error("MONGOOSE_AUTO_INDEX must be true or false");
  err.code = "INVALID_MONGOOSE_AUTO_INDEX";
  throw err;
}

function resolveMongooseIndexRuntimePolicy(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const configured = normalizeBoolean(env.MONGOOSE_AUTO_INDEX);

  // Never let application startup create, rebuild, or reconcile indexes on the
  // live customer database. Production index changes must use a reviewed,
  // explicit migration after a read-only index audit.
  if (nodeEnv === "production") {
    return Object.freeze({
      nodeEnv,
      autoIndex: false,
      source: "production_hard_block",
      configured,
    });
  }

  return Object.freeze({
    nodeEnv,
    autoIndex: configured == null ? true : configured,
    source: configured == null ? "non_production_default" : "environment",
    configured,
  });
}

module.exports = {
  normalizeBoolean,
  resolveMongooseIndexRuntimePolicy,
};
