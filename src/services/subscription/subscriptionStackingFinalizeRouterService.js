"use strict";

const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  applyPaidDraftToSubscriptionStackTransactional,
} = require("./subscriptionStackingPaidDraftOrchestratorService");

function routerError(code, message, status = 503, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    startSession: () => startSafeSession(),
    findDraftById: (draftId, session) => CheckoutDraft.findById(draftId).session(session),
    findPaymentById: (paymentId, session) => Payment.findById(paymentId).session(session),
    getBusinessDate: () => getRestaurantBusinessDate(),
    applyStack: (args) => applyPaidDraftToSubscriptionStackTransactional(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function createFinalizeSubscriptionDraftPaymentWrapper(
  originalFinalize,
  runtimeOverrides = null
) {
  if (typeof originalFinalize !== "function") {
    throw new TypeError("originalFinalize must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  async function finalizeWithStackingRouter(args = {}, originalRuntimeOverrides = null) {
    const draft = args && args.draft;
    const payment = args && args.payment;
    const session = args && args.session;
    const userId = String(draft && draft.userId || payment && payment.userId || "");

    if (!draft || !payment || !userId || !runtime.writeEnabledForUser(userId)) {
      return originalFinalize(args, originalRuntimeOverrides);
    }

    // Completed drafts already passed an atomic activation path. Delegate to the
    // canonical idempotency handling instead of rebuilding a purchase batch.
    if (draft.subscriptionId || String(draft.status || "") === "completed") {
      return originalFinalize(args, originalRuntimeOverrides);
    }

    if (!session) {
      const ownedSession = await runtime.startSession();
      let result;
      try {
        await ownedSession.withTransaction(async () => {
          const [draftInSession, paymentInSession] = await Promise.all([
            runtime.findDraftById(draft._id, ownedSession),
            runtime.findPaymentById(payment._id, ownedSession),
          ]);
          if (!draftInSession || !paymentInSession) {
            throw routerError(
              "STACKING_FINALIZE_DOCUMENT_MISSING",
              "Checkout draft or payment disappeared before finalization",
              409,
              {
                draftId: String(draft._id || ""),
                paymentId: String(payment._id || ""),
              }
            );
          }
          result = await finalizeWithStackingRouter(
            {
              draft: draftInSession,
              payment: paymentInSession,
              session: ownedSession,
            },
            originalRuntimeOverrides
          );
        });
        return result;
      } finally {
        await ownedSession.endSession();
      }
    }

    const businessDate = await runtime.getBusinessDate();
    if (!businessDate) {
      throw routerError(
        "STACKING_BUSINESS_DATE_UNAVAILABLE",
        "Restaurant business date is unavailable"
      );
    }

    const stacked = await runtime.applyStack({
      draft,
      payment,
      businessDate,
      session,
    });
    if (!stacked || stacked.outcome === "delegate_to_standard_activation") {
      return originalFinalize(
        { draft, payment, session },
        originalRuntimeOverrides
      );
    }
    if (!stacked.applied || !stacked.subscriptionId) {
      throw routerError(
        "STACKING_FINALIZE_RESULT_INVALID",
        "Stacking finalization did not return an applied subscription",
        503,
        { outcome: stacked && stacked.outcome }
      );
    }

    return {
      applied: true,
      subscriptionId: String(stacked.subscriptionId),
      stacking: {
        applied: true,
        idempotent: Boolean(stacked.idempotent),
      },
    };
  }

  return finalizeWithStackingRouter;
}

module.exports = {
  createFinalizeSubscriptionDraftPaymentWrapper,
};
