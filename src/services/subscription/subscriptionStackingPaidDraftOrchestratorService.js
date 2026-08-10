"use strict";

const {
  buildCanonicalSubscriptionActivationPayload,
} = require("./subscriptionActivationService");
const {
  activatePaidDraftIntoExistingContainerTransactional,
} = require("./subscriptionStackingActivationService");
const {
  materializeStackingSubscriptionDaysTransactional,
} = require("./subscriptionStackingDayMaterializationService");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");

function orchestratorError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    buildActivationPayload: ({ draft }) => (
      buildCanonicalSubscriptionActivationPayload({ draft })
    ),
    activateIntoContainer: (args) => (
      activatePaidDraftIntoExistingContainerTransactional(args)
    ),
    materializeDays: (args) => (
      materializeStackingSubscriptionDaysTransactional(args)
    ),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function applyPaidDraftToSubscriptionStackTransactional({
  draft,
  payment,
  businessDate,
  session,
  expectedParentSubscriptionId = null,
  now = new Date(),
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  if (!draft || !draft._id || !draft.userId) {
    throw orchestratorError(
      "INVALID_STACKING_DRAFT",
      "A checkout draft is required",
      422
    );
  }
  if (!payment || String(payment.status || "").trim().toLowerCase() !== "paid") {
    throw orchestratorError(
      "STACKING_PAYMENT_NOT_PAID",
      "A paid payment is required",
      422
    );
  }
  if (String(draft.userId) !== String(payment.userId)) {
    throw orchestratorError(
      "STACKING_DRAFT_PAYMENT_USER_MISMATCH",
      "Checkout draft and payment belong to different users",
      409
    );
  }

  const runtime = resolveRuntime(runtimeOverrides);
  const activationPayload = await runtime.buildActivationPayload({ draft });
  if (
    !activationPayload
    || !activationPayload.subscriptionPayload
  ) {
    throw orchestratorError(
      "STACKING_ACTIVATION_PAYLOAD_MISSING",
      "Canonical activation payload could not be built",
      503
    );
  }

  const activation = await runtime.activateIntoContainer({
    draft,
    payment,
    subscriptionPayload: activationPayload.subscriptionPayload,
    businessDate,
    session,
    expectedParentSubscriptionId,
    now,
  });

  if (!activation || activation.outcome === "delegate_to_standard_activation") {
    return {
      outcome: "delegate_to_standard_activation",
      applied: false,
      subscriptionId: null,
      activation,
      dayMaterialization: null,
    };
  }
  if (
    activation.outcome !== "stacked_into_existing_container"
    || !activation.container
    || !activation.purchaseBatch
  ) {
    throw orchestratorError(
      "STACKING_ACTIVATION_RESULT_INVALID",
      "Additive activation returned an invalid result",
      503,
      { outcome: activation && activation.outcome }
    );
  }

  const dayMaterialization = await runtime.materializeDays({
    container: activation.container,
    batch: activation.purchaseBatch,
    session,
  });
  if (
    !dayMaterialization
    || Number(dayMaterialization.requestedCount || 0) < 1
  ) {
    throw orchestratorError(
      "STACKING_DAY_MATERIALIZATION_EMPTY",
      "The paid batch did not materialize any subscription days",
      503
    );
  }

  return {
    outcome: "stacked_into_existing_container",
    applied: true,
    subscriptionId: String(activation.container._id),
    activation,
    dayMaterialization,
    idempotent: Boolean(
      activation.idempotent
      && dayMaterialization.idempotent
    ),
  };
}

module.exports = {
  applyPaidDraftToSubscriptionStackTransactional,
};
