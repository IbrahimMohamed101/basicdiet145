"use strict";

const crypto = require("node:crypto");

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    if (typeof value.toJSON === "function" && !Object.prototype.hasOwnProperty.call(value, "toJSON")) {
      return canonicalize(value.toJSON());
    }
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        const child = value[key];
        if (child !== undefined) result[key] = canonicalize(child);
        return result;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashRequestPayload(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length > 200) {
    const err = new Error("Idempotency-Key must be 200 characters or fewer");
    err.status = 400;
    err.code = "INVALID_IDEMPOTENCY_KEY";
    throw err;
  }
  return normalized;
}

module.exports = {
  hashRequestPayload,
  normalizeIdempotencyKey,
  stableStringify,
};
