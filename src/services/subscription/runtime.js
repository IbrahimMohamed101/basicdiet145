const { createInvoice } = require("../moyasarService");
const { buildPhase1SubscriptionContract, buildCanonicalDraftPersistenceFields } = require("./subscriptionContractService");
const { resolveCheckoutQuoteOrThrow } = require("./subscriptionQuoteService");
const {
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
} = require("./subscriptionActivationService");

const sliceBDefaultRuntime = () => ({
  resolveCheckoutQuoteOrThrow,
  createInvoice,
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
});


const sliceP2S1DefaultRuntime = {
  isCanonicalDayPlanningEligible: (...args) => require("./subscriptionDayPlanningService").isCanonicalDayPlanningEligible(...args),
  isCanonicalPremiumOverageEligible: (...args) => require("./subscriptionDayPlanningService").isCanonicalPremiumOverageEligible(...args),
  applyPremiumOverageState: (...args) => require("./subscriptionDayPlanningService").applyPremiumOverageState(...args),
  applyCanonicalDraftPlanningToDay: (...args) => require("./subscriptionDayPlanningService").applyCanonicalDraftPlanningToDay(...args),
  assertCanonicalPlanningExactCount: (...args) => require("./subscriptionDayPlanningService").assertCanonicalPlanningExactCount(...args),
  assertNoPendingPremiumOverage: (...args) => require("./subscriptionDayPlanningService").assertNoPendingPremiumOverage(...args),
  assertNoPendingOneTimeAddonPayment: (...args) => require("./subscriptionDayPlanningService").assertNoPendingOneTimeAddonPayment(...args),
  confirmCanonicalDayPlanning: (...args) => require("./subscriptionDayPlanningService").confirmCanonicalDayPlanning(...args),
};

module.exports = {
  sliceBDefaultRuntime,
  sliceP2S1DefaultRuntime,
};
