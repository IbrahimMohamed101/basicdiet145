"use strict";

const crypto = require("node:crypto");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");

const {
  buildCanonicalSubscriptionActivationPayload,
} = require("./subscriptionActivationService");
const {
  activatePaidDraftIntoExistingContainerTransactional,
  activatePaidDraftIntoExistingContainerStandalone,
  activatePinnedExtrasPaidDraftIntoExistingContainerTransactional,
  completePaidDraftStackingActivation,
  hasPaidPurchaseExtras,
} = require("./subscriptionStackingActivationService");
const {
  isExtraActivationCanaryEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  materializeStackingSubscriptionDaysTransactional,
  materializeStackingSubscriptionDaysIdempotent,
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
    activatePinnedExtrasIntoContainer: (args) => (
      activatePinnedExtrasPaidDraftIntoExistingContainerTransactional(args)
    ),
    extraActivationEnabledForUser: (userId) => (
      isExtraActivationCanaryEnabledForUser(userId)
    ),
    forcePinnedExtrasActivation: false,
    materializeDays: (args) => (
      materializeStackingSubscriptionDaysTransactional(args)
    ),
    activateStandalone: (args) => (
      activatePaidDraftIntoExistingContainerStandalone(args)
    ),
    materializeDaysStandalone: (args) => (
      materializeStackingSubscriptionDaysIdempotent(args)
    ),
    completeStandalone: (args) => completePaidDraftStackingActivation(args),
    async acquireStandaloneLease({
      containerId,
      userId,
      sourceKey,
      token,
      now,
      expiresAt,
      session,
    }) {
      return Subscription.findOneAndUpdate(
        {
          _id: containerId,
          userId,
          status: "active",
          $or: [
            { "stackingActivationLease.expiresAt": null },
            { "stackingActivationLease.expiresAt": { $exists: false } },
            { "stackingActivationLease.expiresAt": { $lte: now } },
          ],
        },
        {
          $set: {
            stackingActivationLease: {
              token,
              sourceKey,
              acquiredAt: now,
              expiresAt,
            },
          },
        },
        { new: true, session }
      );
    },
    releaseStandaloneLease({ containerId, token, session }) {
      return Subscription.updateOne(
        { _id: containerId, "stackingActivationLease.token": token },
        {
          $set: {
            stackingActivationLease: {
              token: "",
              sourceKey: "",
              acquiredAt: null,
              expiresAt: null,
            },
          },
          $inc: { stackingRevision: 1 },
        },
        { session }
      );
    },
    prepareStandalonePayment({ paymentId, containerId, draftId, session }) {
      return Payment.findOneAndUpdate(
        { _id: paymentId, status: "paid" },
        {
          $set: {
            applied: false,
            subscriptionId: containerId,
            checkoutDraftId: draftId,
          },
        },
        { new: true, session }
      );
    },
  };
}

function hasActiveTransaction(session) {
  return Boolean(
    session
      && session.supportsTransactions !== false
      && typeof session.inTransaction === "function"
      && session.inTransaction()
  );
}

function resolveRuntime(runtimeOverrides = null, runtimeDefaults = null) {
  const runtime = runtimeDefaults || defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  const resolved = { ...runtime, ...runtimeOverrides };
  if (
    runtime.forcePinnedExtrasActivation === true
    && Object.prototype.hasOwnProperty.call(runtimeOverrides, "activateIntoContainer")
    && !Object.prototype.hasOwnProperty.call(
      runtimeOverrides,
      "activatePinnedExtrasIntoContainer"
    )
  ) {
    resolved.activatePinnedExtrasIntoContainer = runtimeOverrides.activateIntoContainer;
  }
  return resolved;
}

