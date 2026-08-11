"use strict";

const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  applyPaidDraftToSubscriptionStackTransactional,
} = require("./subscriptionStackingPaidDraftOrchestratorService");
const {
  FINALIZATION_ROUTES,
  resolveFinalizationAuthority,
} = require("./subscriptionStackingFinalizationAuthorityService");

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
    findActiveContainer: (userId, session) => Subscription.findOne({
      userId,
      status: "active",
    }).select("_id userId status").session(session),
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
    const writeEnabled = Boolean(
      draft && payment && userId && runtime.writeEnabledForUser(userId)
    );

    if (!draft || !payment || !userId) {
      return originalFinalize(args, originalRuntimeOverrides);
    }

    const authority = resolveFinalizationAuthority({
      draft,
      writeEnabled,
    });

    if (
      authority.route === FINALIZATION_ROUTES.LEGACY_STANDARD
      || authority.route === FINALIZATION_ROUTES.LEGACY_IDEMPOTENT
    ) {
      return originalFinalize(args, originalRuntimeOverrides);
    }

    if (authority.route === FINALIZATION_ROUTES.STACKING_IDEMPOTENT) {
      return {
        applied: true,
        subscriptionId: authority.expectedParentSubscriptionId,
        stacking: {
          applied: true,
          idempotent: true,
          route: authority.route,
        },
      };
    }

    if (
      authority.route !== FINALIZATION_ROUTES.STANDARD_INITIAL
      && authority.route !== FINALIZATION_ROUTES.STACKING_ADDITIVE
    ) {
      throw routerError(
        "STACKING_FINALIZATION_ROUTE_INVALID",
        "Subscription finalization authority resolved an unsupported route",
        503,
        { route: authority.route }
      );
    }

    // Both initial and additive checkout-time decisions are reloaded and
    // finalized inside one transaction. This prevents a new active parent from
    // appearing between the initial-route safety check and legacy activation.
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

    if (authority.route === FINALIZATION_ROUTES.STANDARD_INITIAL) {
      const activeContainer = await runtime.findActiveContainer(userId, session);
      if (activeContainer) {
        throw routerError(
          "STACKING_INITIAL_FINALIZATION_CONFLICT",
          "A subscription became active after checkout; initial activation cannot replace it",
          409,
          { activeSubscriptionId: String(activeContainer._id || "") }
        );
      }
      return originalFinalize(args, originalRuntimeOverrides);
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
      expectedParentSubscriptionId:
        authority.expectedParentSubscriptionId,
    });
    if (!stacked || stacked.outcome === "delegate_to_standard_activation") {
      throw routerError(
        "STACKING_FINALIZATION_ROUTE_FELL_THROUGH",
        "Additive finalization cannot fall through to legacy replacement",
        409,
        {
          expectedParentSubscriptionId:
            authority.expectedParentSubscriptionId,
          outcome: stacked && stacked.outcome,
        }
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
        route: authority.route,
      },
    };
  }

  return finalizeWithStackingRouter;
}

module.exports = {
  createFinalizeSubscriptionDraftPaymentWrapper,
};
