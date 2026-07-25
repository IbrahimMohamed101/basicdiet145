"use strict";

const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const subscriptionQuoteService = require("./subscription/subscriptionQuoteService");
const subscriptionActivationService = require("./subscription/subscriptionActivationService");
const subscriptionController = require("../controllers/subscriptionController");
const {
  createPromoError,
  validatePromoEligibilityOrThrow,
} = require("./promoCodeService");

const INSTALL_FLAG = Symbol.for("basicdiet.dashboardSubscriptionPromoFlow.installed");

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function isDashboardDirectContract(contract) {
  const snapshot = contract && contract.contractSnapshot;
  return Boolean(
    contract
      && (
        contract.contractSource === "admin_create"
        || (snapshot && snapshot.meta && snapshot.meta.source === "admin_create")
      )
  );
}

function buildEligibilityQuote(contract) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const plan = snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : {};
  const pricing = snapshot.pricing && typeof snapshot.pricing === "object" ? snapshot.pricing : {};
  return {
    plan: {
      _id: plan.planId || null,
      daysCount: Number(plan.daysCount || 0),
    },
    breakdown: {
      basePlanPriceHalala: Number(pricing.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(pricing.premiumTotalHalala || 0),
      addonsTotalHalala: Number(pricing.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(pricing.deliveryFeeHalala || 0),
    },
  };
}

async function loadAndValidatePromo({ contract, userId, session }) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const appliedPromo = snapshot.promo && typeof snapshot.promo === "object" ? snapshot.promo : null;
  if (!appliedPromo || !appliedPromo.promoCodeId) {
    return null;
  }

  const promo = await withSession(PromoCode.findById(appliedPromo.promoCodeId), session);
  if (!promo) {
    throw createPromoError("PROMO_NOT_FOUND");
  }

  await validatePromoEligibilityOrThrow({
    promo,
    userId,
    quote: buildEligibilityQuote(contract),
    session,
  });

  return { promo, appliedPromo };
}

async function claimPromoUsage({ promo, appliedPromo, userId, subscription, session }) {
  const existing = await withSession(
    PromoUsage.findOne({
      promoCodeId: promo._id,
      subscriptionId: subscription._id,
      status: { $in: ["reserved", "consumed"] },
    }),
    session
  );
  if (existing) {
    return existing;
  }

  const claimFilter = { _id: promo._id };
  if (promo.usageLimitTotal !== null && promo.usageLimitTotal !== undefined) {
    claimFilter.$expr = {
      $lt: [
        { $ifNull: ["$currentUsageCount", 0] },
        Number(promo.usageLimitTotal),
      ],
    };
  }

  const claimedPromo = await PromoCode.findOneAndUpdate(
    claimFilter,
    { $inc: { currentUsageCount: 1 } },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!claimedPromo) {
    throw createPromoError("PROMO_USAGE_LIMIT_REACHED");
  }

  const created = await PromoUsage.create(
    [{
      promoCodeId: promo._id,
      userId,
      subscriptionId: subscription._id,
      paymentId: null,
      code: promo.code,
      discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
      status: "consumed",
      consumedAt: new Date(),
      orderType: "subscription_checkout",
      metadata: {
        appliesTo: "subscription",
        source: "dashboard_direct_subscription",
      },
    }],
    session ? { session } : undefined
  );

  return created[0];
}

function install() {
  if (globalThis[INSTALL_FLAG]) return;
  globalThis[INSTALL_FLAG] = true;

  const originalResolveQuote = subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
  const resolveDashboardPromoQuote = function resolveDashboardPromoQuote(
    payload,
    options = {}
  ) {
    const resolvedUserId = options.userId || (payload && payload.userId) || null;
    return originalResolveQuote(payload, {
      ...options,
      userId: resolvedUserId,
    });
  };
  subscriptionQuoteService.resolveCheckoutQuoteOrThrow = resolveDashboardPromoQuote;
  // The public subscription controller is loaded before dashboard routes. Replace
  // its already-captured export so adminController receives the promo-aware quote.
  subscriptionController.resolveCheckoutQuoteOrThrow = resolveDashboardPromoQuote;

  const originalActivate = subscriptionActivationService.activateSubscriptionFromCanonicalContract;
  subscriptionActivationService.activateSubscriptionFromCanonicalContract = async function activateWithDashboardPromo(
    args
  ) {
    const input = args && typeof args === "object" ? args : {};
    const shouldConsumePromo = isDashboardDirectContract(input.contract);
    const validated = shouldConsumePromo
      ? await loadAndValidatePromo({
        contract: input.contract,
        userId: input.userId,
        session: input.session,
      })
      : null;

    const subscription = await originalActivate(args);
    if (!validated) {
      return subscription;
    }

    const usage = await claimPromoUsage({
      promo: validated.promo,
      appliedPromo: validated.appliedPromo,
      userId: input.userId,
      subscription,
      session: input.session,
    });

    if (usage && subscription.appliedPromo) {
      subscription.appliedPromo.usageId = usage._id;
      await subscription.save(input.session ? { session: input.session } : undefined);
    }

    return subscription;
  };
}

install();

module.exports = {
  buildEligibilityQuote,
  claimPromoUsage,
  install,
  isDashboardDirectContract,
  loadAndValidatePromo,
};
