"use strict";

const CheckoutDraft = require("../../models/CheckoutDraft");
const Subscription = require("../../models/Subscription");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const {
  resolveCheckoutQuoteOrThrow,
} = require("./subscriptionQuoteService");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  buildAdditiveFinalizationIntent,
  buildStandardInitialFinalizationIntent,
} = require("./subscriptionStackingFinalizationAuthorityService");

function preflightError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function quoteHasPremiumEntitlements(quote = {}) {
  const premiumRows = Array.isArray(quote.premiumItems) ? quote.premiumItems : [];
  if (premiumRows.some((row) => normalizeCount(row && row.qty) > 0)) return true;
  if (normalizeCount(quote.premiumCount) > 0) return true;
  const breakdown = quote.breakdown && typeof quote.breakdown === "object"
    ? quote.breakdown
    : {};
  return Number(breakdown.premiumTotalHalala || 0) > 0;
}

function quoteHasAddonEntitlements(quote = {}) {
  const subscriptions = Array.isArray(quote.addonSubscriptions)
    ? quote.addonSubscriptions
    : [];
  if (subscriptions.some((row) => (
    normalizeCount(
      row && (
        row.quantityPerDay
        || row.purchasedDailyQty
        || row.includedTotalQty
        || row.quantity
        || row.qty
      )
    ) > 0
  ))) return true;

  const addonItems = Array.isArray(quote.addonItems) ? quote.addonItems : [];
  if (addonItems.some((row) => normalizeCount(row && (row.qty || row.quantity || 1)) > 0)) {
    return addonItems.length > 0;
  }
  const breakdown = quote.breakdown && typeof quote.breakdown === "object"
    ? quote.breakdown
    : {};
  return Number(breakdown.addonsTotalHalala || 0) > 0;
}

function buildUnsupportedExtrasDetails(quote = {}) {
  return {
    premium: quoteHasPremiumEntitlements(quote),
    addons: quoteHasAddonEntitlements(quote),
  };
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    resolveQuote: (body, context) => resolveCheckoutQuoteOrThrow(body, context),
    findActiveContainer(userId) {
      return Subscription.findOne({ userId, status: "active" })
        .sort({ createdAt: -1 })
        .select("_id userId status")
        .lean();
    },
    findExistingDraft(userId, idempotencyKey) {
      if (!idempotencyKey) return Promise.resolve(null);
      return CheckoutDraft.findOne({ userId, idempotencyKey })
        .sort({ createdAt: -1 })
        .select(
          "_id status subscriptionId providerInvoiceId paymentId stackingFinalization"
        )
        .lean();
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

async function assertStackingCheckoutSupported({
  userId,
  idempotencyKey,
  quote,
  runtime,
} = {}) {
  const existingDraft = await runtime.findExistingDraft(userId, idempotencyKey);
  if (
    existingDraft
    && (
      String(existingDraft.status || "") === "completed"
      || existingDraft.subscriptionId
    )
  ) {
    return {
      allowed: true,
      reason: "completed_idempotent_checkout",
      activeContainer: null,
      existingDraft,
      finalizationIntent: existingDraft.stackingFinalization || null,
    };
  }

  const activeContainer = await runtime.findActiveContainer(userId);
  if (!activeContainer) {
    return {
      allowed: true,
      reason: "first_subscription_uses_standard_activation",
      activeContainer: null,
      existingDraft,
      finalizationIntent: buildStandardInitialFinalizationIntent(),
    };
  }

  const unsupported = buildUnsupportedExtrasDetails(quote);
  if (unsupported.premium || unsupported.addons) {
    throw preflightError(
      "STACKING_PURCHASE_EXTRAS_NOT_READY",
      "Premium and add-on purchases are temporarily unavailable while adding a package to an active subscription",
      409,
      {
        activeSubscriptionId: String(activeContainer._id),
        premiumNotSupported: unsupported.premium,
        addonsNotSupported: unsupported.addons,
        blockedBeforeInvoice: true,
      }
    );
  }

  return {
    allowed: true,
    reason: "base_meal_additive_checkout_supported",
    activeContainer,
    existingDraft,
    finalizationIntent: buildAdditiveFinalizationIntent({
      expectedParentSubscriptionId: activeContainer._id,
    }),
  };
}

function createStackingCheckoutPreflightWrapper(
  originalCheckout,
  runtimeOverrides = null
) {
  if (typeof originalCheckout !== "function") {
    throw new TypeError("originalCheckout must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function performSubscriptionCheckoutWithStackingPreflight(
    userId,
    idempotencyKey,
    body,
    lang,
    callRuntimeOverrides = null
  ) {
    if (!runtime.globallyEnabled() || !runtime.writeEnabledForUser(userId)) {
      return originalCheckout(
        userId,
        idempotencyKey,
        body,
        lang,
        callRuntimeOverrides
      );
    }

    const callerRuntime = callRuntimeOverrides
      && typeof callRuntimeOverrides === "object"
      && !Array.isArray(callRuntimeOverrides)
      ? callRuntimeOverrides
      : {};
    const quoteResolver = typeof callerRuntime.resolveCheckoutQuoteOrThrow === "function"
      ? callerRuntime.resolveCheckoutQuoteOrThrow
      : runtime.resolveQuote;
    const quote = await quoteResolver(body, { lang, userId });

    const preflight = await assertStackingCheckoutSupported({
      userId,
      idempotencyKey,
      quote,
      runtime,
    });

    // The original checkout receives the exact already-resolved quote so pricing,
    // catalog and promo resolution are never repeated or allowed to drift between
    // preflight and invoice creation.
    const resolvedRuntime = {
      ...callerRuntime,
      resolveCheckoutQuoteOrThrow: async () => quote,
      stackingFinalizationIntent: preflight.finalizationIntent,
    };
    return originalCheckout(
      userId,
      idempotencyKey,
      body,
      lang,
      resolvedRuntime
    );
  };
}

module.exports = {
  assertStackingCheckoutSupported,
  buildUnsupportedExtrasDetails,
  createStackingCheckoutPreflightWrapper,
  quoteHasAddonEntitlements,
  quoteHasPremiumEntitlements,
};
