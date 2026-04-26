const crypto = require("crypto");

const { OPERATION_SCOPES } = require("../constants/phase1Contract");
const { createLocalizedError } = require("../utils/errorLocalization");

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_HEADER_KEYS = ["idempotency-key", "Idempotency-Key", "x-idempotency-key", "X-Idempotency-Key"];
const IDEMPOTENCY_BODY_KEYS = ["idempotencyKey", "idempotency_key"];

function normalizeForHashing(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHashing(item));
  }
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") {
      return value.toHexString();
    }
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeForHashing(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function buildStableHash(input) {
  const normalized = normalizeForHashing(input);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function parseOperationIdempotencyKey({ headers = {}, body = {} } = {}) {
  let rawValue;

  for (const key of IDEMPOTENCY_HEADER_KEYS) {
    if (headers && headers[key] !== undefined && headers[key] !== null) {
      rawValue = headers[key];
      break;
    }
  }

  if (rawValue === undefined || rawValue === null) {
    for (const key of IDEMPOTENCY_BODY_KEYS) {
      if (body && body[key] !== undefined && body[key] !== null) {
        rawValue = body[key];
        break;
      }
    }
  }

  if (rawValue === undefined || rawValue === null) return "";

  const value = String(rawValue).trim();
  if (!value) return "";

  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw createLocalizedError({
      code: "VALIDATION_ERROR",
      key: "errors.validation.idempotencyMaxLength",
      fallbackMessage: "idempotencyKey must be at most 128 characters",
    });
  }

  return value;
}

function normalizeOperationScope(rawScope) {
  const normalized = String(rawScope || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "subscription_activation" || normalized === "checkout") {
    return "subscription_checkout";
  }
  if (normalized === "custom_salad_order") {
    return "custom_salad_day";
  }
  if (normalized === "custom_meal_order") {
    return "custom_meal_day";
  }
  if (normalized === "one_time_order") {
    return "one_time_addon";
  }
  return OPERATION_SCOPES.includes(normalized) ? normalized : normalized;
}

function buildOperationRequestHash({ scope, userId, effectivePayload }) {
  return buildStableHash({
    operationScope: normalizeOperationScope(scope),
    userId: userId ? String(userId) : "",
    effectivePayload: effectivePayload || {},
  });
}

function extractBusinessContract(contractSnapshot) {
  const snapshot = contractSnapshot && typeof contractSnapshot === "object" ? contractSnapshot : {};
  return {
    plan: snapshot.plan || {},
    start: snapshot.start || {},
    pricing: snapshot.pricing || {},
    delivery: snapshot.delivery || {},
    policySnapshot: snapshot.policySnapshot || {},
  };
}

function buildContractHash({ contractSnapshot, businessContract } = {}) {
  const canonicalBusinessContract = businessContract || extractBusinessContract(contractSnapshot);
  return buildStableHash(canonicalBusinessContract);
}

function compareIdempotentRequest({ existingRequestHash, incomingRequestHash } = {}) {
  if (!existingRequestHash) return "new";
  return existingRequestHash === incomingRequestHash ? "reuse" : "conflict";
}

module.exports = {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  parseOperationIdempotencyKey,
  normalizeOperationScope,
  buildOperationRequestHash,
  buildContractHash,
  compareIdempotentRequest,
  extractBusinessContract,
  normalizeForHashing,
};
