"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  buildLegacyEntitlementBatchPayload,
  buildPurchaseEntitlementBatchPayload,
} = require("./subscriptionEntitlementBatchFactory");

function persistenceError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function isDuplicateKeyError(err) {
  return Boolean(err && [11000, 11001].includes(Number(err.code)));
}

function applySession(query, session) {
  return session ? query.session(session) : query;
}

function defaultRuntime() {
  return {
    findBySourceKey(sourceKey, { session = null } = {}) {
      return applySession(
        SubscriptionEntitlementBatch.findOne({ sourceKey }),
        session
      );
    },
    async createBatch(payload, { session = null } = {}) {
      if (session) {
        const rows = await SubscriptionEntitlementBatch.create([payload], { session });
        return rows[0];
      }
      return SubscriptionEntitlementBatch.create(payload);
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function ensureBatchByPayload({ payload, session = null, runtime: runtimeOverrides = null }) {
  if (!payload || !payload.sourceKey) {
    throw persistenceError(
      "STACKING_BATCH_SOURCE_REQUIRED",
      "Batch payload with sourceKey is required",
      400
    );
  }
  const runtime = resolveRuntime(runtimeOverrides);
  const existing = await runtime.findBySourceKey(payload.sourceKey, { session });
  if (existing) {
    return { batch: existing, created: false, idempotent: true };
  }

  try {
    const batch = await runtime.createBatch(payload, { session });
    return { batch, created: true, idempotent: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const winner = await runtime.findBySourceKey(payload.sourceKey, { session });
    if (!winner) {
      throw persistenceError(
        "STACKING_BATCH_IDEMPOTENCY_CONFLICT",
        "A duplicate batch source was detected but the winning batch could not be loaded",
        409,
        { sourceKey: payload.sourceKey }
      );
    }
    return { batch: winner, created: false, idempotent: true };
  }
}

async function ensureLegacyEntitlementBatch({
  subscription,
  businessDate,
  now = new Date(),
  session = null,
  runtime = null,
} = {}) {
  const payload = buildLegacyEntitlementBatchPayload({
    subscription,
    businessDate,
    now,
  });
  return ensureBatchByPayload({ payload, session, runtime });
}

async function ensurePaidPurchaseEntitlementBatch({
  draft,
  payment,
  subscriptionPayload,
  containerSubscriptionId,
  businessDate,
  now = new Date(),
  session = null,
  runtime = null,
} = {}) {
  const paymentStatus = String(payment && payment.status || "").trim().toLowerCase();
  if (paymentStatus !== "paid") {
    throw persistenceError(
      "STACKING_PAYMENT_NOT_PAID",
      "A paid payment is required before creating an entitlement batch",
      422,
      { paymentStatus: paymentStatus || null }
    );
  }

  const payload = buildPurchaseEntitlementBatchPayload({
    draft,
    payment,
    subscriptionPayload,
    containerSubscriptionId,
    businessDate,
    now,
  });
  return ensureBatchByPayload({ payload, session, runtime });
}

module.exports = {
  ensureBatchByPayload,
  ensureLegacyEntitlementBatch,
  ensurePaidPurchaseEntitlementBatch,
  isDuplicateKeyError,
};