async function applyPaidDraftToSubscriptionStackCoreTransactional({
  draft,
  payment,
  businessDate,
  session,
  expectedParentSubscriptionId = null,
  now = new Date(),
  runtime: runtimeOverrides = null,
  runtimeDefaults = null,
} = {}) {
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

  const runtime = resolveRuntime(runtimeOverrides, runtimeDefaults);
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

  const paidExtrasPresent = hasPaidPurchaseExtras(
    activationPayload.subscriptionPayload
  );
  const usePinnedExtrasActivation = paidExtrasPresent && Boolean(
    runtime.forcePinnedExtrasActivation
    || runtime.extraActivationEnabledForUser(String(draft.userId))
  );
  if (paidExtrasPresent && !usePinnedExtrasActivation) {
    throw orchestratorError(
      "STACKING_PREMIUM_ADDON_WRITE_NOT_READY",
      "Paid premium and add-on stacking is not enabled for this customer",
      503
    );
  }
  const activateIntoContainer = usePinnedExtrasActivation
    ? runtime.activatePinnedExtrasIntoContainer
    : runtime.activateIntoContainer;
  if (!hasActiveTransaction(session)) {
    if (!expectedParentSubscriptionId) {
      throw orchestratorError(
        "STACKING_EXPECTED_PARENT_REQUIRED",
        "Standalone additive activation requires its checkout-time parent",
        409
      );
    }
    const sourceKey = `payment:${String(payment._id)}`;
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + 30 * 1000);
    const leasedContainer = await runtime.acquireStandaloneLease({
      containerId: expectedParentSubscriptionId,
      userId: draft.userId,
      sourceKey,
      token: leaseToken,
      now,
      expiresAt: leaseExpiresAt,
      session,
    });
    if (!leasedContainer) {
      const err = orchestratorError(
        "STACKING_ACTIVATION_BUSY",
        "Another paid subscription is being added to this customer",
        409,
        { retryable: true, expectedParentSubscriptionId: String(expectedParentSubscriptionId) }
      );
      err.retryableStandalone = true;
      throw err;
    }

    try {
      const preparedPayment = await runtime.prepareStandalonePayment({
        paymentId: payment._id,
        containerId: expectedParentSubscriptionId,
        draftId: draft._id,
        session,
      });
      if (!preparedPayment) {
        throw orchestratorError(
          "STACKING_PAYMENT_PREPARE_CONFLICT",
          "Paid payment could not enter standalone stacking finalization",
          409
        );
      }
      const activation = await runtime.activateStandalone({
        draft,
        payment: preparedPayment,
        subscriptionPayload: activationPayload.subscriptionPayload,
        businessDate,
        session,
        expectedParentSubscriptionId,
        now,
        seedExtraWallets: usePinnedExtrasActivation,
      });
      if (
        !activation
        || activation.outcome !== "stacked_into_existing_container"
        || !activation.container
        || !activation.purchaseBatch
      ) {
        throw orchestratorError(
          "STACKING_STANDALONE_ACTIVATION_RESULT_INVALID",
          "Standalone stacking activation returned an invalid result",
          503,
          { outcome: activation && activation.outcome }
        );
      }
      const dayMaterialization = await runtime.materializeDaysStandalone({
        container: activation.container,
        batch: activation.purchaseBatch,
        session,
      });
      if (!dayMaterialization || Number(dayMaterialization.requestedCount || 0) < 1) {
        throw orchestratorError(
          "STACKING_DAY_MATERIALIZATION_EMPTY",
          "The paid batch did not materialize any subscription days",
          503
        );
      }
      await runtime.completeStandalone({
        draft,
        payment: preparedPayment,
        containerId: activation.container._id,
        now,
        session,
      });
      return {
        outcome: "stacked_into_existing_container",
        applied: true,
        subscriptionId: String(activation.container._id),
        activation,
        dayMaterialization,
        idempotent: Boolean(activation.idempotent && dayMaterialization.idempotent),
        standaloneSaga: true,
      };
    } finally {
      await runtime.releaseStandaloneLease({
        containerId: expectedParentSubscriptionId,
        token: leaseToken,
        session,
      }).catch(() => null);
    }
  }

  assertTransactionalSession(session);
  const activation = await activateIntoContainer({
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

async function applyPaidDraftToSubscriptionStackTransactional(args = {}) {
  return applyPaidDraftToSubscriptionStackCoreTransactional(args);
}

// Retained P2 internal boundary. P4 runtime reaches the same pinned activation
// only through the attested single-user decision above; direct integration
// callers can still force the boundary without changing production routing.
async function applyPinnedExtrasPaidDraftToSubscriptionStackTransactional(args = {}) {
  return applyPaidDraftToSubscriptionStackCoreTransactional({
    ...args,
    runtimeDefaults: {
      ...defaultRuntime(),
      forcePinnedExtrasActivation: true,
    },
  });
}

module.exports = {
  applyPaidDraftToSubscriptionStackTransactional,
  applyPinnedExtrasPaidDraftToSubscriptionStackTransactional,
};
