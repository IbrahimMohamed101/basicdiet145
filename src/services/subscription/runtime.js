// NOTE: subscriptionController is NOT imported at top level to break circular dependency.
// resolveCheckoutQuoteOrThrow is resolved lazily inside the factory function.
const { createInvoice } = require("../moyasarService");
const { buildPhase1SubscriptionContract, buildCanonicalDraftPersistenceFields } = require("./subscriptionContractService");
const {
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromLegacyDraft,
  isCanonicalCheckoutDraft,
} = require("./subscriptionActivationService");

const sliceBDefaultRuntime = () => ({
  resolveCheckoutQuoteOrThrow: (...args) => require("../../controllers/subscriptionController").resolveCheckoutQuoteOrThrow(...args),
  createInvoice,
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromLegacyDraft,
  isCanonicalCheckoutDraft,
});

const sliceP2S1DefaultRuntime = {
  isCanonicalDayPlanningEligible: (...args) => require("./subscriptionDayPlanningService").isCanonicalDayPlanningEligible(...args),
  isCanonicalPremiumOverageEligible: (...args) => require("./subscriptionDayPlanningService").isCanonicalPremiumOverageEligible(...args),
  normalizeOneTimeAddonSelections: (...args) => require("../oneTimeAddonPlanningService").normalizeOneTimeAddonSelections(...args),
  recomputeOneTimeAddonPlanningState: (...args) => require("../oneTimeAddonPlanningService").recomputeOneTimeAddonPlanningState(...args),
  applyPremiumOverageState: (...args) => require("./subscriptionDayPlanningService").applyPremiumOverageState(...args),
  applyRecurringAddonProjectionToDay: (...args) => require("../recurringAddonService").applyRecurringAddonProjectionToDay(...args),
  isCanonicalRecurringAddonEligible: (...args) => require("../recurringAddonService").isCanonicalRecurringAddonEligible(...args),
  applyCanonicalDraftPlanningToDay: (...args) => require("./subscriptionDayPlanningService").applyCanonicalDraftPlanningToDay(...args),
  assertCanonicalPlanningExactCount: (...args) => require("./subscriptionDayPlanningService").assertCanonicalPlanningExactCount(...args),
  assertNoPendingPremiumOverage: (...args) => require("./subscriptionDayPlanningService").assertNoPendingPremiumOverage(...args),
  assertNoPendingOneTimeAddonPayment: (...args) => require("../oneTimeAddonPlanningService").assertNoPendingOneTimeAddonPayment(...args),
  confirmCanonicalDayPlanning: (...args) => require("./subscriptionDayPlanningService").confirmCanonicalDayPlanning(...args),
};

module.exports = {
  sliceBDefaultRuntime,
  sliceP2S1DefaultRuntime,
};