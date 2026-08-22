"use strict";

const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");
const {
  buildPurchaseEntitlementBatchPayload,
} = require("./subscriptionEntitlementBatchFactory");
const {
  ensureBatchByPayload,
} = require("./subscriptionEntitlementBatchPersistenceService");
const {
  ensureExtraBucketsForBatch,
} = require("./subscriptionExtraEntitlementBucketService");
const {
  resolvePinnedExtraActivationSnapshot,
} = require("./subscriptionStackingExtraActivationAuthorityService");

function initialActivationError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    ensureBatch: (args) => ensureBatchByPayload(args),
    seedExtraBuckets: (args) => ensureExtraBucketsForBatch(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function seedInitialPaidPurchaseEntitlementsTransactional({
  draft,
  payment,
  subscriptionPayload,
  containerSubscriptionId,
  businessDate,
  session,
  now = new Date(),
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  if (!draft || !draft._id || !draft.userId) {
    throw initialActivationError(
      "INVALID_STACKING_INITIAL_DRAFT",
      "The finalized checkout draft is required",
      422
    );
  }
  if (!payment || String(payment.status || "").trim().toLowerCase() !== "paid") {
    throw initialActivationError(
      "STACKING_PAYMENT_NOT_PAID",
      "Initial entitlement seeding requires a paid payment",
      422
    );
  }
  if (!subscriptionPayload || !containerSubscriptionId || !businessDate) {
    throw initialActivationError(
      "STACKING_INITIAL_ENTITLEMENT_INPUT_MISSING",
      "Initial entitlement seeding requires the subscription payload, container, and business date",
      422
    );
  }

  const finalization = draft.stackingFinalization && typeof draft.stackingFinalization === "object"
    ? draft.stackingFinalization
    : {};
  const authoritativeExtraSnapshot = finalization.extraEntitlements
    ? resolvePinnedExtraActivationSnapshot({ draft, subscriptionPayload })
    : null;
  const pendingPayload = buildPurchaseEntitlementBatchPayload({
    draft,
    payment,
    subscriptionPayload,
    authoritativeExtraSnapshot,
    containerSubscriptionId,
    businessDate,
    now,
  });
  const payload = {
    ...pendingPayload,
    applicationState: "applied",
    applicationError: "",
    appliedAt: now,
    activatedAt: pendingPayload.status === "active" ? now : null,
  };
  const runtime = resolveRuntime(runtimeOverrides);
  const batchResult = await runtime.ensureBatch({ payload, session });
  if (!batchResult || !batchResult.batch) {
    throw initialActivationError(
      "STACKING_INITIAL_BATCH_RESULT_INVALID",
      "Initial entitlement batch was not persisted",
      503
    );
  }
  const extraWalletSeeding = await runtime.seedExtraBuckets({
    batch: batchResult.batch,
    session,
  });

  return {
    batch: batchResult.batch,
    extraWalletSeeding,
    idempotent: Boolean(batchResult.idempotent && extraWalletSeeding.idempotent),
  };
}

module.exports = {
  seedInitialPaidPurchaseEntitlementsTransactional,
};
